#!/usr/bin/env python3
"""Rendered-image verification for SuperDoc v1-to-v2 migrations."""

from __future__ import annotations

import argparse
import contextlib
import csv
from functools import partial
import hashlib
import html
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Iterable

import cv2
import numpy as np
import psutil
from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parent
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
BROWSER_BUILD_INPUTS = (
    ROOT / "browser/index.html",
    ROOT / "browser/main.js",
    ROOT / "browser/style.css",
    ROOT / "scripts/vite-static.config.mjs",
    ROOT / "package.json",
    ROOT / "pnpm-lock.yaml",
)


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def nonnegative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return parsed


def ratio(value: str) -> float:
    parsed = float(value)
    if not 0 <= parsed <= 1:
        raise argparse.ArgumentTypeError("must be between 0 and 1")
    return parsed


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    sub = result.add_subparsers(dest="command", required=True)
    compare = sub.add_parser("image-compare", help="render and compare two DOCX files")
    compare.add_argument("reference", type=Path)
    compare.add_argument("candidate", type=Path)
    add_image_options(compare)
    verify = sub.add_parser("verify-migration", help="migrate and compare one DOCX or a directory")
    verify.add_argument("input", type=Path)
    add_image_options(verify)
    return result


def normalized_cli_args(arguments: list[str]) -> list[str]:
    """Discard pnpm's argument separator when it follows the subcommand."""
    if len(arguments) >= 2 and arguments[1] == "--":
        return [arguments[0], *arguments[2:]]
    return arguments


def add_image_options(command: argparse.ArgumentParser) -> None:
    command.add_argument("--out", required=True, type=Path)
    command.add_argument("--timeout-ms", type=positive_int, default=180_000)
    command.add_argument("--pages", default="all")
    command.add_argument("--pixel-threshold", type=ratio, default=0.1)
    command.add_argument("--changed-ratio-threshold", type=ratio, default=0.001)
    command.add_argument("--component-area-threshold", type=positive_int, default=100)
    command.add_argument("--merge-width", type=positive_int, default=5)
    command.add_argument("--merge-height", type=positive_int, default=3)
    command.add_argument("--virtualization-window", type=positive_int, default=5)
    command.add_argument("--virtualization-overscan", type=nonnegative_int, default=1)
    command.add_argument("--diagnostics", type=int, choices=(0, 1, 2), default=None,
                         help="0=verdict only, 1=profile CSV/chart, 2=profile plus retained images/HTML")
    command.add_argument("--profile-pages", action="store_true")
    command.add_argument("--keep-images", action="store_true")


def page_order(count: int) -> list[int]:
    if count == 0:
        return []
    output: list[int] = []
    seen: set[int] = set()

    def add(index: int) -> None:
        if 0 <= index < count and index not in seen:
            seen.add(index)
            output.append(index)

    add(0)
    add(count - 1)
    intervals = [(0, count - 1)] if count > 1 else []
    while intervals:
        following = []
        for left, right in intervals:
            middle = (left + right) // 2
            add(middle)
            if middle - left > 1:
                following.append((left, middle))
            if right - middle > 1:
                following.append((middle, right))
        intervals = following
    return output


