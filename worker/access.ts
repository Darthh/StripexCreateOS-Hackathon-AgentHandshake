// Admin gate: every non-GET /api route and every button. Two ways in:
// 1. Cloudflare Access in front of /api/admin/* (production). The Worker re-verifies the JWT.
// 2. ADMIN_TOKEN (deployments without Access, e.g. CreateOS Deploy): a session cookie
//    set by POST /api/session. Without either, every admin action fails closed.
import type { Context, Next } from "hono";
import type { Env } from "./index.ts";

type Jwk = JsonWebKey & { kid: string };
type Ctx = Context<{ Bindings: Env; Variables: { admin: string } }>;
let certs: { at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sha256hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const safeEq = (a: string, b: string) => {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
};

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

const sessionValue = (token: string) => sha256hex(`twokey-admin-session:${token}`);
const tokenUsable = (env: Env) => !!env.ADMIN_TOKEN && env.ADMIN_TOKEN.length >= 32;

export async function adminIdentity(c: Context): Promise<string | null> {
  const env = c.env as Env;
  const viaAccess = await verifyAccess(env, accessJwt(c));
  if (viaAccess) return viaAccess;
  if (!tokenUsable(env)) return null;
  const cookie = c.req.header("cookie")?.match(/(?:^|;\s*)twokey_admin=([a-f0-9]{64})/)?.[1];
  return cookie && safeEq(cookie, await sessionValue(env.ADMIN_TOKEN!)) ? "admin (token)" : null;
}

// CSRF: cookies ride along on cross-site requests, so writes must be same-origin JSON
// (a cross-site form or no-cors fetch can't send that).
export function sameOriginJson(c: Context) {
  const origin = c.req.header("origin");
  return !!origin && new URL(origin).host === new URL(c.req.url).host && !!c.req.header("content-type")?.startsWith("application/json");
}

export async function requireAdmin(c: Ctx, next: Next) {
  if (c.req.method !== "GET" && !sameOriginJson(c)) return c.json({ ok: false, reason: "cross-site request refused" }, 403);
  const who = await adminIdentity(c);
  if (!who) return c.json({ ok: false, reason: "admin only: sign in with Cloudflare Access or the admin token" }, 403);
  c.set("admin", who);
  await next();
}

// POST /api/session {token}: trade the admin token for an HttpOnly session cookie.
export async function startSession(c: Ctx) {
  if (!sameOriginJson(c)) return c.json({ ok: false, reason: "cross-site request refused" }, 403);
  const { token } = (await c.req.json().catch(() => ({}))) as { token?: unknown };
  if (!tokenUsable(c.env) || typeof token !== "string" || !safeEq(await sha256hex(token), await sha256hex(c.env.ADMIN_TOKEN!))) {
    return c.json({ ok: false, reason: "wrong token" }, 403);
  }
  c.header("set-cookie", `twokey_admin=${await sessionValue(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
  return c.json({ ok: true });
}

export const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Two-Key admin sign-in</title>
<style>:root{--bg:#1a1a19;--surface:#1d1d1c;--border:#2c2b29;--text:#eceae5;--muted:#9a968f;--accent:#8e9af3;--red:#e57d70}
@media (prefers-color-scheme:light){:root{--bg:#fbfaf8;--surface:#fff;--border:#e9e7e2;--text:#1d1c1a;--muted:#6f6c66;--accent:#4b5bd6;--red:#c4493b}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:13.5px/1.5 system-ui,sans-serif}
form{width:min(360px,calc(100vw - 32px));background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:22px}
h1{font-size:16px;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}label{display:block;margin-bottom:6px;font-weight:500}
input{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}
button{margin-top:14px;width:100%;padding:9px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
#err{color:var(--red);min-height:1.5em;margin:10px 0 0}</style></head><body>
<form id="f"><h1>Admin sign-in</h1><p>Paste the ADMIN_TOKEN from your .env.local.</p>
<label for="t">Admin token</label><input id="t" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button><p id="err" role="alert"></p></form>
<script>document.getElementById("f").onsubmit=async(e)=>{e.preventDefault();const r=await fetch("/api/session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:document.getElementById("t").value})});if(r.ok)location.href="/";else document.getElementById("err").textContent="Wrong token.";};</script>
</body></html>`;
