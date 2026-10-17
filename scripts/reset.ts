// npm run reset — re-seed between demo runs: retire the old test customers, clear the
// ledger tables, seed fresh customers and orders. Then click "Reset demo" in the dashboard,
// or run npm run bootstrap to also restore decide() v1 in the vault.
import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";
import { fail, loadEnv, ok } from "./lib.ts";
import { seed } from "./seed.ts";

const env = loadEnv();
const key = env.STRIPE_SECRET_KEY ?? env.STRIPE_SANDBOX_SECRET_KEY;
if (!key?.startsWith("sk_test_")) fail("reset needs STRIPE_SECRET_KEY=sk_test_... in .env.local");
const stripe = new Stripe(key);
for await (const c of stripe.customers.search({ query: "metadata['twokey']:'seed'" })) await stripe.customers.del(c.id);
ok("old test customers deleted");
const sql = neon(env.NEON_POSTGRES_CONNECTION_STRING);
for (const t of ["tickets", "audit", "attacks", "patches", "forks", "scenarios"]) await sql.query(`delete from ${t}`).catch(() => {});
ok("ledger tables cleared");
await seed();
