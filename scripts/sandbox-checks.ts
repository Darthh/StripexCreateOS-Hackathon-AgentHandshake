// Linux/CreateOS integration demos. No Stripe account is contacted: the vault uses
// a loopback fixture. Set RUN_LIVE_MODEL=1 and MODEL_API_KEY for an optional free-model
// run; generated Python still runs unprivileged with a scrubbed environment.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { agentTurn, CHECKER_SYSTEM, MAKER_SYSTEM, newJob, POLICY_V1, VOTE_TOOL } from "../worker/agents.ts";
import type { Env } from "../worker/index.ts";
import { AGENT_PYTHON_SETUP } from "../worker/python.ts";

const exec = promisify(execFile);
const results: { name: string; passed: boolean; detail?: unknown }[] = [];
const children: ChildProcess[] = [];
const servers: Server[] = [];
const artifactDir = "artifacts/sandbox-checks";
mkdirSync(artifactDir, { recursive: true });
const scrub = (s: string) => process.env.MODEL_API_KEY ? s.replaceAll(process.env.MODEL_API_KEY, "<redacted>") : s;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function check(name: string, fn: () => Promise<unknown>) {
  try {
    const detail = await fn();
    results.push({ name, passed: true, ...(detail === undefined ? {} : { detail }) });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, passed: false, detail: scrub(String(e)) });
    console.log(`FAIL ${name}: ${scrub(String(e))}`);
  }
}
function launch(file: string, env: Record<string, string>) {
  const child = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (s) => { output = (output + s).slice(-16000); });
  child.stderr!.on("data", (s) => { output = (output + s).slice(-16000); });
  children.push(child);
  return { child, output: () => scrub(output) };
}
async function ready(url: string, proc: ReturnType<typeof launch>) {
  for (let i = 0; i < 100; i++) {
    if (proc.child.exitCode !== null) throw new Error(`service exited ${proc.child.exitCode}: ${proc.output()}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1500) })).ok) return; } catch {}
    await delay(250);
  }
  throw new Error(`service did not become ready: ${proc.output()}`);
}
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const post = (base: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

try {
  // Exercise the production container entry point, not Vite's development server.
  const origin = "http://127.0.0.1:18081";
  const adminToken = "sandbox-fixture-admin-".repeat(3);
  const app = launch("scripts/serve.ts", { PORT: "18081", PERSIST_TO: "/tmp/handshake-smoke-state", ADMIN_TOKEN: adminToken, DATABASE_URL: "postgresql://fixture:fixture@localhost/fixture" });
  let appReady = false;
  await check("container entry point starts and health responds", async () => {
    await ready(`${origin}/api/health`, app);
    appReady = true;
    assert.deepEqual(await (await fetch(`${origin}/api/health`)).json(), { ok: true, service: "agent-handshake" });
    const readiness = await fetch(`${origin}/api/readiness`);
    assert.equal(readiness.status, 503);
    assert.ok((await readiness.json() as { missing: string[] }).missing.includes("READ_STRIPE_KEY"));
    return { runtime: "scripts/serve.ts / Miniflare", port: 18081 };
  });
  if (appReady) {
    await check("built dashboard and SPA deep links serve", async () => {
      for (const path of ["/", "/tickets", "/approvals", "/red-team", "/eval", "/proof"]) {
        const response = await fetch(`${origin}${path}`);
        assert.equal(response.status, 200, path);
        assert.match(await response.text(), /Agent Handshake/);
      }
    });
    await check("anonymous and cross-origin admin writes fail closed", async () => {
      assert.deepEqual(await (await fetch(`${origin}/api/me`)).json(), { admin: false });
      assert.equal((await post(origin, "/api/admin/setup", {}, { origin })).status, 403);
      assert.equal((await post(origin, "/api/session", { token: adminToken }, { origin: "https://untrusted.invalid" })).status, 403);
      assert.equal((await post(origin, "/api/session", { token: "wrong" }, { origin })).status, 403);
      assert.equal((await post(origin, "/api/admin/setup", {})).status, 403);
    });
    await check("admin session signs in with protected cookie and rejects forgery", async () => {
      const response = await post(origin, "/api/session", { token: adminToken }, { origin });
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")!;
      for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(cookie.includes(flag), flag);
      assert.deepEqual(await (await fetch(`${origin}/api/me`, { headers: { cookie: cookie.split(";")[0] } })).json(), { admin: true });
      assert.deepEqual(await (await fetch(`${origin}/api/me`, { headers: { cookie: `handshake_admin=${"0".repeat(64)}` } })).json(), { admin: false });
    });
    await check("Durable Object live-event WebSocket opens", async () => {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${origin.replace("http", "ws")}/api/live`);
        const timer = setTimeout(() => { ws.close(); reject(new Error("websocket hello timed out")); }, 10000);
        ws.addEventListener("message", (e) => {
          try { assert.equal(JSON.parse(String(e.data)).type, "hello"); clearTimeout(timer); ws.close(); resolve(); }
          catch (err) { clearTimeout(timer); ws.close(); reject(err); }
        });
        ws.addEventListener("error", () => { clearTimeout(timer); ws.close(); reject(new Error("websocket failed")); });
      });
    });
  }
  app.child.kill();

  // Portal is deliberately run independently of the Worker and any database.
  await check("portal validates, records one ticket, and rate-limits repeats", async () => {
    const ticketFile = "/var/portal/tickets.jsonl";
    const before = existsSync(ticketFile) ? readFileSync(ticketFile, "utf8").split("\n").filter(Boolean).length : 0;
    const portal = launch("portal/server.ts", {});
    await ready("http://127.0.0.1:8080/", portal);
    const submit = (fields: Record<string, string>) => fetch("http://127.0.0.1:8080/ticket", { method: "POST", body: new URLSearchParams(fields) });
    const ticket = { email: "demo@example.com", charge_id: "ch_sandbox123", amount: "24.50", reason_code: "damaged", message: "Synthetic broken mug" };
    assert.equal((await submit({ ...ticket, charge_id: "invalid" })).status, 400);
    assert.equal((await submit({ ...ticket, amount: "0" })).status, 400);
    const accepted = await submit(ticket);
    assert.equal(accepted.status, 200);
    assert.match(await accepted.text(), /Received/);
    assert.equal((await submit(ticket)).status, 429);
    const lines = readFileSync(ticketFile, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, before + 1);
    assert.equal(JSON.parse(lines.at(-1)!).amount_cents, 2450);
    portal.child.kill();
    await new Promise((resolve) => portal.child.once("exit", resolve));
  });

  // Same runner and fixed vote transport as the application, sequential roles in
  // ONE box. This checks execution behavior, not separate-VM network isolation.
  await exec("sh", ["-c", "mkdir -p /opt/handshake /var/handshake/input /var/handshake/evidence /work && (id agent >/dev/null 2>&1 || useradd -m -s /bin/sh agent) && chmod 755 /opt/handshake /var/handshake /var/handshake/input /var/handshake/evidence && chown agent:agent /work"]);
  copyFileSync("boxes/run.py", "/opt/handshake/run.py");
  copyFileSync("boxes/vote.py", "/opt/handshake/vote.py");
  await check("production Python setup makes pandas available to the unprivileged agent", async () => {
    await exec("sh", ["-c", AGENT_PYTHON_SETUP], { timeout: 300000, maxBuffer: 1024 * 1024 });
  });
  let lastVaultReply: any;
  const refunds: unknown[] = [];
  const charge = { id: "ch_sandbox", customer: "cus_demo", status: "succeeded", amount: 9000, amount_refunded: 0 };
  const stripe = await listen(createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/charges/ch_sandbox") return res.end(JSON.stringify(charge));
    if (req.method === "POST" && req.url === "/v1/refunds") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      refunds.push({ amount: Number(form.get("amount")), idempotency: req.headers["idempotency-key"] });
      charge.amount_refunded += Number(form.get("amount"));
      return res.end(JSON.stringify({ id: `re_fixture_${refunds.length}` }));
    }
    res.statusCode = 404; res.end("{}");
  }));
  const vaultDir = "/tmp/handshake-demo-vault";
  mkdirSync(vaultDir, { recursive: true });
  const hmac = "synthetic-approval-fixture-".repeat(3);
  writeFileSync(`${vaultDir}/secrets.env`, `VAULT_STRIPE_KEY=rk_test_fixture\nAPPROVAL_HMAC_KEY=${hmac}\n`, { mode: 0o600 });
  const vault = launch("vault/server.ts", { VAULT_DIR: vaultDir, PORT: "18082", STRIPE_API: stripe });
  await ready("http://127.0.0.1:18082/health", vault);
  const vaultBase = "http://127.0.0.1:18082";
  writeFileSync("/opt/handshake/vault_url", vaultBase);
  const tokens = { maker: "fixture-maker-token", checker: "fixture-checker-token" };
  await post(vaultBase, "/admin/voters", { voters: Object.fromEntries(Object.entries(tokens).map(([role, token]) => [role, { sha: createHash("sha256").update(token).digest("hex") }])) });
  await check("fixed vote transport reports rejected credentials as a failed command", async () => {
    let rejection: any;
    try {
      await exec("python3", ["/opt/handshake/vote.py", JSON.stringify({ ticket_id: "invalid_token_probe", decision: "refund" })], { env: { ...process.env, VOTER: "maker", VOTE_TOKEN: "invalid-fixture-token" } });
    } catch (e) { rejection = e; }
    assert.equal(rejection?.code, 1);
    assert.equal(JSON.parse(rejection.stdout).ok, false);
  });
  let activeRole: "maker" | "checker" = "maker";
  const box = {
    files: { upload: async (path: string, value: string) => { writeFileSync(path, value); chmodSync(path, 0o644); } },
    runCommand: async (cmd: string, args: string[]) => {
      try {
        const out = await exec(cmd, args, { timeout: 90000, maxBuffer: 1024 * 1024, env: { ...process.env, VOTER: activeRole, VOTE_TOKEN: tokens[activeRole] } });
        return { result: { ...out, exit_code: 0 } };
      } catch (e: any) { return { result: { stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? ""), exit_code: typeof e.code === "number" ? e.code : 1 } }; }
    },
  } as unknown as Sandbox;
  await check("generated Python runs unprivileged without model or vote secrets", async () => {
    const code = "import os,json,pandas\nassert os.geteuid()!=0\nassert 0 not in os.getgroups()\nassert os.getenv('MODEL_API_KEY') is None\nassert os.getenv('VOTE_TOKEN') is None\nprint(json.dumps({'uid':os.geteuid(),'groups':os.getgroups(),'pandas':pandas.__version__,'secrets_absent':True}))\n";
    writeFileSync("/var/handshake/evidence/run_0.py", code, { mode: 0o644 });
    const out = await box.runCommand("python3", ["/opt/handshake/run.py", "0"]);
    assert.equal(out.result.exit_code, 0, out.result.stderr);
    const result = JSON.parse(out.result.stdout);
    assert.equal(result.exit_code, 0, result.stderr);
    return JSON.parse(result.stdout);
  });

  // Deterministic model fixture traverses the actual agent loop and executes real
  // Python. The optional live mode uses the deployment's configured free model.
  let fixtureTurn = 0;
  const modelFixture = await listen(createServer(async (req, res) => {
    for await (const _chunk of req) { /* consume the request */ }
    const turn = fixtureTurn++;
    const tool = turn % 3 === 2 ? { name: "vote", input: { decision: "refund", charge_id: charge.id, amount_cents: 2450, reason_code: "damaged", rationale: "verified fixture charge" } } : { name: "run_python", input: { code: turn % 3 === 0 ? "raise ValueError('synthetic repair exercise')" : "import json\nc=json.load(open('/var/handshake/input/charges.json'))[0]\nassert c['status']=='succeeded'\nprint(c['id'],c['amount'])" } };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: `msg_${turn}`, type: "message", role: "assistant", model: "fixture", content: [{ type: "tool_use", id: `tool_${turn}`, ...tool }], stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 } }));
  }));
  const live = process.env.RUN_LIVE_MODEL === "1";
  if (live && !process.env.MODEL_API_KEY) throw new Error("RUN_LIVE_MODEL requires MODEL_API_KEY");
  const modelEnv = { MODEL_API_KEY: live ? process.env.MODEL_API_KEY! : "fixture", MODEL_BASE_URL: live ? "https://openrouter.ai/api" : modelFixture, MODEL: "nvidia/nemotron-3-super-120b-a12b:free" } as Env;
  await check(live ? "live free-model maker/checker execute Python and reach fixture refund" : "agent repair loop and fixed voter transport reach fixture refund", async () => {
    const ticket = { ticket_id: "demo_pair", customer_id: "cus_demo", charge_id: charge.id, amount_cents: 2450, reason_code: "damaged" };
    assert.equal((await post(vaultBase, "/admin/ticket", { ticket: { id: ticket.ticket_id, customer_id: ticket.customer_id } })).status, 200);
    for (const role of ["maker", "checker"] as const) {
      activeRole = role;
      for (const file of ["run_0.py", "run_0.out", "run_1.py", "run_1.out", "run_2.py", "run_2.out"]) {
        // Each role gets a fresh evidence directory, matching the app's ticket setup.
        if (existsSync(`/var/handshake/evidence/${file}`)) await exec("rm", ["/var/handshake/evidence/" + file]);
      }
      const input = role === "maker" ? { ...ticket, free_text: "My mug arrived broken. Synthetic test." } : ticket;
      writeFileSync("/var/handshake/input/ticket.json", JSON.stringify(input));
      writeFileSync("/var/handshake/input/charges.json", JSON.stringify([charge]));
      writeFileSync("/var/handshake/input/policy.md", POLICY_V1);
      const job = newJob(`Review this ticket: ${JSON.stringify(input)}${role === "checker" ? `\n${POLICY_V1}` : ""}`);
      let final = null;
      for (let turn = 0; turn < 8 && !final; turn++) {
        final = await agentTurn(modelEnv, box, job, role === "maker" ? MAKER_SYSTEM : CHECKER_SYSTEM, [VOTE_TOOL], async (_name, vote) => {
          const out = await box.runCommand("python3", ["/opt/handshake/vote.py", JSON.stringify({ ...vote, ticket_id: ticket.ticket_id })]);
          lastVaultReply = JSON.parse(out.result.stdout);
          assert.equal(lastVaultReply.ok, true);
          return { content: JSON.stringify(lastVaultReply), done: true };
        });
      }
      writeFileSync(`${artifactDir}/${role}.json`, JSON.stringify({ role, live_model: live, ...job }, null, 2));
      assert.ok(final, `${role} did not finish in eight turns: ${JSON.stringify(job.steps.filter((s) => s.kind === "output").slice(-2))}`);
      assert.ok(job.okRuns > 0);
      if (!live) assert.ok(job.steps.some((s) => s.kind === "output" && s.exit_code !== 0), "fixture must exercise repair after a failed run");
    }
    assert.equal(lastVaultReply.decision.action, "refund");
    assert.equal(refunds.length, 1);
    return { model: live ? modelEnv.MODEL : "deterministic tool fixture", decision: lastVaultReply.decision.action, refund_service: "local fake Stripe", separate_sandboxes: false };
  });
  await check("over-cap demo needs valid approval and rejects forged approval", async () => {
    const beforeApproval = refunds.length;
    await post(vaultBase, "/admin/ticket", { ticket: { id: "demo_approval", customer_id: "cus_demo" } });
    for (const role of ["maker", "checker"] as const) {
      const response = await post(vaultBase, "/vote", { token: tokens[role], voter: role, ticket_id: "demo_approval", decision: "refund", charge_id: charge.id, amount_cents: 5500, reason_code: "damaged", evidence_hash: "fixture" });
      lastVaultReply = await response.json();
    }
    assert.equal(lastVaultReply.decision.action, "needs_human");
    assert.equal((await post(vaultBase, "/admin/approve", { ticket_id: "demo_approval", amount_cents: 5500, sig: "0".repeat(64) })).status, 403);
    const sig = createHmac("sha256", hmac).update("demo_approval:5500").digest("hex");
    const approved: any = await (await post(vaultBase, "/admin/approve", { ticket_id: "demo_approval", amount_cents: 5500, sig })).json();
    assert.equal(approved.decision.action, "refund"); assert.equal(approved.decision.keys, 3);
    assert.equal(refunds.length, beforeApproval + 1);
  });
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  writeFileSync(`${artifactDir}/summary.json`, JSON.stringify({ at: new Date().toISOString(), live_model: process.env.RUN_LIVE_MODEL === "1", results }, null, 2));
  console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, artifacts: artifactDir }));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
