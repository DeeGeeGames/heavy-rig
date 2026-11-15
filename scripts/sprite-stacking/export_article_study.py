"""Export static Warden and article-car stacks from four named flat views."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from article_converter import convert

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "design/studies/warden-article"
ARTICLE = "https://www.spritecook.ai/blog/sprite-stacking-pixel-art"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(output):
    output.mkdir(parents=True, exist_ok=True)
    datasets = []
    reports = {}
    for identifier, label, folder in [("warden", "Warden · four-view reproduction", ASSETS / "inputs"),
                                      ("car", "Article car · control", ASSETS / "control")]:
        provenance = json.loads((ASSETS / "input-report.json" if identifier == "warden" else folder / "source.json").read_text())
        for name in ["top", "side", "front", "back"]:
            if digest(folder / f"{name}.png") != provenance["views"][name]["sha256"]:
                raise ValueError(f"Prepared input hash changed: {identifier}/{name}")
        images = {name: Image.open(folder / f"{name}.png").convert("RGBA") for name in ["top", "side", "front", "back"]}
        pixels, fitted = convert(images)
        height, depth, width = pixels.shape[:3]
        filename = f"{identifier}-slices.png"
        Image.fromarray(np.concatenate(list(pixels), axis=1)).save(output / filename)
        views = [{"name": name, "image": str((folder / f"{name}.png").relative_to(ASSETS)),
                  "sha256": digest(folder / f"{name}.png"), "width": image.width, "height": image.height}
                 for name, image in images.items()]
        notes = (["The faithful conversion still distorts this mech. The car control is coherent; Warden fidelity has not passed.",
                  "Static full mech: chest-only silhouettes are obscured by the arm in the side view.",
                  "Four retained intended orthographic drafts supply geometry and surface colors. They are not validated turnarounds; the angled A2 image is not an input.",
                  "Named view labels replace the car-specific aspect-ratio detector. Conversion rules and default shade 0 are retained.",
                  "Top/front widths and top/side depth differ slightly, and some details disagree across views. The article's fitter adjusts dimensions, not those contradictions.",
                  "No animated legs, hand-shaped volume, single-view paint transfer or pixelated mesh rendering."] if identifier == "warden" else
                 ["Control inputs recovered from SpriteCook's published four-view illustration at its native 6× pixel scale.",
                  "Article artwork is retained only as an attributed diagnostic control; it is separate from game assets.",
                  "Same converter, shared palette of 24 colors, shade 0, and renderer as Warden."])
        datasets.append({"id": identifier, "label": label, "views": views,
                         "slices": {"image": filename, "sha256": digest(output / filename), "width": width, "height": depth, "count": height},
                         "notes": notes})
        reports[identifier] = {"inputSizes": {name: image.size for name, image in images.items()},
                               "fittedSizes": {name: [array.shape[1], array.shape[0]] for name, array in fitted.items()},
                               "sliceCount": height, "sliceSize": [width, depth], "occupiedVoxels": int((pixels[..., 3] > 0).sum()),
                               "rgba8Bytes": int(pixels.size), "paletteSize": len(np.unique(pixels[pixels[..., 3] > 0, :3], axis=0)),
                               "sliceSha256": digest(output / filename)}
    (output / "manifest.json").write_text(json.dumps({"version": 1, "articleUrl": ARTICLE, "defaultDataset": "warden", "datasets": datasets}, indent=2) + "\n")
    (output / "conversion-report.json").write_text(json.dumps({"colors": 24, "shade": 0, "topNose": "down", "sideNose": "left", "datasets": reports}, indent=2) + "\n")
    print(json.dumps(reports))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ASSETS)
    export(parser.parse_args().output)
