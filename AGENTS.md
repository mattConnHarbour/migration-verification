# Migration verification agent guide

This repository is a standalone, local-only customer tool. It must remain runnable
without an Orbit checkout or SuperDoc Labs access.

## Safety and repository boundaries

- Never add customer documents, exported documents, screenshots, reports, or other
  run artifacts to this repository. Pass document paths from outside the checkout
  and write results to an external directory such as `/tmp/migration-verification`.
- `*.docx`, `output/`, and run artifacts are ignored as a backstop, not as permission
  to copy customer data into the checkout.
- All document servers must bind to `127.0.0.1`. Do not upload documents or add
  network-backed rendering.
- Keep package versions pinned. Version changes alter the system being measured and
  require a new end-to-end verification run.
- Do not apply generated diffs. This repository only exports, analyzes, and renders.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm run browser:install
```

Use Node.js 20 or newer. `pnpm run browser:install` installs the pinned Playwright
Chromium build required by migration export and image verification.

## Independent commands

The structural diff and image comparison are independent tools. Neither requires a
migration run when two DOCX paths already exist.

Structural diff through the public SuperDoc SDK:

```bash
pnpm diff -- /external/reference.docx /external/candidate.docx \
  --out /tmp/migration-verification/diff.json \
  --timeout-ms 180000
```

Image comparison through the public SuperDoc browser package:

```bash
pnpm image-compare -- /external/reference.docx /external/candidate.docx \
  --out /tmp/migration-verification/images \
  --timeout-ms 180000
```

The migration command produces `ingested-v1.docx`, `ingested-v2.docx`, and
`report.json`. It also performs the structural diff, but does not run image comparison:

```bash
pnpm migrate -- /external/source.docx \
  --out /tmp/migration-verification/migration \
  --timeout-ms 180000
```

For one sequential command over a DOCX or a directory of DOCX files, use:

```bash
pnpm verify-migration -- /external/document-or-directory \
  --out /tmp/migration-verification/run --timeout-ms 180000 --keep-images
```

This always writes `report.csv`. `--keep-images` additionally retains per-document
page PNGs, triptychs, JSON, and HTML under the output directory. Without the flag,
the command records image metrics in the CSV and deletes temporary page images.
Structural differences do not prevent the image comparison from running.

## Image verification procedure

1. Run `pnpm image-compare` with the v1 export as the reference and v2 export as
   the candidate.
2. Check the CLI verdict, reference/candidate page counts, and changed-page count.
3. Open `<out>/index.html`. For every changed page, inspect the triptych in this
   order: reference, candidate, pixel difference.
4. Use `<out>/report.json` for exact changed-pixel ratios and page dimensions.
5. Treat page-count mismatches as differences even if all paired pages match.
6. Keep the report and page PNGs outside the repository because they contain
   customer document content.

The default pixel threshold is `0.1`, and a page is changed when more than `0.001`
of its pixels differ. Do not loosen either threshold to turn a failure green. If
font or platform variance requires a threshold change, record the environment and
retain the original report for review.

## Verification before handoff

Run all of the following after code or dependency changes:

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm diff -- /external/control.docx /external/control.docx \
  --out /tmp/migration-verification/control-diff.json
pnpm image-compare -- /external/control.docx /external/control.docx \
  --out /tmp/migration-verification/control-images
pnpm verify-migration -- /external/control.docx \
  --out /tmp/migration-verification/control-sequence --keep-images
```

The identical-file controls must report `same: true`, identical page counts, and
zero changed pages. For migration changes, also run one representative document
through `pnpm migrate`, then image-compare its two exports.
