import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sandbox } from "@nodeops-createos/sandbox";
import { repinVoter } from "./boxes.ts";

const sha = "a".repeat(64);
const response = (stdout: string, exit_code = 0, error?: string) => ({ result: { stdout, stderr: "", exit_code, ...(error && { error }) }, exec_ms: 1 });

test("resume re-pins the existing voter hash to its new IP without replacing its peer", async () => {
  const voters: Record<string, { sha: string; ip: string }> = { checker: { sha: "b".repeat(64), ip: "10.0.92.15" } };
  const box = { runCommand: async (cmd: string, args: string[]) => {
    assert.equal(cmd, "python3");
    assert.equal(args[0], "-I", "root hashing must ignore agent-writable cwd and Python environment paths");
    assert.equal(args[1], "-c");
    assert.equal(args[3], "maker");
    assert.match(args[2], /hashlib.sha256/);
    assert.match(args[2], /os.environ\['VOTE_TOKEN'\]/);
    return response(`${sha}\n`);
  } } as unknown as Sandbox;
  const vault = { runCommand: async (_cmd: string, args: string[], options: { stdin: string }) => {
    assert.ok(args.includes("http://127.0.0.1:8080/admin/voters"));
    const body = JSON.parse(options.stdin);
    assert.deepEqual(Object.keys(body.voters), ["maker"]);
    assert.deepEqual(Object.keys(body.voters.maker).sort(), ["ip", "sha"]);
    Object.assign(voters, body.voters);
    return response('{"ok":true}');
  } } as unknown as Sandbox;
  await repinVoter(vault, box, "maker", "10.0.92.14");
  await repinVoter(vault, box, "maker", "10.0.92.18");
  assert.deepEqual(voters.maker, { sha, ip: "10.0.92.18" });
  assert.deepEqual(voters.checker, { sha: "b".repeat(64), ip: "10.0.92.15" });
});

test("invalid or unsuccessful identity hashes fail closed without forwarding raw output", async () => {
  const raw = "unexpected-sensitive-command-output";
  let registered = false;
  const vault = { runCommand: async () => { registered = true; return response('{"ok":true}'); } } as unknown as Sandbox;
  for (const result of [response(raw), response(sha, 1), response(sha, 0, raw)]) {
    const box = { runCommand: async () => result } as unknown as Sandbox;
    await assert.rejects(repinVoter(vault, box, "maker", "10.0.92.18"), (error: Error) => {
      assert.match(error.message, /identity hash could not be verified/);
      assert.equal(error.message.includes(raw), false);
      return true;
    });
  }
  assert.equal(registered, false);
});

test("a missing private IP and an unconfirmed vault registration cannot silently unpin a voter", async () => {
  let readIdentity = false;
  const box = { runCommand: async () => { readIdentity = true; return response(sha); } } as unknown as Sandbox;
  const vault = { runCommand: async () => response('{"ok":false}') } as unknown as Sandbox;
  await assert.rejects(repinVoter(vault, box, "checker", undefined), /refusing an unpinned voter/);
  assert.equal(readIdentity, false);
  await assert.rejects(repinVoter(vault, box, "checker", "10.0.92.19"), /not accepted/);
});