class MemorySampler:
    def __init__(self, enabled: bool, interval: float = 0.1):
        self.enabled = enabled
        self.interval = interval
        self.samples: list[int] = []
        self.error: str | None = None
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None

    def __enter__(self) -> "MemorySampler":
        if self.enabled:
            self.thread = threading.Thread(target=self._sample, daemon=True)
            self.thread.start()
        return self

    def _sample(self) -> None:
        process = psutil.Process()
        while not self.stop_event.is_set():
            try:
                total = process.memory_info().rss
                for child in process.children(recursive=True):
                    with contextlib.suppress(psutil.Error):
                        total += child.memory_info().rss
                self.samples.append(total)
            except psutil.Error as error:
                self.error = str(error)
            self.stop_event.wait(self.interval)

    def __exit__(self, *_: Any) -> None:
        if self.thread:
            self.stop_event.set()
            self.thread.join()
            if not self.samples:
                self._sample_once()

    def _sample_once(self) -> None:
        try:
            process = psutil.Process()
            self.samples.append(process.memory_info().rss + sum(
                child.memory_info().rss for child in process.children(recursive=True)
                if child.is_running()
            ))
        except psutil.Error as error:
            self.error = str(error)

    def report(self) -> dict[str, Any] | None:
        if not self.enabled:
            return None
        values = np.asarray(self.samples, dtype=np.float64) / (1024 * 1024)
        return {
            "intervalMs": int(self.interval * 1000),
            "sampleCount": len(self.samples),
            "minTreeRssMib": float(values.min()) if values.size else None,
            "avgTreeRssMib": float(values.mean()) if values.size else None,
            "medianTreeRssMib": float(np.median(values)) if values.size else None,
            "p95TreeRssMib": float(np.percentile(values, 95)) if values.size else None,
            "maxTreeRssMib": float(values.max()) if values.size else None,
            "memoryError": self.error,
        }


def ensure_browser_bundle() -> Path:
    digest = hashlib.sha256()
    for file in BROWSER_BUILD_INPUTS:
        digest.update(file.read_bytes())
    output = Path(tempfile.gettempdir()) / f"migration-verification-browser-{digest.hexdigest()[:12]}"
    if (output / "browser/index.html").is_file():
        return output
    result = subprocess.run(
        ["pnpm", "exec", "vite", "build", "--config", "scripts/vite-static.config.mjs",
         "--outDir", str(output), "--emptyOutDir"],
        cwd=ROOT, text=True, capture_output=True,
    )
    if result.returncode:
        raise RuntimeError(f"browser bundle failed: {result.stderr or result.stdout}")
    return output


class QuietStaticHandler(SimpleHTTPRequestHandler):
    fixtures: dict[str, Path] = {}

    def do_GET(self) -> None:
        pathname = self.path.partition("?")[0]
        fixture = self.fixtures.get(pathname)
        if fixture is None:
            super().do_GET()
            return
        size = fixture.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", DOCX_TYPE)
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with fixture.open("rb") as stream:
            self.copyfile(stream, self.wfile)

    def log_message(self, *_: Any) -> None:
        pass


class BrowserServer:
    def __init__(self, reference: Path, candidate: Path):
        bundle = ensure_browser_bundle()
        handler = type("FixtureStaticHandler", (QuietStaticHandler,), {
            "fixtures": {"/reference.docx": reference, "/candidate.docx": candidate},
        })
        self.server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(handler, directory=str(bundle)),
        )
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=10)

    def __enter__(self) -> "BrowserServer":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def open_document(browser: Browser, url: str, timeout_ms: int) -> tuple[Any, Page]:
    context = browser.new_context(viewport={"width": 1400, "height": 1000}, device_scale_factor=1)
    page = context.new_page()
    page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
    try:
        page.wait_for_function("""() => {
          if (window.__verification?.error) throw new Error(window.__verification.error);
          return window.__verification?.ready === true;
        }""", timeout=timeout_ms)
        page.locator(".superdoc-page").first.wait_for(state="visible", timeout=timeout_ms)
    except Exception as error:
        state = page.evaluate("() => ({verification: window.__verification, title: document.title, pages: document.querySelectorAll('.superdoc-page').length})")
        context.close()
        raise RuntimeError(f"browser renderer did not become ready: {state}") from error
    return context, page


