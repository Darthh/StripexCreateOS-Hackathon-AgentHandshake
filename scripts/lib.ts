// Shared helpers for the local scripts (bootstrap, secrets:sync, seed, reset).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { CreateosSandboxClient } from "@nodeops-createos/sandbox";

export const EU = "https://api-eu.sb.createos.sh";
const win = process.platform === "win32";

export const ok = (msg: string) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
export const warn = (msg: string) => console.log(`\x1b[33m!\x1b[0m ${msg}`);
export function fail(msg: string): never {
  console.error(`\n\x1b[31m✗ ${msg}\x1b[0m\n`);
  process.exit(1);
}

// .env is written by Stripe Projects; .env.local holds local-only values (the full sk_test key).
export function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const f of [".env", ".env.local"]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2"); // Stripe Projects single-quotes some values
    }
  }
  return env;
}

type ProjectsResult = { ok: boolean; data?: any; error?: { code: string; message: string } };

// `stripe projects <args> --json`. Never throws: the JSON envelope carries the error.
export function projects(args: string[]): ProjectsResult {
  try {
    const out = execFileSync("stripe", ["projects", ...args, "--json"], { encoding: "utf8", shell: win, stdio: ["ignore", "pipe", "pipe"] });
    return JSON.parse(out.slice(out.indexOf("{")));
  } catch (e: any) {
    const out = String(e.stdout ?? "");
    try {
      return JSON.parse(out.slice(out.indexOf("{")));
    } catch {
      return { ok: false, error: { code: "exec", message: (e.stderr || e.message || "").toString().slice(0, 300) } };
    }
  }
}

// Names of provisioned services, e.g. "createos/project", "neon/postgres".
export function provisioned(status: any): Set<string> {
  const all = [...(status?.services ?? []), ...(status?.plans ?? [])];
  return new Set(all.filter((s: any) => s.status === "complete").map((s: any) => `${s.provider}/${s.service_id}`.toLowerCase()));
}

export function createos(env: Record<string, string>) {
  const apiKey = env.CREATEOS_PROJECT_API_KEY;
  if (!apiKey) fail("CREATEOS_PROJECT_API_KEY missing from .env. Run: stripe projects add createos/project");
  return new CreateosSandboxClient({ apiKey, baseUrl: EU });
}

export function wrangler(args: string[], input?: string) {
  return execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", shell: win, input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
}

export const PLAN_LIMITS: Record<string, number> = { free: 1, "beginner-monthly": 5, "pro-monthly": 20, "enterprise-monthly": 30 };
