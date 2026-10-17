// npm run secrets:sync — push the Worker's secrets from the Stripe Projects .env to Cloudflare.
// Refuses to push the vault's money key: Cloudflare must never hold VAULT_STRIPE_KEY.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { fail, loadEnv, ok, projects, warn, wrangler } from "./lib.ts";

// Worker secret name <- .env name
const MAP: Record<string, string> = {
  READ_STRIPE_KEY: "READ_STRIPE_KEY",
  CREATEOS_SANDBOX_API_KEY: "CREATEOS_PROJECT_API_KEY",
  MODEL_API_KEY: "OPENROUTER_API_API_KEY",
  DATABASE_URL: "NEON_POSTGRES_CONNECTION_STRING",
  ADMIN_TOKEN: "ADMIN_TOKEN",
  RESEND_API_KEY: "RESEND_API_KEY",
};

export function syncSecrets() {
  const env = loadEnv();
  if (!env.ADMIN_TOKEN) {
    env.ADMIN_TOKEN = randomBytes(32).toString("hex");
    appendFileSync(".env.local", `
# Dashboard admin sign-in (/api/admin/login) where Cloudflare Access isn't set up
ADMIN_TOKEN=${env.ADMIN_TOKEN}
`, { mode: 0o600 });
    ok("generated ADMIN_TOKEN into .env.local");
  }
  const money = env.VAULT_STRIPE_KEY;
  const out: Record<string, string> = {};
  for (const [name, from] of Object.entries(MAP)) {
    const v = env[from];
    if (!v) {
      warn(`${from} not in .env yet: skipping Worker secret ${name} (bootstrap requires it)`);
      continue;
    }
    out[name] = v;
  }
  for (const [name, v] of Object.entries(out)) {
    if (name === "VAULT_STRIPE_KEY" || (money && v === money)) fail(`refusing to push ${name}: it is the vault's money key`);
    if (/^(sk|rk)_live_/.test(v) || /^sk_test_/.test(v)) fail(`refusing to push ${name}: only a read-only restricted test key may leave this machine`);
  }
  // Non-secret snapshot for the Proof page: which services Stripe Projects provisioned.
  const status = projects(["status"]).data;
  out.PROJECTS_STATUS = JSON.stringify(
    [...(status?.services ?? []), ...(status?.plans ?? [])].map((s: any) => ({ provider: s.provider, service: s.service_id, pricing: s.pricing, status: s.status })),
  );
  wrangler(["secret", "bulk"], JSON.stringify(out));
  ok(`Worker secrets pushed: ${Object.keys(out).join(", ")} (VAULT_STRIPE_KEY withheld)`);
}

if (process.argv[1]?.endsWith("secrets-sync.ts")) syncSecrets();
