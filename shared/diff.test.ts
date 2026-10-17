import assert from "node:assert/strict";
import { test } from "node:test";
import { lineDiff } from "./diff.ts";

test("lineDiff marks added and removed lines with context", () => {
  const d = lineDiff("a\nb\nc\nd", "a\nb\nX\nd");
  assert.equal(d, "  a\n  b\n- c\n+ X\n  d");
});
