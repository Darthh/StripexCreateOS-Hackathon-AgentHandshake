// Live network diagram: portal -> Worker -> maker/checker -> vault -> Stripe.
import { h } from "./html.js";

const NODES = [
  { id: "portal", label: "Portal", x: 20, y: 93, w: 118 },
  { id: "worker", label: "Worker · Lab", x: 176, y: 93, w: 128 },
  { id: "maker", label: "Maker", x: 348, y: 22, w: 118 },
  { id: "checker", label: "Checker", x: 348, y: 164, w: 118 },
  { id: "vault", label: "Vault", x: 512, y: 93, w: 118 },
  { id: "stripe", label: "Stripe test", x: 668, y: 93, w: 92 },
];
const H = 46;
const at = (id) => NODES.find((n) => n.id === id);
const right = (n) => [n.x + n.w, n.y + H / 2];
const left = (n) => [n.x, n.y + H / 2];
const curve = (a, b) => {
  const [x1, y1] = right(at(a));
  const [x2, y2] = left(at(b));
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
};
export const EDGES = [
  ["portal", "worker"],
  ["worker", "maker"],
  ["worker", "checker"],
  ["maker", "vault"],
  ["checker", "vault"],
  ["vault", "stripe"],
];

export function netDiagram(state) {
  const box = (role) => state.boxes.find((b) => b.role === role);
  const waking = state.tickets.some((t) => t.status === "waking" && t.lab === "live");
  const sub = (id) => {
    if (id === "worker") return state.lab.current ? state.lab.current.slice(0, 18) : "idle";
    if (id === "stripe") return "api.stripe.com";
    const b = box(id);
    if (!b) return "not created";
    if (waking && (id === "maker" || id === "checker") && b.status !== "running") return "waking…";
    return b.status;
  };
  const cls = (id) => {
    if (id === "worker" || id === "stripe") return "running";
    const b = box(id);
    return b ? b.status : "missing";
  };
  return h`<svg class="net" viewBox="0 0 780 232" role="img" aria-label="Network: portal, Worker, maker and checker boxes, vault box, Stripe">
    ${EDGES.map(([a, b]) => h`<path id="e-${a}-${b}" class="edge ${cls(a) === "running" && cls(b) === "running" ? "on" : ""}" d="${curve(a, b)}"/>`)}
    ${NODES.map(
      (n) => h`<g class="node ${cls(n.id)}" transform="translate(${n.x},${n.y})">
        <rect width="${n.w}" height="${H}"/>
        <text x="12" y="19">${n.label}</text>
        <text class="sub" x="12" y="35">${sub(n.id)}</text>
      </g>`,
    )}
    <g id="pulses"></g>
  </svg>`;
}

// Animate a vote travelling from a voter to the vault (and on to Stripe for a refund).
export function pulse(from, to, kind = "") {
  const g = document.getElementById("pulses");
  const path = document.getElementById(`e-${from}-${to}`);
  if (!g || !path || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ns = "http://www.w3.org/2000/svg";
  const c = document.createElementNS(ns, "circle");
  c.setAttribute("r", "4.5");
  c.setAttribute("class", `pulse ${kind}`);
  const m = document.createElementNS(ns, "animateMotion");
  m.setAttribute("dur", "0.9s");
  m.setAttribute("fill", "freeze");
  m.setAttribute("path", path.getAttribute("d"));
  c.appendChild(m);
  g.appendChild(c);
  m.beginElement?.();
  setTimeout(() => c.remove(), 1000);
}
