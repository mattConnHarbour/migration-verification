import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { compareImages } from "../scripts/compare/image.mjs";
import { compareDocumentStructure } from "../scripts/compare/structure.mjs";
import { writeSyntheticDocx } from "./helpers/synthetic-docx.mjs";

const timeoutMs = 180_000;
let workspace;
let fixtures;

before(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "migration-verification-test-"));
  fixtures = {
    sameV1: path.join(workspace, "same-v1.docx"),
    sameV2: path.join(workspace, "same-v2.docx"),
    changedV1: path.join(workspace, "changed-v1.docx"),
    changedV2: path.join(workspace, "changed-v2.docx"),
  };

  const unchanged = [
    { text: "Synthetic migration fixture", size: 32, bold: true },
    { text: "This document is identical in the v1 and v2 fixtures." },
  ];
  await Promise.all([
    writeSyntheticDocx(fixtures.sameV1, unchanged),
    writeSyntheticDocx(fixtures.sameV2, unchanged),
    writeSyntheticDocx(fixtures.changedV1, [
      { text: "Synthetic migration fixture", size: 32, bold: true },
      { text: "This is the v1 baseline document." },
    ]),
    writeSyntheticDocx(fixtures.changedV2, [
      { text: "Synthetic migration fixture — changed", size: 48, bold: true },
      { text: "This is the visibly and structurally different v2 document.", size: 32 },
      { text: "An additional paragraph makes the expected change unambiguous.", size: 32 },
    ]),
  ]);
});

after(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("structural comparison recognizes identical and changed generated pairs", { timeout: timeoutMs }, async () => {
  const same = await compareDocumentStructure(fixtures.sameV1, fixtures.sameV2, timeoutMs);
  assert.equal(same.same, true);
  assert.deepEqual(same.changedComponents, []);

  const changed = await compareDocumentStructure(fixtures.changedV1, fixtures.changedV2, timeoutMs);
  assert.equal(changed.same, false);
  assert.equal(changed.result.summary.hasChanges, true);
  assert.ok(changed.changedComponents.length > 0);
});

test("image comparison recognizes identical and changed generated pairs", { timeout: timeoutMs }, async () => {
  const same = await compareImages(fixtures.sameV1, fixtures.sameV2, {
    out: path.join(workspace, "same-images"),
    timeoutMs,
    pixelThreshold: 0.1,
    changedRatioThreshold: 0.001,
  });
  assert.equal(same.same, true);
  assert.equal(same.changedPageCount, 0);
  assert.equal(same.referencePageCount, same.candidatePageCount);

  const changed = await compareImages(fixtures.changedV1, fixtures.changedV2, {
    out: path.join(workspace, "changed-images"),
    timeoutMs,
    pixelThreshold: 0.1,
    changedRatioThreshold: 0.001,
  });
  assert.equal(changed.same, false);
  assert.ok(changed.changedPageCount > 0);
  assert.ok(changed.pages.some((page) => page.changedPixelRatio > 0.001));
});
