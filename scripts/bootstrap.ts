// npm run bootstrap — reproduce the whole stack from a fresh clone.
// Provisions through Stripe Projects, verifies the CreateOS key on the EU control plane,
// creates the lab network and the vault sandbox, injects the money key into the vault
// only, proves egress lockdown, and pushes the Worker's secrets.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { existsSync } from "node:fs";
import { createos, createosCli, createosTarget, EU, fail, loadEnv, ok, projects, provisioned, warn, wrangler } from "./lib.ts";
import { syncSecrets } from "./secrets-sync.ts";

const PLAN = process.env.CREATEOS_PLAN ?? "free"; // free | beginner-monthly | pro-monthly
const LAB_NET = "handshake-lab";

// 1. Stripe Projects: every service the stack needs.
const init = projects(["status"]);
if (!init.ok && init.error?.code === "PROJECT_NOT_INITIALIZED") projects(["init", "--mode", "manual"]);
const have = provisioned(projects(["status"]).data);
const wanted = [`createos/${PLAN}`, "createos/project", "neon/free", "neon/postgres", "resend/free", "resend/email", "openrouter/free", "openrouter/api"];
for (const s of wanted) {
  if (have.has(s)) continue;
  const paid = PLAN !== "free" && s === `createos/${PLAN}`;
  const r = projects(["add", s, "--accept-tos", ...(paid ? ["--confirm-paid-service"] : [])]);
  if (!r.ok) fail(`stripe projects add ${s} failed: ${r.error?.message}`);
  ok(`provisioned ${s}`);
}
// A dedicated Stripe sandbox keeps demo data out of real accounts. Optional: Stripe's API
// sometimes 500s here; a test-mode sk_test_ key in .env.local works just as well.
if (!have.has("stripe/sandbox")) {
  const r = projects(["add", "stripe/sandbox", "--accept-tos"]);
  r.ok ? ok("provisioned stripe/sandbox") : warn(`stripe/sandbox unavailable (${r.error?.message?.slice(0, 80)}); using STRIPE_SECRET_KEY from .env.local`);
}
projects(["env", "--pull"]);
ok("Stripe Projects services provisioned; .env pulled");

// 2. Secrets that don't come from a provider.
const env = loadEnv();
const need = (name: string, varName: string, prefix: string, how: string) => {
  const v = env[name];
  if (!v) fail(`${name} is missing. ${how}\n  stripe projects variables set ${varName} --env-key ${name}\n  then re-run npm run bootstrap`);
  if (!v.startsWith(prefix)) fail(`${name} must start with ${prefix} (test mode only). Refusing to continue.`);
};
need("VAULT_STRIPE_KEY", "vault-stripe-key", "rk_test_", "Create a restricted key in the Stripe test Dashboard with Charges: Read and Refunds: Write, then:");
need("READ_STRIPE_KEY", "read-stripe-key", "rk_test_", "Create a restricted key in the Stripe test Dashboard with read-only access (Charges, Customers, Refunds), then:");
const sk = env.STRIPE_SECRET_KEY ?? env.STRIPE_SANDBOX_SECRET_KEY;
if (!sk?.startsWith("sk_test_")) warn("no sk_test_ key found (STRIPE_SECRET_KEY in .env.local). Only seed/reset need it.");
ok("Stripe keys are test-mode restricted keys");

// 3. CreateOS on the EU control plane.
const cos = createos(env);
const me = await cos.whoami().catch((e) => fail(`CreateOS key rejected by ${EU}: ${e.message}`));
// Concurrent-box cap: 5 on hackathon accounts (the control plane says so in its 429). Override if yours differs.
const limit = Number(process.env.PLAN_BOX_LIMIT ?? 5);
ok(`CreateOS key verified against ${EU} (user ${me.user_id.slice(0, 8)}…, ${me.stats.running} running / ${me.stats.paused} paused, plan limit ${limit})`);

// 4. The lab network and the vault box.
const nets = await cos.networks.list();
const lab = nets.find((n) => n.name === LAB_NET) ?? (await cos.networks.create({ name: LAB_NET }));
ok(`network ${LAB_NET} (${lab.id})`);

