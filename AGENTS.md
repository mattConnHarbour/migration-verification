# Migration verification agent guide

This is a standalone local document-migration verification tool.

## Safety and repository boundaries

- Never add input documents, exported documents, screenshots, reports, or other
  run artifacts to this repository. Pass document paths from outside the checkout
  and write results to an external directory such as `/tmp/migration-verification`.
- `*.docx`, `output/`, and run artifacts are ignored as a backstop, not as permission
  to copy document data into the checkout.
- All document servers must bind to `127.0.0.1`. Do not upload documents or add
  network-backed rendering.
- Keep package versions pinned. Version changes alter the system being measured and
  require a new end-to-end verification run.
- This repository verifies documents exclusively through rendered page images.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm run python:install
```

Use Node.js 20+ and Python 3.13. `pnpm run python:install` creates `.venv`, installs
the pinned Python packages, and installs the matching Chromium build.

## Script hierarchy

```text
scripts/migrate-collaboration-document.mjs  # standalone migration
migration_verification.py                   # image comparison and batch verification
├── scripts/migrate-collaboration-document.mjs
├── browser/ + scripts/vite-static.config.mjs
└── report-generators/generate-page-memory-chart.mjs
```

`migration_verification.py` is the verification CLI boundary. It invokes migration,
renders documents through the local browser application, compares page images with
OpenCV, and writes reports. Migration stays comparison-free; image comparison stays
independently executable.

## Independent commands

Image comparison through the public SuperDoc browser package:

```bash
pnpm image-compare -- /external/reference.docx /external/candidate.docx \
  --out /tmp/migration-verification/images \
  --timeout-ms 180000 \
  --diagnostics 2
```

The migration command produces `ingested-v1.docx`, `ingested-v2.docx`, and
`report.json`. It performs no comparison:

```bash
pnpm migrate -- /external/source.docx \
  --out /tmp/migration-verification/migration \
  --timeout-ms 180000
```

For one sequential command over a DOCX or a directory of DOCX files, use:

```bash
pnpm verify-migration -- /external/document-or-directory \
  --out /tmp/migration-verification/run --timeout-ms 180000 --diagnostics 2
```

This writes `report.csv`. Diagnostics level 0 retains only the final CSV, level 1 adds
time/memory profiling plus the final performance CSV and chart, and level 2 also
retains per-document exports, PNGs, triptychs, JSON, and HTML. The older
`--profile-pages` and `--keep-images` flags remain compatibility aliases.

## Image verification procedure

1. Run `pnpm image-compare` with the v1 export as the reference and v2 export as
   the candidate.
2. Check the CLI verdict, reference/candidate page counts, and changed-page count.
3. Open `<out>/index.html`. Inspect each retained changed-page triptych in this order:
   reference, candidate, pixel difference. Gate execution stops at the first changed
   page.
4. Use `<out>/report.json` for exact changed-pixel ratios and page dimensions.
5. Treat page-count mismatches as differences even if all paired pages match.
6. Keep the report and page PNGs outside the repository because they contain
   potentially sensitive document content.

The default per-channel pixel threshold is `0.1`. Changed pixels are merged with a
5×3 morphological-close kernel, and a page is changed when the largest connected
component exceeds 100 pixels. Configure these with `--pixel-threshold`,
`--merge-width`, `--merge-height`, and `--component-area-threshold`. The global
changed-pixel ratio and its `0.001` threshold remain report-only calibration metrics;
they do not determine the verdict. Do not loosen thresholds to turn a failure green.
Record the environment and retain the original report when platform variance requires
a change.

## Verification before handoff

`pnpm verify` tests image comparison with runtime-only identical and changed DOCX
pairs in the system temporary directory; never commit those fixtures.

Run all of the following after code or dependency changes:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm image-compare -- /external/control.docx /external/control.docx \
  --out /tmp/migration-verification/control-images
pnpm verify-migration -- /external/control.docx \
  --out /tmp/migration-verification/control-sequence --diagnostics 2
```

Identical-file controls must report `same: true`, equal page counts, and zero changed
pages. For migration changes, migrate one representative document and compare exports.
