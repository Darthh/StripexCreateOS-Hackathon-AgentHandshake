// VCS deployments snapshot project runtime settings. Environment overrides alone
// do not configure the direct deployment URL, so keep both scopes in sync.
const API = "https://api-createos.nodeops.network";
const ALLOWED = new Set([
  "READ_STRIPE_KEY", "CREATEOS_SANDBOX_API_KEY", "MODEL_API_KEY", "DATABASE_URL",
  "ADMIN_TOKEN", "ADMIN_EMAIL", "RESEND_API_KEY", "PROJECTS_STATUS",
  "APPROVAL_HMAC_KEY", "PLAN_BOX_LIMIT", "PUBLIC_URL",
]);
const FORBIDDEN = new Set(["VAULT_STRIPE_KEY", "STRIPE_SECRET_KEY", "STRIPE_SANDBOX_SECRET_KEY"]);

type Vars = Record<string, string>;
type Settings = Record<string, unknown> & { runEnvs?: Vars };
type Target = { project: string; environment: string };

function checkVars(vars: Vars, updates = false) {
  for (const [name, value] of Object.entries(vars)) {
    if ((updates && !ALLOWED.has(name)) || FORBIDDEN.has(name) || /^(?:sk_(?:test|live)_|rk_live_)/.test(value) || (value.startsWith("rk_test_") && name !== "READ_STRIPE_KEY")) {
      throw new Error("Refusing unsafe CreateOS runtime variables; vault and full Stripe keys must stay outside the Worker.");
    }
  }
}

export async function syncCreateosRuntime(target: Target, updates: Vars, apiKey: string, request: typeof fetch = fetch) {
  if (!apiKey) throw new Error("CREATEOS_PROJECT_API_KEY missing; run Stripe Projects setup first.");
  checkVars(updates, true);
  const root = `/v1/projects/${encodeURIComponent(target.project)}`;
  const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    let response: Response;
    try {
      response = await request(`${API}${path}`, {
        method,
        signal: AbortSignal.timeout(30_000),
        headers: { "X-Api-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Error(`CreateOS runtime synchronization failed (${method}: network error).`);
    }
    // API and transport errors can contain credential-bearing payloads. Report
    // only the operation and status, never response bodies or raw exceptions.
    if (!response.ok) throw new Error(`CreateOS runtime synchronization failed (${method}: HTTP ${response.status}).`);
    try {
      const envelope = await response.json() as { data: T };
      if (!envelope || envelope.data === undefined) throw new Error();
      return envelope.data;
    } catch {
      throw new Error(`CreateOS runtime synchronization failed (${method}: invalid response).`);
    }
  };

  const project = await call<{ settings: Settings }>(root);
  const environments = await call<{ id: string; settings?: Settings }[]>(`${root}/environments`);
  const environment = environments.find((entry) => entry.id === target.environment);
  if (!project?.settings || !environment) throw new Error("CreateOS runtime settings or target environment missing.");
  // A deployment must retain the key already installed in the vault. Bootstrap
  // alone supplies a replacement after installing that same key in the vault.
  const hmac = updates.APPROVAL_HMAC_KEY ?? environment.settings?.runEnvs?.APPROVAL_HMAC_KEY;
  if (!hmac || hmac.length < 32) throw new Error("APPROVAL_HMAC_KEY missing; run bootstrap before deploying.");
  const vars = { ...updates, APPROVAL_HMAC_KEY: hmac };
  const environmentVars = { ...environment.settings?.runEnvs, ...vars };
  const projectVars = { ...project.settings.runEnvs, ...vars };
  checkVars(environmentVars);
  checkVars(projectVars);
  await call(`${root}/environments/${encodeURIComponent(target.environment)}/environment-variables`, "PUT", { runEnvs: environmentVars });
  await call(`${root}/settings`, "PUT", { ...project.settings, runEnvs: projectVars });
  return { keys: Object.keys(vars) };
}
