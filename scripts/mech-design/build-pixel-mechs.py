"""Rebuild the three approved pixel GLBs on the high-detail game-ready rigs.

Uses the Python standard library. Verified with CPython 3.11 and 3.14.
Outputs are checked against each pixel selection manifest before the new scratch
directory is populated. Paths are relative to the repo.
"""

import argparse
import hashlib
from importlib import import_module
import json
from pathlib import Path
import tempfile

from blender.optimization_io import fresh_output, resolve_input
from pixel_mechs import kestrel, maul, warden
from pixel_mechs.export import assemble
from pixel_mechs.geometry import PlateMesh


REPO = Path(__file__).resolve().parents[2]
RECIPES = {"warden": warden, "kestrel": kestrel, "maul": maul}
glb = import_module("modular-export")


def verify(path, expected):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(f"SHA-256 mismatch for {path}: expected {expected}, got {actual}")


def rebuild(chassis, recipe, staging):
    manifest_path = REPO / "design/mechs/assets" / chassis / "pixel/manifest.json"
    selection = json.loads(manifest_path.read_text())
    source_path = resolve_input(REPO, selection["source"]["path"])
    source_hash = selection["source"]["sha256"]
    verify(source_path, source_hash)
    source, source_bytes = glb.read_glb(source_path)
    if hasattr(recipe, "prepare_source"):
        source = recipe.prepare_source(source)

    mesh = PlateMesh(source["nodes"], recipe.PALETTE)
    recipe.build(mesh)
    document, binary = assemble(chassis, source_hash, source, source_bytes, mesh, recipe.VISOR_EMISSIVE)
    target = staging / chassis / "pixel.glb"
    target.parent.mkdir()
    glb.write_glb(target, document, binary)
    expected = selection["asset"]["sha256"]
    verify(target, expected)
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="New directory under design/mechs/generated")
    args = parser.parse_args()
    output = fresh_output(REPO, args.out)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary)
        hashes = {name: rebuild(name, recipe, staging) for name, recipe in RECIPES.items()}
        fresh_output(REPO, output, directory=True)
        for chassis in hashes:
            (staging / chassis).rename(output / chassis)
    for chassis, digest in hashes.items():
        print(f"{digest}  {output / chassis / 'pixel.glb'}")


if __name__ == "__main__":
    main()
