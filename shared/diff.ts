// Minimal unified-style line diff (LCS). Enough for one-file patch cards.
export function lineDiff(a: string, b: string): string {
  const x = a.split("\n");
  const y = b.split("\n");
  const m = x.length;
  const n = y.length;
  const lcs = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && x[i] === y[j]) {
      out.push(`  ${x[i++]}`);
      j++;
    }
    else if (j < n && (i === m || lcs[i][j + 1] > lcs[i + 1][j])) out.push(`+ ${y[j++]}`);
    else out.push(`- ${x[i++]}`);
  }
  // Keep 2 lines of context around changes.
  const keep = out.map((_, k) => out.slice(Math.max(0, k - 2), k + 3).some((c) => c[0] !== " "));
  return out.filter((_, k) => keep[k]).join("\n");
}
