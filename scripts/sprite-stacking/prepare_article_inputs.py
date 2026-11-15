"""Prepare the retained full-mech views for the article's four-view converter.

Only name, alpha-threshold, tight-crop and uniformly reduce the source views.
No geometry inference, palette replacement, individual fitting or repainting.
Requires Pillow 12.3.0.
"""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIRECTORY = ROOT / "design/studies/warden-article"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(directory, regions):
    recipe = json.loads(regions.read_text())
    source_path = ROOT / recipe["source"]
    if digest(source_path) != recipe["sourceSha256"]:
        raise ValueError("The retained four-view source image changed")
    source = Image.open(source_path).convert("RGBA")
    crops = {}
    boxes = {}
    for name, view in recipe["views"].items():
        quadrant = view["quadrant"]
        panel = source.crop(quadrant)
        alpha = panel.getchannel("A").point(
            lambda value: 255 if value >= recipe["alphaThreshold"] else 0
        )
        bounds = alpha.getbbox()
        if bounds is None:
            raise ValueError(f"The {name} input is empty")
        panel.putalpha(alpha)
        crops[name] = panel.crop(bounds)
        boxes[name] = [bounds[0] + quadrant[0], bounds[1] + quadrant[1],
                       bounds[2] + quadrant[0], bounds[3] + quadrant[1]]

    factor = recipe["targetSideHeight"] / crops["side"].height
    output = directory / "inputs"
    output.mkdir(parents=True, exist_ok=True)
    report = {
        "source": recipe["source"],
        "sourceSha256": recipe["sourceSha256"],
        "recipeSha256": digest(regions),
        "status": recipe["sourceStatus"],
        "uniformScaleFactor": factor,
        "dimensionRounding": "nearest whole pixel after applying the same factor",
        "alphaThreshold": recipe["alphaThreshold"],
        "views": {},
        "limitations": recipe["limitations"],
    }
    for name, crop in crops.items():
        size = (max(1, round(crop.width * factor)), max(1, round(crop.height * factor)))
        image = crop.resize(size, Image.Resampling.NEAREST)
        path = output / f"{name}.png"
        image.save(path)
        report["views"][name] = {
            "path": f"inputs/{name}.png",
            "forward": recipe["views"][name]["forward"],
            "sourceBounds": boxes[name],
            "sourceSize": list(crop.size),
            "size": list(size),
            "sha256": digest(path),
        }
    top, side, front, back = [report["views"][name] for name in ("top", "side", "front", "back")]
    report["measuredRatiosBeforeArticleFitting"] = {
        "topWidthOverFrontWidth": top["size"][0] / front["size"][0],
        "topDepthOverSideDepth": top["size"][1] / side["size"][0],
        "sideHeightOverFrontHeight": side["size"][1] / front["size"][1],
        "backWidthOverFrontWidth": back["size"][0] / front["size"][0],
    }
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "input-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({name: view["size"] for name, view in report["views"].items()}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--regions", type=Path, default=DEFAULT_DIRECTORY / "input-regions.json")
    arguments = parser.parse_args()
    prepare(arguments.output, arguments.regions)
