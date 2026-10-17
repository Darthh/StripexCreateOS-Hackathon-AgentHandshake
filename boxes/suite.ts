// Regression suite runner, executed inside a sandbox with: node /work/suite/suite.ts
// Replays every recorded case through the candidate decide() in /work/suite/decide.ts.
import { readFileSync } from "node:fs";

const { decide, DEFAULT_POLICY } = await import("/work/suite/decide.ts");
const cases = JSON.parse(readFileSync("/work/suite/cases.json", "utf8"));
const results = cases.map((c: any) => {
  try {
    const d = decide(c.votes ?? [], c.charge ?? null, c.ticket ?? null, DEFAULT_POLICY, c.ctx);
    const pass = c.expect === "refund" ? d.action === "refund" : d.action !== "refund";
    return { id: c.id, expect: c.expect, action: d.action, reason: d.reason, pass };
  } catch (e) {
    return { id: c.id, expect: c.expect, action: "error", reason: String(e), pass: false };
  }
});
console.log(JSON.stringify({ passed: results.every((r: any) => r.pass), total: results.length, failed: results.filter((r: any) => !r.pass).length, results }));
