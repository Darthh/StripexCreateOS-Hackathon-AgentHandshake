import { h, icon, money, ago } from "./html.js";
import { netDiagram } from "./net.js";

const ROLES = {
  portal: ["Ticket portal", "Collects customer requests. Isolated from the private refund network.", "ticket"],
  worker: ["Orchestrator", "Schedules agent turns, supplies inputs, and records the decisions.", "workflow"],
  maker: ["Maker agent", "Reads the customer message and verifies the proposed refund with Python.", "pen-tool"],
  checker: ["Checker agent", "Independently checks structured ticket fields against the refund policy.", "scan-search"],
  vault: ["Refund vault", "Matches both votes, checks Stripe, and enforces the human approval cap.", "vault"],
  stripe: ["Stripe test mode", "Returns test refunds to the original payment method.", "credit-card"],
};

export function networkView(state, ctx) {
  const role = ctx.ui.node ?? "vault";
  const [name, description, glyph] = ROLES[role] ?? ROLES.vault;
  const box = state.boxes.find((b) => b.role === role);
  return h`<div class="network-stage"><div class="visual-caption"><span><span class="dot executed"></span>Private execution network</span><span>Click a node to inspect</span></div>${netDiagram(state, role)}</div>
    <div class="node-inspector"><span class="node-glyph">${icon(glyph)}</span><div><b>${name}</b><p>${description}</p></div><div class="node-facts"><span>${box ? box.status : role === "worker" || role === "stripe" ? "External service" : "Not created"}</span><span>${box?.egress === "127.0.0.1:9" ? "No internet egress" : box?.egress ?? "Managed connection"}</span></div><a class="btn sm" href="/lab/live" data-link>${icon("arrow-up-right")}Inspect lab</a></div>`;
}

export function activityBuckets(state, hours = 24) {
  const count = hours === 168 ? 7 : 12;
  const span = hours * 3600000;
  const now = Date.now();
  const step = span / count;
  return Array.from({ length: count }, (_, i) => {
    const start = now - span + i * step;
    const end = start + step;
    const tickets = state.tickets.filter((t) => { const at = new Date(t.updated_at ?? t.created_at).getTime(); return at >= start && at <= end; });
    return { label: new Date(end).toLocaleString([], hours === 168 ? { weekday: "short" } : { hour: "numeric" }), executed: tickets.filter((t) => t.status === "executed").reduce((sum, t) => sum + t.amount_cents, 0), blocked: tickets.filter((t) => t.status === "blocked").length, count: tickets.length };
  });
}

export function activityView(state, ctx) {
  const hours = ctx.ui.range === "7d" ? 168 : 24;
  const buckets = activityBuckets(state, hours);
  const selected = Math.min(ctx.ui.chartIndex ?? buckets.length - 1, buckets.length - 1);
  const max = Math.max(100, ...buckets.map((b) => b.executed));
  const width = 874;
  const x = (i) => 60 + i * (width - 95) / Math.max(1, buckets.length - 1);
  const y = (v) => 170 - v / max * 128;
  const line = buckets.map((b, i) => `${i ? "L" : "M"}${x(i)},${y(b.executed)}`).join(" ");
  const bucket = buckets[selected];
  return h`<div class="chart-summary"><div><span class="muted">Refund volume</span><strong>${money(buckets.reduce((n, b) => n + b.executed, 0))}</strong></div><div class="range-control">${["24h", "7d"].map((range) => h`<button data-range="${range}" aria-pressed="${(ctx.ui.range ?? "24h") === range}">${range === "24h" ? "24 hours" : "7 days"}</button>`)}</div></div>
    <svg class="activity-chart" viewBox="0 0 ${width} 205" role="group" aria-label="Executed refund volume over the selected period"><defs><linearGradient id="refund-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="var(--accent)" stop-opacity=".18"/><stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
      ${[42, 106, 170].map((lineY, i) => h`<line class="chart-grid" x1="55" x2="${width - 20}" y1="${lineY}" y2="${lineY}"/><text x="47" y="${lineY + 3}" text-anchor="end">${money(max * (1 - i / 2))}</text>`)}
      <path d="${line} L${x(buckets.length - 1)},170 L60,170 Z" fill="url(#refund-fill)"/><path class="chart-line" d="${line}"/>
      ${buckets.map((b, i) => h`<g><rect class="chart-hit" data-chart-index="${i}" role="button" tabindex="0" aria-label="${b.label}: ${money(b.executed)}, ${b.count} tickets" x="${x(i) - 30}" y="20" width="60" height="155"/><circle class="chart-dot ${selected === i ? "selected" : ""}" cx="${x(i)}" cy="${y(b.executed)}" r="${selected === i ? 5 : 3}"/><text x="${x(i)}" y="195" text-anchor="middle">${b.label}</text></g>`)}
    </svg><div class="chart-readout" aria-live="polite"><b>${bucket.label}</b><span><i class="legend-key"></i>${money(bucket.executed)} refunded</span><span>${bucket.count} tickets</span><span>${bucket.blocked} blocked</span></div>`;
}

export function voteView(state, ctx) {
  const statuses = [["executed", "Refunded", "var(--green)"], ["blocked", "Blocked", "var(--red)"], ["needs_human", "Needs approval", "var(--blue)"], ["voting", "In progress", "var(--violet)"]];
  const total = state.tickets.length;
  const counts = statuses.map(([status]) => state.tickets.filter((t) => t.status === status).length);
  const circumference = 2 * Math.PI * 61;
  let offset = 0;
  return h`<div class="vote-visual"><svg viewBox="0 0 180 180" class="vote-ring" role="img" aria-label="Ticket decision breakdown"><circle class="ring-base" cx="90" cy="90" r="61"/>${statuses.map(([, , color], i) => {
    const length = counts[i] / Math.max(1, total) * circumference;
    const segment = h`<circle cx="90" cy="90" r="61" fill="none" stroke="${color}" stroke-width="14" stroke-dasharray="${Math.max(0, length - 4)} ${circumference}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"/>`;
    offset += length;
    return counts[i] ? segment : "";
  })}<text x="90" y="88" text-anchor="middle" class="ring-total">${total}</text><text x="90" y="108" text-anchor="middle">tickets</text></svg><div class="vote-legend">${statuses.map(([status, label, color], i) => h`<button data-status="${status}" aria-pressed="${ctx.ui.status === status}"><span class="legend-key" style="background:${color}"></span><span>${label}</span><b>${counts[i]}</b>${icon("chevron-right")}</button>`)}</div></div>
    <div class="decision-list">${state.tickets.filter((t) => !ctx.ui.status || t.status === ctx.ui.status).slice(0, 3).map((t) => h`<a href="?ticket=${t.id}" data-link><span class="dot ${t.status}"></span><span>${t.reason_code.replace(/_/g, " ")}</span><b>${money(t.amount_cents)}</b><span class="muted">${ago(t.updated_at)}</span>${icon("arrow-up-right")}</a>`)}</div>`;
}
