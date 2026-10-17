// npm run deploy:createos — run the same Worker on CreateOS Deploy (test environment).
// The CreateOS project is imported from GitHub (VCS), so it builds what is pushed to main: only
// committed, pushed files ever ship (.env, .env.local and .projects are gitignored and pre-push
// checked). Secrets come from the same builder as secrets:sync, which refuses the money key.
import { execFileSync } from "node:child_process";
import { createosCli, createosTarget, loadEnv, ok, warn } from "./lib.ts";
import { syncCreateosRuntime } from "./createos-runtime.ts";
import { workerSecrets } from "./secrets-sync.ts";

const target = createosTarget();
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
git("fetch", "-q", "origin", "main");
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) warn("local HEAD is not origin/main: CreateOS builds what is on GitHub, so push first");

const vars = { ...workerSecrets(), PLAN_BOX_LIMIT: process.env.PLAN_BOX_LIMIT ?? "5", ...(target.endpoint && { PUBLIC_URL: target.endpoint }) };
const synced = await syncCreateosRuntime(target, vars, loadEnv().CREATEOS_PROJECT_API_KEY);
ok(`CreateOS project and environment configured: ${synced.keys.join(", ")} (VAULT_STRIPE_KEY withheld)`);

createosCli(["deploy", "--project", target.project, "--branch", "main"], true);
// Make sure the newest deployment is the one on the test environment.
const [latest] = JSON.parse(createosCli(["-o", "json", "deployments", "list", "--project", target.project])) as { id: string }[];
createosCli(["deployments", "promote", "--project", target.project, "--deployment", latest.id, "--environment", target.environment]);
const { endpoint } = createosTarget();
ok(`deployed from GitHub main. Test environment: ${endpoint || "(endpoint appears once promoted)"}`);
