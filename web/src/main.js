import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/app.css";
import "./styles/workspace.css";
import {
  Activity, Banknote, Boxes, Check, Code, Crosshair, FlaskConical, Flag, FolderOpen, Gauge, GitMerge, GitPullRequest, KeyRound,
  LayoutDashboard, List, ListOrdered, Network, Package, PenTool, Pause, Play, Plus, QrCode, RefreshCw, RotateCcw, ScanSearch,
  ScrollText, Search, Send, Handshake, Shield, ShieldCheck, Siren, SquareTerminal, Swords, Terminal, Ticket, Trash2, Vault, X, FlaskRound,
  Bot, Workflow, CreditCard, ArrowUpRight, ArrowUp, ChevronRight, ChartNoAxesCombined, ChartPie, SlidersHorizontal, GitBranch, LockKeyhole, Sun, Moon, Monitor, PanelLeftClose, PanelLeftOpen, CircleHelp,
  createIcons,
} from "lucide";
import qrcode from "qrcode-generator";
import { h, icon, raw } from "./html.js";
import { pulse } from "./net.js";
import * as P from "./pages.js";
import { demoState } from "./demo.js";

const ICONS = { Activity, Banknote, Boxes, Check, Code, Crosshair, FlaskConical, Flag, FolderOpen, Gauge, GitMerge, GitPullRequest, KeyRound, LayoutDashboard, List, ListOrdered, Network, Package, PenTool, Pause, Play, Plus, QrCode, RefreshCw, RotateCcw, ScanSearch, ScrollText, Search, Send, Handshake, Shield, ShieldCheck, Siren, SquareTerminal, Swords, Terminal, Ticket, Trash2, Vault, X, FlaskRound, Bot, Workflow, CreditCard, ArrowUpRight, ArrowUp, ChevronRight, ChartNoAxesCombined, ChartPie, SlidersHorizontal, GitBranch, LockKeyhole, Sun, Moon, Monitor, PanelLeftClose, PanelLeftOpen, CircleHelp };

const ROUTES = {
  "/": ["Overview", "layout-dashboard", P.overview],
  "/tickets": ["Tickets", "ticket", P.tickets],
  "/approvals": ["Approvals", "key-round", P.approvals],
  "/red-team": ["Red Team", "swords", P.redTeam],
  "/eval": ["Eval Suite", "flask-conical", P.evalSuite],
  "/evidence": ["Evidence Locker", "vault", P.evidence],
  "/audit": ["Audit Log", "scroll-text", P.auditLog],
  "/proof": ["Proof", "shield-check", P.proof],
  "/lab/live": ["Live lab", "flask-round", (s, c) => P.labPage(s, c, "live")],
  "/lab/shadow": ["Shadow lab", "flask-round", (s, c) => P.labPage(s, c, "shadow")],
};
const MAIN_NAV = ["/", "/tickets", "/approvals", "/red-team", "/eval", "/evidence", "/audit", "/proof"];

const DEMO = new URLSearchParams(location.search).get("demo") === "1";
let theme = "system";
try { theme = localStorage.getItem("agenthandshake-theme") ?? "system"; } catch {}
function applyTheme(choice) {
  theme = choice;
  document.documentElement.dataset.theme = choice === "system" ? matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" : choice;
  try { localStorage.setItem("agenthandshake-theme", choice); } catch {}
}
applyTheme(theme);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (theme === "system") applyTheme("system"); });
const store = { state: DEMO ? demoState() : null, error: null, admin: DEMO, live: false, ui: { modal: null, forkFiles: null, palette: null, panel: "network", node: "vault", range: "24h", collapsed: false }, shown: {} };
const app = document.getElementById("app");

