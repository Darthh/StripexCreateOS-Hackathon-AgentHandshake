// Container entry for CreateOS Deploy: the same Worker (Durable Object, alarms, WebSockets, static
// assets) in workerd via Miniflare, the engine behind `wrangler dev`. No dev server, so no file
// watchers: the shared host's inotify limit made `wrangler dev` crash-loop with EMFILE.
// The Dockerfile pre-bundles the Worker to build/index.js; wrangler.jsonc stays the single source
// for vars, compatibility settings and asset routing. Secrets go straight into memory, never a file.
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare } from "miniflare";
import { unstable_readConfig } from "wrangler";

const SECRETS = ["CREATEOS_SANDBOX_API_KEY", "READ_STRIPE_KEY", "MODEL_API_KEY", "DATABASE_URL", "APPROVAL_HMAC_KEY", "RESEND_API_KEY", "ADMIN_TOKEN", "ADMIN_EMAIL", "PROJECTS_STATUS"];
const OVERRIDABLE_VARS = ["PUBLIC_URL", "PLAN_BOX_LIMIT", "SHADOW_LAB", "MODEL"];

const cfg = unstable_readConfig({ config: "wrangler.jsonc" });
const fromEnv = (keys: string[]) => Object.fromEntries(keys.filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));

// Miniflare 5 (beta) has a new options schema; the v4 shape is stable and converts losslessly.
const options = convertV4MiniflareOptions({
  host: "0.0.0.0",
  port: Number(process.env.PORT ?? 8080),
  name: cfg.name,
  modules: true,
  scriptPath: "build/index.js",
  compatibilityDate: cfg.compatibility_date,
  compatibilityFlags: cfg.compatibility_flags,
  durableObjects: { LAB: "Lab" },
  bindings: { ...(cfg.vars as Record<string, string>), ...fromEnv(OVERRIDABLE_VARS), ...fromEnv(SECRETS) },
  assets: {
    directory: "dist",
    binding: "ASSETS",
    // Miniflare's beta ignores run_worker_first patterns for browser navigations, so the Worker
    // runs first for everything here and hands non-API paths to ASSETS (see worker/index.ts).
    routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true },
    assetConfig: { not_found_handling: cfg.assets?.not_found_handling ?? "single-page-application" },
  },
});
const mf = new Miniflare({ ...options, log: new Log(LogLevel.INFO), resourcePersistencePath: process.env.PERSIST_TO ?? "/data/miniflare" }); // Durable Object state; log forwards console.* to stdout
console.log(`Agent Handshake listening on ${await mf.ready}`);
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => mf.dispose().finally(() => process.exit(0)));
