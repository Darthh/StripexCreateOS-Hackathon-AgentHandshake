// Neon Postgres over HTTP (works on Workers): tickets, the vote/decision audit log,
// attacks (the eval suite), patches and evidence-locker forks.
import { neon } from "@neondatabase/serverless";

export const db = (url: string) => neon(url);

// Driver errors can echo connection strings and keys; scrub before logging or broadcasting.
export const redact = (s: string) =>
  s
    .replace(/postgres(ql)?:\/\/[^\s'"]+/g, "postgres://<redacted>")
    .replace(/\b(sk|rk)_(test|live)_[A-Za-z0-9]+/g, "$1_$2_<redacted>")
    .replace(/\bsk-or-[A-Za-z0-9-]+/g, "sk-or-<redacted>");
export type Sql = ReturnType<typeof db>;

export const SCHEMA = [
  `create table if not exists tickets (
    id text primary key,
    lab text not null default 'live',
    source text not null,
    customer_id text not null,
    customer_email text,
    charge_id text not null,
    amount_cents int not null,
    reason_code text not null,
    free_text text not null default '',
    status text not null default 'received',
    keys int not null default 0,
    decision jsonb,
    maker jsonb,
    checker jsonb,
    refund_id text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now())`,
  `create table if not exists audit (
    id bigserial primary key,
    at timestamptz not null default now(),
    lab text not null default 'live',
    ticket_id text,
    box text,
    kind text not null,
    data jsonb not null default '{}')`,
  `create table if not exists attacks (
    id text primary key,
    name text not null,
    source text not null,
    kind text not null,
    payload jsonb not null,
    case_input jsonb,
    result_before text,
    result_now text,
    unauthorized_cents int not null default 0,
    created_at timestamptz not null default now())`,
  `create table if not exists patches (
    id text primary key,
    attack_id text,
    title text not null,
    target text not null,
    diff text not null,
    code text not null,
    race jsonb,
    suite_passed boolean not null default false,
    status text not null default 'proposed',
    created_at timestamptz not null default now())`,
  `create table if not exists scenarios (
    id text primary key,
    name text not null,
    kind text not null,
    fields jsonb not null)`,
  `create table if not exists forks (
    id text primary key,
    sandbox_id text not null,
    ticket_id text,
    reason text not null,
    status text not null default 'frozen',
    created_at timestamptz not null default now())`,
];

export async function ensureSchema(sql: Sql) {
  for (const s of SCHEMA) await sql.query(s);
}

export const audit = (sql: Sql, kind: string, data: Record<string, unknown>, ticket_id: string | null = null, box: string | null = null, lab = "live") =>
  sql`insert into audit (kind, data, ticket_id, box, lab) values (${kind}, ${JSON.stringify(data)}, ${ticket_id}, ${box}, ${lab})`;
