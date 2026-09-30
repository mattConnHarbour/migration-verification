#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { parseArgs, positiveInteger } from "../args.mjs";
import { startBrowserHarness, waitUntilReady } from "../browser-harness.mjs";

const HERE = fileURLToPath(import.meta.url);

export async function compareImages(referencePath, candidatePath, options) {
  await Promise.all([access(referencePath), access(candidatePath)]);
  const outputRoot = path.resolve(options.out);
  const referenceDir = path.join(outputRoot, "reference");
  const candidateDir = path.join(outputRoot, "candidate");
  const diffDir = path.join(outputRoot, "diff");
  await Promise.all([
    mkdir(referenceDir, { recursive: true }),
    mkdir(candidateDir, { recursive: true }),
    mkdir(diffDir, { recursive: true }),
  ]);

  const fixtures = {
    "/reference.docx": await readFile(referencePath),
    "/candidate.docx": await readFile(candidatePath),
  };
  const harness = await startBrowserHarness(fixtures);
  const browser = await chromium.launch({ headless: true });
  try {
    await captureDocument(browser, `${harness.origin}/browser/index.html?fixture=/reference.docx`, referenceDir, options.timeoutMs);
    await captureDocument(browser, `${harness.origin}/browser/index.html?fixture=/candidate.docx`, candidateDir, options.timeoutMs);
  } finally {
    await browser.close();
    await harness.close();
  }

  const referencePages = await readPages(referenceDir);
  const candidatePages = await readPages(candidateDir);
  const pageCount = Math.max(referencePages.length, candidatePages.length);
  const pages = [];
  for (let index = 0; index < pageCount; index += 1) {
    const reference = referencePages[index] ?? null;
    const candidate = candidatePages[index] ?? null;
    if (!reference || !candidate) {
      pages.push({ page: index + 1, changed: true, reason: "missing-page", changedPixelRatio: 1 });
      continue;
    }
    const normalized = normalizePair(reference.png, candidate.png);
    const diff = new PNG({ width: normalized.width, height: normalized.height });
    const changedPixels = pixelmatch(
      normalized.reference.data,
      normalized.candidate.data,
      diff.data,
      normalized.width,
      normalized.height,
      { threshold: options.pixelThreshold },
    );
    const changedPixelRatio = changedPixels / (normalized.width * normalized.height);
    const changed = changedPixelRatio > options.changedRatioThreshold;
    const prefix = `page-${String(index + 1).padStart(4, "0")}`;
    await writeFile(path.join(diffDir, `${prefix}-diff.png`), PNG.sync.write(diff));
    await writeFile(
      path.join(diffDir, `${prefix}-triptych.png`),
      PNG.sync.write(triptych(normalized.reference, normalized.candidate, diff)),
    );
    pages.push({
      page: index + 1,
      changed,
      changedPixels,
      changedPixelRatio,
      referenceSize: [reference.png.width, reference.png.height],
      candidateSize: [candidate.png.width, candidate.png.height],
      triptych: `${prefix}-triptych.png`,
    });
  }

  const report = {
    schemaVersion: "migration-verification/image-compare/v1",
    reference: referencePath,
    candidate: candidatePath,
    same: referencePages.length === candidatePages.length && pages.every((page) => !page.changed),
    referencePageCount: referencePages.length,
    candidatePageCount: candidatePages.length,
    changedPageCount: pages.filter((page) => page.changed).length,
    pixelThreshold: options.pixelThreshold,
    changedRatioThreshold: options.changedRatioThreshold,
    pages,
  };
  const reportPath = path.join(outputRoot, "report.json");
  const htmlPath = path.join(outputRoot, "index.html");
  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(htmlPath, htmlReport(report)),
  ]);
  return { ...report, reportPath, htmlPath };
}

async function captureDocument(browser, url, outputDir, timeoutMs) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await waitUntilReady(page, timeoutMs);
    const pages = page.locator(".superdoc-page");
    const count = await pages.count();
    for (let index = 0; index < count; index += 1) {
      const pageElement = pages.nth(index);
      await pageElement.scrollIntoViewIfNeeded({ timeout: timeoutMs });
      await page.waitForTimeout(50);
      await pageElement.screenshot({
        path: path.join(outputDir, `page-${String(index + 1).padStart(4, "0")}.png`),
        animations: "disabled",
      });
    }
  } finally {
    await context.close();
  }
}

async function readPages(directory) {
  const entries = [];
  for (let index = 1; ; index += 1) {
    const file = path.join(directory, `page-${String(index).padStart(4, "0")}.png`);
    try {
      entries.push({ file, png: PNG.sync.read(await readFile(file)) });
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  return entries;
}

function whiteCanvas(width, height) {
  const result = new PNG({ width, height });
  result.data.fill(255);
  return result;
}

function paste(target, source, offsetX = 0, offsetY = 0) {
  PNG.bitblt(source, target, 0, 0, source.width, source.height, offsetX, offsetY);
}

function normalizePair(reference, candidate) {
  const width = Math.max(reference.width, candidate.width);
  const height = Math.max(reference.height, candidate.height);
  const normalizedReference = whiteCanvas(width, height);
  const normalizedCandidate = whiteCanvas(width, height);
  paste(normalizedReference, reference);
  paste(normalizedCandidate, candidate);
  return { width, height, reference: normalizedReference, candidate: normalizedCandidate };
}

function triptych(reference, candidate, diff) {
  const gap = 16;
  const result = whiteCanvas(reference.width * 3 + gap * 2, reference.height);
  paste(result, reference, 0, 0);
  paste(result, candidate, reference.width + gap, 0);
  paste(result, diff, (reference.width + gap) * 2, 0);
  return result;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function htmlReport(report) {
  const rows = report.pages.map((page) => `<section><h2>Page ${page.page}: ${page.changed ? "changed" : "same"}</h2>${page.triptych ? `<img src="diff/${page.triptych}" alt="Reference, candidate, and difference for page ${page.page}">` : "<p>Page missing from one document.</p>"}</section>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>DOCX image comparison</title><style>body{font:14px system-ui;margin:24px;background:#eee}img{max-width:100%;background:white}section{margin:32px 0}code{word-break:break-all}</style></head><body><h1>${report.same ? "Same" : "Different"}</h1><p><code>${escapeHtml(report.reference)}</code><br><code>${escapeHtml(report.candidate)}</code></p><p>${report.referencePageCount} reference pages, ${report.candidatePageCount} candidate pages, ${report.changedPageCount} changed.</p>${rows}</body></html>`;
}

async function main() {
  const { positional: [reference, candidate], flags } = parseArgs(process.argv.slice(2), 2);
  const out = flags.get("out");
  if (!out) throw new Error("--out is required");
  const report = await compareImages(reference, candidate, {
    out,
    timeoutMs: positiveInteger(flags.get("timeout-ms") ?? "180000", "--timeout-ms"),
    pixelThreshold: Number(flags.get("pixel-threshold") ?? "0.1"),
    changedRatioThreshold: Number(flags.get("changed-ratio-threshold") ?? "0.001"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.same) process.exitCode = 2;
}

if (path.resolve(process.argv[1] ?? "") === HERE) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
