#!/usr/bin/env python3

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
import tifffile


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import imc_pipeline


def write_panel(path, markers):
    pd.DataFrame({"channel": range(len(markers)), "marker": markers}).to_csv(
        path, index=False
    )


def write_synthetic_tiff(path, channels=5, size=64):
    yy, xx = np.mgrid[0:size, 0:size]
    dna = np.zeros((size, size), dtype=np.float32)
    for cy, cx in [(16, 16), (48, 48)]:
        radius2 = (yy - cy) ** 2 + (xx - cx) ** 2
        dna = np.maximum(dna, np.clip(240.0 - 2.0 * radius2, 0, 255))

    img = np.zeros((channels, size, size), dtype=np.uint16)
    img[0] = dna.astype(np.uint16)
    for channel in range(1, channels):
        img[channel] = np.clip(
            channel * 30 + dna * 0.1,
            0,
            65535,
        ).astype(np.uint16)
    tifffile.imwrite(path, img, photometric="minisblack")


class TestSegmenters(unittest.TestCase):
    def test_segmenters_contains_expected_keys(self):
        self.assertEqual(
            set(imc_pipeline.SEGMENTERS),
            {"stardist", "cellpose", "mesmer", "otsu"},
        )


class TestPickSegmenter(unittest.TestCase):
    def test_pick_segmenter_accepts_number(self):
        with patch.object(imc_pipeline, "list_segmenters"):
            with patch("builtins.input", return_value="2"):
                self.assertEqual(imc_pipeline.pick_segmenter(), "cellpose")

    def test_pick_segmenter_retries_then_accepts_name(self):
        with patch.object(imc_pipeline, "list_segmenters"):
            with patch("builtins.input", side_effect=["99", "mesmer"]):
                self.assertEqual(imc_pipeline.pick_segmenter(), "mesmer")

    def test_pick_segmenter_exits_on_quit(self):
        with patch.object(imc_pipeline, "list_segmenters"):
            with patch("builtins.input", return_value="q"):
                with patch.object(imc_pipeline.sys, "exit", side_effect=SystemExit):
                    with self.assertRaises(SystemExit):
                        imc_pipeline.pick_segmenter()


class TestIMCPipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)

    def make_pipeline(self):
        panel = self.base / "panel.csv"
        write_panel(panel, ["DNA", "CD3", "CD8", "FOXP3", "Ki67"])
        input_dir = self.base / "input"
        output_dir = self.base / "output"
        input_dir.mkdir()
        return imc_pipeline.IMCPipeline(
            str(input_dir),
            str(panel),
            str(output_dir),
            segmenter="otsu",
        )

    def test_init_accepts_valid_panel(self):
        pipe = self.make_pipeline()
        self.assertEqual(
            pipe.channel_names,
            ["DNA", "CD3", "CD8", "FOXP3", "Ki67"],
        )
        self.assertEqual(pipe.segmenter, "otsu")

    def test_init_rejects_panel_without_marker_column(self):
        panel = self.base / "bad_panel.csv"
        pd.DataFrame({"channel": [0, 1], "name": ["DNA", "CD3"]}).to_csv(
            panel, index=False
        )
        with self.assertRaises(ValueError):
            imc_pipeline.IMCPipeline(
                str(self.base / "input"),
                str(panel),
                str(self.base / "output"),
                segmenter="otsu",
            )

    def test_segment_with_synthetic_tiff(self):
        pipe = self.make_pipeline()
        write_synthetic_tiff(pipe.input_dir / "sample.tiff")
        pipe.segment(nucleus_channel=0, min_area=1)

        cells = pipe.data.cells
        self.assertGreater(len(cells), 0)
        for column in [
            "cell_id",
            "y",
            "x",
            "area",
            "sample_id",
            "intensity_DNA",
            "intensity_CD3",
            "intensity_CD8",
            "intensity_FOXP3",
            "intensity_Ki67",
        ]:
            self.assertIn(column, cells.columns)
        self.assertEqual(cells["sample_id"].unique().tolist(), ["sample"])
        self.assertTrue((pipe.output_dir / "masks" / "sample_mask.tiff").exists())

    def test_qc_filter_empty_data(self):
        pipe = self.make_pipeline()
        pipe.data.cells = pd.DataFrame()
        pipe.qc_filter()
        self.assertTrue(pipe.data.cells.empty)

    def test_qc_filter_removes_extreme_values(self):
        pipe = self.make_pipeline()
        pipe.data.cells = pd.DataFrame(
            {
                "area": [5, 20, 20, 1000],
                "intensity_DNA1": [0, 1, 2, 100],
            }
        )
        pipe.qc_filter(min_intensity_pct=0.25, max_area_factor=2)
        self.assertEqual(pipe.data.cells["area"].tolist(), [20, 20])

    def test_cluster_empty_data_is_noop(self):
        pipe = self.make_pipeline()
        pipe.data.cells = pd.DataFrame()
        pipe.cluster()
        self.assertNotIn("cluster", pipe.data.cells.columns)

    def test_cellular_neighborhood_empty_data_is_noop(self):
        pipe = self.make_pipeline()
        pipe.data.cells = pd.DataFrame()
        pipe.cellular_neighborhood()
        self.assertTrue(pipe.data.cells.empty)

    def test_cellular_neighborhood_protects_small_sample(self):
        pipe = self.make_pipeline()
        pipe.data.cells = pd.DataFrame(
            {
                "sample_id": ["s1"],
                "x": [0.0],
                "y": [0.0],
                "cluster": ["A"],
            }
        )
        pipe.cellular_neighborhood()
        self.assertIn("CN6", pipe.data.cells.columns)
        self.assertEqual(pipe.data.cells.loc[0, "CN6"], "Niche1")

    def test_cell_interaction_writes_csv(self):
        pipe = self.make_pipeline()
        pipe.data.cells = pd.DataFrame(
            {
                "sample_id": ["s1", "s1", "s1"],
                "x": [0.0, 10.0, 40.0],
                "y": [0.0, 0.0, 0.0],
                "cluster": ["A", "B", "C"],
            }
        )
        pipe.cell_interaction()
        output = pipe.output_dir / "interaction_counts.csv"
        self.assertTrue(output.exists())
        counts = pd.read_csv(output)
        self.assertTrue({"sample_id", "from_label", "to_label", "ct"} <= set(counts.columns))
        self.assertGreater(len(counts), 0)


class TestOtsu(unittest.TestCase):
    def test_segment_otsu_returns_labels(self):
        dna = np.zeros((32, 32), dtype=np.float32)
        yy, xx = np.mgrid[0:32, 0:32]
        for cy, cx in [(8, 8), (24, 24)]:
            radius2 = (yy - cy) ** 2 + (xx - cx) ** 2
            dna = np.maximum(dna, np.clip(240.0 - 2.0 * radius2, 0, 255))

        labels = imc_pipeline.segment_otsu(dna)
        self.assertEqual(labels.shape, dna.shape)
        self.assertEqual(labels.dtype, np.int32)
        self.assertGreater(int(labels.max()), 0)


if __name__ == "__main__":
    unittest.main()
