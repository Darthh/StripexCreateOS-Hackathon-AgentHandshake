<p align="center">
  <img src="docs/assets/agent-handshake-logo.png" alt="AgentHandshake logo: two suited agents shaking hands, in black and Stripe purple" width="720">
</p>

<h1 align="center">AgentHandshake</h1>

<p align="center"><strong>Dual control for AI agents that move money.</strong><br>Two agents agree. A deterministic vault checks. Stripe executes.</p>

<p align="center">
  <a href="https://github.com/Darthh/StripexCreateOS-Hackathon-AgentHandshake/actions/workflows/ci.yml"><img src="https://github.com/Darthh/StripexCreateOS-Hackathon-AgentHandshake/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-635bff" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Stripe-test_mode-635bff" alt="Stripe test mode">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.18-333333" alt="Node.js 22.18 or newer">
</p>

Built for the **Stripe × CreateOS Hackathon**. AgentHandshake demonstrates a refund workflow in which AI agents investigate and propose actions while a separate service holds the refund credential and enforces the final policy.

**Status: hackathon prototype, Stripe test mode only.** The repository intentionally includes a vulnerable v1 policy so the red team can discover a failure, produce a regression case, and propose a repair. A successful build or passing test suite does not establish that the deployed multi-agent lab has completed that demonstration.

