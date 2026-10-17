import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/app.css";
import {
  Activity, Banknote, Boxes, Check, Code, Crosshair, FlaskConical, Flag, FolderOpen, Gauge, GitMerge, GitPullRequest, KeyRound,
  LayoutDashboard, List, ListOrdered, Network, Package, PenTool, Pause, Play, Plus, QrCode, RefreshCw, RotateCcw, ScanSearch,
  ScrollText, Search, Send, Shield, ShieldCheck, Siren, SquareTerminal, Swords, Terminal, Ticket, Trash2, Vault, X, FlaskRound,
  createIcons,
} from "lucide";
import qrcode from "qrcode-generator";
import { h, icon, raw } from "./html.js";
import { pulse } from "./net.js";
import * as P from "./pages.js";

const ICONS = { Activity, Banknote, Boxes, Check, Code, Crosshair, FlaskConical, Flag, FolderOpen, Gauge, GitMerge, GitPullRequest, KeyRound, LayoutDashboard, List, ListOrdered, Network, Package, PenTool, Pause, Play, Plus, QrCode, RefreshCw, RotateCcw, ScanSearch, ScrollText, Search, Send, Shield, ShieldCheck, Siren, SquareTerminal, Swords, Terminal, Ticket, Trash2, Vault, X, FlaskRound };

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

const store = { state: null, error: null, admin: false, live: false, ui: { modal: null, forkFiles: null, palette: null }, shown: {} };
const app = document.getElementById("app");

// ---------- data ----------
async function refresh() {
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
  if (u.search === "?" || u.search === "") u.search = "";
  history.pushState(null, "", u.pathname + u.search);
  render();
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
        ${sc.length ? h`<div class="scenarios">${sc.map((x, i) => h`<label class="scenario"><input type="radio" name="scenario" value="${x.id}" ${i === 0 ? "checked" : ""}><span class="grow">${x.name}</span><span class="pill ${x.kind === "attack" ? "red" : "gray"}">${x.kind}</span></label>`)}<label class="scenario"><input type="radio" name="scenario" value="custom" ${sc.length ? "" : "checked"}><span class="grow">Custom ticket</span></label></div>` : h`<p class="muted">No seeded scenarios yet (npm run seed). Custom ticket:</p>`}
        <div class="custom">
          <div class="field"><label for="f-cus">Customer id</label><input id="f-cus" name="customer_id" placeholder="cus_..."></div>
          <div class="field"><label for="f-ch">Charge id</label><input id="f-ch" name="charge_id" placeholder="ch_..."></div>
          <div class="field"><label for="f-amt">Amount (cents)</label><input id="f-amt" name="amount_cents" type="number" min="1"></div>
          <div class="field"><label for="f-rc">Reason</label><select id="f-rc" name="reason_code"><option>damaged</option><option>not_delivered</option><option>duplicate_charge</option><option>wrong_item</option></select></div>
          <div class="field"><label for="f-tx">Free text (only the maker sees it)</label><textarea id="f-tx" name="free_text"></textarea></div>
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
    return h`<a href="${href}" data-link aria-current="${p === href ? "page" : "false"}">${icon(ic)}<span>${name}</span>${b ? h`<span class="badge ${href === "/approvals" ? "hot" : ""}">${b}</span>` : ""}</a>`;
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
    ? h`<div class="card"><div class="empty">Could not load the lab state: <span class="mono">${store.error}</span><br>Run <span class="mono">npm run bootstrap</span> and <span class="mono">npm run secrets:sync</span>, then deploy.</div></div>`
    : !s
      ? h`<div class="stats">${[1, 2, 3, 4].map(() => h`<div class="skel block" style="height:82px"></div>`)}</div><div class="skel block"></div><div class="skel line"></div><div class="skel line" style="width:60%"></div>`
      : page(s, ctx);

  app.innerHTML = String(h`<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/" data-link><span class="brand-mark">2K</span>Two-Key</a>
      <nav class="nav" aria-label="Main">${MAIN_NAV.map(navLink)}
        <div class="nav-group">Labs</div>${navLink("/lab/live")}${navLink("/lab/shadow")}
      </nav>
      <div class="sidebar-foot">
        ${store.admin ? h`<span class="signin">Signed in as admin</span>` : h`<a class="signin" href="/api/admin/login">Admin sign-in</a>`}
        <span class="pill-foot"><span class="dot"></span>Stripe test mode · CreateOS EU</span>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="crumbs"><span>Two-Key</span><span>/</span><b>${title}</b>${ticket ? h`<span>/</span><span class="mono">${ticket.id}</span>` : ""}</div>
        <div class="search" data-open-palette role="button" tabindex="0" aria-label="Open command palette">${icon("search")}<span>Search or run…</span><kbd>⌘K</kbd></div>
        <span class="live ${store.live ? "on" : ""}" aria-live="polite"><span class="dot"></span><span>${store.live ? "Live" : "Reconnecting"}</span></span>
        ${P.btn(ctx, "New test ticket", "plus", "new_ticket", {}, { primary: true })}
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
  if (store.ui.palette) {
    const input = document.querySelector("[data-palette]");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const t = e.target;
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
  if (!e.target.matches("[data-palette]")) return;
  store.ui.palette = { q: e.target.value, i: 0 };
  render();
});

document.addEventListener("keydown", (e) => {
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
fetch("/api/me", { credentials: "same-origin" })
  .then((r) => r.json())
  .then((m) => {
    store.admin = !!m.admin;
    render();
  })
  .catch(() => {});
refresh();
connect();
setInterval(refresh, 15000);
