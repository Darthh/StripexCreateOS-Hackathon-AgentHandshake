// Page renderers. Each takes (state, ctx) and returns h`` markup.
import { ago, h, icon, money, uptime } from "./html.js";
import { activityView, networkView, voteView } from "./visuals.js";

export const STATUSES = [
  ["received", "Received"],
  ["waking", "Waking"],
  ["voting", "Voting"],
  ["executed", "Executed"],
  ["blocked", "Blocked"],
  ["needs_human", "Needs human"],
];
const label = Object.fromEntries(STATUSES);
const CAP = 5000;

// The only buttons that exist. Every one is admin-only.
export function btn(ctx, text, ic, act, args = {}, opts = {}) {
  const off = !ctx.admin || opts.disabled;
  const title = !ctx.admin ? "Sign in to manage this action" : opts.title || "";
  return h`<button class="btn ${opts.primary ? "primary" : ""} ${opts.danger ? "danger" : ""} ${opts.sm ? "sm" : ""}" data-act="${act}" data-args="${JSON.stringify(args)}" ${off ? "disabled" : ""} title="${title}">${icon(ic)}${text}</button>`;
}

const statusPill = (s) => h`<span class="pill ${{ executed: "green", blocked: "red", needs_human: "blue", voting: "violet", waking: "amber" }[s] ?? "gray"}"><span class="dot ${s}"></span>${label[s] ?? s}</span>`;
export const keysPill = (t) => {
  const need = t.amount_cents > CAP ? 3 : 2;
  const c = t.status === "executed" ? "green" : t.status === "blocked" ? "red" : t.status === "needs_human" ? "blue" : "gray";
  return h`<span class="pill ${c}" title="keys turned">${icon("key-round")}${t.keys ?? 0}/${need} keys</span>`;
};
const boxPill = (b) => {
  const c = b.role === "fork" ? "violet" : b.status === "running" ? "green" : b.status === "paused" ? "amber" : "gray";
  return h`<span class="pill ${c}">${b.role === "fork" ? "forked" : b.status}</span>`;
};
const proofMark = (p) => (!p ? h`<span class="muted" title="not checked yet">—</span>` : p.ok ? h`<span class="ok" title="${p.detail}">${icon("check")}</span>` : h`<span class="bad" title="${p.detail}">${icon("x")}</span>`);
const head = (title, sub, actions) => h`<div class="page-head"><div><h1>${title}</h1>${sub ? h`<p>${sub}</p>` : ""}</div><div class="actions">${actions}</div></div>`;
const empty = (text) => h`<div class="empty">${text}</div>`;
const isToday = (t) => new Date(t).toDateString() === new Date().toDateString();
const ticketTitle = (t) => `${t.reason_code.replace(/_/g, " ")} · ${money(t.amount_cents)}`;

function ticketRows(tickets) {
  if (!tickets.length) return empty("No tickets yet. New test ticket starts one.");
  return h`<div class="list">${tickets.map(
    (t) => h`<a href="?ticket=${t.id}" data-link><span class="dot ${t.status}"></span><span class="grow">${ticketTitle(t)} <span class="muted">· ${t.customer_email ?? t.customer_id}</span></span>${keysPill(t)}<span class="muted mono">${ago(t.created_at)}</span></a>`,
  )}</div>`;
}

export function boxesTable(state, ctx, boxes = state.boxes) {
  if (!boxes.length) return empty("No boxes yet. npm run bootstrap creates the vault; the first ticket creates the maker and checker.");
  return h`<div class="table-wrap"><table class="t"><thead><tr><th>Box</th><th>State</th><th>Network</th><th>Egress rule</th><th>Egress check</th><th>Uptime</th><th></th></tr></thead><tbody>
    ${boxes.map(
      (b) => h`<tr><td><b>${b.name}</b> <span class="muted mono">${b.id.slice(0, 14)}</span></td><td>${boxPill(b)}</td><td class="mono">${b.network}</td>
        <td class="mono">${b.egress === "127.0.0.1:9" ? "none (deny all)" : b.egress}</td><td>${proofMark(b.proof)}</td>
        <td class="mono">${b.status === "running" ? uptime(b.running_at) : "—"}</td>
        <td>${b.role === "portal" || b.role === "other" ? "" : b.status === "running" ? btn(ctx, "Pause", "pause", "pause", { id: b.id }, { sm: true }) : b.status === "paused" ? btn(ctx, "Resume", "play", "resume", { id: b.id }, { sm: true }) : ""}</td></tr>`,
    )}</tbody></table></div>`;
}

