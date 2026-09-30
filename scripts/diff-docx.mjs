#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SuperDocClient } from "@superdoc/sdk";
import { parseArgs, positiveInteger } from "./args.mjs";

export async function compareDocx(basePath, targetPath, timeoutMs = 180_000) {
  const client = new SuperDocClient({ runtime: "v2" });
  let base;
  let target;
  try {
    await client.connect();
    base = await client.open({ doc: basePath, runtime: "v2" });
    target = await client.open({ doc: targetPath, runtime: "v2" });
    const targetSnapshot = await target.diff.capture({}, { timeoutMs });
    const result = await base.diff.compare({ targetSnapshot }, { timeoutMs });
    return {
      same: !result.summary.hasChanges,
      changedComponents: result.summary.changedComponents,
      baseFingerprint: result.baseFingerprint,
      targetFingerprint: result.targetFingerprint,
      result,
    };
  } finally {
    await Promise.allSettled([target?.close(), base?.close()]);
    await client.dispose();
  }
}

async function main() {
  const { positional: [basePath, targetPath], flags } = parseArgs(process.argv.slice(2), 2);
  const timeoutMs = positiveInteger(flags.get("timeout-ms") ?? "180000", "--timeout-ms");
  const report = await compareDocx(basePath, targetPath, timeoutMs);
  const out = flags.get("out");
  if (out) {
    const outputPath = path.resolve(out);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.same) process.exitCode = 2;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
