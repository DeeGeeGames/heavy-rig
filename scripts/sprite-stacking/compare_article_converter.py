"""Check the reproduction against a local copy of the article's Python block.

The published block is not vendored. Its hash is pinned before importing it.
Pass --reference /path/to/views_to_slices.py copied from the linked article.
"""

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image

from article_converter import convert

ROOT = Path(__file__).resolve().parents[2]
EXPECTED = "edc1d4bc842aa4129944be4cbd74323d2091f9b16c6de9bf64e965a3d6538b70"


def compare(reference_path):
    actual_hash = hashlib.sha256(reference_path.read_bytes()).hexdigest()
    if actual_hash != EXPECTED:
        raise ValueError("Reference block does not match the inspected article snapshot")
    module_spec = importlib.util.spec_from_file_location("published_article", reference_path)
    if module_spec is None or module_spec.loader is None:
        raise ValueError("Cannot load the inspected reference converter")
    reference = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(reference)
    report = {"referencePythonSha256": EXPECTED, "datasets": {}}
    for name, folder in [("warden", "inputs"), ("car", "control")]:
        images = {key: Image.open(ROOT / "design/studies/warden-article" / folder / f"{key}.png").convert("RGBA")
                  for key in ["top", "side", "front", "back"]}
        arrays = [np.array(image) for image in images.values()]
        top, side, front, back = reference.one_palette([reference.strip_outline(array) for array in arrays], 24)
        side = side[:, ::-1]
        depth, width = top.shape[:2]
        height = round(side.shape[0] * depth / side.shape[1])
        fitted = [top, reference.fit(side, depth, height), reference.fit(front, width, height), reference.fit(back, width, height)]
        checks = []
        for shade in [0, 0.25]:
            expected = reference.carve(*fitted, shade)
            actual, _ = convert(images, shade=shade)
            if not np.array_equal(actual, expected):
                raise ValueError(f"RGBA output differs from the article: {name}, shade {shade}")
            checks.append({"shade": shade, "rgbaEqual": True, "comparedChannels": int(actual.size)})
        report["datasets"][name] = checks
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    compare(parser.parse_args().reference)