export function overview(state, ctx) {
  const today = state.tickets.filter((t) => isToday(t.created_at));
  const refunded = state.tickets.filter((t) => t.status === "executed" && isToday(t.updated_at)).reduce((a, t) => a + t.amount_cents, 0);
  const blocked = state.attacks.filter((a) => a.result_now === "blocked").length;
  const bad = state.unauthorized.cents;
  const panel = ctx.ui.panel ?? "network";
  const ready = state.boxes.filter((b) => b.status === "running").length;
  const waiting = state.tickets.filter((t) => t.status === "needs_human").length;
  const tabs = [["network", "Network flow", "network"], ["activity", "Refund activity", "chart-no-axes-combined"], ["votes", "Vote breakdown", "chart-pie"]];
  return h`<div class="workspace-home">
    <section class="request-hero" aria-labelledby="request-title"><div class="hero-eyebrow"><span class="hero-mark">${icon("handshake")}</span>Two agents. One verified decision.</div><h1 id="request-title">What should your agents verify?</h1><p>Turn a refund request into a decision you can inspect.</p>
      <form class="request-composer" data-form="quick-request"><textarea name="request" aria-label="Describe a test refund request" placeholder="A customer's mug arrived damaged. Verify the order and review a $24.50 refund…" rows="2">${ctx.ui.composerText ?? ""}</textarea><div class="composer-tools"><button type="button" class="round-button" data-act="new_ticket" aria-label="Choose a test scenario">${icon("plus")}</button><span class="composer-tag">${icon("credit-card")}Stripe test mode</span><span class="composer-tag">${icon("bot")}Maker + Checker</span><a class="composer-tag policy-link" href="/proof" data-link>${icon("sliders-horizontal")}Policy</a><button class="submit-request" type="submit" aria-label="Review refund request" ${ctx.admin ? "" : "disabled"}>${icon("arrow-up")}</button></div></form>
      <div class="suggestions">${state.scenarios.slice(0, 3).map((sc) => h`<button data-scenario="${sc.id}" ${ctx.admin ? "" : "disabled"}>${icon(sc.kind === "attack" ? "swords" : sc.fields?.amount_cents > 5000 ? "key-round" : "ticket")}${sc.name}${icon("arrow-up-right")}</button>`)}${!state.scenarios.length ? h`<span class="muted">Create a test ticket to see both agents at work.</span>` : ""}</div>
    </section>
    <section class="workspace-section"><div class="section-heading"><h2>Your workspace</h2><a href="/lab/live" data-link>View lab ${icon("chevron-right")}</a></div><div class="workspace-project"><span class="project-symbol">${icon("handshake")}</span><div class="project-info"><b>AgentHandshake</b><span>${icon("git-branch")}main <i>·</i> ${state.sample ? "Sample environment" : "CreateOS EU"}</span></div><span class="pill ${ready ? "green" : "gray"}"><span class="dot"></span>${ready ? `${ready} running` : "Not running"}</span><div class="project-quick-actions"><button data-panel="network" title="Inspect network" aria-label="Inspect network">${icon("network")}</button><button data-act="qr" ${ctx.admin ? "" : "disabled"} title="Show portal QR" aria-label="Show portal QR">${icon("qr-code")}</button><a href="/proof" data-link title="View isolation proof" aria-label="View isolation proof">${icon("shield-check")}</a></div></div>
    <div class="workspace-metrics"><div><span>Tickets today</span><strong>${today.length}<small>requests</small></strong></div><div><span>Refunds executed</span><strong>${money(refunded)}<small>test USD</small></strong></div><div><span>Attacks blocked</span><strong>${blocked}<small>verified cases</small></strong></div><div><span>Human approvals</span><strong>${waiting}<a href="/approvals" data-link>${waiting ? "Review queue ↗" : "all clear"}</a></strong></div></div></section>
    <section class="workspace-section visual-section" id="visualizations"><div class="section-heading"><div><h2>See how decisions happen</h2><p>Follow the evidence from request to refund.</p></div><span class="quiet-status"><span class="dot ${state.sample ? "voting" : "executed"}"></span>${state.sample ? "Sample visualization" : "Latest lab state"}</span></div><div class="visual-card"><div class="visual-toolbar"><div class="visual-tabs" role="tablist" aria-label="Visualization">${tabs.map(([value, name, glyph]) => h`<button role="tab" id="tab-${value}" aria-controls="visual-panel" aria-selected="${panel === value}" data-panel="${value}">${icon(glyph)}${name}</button>`)}</div><button class="icon-button" data-refresh aria-label="Refresh workspace" title="Refresh workspace">${icon("refresh-cw")}</button></div><div id="visual-panel" role="tabpanel" aria-labelledby="tab-${panel}">${panel === "activity" ? activityView(state, ctx) : panel === "votes" ? voteView(state, ctx) : networkView(state, ctx)}</div></div></section>
    <section class="workspace-section"><div class="section-heading"><h2>Recent requests</h2><a href="/tickets?view=list" data-link>All tickets ${icon("chevron-right")}</a></div><div class="card recent-card">${ticketRows(state.tickets.slice(0, 4))}</div></section>
    <section class="workspace-section"><div class="section-divider"><span>EXPLORE YOUR LAB</span></div><div class="explore-grid"><a class="explore-card" href="/red-team" data-link><span class="explore-icon">${icon("swords")}</span><h3>Challenge the agents</h3><p>Inspect attacks and review candidate fixes.</p><span class="explore-cta">Open red team ${icon("arrow-up-right")}</span></a><a class="explore-card" href="/eval" data-link><span class="explore-icon">${icon("flask-conical")}</span><h3>Check every decision</h3><p>Replay the cases that keep refunds in check.</p><span class="explore-cta">View evaluations ${icon("arrow-up-right")}</span></a><a class="explore-card" href="/audit" data-link><span class="explore-icon">${icon("scroll-text")}</span><h3>Follow the evidence</h3><p>Every vote, approval, and vault decision.</p><span class="explore-cta">Explore audit log ${icon("arrow-up-right")}</span></a></div></section>
    <footer class="workspace-note">${icon("lock-keyhole")}Stripe test mode. ${state.sample ? "All data on this page is illustrative; no services are changed." : "No real money moves."}${bad > 0 ? h`<span class="bad">${money(bad)} unauthorized in the current test ledger</span>` : ""}</footer>
  </div>`;
}

