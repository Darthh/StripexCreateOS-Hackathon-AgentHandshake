// npm run deploy:createos — run the same Worker on CreateOS Deploy (test environment).
// Uploads only committed files (git archive of HEAD), so .env, .env.local and .projects can never
// ship. Secrets come from the same builder as secrets:sync, which refuses the vault's money key.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createosCli, createosTarget, fail, ok, warn } from "./lib.ts";
import { workerSecrets } from "./secrets-sync.ts";

const target = createosTarget();
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) warn("uncommitted changes are not deployed: only HEAD is uploaded");

const vars = { ...workerSecrets(), PLAN_BOX_LIMIT: process.env.PLAN_BOX_LIMIT ?? "1", ...(target.endpoint && { PUBLIC_URL: target.endpoint }) };
createosCli(["env", "set", "--project", target.project, "--environment", target.environment, ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)]);
ok(`CreateOS env set: ${Object.keys(vars).join(", ")} (VAULT_STRIPE_KEY withheld)`);

const dir = mkdtempSync(join(tmpdir(), "twokey-"));
try {
  const stage = join(dir, "stage");
  execFileSync("git", ["archive", "--format=tar", `--prefix=stage/`, "-o", join(dir, "head.tar"), "HEAD"]);
  execFileSync("tar", ["-xf", "head.tar"], { cwd: dir });
  for (const f of [".env", ".env.local", ".projects", ".dev.vars"]) if (existsSync(join(stage, f))) fail(`refusing to deploy: ${f} is in the upload`);
  createosCli(["deploy", "--project", target.project, "--dir", stage], true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
// Upload deploys don't auto-promote: put the newest deployment on the test environment.
const [latest] = JSON.parse(createosCli(["-o", "json", "deployments", "list", "--project", target.project])) as { id: string; createdAt: string }[];
createosCli(["deployments", "promote", "--project", target.project, "--deployment", latest.id, "--environment", target.environment]);
const { endpoint } = createosTarget();
ok(`deployed. Test environment: ${endpoint || "(endpoint appears once the deployment is promoted)"}`);
