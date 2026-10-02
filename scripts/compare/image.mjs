#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { parseArgs, positiveInteger } from "../args.mjs";
import { startBrowserHarness, waitUntilReady } from "../browser-harness.mjs";

const HERE = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);

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
  let comparison;
  try {
    comparison = await compareRenderedDocuments(browser, {
      referenceUrl: `${harness.origin}/browser/index.html?fixture=/reference.docx`,
      candidateUrl: `${harness.origin}/browser/index.html?fixture=/candidate.docx`,
      referenceDir,
      candidateDir,
      diffDir,
      timeoutMs: options.timeoutMs,
      pixelThreshold: options.pixelThreshold,
      changedRatioThreshold: options.changedRatioThreshold,
      pageSelection: options.pages ?? "all",
      profilePages: options.profilePages === true,
    });
  } finally {
    await browser.close();
    await harness.close();
  }

  const report = {
    schemaVersion: "migration-verification/image-compare/v2",
    reference: referencePath,
    candidate: candidatePath,
    ...comparison,
    pixelThreshold: options.pixelThreshold,
    changedRatioThreshold: options.changedRatioThreshold,
  };
  const reportPath = path.join(outputRoot, "report.json");
  const htmlPath = path.join(outputRoot, "index.html");
  await Promise.all([
    writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(htmlPath, htmlReport(report)),
  ]);
  return { ...report, reportPath, htmlPath };
}

export function progressiveMidpointOrder(pageCount) {
  if (!Number.isInteger(pageCount) || pageCount < 0) throw new Error("pageCount must be a non-negative integer");
  if (pageCount === 0) return [];
  const result = [];
  const seen = new Set();
  const add = (index) => {
    if (index >= 0 && index < pageCount && !seen.has(index)) {
      seen.add(index);
      result.push(index);
    }
  };
  add(0);
  add(pageCount - 1);
  let intervals = pageCount > 1 ? [[0, pageCount - 1]] : [];
  while (intervals.length > 0) {
    const next = [];
    for (const [left, right] of intervals) {
      const middle = Math.floor((left + right) / 2);
      add(middle);
      if (middle - left > 1) next.push([left, middle]);
      if (right - middle > 1) next.push([middle, right]);
    }
    intervals = next;
  }
  return result;
}

export function parsePageSelection(value) {
  if (value == null || value === "all") return "all";
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0) throw new Error("--pages must be 'all' or a positive integer");
  return count;
}

async function openRenderedPage(context, url, timeoutMs) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitUntilReady(page, timeoutMs);
  return page;
}

async function processTreeRssKib(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="], { maxBuffer: 16 * 1024 * 1024 });
  const processes = stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  const included = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pid, parentPid] of processes) {
      if (!included.has(pid) && included.has(parentPid)) {
        included.add(pid);
        changed = true;
      }
    }
  }
  return processes.reduce((total, [pid, , rss]) => total + (included.has(pid) ? rss : 0), 0);
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

async function startMemorySampler(enabled, intervalMs = 100) {
  if (!enabled) return { stop: async () => null };
  const samples = [];
  let activeSample = null;
  let error = null;
  const sample = async () => {
    if (activeSample) return activeSample;
    activeSample = processTreeRssKib(process.pid)
      .then((rss) => samples.push(rss))
      .catch((caught) => { error = caught instanceof Error ? caught.message : String(caught); })
      .finally(() => { activeSample = null; });
    return activeSample;
  };
  await sample();
  const timer = setInterval(() => { void sample(); }, intervalMs);
  return {
    stop: async () => {
      clearInterval(timer);
      if (activeSample) await activeSample;
      await sample();
      const sorted = [...samples].sort((left, right) => left - right);
      const sum = samples.reduce((total, value) => total + value, 0);
      return {
        intervalMs,
        sampleCount: samples.length,
        minRssKib: sorted[0] ?? null,
        avgRssKib: samples.length > 0 ? sum / samples.length : null,
        medianRssKib: percentile(sorted, 0.5),
        p95RssKib: percentile(sorted, 0.95),
        maxRssKib: sorted.at(-1) ?? null,
        error,
        samplesRssKib: samples,
      };
    },
  };
}

