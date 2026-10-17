// One Worker: the Vite-built dashboard as static assets, the API under /api, and the Lab
// Durable Object that orchestrates everything. Reads are public; every write is admin-only.
import { Hono } from "hono";
import { adminIdentity, LOGIN_HTML, requireAdmin, startSession } from "./access.ts";
import { findBox } from "./boxes.ts";
import { redact } from "./db.ts";

export { Lab } from "./lab.ts";

export type Env = {
  ASSETS: Fetcher;
  LAB: DurableObjectNamespace;
  CREATEOS_SANDBOX_BASE_URL: string;
  CREATEOS_SANDBOX_API_KEY: string;
  READ_STRIPE_KEY: string;
  MODEL_API_KEY: string;
  MODEL_BASE_URL: string;
  MODEL: string;
  DATABASE_URL: string;
  APPROVAL_HMAC_KEY: string;
  RESEND_API_KEY?: string;
  ADMIN_EMAIL?: string;
  PUBLIC_URL: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_TOKEN?: string;
  PROJECTS_STATUS?: string;
  SHADOW_LAB: string;
  PLAN_BOX_LIMIT: string;
};

const app = new Hono<{ Bindings: Env; Variables: { admin: string } }>();
// RPC stub, typed as the class (its methods are all async).
const lab = (env: Env) => env.LAB.get(env.LAB.idFromName("lab")) as unknown as import("./lab.ts").Lab;

app.get("/api/health", (c) => c.json({ ok: true, service: "agent-handshake" }));
app.get("/api/readiness", (c) => {
  const required = ["CREATEOS_SANDBOX_API_KEY", "READ_STRIPE_KEY", "MODEL_API_KEY", "DATABASE_URL", "APPROVAL_HMAC_KEY"] as const;
  const missing = required.filter((key) => !c.env[key]);
  return c.json({ ok: missing.length === 0, missing }, missing.length ? 503 : 200);
});
app.get("/api/state", async (c) => c.json(await lab(c.env).snapshot(!!(await adminIdentity(c)))));
app.get("/api/live", (c) => lab(c.env).fetch(c.req.raw));
// Admins also see which required secrets this deployment is missing (names only, never values).
const REQUIRED = ["CREATEOS_SANDBOX_API_KEY", "READ_STRIPE_KEY", "MODEL_API_KEY", "DATABASE_URL", "APPROVAL_HMAC_KEY"] as const;
app.get("/api/me", async (c) => {
  const admin = !!(await adminIdentity(c));
  return c.json(admin ? { admin, missing_secrets: REQUIRED.filter((k) => !c.env[k]) } : { admin });
});

// Cloudflare Access protects /api/admin/*, so with Access this path signs you in and comes back.
// Without Access, it shows the ADMIN_TOKEN form.
app.get("/api/admin/login", async (c) => {
  if (await adminIdentity(c)) return c.redirect("/");
  if (!c.env.ADMIN_TOKEN) return c.text("Admin sign-in is not configured: set up Cloudflare Access or ADMIN_TOKEN.", 403);
  return c.html(LOGIN_HTML);
});
app.post("/api/session", startSession);
app.post("/api/admin/:action", requireAdmin, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json({ ok: true, ...(await lab(c.env).action(c.req.param("action") ?? "", body, c.get("admin"))) });
  } catch (err) {
    return c.json({ ok: false, reason: redact((err as Error).message) }, 400);
  }
});
// Every other non-GET /api route is refused outright.
app.all("/api/*", (c) => c.json({ ok: false, reason: c.req.method === "GET" ? "not found" : "admin only" }, c.req.method === "GET" ? 404 : 403));

// lunaterminal.com/try -> the portal sandbox's public URL (the QR code points here).
app.get("/try", async (c) => {
  const portal = await findBox(c.env, "portal").catch(() => undefined);
  const url = portal?.data.ingress_url_template?.replace("<port>", "8080");
  return url && portal?.status === "running" ? c.redirect(url, 302) : c.text("The portal box is not up right now.", 503);
});

// Everything else is the dashboard. On Cloudflare the platform serves assets before the Worker
// (run_worker_first covers only /api/* and /try), so this only runs in the CreateOS container.
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

// Callers get a generic error and an id; the detail (scrubbed of every secret) stays in the logs.
app.onError((err, c) => {
  const id = crypto.randomUUID().slice(0, 8);
  let detail = redact(err.message);
  for (const v of [c.env.CREATEOS_SANDBOX_API_KEY, c.env.READ_STRIPE_KEY, c.env.MODEL_API_KEY, c.env.DATABASE_URL, c.env.APPROVAL_HMAC_KEY, c.env.RESEND_API_KEY, c.env.ADMIN_TOKEN]) {
    if (v) detail = detail.replaceAll(v, "<redacted>");
  }
  console.error(`[${id}] ${detail}`);
  return c.json({ ok: false, reason: "internal error", id }, 500);
});

export default app;