def decode_png(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise RuntimeError("OpenCV could not decode screenshot")
    if image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    return image


def normalize_pair(reference: np.ndarray, candidate: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    height = max(reference.shape[0], candidate.shape[0])
    width = max(reference.shape[1], candidate.shape[1])
    def canvas(image: np.ndarray) -> np.ndarray:
        result = np.full((height, width, 4), 255, dtype=np.uint8)
        result[:image.shape[0], :image.shape[1]] = image
        return result
    return canvas(reference), canvas(candidate)


def first_component_over_threshold(mask: np.ndarray, threshold: int) -> dict[str, int] | None:
    """Label horizontal runs and return as soon as one 8-connected region exceeds threshold."""
    parents: list[int] = []
    areas: list[int] = []
    bounds: list[list[int]] = []
    previous: list[tuple[int, int, int]] = []

    def find(label: int) -> int:
        root = label
        while parents[root] != root:
            root = parents[root]
        while parents[label] != label:
            following = parents[label]
            parents[label] = root
            label = following
        return root

    def union(left: int, right: int) -> int:
        left_root, right_root = find(left), find(right)
        if left_root == right_root:
            return left_root
        if areas[left_root] < areas[right_root]:
            left_root, right_root = right_root, left_root
        parents[right_root] = left_root
        areas[left_root] += areas[right_root]
        bounds[left_root][0] = min(bounds[left_root][0], bounds[right_root][0])
        bounds[left_root][1] = min(bounds[left_root][1], bounds[right_root][1])
        bounds[left_root][2] = max(bounds[left_root][2], bounds[right_root][2])
        bounds[left_root][3] = max(bounds[left_root][3], bounds[right_root][3])
        return left_root

    for y, row in enumerate(mask):
        padded = np.pad(row.astype(np.int8), (1, 1))
        transitions = np.diff(padded)
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1) - 1
        current: list[tuple[int, int, int]] = []
        for start, end in zip(starts.tolist(), ends.tolist()):
            overlaps = [label for old_start, old_end, label in previous
                        if old_end >= start - 1 and old_start <= end + 1]
            if overlaps:
                root = find(overlaps[0])
                for label in overlaps[1:]:
                    root = union(root, label)
                root = find(root)
                areas[root] += end - start + 1
                bounds[root][0] = min(bounds[root][0], start)
                bounds[root][2] = max(bounds[root][2], end)
                bounds[root][3] = y
            else:
                root = len(parents)
                parents.append(root)
                areas.append(end - start + 1)
                bounds.append([start, y, end, y])
            root = find(root)
            current.append((start, end, root))
            if areas[root] > threshold:
                left, top, right, bottom = bounds[root]
                return {"x": left, "y": top, "width": right - left + 1,
                        "height": bottom - top + 1, "area": areas[root]}
        previous = current
    return None


def analyze(reference_png: bytes, candidate_png: bytes, options: argparse.Namespace) -> tuple[dict[str, Any], np.ndarray]:
    reference, candidate = normalize_pair(decode_png(reference_png), decode_png(candidate_png))
    delta = cv2.absdiff(reference[:, :, :3], candidate[:, :, :3])
    magnitude = np.max(delta, axis=2)
    raw_mask = (magnitude > round(options.pixel_threshold * 255)).astype(np.uint8)
    changed_pixels = int(np.count_nonzero(raw_mask))
    changed_ratio = changed_pixels / raw_mask.size
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (options.merge_width, options.merge_height))
    merged = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel)
    diagnostics = getattr(options, "diagnostics", 2)
    early_component = None
    if diagnostics < 2:
        early_component = first_component_over_threshold(merged, options.component_area_threshold)
    if early_component is not None:
        components = [early_component]
        largest = early_component["area"]
        component_count = None
        complete = False
    else:
        count, _, stats, _ = cv2.connectedComponentsWithStats(merged, connectivity=8)
        components = []
        for x, y, width, height, area in stats[1:count]:
            components.append({"x": int(x), "y": int(y), "width": int(width), "height": int(height), "area": int(area)})
        components.sort(key=lambda item: item["area"], reverse=True)
        largest = components[0]["area"] if components else 0
        component_count = len(components)
        complete = True
    changed = largest > options.component_area_threshold
    diff = np.full_like(reference, 255)
    diff[raw_mask.astype(bool)] = (0, 0, 255, 255)
    return {
        "changed": changed,
        "changedPixels": changed_pixels,
        "changedPixelRatio": changed_ratio,
        "ratioThresholdExceeded": changed_ratio > options.changed_ratio_threshold,
        "componentCount": component_count,
        "componentScanComplete": complete,
        "componentEarlyExit": early_component is not None,
        "componentAreaIsLowerBound": early_component is not None,
        "largestComponentArea": largest,
        "componentAreaThresholdExceeded": changed,
        "largestComponents": components[:20],
        "width": int(reference.shape[1]),
        "height": int(reference.shape[0]),
    }, diff