export function tickets(state, ctx) {
  const view = ctx.query.get("view") === "list" ? "list" : "board";
  const tabs = h`<div class="tabs"><a href="?view=board" data-link aria-current="${view === "board"}">Board</a><a href="?view=list" data-link aria-current="${view === "list"}">List</a></div>`;
  const live = state.tickets.filter((t) => t.lab === "live" || ctx.page === "tickets");
  const body =
    view === "board"
      ? h`<div class="board">${STATUSES.map(([s, name]) => {
          const ts = live.filter((t) => t.status === s);
          return h`<div class="col"><div class="col-head"><span class="dot ${s}"></span>${name}<span class="badge">${ts.length}</span></div><div class="col-body">${ts.map(
            (t) => h`<a class="tcard" href="?ticket=${t.id}&view=board" data-link><div class="top"><span class="mono">${t.id}</span><span style="margin-left:auto">${t.source}</span></div><div class="title">${ticketTitle(t)}</div>${keysPill(t)}</a>`,
          )}</div></div>`;
        })}</div>`
      : h`<div class="card">${ticketRows(live)}</div>`;
  return h`${head("Tickets", "Received → Waking → Voting → Executed / Blocked / Needs human", tabs)}${body}`;
}

export function approvals(state, ctx) {
  const q = state.tickets.filter((t) => t.status === "needs_human");
  return h`${head("Approvals", "Over the $50 cap, both agents agreeing is not enough. You are the third key: the Worker signs your approval and the vault verifies it.")}
  <div class="card">${
    q.length
      ? h`<div class="list">${q.map(
          (t) => h`<div class="item"><span class="dot needs_human"></span><a class="grow" href="?ticket=${t.id}" data-link>${ticketTitle(t)} <span class="muted">· ${t.customer_email ?? t.customer_id} · ${t.charge_id}</span></a>${btn(ctx, "Approve", "check", "approve", { ticketId: t.id }, { sm: true, primary: true })}${btn(ctx, "Reject", "x", "reject", { ticketId: t.id }, { sm: true, danger: true })}</div>`,
        )}</div>`
      : empty("Nothing waiting for a human.")
  }</div>`;
}

