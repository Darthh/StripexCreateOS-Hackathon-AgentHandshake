import assert from "node:assert/strict";
import { test } from "node:test";
import { syncCreateosRuntime } from "../scripts/createos-runtime.ts";

const hmac = "existing-vault-matching-hmac-".repeat(3);
const target = { project: "project-id", environment: "test-env" };
function fixture() {
  const writes: { path: string; body: any }[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get("X-Api-Key"), "test-project-key");
    const path = new URL(String(url)).pathname;
    if (init?.method === "PUT") {
      writes.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({ data: "updated" });
    }
    const data = path.endsWith("/environments")
      ? [{ id: target.environment, settings: { runEnvs: { APPROVAL_HMAC_KEY: hmac, UNRELATED_ENV: "keep" } } }]
      : { settings: { runtime: "dockerfile", port: 8080, runEnvs: { UNRELATED_PROJECT: "keep" } } };
    return Response.json({ data });
  };
  return { request, writes };
}

test("CreateOS runtime sync preserves settings and deploy keeps the vault's HMAC", async () => {
  const { request, writes } = fixture();
  const result = await syncCreateosRuntime(target, { READ_STRIPE_KEY: "rk_test_read", PUBLIC_URL: "https://example.com" }, "test-project-key", request);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map((write) => write.body.runEnvs.APPROVAL_HMAC_KEY), [hmac, hmac]);
  assert.equal(writes[0].body.runEnvs.UNRELATED_ENV, "keep");
  assert.equal(writes[1].body.runEnvs.UNRELATED_PROJECT, "keep");
  assert.equal(writes[1].body.runtime, "dockerfile");
  assert.equal(writes[1].body.port, 8080);
  assert.equal(writes[1].body.runEnvs.READ_STRIPE_KEY, "rk_test_read");
  assert.ok(result.keys.includes("APPROVAL_HMAC_KEY"));
  assert.equal("APPROVAL_HMAC_KEY" in result, false, "return metadata never includes values");
});

test("bootstrap's freshly installed HMAC replaces both runtime scopes", async () => {
  const { request, writes } = fixture();
  const fresh = "fresh-vault-matching-hmac-".repeat(3);
  await syncCreateosRuntime(target, { APPROVAL_HMAC_KEY: fresh }, "test-project-key", request);
  assert.deepEqual(writes.map((write) => write.body.runEnvs.APPROVAL_HMAC_KEY), [fresh, fresh]);
});

test("CreateOS runtime sync rejects vault, full and live Stripe credentials before network access", async () => {
  const unsafe: Record<string, string>[] = [{ VAULT_STRIPE_KEY: "rk_test_vault" }, { MODEL_API_KEY: "sk_test_full" }, { READ_STRIPE_KEY: "rk_live_read" }, { MODEL_API_KEY: "rk_test_vault" }];
  for (const update of unsafe) {
    let called = false;
    const request: typeof fetch = async () => { called = true; throw new Error("must not run"); };
    await assert.rejects(syncCreateosRuntime(target, update, "test-project-key", request), /Refusing unsafe/);
    assert.equal(called, false);
  }
});

test("deploy fails before writes if no vault-matching HMAC is configured", async () => {
  const { request, writes } = fixture();
  const withoutHmac: typeof fetch = async (url, init) => {
    if (String(url).endsWith("/environments")) return Response.json({ data: [{ id: target.environment, settings: {} }] });
    return request(url, init);
  };
  await assert.rejects(syncCreateosRuntime(target, {}, "test-project-key", withoutHmac), /run bootstrap/);
  assert.equal(writes.length, 0);
});

test("CreateOS runtime errors never expose a response body or raw transport error", async () => {
  const privateText = "credential-bearing server detail";
  for (const request of [async () => new Response(privateText, { status: 403 }), async () => { throw new Error(privateText); }]) {
    await assert.rejects(syncCreateosRuntime(target, {}, "test-project-key", request), (error: Error) => {
      assert.match(error.message, /CreateOS runtime synchronization failed/);
      assert.equal(error.message.includes(privateText), false);
      return true;
    });
  }
});
