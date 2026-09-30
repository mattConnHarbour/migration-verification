#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, positiveInteger } from "./args.mjs";
import { compareImages } from "./image-compare.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function runMigration(input, output, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "scripts/migrate-and-export.mjs"),
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
    "document", "migration_status", "structural_same", "changed_components",
    "image_status", "visual_same", "reference_pages", "candidate_pages",
    "changed_pages", "failure_reason", "v1_export", "v2_export",
    "migration_report", "image_report", "html_report", "images_retained",
  ];
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n")}\n`;
}

async function main() {
  const { positional: [input], flags } = parseArgs(process.argv.slice(2), 1, {
    booleanFlags: ["keep-images"],
  });
  const out = flags.get("out");
  if (typeof out !== "string") throw new Error("--out is required");
  const outputRoot = path.resolve(out);
  const timeoutMs = positiveInteger(flags.get("timeout-ms") ?? "180000", "--timeout-ms");
  const pixelThreshold = Number(flags.get("pixel-threshold") ?? "0.1");
  const changedRatioThreshold = Number(flags.get("changed-ratio-threshold") ?? "0.001");
  const keepImages = flags.get("keep-images") === true;
  await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length > 0) throw new Error("--out must be empty");

  const documents = await collectDocuments(input);
  if (documents.length === 0) throw new Error("Input directory contains no DOCX files");
  const documentsRoot = path.join(outputRoot, "documents");
  await mkdir(documentsRoot);
  const rows = [];

  for (const [index, document] of documents.entries()) {
    const id = `${String(index + 1).padStart(3, "0")}-${safeName(document)}`;
    const documentRoot = path.join(documentsRoot, id);
    const migrationRoot = path.join(documentRoot, "migration");
    await mkdir(documentRoot);
    process.stderr.write(`[${index + 1}/${documents.length}] ${path.basename(document)}\n`);
    const migration = await runMigration(document, migrationRoot, timeoutMs);
    const row = {
      document: path.basename(document),
      migration_status: migration.code === 0 || migration.code === 2 ? "completed" : "failed",
      structural_same: "",
      changed_components: "",
      image_status: "not_run",
      visual_same: "",
      reference_pages: "",
      candidate_pages: "",
      changed_pages: "",
      failure_reason: "",
      v1_export: path.join(migrationRoot, "ingested-v1.docx"),
      v2_export: path.join(migrationRoot, "ingested-v2.docx"),
      migration_report: path.join(migrationRoot, "report.json"),
      image_report: "",
      html_report: "",
      images_retained: keepImages ? "yes" : "no",
    };

    if (migration.code !== 0 && migration.code !== 2) {
      row.failure_reason = (migration.stderr || migration.stdout || `migration exited ${migration.signal ?? migration.code}`).trim();
      rows.push(row);
      continue;
    }

    const migrationReport = JSON.parse(await readFile(row.migration_report, "utf8"));
    row.structural_same = migrationReport.diff.same ? "yes" : "no";
    row.changed_components = migrationReport.diff.changedComponents.join(";");
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
      });
      row.image_status = "completed";
      row.visual_same = image.same ? "yes" : "no";
      row.reference_pages = image.referencePageCount;
      row.candidate_pages = image.candidatePageCount;
      row.changed_pages = image.changedPageCount;
      if (keepImages) {
        row.image_report = image.reportPath;
        row.html_report = image.htmlPath;
      }
    } catch (error) {
      row.image_status = "failed";
      row.failure_reason = error instanceof Error ? error.stack ?? error.message : String(error);
    } finally {
      if (temporaryImageRoot) await rm(temporaryImageRoot, { recursive: true, force: true });
    }
    rows.push(row);
  }

  const csvPath = path.join(outputRoot, "report.csv");
  await writeFile(csvPath, writeCsv(rows));
  const summary = {
    documents: rows.length,
    migrationsCompleted: rows.filter((row) => row.migration_status === "completed").length,
    structurallySame: rows.filter((row) => row.structural_same === "yes").length,
    visuallySame: rows.filter((row) => row.visual_same === "yes").length,
    failures: rows.filter((row) => row.migration_status === "failed" || row.image_status === "failed").length,
    imagesRetained: keepImages,
    csv: csvPath,
  };
  await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.failures > 0) process.exitCode = 1;
  else if (rows.some((row) => row.structural_same === "no" || row.visual_same === "no")) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