// ---------- data ----------
async function refresh() {
  if (DEMO) return render();
  try {
    const r = await fetch("/api/state", { credentials: "same-origin" });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 140)}`);
    store.state = await r.json();
    store.error = null;
  } catch (e) {
    store.error = e.message;
  }
  render();
}
let timer;
const soon = (ms = 400) => {
  clearTimeout(timer);
  timer = setTimeout(refresh, ms);
};

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/live`);
  ws.onopen = () => setLive(true);
  ws.onclose = () => {
    setLive(false);
    setTimeout(connect, 2500);
  };
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "vote") {
      pulse(e.voter, "vault", e.decision === "refuse" ? "refuse" : "");
      return soon(1100); // let the pulse finish before re-rendering the diagram
    }
    if (e.type === "decision" && e.status === "executed") pulse("vault", "stripe");
    if (e.type === "error") toast(e.message, true);
    soon(e.type === "decision" ? 1000 : 400);
  };
}
function setLive(on) {
  store.live = on;
  document.querySelector(".live")?.classList.toggle("on", on);
  const t = document.querySelector(".live span:last-child");
  if (t) t.textContent = on ? "Live" : "Reconnecting";
}

// ---------- actions ----------
async function act(name, args = {}) {
  if (name === "qr") return openQr();
  if (name === "new_ticket" && !args.submit) return openModal("ticket");
  if (DEMO) {
    if (name === "portal") return { note: "Sample workspace: the live portal is not started." };
    if (name === "new_ticket") {
      const scenario = store.state.scenarios.find((s) => s.id === args.scenarioId);
      const fields = scenario?.fields ?? args;
      const sample = structuredClone(store.state.tickets[0]);
      Object.assign(sample, fields, { id: `tk_sample_${Date.now().toString(36)}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), source: "sample", status: scenario?.kind === "attack" ? "blocked" : fields.amount_cents > 5000 ? "needs_human" : "executed", free_text: args.free_text ?? "Sample refund request" });
      sample.keys = sample.status === "blocked" ? 1 : 2;
      sample.decision = { action: sample.status === "executed" ? "refund" : sample.status === "blocked" ? "block" : "needs_human", reason: "Sample outcome for interface exploration; no Stripe request was sent." };
      store.state.tickets.unshift(sample);
    } else if (["approve", "reject"].includes(name)) {
      const ticket = store.state.tickets.find((t) => t.id === args.ticketId);
      if (ticket) { ticket.status = name === "approve" ? "executed" : "blocked"; ticket.keys = name === "approve" ? 3 : 2; ticket.decision = { action: name === "approve" ? "refund" : "block", reason: `Sample human ${name === "approve" ? "approval" : "rejection"}; no Stripe request was sent.` }; ticket.updated_at = new Date().toISOString(); }
    } else if (["pause", "resume"].includes(name)) {
      const box = store.state.boxes.find((b) => b.id === args.id);
      if (box) box.status = name === "pause" ? "paused" : "running";
    } else if (name === "rerun_all") {
      store.state.audit.unshift({ id: Date.now(), at: new Date().toISOString(), kind: "eval_run", data: { passed: true, ran_in: "sample replay", results: store.state.attacks.length } });
    } else if (name === "merge_patch") {
      const patch = store.state.patches.find((p) => p.id === args.patchId);
      if (patch) patch.status = "merged";
    } else if (name === "reset_demo") {
      store.state = demoState();
    } else if (name === "run_redteam") {
      store.state.attacks.unshift({ id: `atk_sample_${Date.now()}`, name: "Sample forged vote attempt", source: "sample", result_before: "blocked", result_now: "blocked" });
    }
    render(); toast("Sample workspace updated. No cloud services or payments were changed.");
    return { ok: true };
  }
  if (name === "reset_demo" && !confirm("Reset the demo? This clears tickets and the audit log, and rotates the vault ledger.")) return;
  const { submit: _s, ...body } = args;
  try {
    const r = await fetch(`/api/admin/${name}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, reason: `HTTP ${r.status}` }));
    if (!j.ok) throw new Error(j.reason || "failed");
    toast(j.note ?? `${name.replace(/_/g, " ")}: done`);
    soon(150);
    return j;
  } catch (e) {
    toast(e.message, true);
  }
}

async function openQr() {
  await act("portal");
  openModal("qr");
}

function toast(text, error = false) {
  const box = document.querySelector(".toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = `toast ${error ? "error" : ""}`;
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), error ? 7000 : 3500);
}

