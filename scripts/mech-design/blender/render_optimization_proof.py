"""Render two actual GLB exports at matching close and declared gameplay scales.

Run in a fresh Blender process. Camera scale is an explicit per-model contract,
not a universal distance or a runtime performance measurement.
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from optimization_io import blender_arguments, fresh_output, resolve_input

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--repo", type=Path, required=True)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--candidate", type=Path, required=True)
parser.add_argument("--camera-scale", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--target", type=float, nargs=3)
parser.add_argument("--span", type=float)
parser.add_argument("--geometry-only", action="store_true")
args = parser.parse_args(blender_arguments())
repo = args.repo.resolve()
paths = {
    key: resolve_input(repo, value)
    for key, value in [("source", args.source), ("candidate", args.candidate)]
}
input_hashes = {
    key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items()
}
scale = json.loads(resolve_input(repo, args.camera_scale).read_text())
for key in ["pixelsPerSourceUnit", "maximumZoomPixelsPerSourceUnit"]:
    value = scale.get(key)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value <= 0
    ):
        raise ValueError(f"Camera scale must declare a positive finite {key}.")
direction = scale.get("cameraDirection")
if (
    not isinstance(direction, list)
    or len(direction) != 3
    or any(
        isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
        for v in direction
    )
):
    raise ValueError(
        "Camera scale must declare three finite Three.js cameraDirection components."
    )
game_direction = Vector((direction[0], -direction[2], direction[1]))
if game_direction.length == 0:
    raise ValueError("Camera direction must be nonzero.")
if args.span is not None and (not math.isfinite(args.span) or args.span <= 0):
    raise ValueError("Span must be positive and finite.")
if args.target is not None and not all(math.isfinite(value) for value in args.target):
    raise ValueError("Target must be finite.")
output = fresh_output(repo, args.output, directory=True)
target = Vector(args.target) if args.target else None
span = args.span
for key, path in paths.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    points = [
        obj.matrix_world @ vertex.co
        for obj in scene.objects
        if obj.type == "MESH"
        for vertex in obj.data.vertices
    ]
    if not points:
        raise ValueError(f"No mesh geometry in {path}")
    if key == "source":
        low = Vector([min(p[i] for p in points) for i in range(3)])
        high = Vector([max(p[i] for p in points) for i in range(3)])
        target = target if target is not None else (low + high) / 2
        span = span if span is not None else (high - low).length * 1.25
    if args.geometry_only:
        neutral_materials = {}

        def neutral_material(cull_backfaces):
            if cull_backfaces not in neutral_materials:
                material = bpy.data.materials.new("Structural neutral")
                material.use_nodes = True
                material.use_backface_culling = cull_backfaces
                shader = material.node_tree.nodes["Principled BSDF"]
                shader.inputs["Base Color"].default_value = (0.24, 0.29, 0.32, 1)
                shader.inputs["Metallic"].default_value = 0.3
                shader.inputs["Roughness"].default_value = 0.42
                neutral_materials[cull_backfaces] = material
            return neutral_materials[cull_backfaces]

        for obj in scene.objects:
            if obj.type != "MESH":
                continue
            if not obj.data.materials:
                obj.data.materials.append(neutral_material(False))
            else:
                for slot in obj.material_slots:
                    slot.material = neutral_material(
                        slot.material.use_backface_culling if slot.material else False
                    )
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.world = bpy.data.worlds.new("Studio")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (
        0.16,
        0.18,
        0.21,
        1,
    )
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    # Scale studio geometry/light power together for components of different size.
    studio_scale = span / 0.43
    for name, position, power, size in [
        ("Key", (0.5, -0.7, 0.7), 12, 0.6),
        ("Fill", (-0.5, -0.2, 0.3), 5, 0.5),
        ("Rim", (0.3, 0.6, 0.5), 15, 0.4),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power * studio_scale**2
        data.shape = "DISK"
        data.size = size * studio_scale
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = target + Vector(position) * studio_scale
        obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    camera.data.clip_start = max(span * 0.0001, 0.000001)
    camera.data.clip_end = span * 100
    for view, direction, width, height, ortho in [
        ("front", (0, -1, 0.15), 720, 600, span),
        ("oblique", (0.8, -1, 0.55), 720, 600, span),
        ("rear", (0.8, 1, 0.6), 720, 600, span),
        ("side", (1, 0, 0.15), 720, 600, span),
        ("opposite-side", (-1, 0, 0.15), 720, 600, span),
        ("underside", (0.8, -0.7, -0.7), 720, 600, span),
        ("game", game_direction, 160, 120, 160 / scale["pixelsPerSourceUnit"]),
        (
            "zoom",
            game_direction,
            160,
            120,
            160 / scale["maximumZoomPixelsPerSourceUnit"],
        ),
    ]:
        camera.data.ortho_scale = ortho
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.resolution_percentage = 100
        camera.location = target + Vector(direction).normalized() * span * 4
        camera.rotation_euler = (
            (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        )
        scene.render.filepath = str(output / f"{key}-{view}.png")
        bpy.ops.render.render(write_still=True)
if any(
    hashlib.sha256(path.read_bytes()).hexdigest() != input_hashes[key]
    for key, path in paths.items()
):
    raise RuntimeError(
        "An input GLB changed during rendering; regenerate the comparison."
    )
report = {
    "inputs": {
        key: {
            "path": str(path.relative_to(repo))
            if path.is_relative_to(repo)
            else str(path),
            "sha256": input_hashes[key],
        }
        for key, path in paths.items()
    },
    "target": list(target),
    "span": span,
    "geometryOnly": args.geometry_only,
    "renders": {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(output.glob("*.png"))
    },
    "cameraScale": scale,
    "scope": "Matched export renders and declared gameplay-size estimates; no runtime capture or performance measurement.",
}
(output / "render-report.json").write_text(json.dumps(report, indent=2) + "\n")