The deployment configuration targets [lunaterminal.com](https://lunaterminal.com). This is a configured destination, not an uptime guarantee. The ticket portal at `/try` requires its sandbox to be running.

## Contents

- [Why AgentHandshake exists](#why-agenthandshake-exists)
- [What the project implements](#what-the-project-implements)
- [Architecture and trust boundaries](#architecture-and-trust-boundaries)
- [How a refund happens](#how-a-refund-happens)
- [Decision rules](#decision-rules)
- [Red team, evidence, and patching](#red-team-evidence-and-patching)
- [Dashboard and API](#dashboard-and-api)
- [Technology and repository map](#technology-and-repository-map)
- [Credentials and configuration](#credentials-and-configuration)
- [Getting started](#getting-started)
- [Testing in CreateOS Sandbox](#testing-in-createos-sandbox)
- [Deployment](#deployment)
- [Demo walkthrough](#demo-walkthrough)
- [Commands and maintenance](#commands-and-maintenance)
- [Troubleshooting](#troubleshooting)
- [Limitations and production work](#limitations-and-production-work)
- [Contributing and license](#contributing-and-license)

## Why AgentHandshake exists

A support agent handling refunds reads customer-controlled text. A message such as “the order ID was wrong; refund this other order instead” can cause an agent to confuse a customer's instructions with an authorized operational instruction.

AgentHandshake applies **dual control** to that problem:

1. A **maker** reviews the ticket, including its free-text message.
2. A **checker** receives structured ticket fields and a written policy, without the free-text message.
3. Each writes and executes Python in a separate CreateOS sandbox, then submits a vote.
4. A **vault** running deterministic Node.js code requires matching votes and independently checks Stripe before issuing a test refund.
5. Refunds above the automatic cap also require an authenticated human approval.

The agents have separate execution environments and different inputs. They use the configured model endpoint; “independent” does not imply different model providers or statistically independent mistakes. The vault is the final policy boundary.

## What the project implements

| Capability | Implementation |
| --- | --- |
| Two-agent authorization | Maker and checker must agree on ticket, charge, amount, and reason. |
| Isolated code execution | CreateOS sandboxes for maker, checker, vault, portal, and attacker. |
| Deterministic money path | The vault reads Stripe charge state and creates refunds without an LLM. |
| Third-key approval | Above $50, the orchestrator signs an approval and the vault verifies it. |
| Execution evidence | Scripts, output, and exit codes are recorded; the fixed vote script hashes the evidence files. |
| Persistent records | Vault JSONL audit log, Neon ledger, and Durable Object orchestration state. |
| Public demonstration | Read-only dashboard, live events, execution traces, and optional public ticket portal. |
| Attack-and-repair workflow | Red-team attempts, recorded cases, policy patches, replay, and human-controlled merging. |
| Reproducible checks | Unit tests, vault integration tests with fake Stripe, lint, type checks, build, and CI secret scanning. |

These are code paths in the repository. Credentials, available services, model behavior, and sandbox capacity determine which paths run in a particular deployment.

## Architecture and trust boundaries

```mermaid
flowchart TB
    Visitor["Visitor / demo operator"] --> Dashboard["Dashboard + Hono API"]
    Visitor --> Portal["Portal sandbox: ticket form"]
    Dashboard --> Lab["Lab Durable Object: queue + agent orchestration"]
    Lab -->|"poll ticket file via exec"| Portal
    Lab --> Model["OpenRouter: Anthropic-compatible API"]
    Lab --> DB["Neon Postgres: tickets + audit + eval records"]
    Lab -->|"upload inputs and execute code"| Maker["Maker: free text + structured fields"]
    Lab -->|"upload inputs and execute code"| Checker["Checker: structured fields + policy"]
    Maker -->|"authenticated vote"| Vault["Vault: deterministic Node.js"]
    Checker -->|"authenticated vote"| Vault
    Lab -->|"localhost admin API through exec"| Vault
    Vault -->|"restricted test key"| Stripe["Stripe: charge lookup + refund"]
    Lab --> Attacker["Attacker sandbox: authorized test lab"]
```

The model loop runs in the orchestrator. Generated Python runs inside the role's sandbox. Model API credentials do not need to be placed in agent-generated code.

| Component | Responsibility | Network arrangement |
| --- | --- | --- |
| Portal | Accept requests; append `/var/portal/tickets.jsonl`. | Public ingress on port 8080; no private lab network; outbound deny rule. |
| Maker | Inspect structured ticket, customer message, and exported charges. | Private `handshake-lab`; outbound deny rule; no public ingress. |
| Checker | Inspect structured ticket, exported charges, and `policy.md`. | Private `handshake-lab`; outbound deny rule; no public ingress. |
| Vault | Verify votes and approvals; look up charges; enforce policy; refund. | Private lab network; egress `api.stripe.com:443`; no public ingress. |
| Attacker | Exercise synthetic attacks and propose repairs. | Lab by default; `handshake-shadow` when enabled; outbound deny rule. |
| Worker / Lab | Model calls, scheduling, read-only Stripe, dashboard, administration. | Holds CreateOS control-plane access, model key, database access, and approval authority. |

### Outbound restrictions

CreateOS treats an **empty egress list as open access**. The project represents “no outbound destinations” as `127.0.0.1:9`. The vault instead allows Stripe HTTPS.

[`worker/boxes.ts`](worker/boxes.ts) probes HTTPS and HTTP to `example.com`, reports DNS behavior, and checks Stripe reachability for the vault. Its success criterion checks blocked HTTP/HTTPS connections; DNS resolution can still succeed. The Proof page does not establish that all DNS queries are blocked.

Bootstrap performs a narrower vault probe: blocked HTTPS to `example.com` and a `401` from an unauthenticated Stripe request. Here, `401` demonstrates reachability without sending the refund credential.

### Trusted control plane

An operator or service holding the CreateOS API key can execute commands inside the boxes, including the vault. This architecture separates agent code from credentials; it does not make the orchestrator or its credential holder untrusted. Protect the control-plane key and administrative access.

## How a refund happens

1. **Receive a ticket.** An admin selects a seeded scenario or submits a custom ticket. Alternatively, the portal writes a request that the Lab polls and resolves into structured fields.
2. **Prepare the boxes.** The Lab creates missing voters when capacity permits, resumes paused boxes, and prepares fresh workspaces.
3. **Separate the inputs.** Both voters get structured fields and a charge export. Only the maker receives `free_text`; the checker receives the written policy.
4. **Execute evidence-producing code.** The model calls `run_python`. A fixed runner starts code as an unprivileged `agent` user with a scrubbed environment, records output, and terminates leftover processes for that user.
5. **Submit votes.** A fixed script inside each voter box sends its token and evidence hash to the vault. The vault stores registered token hashes and can bind a voter to its private-network IP.
6. **Evaluate deterministically.** The vault fetches charge state from Stripe and calls `decide()` with votes, ticket, policy, and approval/limit context.
7. **Execute or stop.** Permitted matching votes produce a Stripe test refund. Other outcomes wait, block, or enter human approval.
8. **Record the result.** The vault appends audit events. The Lab synchronizes them into Neon, updates the ticket, and emits live dashboard events.

The orchestrator requires a successful code run before accepting a final agent action. The evidence hash links recorded files; it does not prove that the model's reasoning is correct.

## Decision rules

Defaults live in [`shared/decide.ts`](shared/decide.ts). Amounts use **integer USD cents** in the demo.

| Rule | Default behavior |
| --- | --- |
| Registered ticket | Missing ticket registration blocks. |
| Two voters | A missing vote waits; a single vote older than the 10-minute window blocks. |
| Explicit refusal | Either voter refusing blocks the refund. |
| Matching proposal | `ticket_id`, `charge_id`, `amount_cents`, and `reason_code` must match. |
| Vote timing | Receipt timestamps must be within 10 minutes of each other. |
| Valid amount | Positive whole cents only. |
| Stripe charge | Charge must exist and have status `succeeded`. |
| Available balance | Amount cannot exceed the charge minus prior refunds. |
| Daily limit | Requesting customer cannot exceed **15,000 cents ($150) per UTC day**. |
| Human cap | More than **5,000 cents ($50)** requires valid human approval. |
| Repeated execution | Stripe idempotency key derives from the vote pair; final decisions recover from the audit log after restart. |

| Action | Meaning |
| --- | --- |
| `wait` | The second vote has not arrived. |
| `block` | Refusal, mismatch, invalid charge/amount, exhausted limit, or another failure stopped the refund. |
| `needs_human` | Two matching votes exceed the automatic cap. |
| `refund` | Policy permits an attempt; Stripe must still accept it. |

**Deliberate v1 gap:** `decide()` does not verify that `ticket.customer_id` owns `charge.customer`. A dedicated test documents that an otherwise-valid cross-customer refund is allowed. This is the starting point for the red-team demonstration, not a production-ready refund policy.

## Red team, evidence, and patching

1. The attacker writes and runs code inside its sandbox and submits synthetic attack tickets or probes the authorized lab.
2. Refund records are compared with Stripe charge ownership and the ticket ledger.
3. A successful attack can be captured with the exact inputs that reached the decision function.
4. The patcher proposes up to three replacements for `shared/decide.ts`.
5. The replay suite checks legitimate cases and recorded attacks against each candidate. Generated patches run unprivileged with a clean environment.
6. Passing candidates are ranked by diff length; the selected candidate becomes `ready`.
7. An authenticated operator clicks **Merge patch**. Only a ready patch with a passing suite can be installed into the vault.

When spare slots exist, candidates run in attacker forks. With no spare slot, the implementation evaluates them sequentially in the attacker box. Evidence-locker forks and shadow labs consume additional capacity.

With `SHADOW_LAB=true`, maker, checker, and vault are forked onto `handshake-shadow`, and voter credentials are rotated. This does not automatically create a separate Stripe account; all activity must continue to use test keys.

**Runtime merge versus Git:** dashboard merging installs code into a vault instance and records it in the ledger. It does not create a Git commit or PR. Preserve an accepted patch and its regression case in source control separately. A fresh bootstrap uploads the checked-in policy again.

## Dashboard and API

| Page | Purpose |
| --- | --- |
| `/` | Overview, counters, and recent activity. |
| `/tickets` | Ticket board/list, voter traces, and decisions. |
| `/approvals` | Requests awaiting a human third key. |
| `/red-team` | Attacks and candidate patch workflow. |
| `/eval` | Recorded cases and replay results. |
| `/evidence` | Frozen workspace forks from disagreement. |
| `/audit` | Orchestration and vault events. |
| `/proof` | Provisioning snapshot, secret placement, and egress proofs. |
| `/lab/live`, `/lab/shadow` | Sandbox topology and lifecycle. |
| `/try` | Redirect to the running portal; 503 if unavailable. |

Public snapshots mask email-shaped strings. They remain a public demo workspace, not a private customer-support system.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | `{"ok":true,"service":"agent-handshake"}`; does not check every dependency. |
| `GET /api/state` | Dashboard snapshot; admin identity affects detail and email masking. |
| `GET /api/live` | WebSocket stream of Lab events. |
| `GET /api/me` | Whether an accepted admin identity is present. |
| `GET /api/admin/login` | Admin entry point / token sign-in form. |
| `POST /api/session` | Exchange `ADMIN_TOKEN` for a session cookie. |
| `POST /api/admin/:action` | Actions including `new_ticket`, `approve`, `reject`, `setup`, `run_redteam`, `rerun_all`, and `merge_patch`. |

Admin writes require same-origin JSON. Authentication accepts a verified Cloudflare Access JWT or an admin-token session. The cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, with a 12-hour maximum age. Without either configured mechanism, admin actions fail closed. See [`worker/access.ts`](worker/access.ts).

## Technology and repository map

| Layer | Stack |
| --- | --- |
| Dashboard | Vanilla JavaScript, Vite, Lucide icons, Geist fonts, QR code generator. |
| API/orchestration | Hono, Cloudflare Workers, SQLite-backed Durable Object, alarms, WebSockets. |
| Execution | `@nodeops-createos/sandbox`, `devbox:1`, Python agents, Node.js vault. |
| Models | Anthropic SDK against OpenRouter's Anthropic-compatible endpoint. |
| Payments | Stripe SDK for local/read-only operations; direct Stripe HTTPS from the vault. |
| Ledger | Neon Postgres over HTTP. |
| Provisioning | Stripe CLI with Projects plugin. |
| Notifications | Optional Resend approval email. |
| Container | Node 22, bundled Worker, Miniflare/workerd, port 8080. |
| Quality checks | Node test runner, Biome, TypeScript, Gitleaks, GitHub Actions. |

```text
.
├── boxes/                  # Fixed Python runner, voter script, policy replay runner
├── docs/assets/            # AgentHandshake logo
├── portal/server.ts        # Ticket form and local JSONL queue
├── scripts/
│   ├── bootstrap.ts        # Provision, install vault, probe egress, sync secrets
│   ├── deploy-createos.ts  # Build pushed GitHub main on CreateOS Deploy
│   ├── embed.ts            # Generate embedded sandbox source strings
│   ├── seed.ts / reset.ts  # Stripe test fixtures and ledger reset
│   ├── secrets-sync.ts     # Allowlisted Worker secret mapping
│   ├── serve.ts            # Container Miniflare entry point
│   └── teardown.ts         # Account-wide sandbox teardown
├── shared/decide.ts        # Pure refund policy and default limits
├── shared/*.test.ts        # Policy and diff tests
├── vault/server.ts         # Deterministic refund service and append-only log
├── vault/server.test.ts    # Real vault against local fake Stripe
├── web/                    # Dashboard source and styles
├── worker/
│   ├── access.ts           # Authentication and same-origin write gate
│   ├── agents.ts           # Model loop, tools, and role prompts
│   ├── boxes.ts            # Capacity, networking, lifecycle, egress probes
│   ├── db.ts               # Schema, audit helpers, redaction
│   ├── index.ts            # Hono routes and error boundary
│   ├── lab.ts              # Job queue, attacks, evidence, patches
│   └── stripe.ts           # Read-only exports and refund accounting
├── .github/workflows/ci.yml
├── Dockerfile
├── package.json
└── wrangler.jsonc          # Bindings, public URL, model, and lab limits
```

`worker/embedded.gen.ts` is generated and ignored. Both build and lint regenerate it before consuming Worker source.

## Credentials and configuration

### Secret placement

| Name | Source / location | Purpose |
| --- | --- | --- |
| `VAULT_STRIPE_KEY` | Restricted `rk_test_` key; bootstrap installs a mode-0600 file in the vault. | Charges read + Refunds write. Withheld from Worker/deployment secret synchronization. |
| `READ_STRIPE_KEY` | Restricted `rk_test_` key; Worker secret. | Read-only Charges, Customers, and Refunds access. Verify actual Dashboard permissions. |
| `STRIPE_SECRET_KEY` | Full `sk_test_` in ignored local `.env.local`; seed/reset also accept `STRIPE_SANDBOX_SECRET_KEY`. | Create/reset synthetic Stripe data; never sent to the Worker. |
| `CREATEOS_PROJECT_API_KEY` | Projects output; mapped to `CREATEOS_SANDBOX_API_KEY`. | Sandbox control-plane access. |
| `OPENROUTER_API_API_KEY` | Projects output; mapped to `MODEL_API_KEY`. | Orchestrator model calls. |
| `NEON_POSTGRES_CONNECTION_STRING` | Projects output; mapped to `DATABASE_URL`. | Ticket/audit ledger. |
| `APPROVAL_HMAC_KEY` | Generated at bootstrap; installed in vault and orchestrator deployment(s). | Sign/verify ticket-and-amount approvals. |
| `ADMIN_TOKEN` | Generated into ignored `.env.local` when absent; synchronized to Worker. | Admin sign-in without Access; at least 32 characters required. |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Operator-configured Worker secrets. | Cloudflare Access JWT verification. |
| `RESEND_API_KEY`, `ADMIN_EMAIL` | Optional notification key and destination. | Human approval notifications. |
| Voter tokens | Generated during voter setup; used by the fixed voter process. | Authenticate votes; vault stores registered hashes. |

The secret builder rejects the vault key, live Stripe keys, and full `sk_test_` keys from outgoing Worker secrets. Prefix checks cannot validate a restricted key's permissions; configure those in Stripe.

Keep `.env`, `.env.local`, `.dev.vars`, `.projects/`, and `.createos.json` untracked. The pre-push hook checks tracked secret files and runs Gitleaks. Do not put credentials into tickets, screenshots, examples, issues, or model prompts.

### Runtime settings

| Setting | Checked-in value / behavior |
| --- | --- |
| `CREATEOS_SANDBOX_BASE_URL` | `https://api-eu.sb.createos.sh`; local bootstrap also explicitly targets EU. |
| `MODEL_BASE_URL` | `https://openrouter.ai/api`. |
| `MODEL` | `nvidia/nemotron-3-super-120b-a12b:free`; availability/rates/tool support depend on provider. |
| `SHADOW_LAB` | `false`; attacks use the live **test-mode** lab. |
| `PLAN_BOX_LIMIT` | `1`; application guard, not a provider subscription change. |
| `PUBLIC_URL` | `https://lunaterminal.com`; change to your actual deployment origin. |
| `PROJECTS_STATUS` | Non-secret provisioning snapshot used by Proof. |
| `CREATEOS_PLAN` | Bootstrap setting; defaults to `free`. Other values can trigger paid provisioning. |
| `PORT`, `PERSIST_TO` | Container defaults: `8080`, `/data/miniflare`. |

Increasing `PLAN_BOX_LIMIT` does not increase real account capacity. A complete five-role lab needs sufficient provider capacity; Free is suitable for single-box exercises. Forks and paused boxes consume slots. Check current [CreateOS limits](https://createos.sh/docs/Sandbox/Limits) before provisioning. Paid plans require a deliberate operator choice.

## Getting started

### 1. Requirements and checkout

- Node.js **22.18 or newer** and npm; use a recent Node 22 patch or Node 24.
- Git and [Gitleaks](https://github.com/gitleaks/gitleaks).
- [Stripe CLI](https://docs.stripe.com/stripe-cli) with Projects access.
- An authenticated CreateOS account for sandbox workloads.
- Cloudflare/Wrangler access for Cloudflare deployment.
- Test Stripe keys and database/model credentials for the connected lab.

```sh
git clone https://github.com/Darthh/StripexCreateOS-Hackathon-AgentHandshake.git
cd StripexCreateOS-Hackathon-AgentHandshake
npm ci
```

The npm prepare step configures `.githooks`; install Gitleaks before pushing. Tests and build can run without payment, database, or model credentials. Use the isolated path below for clean Linux verification.

### 2. Connect Stripe Projects

```sh
stripe plugin install projects
stripe projects status --json
# Only for a fresh, uninitialized workspace:
stripe projects init
```

Follow the CLI's authentication or existing-project selection flow. Managed repository instructions refer to project `createosxstripe`; cloning Git files does not copy ignored Projects state/credentials. Select the intended account/project and avoid duplicate services.

Projects provisioning can require a live-mode CLI context even though this app's payment activity uses test keys. If `PROJECTS_CONTEXT_MISMATCH` appears, follow the CLI's retry condition. Browser login alone does not prove context readiness. Do not substitute live payment keys.

### 3. Configure test credentials

Create two restricted keys in the **Stripe test Dashboard**: Charges read + Refunds write for the vault; read-only Charges, Customers, and Refunds for the Worker. Store them using secure interactive prompts:

```sh
stripe projects variables set vault-stripe-key --env-key VAULT_STRIPE_KEY
stripe projects variables set read-stripe-key --env-key READ_STRIPE_KEY
stripe projects env --pull
```

For seeding, put `STRIPE_SECRET_KEY` with your full test key in ignored `.env.local`. Enter the value locally, avoiding shell history. Do not hand-edit CLI-managed `.env` or `.projects/` state.

### 4. Bootstrap the connected environment

**Bootstrap changes infrastructure and deploys secrets.** Review the chosen project, account, plan, and existing vault first. It can create services, create/reuse a sandbox named `vault`, replace its policy code, rotate the approval key, and synchronize Worker secrets.

```sh
npx wrangler login
npm run bootstrap
```

The script requests missing free plans/resources for CreateOS, Neon, Resend, and OpenRouter. It also attempts a dedicated Stripe sandbox, with a local test-key fallback. It pulls credentials, verifies the CreateOS key against EU, creates/reuses `handshake-lab` and the vault, starts the vault, probes egress, and synchronizes secrets.

Successful bootstrap requires a healthy vault, blocked-destination proof, and Stripe reachability. On Free, the vault occupies the single slot; no capacity remains for separate voters.

### 5. Seed synthetic data

```sh
npm run seed
```

Creates **3 synthetic customers, 12 USD test payment intents, and 6 scenarios**. Five are legitimate, including one over the human cap; the sixth contains prompt injection. Re-running seed creates fresh Stripe objects and replaces scenarios. It is not an idempotent migration.

### 6. Local development

Build once and start the Worker:

```sh
npm run build
npx wrangler dev
```

In a second terminal:

```sh
npm run dev
```

Vite proxies `/api` and WebSockets to `http://localhost:8787`. Wrangler needs appropriate local bindings/secrets for connected calls. `npm run dev` alone serves the frontend, not a self-contained backend. Production secrets are not automatically local Wrangler secrets. Admin cookies use `Secure`; validate authenticated flows over an appropriate secure origin.

## Testing in CreateOS Sandbox

| Goal | What it establishes | Requirements |
| --- | --- | --- |
| Single-box repository checks | Tests, lint/type checks, and production build in clean Linux. | One available sandbox, npm access, no app secrets. |
| Connected multi-agent exercise | Model-generated code, voters, networking, vault, real Stripe test refund, and dashboard evidence together. | Test credentials, database/model services, admin access, and sufficient boxes. |

### Single-box run with the CreateOS plugin

Inspect your account in the [CreateOS Sandbox dashboard](https://createos.nodeops.network/sandbox). With the plugin's `cos` driver installed and authenticated, run from the checkout:

```sh
cos auth
cos offload -s s-1vcpu-1gb -r devbox:1 -p npm \
  -x '.env' -x '.env.*' -x '.dev.vars*' -x '.projects' -x '.createos.json' \
  . 'npm ci --ignore-scripts --no-audit --no-fund && npm test && npm run lint && npm run build'
```

`cos` comes from the plugin, not this repository; use its installed absolute path if needed. `--ignore-scripts` skips install lifecycle hooks in the disposable checkout. The npm preset permits registry downloads. Secret paths are explicitly excluded alongside the driver's standard Git/dependency exclusions. Do not forward app keys for this check.

On **Windows Git Bash**, prefix `cos` with `MSYS2_ARG_CONV_EXCL=/work` to preserve remote paths through the native Windows CLI. Run `cos auth` first. The one-shot driver normally destroys its own sandbox afterward. On infrastructure failure, follow its cleanup instructions for that specific sandbox.

### Existing automated coverage

- Policy: matching/missing/late votes, refusal, disagreement, Stripe state, balance, human cap, daily cap, and invalid cents.
- Intentional ownership weakness: a test documents the vulnerable v1 baseline.
- Vault: forged token rejection, exactly-once refund behavior, mismatch blocking, HMAC approval, and audit-log restart recovery.
- Helpers: textual diff output and credential/connection-string redaction.

Vault integration launches the real vault process against a **local fake Stripe server** with fixture credentials. Passing tests do not establish a real Stripe refund, cloud network enforcement, model behavior, or full-lab deployment.

GitHub Actions runs secret scanning plus `npm ci`, lint/type checks, tests, and build. The badge links to current results.

### Connected acceptance exercise

After provisioning/capacity checks, verify a legitimate refund, voter disagreement, over-cap approval, and attack/patch replay. Capture ticket ID, both execution traces, vault decision, Stripe test refund ID where applicable, policy hash, and replay result. Report each observed outcome separately.

## Deployment

### Cloudflare Worker

Review `wrangler.jsonc`: domain, Worker name, variables, assets, and Durable Object migration.

```sh
npm run secrets:sync
npm run deploy
```

Secret synchronization uses the allowlisted mapping above. Bootstrap installs `APPROVAL_HMAC_KEY` separately. Configure verified Cloudflare Access (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`) or admin-token sessions for admin actions. Notifications additionally need `RESEND_API_KEY` and `ADMIN_EMAIL`.

### CreateOS Deploy container

**CreateOS Deploy hosts the orchestrator; CreateOS Sandbox hosts isolated execution.** Building/importing the container does not create the five-role lab. The current deployment helper expects a GitHub-imported VCS project. For a new target:

```sh
createos projects add --name "AgentHandshake" --unique-name agent-handshake \
  --type vcs --runtime dockerfile --port 8080 \
  --github-owner Darthh --repo Darthh/StripexCreateOS-Hackathon-AgentHandshake
npm run deploy:createos
```

Reuse an existing target if available and complete any required GitHub integration access. The helper requires ignored `.createos.json`, sets allowlisted environment values, triggers a build from **pushed GitHub `main`**, and promotes the latest deployment to `handshake-test`. It fetches `origin/main` and warns when local HEAD differs. Commit and push intended changes before deploying; local-only files do not ship. The helper defaults `PLAN_BOX_LIMIT` to `1` unless provided in its environment.

The Dockerfile installs CA certificates, builds assets, bundles the Worker, and runs `scripts/serve.ts` on `0.0.0.0:8080`. The entry point uses Miniflare/workerd directly and stores local Durable Object state under `/data/miniflare`. Persistence across container replacement requires host storage configuration; a filesystem path alone is not a durable-volume guarantee.

## Demo walkthrough

Preflight service availability and capacity, then use synthetic data:

1. **Proof:** show secret placement, sandbox roles, and the latest egress results.
2. **“Damaged mug”:** inspect both agents' executed code and matching $24.50 proposal, then the vault and Stripe test result.
3. **Injection:** observe whether the maker follows the customer text and the checker refuses/disagrees. Inspect the actual traces; model behavior is not guaranteed.
4. **“Big order, damaged (over the cap)”:** the $89 request requires the third key. Approve/reject as admin and inspect the vault record.
5. **Red team:** review a discovered failure, captured replay case, proposed patches, and suite results. Merge a ready candidate as the operator, then replay.
6. **Portal QR:** submit synthetic data through the portal and follow its dashboard ticket.

Forks and shadow execution need spare slots. With one box, demonstrate repository tests and vault behavior instead of claiming the complete multi-box flow ran.

## Commands and maintenance

| Command | Purpose / effect |
| --- | --- |
| `npm ci` | Install locked dependencies; configure Git hooks. |
| `npm test` | Policy/helper/vault tests; fake Stripe only. |
| `npm run lint` | Generate embeds, Biome lint, TypeScript checks. |
| `npm run build` | Generate embeds; build dashboard into `dist/`. |
| `npm run scan` | Gitleaks scan of Git history with redacted findings. |
| `npm run dev` | Vite frontend and API proxy. |
| `npm run bootstrap` | Provision, install/reset vault policy, rotate approval key, prove egress, sync secrets. |
| `npm run secrets:sync` | Synchronize allowlisted Worker secrets and status snapshot. |
| `npm run seed` | Create fresh Stripe test fixtures; replace scenarios. |
| `npm run reset` | Delete tagged test customers, clear six ledger tables, seed again. |
| `npm run deploy` | Build and deploy to Cloudflare. |
| `npm run deploy:createos` | Build pushed GitHub `main`; promote CreateOS Deploy test environment. |
| `npm run teardown -- --yes` | Destroy **every sandbox on the authenticated account**; delete networks starting `handshake-`. |

**Teardown is account-wide for sandboxes**, not limited to this checkout. Use a dedicated demo account or inspect/remove specific owned resources when unrelated work exists. Do not use it as routine sandbox-test cleanup.

Dashboard **Reset demo** and the local reset script affect different state. The dashboard clears ticket/orchestration state and rotates the vault log while retaining voter registrations. The local script replaces Stripe fixtures and clears database tables. Neither resets every cloud resource or runtime patch. Bootstrap uploads the checked-in policy again; review its other side effects before using it as a reset.

## Troubleshooting

| Symptom | Check / next step |
| --- | --- |
| `PROJECTS_CONTEXT_MISMATCH` | Follow CLI account/context guidance; retain test payment keys. |
| Missing provider variable | Confirm Projects environment; use `stripe projects env --pull`. |
| EU CreateOS key rejected | App/bootstrap explicitly target EU; match credential and region. |
| Capacity error with paused boxes | Paused boxes count; inspect actual capacity before provisioning. |
| Agent lab will not start on Free | The vault occupies the single slot; separate voters need more capacity. |
| Model 429 / tools fail | Check provider availability, balance, rates, and Anthropic API/tool support. |
| Health works but dashboard fails | Health does not test Neon/Stripe/CreateOS/model; inspect authenticated errors/logs. |
| Admin action fails | Check identity/session, same-origin JSON, secure cookie, and deployment origin. |
| `/try` returns 503 | Portal is absent/paused/not running; creation requires capacity. |
| Egress proof not ready | Inspect recorded protocol results and propagation; DNS need not fail. |
| Container TLS fails | Use the current Dockerfile with CA certificates. |
| Deployment misses edits | CreateOS builds pushed GitHub `main`; confirm changes are committed and pushed there. |
| Push blocked | Install Gitleaks, inspect redacted findings, remove tracked secret files. |
| Demo domain unavailable | Check actual endpoint, custom-domain setup, and DNS. |

## Limitations and production work

- **Intentional ownership flaw:** v1 omits customer-to-charge ownership in its deterministic policy. Keep the demo in Stripe test mode.
- **Control-plane authority:** a compromised orchestrator/key holder can access the vault; sandbox isolation does not remove that trust.
- **Model variability:** different inputs reduce one exposure path but do not guarantee prompt-injection resistance or independent mistakes.
- **Bounded exports:** helpers read the latest 100 charges/refunds without pagination; accounting is limited to that window.
- **Public workspace:** email masking is not complete anonymization. Portal email entry does not verify identity; Stripe refunds return to the original payment method.
- **Runtime patches:** dashboard merges change a running instance, not source control. Preserve reviewed code and regression cases for rebuilds.
- **Resource limits:** the full topology exceeds one Free sandbox. Forks/paused boxes consume slots; provider quotas can interrupt a demo.
- **Coverage limits:** tests exercise selected policy/vault behaviors, not all admin paths, network enforcement, production durability, or external availability.

Before real-money use, remove the deliberate flaw, authenticate customer identity, review authorization and approval boundaries, validate reconciliation/durable storage, introduce appropriate retention/rate controls, and exercise the whole workflow under failures and concurrency. These are future engineering requirements, not capabilities claimed by this prototype.

## Contributing and license

Keep changes focused, use synthetic fixtures, and run lint, tests, build, and secret scanning. For policy changes, explain the failing case and preserve it as a regression test. Review generated patches before installing them; omit credentials and account data from reports.

**AgentHandshake** is the current name; older history may refer to TwoKey / Two-Key. The supplied logo is stored at [`docs/assets/agent-handshake-logo.png`](docs/assets/agent-handshake-logo.png).

Code is distributed under the [MIT License](LICENSE). Third-party names and marks belong to their respective owners.