// ---------- routing ----------
const path = () => (ROUTES[location.pathname] ? location.pathname : "/");
function go(href) {
  const u = new URL(href, location.href);
  const changedPage = u.pathname !== location.pathname;
  if (u.search === "?" || u.search === "") u.search = "";
  if (DEMO) u.searchParams.set("demo", "1");
  history.pushState(null, "", u.pathname + u.search);
  render();
  if (changedPage) document.querySelector(".content")?.scrollTo(0, 0);
}
addEventListener("popstate", render);

// ---------- palette ----------
function commands() {
  const s = store.state;
  const nav = Object.entries(ROUTES).map(([p, [name, ic]]) => ({ name: `Go to ${name}`, ic, run: () => go(p) }));
  const buttons = [
    ["New test ticket", "plus", "new_ticket"],
    ["Show portal QR", "qr-code", "qr"],
    ["Run red team", "swords", "run_redteam"],
    ["Re-run all", "refresh-cw", "rerun_all"],
    ["Reset demo", "rotate-ccw", "reset_demo"],
  ].map(([name, ic, a]) => ({ name, ic, admin: true, run: () => act(a) }));
  const per = [];
  for (const t of s?.tickets.filter((t) => t.status === "needs_human") ?? []) {
    per.push({ name: `Approve ${t.id}`, ic: "check", admin: true, run: () => act("approve", { ticketId: t.id }) });
    per.push({ name: `Reject ${t.id}`, ic: "x", admin: true, run: () => act("reject", { ticketId: t.id }) });
  }
  for (const p of s?.patches.filter((p) => p.status === "ready" && p.suite_passed) ?? []) per.push({ name: `Merge patch: ${p.title}`, ic: "git-merge", admin: true, run: () => act("merge_patch", { patchId: p.id }) });
  for (const b of s?.boxes ?? []) {
    if (b.role === "portal") continue;
    if (b.status === "running") per.push({ name: `Pause ${b.name}`, ic: "pause", admin: true, run: () => act("pause", { id: b.id }) });
    if (b.status === "paused") per.push({ name: `Resume ${b.name}`, ic: "play", admin: true, run: () => act("resume", { id: b.id }) });
  }
  for (const f of s?.forks ?? []) per.push({ name: `Destroy fork ${f.sandbox_id}`, ic: "trash-2", admin: true, run: () => act("destroy_fork", { forkId: f.id }) });
  const tickets = (s?.tickets ?? []).slice(0, 20).map((t) => ({ name: `Open ticket ${t.id} · ${t.reason_code} · $${(t.amount_cents / 100).toFixed(2)}`, ic: "ticket", run: () => go(`${location.pathname}?ticket=${t.id}`) }));
  return [...buttons, ...per, ...nav, ...tickets];
}
function openPalette() {
  store.ui.palette = { q: "", i: 0 };
  render();
  document.querySelector(".palette input")?.focus();
}
function paletteItems() {
  const q = store.ui.palette.q.toLowerCase();
  return commands().filter((c) => c.name.toLowerCase().includes(q));
}

// ---------- modals ----------
function openModal(kind) {
  store.ui.modal = kind;
  render();
  document.querySelector(".modal input, .modal select, .modal textarea")?.focus();
}
function closeOverlays() {
  store.ui.modal = null;
  store.ui.palette = null;
  render();
}

