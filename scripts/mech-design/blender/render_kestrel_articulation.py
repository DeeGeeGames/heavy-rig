"""Render the exact Kestrel export in rest, diagnostic poses and sampled clips."""

import argparse
import bisect
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from optimization_io import blender_arguments, fresh_output, resolve_input
from rigid_packaging import accessor_values, read_glb


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--quick-joints", action="store_true")
    parser.add_argument("--materials", action="store_true", help="Inspect embedded materials instead of neutral override")
    args = parser.parse_args(blender_arguments())
    repo = args.repo.resolve()
    source = resolve_input(repo, args.input)
    output = fresh_output(repo, args.output, directory=True)
    document, binary = read_glb(source)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    scene = bpy.context.scene
    for obj in scene.objects:
        obj.animation_data_clear()
    basis = Matrix.Rotation(-math.pi / 2, 4, "X")
    inverse = basis.inverted()
    groups = {node["name"]: node for node in document["nodes"]
              if node.get("extras", {}).get("role") == "rigid-motion-group"}

    def reset():
        for name, node in groups.items():
            obj = scene.objects.get(name)
            if obj is None:
                raise ValueError("Missing imported rig node " + name)
            obj.location = inverse @ Vector(node.get("translation", [0, 0, 0]))
            q = node.get("rotation", [0, 0, 0, 1])
            rotation = Quaternion((q[3], q[0], q[1], q[2]))
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = (inverse.to_3x3() @ rotation.to_matrix() @ basis.to_3x3()).to_quaternion()
            obj.scale = node.get("scale", [1, 1, 1])
        bpy.context.view_layer.update()

    def sample(clip_name, phase):
        clip = next(animation for animation in document.get("animations", []) if animation["name"] == clip_name)
        for channel in clip["channels"]:
            node = document["nodes"][channel["target"]["node"]]
            obj = scene.objects.get(node["name"])
            sampler = clip["samplers"][channel["sampler"]]
            if sampler.get("interpolation", "LINEAR") != "LINEAR":
                raise ValueError("Only linear candidate channels are supported")
            times = [row[0] for row in accessor_values(document, binary, sampler["input"])]
            values = accessor_values(document, binary, sampler["output"])
            time = times[-1] * phase
            left = min(len(times) - 2, max(0, bisect.bisect_right(times, time) - 1))
            mix = (time - times[left]) / (times[left + 1] - times[left])
            a, b = values[left], values[left + 1]
            if channel["target"]["path"] == "rotation":
                q = Quaternion((a[3], a[0], a[1], a[2])).slerp(Quaternion((b[3], b[0], b[1], b[2])), mix)
                obj.rotation_quaternion = (inverse.to_3x3() @ q.to_matrix() @ basis.to_3x3()).to_quaternion()
            elif channel["target"]["path"] == "translation":
                obj.location = inverse @ Vector([x + (y - x) * mix for x, y in zip(a, b)])
            else:
                raise ValueError("Unsupported candidate channel")
        bpy.context.view_layer.update()

    def diagnostic(angles):
        for name, angle in angles.items():
            node = groups[name]
            glb_axis = Vector(node.get("extras", {}).get("hingeAxis", [1, 0, 0]))
            axis = Vector((0, 0, 1)) if name == "rig_torso" else inverse.to_3x3() @ glb_axis
            scene.objects[name].rotation_quaternion @= Quaternion(axis, math.radians(angle))
        bpy.context.view_layer.update()

    reset()
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    low = Vector([min(point[i] for point in points) for i in range(3)])
    high = Vector([max(point[i] for point in points) for i in range(3)])
    center, span = (low + high) / 2, max(high - low) * 1.32
    material = bpy.data.materials.new("Neutral actual-export inspection")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.42, .45, .47, 1)
    shader.inputs["Metallic"].default_value = .12
    shader.inputs["Roughness"].default_value = .58
    if not args.materials:
        for obj in meshes:
            for slot in obj.material_slots:
                slot.material = material
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.world = bpy.data.worlds.new("Inspection world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (.25, .27, .3, 1)
    scene.world.node_tree.nodes["Background"].inputs[1].default_value = .6
    for name, position, power, size in [
        ("Key", (2, -3, 4), 260, 3.5), ("Fill", (-3, -1, 2), 180, 4),
        ("Rim", (1, 3, 3), 300, 3), ("Underside", (0, -1, -2), 65, 2),
    ]:
        light = bpy.data.lights.new(name, "AREA")
        light.energy, light.shape, light.size = power, "DISK", size
        obj = bpy.data.objects.new(name, light)
        scene.collection.objects.link(obj)
        obj.location = center + Vector(position)
        obj.rotation_euler = (center - obj.location).to_track_quat("-Z", "Y").to_euler()
    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type, camera.data.clip_start, camera.data.clip_end = "ORTHO", .0001, 100
    scene.render.resolution_x = scene.render.resolution_y = 704
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format, scene.render.image_settings.color_mode = "PNG", "RGBA"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    records = {}

    def render(name, direction, target=center, scale=span):
        camera.location = target + Vector(direction).normalized() * span * 3
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        camera.data.ortho_scale = scale
        image = output / (name + ".png")
        scene.render.filepath = str(image)
        bpy.ops.render.render(write_still=True)
        records[name] = {"image": str(image.relative_to(repo)), "sha256": hashlib.sha256(image.read_bytes()).hexdigest()}

    if not args.quick_joints:
        for name, direction in [("front", (0, -1, 0)), ("back", (0, 1, 0)),
                                ("left", (1, 0, 0)), ("right", (-1, 0, 0)),
                                ("oblique", (.85, -1, .4)), ("underside", (.6, -.8, -1))]:
            render(name, direction)
        render("muzzle-detail", (0, -1, .06), Vector((.272, -.265, .674)), .16)
        render("waist-detail", (.85, -1, .3), Vector((-.00513, .0032, .5786)), .24)
    render("knee-detail-neutral", (1, 0, .05), scene.objects["rig_leg_left_shin"].matrix_world.translation, .3)
    if not args.quick_joints:
        diagnostic({"rig_torso": 45})
        render("torso-yaw", (.85, -1, .4))
    reset()
    diagnostic({"rig_torso": 35, "rig_leg_left_thigh": 22, "rig_leg_left_shin": -28,
                "rig_leg_left_foot": 6, "rig_leg_right_thigh": -12,
                "rig_leg_right_shin": 20, "rig_leg_right_foot": -8})
    render("combined-pose", (.85, -1, .4))
    render("knee-detail-combined", (1, 0, .05), scene.objects["rig_leg_left_shin"].matrix_world.translation, .3)
    if not args.quick_joints:
        for name in ("walk", "run", "backward"):
            reset()
            sample(name, .25)
            render(name + "-quarter", (.85, -1, .4))
    reset()
    sample("walk", .8)
    render("knee-detail-walk", (1, 0, .05), scene.objects["rig_leg_left_shin"].matrix_world.translation, .3)
    reset()
    (output / "manifest.json").write_text(json.dumps({
        "source": str(source.relative_to(repo)), "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "blenderVersion": bpy.app.version_string,
        "scope": "Actual GLB rest/diagnostic/embedded clip inspection. No runtime acceptance.",
        "materialMode": "embedded" if args.materials else "neutral-override",
        "views": records,
    }, indent=2) + "\n")
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "inspection.blend"))
    print("KESTREL_ARTICULATION_RENDERS", len(records))


if __name__ == "__main__":
    main()
