// The public portal: a ticket form on the box's public URL. This box is on no network
// and has no egress, so it cannot see the lab. The orchestrator polls the file it writes.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";

const FILE = "/var/portal/tickets.jsonl";
const REASONS = ["damaged", "not_delivered", "duplicate_charge", "wrong_item"];
mkdirSync("/var/portal", { recursive: true });

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Two-Key refund desk</title>
<style>
:root{--bg:#1a1a19;--surface:#1d1d1c;--border:#2c2b29;--text:#eceae5;--muted:#9a968f;--accent:#8e9af3}
@media (prefers-color-scheme:light){:root{--bg:#fbfaf8;--surface:#fff;--border:#e9e7e2;--text:#1d1c1a;--muted:#6b6862;--accent:#4b5bd6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13.5px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
main{width:100%;max-width:440px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:24px}
h1{font-size:18px;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px}label{display:block;margin:14px 0 6px;font-weight:500}
input,select,textarea{width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--text);font:inherit}
textarea{min-height:96px;resize:vertical}button{margin-top:20px;width:100%;padding:10px;border:0;border-radius:6px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
code{font-family:ui-monospace,monospace}</style></head><body><main>${body}</main></body></html>`;

const FORM = page(`<h1>Request a refund</h1><p>Two AI agents check every request independently. Stripe test mode: no real money moves. Requests are shown on the public demo dashboard, so use test data only.</p>
<form method="post" action="/ticket">
<label for="email">Your email</label><input id="email" name="email" type="email" required maxlength="200" autocomplete="email">
<label for="charge_id">Order (charge id)</label><input id="charge_id" name="charge_id" required pattern="ch_[A-Za-z0-9]{6,40}" placeholder="ch_..." autocomplete="off">
<label for="amount">Amount (USD)</label><input id="amount" name="amount" type="number" required min="0.01" max="10000" step="0.01" inputmode="decimal">
<label for="reason_code">Reason</label><select id="reason_code" name="reason_code">${REASONS.map((r) => `<option>${r}</option>`).join("")}</select>
<label for="message">Message</label><textarea id="message" name="message" maxlength="2000"></textarea>
<button type="submit">Submit request</button></form>`);

// ponytail: in-memory per-IP rate limit; fine for one public box.
const lastByIp = new Map<string, number>();

createServer(async (req, res) => {
  const send = (status: number, html: string) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
    res.end(html);
  };
  if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/?"))) return send(200, FORM);
  if (req.method === "POST" && req.url === "/ticket") {
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    if (Date.now() - (lastByIp.get(ip) ?? 0) < 10_000) return send(429, page("<h1>Slow down</h1><p>One request every 10 seconds.</p>"));
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 8192) return send(413, page("<h1>Too large</h1>"));
    }
    const f = new URLSearchParams(raw);
    const email = (f.get("email") ?? "").trim().slice(0, 200);
    const charge_id = (f.get("charge_id") ?? "").trim();
    const amount_cents = Math.round(Number(f.get("amount")) * 100);
    const reason_code = f.get("reason_code") ?? "";
    const message = (f.get("message") ?? "").slice(0, 2000);
    const bad = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? "email"
      : !/^ch_[A-Za-z0-9]{6,40}$/.test(charge_id)
        ? "order id"
        : !(amount_cents > 0 && amount_cents <= 1_000_000)
          ? "amount"
          : !REASONS.includes(reason_code)
            ? "reason"
            : null;
    if (bad) return send(400, page(`<h1>Check the ${bad}</h1><p><a href="/">Back</a></p>`));
    lastByIp.set(ip, Date.now());
    const ref = `P${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 8)}`.toUpperCase();
    appendFileSync(FILE, `${JSON.stringify({ ref, email, charge_id, amount_cents, reason_code, message, at: new Date().toISOString() })}\n`);
    return send(200, page(`<h1>Received</h1><p>Reference <code>${esc(ref)}</code>. Both agents will look at it in a few seconds; watch it live on the dashboard.</p><p><a href="/">Submit another</a></p>`));
  }
  send(404, page("<h1>Not found</h1>"));
}).listen(8080, "0.0.0.0");
