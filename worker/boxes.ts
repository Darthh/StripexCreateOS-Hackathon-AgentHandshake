// CreateOS sandboxes: roles, deny-by-default egress, proofs, lifecycle.
import { CreateosSandboxClient, type Sandbox } from "@nodeops-createos/sandbox";
import type { Env } from "./index.ts";

export type Role = "portal" | "maker" | "checker" | "vault" | "attacker";

// An empty allowlist means "allow all" and there is no deny token, so "none" is one
// rule that goes nowhere. Everything not on the list is dropped.
export const DENY = ["127.0.0.1:9"];
const GONE = ["destroyed", "destroying", "failed"];

export const LAB_NET = "handshake-lab";
export const SHADOW_NET = "handshake-shadow";

// An explicit fetch matters: with nodejs_compat the SDK otherwise detects "Node" and tries its
// HTTP/2 connection pool (ALPN), which workerd doesn't implement, so every call fails.
export const client = (env: Env) => new CreateosSandboxClient({ apiKey: env.CREATEOS_SANDBOX_API_KEY, baseUrl: env.CREATEOS_SANDBOX_BASE_URL, fetch: (input, init) => fetch(input, init) });

export async function liveBoxes(env: Env): Promise<Sandbox[]> {
  return (await client(env).listSandboxes()).filter((b) => !GONE.includes(b.status));
}

export async function findBox(env: Env, name: string): Promise<Sandbox | undefined> {
  return (await liveBoxes(env)).find((b) => b.name === name);
}

export async function network(env: Env, name: string) {
  const c = client(env);
  return (await c.networks.list()).find((n) => n.name === name) ?? (await c.networks.create({ name }));
}

export async function networkIp(env: Env, networkId: string, sandboxId: string) {
  const net = await client(env).networks.get(networkId);
  return net.members?.find((m) => m.sandbox_id === sandboxId)?.ip;
}

export async function ensureRunning(box: Sandbox) {
  await box.refresh();
  if (box.status === "paused") await box.resume();
  if (box.status !== "running") await box.waitUntilRunning();
  return box;
}

export async function assertCapacity(env: Env, extra = 1) {
  const n = (await liveBoxes(env)).length;
  const limit = Number(env.PLAN_BOX_LIMIT);
  if (n + extra > limit) throw new Error(`CreateOS plan limit: ${n}/${limit} boxes in use (paused boxes count). Upgrade the plan or destroy a box.`);
}

export type EgressProof = { ok: boolean; detail: string; at: string };

// The box must fail to reach the internet (HTTPS, plain HTTP and DNS). The vault is
// the one exception: it must reach api.stripe.com and nothing else.
export async function proveEgress(box: Sandbox, role: Role): Promise<EgressProof> {
  const r = await box.sh(
    [
      "curl -s -m 5 -o /dev/null https://example.com; echo https=$?",
      "curl -s -m 5 -o /dev/null http://example.com; echo http=$?",
      "getent hosts example.com >/dev/null; echo dns=$?",
      role === "vault" ? "curl -s -m 8 -o /dev/null -w 'stripe=%{http_code}\\n' https://api.stripe.com/v1/charges" : "true",
    ].join("; "),
    { timeoutMs: 60_000 },
  );
  const out = r.result.stdout;
  const reached = ["https", "http"].filter((p) => new RegExp(`${p}=0\\b`).test(out));
  const stripe = out.match(/stripe=(\d+)/)?.[1];
  const ok = reached.length === 0 && (role !== "vault" || stripe === "401");
  const detail = reached.length
    ? `reached example.com over ${reached.join(" and ")}`
    : `example.com blocked (https, http)${/dns=0\b/.test(out) ? ", DNS resolves" : ", DNS blocked"}${role === "vault" ? `; api.stripe.com ${stripe === "401" ? "reachable" : "UNREACHABLE"}` : ""}`;
  return { ok, detail, at: new Date().toISOString() };
}

// Run a fixed command with a JSON body on stdin (no shell, no quoting bugs).
export async function curlLocal(box: Sandbox, path: string, body?: unknown) {
  const args = ["-s", "-m", "60", "-H", "content-type: application/json", `http://127.0.0.1:8080${path}`];
  const r = await box.runCommand("curl", body === undefined ? args : ["-X", "POST", "--data-binary", "@-", ...args], {
    stdin: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs: 90_000,
  });
  return JSON.parse(r.result.stdout || "null");
}

export function view(b: Sandbox, role: string) {
  const d = b.data;
  return {
    id: b.id,
    name: b.name ?? b.id,
    role,
    status: b.status,
    egress: d.egress?.length ? d.egress.join(", ") : "open",
    ingress: d.ingress_url_template?.replace("<port>", "8080") ?? null,
    running_at: d.running_at ?? d.last_resumed_at ?? null,
    created_at: d.created_at,
  };
}