def png_bytes(image: np.ndarray) -> bytes:
    success, encoded = cv2.imencode(".png", image)
    if not success:
        raise RuntimeError("OpenCV could not encode PNG")
    return encoded.tobytes()


def triptych(reference: bytes, candidate: bytes, diff: np.ndarray) -> bytes:
    left, middle = normalize_pair(decode_png(reference), decode_png(candidate))
    joined = np.concatenate([left, middle, diff], axis=1)
    return png_bytes(joined)


def html_report(report: dict[str, Any]) -> str:
    rows = []
    for page in report["pages"]:
        artifact = page.get("triptych")
        link = f'<a href="diff/{html.escape(artifact)}">triptych</a>' if artifact else ""
        rows.append(f"<tr><td>{page['page']}</td><td>{str(page['changed']).lower()}</td><td>{page['changedPixelRatio']:.6f}</td><td>{page['largestComponentArea']}</td><td>{link}</td></tr>")
    return """<!doctype html><meta charset=utf-8><title>Image comparison</title>
<style>body{font:14px system-ui;margin:24px;color:#172033}table{border-collapse:collapse}th,td{padding:8px 12px;border:1px solid #d8dee9;text-align:right}th{background:#eef2f7}</style>
<h1>Image comparison</h1><p>Verdict: <b>%s</b></p><table><thead><tr><th>Page</th><th>Changed</th><th>Changed ratio</th><th>Largest component (px)</th><th>Artifact</th></tr></thead><tbody>%s</tbody></table>""" % (report["verdict"], "".join(rows))


