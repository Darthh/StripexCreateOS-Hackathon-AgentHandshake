// Explicit sample workspace. Never presented as live infrastructure or Stripe data.
export function demoState() {
  const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const vote = (role, amount, decision = "refund") => ({ vote: { decision, charge_id: "ch_demo_mug", amount_cents: amount, reason_code: "damaged", rationale: `${role} verified the synthetic charge and requested amount.` }, turns: 3, evidence_runs: 2, steps: [
    { kind: "code", at: at(8), body: "import json\ncharge = json.load(open('charges.json'))[0]\nassert charge['status'] == 'succeeded'\nprint('Verified:', charge['id'])" },
    { kind: "output", at: at(8), body: "Verified: ch_demo_mug", exit_code: 0 },
  ] });
  const ticket = (id, status, amount, reason, minutes, keys = 2) => ({ id, lab: "live", source: "sample", customer_id: "cus_sample", customer_email: "demo@example.com", charge_id: "ch_demo_mug", amount_cents: amount, reason_code: reason, free_text: "Sample ticket for exploring the interface. No payment will be made.", status, keys, created_at: at(minutes + 2), updated_at: at(minutes), maker: vote("Maker", amount), checker: vote("Checker", amount, status === "blocked" ? "refuse" : "refund"), decision: { action: status === "executed" ? "refund" : status === "blocked" ? "block" : status === "needs_human" ? "needs_human" : "wait", reason: status === "blocked" ? "Checker refused: proposal does not match the structured request." : status === "needs_human" ? "Over the $50 cap: waiting for your approval." : "Both agents agree on the verified refund." }, refund_id: status === "executed" ? "re_sample" : null });
  const tickets = [ticket("tk_demo_mug", "executed", 2450, "damaged", 4), ticket("tk_demo_cap", "needs_human", 8900, "damaged", 12), ticket("tk_demo_injection", "blocked", 4500, "wrong_item", 28, 1), ticket("tk_demo_delivery", "executed", 3999, "not_delivered", 49), ticket("tk_demo_duplicate", "executed", 1599, "duplicate_charge", 81), ticket("tk_demo_active", "voting", 1299, "wrong_item", 1, 1)];
  return {
    sample: true, boxes: ["portal", "maker", "checker", "vault", "attacker"].map((role, i) => ({ id: `sb_sample_${role}`, name: role, role, status: role === "attacker" ? "paused" : "running", network: role === "portal" ? "none" : "handshake-lab", egress: role === "vault" ? "api.stripe.com:443" : "127.0.0.1:9", running_at: at(45 + i), created_at: at(80), proof: { ok: true, detail: "Sample egress check: expected connections blocked", at: at(35) } })),
    tickets, audit: tickets.map((t, i) => ({ id: i + 1, at: t.updated_at, ticket_id: t.id, box: "vault", kind: "vault:decision", data: { decision: t.decision, evidence: { maker: "sample-maker-evidence", checker: "sample-checker-evidence" } } })),
    attacks: [{ id: "atk_sample", name: "Free-text order substitution", source: "sample", result_before: "succeeded", result_now: "blocked", unauthorized_cents: 0 }],
    patches: [{ id: "patch_sample", title: "Validate charge ownership", target: "shared/decide.ts", diff: "+ if (charge.customer !== ticket.customer_id) return { action: 'block' };", status: "ready", suite_passed: true, race: { passed: true, total: 7, failed: 0, ran_in: "sample replay" } }],
    forks: [], scenarios: [
      { id: "sc_mug", name: "Damaged mug", kind: "legit", fields: { customer_id: "cus_sample", charge_id: "ch_demo_mug", amount_cents: 2450, reason_code: "damaged" } },
      { id: "sc_injection", name: "Prompt injection", kind: "attack", fields: { customer_id: "cus_sample", charge_id: "ch_demo_mug", amount_cents: 4500, reason_code: "wrong_item" } },
      { id: "sc_approval", name: "Over the approval cap", kind: "legit", fields: { customer_id: "cus_sample", charge_id: "ch_demo_mug", amount_cents: 8900, reason_code: "damaged" } },
    ], unauthorized: { cents: 0, refunds: [] }, portal_url: null, plan_limit: 5, projects: [{ provider: "CreateOS", service: "Sandbox", pricing: "Sample", status: "complete" }, { provider: "Stripe", service: "Test mode", pricing: "Sample", status: "complete" }],
    lab: { shadow: false, model: "Sample model activity", queue: [], current: null, error: null }, policy: "Sample workspace. No cloud services or payments are changed.",
  };
}
