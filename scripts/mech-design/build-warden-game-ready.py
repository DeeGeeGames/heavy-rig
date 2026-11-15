"""Rebuild the selected Warden derivative from immutable P2 and approved pod inputs.

Requires Python/Pillow 12.3, Blender 5.2, Bun and pinned glTF Transform 4.5.1.
The anatomy rules are Warden-specific; this is not a universal mech retopologizer.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--blender-command", default="blender")
parser.add_argument("--recipe", type=Path, default=Path("design/mechs/assets/warden/game-ready/recipe.json"))
args = parser.parse_args()
repo = args.repo.resolve()
output = (repo / args.output).resolve()
if not output.is_relative_to(repo / "design/mechs/generated") or output.exists():
    raise ValueError("Output must be a new directory inside design/mechs/generated")
recipe_path = (repo / args.recipe).resolve()
recipe = repo / "scripts/mech-design/blender/warden_game_ready"
sys.path.insert(0, str(recipe))
from recipe import load_recipe
os.environ["WARDEN_GAME_RECIPE"] = str(recipe_path)
config = load_recipe(repo)
source = repo / config["inputs"]["source"]["path"]
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

output.mkdir(parents=True)
work = output / "geometry-work"
work.mkdir()
recipe = repo / "scripts/mech-design/blender/warden_game_ready"
environment = dict(
    os.environ,
    WARDEN_GAME_REPO=str(repo),
    WARDEN_GAME_WORK=str(work),
    WARDEN_GAME_SOURCE=str(source),
    WARDEN_GAME_RECIPE=str(recipe_path),
)
blender = shlex.split(args.blender_command)
if not blender:
    raise ValueError("Blender command is empty")


def run(command, name):
    with (output / (name + ".log")).open("w") as stream:
        subprocess.run(
            command,
            cwd=repo,
            env=environment,
            stdout=stream,
            stderr=subprocess.STDOUT,
            check=True,
        )


def blender_script(name, extra=()):
    return blender + [
        "--background",
        "--factory-startup",
        "--threads",
        "2",
        "--python-exit-code",
        "1",
        "--python",
        str(recipe / name),
        *extra,
    ]


run([sys.executable, str(recipe / "pack_atlas.py")], "atlas")
run(blender_script("inventory_source.py"), "inventory")
run(blender_script("build_geometry.py"), "geometry")
rig = output / "rig"
run(
    blender_script(
        "package_rig.py",
        [
            "--",
            "--repo",
            str(repo),
            "--input",
            str(work / "geometry.glb"),
            "--contract",
            str(work / "rig-contract.json"),
            "--output",
            str(rig),
        ],
    ),
    "rig",
)
transform = ["bunx", "--package", "@gltf-transform/cli@4.5.1", "gltf-transform"]
steps = [
    ["dedup", str(rig / "warden.glb"), str(output / "dedup.glb")],
    ["weld", str(output / "dedup.glb"), str(output / "weld.glb")],
    ["tangents", str(output / "weld.glb"), str(output / "tangents.glb")],
    [
        "quantize",
        str(output / "tangents.glb"),
        str(output / "quantized.glb"),
        "--quantize-position",
        "16",
        "--quantize-normal",
        "12",
        "--quantize-texcoord",
        "14",
    ],
    [
        "prune",
        str(output / "quantized.glb"),
        str(output / "warden.glb"),
        "--keep-leaves",
        "true",
    ],
    ["validate", str(output / "warden.glb")],
]
for index, step in enumerate(steps):
    run(transform + step, f"packaging-{index}-{step[0]}")
run(
    [
        "bun",
        str(repo / "scripts/mech-design/verify-authored-rig.mjs"),
        str(output / "warden.glb"),
        str(rig / "rig-report.json"),
        str(output / "rig-validation.json"),
    ],
    "verify-rig",
)
asset = output / "warden.glb"
from PIL import __version__ as pillow_version

def version(command):
    result = subprocess.run(command, cwd=repo, capture_output=True, text=True, check=True)
    return result.stdout.strip().splitlines()[0]

fingerprint_paths = [
    Path(__file__), recipe_path,
    *sorted(recipe.glob("*.py")),
    repo / "scripts/mech-design/blender/source_inventory.py",
    repo / "scripts/mech-design/blender/rigid_contract.py",
    repo / "scripts/mech-design/blender/rigid_packaging.py",
    repo / config["inputs"]["ownership"]["path"],
    repo / "scripts/mech-design/blender/locomotion_trial.py",
    repo / "scripts/mech-design/verify-authored-rig.mjs",
    repo / "scripts/mech-design/verify-game-ready.mjs",
    repo / "scripts/mech-design/candidate-budget.ts",
    repo / "bun.lock",
]
report = {
    "toolVersions": {
        "python": sys.version.split()[0],
        "pillow": pillow_version,
        "blender": version(blender + ["--version"]),
        "bun": version(["bun", "--version"]),
        "gltfTransform": version(transform + ["--version"]),
    },
    "sourceSha256": source_hash,
    "sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
    "bytes": asset.stat().st_size,
    "asset": str(asset.relative_to(repo)),
    "scope": "Rebuilt candidate; compare exports before replacing the selected asset.",
    "recipeHashes": {
        str(p.resolve().relative_to(repo)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in fingerprint_paths
    },
}
(output / "reproduction.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
