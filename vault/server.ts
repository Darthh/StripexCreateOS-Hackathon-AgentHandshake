// The vault: deterministic Node, no AI. Holds the only Stripe key that can move money.
// Network callers (voter boxes on the lab network) may only POST /vote.
// /admin/* answers localhost only, i.e. the orchestrator via CreateOS exec, never the lab network.
// State is a fold over the append-only audit log, so a restart (or a merged patch) loses nothing.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { type Charge, DEFAULT_POLICY, type Decision, decide, type Ticket, type Vote, type Voter } from "../shared/decide.ts";

const DIR = process.env.VAULT_DIR ?? "/var/lib/vault";
const LOG = `${DIR}/audit.jsonl`;
const PORT = Number(process.env.PORT ?? 8080);
const STRIPE_API = process.env.STRIPE_API ?? "https://api.stripe.com"; // overridden only by the test's fake Stripe
mkdirSync(DIR, { recursive: true });

// Secrets come from a 0600 file written by bootstrap, not from the sandbox env.
const secrets = Object.fromEntries(
  readFileSync(`${DIR}/secrets.env`, "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const STRIPE_KEY: string = secrets.VAULT_STRIPE_KEY ?? "";
const HMAC_KEY: string = secrets.APPROVAL_HMAC_KEY ?? "";
if (!STRIPE_KEY.startsWith("rk_test_")) throw new Error("vault refuses to start: VAULT_STRIPE_KEY must be a test-mode restricted key (rk_test_)");
if (HMAC_KEY.length < 32) throw new Error("vault refuses to start: APPROVAL_HMAC_KEY missing");

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const DECIDE_SHA = sha256(readFileSync(new URL("../shared/decide.ts", import.meta.url), "utf8"));

// ---- state (rebuilt from the log) ----
type Event = { seq: number; at: number; kind: string; [k: string]: unknown };
const voters: Partial<Record<Voter, { sha: string; ip?: string }>> = {};
const tickets = new Map<string, Ticket>();
const votes = new Map<string, Vote[]>();
const approvals = new Set<string>();
const final = new Map<string, Decision>();
const refundedToday = new Map<string, number>(); // `${customer}:${yyyy-mm-dd}` -> cents
let seq = 0;

const day = (at: number) => new Date(at).toISOString().slice(0, 10);

function apply(e: Event) {
  seq = Math.max(seq, e.seq);
  if (e.kind === "voters") Object.assign(voters, e.voters);
  if (e.kind === "ticket") tickets.set(e.ticket_id as string, e.ticket as Ticket);
  if (e.kind === "vote") votes.set(e.ticket_id as string, [...(votes.get(e.ticket_id as string) ?? []), e.vote as Vote]);
  if (e.kind === "approve") approvals.add(e.ticket_id as string);
  if (e.kind === "decision") {
    const d = e.decision as Decision;
    if (d.action === "refund" || d.action === "block") final.set(e.ticket_id as string, d);
  }
  if (e.kind === "refund") {
    const k = `${e.customer}:${day(e.at)}`;
    refundedToday.set(k, (refundedToday.get(k) ?? 0) + (e.amount_cents as number));
  }
}

function log(kind: string, data: Record<string, unknown>) {
  const e: Event = { seq: seq + 1, at: Date.now(), kind, ...data };
  appendFileSync(LOG, `${JSON.stringify(e)}\n`);
  apply(e);
  return e;
}

if (existsSync(LOG)) for (const line of readFileSync(LOG, "utf8").split("\n")) if (line) apply(JSON.parse(line));

// ---- Stripe (fetch only; egress allows api.stripe.com:443 and nothing else) ----
async function stripe(method: "GET" | "POST", path: string, form?: Record<string, string>, idem?: string) {
  const res = await fetch(`${STRIPE_API}/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${STRIPE_KEY}`,
      ...(form && { "content-type": "application/x-www-form-urlencoded" }),
      ...(idem && { "idempotency-key": idem }),
    },
    body: form && new URLSearchParams(form),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`stripe ${res.status}: ${(body.error as { message?: string })?.message ?? "error"}`);
  return body;
}

async function lookupCharge(id: string): Promise<Charge | null> {
  if (!/^ch_\w+$/.test(id)) return null;
  try {
    const c = await stripe("GET", `charges/${id}`);
    return { id: c.id as string, status: c.status as string, amount: c.amount as number, amount_refunded: c.amount_refunded as number, customer: (c.customer as string) ?? null };
  } catch {
    return null;
  }
}

// ---- the decision ----
// ponytail: one global lock around evaluation; per-ticket locks if throughput ever matters.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
};

function evaluate(ticketId: string): Promise<Decision> {
  return serial(async () => {
    const done = final.get(ticketId);
    if (done) return done;
    const ticket = tickets.get(ticketId) ?? null;
    const vs = votes.get(ticketId) ?? [];
    const maker = vs.find((v) => v.voter === "maker");
    const checker = vs.find((v) => v.voter === "checker");
    const charge = maker && checker && maker.charge_id === checker.charge_id ? await lookupCharge(maker.charge_id) : null;
    const now = Date.now();
    const ctx = {
      now,
      approved: approvals.has(ticketId),
      customer_refunded_today_cents: ticket ? (refundedToday.get(`${ticket.customer_id}:${day(now)}`) ?? 0) : 0,
    };
    let d = decide(vs, charge, ticket, DEFAULT_POLICY, ctx);
    if (d.action === "refund" && maker && checker && ticket) {
      // Same vote pair -> same key, so a replayed pair can never refund twice.
      const idem = sha256(JSON.stringify([maker, checker].map(({ at: _at, ...v }) => v)));
      try {
        const r = await stripe(
          "POST",
          "refunds",
          { charge: maker.charge_id, amount: String(maker.amount_cents), reason: "requested_by_customer", "metadata[ticket_id]": ticketId },
          idem,
        );
        log("refund", { ticket_id: ticketId, refund_id: r.id, amount_cents: maker.amount_cents, charge_id: maker.charge_id, customer: ticket.customer_id, charge_customer: charge?.customer, idempotency_key: idem });
      } catch (err) {
        d = { action: "block", reason: `Stripe refused the refund: ${(err as Error).message}`, keys: d.keys };
      }
    }
    log("decision", {
      ticket_id: ticketId,
      decision: d,
      evidence: { maker: maker?.evidence_hash, checker: checker?.evidence_hash },
      decide_sha256: DECIDE_SHA,
      inputs: { votes: vs, charge, ticket, ctx }, // lets the eval suite replay this exact decision
    });
    return d;
  });
}

