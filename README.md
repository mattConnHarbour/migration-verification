# Migration verification

Standalone verification tools for a SuperDoc v1 collaboration-room migration to v2.
Python orchestrates verification and OpenCV/NumPy compare rendered pages. Migration
and rendering still use the pinned SuperDoc JavaScript packages being measured.

## What it does

The complete verification command runs this pipeline:

```text
DOCX on disk
  -> import into an isolated final-v1 room
  -> export the ingested v1 document
  -> migrate into a separate v2 room
  -> join and export the v2 room through the public browser API
  -> render both exports and compare their page images
```

The original v1 room is never changed.

The image command opens both exported DOCX files with the same public SuperDoc
browser build and compares selected rendered pages, stopping at the first difference.
Diagnostics level 2 retains pixel diffs and a manual HTML report.

## Command and script hierarchy

```text
pnpm verify-migration -> migration_verification.py
    ├── scripts/migrate-collaboration-document.mjs
    ├── prebuilt browser/* bundle + local static server
    └── OpenCV rendered-image comparison

pnpm migrate         -> scripts/migrate-collaboration-document.mjs
pnpm image-compare   -> migration_verification.py
```

`migration_verification.py` processes documents sequentially, invokes migration,
drives the browser renderer with Python Playwright, compares screenshots with
OpenCV, profiles time and process-tree memory, and writes reports.

The browser application is bundled once into the system temporary directory and
served from a minimal server bound to `127.0.0.1`. Vite is never resident during
profiling. Reference and candidate passes use separate Chromium processes so browser
caches and renderer state are reclaimed between passes.

Use `verify-migration` for an end-to-end document or directory run, `migrate` when
only exports are needed, and `image-compare` when reference and candidate DOCX files
already exist.

## Requirements

- Node.js 20 or newer
- pnpm 10
- Python 3.13
- macOS or Linux with the libraries required by Playwright Chromium

## Setup

```bash
pnpm install --frozen-lockfile
pnpm run python:install
```

All npm and Python dependencies are pinned. `python:install` creates `.venv`, installs
`requirements.txt`, and installs the matching Chromium build.

## Migrate and export only

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
- `report.json` — migration receipt and artifact paths

This command performs no image comparison. Its exit code is `0` for a completed
migration and `1` for an execution failure.

## Run the complete migration and image-verification sequence

Use one command for either a single DOCX or every DOCX directly inside a directory:

```bash
pnpm verify-migration -- \
  "/path/to/document-or-directory" \
  --out "/tmp/migration-verification/run" \
  --timeout-ms 180000 \
  --pages all \
  --diagnostics 1
```

Documents are processed sequentially, and every diagnostics level writes
`report.csv`. Retained document directories and `summary.json` are added only at
diagnostics level 2.

Diagnostics levels control profiling and retained artifacts:

- `--diagnostics 0` runs the gate without profiling or retained image diagnostics.
- `--diagnostics 1` profiles time and process-tree RSS, keeps all working documents
  and images temporary, then writes only `report.csv`, `page-performance.csv`, and
  `page-memory-interactive.html` when the complete batch finishes.
- `--diagnostics 2` adds retained migration exports, page PNGs, triptychs, per-document
  JSON/HTML reports, and `summary.json`.

The older `--profile-pages` and `--keep-images` flags remain compatible aliases for
levels 1 and 2 respectively when `--diagnostics` is omitted.

Exit codes are `0` when every comparison is the same, `2` when all work completed but
at least one visual comparison differs, and `1` when any migration or image
comparison failed.

`--pages all` is the default and performs an exhaustive comparison. For a bounded
screening run, pass a positive sample size such as `--pages 10`. Sampled pages are
ordered by progressive midpoint sampling: the first page, last page, midpoint, then
the midpoints of progressively smaller intervals. Comparison always stops at the
first changed page.

Image comparison uses a sequential two-pass renderer to keep memory bounded:

1. Open only the reference DOCX and determine its page count.
2. Capture selected reference pages in progressive-midpoint order to local PNGs.
3. Fully close the reference browser context and release its renderer.
4. Open only the candidate DOCX and reject page-count mismatches immediately.
5. Capture each selected candidate page, load its matching reference PNG, compare,
   write metrics/artifacts, and discard the decoded buffers.
