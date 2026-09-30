import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, positiveInteger } from "../scripts/args.mjs";

test("parseArgs separates paths and flags", () => {
  const result = parseArgs(["a.docx", "b.docx", "--out", "result"], 2);
  assert.equal(result.positional.length, 2);
  assert.equal(result.flags.get("out"), "result");
});

test("positiveInteger rejects invalid timeouts", () => {
  assert.equal(positiveInteger("180000", "timeout"), 180000);
  assert.throws(() => positiveInteger("0", "timeout"));
});
