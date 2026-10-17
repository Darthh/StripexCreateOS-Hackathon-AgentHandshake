// Integration check for the money path: the real vault process against a fake Stripe.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const HMAC = "h".repeat(64);
const tokens = { maker: "maker-token", checker: "checker-token" };
const charges: Record<string, { id: string; status: string; amount: number; amount_refunded: number; customer: string }> = {
  ch_ada: { id: "ch_ada", status: "succeeded", amount: 4000, amount_refunded: 0, customer: "cus_ada" },
  ch_big: { id: "ch_big", status: "succeeded", amount: 9000, amount_refunded: 0, customer: "cus_ada" },
};
const refunds: { charge: string; amount: string; idem: string }[] = [];
const dir = mkdtempSync(join(tmpdir(), "vault-"));
let stripe: Server;
let vault: ChildProcess;
let base = "";

function startVault(stripeUrl: string, port: number) {
  vault = spawn(process.execPath, ["vault/server.ts"], { env: { ...process.env, VAULT_DIR: dir, PORT: String(port), STRIPE_API: stripeUrl }, stdio: ["ignore", "pipe", "inherit"] });
  return new Promise<void>((resolve) => vault.stdout!.on("data", (d) => String(d).includes("listening") && resolve()));
}
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const vote = (voter: "maker" | "checker", over: Record<string, unknown> = {}) =>
  post("/vote", { token: tokens[voter], voter, decision: "refund", ticket_id: "t1", charge_id: "ch_ada", amount_cents: 2500, reason_code: "damaged", evidence_hash: "e", ...over });

before(async () => {
  stripe = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c)).on("end", () => {
      res.setHeader("content-type", "application/json");
      const id = req.url!.match(/\/v1\/charges\/(\w+)/)?.[1];
      if (req.method === "GET" && id) return res.end(JSON.stringify(charges[id] ?? { error: { message: "No such charge" } }));
      if (req.method === "POST" && req.url === "/v1/refunds") {
        const f = new URLSearchParams(raw);
        const idem = String(req.headers["idempotency-key"]);
        const prior = refunds.findIndex((r) => r.idem === idem);
        if (prior < 0) {
          refunds.push({ charge: f.get("charge")!, amount: f.get("amount")!, idem });
          charges[f.get("charge")!].amount_refunded += Number(f.get("amount"));
        }
        return res.end(JSON.stringify({ id: `re_${prior < 0 ? refunds.length : prior + 1}` }));
      }
      res.statusCode = 404;
      res.end("{}");
    });
  }).listen(0);
  const stripeUrl = `http://127.0.0.1:${(stripe.address() as AddressInfo).port}`;
  writeFileSync(join(dir, "secrets.env"), `VAULT_STRIPE_KEY=rk_test_fake\nAPPROVAL_HMAC_KEY=${HMAC}\n`);
  const port = 18000 + Math.floor(Math.random() * 1000);
  base = `http://127.0.0.1:${port}`;
  await startVault(stripeUrl, port);
  (globalThis as any).restart = async () => {
    vault.kill();
    await new Promise((r) => vault.once("exit", r));
    await startVault(stripeUrl, port);
  };
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  await post("/admin/voters", { voters: { maker: { sha: sha(tokens.maker) }, checker: { sha: sha(tokens.checker) } } });
  for (const id of ["t1", "t2", "t3"]) await post("/admin/ticket", { ticket: { id, customer_id: "cus_ada" } });
});
after(() => {
  vault?.kill();
  stripe?.close();
});

test("a forged token is rejected", async () => {
  const r = await post("/vote", { token: "guess", voter: "maker", ticket_id: "t1" });
  assert.equal(r.status, 403);
});

test("two matching votes refund exactly once", async () => {
  assert.equal((await vote("maker")).body.decision.action, "wait");
  const d = (await vote("checker")).body.decision;
  assert.equal(d.action, "refund");
  assert.equal(refunds.length, 1);
  assert.equal((await vote("checker")).status, 409, "a replayed vote is refused");
  assert.equal(refunds.length, 1);
});

test("disagreeing votes block with 1 of 2 keys", async () => {
  await vote("maker", { ticket_id: "t2", charge_id: "ch_big", amount_cents: 9000 });
  const d = (await vote("checker", { ticket_id: "t2" })).body.decision;
  assert.equal(d.action, "block");
  assert.equal(d.keys, 1);
});

test("over the cap needs the third key; only a valid HMAC turns it", async () => {
  await vote("maker", { ticket_id: "t3", charge_id: "ch_big", amount_cents: 9000 });
  assert.equal((await vote("checker", { ticket_id: "t3", charge_id: "ch_big", amount_cents: 9000 })).body.decision.action, "needs_human");
  assert.equal((await post("/admin/approve", { ticket_id: "t3", amount_cents: 9000, sig: "f".repeat(64) })).status, 403);
  const sig = createHmac("sha256", HMAC).update("t3:9000").digest("hex");
  const d = (await post("/admin/approve", { ticket_id: "t3", amount_cents: 9000, sig })).body.decision;
  assert.equal(d.action, "refund");
  assert.equal(d.keys, 3);
  assert.equal(refunds.length, 2);
});

test("state survives a restart (folded from the audit log)", async () => {
  await (globalThis as any).restart();
  const h = (await (await fetch(`${base}/health`)).json()) as { voters: string[] };
  assert.deepEqual(h.voters.sort(), ["checker", "maker"]);
  assert.equal((await vote("maker")).status, 409, "the vote ledger was replayed");
  assert.equal(refunds.length, 2);
});