const boxes = await cos.listSandboxes();
let vault: Sandbox | undefined = boxes.find((b) => b.name === "vault" && !["destroyed", "destroying", "failed"].includes(b.status));
if (vault?.status === "paused") await vault.resume();
if (!vault) {
  const live = boxes.filter((b) => !["destroyed", "destroying", "failed"].includes(b.status)).length;
  if (live >= limit) fail(`CreateOS plan limit reached (${live}/${limit} boxes). Destroy a box or upgrade the plan (CREATEOS_PLAN=beginner-monthly).`);
  vault = await cos.createSandbox({
    name: "vault",
    shape: "s-1vcpu-1gb",
    rootfs: "devbox:1",
    networks: [{ id: lab.id }],
    egress: ["api.stripe.com:443"], // the only place the money key can go
  });
  ok(`created vault box ${vault.id}`);
} else ok(`reusing vault box ${vault.id}`);

// 5. Code + secrets into the vault. The money key goes to a 0600 file, never the sandbox env.
const hmacKey = randomBytes(32).toString("hex");
await vault.sh("mkdir -p /opt/handshake/shared /opt/handshake/vault /var/lib/vault && chmod 700 /var/lib/vault");
await vault.files.upload("/opt/handshake/shared/decide.ts", readFileSync("shared/decide.ts"));
await vault.files.upload("/opt/handshake/vault/server.ts", readFileSync("vault/server.ts"));
await vault.files.upload("/var/lib/vault/secrets.env", `VAULT_STRIPE_KEY=${env.VAULT_STRIPE_KEY}\nAPPROVAL_HMAC_KEY=${hmacKey}\n`);
await vault.sh("chmod 600 /var/lib/vault/secrets.env");
await vault.sh("pkill -f /opt/handshake/vault/server.ts || true");
await vault.processes.create({ cmd: "node", args: ["/opt/handshake/vault/server.ts"], cwd: "/opt/handshake" });
let health = "";
for (let i = 0; i < 20 && !health.includes('"ok":true'); i++) {
  await new Promise((r) => setTimeout(r, 1000));
  health = (await vault.sh("curl -s localhost:8080/health || true")).result.stdout;
}
if (!health.includes('"ok":true')) fail(`vault did not come up: ${health}`);
ok(`vault service healthy: ${health.trim()}`);

// 6. Prove egress lockdown: anything but api.stripe.com must fail. Domain rules take ~30 s.
let proof = { blocked: false, stripe: "" };
for (let i = 0; i < 12 && !(proof.blocked && proof.stripe === "401"); i++) {
  const r = await vault.sh("curl -s -m 5 -o /dev/null https://example.com; echo \"other=$?\"; curl -s -m 8 -o /dev/null -w 'stripe=%{http_code}' https://api.stripe.com/v1/charges");
  proof = { blocked: !/other=0\b/.test(r.result.stdout), stripe: r.result.stdout.match(/stripe=(\d+)/)?.[1] ?? "" };
  if (!(proof.blocked && proof.stripe === "401")) await new Promise((r) => setTimeout(r, 5000));
}
if (!proof.blocked) fail("egress lockdown NOT proven: the vault reached example.com");
if (proof.stripe !== "401") fail(`vault cannot reach api.stripe.com (got ${proof.stripe || "no answer"})`);
ok("egress proven: example.com blocked, api.stripe.com reachable (401 without a key)");

// 7. Worker secrets. APPROVAL_HMAC_KEY lives only in the Worker and the vault.
wrangler(["secret", "put", "APPROVAL_HMAC_KEY"], hmacKey);
// The CreateOS Deploy copy of the Worker signs approvals for the same vault.
if (existsSync(".createos.json")) {
  const t = createosTarget();
  createosCli(["env", "set", "--project", t.project, "--environment", t.environment, `APPROVAL_HMAC_KEY=${hmacKey}`]);
}
ok("APPROVAL_HMAC_KEY pushed to the Worker(s) and the vault; not written to disk");
syncSecrets();
console.log("\nBootstrap complete. Next: npm run seed, then npm run deploy.\n");