const diffView = (d) => h`<pre class="code diff">${d.split("\n").map((l) => h`<span class="${l[0] === "+" ? "add" : l[0] === "-" ? "del" : ""}">${l}</span>\n`)}</pre>`;

export function redTeam(state, ctx) {
  const session = state.audit.find((a) => a.kind === "redteam_session");
  const attacks = [...state.attacks].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const bad = state.unauthorized.cents;
  return h`${head("Red Team", "An agent attacks the system from its own sealed box. Ground truth is Stripe, never the agent's claims.", btn(ctx, "Run red team", "swords", "run_redteam", {}, { primary: true }))}
  <div class="stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
    <div class="card stat ${bad > 0 ? "alarm" : ""}"><div class="label">${icon("siren")}$ unauthorized (from Stripe)</div><div class="value">${money(bad)}</div></div>
    <div class="card stat"><div class="label">${icon("crosshair")}Attacks tried</div><div class="value">${attacks.length}</div></div>
    <div class="card stat"><div class="label">${icon("git-pull-request")}Patches ready</div><div class="value">${state.patches.filter((p) => p.status === "ready").length}</div></div>
  </div>
  <div class="grid two">
    <div class="card"><div class="card-head">${icon("activity")}Attack timeline</div>${
      attacks.length
        ? h`<div class="list">${attacks.map(
            (a) => h`<div class="item"><span class="dot ${a.result_now === "succeeded" ? "blocked" : a.result_now === "blocked" ? "executed" : "received"}"></span><span class="grow">${a.name} <span class="muted">· ${a.source}</span></span><span class="pill ${a.result_now === "succeeded" ? "red" : a.result_now === "blocked" ? "green" : "gray"}">${a.result_now ?? "pending"}</span></div>`,
          )}</div>`
        : empty("No attacks yet.")
    }</div>
    <div class="card"><div class="card-head">${icon("terminal")}Latest session<span class="sub">attack scripts the agent wrote and ran</span></div><div class="card-body steps">${
      session ? (session.data.steps ?? []).slice(-12).map(stepView) : empty("Run red team to start a session.")
    }</div></div>
  </div>
  <h2 style="font-size:15px;margin:22px 0 10px">Patches</h2>
  <div class="grid">${
    state.patches.length
      ? state.patches.map(
          (p) => h`<div class="card"><div class="card-head">${icon("git-merge")}${p.title}<span class="pill ${p.status === "ready" ? "green" : p.status === "merged" ? "violet" : p.status === "lost" ? "gray" : "amber"}">${p.status}</span><span class="right">${btn(ctx, "Merge patch", "git-merge", "merge_patch", { patchId: p.id }, { disabled: !(p.status === "ready" && p.suite_passed), title: "Enabled when the regression suite passes" })}</span></div>
          <div class="card-body grid">
            ${p.race ? h`<div class="row wrap muted">${icon("flag")}Race: ${p.race.passed ? h`<span class="ok">suite passed</span>` : h`<span class="bad">suite failed</span>`} · ${p.race.total ?? 0} cases, ${p.race.failed ?? 0} failed · ran in ${p.race.ran_in ?? "?"}</div>` : h`<div class="muted">Waiting for the patch race…</div>`}
            ${diffView(p.diff)}
          </div></div>`,
        )
      : h`<div class="card">${empty("When an attack works, candidate patches to decide() show up here, raced in forks.")}</div>`
  }</div>`;
}

