#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, positiveInteger } from "./args.mjs";
import { compareImages, parsePageSelection } from "./compare/image.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runMigration(input, output, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts/migrate-collaboration-document.mjs"),
      input,
      "--out", output,
      "--timeout-ms", String(timeoutMs),
    ], { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function collectDocuments(input) {
  const info = await stat(input);
  if (info.isFile()) {
    if (path.extname(input).toLowerCase() !== ".docx") throw new Error("Input file must be a DOCX");
    return [input];
  }
  if (!info.isDirectory()) throw new Error("Input must be a DOCX or directory");
  return (await readdir(input, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".docx")
    .map((entry) => path.join(input, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function safeName(file) {
  const value = path.basename(file, path.extname(file))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return value || "document";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(rows) {
  const headers = [
    "document", "migration_status", "image_status", "comparison_verdict", "visual_same",
    "reference_pages", "candidate_pages", "pages_compared", "pages_unchecked", "changed_pages",
    "failure_reason", "v1_export", "v2_export",
    "migration_report", "image_report", "html_report", "images_retained",
  ];
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

function writePageCsv(rows) {
  const headers = [
    "document", "document_id", "input_bytes", "reference_bytes", "candidate_bytes",
    "page", "comparison_order", "reference_page_count", "candidate_page_count", "changed",
    "changed_pixels", "changed_pixel_ratio", "reference_width", "reference_height",
    "candidate_width", "candidate_height", "total_ms", "capture_ms", "reference_capture_ms",
    "candidate_capture_ms", "compare_ms",
    "artifact_write_ms", "memory_interval_ms", "memory_sample_count", "min_tree_rss_mib",
    "avg_tree_rss_mib", "median_tree_rss_mib", "p95_tree_rss_mib", "max_tree_rss_mib",
    "tree_rss_range_mib", "memory_error",
  ];
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

function kibToMib(value) {
  return value == null ? "" : (value / 1024).toFixed(3);
}

export async function runMigrationVerification(argv = process.argv.slice(2)) {
  const { positional: [input], flags } = parseArgs(argv, 1, {
    booleanFlags: ["keep-images", "image-only", "profile-pages"],
  });
  const out = flags.get("out");
  if (typeof out !== "string") throw new Error("--out is required");
  const outputRoot = path.resolve(out);
  const timeoutMs = positiveInteger(flags.get("timeout-ms") ?? "180000", "--timeout-ms");
  const pixelThreshold = Number(flags.get("pixel-threshold") ?? "0.1");
  const changedRatioThreshold = Number(flags.get("changed-ratio-threshold") ?? "0.001");
  const pages = parsePageSelection(flags.get("pages") ?? "all");
  const profilePages = flags.get("profile-pages") === true;
  const keepImages = flags.get("keep-images") === true;
  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length > 0) throw new Error("--out must be empty");

  const documents = await collectDocuments(input);
  if (documents.length === 0) throw new Error("Input directory contains no DOCX files");
  const documentsRoot = path.join(outputRoot, "documents");
  await mkdir(documentsRoot);
  const rows = [];
  const pageRows = [];

  for (const [index, document] of documents.entries()) {
    const id = `${String(index + 1).padStart(3, "0")}-${safeName(document)}`;
    const documentRoot = path.join(documentsRoot, id);
    const migrationRoot = path.join(documentRoot, "migration");
    await mkdir(documentRoot);
    process.stderr.write(`[${index + 1}/${documents.length}] ${path.basename(document)}\n`);
    const migration = await runMigration(document, migrationRoot, timeoutMs);
    const row = {
      document: path.basename(document),
      migration_status: migration.code === 0 ? "completed" : "failed",
      image_status: "not_run",
      comparison_verdict: "",
      visual_same: "",
      reference_pages: "",
      candidate_pages: "",
      pages_compared: "",
      pages_unchecked: "",
      changed_pages: "",
      failure_reason: "",
      v1_export: path.join(migrationRoot, "ingested-v1.docx"),
      v2_export: path.join(migrationRoot, "ingested-v2.docx"),
      migration_report: path.join(migrationRoot, "report.json"),
      image_report: "",
      html_report: "",
      images_retained: keepImages ? "yes" : "no",
    };

    if (migration.code !== 0) {
      row.failure_reason = (migration.stderr || migration.stdout || `migration exited ${migration.signal ?? migration.code}`).trim();
      rows.push(row);
      continue;
    }

    let temporaryImageRoot = null;
    const imageRoot = keepImages
      ? path.join(documentRoot, "images")
      : (temporaryImageRoot = await mkdtemp(path.join(os.tmpdir(), "migration-verification-images-")));
    try {
      const image = await compareImages(row.v1_export, row.v2_export, {
        out: imageRoot,
        timeoutMs,
        pixelThreshold,
        changedRatioThreshold,
        pages,
        profilePages,
      });
      row.image_status = "completed";
      row.comparison_verdict = image.verdict;
      row.visual_same = image.verdict === "same" ? "yes" : image.verdict === "different" ? "no" : "";
      row.reference_pages = image.referencePageCount;
      row.candidate_pages = image.candidatePageCount;
      row.pages_compared = image.comparedPageCount;
      row.pages_unchecked = image.uncheckedPageCount;
      row.changed_pages = image.changedPageCount;
      if (profilePages) {
        const [inputInfo, referenceInfo, candidateInfo] = await Promise.all([
          stat(document),
          stat(row.v1_export),
          stat(row.v2_export),
        ]);
        for (const page of image.pages) {
          const memory = page.performance?.memory;
          pageRows.push({
            document: path.basename(document),
            document_id: id,
            input_bytes: inputInfo.size,
            reference_bytes: referenceInfo.size,
            candidate_bytes: candidateInfo.size,
            page: page.page,
            comparison_order: page.comparisonOrder,
            reference_page_count: image.referencePageCount,
            candidate_page_count: image.candidatePageCount,
            changed: page.changed ? "yes" : "no",
            changed_pixels: page.changedPixels,
            changed_pixel_ratio: page.changedPixelRatio,
            reference_width: page.referenceSize?.[0],
            reference_height: page.referenceSize?.[1],
            candidate_width: page.candidateSize?.[0],
            candidate_height: page.candidateSize?.[1],
            total_ms: page.performance?.totalMs?.toFixed(3),
            capture_ms: page.performance?.captureMs?.toFixed(3),
            reference_capture_ms: page.performance?.referenceCaptureMs?.toFixed(3),
            candidate_capture_ms: page.performance?.candidateCaptureMs?.toFixed(3),
            compare_ms: page.performance?.compareMs?.toFixed(3),
            artifact_write_ms: page.performance?.artifactWriteMs?.toFixed(3),
            memory_interval_ms: memory?.intervalMs,
            memory_sample_count: memory?.sampleCount,
            min_tree_rss_mib: kibToMib(memory?.minRssKib),
            avg_tree_rss_mib: kibToMib(memory?.avgRssKib),
            median_tree_rss_mib: kibToMib(memory?.medianRssKib),
            p95_tree_rss_mib: kibToMib(memory?.p95RssKib),
            max_tree_rss_mib: kibToMib(memory?.maxRssKib),
            tree_rss_range_mib: memory?.minRssKib == null || memory?.maxRssKib == null
              ? ""
              : ((memory.maxRssKib - memory.minRssKib) / 1024).toFixed(3),
            memory_error: memory?.error ?? "",
          });
        }
      }
      if (keepImages) {
        row.image_report = image.reportPath;
        row.html_report = image.htmlPath;
      }
    } catch (error) {
      row.image_status = "failed";
      const imageFailure = error instanceof Error ? error.stack ?? error.message : String(error);
      row.failure_reason = row.failure_reason ? `${row.failure_reason} | ${imageFailure}` : imageFailure;
    } finally {
      if (temporaryImageRoot) await rm(temporaryImageRoot, { recursive: true, force: true });
    }
    rows.push(row);
  }

  const csvPath = path.join(outputRoot, "report.csv");
  await writeFile(csvPath, writeCsv(rows));
  const pageCsvPath = profilePages ? path.join(outputRoot, "page-performance.csv") : null;
  if (pageCsvPath) await writeFile(pageCsvPath, writePageCsv(pageRows));
  const summary = {
    documents: rows.length,
    migrationsCompleted: rows.filter((row) => row.migration_status === "completed").length,
    imagesCompleted: rows.filter((row) => row.image_status === "completed").length,
    visuallySame: rows.filter((row) => row.visual_same === "yes").length,
    sampledPass: rows.filter((row) => row.comparison_verdict === "sampled_pass").length,
    visuallyDifferent: rows.filter((row) => row.comparison_verdict === "different").length,
    failures: rows.filter((row) => row.migration_status === "failed" || row.image_status === "failed").length,
    comparisonMode: "image",
    imagesRetained: keepImages,
    pageProfiles: pageRows.length,
    csv: csvPath,
    pageCsv: pageCsvPath,
  };
  await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (rows.some((row) => row.migration_status === "failed" || row.image_status === "failed")) process.exitCode = 1;
  else if (rows.some((row) => row.comparison_verdict === "different")) process.exitCode = 2;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runMigrationVerification().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
