import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, positiveInteger } from "../scripts/args.mjs";
import { parsePageSelection, progressiveMidpointOrder } from "../scripts/compare/image.mjs";

test("parseArgs separates paths and flags", () => {
  const result = parseArgs(["a.docx", "b.docx", "--out", "result"], 2);
  assert.equal(result.positional.length, 2);
  assert.equal(result.flags.get("out"), "result");
});

test("positiveInteger rejects invalid timeouts", () => {
  assert.equal(positiveInteger("180000", "timeout"), 180000);
  assert.throws(() => positiveInteger("0", "timeout"));
});

test("parseArgs accepts declared boolean flags", () => {
  const result = parseArgs(["a.docx", "--image-only", "--keep-images", "--out", "result"], 1, {
    booleanFlags: ["image-only", "keep-images"],
  });
  assert.equal(result.flags.get("image-only"), true);
  assert.equal(result.flags.get("keep-images"), true);
  assert.equal(result.flags.get("out"), "result");
});

test("page selection accepts all or a positive sample size", () => {
  assert.equal(parsePageSelection("all"), "all");
  assert.equal(parsePageSelection("10"), 10);
  assert.throws(() => parsePageSelection("0"));
  assert.throws(() => parsePageSelection("random"));
});

test("progressive midpoint order starts at boundaries and covers every page once", () => {
  const order = progressiveMidpointOrder(10);
  assert.deepEqual(order.slice(0, 3), [0, 9, 4]);
  assert.equal(order.length, 10);
  assert.equal(new Set(order).size, 10);
  assert.deepEqual([...order].sort((left, right) => left - right), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