function combineMemoryProfiles(...profiles) {
  const available = profiles.filter(Boolean);
  if (available.length === 0) return null;
  const samples = available.flatMap((profile) => profile.samplesRssKib ?? []);
  const sorted = [...samples].sort((left, right) => left - right);
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    intervalMs: available[0].intervalMs,
    sampleCount: samples.length,
    minRssKib: sorted[0] ?? null,
    avgRssKib: samples.length > 0 ? sum / samples.length : null,
    medianRssKib: percentile(sorted, 0.5),
    p95RssKib: percentile(sorted, 0.95),
    maxRssKib: sorted.at(-1) ?? null,
    error: available.map((profile) => profile.error).filter(Boolean).join(" | ") || null,
  };
}

async function compareRenderedDocuments(browser, options) {
  const browserOptions = { viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 };
  const referenceProfiles = new Map();
  let referencePageCount;
  let selectedIndexes;
  const referenceContext = await browser.newContext(browserOptions);
  try {
    const referencePage = await openRenderedPage(referenceContext, options.referenceUrl, options.timeoutMs);
    const referenceLocator = referencePage.locator(".superdoc-page");
    referencePageCount = await referenceLocator.count();
    const fullOrder = progressiveMidpointOrder(referencePageCount);
    selectedIndexes = options.pageSelection === "all"
      ? fullOrder
      : fullOrder.slice(0, Math.min(options.pageSelection, fullOrder.length));
    for (const index of selectedIndexes) {
      const started = performance.now();
      const memorySampler = await startMemorySampler(options.profilePages);
      let memory = null;
      try {
        const element = referenceLocator.nth(index);
        await element.scrollIntoViewIfNeeded({ timeout: options.timeoutMs });
        const captureStarted = performance.now();
        const bytes = await element.screenshot({ animations: "disabled" });
        const captureMs = performance.now() - captureStarted;
        const prefix = `page-${String(index + 1).padStart(4, "0")}`;
        const writeStarted = performance.now();
        await writeFile(path.join(options.referenceDir, `${prefix}.png`), bytes);
        const artifactWriteMs = performance.now() - writeStarted;
        memory = await memorySampler.stop();
        referenceProfiles.set(index, {
          totalMs: performance.now() - started,
          captureMs,
          artifactWriteMs,
          memory,
        });
      } finally {
        if (!memory) await memorySampler.stop();
      }
    }
  } finally {
    await referenceContext.close();
  }

  const candidateContext = await browser.newContext(browserOptions);
  try {
    const candidatePage = await openRenderedPage(candidateContext, options.candidateUrl, options.timeoutMs);
    const candidateLocator = candidatePage.locator(".superdoc-page");
    const candidatePageCount = await candidateLocator.count();
    if (referencePageCount !== candidatePageCount) {
      return {
        verdict: "different",
        same: false,
        sampledPass: false,
        comparisonComplete: false,
        differenceReason: "page-count-mismatch",
        referencePageCount,
        candidatePageCount,
        requestedPages: options.pageSelection,
        selectedPages: [],
        comparedPageCount: 0,
        uncheckedPageCount: Math.max(referencePageCount, candidatePageCount),
        changedPageCount: Math.abs(referencePageCount - candidatePageCount),
        pages: [],
      };
    }
    const pages = [];
    for (const [comparisonIndex, index] of selectedIndexes.entries()) {
      const pageStarted = performance.now();
      const memorySampler = await startMemorySampler(options.profilePages);
      let memory = null;
      try {
        const candidateElement = candidateLocator.nth(index);
        await candidateElement.scrollIntoViewIfNeeded({ timeout: options.timeoutMs });
        const captureStarted = performance.now();
        const candidateBytes = await candidateElement.screenshot({ animations: "disabled" });
        const candidateCaptureMs = performance.now() - captureStarted;
        const prefix = `page-${String(index + 1).padStart(4, "0")}`;
        const candidateWriteStarted = performance.now();
        await writeFile(path.join(options.candidateDir, `${prefix}.png`), candidateBytes);
        let candidateArtifactWriteMs = performance.now() - candidateWriteStarted;
        const compareStarted = performance.now();
        const referenceBytes = await readFile(path.join(options.referenceDir, `${prefix}.png`));
        const reference = PNG.sync.read(referenceBytes);
        const candidate = PNG.sync.read(candidateBytes);
        const normalized = normalizePair(reference, candidate);
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
        const compareMs = performance.now() - compareStarted;
        const reportWriteStarted = performance.now();
        await writeFile(path.join(options.diffDir, `${prefix}-diff.png`), PNG.sync.write(diff));
        await writeFile(
          path.join(options.diffDir, `${prefix}-triptych.png`),
          PNG.sync.write(triptych(normalized.reference, normalized.candidate, diff)),
        );
        candidateArtifactWriteMs += performance.now() - reportWriteStarted;
        memory = await memorySampler.stop();
        const referenceProfile = referenceProfiles.get(index);
        pages.push({
          page: index + 1,
          comparisonOrder: comparisonIndex + 1,
          changed,
          changedPixels,
          changedPixelRatio,
          referenceSize: [reference.width, reference.height],
          candidateSize: [candidate.width, candidate.height],
          triptych: `${prefix}-triptych.png`,
          performance: {
            totalMs: (referenceProfile?.totalMs ?? 0) + (performance.now() - pageStarted),
            captureMs: (referenceProfile?.captureMs ?? 0) + candidateCaptureMs,
            referenceCaptureMs: referenceProfile?.captureMs ?? null,
            candidateCaptureMs,
            compareMs,
            artifactWriteMs: (referenceProfile?.artifactWriteMs ?? 0) + candidateArtifactWriteMs,
            memory: combineMemoryProfiles(referenceProfile?.memory, memory),
          },
        });
        if (changed) break;
      } finally {
        if (!memory) await memorySampler.stop();
      }
    }
    const different = pages.some((page) => page.changed);
    const comparisonComplete = !different && pages.length === referencePageCount;
    const verdict = different ? "different" : comparisonComplete ? "same" : "sampled_pass";
    return {
      verdict,
      same: verdict === "same",
      sampledPass: verdict === "sampled_pass",
      comparisonComplete,
      differenceReason: different ? "changed-page" : null,
      referencePageCount,
      candidatePageCount,
      requestedPages: options.pageSelection,
      selectedPages: selectedIndexes.map((index) => index + 1),
      comparedPageCount: pages.length,
      uncheckedPageCount: referencePageCount - pages.length,
      changedPageCount: pages.filter((page) => page.changed).length,
      pages,
    };
  } finally {
    await candidateContext.close();
  }
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
  return `<!doctype html><html><head><meta charset="utf-8"><title>DOCX image comparison</title><style>body{font:14px system-ui;margin:24px;background:#eee}img{max-width:100%;background:white}section{margin:32px 0}code{word-break:break-all}</style></head><body><h1>${escapeHtml(report.verdict)}</h1><p><code>${escapeHtml(report.reference)}</code><br><code>${escapeHtml(report.candidate)}</code></p><p>${report.referencePageCount} reference pages, ${report.candidatePageCount} candidate pages, ${report.comparedPageCount} compared, ${report.uncheckedPageCount} unchecked, ${report.changedPageCount} changed.</p>${rows}</body></html>`;
}

async function main() {
  const { positional: [reference, candidate], flags } = parseArgs(process.argv.slice(2), 2, {
    booleanFlags: ["profile-pages"],
  });
  const out = flags.get("out");
  if (!out) throw new Error("--out is required");
  const report = await compareImages(reference, candidate, {
    out,
    timeoutMs: positiveInteger(flags.get("timeout-ms") ?? "180000", "--timeout-ms"),
    pixelThreshold: Number(flags.get("pixel-threshold") ?? "0.1"),
    changedRatioThreshold: Number(flags.get("changed-ratio-threshold") ?? "0.001"),
    pages: parsePageSelection(flags.get("pages") ?? "all"),
    profilePages: flags.get("profile-pages") === true,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.verdict === "different") process.exitCode = 2;
}

if (path.resolve(process.argv[1] ?? "") === HERE) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