def compare_documents(reference: Path, candidate: Path, output: Path, options: argparse.Namespace, retain: bool) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=True)
    for name in ("reference", "candidate", "diff"):
        (output / name).mkdir(exist_ok=True)
    pages: list[dict[str, Any]] = []
    with BrowserServer(reference, candidate) as server, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            virtualization = f"&virtualizationWindow={options.virtualization_window}&virtualizationOverscan={options.virtualization_overscan}"
            reference_context, reference_page = open_document(browser, f"{server.origin}/browser/index.html?fixture=/reference.docx{virtualization}", options.timeout_ms)
            reference_locator = reference_page.locator(".superdoc-page")
            reference_count = reference_locator.count()
            order = page_order(reference_count)
            if options.pages != "all":
                order = order[:min(positive_int(options.pages), len(order))]
            reference_files: dict[int, Path] = {}
            reference_profiles: dict[int, dict[str, Any]] = {}
            for index in order:
                started = time.perf_counter()
                with MemorySampler(options.profile_pages) as memory:
                    element = reference_locator.nth(index)
                    element.scroll_into_view_if_needed(timeout=options.timeout_ms)
                    capture_started = time.perf_counter()
                    data = element.screenshot(animations="disabled")
                    capture_ms = (time.perf_counter() - capture_started) * 1000
                    file = output / "reference" / f"page-{index + 1:04d}.png"
                    file.write_bytes(data)
                    reference_files[index] = file
                reference_profiles[index] = {"totalMs": (time.perf_counter() - started) * 1000, "captureMs": capture_ms, "memory": memory.report()}
            reference_context.close()
            browser.close()
            browser = playwright.chromium.launch(headless=True)

            candidate_context, candidate_page = open_document(browser, f"{server.origin}/browser/index.html?fixture=/candidate.docx{virtualization}", options.timeout_ms)
            candidate_locator = candidate_page.locator(".superdoc-page")
            candidate_count = candidate_locator.count()
            if candidate_count != reference_count:
                candidate_context.close()
                return base_report(reference, candidate, reference_count, candidate_count, [], options, "different", "page-count-mismatch")
            for comparison_index, index in enumerate(order, 1):
                started = time.perf_counter()
                with MemorySampler(options.profile_pages) as memory:
                    element = candidate_locator.nth(index)
                    element.scroll_into_view_if_needed(timeout=options.timeout_ms)
                    capture_started = time.perf_counter()
                    candidate_png = element.screenshot(animations="disabled")
                    candidate_capture_ms = (time.perf_counter() - capture_started) * 1000
                    reference_png = reference_files[index].read_bytes()
                    compare_started = time.perf_counter()
                    exact = reference_png == candidate_png
                    if exact:
                        decoded = decode_png(reference_png)
                        metrics = {"changed": False, "changedPixels": 0, "changedPixelRatio": 0.0, "ratioThresholdExceeded": False, "componentCount": 0, "largestComponentArea": 0, "componentAreaThresholdExceeded": False, "largestComponents": [], "width": decoded.shape[1], "height": decoded.shape[0]}
                        diff = np.full_like(decoded, 255)
                    else:
                        metrics, diff = analyze(reference_png, candidate_png, options)
                    compare_ms = (time.perf_counter() - compare_started) * 1000
                    artifact_started = time.perf_counter()
                    artifact = None
                    if retain:
                        candidate_file = output / "candidate" / f"page-{index + 1:04d}.png"
                        candidate_file.write_bytes(candidate_png)
                        (output / "diff" / f"page-{index + 1:04d}-diff.png").write_bytes(png_bytes(diff))
                        artifact = f"page-{index + 1:04d}-triptych.png"
                        (output / "diff" / artifact).write_bytes(triptych(reference_png, candidate_png, diff))
                    artifact_ms = (time.perf_counter() - artifact_started) * 1000
                    if not retain:
                        reference_files[index].unlink(missing_ok=True)
                reference_profile = reference_profiles[index]
                page_memory = combine_memory(reference_profile["memory"], memory.report())
                pages.append({"page": index + 1, "comparisonOrder": comparison_index, "exactPngMatch": exact, **metrics, "triptych": artifact, "performance": {"totalMs": reference_profile["totalMs"] + (time.perf_counter() - started) * 1000, "captureMs": reference_profile["captureMs"] + candidate_capture_ms, "referenceCaptureMs": reference_profile["captureMs"], "candidateCaptureMs": candidate_capture_ms, "compareMs": compare_ms, "artifactWriteMs": artifact_ms, "memory": page_memory}})
                if metrics["changed"]:
                    break
            candidate_context.close()
        finally:
            browser.close()
    verdict = "different" if any(page["changed"] for page in pages) else ("same" if len(pages) == reference_count else "sampled_pass")
    report = base_report(reference, candidate, reference_count, candidate_count, pages, options, verdict, None)
    if retain:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        (output / "index.html").write_text(html_report(report))
    return report


def combine_memory(*reports: dict[str, Any] | None) -> dict[str, Any] | None:
    available = [item for item in reports if item]
    if not available:
        return None
    weighted = sum(item["avgTreeRssMib"] * item["sampleCount"] for item in available if item["avgTreeRssMib"] is not None)
    samples = sum(item["sampleCount"] for item in available)
    return {"intervalMs": available[0]["intervalMs"], "sampleCount": samples, "minTreeRssMib": min(item["minTreeRssMib"] for item in available), "avgTreeRssMib": weighted / samples if samples else None, "medianTreeRssMib": float(np.median([item["medianTreeRssMib"] for item in available])), "p95TreeRssMib": max(item["p95TreeRssMib"] for item in available), "maxTreeRssMib": max(item["maxTreeRssMib"] for item in available), "memoryError": " | ".join(item["memoryError"] for item in available if item["memoryError"]) or None}


