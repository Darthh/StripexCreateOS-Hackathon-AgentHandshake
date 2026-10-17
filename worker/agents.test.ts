import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { agentTurn, newJob, VOTE_TOOL } from "./agents.ts";
import type { Env } from "./index.ts";

test("a malformed successful model response becomes a retryable 502 before code or votes run", async (t) => {
  let requests = 0;
  let sandboxCalls = 0;
  let finalCalls = 0;
  const privateDetail = "unexpected-provider-body-detail";
  const provider = createServer((request, response) => {
    requests++;
    assert.equal(request.url, "/v1/messages");
    request.resume();
    response.writeHead(200, { "content-type": "application/json", connection: "close" });
    response.end(JSON.stringify({ id: "msg_bad", type: "message", role: "assistant", debug: privateDetail }));
  }).listen(0, "127.0.0.1");
  await once(provider, "listening");
  t.after(() => new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve())));
  const env = { MODEL_API_KEY: "local-fixture-key", MODEL_BASE_URL: `http://127.0.0.1:${(provider.address() as AddressInfo).port}`, MODEL: "local-fixture" } as Env;
  const unexpectedSandboxCall = async () => { sandboxCalls++; throw new Error("sandbox must not be called"); };
  const box = { files: { upload: unexpectedSandboxCall }, runCommand: unexpectedSandboxCall } as unknown as Sandbox;
  const job = newJob("Verify the refund before voting.");
  await assert.rejects(agentTurn(env, box, job, "Use code for evidence.", [VOTE_TOOL], async () => {
    finalCalls++;
    return { done: true, content: "unexpected" };
  }), (error: Error & { status?: number }) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /model provider returned an invalid message/);
    assert.equal(error.message.includes(privateDetail), false);
    return true;
  });
  assert.equal(requests, 1);
  assert.equal(sandboxCalls, 0);
  assert.equal(finalCalls, 0);
  assert.equal(job.runs, 0);
  assert.equal(job.okRuns, 0);
  assert.equal(job.turn, 0, "retryable provider failures must not consume model turns");
  assert.deepEqual(job.steps, []);
  assert.equal(job.messages.length, 1);
});
