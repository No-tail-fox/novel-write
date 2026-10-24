import importlib.util
from pathlib import Path
import unittest

import numpy as np


WORKER_PATH = Path(__file__).resolve().parents[1] / "src" / "shared" / "remove-background-worker.py"
SPEC = importlib.util.spec_from_file_location("remove_background_worker", WORKER_PATH)
WORKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORKER)


class OutputMaskTests(unittest.TestCase):
    def test_preserves_low_confidence_probability_masks(self) -> None:
        source = np.full((1, 1, 2, 2), 0.001, dtype=np.float32)

        result = WORKER.output_mask([source])

        self.assertTrue(np.all(result == 0))

    def test_converts_logits_with_sigmoid_without_per_image_stretching(self) -> None:
        source = np.asarray([[[[-10.0, 0.0], [10.0, 0.0]]]], dtype=np.float32)

        result = WORKER.output_mask([source], "birefnet")

        self.assertEqual(result.shape, (2, 2))
        self.assertEqual(int(result[0, 0]), 0)
        self.assertGreaterEqual(int(result[0, 1]), 127)
        self.assertGreaterEqual(int(result[1, 0]), 254)

    def test_birefnet_always_decodes_logits_even_inside_probability_range(self) -> None:
        source = np.full((1, 1, 2, 2), 0.0, dtype=np.float32)
        self.assertTrue(np.all(WORKER.output_mask([source], "birefnet") == 127))

    def test_isnet_uses_its_own_preprocessing(self) -> None:
        image = WORKER.Image.new("RGB", (2, 2), (255, 255, 255))
        self.assertTrue(np.allclose(WORKER.prepare_input(image, 2, 2, "isnet"), 0.5))
        self.assertFalse(np.allclose(WORKER.prepare_input(image, 2, 2, "birefnet"), 0.5))

    def test_rejects_non_finite_model_outputs(self) -> None:
        source = np.asarray([[[[0.0, float("nan")], [1.0, 0.0]]]], dtype=np.float32)

        with self.assertRaisesRegex(RuntimeError, "non-finite mask"):
            WORKER.output_mask([source])


if __name__ == "__main__":
    unittest.main()
