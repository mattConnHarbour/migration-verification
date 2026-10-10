import argparse
from pathlib import Path
import tempfile
import unittest
import zipfile

import cv2
import numpy as np

from migration_verification import (
    analyze,
    compare_documents,
    first_component_over_threshold,
    normalized_cli_args,
    page_order,
)


def png(image):
    success, encoded = cv2.imencode(".png", image)
    assert success
    return encoded.tobytes()


def write_synthetic_docx(path: Path, paragraphs: list[str]) -> None:
    body = "".join(f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>' for text in paragraphs)
    document = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>'''
    content_types = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''
    relationships = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document)


class ImageAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.options = argparse.Namespace(
            pixel_threshold=0.1,
            changed_ratio_threshold=0.001,
            component_area_threshold=100,
            merge_width=5,
            merge_height=3,
        )

    def test_identical_images_have_no_components(self):
        image = np.full((100, 200, 4), 255, dtype=np.uint8)
        metrics, _ = analyze(png(image), png(image), self.options)
        self.assertFalse(metrics["changed"])
        self.assertEqual(metrics["componentCount"], 0)

    def test_large_connected_change_is_detected(self):
        reference = np.full((100, 200, 4), 255, dtype=np.uint8)
        candidate = reference.copy()
        candidate[30:50, 40:80, :3] = 0
        metrics, _ = analyze(png(reference), png(candidate), self.options)
        self.assertTrue(metrics["changed"])
        self.assertGreaterEqual(metrics["largestComponentArea"], 800)

    def test_gate_mode_stops_after_component_crosses_threshold(self):
        mask = np.zeros((50, 100), dtype=np.uint8)
        mask[10:30, 20:50] = 1
        component = first_component_over_threshold(mask, 100)
        self.assertIsNotNone(component)
        self.assertGreater(component["area"], 100)
        self.options.diagnostics = 0
        reference = np.full((100, 200, 4), 255, dtype=np.uint8)
        candidate = reference.copy()
        candidate[30:50, 40:80, :3] = 0
        metrics, _ = analyze(png(reference), png(candidate), self.options)
        self.assertTrue(metrics["changed"])
        self.assertTrue(metrics["componentEarlyExit"])
        self.assertFalse(metrics["componentScanComplete"])
        self.assertTrue(metrics["componentAreaIsLowerBound"])

    def test_pnpm_argument_separator_after_subcommand_is_ignored(self):
        arguments = ["image-compare", "--", "reference.docx", "candidate.docx", "--out", "/tmp/output"]
        self.assertEqual(
            normalized_cli_args(arguments),
            ["image-compare", "reference.docx", "candidate.docx", "--out", "/tmp/output"],
        )

    def test_progressive_page_order_starts_at_boundaries_and_covers_all_pages(self):
        order = page_order(10)
        self.assertEqual(order[:3], [0, 9, 4])
        self.assertEqual(sorted(order), list(range(10)))

    def test_runtime_renderer_recognizes_same_and_changed_documents(self):
        options = argparse.Namespace(
            timeout_ms=180_000,
            pages="all",
            pixel_threshold=0.1,
            changed_ratio_threshold=0.001,
            component_area_threshold=100,
            merge_width=5,
            merge_height=3,
            virtualization_window=5,
            virtualization_overscan=1,
            diagnostics=0,
            profile_pages=False,
        )
        with tempfile.TemporaryDirectory(prefix="migration-verification-test-") as directory:
            root = Path(directory)
            reference = root / "reference.docx"
            same = root / "same.docx"
            changed = root / "changed.docx"
            paragraphs = ["Synthetic migration fixture", "This document is unchanged."]
            write_synthetic_docx(reference, paragraphs)
            write_synthetic_docx(same, paragraphs)
            write_synthetic_docx(changed, [
                "Synthetic migration fixture with a substantial visible change",
                "This candidate contains different words and another visibly different line.",
                "An additional paragraph makes the expected change unambiguous.",
            ])
            same_report = compare_documents(reference, same, root / "same-output", options, False)
            changed_report = compare_documents(reference, changed, root / "changed-output", options, False)
            self.assertTrue(same_report["same"])
            self.assertEqual(same_report["changedPageCount"], 0)
            self.assertFalse(changed_report["same"])
            self.assertGreater(changed_report["changedPageCount"], 0)


if __name__ == "__main__":
    unittest.main()