6. Stop at the first changed page; otherwise continue through the requested sample
   or every page for `--pages all`.

Only one document renderer and one decoded page pair are active during comparison.
This preserves sampling and fail-fast behavior without keeping reference and
candidate SuperDoc renderers resident at the same time.

When `--keep-images` is omitted, reference screenshots are temporary disk buffers
and are deleted immediately after their candidate page is compared. Candidate
screenshots remain in memory, and passing pages do not write candidate, difference,
or triptych PNGs. Byte-identical reference and candidate PNGs bypass decoding and
pixel comparison. Changed pages still write diagnostic artifacts inside the
temporary run directory before it is cleaned up.

A successful sample reports `sampled_pass`, not `same`, because unchecked pages may
still differ. Page-count mismatches are detected before sampling and immediately
report `different`.

## Render and compare page images

```bash
pnpm image-compare -- \
  "/tmp/migration-verification/document/ingested-v1.docx" \
  "/tmp/migration-verification/document/ingested-v2.docx" \
  --out "/tmp/migration-verification/document/images" \
  --pages all \
  --diagnostics 2 \
  --timeout-ms 180000
```

Open `images/index.html` for the manual report. Each changed-page row links to a
triptych showing the reference page, candidate page, and pixel difference side by
side. Raw page PNGs and JSON metrics are also retained.

The default per-channel pixel threshold is `0.1`. OpenCV creates a binary difference
mask, closes nearby changed pixels with a 5×3 kernel, and labels connected
components. A page is changed when its largest merged component exceeds 100 pixels.
Override these with `--pixel-threshold`, `--component-area-threshold`,
`--merge-width`, and `--merge-height`.

The legacy global changed-pixel ratio and its `0.001` threshold remain in reports for
calibration, but the verdict is based on the largest connected component.

Use `--pages <N>` to compare at most `N` page pairs or `--pages all` for a definitive
comparison. The report records the selected order, pages actually compared, and
unchecked page count. Even in all-page mode, comparison fails fast on the first
difference.

Add `--profile-pages` to record time and summed process-tree RSS for each compared
page pair. With `verify-migration`, the output root receives `page-performance.csv`
with one row per page pair, including capture, comparison, artifact-write, and total
duration plus minimum, average, median, p95, and maximum RSS. Profiling samples every
100 milliseconds during both the reference-capture and candidate-compare windows;
the row combines those samples and exposes separate reference/candidate capture
durations. Profiling adds measurement overhead, so compare profiled runs only with
other profiled runs. Profiled runs also generate `page-memory-interactive.html`
automatically from the CSV.

Gate modes stop connected-component labeling as soon as a region exceeds the area
threshold. Level 2 completes component labeling so its retained report can list all
measured regions.

### Performance report generators

Keep generated CSV and HTML reports outside the checkout. To combine a main run
with isolated retries, pass each page-performance CSV to the consolidator:

```bash
node report-generators/consolidate-page-performance.mjs \
  --out /tmp/migration-verification/page-performance-consolidated.csv \
  /tmp/migration-verification/main/page-performance.csv \
  /tmp/migration-verification/retries/*/page-performance.csv
```

Generate a self-contained interactive D3 chart from that CSV:

```bash
node report-generators/generate-page-memory-chart.mjs \
  /tmp/migration-verification/page-performance-consolidated.csv \
  --out /tmp/migration-verification/page-memory-interactive.html
```

The chart contains only the profiled page-comparison measurements. It plots total
profiled page time on the x-axis and process-tree RSS on the y-axis, with minimum,
median page peak, and maximum memory for every document.

## Security and data handling

All servers bind to `127.0.0.1`, use ephemeral ports, and stop when the command
finishes. Documents remain on the local machine. Output directories can contain the
full input document and must be handled with the same controls as the source.

## Tests

```bash
pnpm verify
```

The test suite generates synthetic identical and changed v1/v2 DOCX pairs in the
system temporary directory. It verifies rendered page-image comparison, then removes
the fixtures and reports. No binary fixtures or input documents are stored in the
repository.

## Version policy

`package.json` pins the SuperDoc browser version used by the verification. Do not
update it casually: a version change alters the system being measured and should
produce a new reviewed verification release.