function stepView(s) {
  if (s.kind === "code") return h`<div><div class="step-label">${icon("code")}code it ran</div><pre class="code">${s.body}</pre></div>`;
  if (s.kind === "output") return h`<div><div class="step-label">${icon("square-terminal")}output · exit ${s.exit_code}</div><pre class="code out">${s.body || "(no output)"}</pre></div>`;
  if (s.kind === "tool") return h`<div class="step-label">${icon("send")}<span class="mono">${s.body}</span></div>`;
  return h`<div class="muted">${s.body}</div>`;
}

export function evalSuite(state, ctx) {
  const a = state.attacks;
  const last = state.audit.find((x) => x.kind === "eval_run");
  return h`${head("Eval Suite", "Every attack, seeded, found by the red team or submitted through the portal, becomes a case expecting no unauthorized refund.", btn(ctx, "Re-run all", "refresh-cw", "rerun_all", {}, { primary: true }))}
  <div class="stats">
    <div class="card stat"><div class="label">Attacks tried</div><div class="value">${a.length}</div></div>
    <div class="card stat"><div class="label">Succeeded before patches</div><div class="value">${a.filter((x) => x.result_before === "succeeded").length}</div></div>
    <div class="card stat"><div class="label">Succeed now</div><div class="value">${a.filter((x) => x.result_now === "succeeded").length}</div></div>
    <div class="card stat ${state.unauthorized.cents > 0 ? "alarm" : ""}"><div class="label">$ unauthorized</div><div class="value">${money(state.unauthorized.cents)}</div></div>
  </div>
  <div class="card"><div class="card-head">${icon("flask-conical")}Cases${last ? h`<span class="sub">last run ${ago(last.at)} in ${last.data.ran_in}: ${last.data.passed ? "all passed" : "failures"}</span>` : ""}</div>
  ${
    a.length
      ? h`<div class="table-wrap"><table class="t"><thead><tr><th>Attack</th><th>Source</th><th>Before patches</th><th>Now</th></tr></thead><tbody>${a.map(
          (x) => h`<tr><td>${x.name}</td><td><span class="pill gray">${x.source}</span></td><td>${res(x.result_before)}</td><td>${res(x.result_now)}</td></tr>`,
        )}</tbody></table></div>`
      : empty("No cases yet.")
  }</div>`;
}
const res = (r) => (r ? h`<span class="pill ${r === "succeeded" ? "red" : "green"}">${r === "succeeded" ? "refund went through" : "blocked"}</span>` : h`<span class="muted">pending</span>`);

