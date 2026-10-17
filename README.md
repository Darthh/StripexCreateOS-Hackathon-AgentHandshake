# Two-Key: dual control for AI agents that move money

**StripexCreateOS Hackathon.** Live at <https://lunaterminal.com>. Everything runs in Stripe test mode.

## The problem

Support teams want AI agents to handle refunds, but a single prompt injection can make an agent refund the wrong order. Banks solved this long ago with **dual control**: two people must agree before money moves.

Two-Key brings dual control to AI agents and enforces it with infrastructure, not prompts:

- A refund executes only when **two independent AI agents** agree on exactly the same refund. Each agent runs in its own CreateOS sandbox and sees different information.
- The only Stripe key that can move money lives in a **third sandbox running plain deterministic code**. No AI touches it.
- Above $50, a **third key** is required: a human approval, HMAC-signed by the Worker and verified by the vault.
- A **red-team agent** attacks the system in a sealed lab. Every attack that works gets a patch, a proof that the attack now fails, and a permanent regression test.

## Architecture

```
                     public internet
                           │
         ┌─────────────────┴──────────────────┐
         │                                    │
  portal box (CreateOS)              Cloudflare Worker  ── lunaterminal.com
  ticket form, public URL            Hono API + dashboard + Lab Durable Object
  no network, no egress              (orchestrator: agent loops, polling, live events)
         ▲  polled via CreateOS exec          │  CreateOS SDK (EU control plane)
         └────────────────────────────────────┤  Anthropic SDK → OpenRouter
                                              │  Neon Postgres (vote ledger, audit)
             ┌────────────────────────────────┼────────────────────────┐
             │                 private "lab" network                   │
             │   maker box ───vote──┐                                   │
             │   (sees free text)   ├──► vault box ──► api.stripe.com   │
             │   checker box ─vote──┘    deterministic Node, no AI,     │
             │   (structured fields      the only money key,            │
             │    + policy.md only)      egress: api.stripe.com:443     │
             │   attacker box (red team; shadow network when enabled)  │
             └─────────────────────────────────────────────────────────┘
```

| Box | Runs | Network | Egress | Ingress |
|---|---|---|---|---|
| portal | ticket form | none, fully isolated | none | public URL |
| maker | AI-written Python | lab | none | none |
| checker | AI-written Python | lab | none | none |
| vault | deterministic Node service on :8080 | lab | `api.stripe.com:443` only | none |
| attacker | AI-written attack scripts | shadow (lab if `SHADOW_LAB=false`) | none | none |

**How a refund happens**

1. A ticket arrives from the portal or from **New test ticket**.
2. The Lab resumes the paused maker and checker ("waking…").
3. Each agent writes Python, runs it in its own box, fixes it until it runs, and then votes. No vote or claim is accepted without evidence from code the agent ran.
4. Votes leave **from inside each box** through a fixed vote script that carries a per-box token. The vault stores only `sha256(token)`.
5. The vault calls `decide(votes, charge, ticket, policy)`, a pure function in [`shared/decide.ts`](shared/decide.ts). It refunds only if all of these hold:
   - both votes match on ticket, charge, amount and reason within 10 minutes;
   - **its own** Stripe lookup shows the charge succeeded with enough unrefunded amount;
   - the amount is ≤ $50 or a human approved;
   - the customer's daily total is under the limit.
   The idempotency key is the hash of the vote pair.

v1 ships with one deliberate gap: **it doesn't check that the ticket's customer owns the order**. That gives the red team something real to find. Vault code changes only when a human clicks **Merge patch** after the regression suite passes. AI proposes, tests prove, a human merges.

## How Stripe Projects and CreateOS Sandbox are used

**Stripe Projects** provisions every service. `npm run bootstrap` runs:

```
stripe projects add createos/free createos/project neon/free neon/postgres \
                    resend/free resend/email openrouter/free openrouter/api
stripe projects variables set vault-stripe-key --env-key VAULT_STRIPE_KEY   # restricted: charges read + refunds write
stripe projects variables set read-stripe-key  --env-key READ_STRIPE_KEY    # restricted: read-only
```

Then `npm run secrets:sync` pushes the Worker's secrets from the Stripe Projects `.env` to Cloudflare. It **refuses** to push `VAULT_STRIPE_KEY`.

**CreateOS Sandbox** (`@nodeops-createos/sandbox`, EU control plane `https://api-eu.sb.createos.sh`) provides:

- **Isolation and egress.** Every box gets a deny-by-default egress allowlist. An empty list means "open" and there is no deny token, so "none" is the single rule `127.0.0.1:9`. Each box proves at boot that HTTPS, plain HTTP and DNS to the internet fail; the result is on the Proof page.
- **Private networking.** Voters reach the vault by name on the `twokey-lab` network. The portal is on no network at all.
- **Pause and resume.** The maker and checker sleep between tickets.
- **Fork.**
  - Evidence locker: when votes disagree, the fooled maker's workspace is frozen as a fork.
  - Shadow lab: maker, checker and vault are forked onto a separate network with new vote tokens.
  - Patch race: one attacker fork per candidate patch.
- **Exec.** The orchestrator's only channel into the vault's localhost-only admin API.

## Secrets map

| Secret | Lives |
|---|---|
| `VAULT_STRIPE_KEY` (moves money) | Only inside the vault box (0600 file), injected by bootstrap from the operator's machine. Cloudflare and GitHub never hold it. |
| `READ_STRIPE_KEY`, CreateOS key, model key, `DATABASE_URL` | Cloudflare Worker secrets |
| `APPROVAL_HMAC_KEY` (human third key) | The Worker signs, the vault verifies; nowhere else, never on disk locally |
| Vote tokens | Generated when a voter box is created and passed once into its env; the vault gets only sha256. Agent code runs as an unprivileged user with a scrubbed env and cannot read them. |
| Full `sk_test_` key | Operator's machine only (`.env.local`), for seed and reset |

## Run it

Requirements: Node ≥ 22.18, the Stripe CLI with `stripe plugin install projects`, a Cloudflare account (`npx wrangler login`), and [gitleaks](https://github.com/gitleaks/gitleaks).

```sh
npm install
stripe projects init                       # once; signs you in to Stripe
# In the Stripe test Dashboard, create two restricted keys, then:
stripe projects variables set vault-stripe-key --env-key VAULT_STRIPE_KEY
stripe projects variables set read-stripe-key  --env-key READ_STRIPE_KEY
echo "STRIPE_SECRET_KEY=sk_test_..." > .env.local

npm run bootstrap     # provision, verify CreateOS (EU), create the vault box, prove egress, push secrets
npm run seed          # 3 test customers, 12 orders, 6 demo tickets
npm run deploy        # vite build + wrangler deploy
```

| Command | What it does |
|---|---|
| `npm run reset` | Re-seed between demo runs; `npm run bootstrap` also restores `decide()` v1 in the vault |
| `npm run teardown -- --yes` | Destroy every box and network |
| `npm test` | `decide()` unit tests and the vault integration test against a fake Stripe |
| `npm run lint` | biome + tsc |

Admin actions (every button and every non-GET `/api` route) sit behind **Cloudflare Access** on `/api/admin/*`. Set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` as Worker secrets; until then every admin action fails closed. Visitors get a read-only live view with emails masked.

## The 3-minute demo

1. **Proof:** Stripe Projects status and the secrets map. One money key, one box.
2. **A legitimate ticket:** both agents write code and vote; the refund appears in Stripe.
3. **The injection:** the maker is fooled, the checker refuses, "1 of 2 keys, blocked". Open the evidence-locker fork.
4. **Red team:** it finds an attack that beats both keys, and the $ counter rises. Patches race, the proof re-runs, a human merges, and the counter stops.
5. **Portal QR:** show it to the judges.

## Limits, stated plainly

- **Plan sizes.** The CreateOS Free plan runs 1 box (paused boxes count), which is enough for the vault and the egress proof. The live lab needs 5 boxes (Beginner, with `SHADOW_LAB=false`). The shadow lab and patch race need Pro. Set `PLAN_BOX_LIMIT` in `wrangler.jsonc` to match.
- **Workers Free** allows 50 subrequests per invocation. The Lab therefore runs as an alarm-driven job queue: one agent turn or box step per alarm.
- **Models.** Agents use the Anthropic SDK against OpenRouter's Anthropic-compatible API. `MODEL` defaults to a free model; set it to `anthropic/claude-sonnet-5-5` on a paid OpenRouter tier.
- **Who can reach the boxes.** Whoever holds the CreateOS API key can exec into any box, including the vault. That key is a Worker secret and never reaches the agents.
- **Portal identity.** The portal can't verify that visitors own the email they type. A Stripe refund can only return money to the original payment method, so spoofing an email cannot redirect funds.
