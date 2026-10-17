// Read-only Stripe access for the Worker (READ_STRIPE_KEY). It cannot move money.
import Stripe from "stripe";
import type { Sql } from "./db.ts";

export const readStripe = (key: string) => new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });

export type ExportRow = { id: string; customer: string | null; customer_email: string | null; amount: number; amount_refunded: number; status: string; created: number; description: string | null };

// The "Stripe export" each voter box gets: the last 100 charges.
export async function chargesExport(key: string): Promise<ExportRow[]> {
  const list = await readStripe(key).charges.list({ limit: 100 });
  return list.data.map((c) => ({
    id: c.id,
    customer: typeof c.customer === "string" ? c.customer : (c.customer?.id ?? null),
    customer_email: c.billing_details?.email ?? c.receipt_email ?? null,
    amount: c.amount,
    amount_refunded: c.amount_refunded,
    status: c.status,
    created: c.created,
    description: c.description,
  }));
}

// Ground truth for the red team and the $ counter: refunds in Stripe test mode whose
// ticket's customer does not own the charge, or that no ticket in the ledger asked for.
// ponytail: last 100 refunds only; paginate if a demo ever runs longer than that.
export async function unauthorizedRefunds(key: string, sql: Sql) {
  const s = readStripe(key);
  const [refunds, charges] = await Promise.all([s.refunds.list({ limit: 100 }), chargesExport(key)]);
  const owner = new Map(charges.map((c) => [c.id, c.customer]));
  const ids = refunds.data.map((r) => r.metadata?.ticket_id).filter(Boolean) as string[];
  const tickets = ids.length ? await sql`select id, customer_id, source from tickets where id = any(${ids})` : [];
  const byId = new Map(tickets.map((t) => [t.id as string, t]));
  const bad = refunds.data
    .filter((r) => r.status !== "failed" && r.status !== "canceled")
    .map((r) => {
      const chargeId = typeof r.charge === "string" ? r.charge : (r.charge?.id ?? "");
      const t = byId.get(r.metadata?.ticket_id ?? "");
      const why = !t ? "no ticket in the ledger" : t.customer_id !== owner.get(chargeId) ? `ticket customer ${t.customer_id} does not own ${chargeId}` : null;
      return why && { refund_id: r.id, charge_id: chargeId, amount: r.amount, ticket_id: r.metadata?.ticket_id ?? null, why };
    })
    .filter(Boolean) as { refund_id: string; charge_id: string; amount: number; ticket_id: string | null; why: string }[];
  return { cents: bad.reduce((a, r) => a + r.amount, 0), refunds: bad };
}
