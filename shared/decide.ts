// The vault's policy. Pure: no I/O, no clock, no crypto. The vault, the eval
// suite and the red team's proofs all call this same function.
//
// v1 ships with one deliberate gap: it never checks that the ticket's customer
// owns the charge. The red team is supposed to find it.

export type Voter = "maker" | "checker";

export type Vote = {
  voter: Voter;
  decision: "refund" | "refuse";
  ticket_id: string;
  charge_id: string;
  amount_cents: number;
  reason_code: string;
  evidence_hash: string;
  at: number; // ms epoch, stamped by the vault on receipt
};

// The vault's own Stripe lookup, never the agents' word.
export type Charge = {
  id: string;
  status: string;
  amount: number;
  amount_refunded: number;
  customer: string | null;
};

// Registered with the vault by the orchestrator from the structured ticket fields.
export type Ticket = { id: string; customer_id: string };

export type Policy = {
  cap_cents: number; // above this a human approval (third key) is required
  daily_limit_cents: number; // per requesting customer per UTC day
  vote_window_ms: number; // both votes must land within this window
};

export type Context = {
  now: number;
  approved: boolean; // a valid APPROVAL_HMAC_KEY signature is on file for this ticket
  customer_refunded_today_cents: number;
};

export type Decision = {
  action: "refund" | "block" | "wait" | "needs_human";
  reason: string;
  keys: 0 | 1 | 2 | 3;
};

export const DEFAULT_POLICY: Policy = {
  cap_cents: 5000,
  daily_limit_cents: 15000,
  vote_window_ms: 10 * 60 * 1000,
};

const MATCH_FIELDS = ["ticket_id", "charge_id", "amount_cents", "reason_code"] as const;

export function decide(
  votes: Vote[],
  charge: Charge | null,
  ticket: Ticket | null,
  policy: Policy,
  ctx: Context,
): Decision {
  if (!ticket) return { action: "block", reason: "ticket not registered with the vault", keys: 0 };
  const mine = votes.filter((v) => v.ticket_id === ticket.id);
  const maker = mine.find((v) => v.voter === "maker");
  const checker = mine.find((v) => v.voter === "checker");
  const yes = [maker, checker].filter((v) => v?.decision === "refund").length as 0 | 1 | 2;

  if (maker?.decision === "refuse" || checker?.decision === "refuse") {
    const who = [maker, checker].filter((v) => v?.decision === "refuse").map((v) => v!.voter);
    return { action: "block", reason: `${yes} of 2 keys: ${who.join(" and ")} refused`, keys: yes };
  }
  if (!maker || !checker) {
    const first = maker ?? checker;
    if (first && ctx.now - first.at > policy.vote_window_ms) {
      return { action: "block", reason: "1 of 2 keys: second vote never arrived", keys: 1 };
    }
    return { action: "wait", reason: `${yes} of 2 keys`, keys: yes };
  }

  for (const f of MATCH_FIELDS) {
    if (maker[f] !== checker[f]) {
      return { action: "block", reason: `votes disagree on ${f}: ${maker[f]} vs ${checker[f]}`, keys: 1 };
    }
  }
  if (Math.abs(maker.at - checker.at) > policy.vote_window_ms) {
    return { action: "block", reason: "votes more than 10 minutes apart", keys: 1 };
  }

  const amount = maker.amount_cents;
  if (!Number.isInteger(amount) || amount <= 0) {
    return { action: "block", reason: "amount must be a positive whole number of cents", keys: 2 };
  }
  if (!charge || charge.id !== maker.charge_id) {
    return { action: "block", reason: "charge not found in Stripe", keys: 2 };
  }
  if (charge.status !== "succeeded") {
    return { action: "block", reason: `charge status is ${charge.status}`, keys: 2 };
  }
  if (charge.amount - charge.amount_refunded < amount) {
    return { action: "block", reason: "not enough unrefunded amount on the charge", keys: 2 };
  }
  if (ctx.customer_refunded_today_cents + amount > policy.daily_limit_cents) {
    return { action: "block", reason: "customer's daily refund limit reached", keys: 2 };
  }
  if (amount > policy.cap_cents && !ctx.approved) {
    return { action: "needs_human", reason: `over the $${policy.cap_cents / 100} cap: needs a human (third key)`, keys: 2 };
  }
  return {
    action: "refund",
    reason: ctx.approved ? "3 of 3 keys: both agents agree and a human approved" : "2 of 2 keys: both agents agree",
    keys: ctx.approved ? 3 : 2,
  };
}
