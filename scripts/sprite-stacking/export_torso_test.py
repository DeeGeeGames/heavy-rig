"""Export the hand-authored static torso as horizontal RGBA slices.

No mesh input, inferred silhouettes, generated views, or runtime shading.
Requires Pillow 12.3.0. See the study README for the fixed paint calibration.
"""

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "design/studies/warden-torso"


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def interpolate(sections, height):
    low = sections[0]
    for high in sections[1:]:
        if height <= high["z"]:
            t = (height - low["z"]) / (high["z"] - low["z"])
            return {key: low[key] + (high[key] - low[key]) * t
                    for key in ("halfWidth", "front", "back", "bevel")}
        low = high
    return low


def volume(spec):
    cells = {}
    size = spec["grid"]["size"]
    sections = spec["sections"]
    for z in range(spec["sliceCount"]):
        section = interpolate(sections, z)
        width, front, back, bevel = [section[key] for key in ("halfWidth", "front", "back", "bevel")]
        for y in range(-size // 2, size // 2):
            for x in range(-size // 2, size // 2):
                if abs(x) > width or not front <= y <= back:
                    continue
                corner = max(0, abs(x) - (width - bevel))
                if y < front + corner or y > back - corner:
                    continue
                # Shallow lower-front armor relief. The cockpit slit is paint.
                if -7 <= x <= 7 and 13 <= z <= 16 and y < front + 2:
                    continue
                cells[(x, y, z)] = spec["unseenColor"]
    return cells


def extend_paint(cells, anchors):
    """Fill solid slice interiors so rotation does not expose unpainted speckles.

    These are fixed voxel colors, never recomputed by the runtime camera.
    This extrapolation is placeholder art, not additional approved source views.
    """
    by_height = {}
    for index, ((x, y, z), _) in enumerate(cells.items(), 1):
        color = anchors.get(str(index))
        if color is not None:
            by_height.setdefault(z, []).append((x, y, color))
    paint = {}
    for index, ((x, y, z), default) in enumerate(cells.items(), 1):
        points = by_height.get(z, [])
        color = min(points, key=lambda point: (point[0] - x) ** 2 + (point[1] - y) ** 2)[2] if points else default
        if (x + 1, y, z) not in cells or (x, y + 1, z) not in cells:
            color = default
        paint[str(index)] = anchors.get(str(index), color)
    return paint


def export(directory):
    spec = json.loads((directory / "volume.json").read_text())
    isolation = json.loads((directory / "reference.json").read_text())
    source = ROOT / "design/studies/warden-sprite-stacking/art/approved-concept.png"
    if hashlib.sha256(source.read_bytes()).hexdigest() != isolation["sourceSha256"]:
        raise ValueError("Selected A2 source hash changed")
    original = Image.open(source).convert("RGBA")
    mask = Image.new("L", original.size)
    ImageDraw.Draw(mask).polygon(isolation["polygon"], fill=255)
    original.putalpha(mask)
    crop = original.crop(mask.getbbox())
    placement = spec["referencePlacement"]
    crop = crop.resize((placement["width"], round(crop.height * placement["width"] / crop.width)), Image.Resampling.NEAREST)
    reference = Image.new("RGBA", (48, 48))
    reference.paste(crop, (placement["x"], placement["y"]))
    reference.save(directory / "reference.png")

    paint_path = directory / "paint.json"
    paint_source = json.loads(paint_path.read_text()) if paint_path.exists() else None
    if paint_source is not None:
        if paint_source["volumeSha256"] != hashlib.sha256((directory / "volume.json").read_bytes()).hexdigest():
            raise ValueError("Authored volume changed; repaint and recalibrate before exporting")
        if paint_source["camera"] != spec["camera"] or paint_source["sourceSha256"] != isolation["sourceSha256"]:
            raise ValueError("Paint camera or approved reference changed; recalibration required")
    anchors = paint_source["cells"] if paint_source is not None else {}
    size, columns, count = spec["grid"]["size"], spec["grid"]["columns"], spec["sliceCount"]
    cells = volume(spec)
    paint = extend_paint(cells, anchors)
    dimensions = (columns * size, ((count + columns - 1) // columns) * size)
    atlases = {name: Image.new("RGBA", dimensions) for name in ("layers", "unpainted", "ids")}
    palette = Counter()
    for index, ((x, y, z), default) in enumerate(cells.items(), 1):
        color = paint.get(str(index), default)
        palette[tuple(color)] += 1
        position = ((z % columns) * size + x + size // 2, (z // columns) * size + y + size // 2)
        atlases["layers"].putpixel(position, tuple(color) + (255,))
        atlases["unpainted"].putpixel(position, tuple(spec["unseenColor"]) + (255,))
        atlases["ids"].putpixel(position, (index & 255, (index >> 8) & 255, (index >> 16) & 255, 255))
    for name, atlas in atlases.items():
        atlas.save(directory / f"{name}.png")

    def asset(name):
        filename = f"{name}.png"
        return {"image": filename, "sha256": hashlib.sha256((directory / filename).read_bytes()).hexdigest(),
                "sliceCount": count, "zMin": 0}

    metrics_path = directory / "calibration.json"
    metrics = json.loads(metrics_path.read_text()) if metrics_path.exists() else {"silhouetteIoU": 0, "colorMeanError": 0, "matchedPixelCount": 0}
    radius = math.ceil(max(math.hypot(x + 0.5, y + 0.5) for x, y, _ in cells) + math.sqrt(0.5))
    manifest = {"version": 1, "grid": {**spec["grid"], "occupiedRadius": radius}, "layers": asset("layers"), "unpainted": asset("unpainted"),
                "reference": {"image": "reference.png", "width": 48, "height": 48,
                              "sha256": hashlib.sha256((directory / "reference.png").read_bytes()).hexdigest()},
                "frame": {"width": 48, "height": 48}, "camera": spec["camera"], "metrics": metrics,
                "source": {"scope": isolation["scope"],
                           "paintMethod": "Fixed A2 paint anchors extended through solid slices. Hidden faces use extrapolated placeholder paint; they have no approved reference."},
                "voxelCount": len(cells)}
    write_json(directory / "manifest.json", manifest)
    write_json(directory / "export-report.json", {"voxelCount": len(cells), "sourcePaintAnchors": len(anchors),
               "paletteSize": len(palette), "rgba8BytesPerAtlas": dimensions[0] * dimensions[1] * 4})
    print(json.dumps({"voxels": len(cells), "palette": len(palette), "atlas": dimensions}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT)
    export(parser.parse_args().output)
