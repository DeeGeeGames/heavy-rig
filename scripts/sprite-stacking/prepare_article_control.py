"""Recover native car inputs from the article's pixel-enlarged illustration.

No generated art, geometry changes, palette fitting, or arbitrary resizing.
The diagnostic source URL and SHA-256 are pinned in control/source.json.
"""

import argparse
import hashlib
import io
import json
from pathlib import Path
import urllib.request

from PIL import Image

DIRECTORY = Path(__file__).resolve().parents[2] / "design/studies/warden-article/control"


def prepare(source):
    recipe = json.loads((DIRECTORY / "source.json").read_text())
    raw = source.read_bytes() if source else urllib.request.urlopen(recipe["sourceUrl"]).read()
    if hashlib.sha256(raw).hexdigest() != recipe["sourceSha256"]:
        raise ValueError("The article car illustration changed")
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    for name, view in recipe["views"].items():
        panel = image.crop(view["panel"])
        panel.putdata([(*pixel[:3], 0 if pixel[:3] == (255, 255, 255) else 255) for pixel in panel.get_flattened_data()])
        crop = panel.crop(view["bounds"])
        if crop.width != view["size"][0] * 6 or crop.height != view["size"][1] * 6:
            raise ValueError("Unexpected enlarged control input dimensions")
        native = crop.resize(view["size"], Image.Resampling.NEAREST)
        output = io.BytesIO()
        native.save(output, format="PNG")
        if hashlib.sha256(output.getvalue()).hexdigest() != view["sha256"]:
            raise ValueError(f"Unexpected native control pixels: {name}")
        (DIRECTORY / f"{name}.png").write_bytes(output.getvalue())
    print("Recovered all four native article car inputs")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Optional downloaded illustration; otherwise fetch the pinned URL")
    prepare(parser.parse_args().source)