export function evidence(state, ctx) {
  const open = ctx.ui.forkFiles;
  return h`${head("Evidence Locker", "When the votes disagree, the maker is paused and forked: a frozen copy of the fooled agent's workspace. The live maker continues clean.")}
  <div class="card">${
    state.forks.length
      ? h`<div class="table-wrap"><table class="t"><thead><tr><th>Fork</th><th>Ticket</th><th>Reason</th><th>Created</th><th></th></tr></thead><tbody>${state.forks.map(
          (f) => h`<tr class="click" data-open-fork="${f.id}"><td class="mono">${f.sandbox_id}</td><td><a href="?ticket=${f.ticket_id}" data-link class="mono">${f.ticket_id}</a></td><td>${f.reason}</td><td class="mono">${ago(f.created_at)}</td><td>${btn(ctx, "Destroy fork", "trash-2", "destroy_fork", { forkId: f.id }, { sm: true, danger: true })}</td></tr>`,
        )}</tbody></table></div>`
      : empty("No forks yet. The prompt-injection ticket creates one.")
  }</div>
  ${open ? h`<div class="card" style="margin-top:16px"><div class="card-head">${icon("folder-open")}Frozen workspace <span class="sub mono">${open.id}</span></div><div class="card-body"><pre class="code">${open.files ?? "Loading… (resuming the fork)"}</pre></div></div>` : ctx.admin ? "" : h`<p class="muted" style="margin-top:12px">Sign in to open a frozen workspace.</p>`}`;
}

export function auditLog(state, ctx) {
  const ticket = ctx.query.get("ticket_filter") ?? "";
  const box = ctx.query.get("box") ?? "";
  const tickets = [...new Set(state.audit.map((a) => a.ticket_id).filter(Boolean))];
  const boxes = [...new Set(state.audit.map((a) => a.box).filter(Boolean))];
  const rows = state.audit.filter((a) => (!ticket || a.ticket_id === ticket) && (!box || a.box === box));
  const summary = (a) => {
    const d = a.data ?? {};
    if (a.kind === "vault:vote") return `${d.voter} voted ${d.vote?.decision} ${d.vote?.charge_id ?? ""} ${money(d.vote?.amount_cents)} from ${d.ip}`;
    if (a.kind === "vault:decision") return `${d.decision?.action}: ${d.decision?.reason}`;
    if (a.kind === "vault:refund") return `refund ${d.refund_id} ${money(d.amount_cents)} (idempotency ${String(d.idempotency_key).slice(0, 12)}…)`;
    if (a.kind === "vault:vote_rejected") return `rejected ${d.voter ?? "?"} from ${d.ip}: ${d.reason}`;
    if (a.kind === "egress_proof") return `${d.ok ? "✓" : "✗"} ${d.detail}`;
    return JSON.stringify(d).slice(0, 160);
  };
  return h`${head("Audit Log", "Every vote and decision, with both agents' evidence hashes.", h`
    <select data-filter="ticket_filter" aria-label="Filter by ticket"><option value="">All tickets</option>${tickets.map((t) => h`<option ${t === ticket ? "selected" : ""}>${t}</option>`)}</select>
    <select data-filter="box" aria-label="Filter by box"><option value="">All boxes</option>${boxes.map((b) => h`<option ${b === box ? "selected" : ""}>${b}</option>`)}</select>`)}
  <div class="card">${
    rows.length
      ? h`<div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Kind</th><th>Ticket</th><th>Box</th><th>Detail</th></tr></thead><tbody>${rows.map(
          (a) => h`<tr><td class="mono muted">${ago(a.at)}</td><td class="mono">${a.kind}</td><td class="mono">${a.ticket_id ?? ""}</td><td>${a.box ?? ""}</td><td>${summary(a)}</td></tr>`,
        )}</tbody></table></div>`
      : empty("Nothing logged yet.")
  }</div>`;
}

const SECRETS = [
  ["VAULT_STRIPE_KEY", "the only key that can move money", "only inside the vault box (0600 file), injected by bootstrap from the operator's machine. Cloudflare and GitHub never hold it."],
  ["READ_STRIPE_KEY", "read-only restricted key", "Cloudflare Worker secret"],
  ["CreateOS key", "sandbox control plane (EU)", "Cloudflare Worker secret"],
  ["Model key", "OpenRouter, via Stripe Projects", "Cloudflare Worker secret"],
  ["DATABASE_URL", "Neon Postgres, via Stripe Projects", "Cloudflare Worker secret"],
  ["APPROVAL_HMAC_KEY", "the human third key", "the Worker signs, the vault verifies; nowhere else"],
  ["Vote tokens", "one per voter box", "generated at box creation, passed once into its env; the vault gets only sha256. Agent code runs as another user and cannot read it."],
  ["sk_test key", "full test secret key", "operator's machine only (.env.local), for seed and reset"],
];

