// Admin gate: every non-GET /api route and every button. Cloudflare Access sits in front of
// /api/admin/*; the Worker also verifies the Access JWT itself and fails closed.
import type { Context, Next } from "hono";
import type { Env } from "./index.ts";

type Jwk = JsonWebKey & { kid: string };
let certs: { at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function verifyAccess(env: Env, jwt: string | undefined): Promise<string | null> {
  if (!jwt || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, sig] = jwt.split(".");
  if (!sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  if (!certs || Date.now() - certs.at > 3_600_000) {
    const r = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
    certs = { at: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys };
  }
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!valid) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(env.ACCESS_AUD) || claims.exp * 1000 < Date.now() || claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
  return claims.email ?? "admin";
}

export const accessJwt = (c: Context) => c.req.header("cf-access-jwt-assertion") ?? c.req.header("cookie")?.match(/CF_Authorization=([^;]+)/)?.[1];

export async function requireAdmin(c: Context<{ Bindings: Env; Variables: { admin: string } }>, next: Next) {
  // CSRF: the Access cookie rides along on cross-site requests, so writes must be
  // same-origin JSON (a cross-site form or no-cors fetch can't send that).
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (!origin || new URL(origin).host !== new URL(c.req.url).host || !c.req.header("content-type")?.startsWith("application/json")) {
      return c.json({ ok: false, reason: "cross-site request refused" }, 403);
    }
  }
  const who = await verifyAccess(c.env, accessJwt(c));
  if (!who) return c.json({ ok: false, reason: "admin only (Cloudflare Access)" }, 403);
  c.set("admin", who);
  await next();
}