def base_report(reference: Path, candidate: Path, reference_count: int, candidate_count: int, pages: list[dict[str, Any]], options: argparse.Namespace, verdict: str, reason: str | None) -> dict[str, Any]:
    return {"schemaVersion": "migration-verification/image-compare/v3-python", "reference": str(reference), "candidate": str(candidate), "verdict": verdict, "same": verdict == "same", "differenceReason": reason, "referencePageCount": reference_count, "candidatePageCount": candidate_count, "comparedPageCount": len(pages), "uncheckedPageCount": max(reference_count - len(pages), 0), "changedPageCount": sum(page["changed"] for page in pages) + abs(reference_count - candidate_count), "pixelThreshold": options.pixel_threshold, "changedRatioThreshold": options.changed_ratio_threshold, "componentAreaThreshold": options.component_area_threshold, "mergeKernel": [options.merge_width, options.merge_height], "virtualization": {"window": options.virtualization_window, "overscan": options.virtualization_overscan}, "pages": pages}


def documents_at(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() == ".docx":
        return [source.resolve()]
    if source.is_dir():
        return sorted((item.resolve() for item in source.iterdir() if item.is_file() and item.suffix.lower() == ".docx"), key=lambda item: item.name.lower())
    raise ValueError("input must be a DOCX file or directory")


def safe_name(path: Path) -> str:
    text = "".join(character if character.isalnum() or character in "._-" else "-" for character in path.stem).strip("-")
    return text[:80] or "document"


def write_csv(path: Path, rows: Iterable[dict[str, Any]], headers: list[str]) -> None:
    with path.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def verify_migrations(options: argparse.Namespace) -> dict[str, Any]:
    output = options.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError("--out must be empty")
    documents = documents_at(options.input)
    if not documents:
        raise ValueError("input directory contains no DOCX files")
    results = []
    page_rows = []
    work_temp = None
    if options.diagnostics >= 2:
        documents_root = output / "documents"
        documents_root.mkdir()
    else:
        work_temp = tempfile.TemporaryDirectory(prefix="migration-verification-gate-")
        documents_root = Path(work_temp.name)
    for position, document in enumerate(documents, 1):
        identifier = f"{position:03d}-{safe_name(document)}"
        document_root = documents_root / identifier
        migration_root = document_root / "migration"
        document_root.mkdir()
        print(f"[{position}/{len(documents)}] {document.name}", file=sys.stderr, flush=True)
        migration = subprocess.run(["node", str(ROOT / "scripts/migrate-collaboration-document.mjs"), str(document), "--out", str(migration_root), "--timeout-ms", str(options.timeout_ms)], cwd=ROOT, text=True, capture_output=True)
        row = {"document": document.name, "document_id": identifier, "input_bytes": document.stat().st_size, "migration_status": "completed" if migration.returncode == 0 else "failed", "image_status": "not_run", "comparison_verdict": "", "visual_same": "", "reference_pages": "", "candidate_pages": "", "pages_compared": "", "pages_unchecked": "", "changed_pages": "", "max_component_area": "", "failure_reason": ""}
        if migration.returncode:
            row["failure_reason"] = (migration.stderr or migration.stdout).strip()
            results.append(row)
            continue
        reference = migration_root / "ingested-v1.docx"
        candidate = migration_root / "ingested-v2.docx"
        temporary = None
        image_root = document_root / "images"
        if not options.keep_images:
            temporary = tempfile.TemporaryDirectory(prefix="migration-verification-images-")
            image_root = Path(temporary.name)
        try:
            report = compare_documents(reference, candidate, image_root, options, options.keep_images)
            row.update({"image_status": "completed", "comparison_verdict": report["verdict"], "visual_same": "yes" if report["verdict"] == "same" else "no" if report["verdict"] == "different" else "", "reference_pages": report["referencePageCount"], "candidate_pages": report["candidatePageCount"], "pages_compared": report["comparedPageCount"], "pages_unchecked": report["uncheckedPageCount"], "changed_pages": report["changedPageCount"], "max_component_area": max((page["largestComponentArea"] for page in report["pages"]), default=0)})
            if options.profile_pages:
                for page in report["pages"]:
                    perf = page["performance"]
                    memory = perf["memory"] or {}
                    page_rows.append({"document": document.name, "document_id": identifier, "input_bytes": document.stat().st_size, "reference_bytes": reference.stat().st_size, "candidate_bytes": candidate.stat().st_size, "page": page["page"], "comparison_order": page["comparisonOrder"], "changed": "yes" if page["changed"] else "no", "changed_pixels": page["changedPixels"], "changed_pixel_ratio": page["changedPixelRatio"], "component_count": page["componentCount"], "largest_component_area": page["largestComponentArea"], "total_ms": round(perf["totalMs"], 3), "capture_ms": round(perf["captureMs"], 3), "compare_ms": round(perf["compareMs"], 3), "artifact_write_ms": round(perf["artifactWriteMs"], 3), "memory_interval_ms": memory.get("intervalMs"), "memory_sample_count": memory.get("sampleCount"), "min_tree_rss_mib": memory.get("minTreeRssMib"), "avg_tree_rss_mib": memory.get("avgTreeRssMib"), "median_tree_rss_mib": memory.get("medianTreeRssMib"), "p95_tree_rss_mib": memory.get("p95TreeRssMib"), "max_tree_rss_mib": memory.get("maxTreeRssMib"), "memory_error": memory.get("memoryError")})
        except Exception as error:
            row["image_status"] = "failed"
            row["failure_reason"] = repr(error)
        finally:
            if temporary:
                temporary.cleanup()
        results.append(row)
    if work_temp:
        work_temp.cleanup()
    write_csv(output / "report.csv", results, list(results[0]))
    if page_rows:
        write_csv(output / "page-performance.csv", page_rows, list(page_rows[0]))
    summary = {"documents": len(results), "migrationsCompleted": sum(row["migration_status"] == "completed" for row in results), "imagesCompleted": sum(row["image_status"] == "completed" for row in results), "visuallySame": sum(row["visual_same"] == "yes" for row in results), "visuallyDifferent": sum(row["comparison_verdict"] == "different" for row in results), "failures": sum(row["migration_status"] == "failed" or row["image_status"] == "failed" for row in results), "pageProfiles": len(page_rows), "csv": str(output / "report.csv"), "pageCsv": str(output / "page-performance.csv") if page_rows else None}
    if page_rows:
        chart = output / "page-memory-interactive.html"
        generated = subprocess.run(["node", str(ROOT / "report-generators/generate-page-memory-chart.mjs"), str(output / "page-performance.csv"), "--out", str(chart)], cwd=ROOT, text=True, capture_output=True)
        if generated.returncode:
            raise RuntimeError(f"chart generation failed: {generated.stderr or generated.stdout}")
        summary["chart"] = str(chart)
    if options.diagnostics >= 2:
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    return summary


def main() -> int:
    options = parser().parse_args(normalized_cli_args(sys.argv[1:]))
    if options.diagnostics is None:
        options.diagnostics = 2 if options.keep_images else 1 if options.profile_pages else 0
    options.profile_pages = options.diagnostics >= 1
    options.keep_images = options.diagnostics >= 2
    options.out = options.out.resolve()
    if options.command == "image-compare":
        report = compare_documents(options.reference.resolve(), options.candidate.resolve(), options.out, options, options.keep_images)
        print(json.dumps(report, indent=2))
        return 2 if report["verdict"] == "different" else 0
    summary = verify_migrations(options)
    print(json.dumps(summary, indent=2))
    if summary["failures"]:
        return 1
    return 2 if summary["visuallyDifferent"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
