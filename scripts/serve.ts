// Container entry for CreateOS Deploy: run the same Worker (Durable Object, alarms, WebSockets,
// static assets) in workerd via `wrangler dev`. CreateOS injects the env vars; secrets go into a
// 0600 .dev.vars so wrangler prints them as "(hidden)" instead of logging their values.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const SECRETS = ["CREATEOS_SANDBOX_API_KEY", "READ_STRIPE_KEY", "MODEL_API_KEY", "DATABASE_URL", "APPROVAL_HMAC_KEY", "RESEND_API_KEY", "ADMIN_TOKEN", "ADMIN_EMAIL", "PROJECTS_STATUS"];
const VARS = ["PUBLIC_URL", "PLAN_BOX_LIMIT", "SHADOW_LAB", "MODEL"];

const lines = SECRETS.filter((k) => process.env[k]).map((k) => {
  const v = process.env[k]!;
  if (/['\n]/.test(v)) throw new Error(`${k} contains a quote or newline; cannot write it to .dev.vars safely`);
  return `${k}='${v}'`; // single quotes: dotenv takes the value literally
});
writeFileSync(".dev.vars", `${lines.join("\n")}\n`, { mode: 0o600 });
const vars = VARS.filter((k) => process.env[k]).flatMap((k) => ["--var", `${k}:${process.env[k]}`]);

const child = spawn(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "dev", "--ip", "0.0.0.0", "--port", process.env.PORT ?? "8080", "--persist-to", process.env.PERSIST_TO ?? "/data/wrangler", ...vars], {
  stdio: "inherit",
  env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" },
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => child.kill(sig));
