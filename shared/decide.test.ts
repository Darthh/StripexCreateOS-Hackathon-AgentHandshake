import assert from "node:assert/strict";
import { test } from "node:test";
import { type Charge, type Context, DEFAULT_POLICY, decide, type Vote } from "./decide.ts";

const now = 1_000_000_000;
const ticket = { id: "t1", customer_id: "cus_A" };
const charge: Charge = { id: "ch_1", status: "succeeded", amount: 4000, amount_refunded: 0, customer: "cus_A" };
const ctx: Context = { now, approved: false, customer_refunded_today_cents: 0 };
const vote = (voter: Vote["voter"], over: Partial<Vote> = {}): Vote => ({
  voter,
  decision: "refund",
  ticket_id: "t1",
  charge_id: "ch_1",
  amount_cents: 4000,
  reason_code: "damaged",
  evidence_hash: "h",
  at: now,
  ...over,
});
const run = (votes: Vote[], c: Charge | null = charge, x: Partial<Context> = {}) =>
  decide(votes, c, ticket, DEFAULT_POLICY, { ...ctx, ...x });

test("two matching votes refund", () => {
  assert.deepEqual(run([vote("maker"), vote("checker")]), { action: "refund", reason: "2 of 2 keys: both agents agree", keys: 2 });
});

test("one vote waits, then times out", () => {
  assert.equal(run([vote("maker")]).action, "wait");
  assert.equal(run([vote("maker")], charge, { now: now + 11 * 60_000 }).action, "block");
});

test("checker refusal blocks with 1 of 2 keys", () => {
  const d = run([vote("maker"), vote("checker", { decision: "refuse" })]);
  assert.equal(d.action, "block");
  assert.equal(d.keys, 1);
  assert.match(d.reason, /^1 of 2 keys/);
});

test("any field mismatch blocks", () => {
  for (const over of [{ amount_cents: 3999 }, { charge_id: "ch_2" }, { reason_code: "x" }, { ticket_id: "t1", at: now + 11 * 60_000 }]) {
    assert.equal(run([vote("maker"), vote("checker", over)]).action, "block", JSON.stringify(over));
  }
});

test("stripe is ground truth", () => {
  const v = [vote("maker"), vote("checker")];
  assert.equal(run(v, null).action, "block");
  assert.equal(run(v, { ...charge, status: "pending" }).action, "block");
  assert.equal(run(v, { ...charge, amount_refunded: 1000 }).action, "block");
});

test("over the cap needs a human; approval makes it 3 keys", () => {
  const big = { ...charge, amount: 9000 };
  const v = [vote("maker", { amount_cents: 9000 }), vote("checker", { amount_cents: 9000 })];
  assert.equal(run(v, big).action, "needs_human");
  assert.deepEqual(run(v, big, { approved: true }).keys, 3);
});

test("daily limit blocks", () => {
  assert.equal(run([vote("maker"), vote("checker")], charge, { customer_refunded_today_cents: 12000 }).action, "block");
});

test("non-positive or fractional amounts block", () => {
  for (const a of [0, -100, 10.5]) {
    assert.equal(run([vote("maker", { amount_cents: a }), vote("checker", { amount_cents: a })]).action, "block");
  }
});

test("v1 gap: ownership is not checked (the red team should find this)", () => {
  const someoneElses = { ...charge, customer: "cus_B" };
  assert.equal(run([vote("maker"), vote("checker")], someoneElses).action, "refund");
});