// ---- HTTP ----
const ipOf = (req: IncomingMessage) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
const isLocal = (req: IncomingMessage) => ["127.0.0.1", "::1"].includes(ipOf(req));
const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 16_384) throw new Error("body too large");
  }
  return JSON.parse(raw || "{}");
}
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function handleVote(req: IncomingMessage, res: ServerResponse) {
  const b = await readJson(req);
  const voter = b.voter as Voter;
  const ip = ipOf(req);
  const reject = (status: number, reason: string) => {
    log("vote_rejected", { voter, ticket_id: b.ticket_id, ip, reason });
    send(res, status, { ok: false, reason });
  };
  const reg = voters[voter];
  if (!reg || typeof b.token !== "string") return reject(403, "unknown voter");
  if (!safeEq(sha256(b.token), reg.sha)) return reject(403, "bad vote token");
  if (reg.ip && reg.ip !== ip) return reject(403, `vote from ${ip}, expected ${reg.ip}`);
  const ticketId = String(b.ticket_id ?? "");
  if (!tickets.has(ticketId)) return reject(404, "ticket not registered");
  if ((votes.get(ticketId) ?? []).some((v) => v.voter === voter)) return reject(409, "already voted on this ticket");
  if (b.decision !== "refund" && b.decision !== "refuse") return reject(400, "decision must be refund or refuse");
  const vote: Vote = {
    voter,
    decision: b.decision,
    ticket_id: ticketId,
    charge_id: String(b.charge_id ?? ""),
    amount_cents: Number(b.amount_cents),
    reason_code: String(b.reason_code ?? ""),
    evidence_hash: String(b.evidence_hash ?? ""),
    at: Date.now(),
  };
  log("vote", { ticket_id: ticketId, voter, ip, vote });
  send(res, 200, { ok: true, decision: await evaluate(ticketId) });
}

async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL) {
  const path = url.pathname;
  if (req.method === "GET" && path === "/admin/log") {
    const since = Number(url.searchParams.get("since") ?? 0);
    const lines = existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : [];
    return send(res, 200, lines.map((l) => JSON.parse(l)).filter((e: Event) => e.seq > since));
  }
  const b = await readJson(req);
  if (path === "/admin/voters") {
    // Only sha256(token) ever reaches the vault.
    log("voters", { voters: b.voters });
    return send(res, 200, { ok: true });
  }
  if (path === "/admin/ticket") {
    const t = b.ticket as Ticket;
    if (!t?.id || !t.customer_id) return send(res, 400, { ok: false, reason: "ticket needs id and customer_id" });
    if (tickets.has(t.id)) return send(res, 409, { ok: false, reason: "ticket already registered" });
    log("ticket", { ticket_id: t.id, ticket: { id: t.id, customer_id: t.customer_id } });
    return send(res, 200, { ok: true });
  }
  if (path === "/admin/approve") {
    const ticketId = String(b.ticket_id ?? "");
    const want = createHmac("sha256", HMAC_KEY).update(`${ticketId}:${b.amount_cents}`).digest("hex");
    if (!safeEq(String(b.sig ?? ""), want)) {
      log("approve_rejected", { ticket_id: ticketId, reason: "bad signature" });
      return send(res, 403, { ok: false, reason: "bad approval signature" });
    }
    const vs = votes.get(ticketId) ?? [];
    if (!vs.length || vs.some((v) => v.amount_cents !== Number(b.amount_cents))) {
      return send(res, 409, { ok: false, reason: "approval amount does not match the votes" });
    }
    log("approve", { ticket_id: ticketId, amount_cents: b.amount_cents });
    return send(res, 200, { ok: true, decision: await evaluate(ticketId) });
  }
  if (path === "/admin/reject") {
    const ticketId = String(b.ticket_id ?? "");
    if (final.has(ticketId)) return send(res, 409, { ok: false, reason: "ticket already decided" });
    const decision: Decision = { action: "block", reason: "a human rejected it (third key withheld)", keys: 2 };
    log("decision", { ticket_id: ticketId, decision, decide_sha256: DECIDE_SHA });
    return send(res, 200, { ok: true, decision });
  }
  if (path === "/admin/evaluate") return send(res, 200, { ok: true, decision: await evaluate(String(b.ticket_id)) });
  send(res, 404, { ok: false });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://vault");
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, seq, decide_sha256: DECIDE_SHA, policy: DEFAULT_POLICY, voters: Object.keys(voters) });
    }
    if (req.method === "POST" && url.pathname === "/vote") return await handleVote(req, res);
    if (url.pathname.startsWith("/admin/")) {
      if (!isLocal(req)) return send(res, 403, { ok: false, reason: "admin is localhost only" });
      return await handleAdmin(req, res, url);
    }
    send(res, 404, { ok: false });
  } catch (err) {
    send(res, 400, { ok: false, reason: (err as Error).message });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`vault listening on :${PORT} decide=${DECIDE_SHA.slice(0, 12)}`));
