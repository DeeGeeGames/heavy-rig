"""Filesystem guards shared by the optimization authoring commands."""

import hashlib
import json
import sys


def blender_arguments():
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def resolve_input(repo, value):
    path = (repo / value).resolve()
    if not path.is_file():
        raise ValueError(f"Missing input: {path}")
    if path.read_bytes().startswith(b"version https://git-lfs.github.com/spec/v1\n"):
        raise ValueError(f"LFS pointer instead of asset: {path}; run git lfs pull")
    return path


def verified_checkpoint(repo, relative):
    path = resolve_input(repo, relative)
    manifest = json.loads((repo / "design/mechs/assets/manifest.json").read_text())
    record = next(
        (entry for entry in manifest["files"] if entry["path"] == relative), None
    )
    data = path.read_bytes()
    if (
        record is None
        or len(data) != record["bytes"]
        or hashlib.sha256(data).hexdigest() != record["sha256"]
    ):
        raise ValueError(f"Checkpoint size/hash mismatch: {relative}")
    return path


def fresh_output(repo, value, directory=False):
    path = (repo / value).resolve()
    generated = (repo / "design/mechs/generated").resolve()
    if generated != repo / "design/mechs/generated":
        raise ValueError("The generated directory must not resolve through symlinks.")
    if not path.is_relative_to(generated) or path == generated:
        raise ValueError("Output must be a new path under design/mechs/generated.")
    if path.exists():
        raise ValueError(
            f"Preserve previous evidence; choose a new output path: {path}"
        )
    if directory:
        path.mkdir(parents=True, exist_ok=False)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
    return path