export function proof(state, ctx) {
  const n = state.boxes.length;
  return h`${head("Proof", "Enforced by infrastructure, not prompts.")}
  <div class="grid two">
    <div class="card"><div class="card-head">${icon("shield")}Egress checks<span class="sub">each box tries HTTPS, plain HTTP and DNS</span></div>${
      state.boxes.length
        ? h`<div class="list">${state.boxes.map((b) => h`<div class="item">${proofMark(b.proof)}<span class="grow"><b>${b.name}</b> <span class="muted">${b.proof?.detail ?? "not checked yet"}</span></span><span class="mono muted">${b.egress === "127.0.0.1:9" ? "deny all" : b.egress}</span></div>`)}</div>`
        : empty("No boxes yet.")
    }</div>
    <div class="card"><div class="card-head">${icon("gauge")}Boxes vs plan</div><div class="card-body">
      <div class="row" style="justify-content:space-between;margin-bottom:8px"><span>${n} of ${state.plan_limit} sandboxes</span><span class="muted">paused boxes count</span></div>
      <div class="meter ${n >= state.plan_limit ? "full" : ""}"><span style="--fill:${Math.min(1, n / Math.max(1, state.plan_limit))}"></span></div>
      <p class="muted" style="margin:12px 0 0">Shadow lab: ${state.lab.shadow ? "on" : "off (SHADOW_LAB=false)"} · model: <span class="mono">${state.lab.model}</span></p>
    </div></div>
  </div>
  <div class="card" style="margin-top:16px"><div class="card-head">${icon("key-round")}Secrets map<span class="sub">one money key, one box</span></div><div class="table-wrap"><table class="t"><thead><tr><th>Secret</th><th>What</th><th>Lives</th></tr></thead><tbody>${SECRETS.map(
    ([k, w, where]) => h`<tr><td class="mono"><b>${k}</b></td><td>${w}</td><td>${where}</td></tr>`,
  )}</tbody></table></div></div>
  <div class="card" style="margin-top:16px"><div class="card-head">${icon("package")}Stripe Projects status<span class="sub">everything provisioned with stripe projects add</span></div>${
    state.projects.length
      ? h`<div class="table-wrap"><table class="t"><thead><tr><th>Provider</th><th>Service</th><th>Pricing</th><th>Status</th></tr></thead><tbody>${state.projects.map(
          (p) => h`<tr><td>${p.provider}</td><td class="mono">${p.service}</td><td>${p.pricing}</td><td><span class="pill ${p.status === "complete" ? "green" : "amber"}">${p.status}</span></td></tr>`,
        )}</tbody></table></div>`
      : empty("Run npm run secrets:sync to publish the status snapshot.")
  }</div>`;
}

export function labPage(state, ctx, which) {
  const shadow = which === "shadow";
  const boxes = state.boxes.filter((b) => (shadow ? b.role.startsWith("shadow") : !b.role.startsWith("shadow") && b.role !== "fork" && b.role !== "other"));
  const ts = state.tickets.filter((t) => t.lab === which);
  const sub = shadow
    ? state.lab.shadow
      ? "Forks of the maker, checker and vault on a separate network with new vote tokens. The red team only ever attacks the shadow."
      : "Shadow lab is off on this plan (SHADOW_LAB=false): the red team attacks the live lab directly."
    : "The real refund path: portal, maker, checker and vault.";
  const actions = shadow ? "" : h`${btn(ctx, "Show portal QR", "qr-code", "qr")}${btn(ctx, "Reset demo", "rotate-ccw", "reset_demo", {}, { danger: true })}`;
  return h`${head(shadow ? "Shadow lab" : "Live lab", sub, actions)}
  <div class="card"><div class="card-head">${icon("boxes")}Boxes</div>${boxesTable(state, ctx, boxes)}</div>
  <div class="card" style="margin-top:16px"><div class="card-head">${icon("list")}Tickets in this lab</div>${ticketRows(ts)}</div>
  ${state.lab.queue.length ? h`<div class="card" style="margin-top:16px"><div class="card-head">${icon("list-ordered")}Orchestrator queue<span class="sub">${state.lab.current ?? "idle"}</span></div><div class="list">${state.lab.queue.map((j) => h`<div class="item"><span class="mono">${j.type}</span><span class="grow muted mono">${j.ticketId ?? ""}</span><span class="muted mono">${j.at > Date.now() ? `in ${Math.round((j.at - Date.now()) / 1000)}s` : "ready"}</span></div>`)}</div></div>` : ""}`;
}

