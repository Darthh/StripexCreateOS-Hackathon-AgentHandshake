import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./db.ts";

test("redact scrubs connection strings and keys from error messages", () => {
  const msg = "bad (connection string: 'postgresql://user:pw@host/db?sslmode=require') key sk_test_abc123 rk_live_x9 sk-or-v1-abc";
  assert.equal(redact(msg), "bad (connection string: 'postgres://<redacted>') key sk_test_<redacted> rk_live_<redacted> sk-or-<redacted>");
});