function modalView(enterCls = "") {
  const s = store.state;
  if (store.ui.modal === "qr") {
    if (DEMO) return h`<div class="scrim ${enterCls}" data-close></div><div class="modal ${enterCls}" role="dialog" aria-modal="true" aria-label="Portal preview"><div class="card-head">${icon("qr-code")}Customer portal preview<button class="icon-button close" data-close aria-label="Close portal preview">${icon("x")}</button></div><div class="card-body"><p class="muted">The connected workspace creates a public ticket form and a shareable QR code. This sample workspace does not start a public service.</p><div class="field"><label for="portal-sample">Customer message</label><textarea id="portal-sample" readonly>My mug arrived damaged. Please review my $24.50 refund request.</textarea></div><button class="btn primary" data-act="new_ticket">${icon("ticket")}Explore a sample ticket</button></div></div>`;
    const url = `${location.origin}/try`;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return h`<div class="scrim ${enterCls}" data-close></div><div class="modal ${enterCls}" role="dialog" aria-modal="true" aria-label="Portal QR code"><div class="card-head">${icon("qr-code")}Try it: file a refund ticket<a class="close" data-close>Esc</a></div>
      <div class="qr">${raw(qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true }))}<div class="mono">${url}</div><div class="muted">${s?.portal_url ? "Opens the public portal box." : "The portal box is starting; give it a minute."}</div></div></div>`;
  }
  if (store.ui.modal === "ticket") {
    const sc = s?.scenarios ?? [];
    return h`<div class="scrim ${enterCls}" data-close></div><form class="modal ${enterCls}" role="dialog" aria-modal="true" aria-label="New test ticket" data-form="ticket">
      <div class="card-head">${icon("plus")}New test ticket<a class="close" data-close>Esc</a></div>
      <div class="card-body">
        ${sc.length ? h`<div class="scenarios">${sc.map((x, i) => h`<label class="scenario"><input type="radio" name="scenario" value="${x.id}" ${i === 0 && !store.ui.requestDraft ? "checked" : ""}><span class="grow">${x.name}</span><span class="pill ${x.kind === "attack" ? "red" : "gray"}">${x.kind}</span></label>`)}<label class="scenario"><input type="radio" name="scenario" value="custom" ${store.ui.requestDraft ? "checked" : ""}><span class="grow">Custom ticket</span></label></div>` : h`<p class="muted">Create a custom test ticket.</p>`}
        <div class="custom">
          <div class="field"><label for="f-cus">Customer id</label><input id="f-cus" name="customer_id" placeholder="cus_..."></div>
          <div class="field"><label for="f-ch">Charge id</label><input id="f-ch" name="charge_id" placeholder="ch_..."></div>
          <div class="field"><label for="f-amt">Amount (cents)</label><input id="f-amt" name="amount_cents" type="number" min="1"></div>
          <div class="field"><label for="f-rc">Reason</label><select id="f-rc" name="reason_code"><option>damaged</option><option>not_delivered</option><option>duplicate_charge</option><option>wrong_item</option></select></div>
          <div class="field"><label for="f-tx">Free text (only the maker sees it)</label><textarea id="f-tx" name="free_text">${store.ui.requestDraft ?? ""}</textarea></div>
        </div>
        <button class="btn primary" type="submit">${icon("plus")}New test ticket</button>
      </div></form>`;
  }
  return "";
}

function paletteView(enterCls = "") {
  const items = paletteItems();
  const i = Math.min(store.ui.palette.i, Math.max(0, items.length - 1));
  return h`<div class="scrim ${enterCls}" data-close></div><div class="modal palette ${enterCls}" role="dialog" aria-modal="true" aria-label="Command palette">
    <input placeholder="Type a command or search…" value="${store.ui.palette.q}" aria-label="Command" data-palette>
    <ul role="listbox">${items.slice(0, 40).map((c, k) => h`<li role="option" data-cmd="${k}" aria-selected="${k === i}" class="${c.admin && !store.admin ? "off" : ""}">${icon(c.ic)}${c.name}${c.admin && !store.admin ? h`<span class="hint">admin only</span>` : ""}</li>`)}</ul></div>`;
}

