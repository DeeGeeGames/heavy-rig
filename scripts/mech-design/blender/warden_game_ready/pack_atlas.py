"""Repack retained approved pod bakes; no generative imagery or re-bake."""

from pathlib import Path
import os
import json, struct, hashlib, io
from PIL import Image
import math

r = Path(os.environ["WARDEN_GAME_WORK"]).resolve()
repo = Path(os.environ["WARDEN_GAME_REPO"]).resolve()
size = 128
tile = size // 2
pad = 3
inner = tile - 2 * pad
color = Image.new("RGB", (size, size), (115, 125, 135))
normal = Image.new("RGB", (size, size), (128, 128, 255))
rows = []
for side, folder in [("left", "pod"), ("right", "right-pod")]:
    path = repo / "design/mechs/assets/warden/optimization" / folder / "pod.glb"
    b = path.read_bytes()
    expected = {
        "left": "a93920080db8c2ea60130de46628b53322622a3a66a44a0fce2c86533525c2a5",
        "right": "5ee718e21d23be22144c2f5b87d9bff5df0aef8847bb4f5141f2aaadb000ed89",
    }
    if hashlib.sha256(b).hexdigest() != expected[side]:
        raise ValueError("Approved pod hash differs; restore the selected source")
    n = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20 : 20 + n])
    data = b[28 + n :]
    for mi, mat in enumerate(g["materials"]):
        index = len(rows)
        x = (index % 2) * tile
        y = (index // 2) * tile
        row = {
            "side": side,
            "material": mat["name"],
            "tile": index,
            "source": str(path.relative_to(repo)),
            "sourceSha256": hashlib.sha256(b).hexdigest(),
            "uvOffset": [(x + pad) / size, (size - y - pad - inner) / size],
            "uvScale": [inner / size, inner / size],
        }
        for kind, target, texture in [
            ("color", color, mat["pbrMetallicRoughness"]["baseColorTexture"]),
            ("normal", normal, mat["normalTexture"]),
        ]:
            im = g["images"][g["textures"][texture["index"]]["source"]]
            v = g["bufferViews"][im["bufferView"]]
            raw = data[
                v.get("byteOffset", 0) : v.get("byteOffset", 0) + v["byteLength"]
            ]
            source = Image.open(io.BytesIO(raw)).convert("RGB")
            thumb = source.resize((inner, inner), Image.Resampling.LANCZOS)
            if kind == "normal":
                values = []
                for pixel in thumb.get_flattened_data():
                    v = [c / 127.5 - 1 for c in pixel]
                    length = max(math.sqrt(sum(c * c for c in v)), 1e-6)
                    values.append(
                        tuple(
                            max(0, min(255, round((c / length + 1) * 127.5))) for c in v
                        )
                    )
                thumb.putdata(values)
            # Edge extension prevents bilinear sampling across the UV region boundary.
            block = Image.new("RGB", (tile, tile))
            block.putdata(
                [
                    thumb.getpixel(
                        (
                            max(0, min(inner - 1, px - pad)),
                            max(0, min(inner - 1, py - pad)),
                        )
                    )
                    for py in range(tile)
                    for px in range(tile)
                ]
            )
            target.paste(block, (x, y))
            row[kind] = {
                "sourceDimensions": list(source.size),
                "sourceImageSha256": hashlib.sha256(raw).hexdigest(),
            }
        rows.append(row)
color.save(r / "pod-color.png")
normal.save(r / "pod-normal.png")
(r / "atlas.json").write_text(
    json.dumps(
        {
            "size": size,
            "paddingPixels": pad,
            "tiles": rows,
            "rgba8WithFullMipChainEstimatedBytes": 2 * size * size * 4 * 4 / 3,
        },
        indent=2,
    )
    + "\n"
)
print("atlas", size, "source materials", len(rows))
