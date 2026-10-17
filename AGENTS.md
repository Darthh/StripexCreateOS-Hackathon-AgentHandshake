<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "createosxstripe".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->

## CreateOS Sandbox on Windows

- This project uses the CreateOS Free plan. Use the `s-1vcpu-1gb` sandbox shape; ask before selecting a paid plan.
- The CreateOS Sandbox plugins are installed for Codex and Claude Code. Use the plugin's `cos` driver for sandbox workloads.
- When running `cos` from Git Bash, prefix the invocation with `MSYS2_ARG_CONV_EXCL=/work` so native Windows CLI argument conversion preserves remote `/work` paths. This setting is scoped to that invocation.
- Keep credentials in the CLI-managed, ignored `.env` and `.projects/vault/` files. Do not print or commit credential values.