// ---------- render ----------
function render() {
  const focusAttr = ["data-panel", "data-theme-choice", "data-node", "data-range", "data-status", "data-chart-index"].find((attr) => document.activeElement?.hasAttribute(attr));
  const focusValue = focusAttr ? document.activeElement.getAttribute(focusAttr) : null;
  const p = path();
  const [title, , page] = ROUTES[p];
  const query = new URLSearchParams(location.search);
  const s = store.state;
  const ctx = { admin: store.admin, query, page: p.slice(1), ui: store.ui };
  const open = s?.tickets.filter((t) => !["executed", "blocked"].includes(t.status)).length ?? 0;
  const waiting = s?.tickets.filter((t) => t.status === "needs_human").length ?? 0;
  const badge = { "/tickets": open, "/approvals": waiting };
  const navLink = (href) => {
    const [name, ic] = ROUTES[href];
    const b = badge[href];
    return h`<a href="${href}" data-link aria-label="${name}${b ? ` (${b})` : ""}" title="${name}" aria-current="${p === href ? "page" : "false"}">${icon(ic)}<span>${name}</span>${b ? h`<span class="badge ${href === "/approvals" ? "hot" : ""}">${b}</span>` : ""}</a>`;
  };
  const ticket = query.get("ticket") && s?.tickets.find((t) => t.id === query.get("ticket"));
  // Re-renders replace the DOM: animate overlays only when they first open, keep scroll positions.
  const enter = (key, value) => {
    const fresh = value && store.shown[key] !== value;
    store.shown[key] = value || null;
    return fresh ? "enter" : "";
  };
  const drawerIn = enter("drawer", ticket?.id);
  const modalIn = enter("modal", store.ui.modal);
  const paletteIn = enter("palette", store.ui.palette ? "open" : null);
  const scroll = { content: document.querySelector(".content")?.scrollTop ?? 0, drawer: document.querySelector(".drawer-body")?.scrollTop ?? 0 };
  const body = store.error && !s
    ? h`<section class="offline-workspace"><span class="offline-symbol">${icon("network")}</span><h1>Your workspace is waiting</h1><p>We couldn't reach the execution lab. Reconnect to see live decisions, or explore the interface with clearly labeled sample data.</p><div><button class="btn primary" data-refresh>${icon("refresh-cw")}Try again</button><a class="btn" href="/?demo=1">Explore sample workspace ${icon("arrow-up-right")}</a></div></section>`
    : !s
      ? h`<div class="stats">${[1, 2, 3, 4].map(() => h`<div class="skel block" style="height:82px"></div>`)}</div><div class="skel block"></div><div class="skel line"></div><div class="skel line" style="width:60%"></div>`
      : page(s, ctx);

  app.innerHTML = String(h`<a class="skip-link" href="#content">Skip to workspace</a><div class="shell ${store.ui.collapsed ? "sidebar-collapsed" : ""}">
    <aside class="sidebar">
      <div class="brand-row"><a class="brand" href="/" data-link><span class="brand-mark">${icon("handshake")}</span><span>AgentHandshake</span></a><button class="icon-button collapse-button" data-collapse aria-label="${store.ui.collapsed ? "Expand sidebar" : "Collapse sidebar"}">${icon(store.ui.collapsed ? "panel-left-open" : "panel-left-close")}</button></div>
      <button class="sidebar-new" data-act="new_ticket" aria-label="New test request" title="New test request" ${store.admin ? "" : "disabled"}>${icon("plus")}<span>New test request</span></button>
      <nav class="nav" aria-label="Main">${MAIN_NAV.map(navLink)}
        <div class="nav-group">Execution</div>${navLink("/lab/live")}${navLink("/lab/shadow")}
      </nav>
      <div class="sidebar-foot">
        <a class="sidebar-help" href="https://github.com/Darthh/StripexCreateOS-Hackathon-AgentHandshake#readme" target="_blank" rel="noopener">${icon("circle-help")}<span>Help & documentation</span>${icon("arrow-up-right")}</a>
        <div class="capacity-card"><div><b>${s?.boxes.length ?? 0} <span>/ ${s?.plan_limit ?? "—"}</span></b><span>Sandbox capacity</span></div><div class="capacity-track"><i style="--capacity:${Math.min(100, (s?.boxes.length ?? 0) / Math.max(1, s?.plan_limit ?? 1) * 100)}%"></i></div><a href="/lab/live" data-link>View execution lab</a></div>
        <div class="theme-switch" role="group" aria-label="Color theme">${[["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "monitor", "System"]].map(([choice, glyph, label]) => h`<button data-theme-choice="${choice}" aria-label="${label} mode" aria-pressed="${theme === choice}" title="${label} mode">${icon(glyph)}<span>${label}</span></button>`)}</div>
        <div class="workspace-account"><span class="account-avatar">AH</span><div><b>${DEMO ? "Demo workspace" : "Hackathon workspace"}</b>${store.admin ? h`<span>${DEMO ? "Sample data · local controls" : "Signed in as admin"}</span>` : h`<a class="signin" href="/api/admin/login">Sign in to manage</a>`}</div>${icon("chevron-right")}</div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="crumbs">${p === "/" ? h`<b>Agent workspace</b>` : h`<a href="/" data-link>Workspace</a>${icon("chevron-right")}<b>${title}</b>`}${ticket ? h`<span>/</span><span class="mono">${ticket.id}</span>` : ""}</div>
        <button class="search" data-open-palette aria-label="Open command palette">${icon("search")}<span>Search workspace</span><kbd>⌘ K</kbd></button>
        <span class="live ${store.live ? "on" : ""}" aria-live="polite"><span class="dot"></span><span>${DEMO ? "Sample data" : store.live ? "Connected" : "Offline"}</span></span>
        <div class="header-segment"><a href="/" data-link aria-current="${p === "/" && store.ui.panel === "network" ? "page" : "false"}">Workspace</a><button data-show-visuals>Visualizations</button></div>
      </header>
      <main class="content" id="content">${body}</main>
    </div>
  </div>
  ${ticket ? h`<div class="scrim ${drawerIn}" data-link-close></div><aside class="drawer ${drawerIn}" role="dialog" aria-modal="true" aria-label="Ticket ${ticket.id}">${P.ticketDrawer(s, ticket)}</aside>` : ""}
  ${store.ui.modal ? modalView(modalIn) : ""}
  ${store.ui.palette ? paletteView(paletteIn) : ""}
  <div class="toasts" aria-live="polite"></div>`);
  createIcons({ icons: ICONS, attrs: { "aria-hidden": "true" } });
  const c = document.querySelector(".content");
  if (c) c.scrollTop = scroll.content;
  const d = document.querySelector(".drawer-body");
  if (d) d.scrollTop = scroll.drawer;
  if (focusAttr) document.querySelector(`[${focusAttr}="${CSS.escape(focusValue)}"]`)?.focus({ preventScroll: true });
  if (store.ui.palette) {
    const input = document.querySelector("[data-palette]");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const t = e.target;
  const themeChoice = t.closest("[data-theme-choice]");
  if (themeChoice) { applyTheme(themeChoice.dataset.themeChoice); return render(); }
  if (t.closest("[data-collapse]")) { store.ui.collapsed = !store.ui.collapsed; return render(); }
  if (t.closest("[data-refresh]")) return refresh();
  if (t.closest("[data-show-visuals]")) { if (path() !== "/") go("/"); document.getElementById("visualizations")?.scrollIntoView({ behavior: "smooth" }); return; }
  const panel = t.closest("[data-panel]");
  if (panel) { store.ui.panel = panel.dataset.panel; render(); if (panel.closest(".project-quick-actions")) document.getElementById("visualizations")?.scrollIntoView({ behavior: "smooth" }); return; }
  const node = t.closest("[data-node]");
  if (node) { store.ui.node = node.dataset.node; return render(); }
  const range = t.closest("[data-range]");
  if (range) { store.ui.range = range.dataset.range; store.ui.chartIndex = undefined; return render(); }
  const status = t.closest("[data-status]");
  if (status) { store.ui.status = store.ui.status === status.dataset.status ? null : status.dataset.status; return render(); }
  const chart = t.closest("[data-chart-index]");
  if (chart) { store.ui.chartIndex = Number(chart.dataset.chartIndex); return render(); }
  const scenario = t.closest("[data-scenario]");
  if (scenario && !scenario.disabled) return act("new_ticket", { scenarioId: scenario.dataset.scenario, submit: true });
  const link = t.closest("a[data-link]");
  if (link && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    return go(link.getAttribute("href"));
  }
  if (t.closest("[data-link-close]")) return go(location.pathname);
  if (t.closest("[data-close]")) return closeOverlays();
  if (t.closest("[data-open-palette]")) return openPalette();
  const b = t.closest("button[data-act]");
  if (b && !b.disabled) return act(b.dataset.act, JSON.parse(b.dataset.args || "{}"));
  const cmd = t.closest("[data-cmd]");
  if (cmd) {
    const c = paletteItems()[Number(cmd.dataset.cmd)];
    store.ui.palette = null;
    if (c && (!c.admin || store.admin)) c.run();
    else render();
    return;
  }
  const fork = t.closest("[data-open-fork]");
  if (fork && store.admin && !t.closest("button")) {
    store.ui.forkFiles = { id: fork.dataset.openFork };
    render();
    const r = await act("fork_files", { forkId: fork.dataset.openFork });
    store.ui.forkFiles = { id: fork.dataset.openFork, files: r?.files ?? (r?.pending ? `Fork is ${r.status}; try again in a few seconds.` : "Could not open the fork.") };
    render();
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.matches("[data-form=quick-request]")) {
    e.preventDefault();
    store.ui.requestDraft = new FormData(e.target).get("request");
    return openModal("ticket");
  }
  const f = e.target.closest("[data-form=ticket]");
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  const args = d.scenario && d.scenario !== "custom" ? { scenarioId: d.scenario } : { customer_id: d.customer_id, charge_id: d.charge_id, amount_cents: Number(d.amount_cents), reason_code: d.reason_code, free_text: d.free_text };
  store.ui.modal = null;
  render();
  act("new_ticket", { ...args, submit: true });
});

