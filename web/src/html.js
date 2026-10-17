// Tiny safe templating: every interpolation is escaped unless it is itself h`` output.
class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (v) => (v == null || v === false ? "" : Array.isArray(v) ? v.map(fmt).join("") : v instanceof Raw ? v.s : esc(v));
export const h = (strings, ...vals) => new Raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? fmt(vals[i]) : ""), ""));
export const raw = (s) => new Raw(s);

export const money = (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`;
export const ago = (t) => {
  if (!t) return "";
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  return s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
export const uptime = (t) => {
  if (!t) return "—";
  const s = (Date.now() - new Date(t).getTime()) / 1000;
  return s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
export const icon = (name) => h`<i data-lucide="${name}"></i>`;
