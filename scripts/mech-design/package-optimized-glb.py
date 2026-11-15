"""Deduplicate, prune and validate a GLB without discarding empty anchor nodes."""

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "blender"))
from optimization_io import fresh_output, resolve_input

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--repo", type=Path, required=True)
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
repo = args.repo.resolve()
source = resolve_input(repo, args.input)
output = fresh_output(repo, args.output)
if source.suffix != ".glb" or output.suffix != ".glb":
    raise ValueError("Input and output must use .glb.")
log = fresh_output(repo, output.with_suffix(".gltf.log"))
command = ["bunx", "--package", "@gltf-transform/cli@4.5.1", "gltf-transform"]
with tempfile.TemporaryDirectory(prefix=".gltf-pack-", dir=output.parent) as scratch:
    intermediate = Path(scratch) / "deduplicated.glb"
    with log.open("w") as stream:
        for arguments in [
            ["dedup", str(source), str(intermediate)],
            ["prune", str(intermediate), str(output), "--keep-leaves", "true"],
            ["validate", str(output)],
        ]:
            result = subprocess.run(
                command + arguments, stdout=stream, stderr=subprocess.STDOUT
            )
            if result.returncode:
                raise RuntimeError(f"GLB packaging/validation failed; inspect {log}")
print(f"Packaged and validated {output}; log: {log}")