export function ticketDrawer(state, t) {
  const decision = t.decision;
  const ev = state.audit.find((a) => a.ticket_id === t.id && a.kind === "vault:decision")?.data?.evidence ?? {};
  const agent = (name, rec, note) => h`<div class="card"><div class="card-head">${icon(name === "maker" ? "pen-tool" : "scan-search")}${name === "maker" ? "Maker" : "Checker"}<span class="sub">${note}</span>${
    rec?.vote ? h`<span class="right pill ${rec.vote.decision === "refund" ? "green" : "red"}">${rec.vote.decision}</span>` : ""
  }</div><div class="card-body steps">
    ${rec?.vote ? h`<dl class="kv mono"><dt>charge</dt><dd>${rec.vote.charge_id}</dd><dt>amount</dt><dd>${money(rec.vote.amount_cents)}</dd><dt>reason</dt><dd>${rec.vote.reason_code}</dd><dt>why</dt><dd>${rec.vote.rationale}</dd></dl>` : h`<div class="muted">${t.status === "voting" ? "Working…" : "No vote."}</div>`}
    ${(rec?.steps ?? []).map(stepView)}
  </div></div>`;
  return h`<div class="drawer-head"><span class="dot ${t.status}"></span><b class="mono">${t.id}</b>${statusPill(t.status)}${keysPill(t)}<a class="close" href="?" data-link data-close>Close · Esc</a></div>
  <div class="drawer-body">
    <dl class="kv">
      <dt>Customer</dt><dd>${t.customer_email ?? ""} <span class="mono muted">${t.customer_id}</span></dd>
      <dt>Order</dt><dd><a class="mono" href="https://dashboard.stripe.com/test/payments/${t.charge_id}" target="_blank" rel="noopener">${t.charge_id} ↗</a></dd>
      <dt>Amount</dt><dd>${money(t.amount_cents)} · ${t.reason_code}</dd>
      <dt>Source</dt><dd>${t.source} · ${t.lab} lab · ${ago(t.created_at)}</dd>
      ${t.free_text ? h`<dt>Free text</dt><dd><span class="muted">(only the maker sees this)</span><pre class="code out" style="margin-top:4px">${t.free_text}</pre></dd>` : ""}
    </dl>
    <div class="card"><div class="card-head">${icon("vault")}Vault decision</div><div class="card-body"><dl class="kv">
      <dt>Action</dt><dd>${decision ? h`<b>${decision.action}</b>` : h`<span class="muted">pending</span>`}</dd>
      <dt>Reason</dt><dd>${decision?.reason ?? ""}</dd>
      <dt>Maker evidence</dt><dd class="mono">${ev.maker ?? "—"}</dd>
      <dt>Checker evidence</dt><dd class="mono">${ev.checker ?? "—"}</dd>
      ${t.refund_id ? h`<dt>Refund</dt><dd><a class="mono" href="https://dashboard.stripe.com/test/payments/${t.charge_id}" target="_blank" rel="noopener">${t.refund_id} in Stripe test ↗</a></dd>` : ""}
    </dl></div></div>
    <div class="agents">${agent("maker", t.maker, "sees free text")}${agent("checker", t.checker, "structured fields + policy.md only")}</div>
  </div>`;
}