document.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-filter]");
  if (!sel) return;
  const q = new URLSearchParams(location.search);
  sel.value ? q.set(sel.dataset.filter, sel.value) : q.delete(sel.dataset.filter);
  go(`${location.pathname}?${q}`);
});

document.addEventListener("input", (e) => {
  if (e.target.matches("[data-form=quick-request] textarea")) { store.ui.composerText = e.target.value; return; }
  if (!e.target.matches("[data-palette]")) return;
  store.ui.palette = { q: e.target.value, i: 0 };
  render();
});

document.addEventListener("pointerover", (e) => {
  const point = e.target.closest("[data-chart-index]");
  if (!point || store.ui.chartIndex === Number(point.dataset.chartIndex)) return;
  store.ui.chartIndex = Number(point.dataset.chartIndex);
  render();
});

document.addEventListener("keydown", (e) => {
  if (["ArrowLeft", "ArrowRight"].includes(e.key) && e.target.matches("[role=tab][data-panel]")) {
    e.preventDefault();
    const panels = ["network", "activity", "votes"];
    store.ui.panel = panels[(panels.indexOf(store.ui.panel) + (e.key === "ArrowRight" ? 1 : 2)) % panels.length];
    render(); document.querySelector(`[role=tab][data-panel="${store.ui.panel}"]`)?.focus(); return;
  }
  if (["Enter", " "].includes(e.key) && e.target.matches("[data-node], [data-chart-index]")) { e.preventDefault(); return e.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return store.ui.palette ? closeOverlays() : openPalette();
  }
  if (e.key === "Escape") {
    if (store.ui.palette || store.ui.modal) return closeOverlays();
    if (new URLSearchParams(location.search).get("ticket")) return go(location.pathname);
  }
  if (store.ui.palette && ["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) {
    e.preventDefault();
    const items = paletteItems();
    if (e.key === "Enter") {
      const c = items[Math.min(store.ui.palette.i, items.length - 1)];
      store.ui.palette = null;
      if (c && (!c.admin || store.admin)) c.run();
      else render();
      return;
    }
    store.ui.palette.i = Math.max(0, Math.min(items.length - 1, store.ui.palette.i + (e.key === "ArrowDown" ? 1 : -1)));
    render();
  }
  if (e.key === "Enter" && e.target.matches("[data-open-palette]")) openPalette();
});

// ---------- boot ----------
render();
if (!DEMO) fetch("/api/me", { credentials: "same-origin" })
  .then((r) => r.json())
  .then((m) => {
    store.admin = !!m.admin;
    render();
  })
  .catch(() => {});
refresh();
if (!DEMO) {
  connect();
  setInterval(refresh, 15000);
}
