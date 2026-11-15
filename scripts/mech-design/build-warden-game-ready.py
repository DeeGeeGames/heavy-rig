"""Rebuild the selected Warden derivative from immutable P2 and approved pod inputs.

Requires Python/Pillow 13, Blender 5.2, Bun and pinned glTF Transform 4.5.1.
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
args = parser.parse_args()
repo = args.repo.resolve()
output = (repo / args.output).resolve()
if not output.is_relative_to(repo / "design/mechs/generated") or output.exists():
    raise ValueError("Output must be a new directory inside design/mechs/generated")
source = repo / "design/mechs/assets/warden/game-ready/source.glb"
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
if source_hash != "3dd7eb875bafd4ba536f874b8e44583f06ae4bf1bcbb9fac998c44910b5252b9":
    raise ValueError("Selected P2 source hash differs; restore Git LFS inputs")
for pod, expected in [
    ("pod", "a93920080db8c2ea60130de46628b53322622a3a66a44a0fce2c86533525c2a5"),
    ("right-pod", "5ee718e21d23be22144c2f5b87d9bff5df0aef8847bb4f5141f2aaadb000ed89"),
]:
    pod_path = repo / "design/mechs/assets/warden/optimization" / pod / "pod.glb"
    if hashlib.sha256(pod_path.read_bytes()).hexdigest() != expected:
        raise ValueError("Approved pod hash differs; restore selected Git LFS inputs")

output.mkdir(parents=True)
work = output / "geometry-work"
work.mkdir()
recipe = repo / "scripts/mech-design/blender/warden_game_ready"
environment = dict(
    os.environ,
    WARDEN_GAME_REPO=str(repo),
    WARDEN_GAME_WORK=str(work),
    WARDEN_GAME_SOURCE=str(source),
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
report = {
    "sourceSha256": source_hash,
    "sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
    "bytes": asset.stat().st_size,
    "asset": str(asset.relative_to(repo)),
    "scope": "Rebuilt candidate; compare exports before replacing the selected asset.",
    "recipeHashes": {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(recipe.glob("*.py"))
    },
}
(output / "reproduction.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
