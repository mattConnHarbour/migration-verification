#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import { Window } from "happy-dom";
import { unzipSync } from "fflate";
import { Server } from "@hocuspocus/server";
import { chromium } from "playwright";
import { Editor } from "superdoc-final-v1/super-editor";
import { upgradeCollaboration } from "@superdoc/v2-collaboration-upgrade";
import { createHocuspocusUpgradeAdapter } from "@superdoc/v2-collaboration-upgrade/hocuspocus";
import { parseArgs, positiveInteger } from "./args.mjs";
import { startBrowserHarness, waitUntilReady } from "./browser-harness.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function seedV1Room(source) {
  const window = new Window();
  const editor = await Editor.open(source, {
    document: window.document,
    isHeadless: true,
    telemetry: { enabled: false },
  });
  try {
    return new Uint8Array(await editor.generateCollaborationUpdate());
  } finally {
    editor.destroy();
    window.close();
  }
}

function createVerificationState() {
  const checkpoints = new Map();
  let active = null;
  return {
    checkpoint: {
      read: async ({ attemptId }) => checkpoints.get(attemptId) ?? null,
      createIfAbsent: async ({ key, checkpoint }) => {
        if (!checkpoints.has(key.attemptId)) checkpoints.set(key.attemptId, checkpoint);
        return checkpoints.get(key.attemptId);
      },
    },
    readActive: async () => active,
    activate: async (candidate) => {
      const routingVersion = "verification-route-1";
      if (!active) {
        active = {
          state: "activated",
          migrationId: candidate.migrationId,
          documentId: candidate.documentId,
          sourceRoomId: candidate.sourceRoomId,
          targetRoomId: candidate.targetRoomId,
          providerRoomName: candidate.providerRoomName,
          evidenceTier: candidate.evidenceTier,
          providerEvidence: candidate.providerEvidence,
          targetDisposition: candidate.targetDisposition,
          recoveryBundleSha256: candidate.recoveryBundleSha256,
          targetUpdateSha256: candidate.targetUpdateSha256,
          validation: candidate.validation,
          activation: {
            protocolVersion: 1,
            idempotencyKey: candidate.idempotencyKey,
            migrationId: candidate.migrationId,
            documentId: candidate.documentId,
            targetRoomId: candidate.targetRoomId,
            providerRoomName: candidate.providerRoomName,
            disposition: "activated",
            routingVersion,
          },
        };
      }
      return { disposition: active.activation.idempotencyKey === candidate.idempotencyKey ? "activated" : "already-active", routingVersion };
    },
    recoveryBundle: () => {
      const checkpoint = checkpoints.values().next().value;
      if (!checkpoint?.prepared?.recoveryBundle) throw new Error("Upgrade did not persist a recovery bundle");
      return checkpoint.prepared.recoveryBundle;
    },
    snapshot: () => ({ active, checkpointCount: checkpoints.size }),
  };
}

async function exportV2Room({ serverUrl, targetRoomId, shell, outputPath, timeoutMs }) {
  const harness = await startBrowserHarness({ "/fixture.docx": shell });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  try {
    const query = new URLSearchParams({
      mode: "collaboration",
      fixture: "/fixture.docx",
      serverUrl,
      documentId: targetRoomId,
      timeoutMs: String(timeoutMs),
    });
    await page.goto(`${harness.origin}/browser/index.html?${query}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitUntilReady(page, timeoutMs);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: timeoutMs }),
      page.evaluate(() => window.__verification.instance.export({
        exportType: ["docx"],
        exportedName: "ingested-v2",
        triggerDownload: true,
        isFinalDoc: false,
      })),
    ]);
    await download.saveAs(outputPath);
  } finally {
    await context.close();
    await browser.close();
    await harness.close();
  }
}

async function main() {
  const { positional: [input], flags } = parseArgs(process.argv.slice(2), 1);
  const out = flags.get("out");
  if (!out) throw new Error("--out is required");
  const outputRoot = path.resolve(out);
  const timeoutMs = positiveInteger(flags.get("timeout-ms") ?? "180000", "--timeout-ms");
  await access(input);
  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length > 0) throw new Error("--out must be empty");

  const source = new Uint8Array(await readFile(input));
  const sourceRoomId = `verification-v1-${randomUUID()}`;
  const documentId = `verification-${randomUUID()}`;
  const sourceUpdate = await seedV1Room(source);
  const rooms = new Map([[sourceRoomId, sourceUpdate]]);
  const server = Server.configure({
    address: "127.0.0.1",
    port: 0,
    quiet: true,
    debounce: 0,
    maxDebounce: 0,
    async onLoadDocument({ documentName, document }) {
      const bytes = rooms.get(documentName);
      if (bytes) applyUpdate(document, bytes);
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      rooms.set(documentName, encodeStateAsUpdate(document));
    },
  });
  await server.listen(0);
  const serverUrl = `ws://127.0.0.1:${server.address.port}`;

  try {
    const state = createVerificationState();
    const receipt = await upgradeCollaboration({
      documentId,
      sourceRoomId,
      provider: createHocuspocusUpgradeAdapter({
        url: serverUrl,
        connectTimeoutMs: timeoutMs,
        writePropagationMs: 250,
      }),
      checkpoint: state.checkpoint,
      readActive: state.readActive,
      activate: state.activate,
    });

    const v1DocxPath = path.join(outputRoot, "ingested-v1.docx");
    const v2DocxPath = path.join(outputRoot, "ingested-v2.docx");
    const bundleEntries = unzipSync(state.recoveryBundle());
    const v1Docx = bundleEntries["carrier/document.docx"];
    if (!v1Docx) throw new Error("Recovery bundle did not contain carrier/document.docx");
    await writeFile(v1DocxPath, v1Docx);
    await exportV2Room({
      serverUrl,
      targetRoomId: receipt.targetRoomId,
      shell: v1Docx,
      outputPath: v2DocxPath,
      timeoutMs,
    });

    const report = {
      schemaVersion: "migration-verification/migration/v1",
      pipeline: ["disk", "v1-room", "v1-export", "v2-room", "v2-export"],
      input,
      inputSha256: sha256(source),
      sourceRoomId,
      targetRoomId: receipt.targetRoomId,
      providerRoomName: receipt.providerRoomName,
      sourceUpdateSha256: sha256(sourceUpdate),
      receipt,
      verificationState: state.snapshot(),
      artifacts: { v1Docx: v1DocxPath, v2Docx: v2DocxPath },
    };
    const reportPath = path.join(outputRoot, "report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ migrated: true, v1Docx: v1DocxPath, v2Docx: v2DocxPath, report: reportPath }, null, 2)}\n`);
  } finally {
    await server.destroy();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
