#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function usage() {
  console.error("Usage: node report-generators/consolidate-page-performance.mjs --out <csv> <page-performance.csv> [more.csv ...]");
  process.exit(2);
}

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex === -1 || !args[outIndex + 1]) usage();
const output = path.resolve(args[outIndex + 1]);
const inputs = args.filter((_, index) => index !== outIndex && index !== outIndex + 1).map(file => path.resolve(file));
if (inputs.length === 0) usage();

let header;
const rows = [];
for (const input of inputs) {
  const lines = fs.readFileSync(input, "utf8").replace(/\r\n/g, "\n").trimEnd().split("\n");
  if (!lines[0]) throw new Error(`CSV is empty: ${input}`);
  if (header === undefined) header = lines[0];
  if (lines[0] !== header) throw new Error(`CSV header does not match: ${input}`);
  rows.push(...lines.slice(1));
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${header}\n${rows.join("\n")}\n`);
console.log(JSON.stringify({ output, inputs: inputs.length, rows: rows.length }, null, 2));
