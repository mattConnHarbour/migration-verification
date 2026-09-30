# Migration verification

Standalone verification tools for a SuperDoc v1 collaboration-room migration to v2.
The repository does not require an Orbit checkout and does not contact SuperDoc Labs.

## What it does

The migration command runs this pipeline:

```text
DOCX on disk
  -> import into an isolated final-v1 room
  -> export the ingested v1 document
  -> migrate into a separate v2 room
  -> join and export the v2 room through the public browser API
  -> compare both exports through the public SDK diff API
```

The original v1 room is never changed. The diff is reported but never applied.

The image command opens both exported DOCX files with the same public SuperDoc
browser build, screenshots every page, and produces pixel diffs and a manual HTML
report.

## Requirements

- Node.js 20 or newer
- pnpm 10
- macOS or Linux with the libraries required by Playwright Chromium

## Setup

```bash
pnpm install --frozen-lockfile
pnpm run browser:install
```

The collaboration-upgrade package is included under `vendor/` because the package
build being verified is not yet installed from the public npm registry. All other
dependencies are pinned npm packages.

## Migrate, export, and structurally compare

The output directory must be empty.

```bash
pnpm migrate -- \
  "/path/to/document.docx" \
  --out "/tmp/migration-verification/document" \
  --timeout-ms 180000
```

Outputs:

- `ingested-v1.docx` — detached export of the v1 room
- `ingested-v2.docx` — public-browser export after joining the v2 room
- `report.json` — migration receipt plus the complete public SDK diff result

Exit codes are `0` for same, `2` for a completed comparison that found differences,
and `1` for an execution failure.

## Run the complete migration and image-verification sequence

Use one command for either a single DOCX or every DOCX directly inside a directory:

```bash
pnpm verify-migration -- \
  "/path/to/document-or-directory" \
  --out "/tmp/migration-verification/run" \
  --timeout-ms 180000 \
  --keep-images
```

Documents are processed sequentially. A structural difference is a completed result,
so image comparison still runs. The command writes `report.csv` and `summary.json` at
the output root, with one document directory under `documents/` for each input.

`--keep-images` is optional. When present, each document retains its page PNGs,
triptychs, `report.json`, and browsable `index.html` under `documents/<id>/images/`,
and the CSV links to those reports. Without it, image generation uses a temporary
directory and the CSV retains the visual verdict and metrics without retaining
customer-content images.

Exit codes are `0` when every comparison is the same, `2` when all work completed but
at least one structural or visual comparison differs, and `1` when any migration or
image comparison failed.

## Compare any two DOCX files with the public diff API

```bash
pnpm diff -- \
  "/path/to/reference.docx" \
  "/path/to/candidate.docx" \
  --out "/tmp/migration-verification/diff.json" \
  --timeout-ms 180000
```

The JSON and CLI output include `summary.hasChanges`, every changed component,
fingerprints, coverage, and the complete payload returned by `diff.compare()`.

The browser export can legitimately normalize package-only content even when the
document renders identically—for example, removing unused empty footnote/endnote
parts. Those findings remain visible as a `parts` difference and can be reviewed
alongside the image report.

## Render and compare page images

```bash
pnpm image-compare -- \
  "/tmp/migration-verification/document/ingested-v1.docx" \
  "/tmp/migration-verification/document/ingested-v2.docx" \
  --out "/tmp/migration-verification/document/images" \
  --timeout-ms 180000
```

Open `images/index.html` for the manual report. Each row shows the reference page,
candidate page, and pixel difference side by side. Raw page PNGs and JSON metrics are
also retained.

The default pixel threshold is `0.1`; a page is reported changed when more than
`0.001` of its pixels differ. Override these with `--pixel-threshold` and
`--changed-ratio-threshold`.

## Security and data handling

All servers bind to `127.0.0.1`, use ephemeral ports, and stop when the command
finishes. Documents remain on the local machine. Output directories can contain the
full customer document and must be handled with the same controls as the input.

## Version policy

`package.json` pins the SuperDoc browser and SDK prerelease versions used by the verification.
Do not update them casually: a version change alters the system being measured and
should produce a new reviewed verification release.
