"""Build the interchangeable B/C cartridges against the approved A GLBs."""

import argparse
from importlib import import_module
import json
from pathlib import Path
import tempfile

from blender.optimization_io import fresh_output
from pixel_mechs import kestrel, maul, warden
from pixel_mechs.export import Buffers, primitive
from pixel_mechs.geometry import PlateMesh, minus, times

base = import_module("build-pixel-mechs")
glb = import_module("modular-export")


def emitter(mesh, x, y, rear, lip, width, height, armor, rim, lens):
    mesh.hull_z(
        [(rear, x, y - height / 2, y + height / 2, width, 12, 10),
         (lip - 10, x, y - height / 2, y + height / 2, width, 12, 10),
         (lip, x, y - height * 0.42, y + height * 0.42, width * 0.87, 10, 8)],
        armor, ("joint", rim),
    )
    mesh.hull_z(
        [(lip - 1, x, y - height * 0.26, y + height * 0.26, width * 0.68, 8, 6),
         (lip + 4, x, y - height * 0.21, y + height * 0.21, width * 0.56, 7, 5)],
        "joint", ("joint", lens),
    )
    return (x, y, lip + 4), ()


def warden_energy(mesh, side, sign):
    shell = warden.shoulder_shell(mesh, side, sign)
    mesh.hull_z([shell[-1], (-55, sign * 263, 862, 970, 208, 20, 18)], "cheek", (None, "deep"))
    warden.shoulder_rear(mesh, sign)
    x, y, _ = mesh.anchor(f"muzzle_{side}_launcher")
    if side == "left":
        return emitter(mesh, x, y, -58, 8, 155, 72, "deep", "rim", "glass")
    # The stock right-side particle bank has a heavier projecting accelerator.
    mesh.hull_z(
        [(-57, x, y - 47, y + 47, 174, 18, 15), (-6, x, y - 44, y + 44, 165, 17, 14),
         (29, x, y - 29, y + 29, 123, 15, 12)],
        "deep",
    )
    for offset in (-50, 50):
        mesh.beam((x + offset, y + 30, -13), (x + offset, y + 22, 70), 18, 16, "gold")
    return emitter(mesh, x, y, 13, 74, 120, 63, "cast", "cheek", "shine")


def kestrel_laser(mesh):
    x, y, dz = kestrel.gun_housing(mesh, "right", -1)
    return emitter(mesh, x, y, dz + 12, dz + 174, 106, 76, "forest", "ivory", "shine")


def kestrel_launcher(mesh):
    x, y, dz = kestrel.gun_housing(mesh, "right", -1)
    mesh.hull_z(
        [(dz + 12, x, y - 47, y + 47, 114, 16, 15),
         (dz + 72, x, y - 45, y + 45, 133, 14, 12),
         (dz + 136, x, y - 40, y + 40, 132, 13, 11)],
        "forest", ("cast", "silver"),
    )
    lip = dz + 184
    tubes = tuple((x + offset, y, lip) for offset in (-34, 34))
    for tx, ty, tz in tubes:
        kestrel.tube(mesh, tx, ty, dz + 124, tz, 30)
    return (x, y, lip), tubes


def maul_inboard(mesh, sign, family):
    x, y, front = maul.inboard_receiver(mesh, sign)
    if family == "energy":
        return emitter(mesh, x, y, front - 20, front + 6, 49, 46, "coal", "silver", "optic")
    # The compact LANCE has two physical exits in one cartridge. They remain
    # vertically paired, fitting the same pocket as A's gun and B's optical bank.
    lip = front + 35
    tubes = tuple((x, y + offset, lip) for offset in (-13, 13))
    for tx, ty, tz in tubes:
        kestrel.tube(mesh, tx, ty, front - 1, tz, 10)
    return (x, y, lip), tubes


RECIPES = {
    "warden": (warden, [
        (2, "energy", "rig_mount_left-shoulder bank", lambda mesh: warden_energy(mesh, "left", 1)),
        (3, "energy", "rig_mount_right-shoulder bank", lambda mesh: warden_energy(mesh, "right", -1)),
    ]),
    "kestrel": (kestrel, [
        (1, "energy", "rig_mount_right-gun", kestrel_laser),
        (1, "launcher", "rig_mount_right-gun", kestrel_launcher),
    ]),
    "maul": (maul, [
        (0, "ballistic", "rig_mount_left-pod", lambda mesh: maul.forearm(mesh, "left", "ballistic")),
        (1, "ballistic", "rig_mount_right-pod", lambda mesh: maul.forearm(mesh, "right", "ballistic")),
        (1, "energy", "rig_mount_right-pod", lambda mesh: maul.forearm(mesh, "right", "energy")),
        (2, "energy", "rig_mount_left-inboard", lambda mesh: maul_inboard(mesh, 1, "energy")),
        (3, "energy", "rig_mount_right-inboard", lambda mesh: maul_inboard(mesh, -1, "energy")),
        (3, "launcher", "rig_mount_right-inboard", lambda mesh: maul_inboard(mesh, -1, "launcher")),
    ]),
}


def rebuild(chassis, recipe, modules, output):
    selection = json.loads((base.REPO / "design/mechs/assets" / chassis / "pixel/manifest.json").read_text())
    asset = selection["asset"]
    source_path = base.REPO / asset["path"]
    base.verify(source_path, asset["sha256"])
    source, _ = glb.read_glb(source_path)
    buffers = Buffers()
    roots, nodes, meshes = [], [], []
    for slot, family, mount, build in modules:
        model = PlateMesh(source["nodes"], recipe.PALETTE)
        muzzle, exits = build(model)
        pivot = model.anchor(mount)
        if len(model.sections) != 1 or muzzle[2] <= pivot[2]:
            raise ValueError(f"Invalid cartridge for {chassis} {mount}")
        name = f"variant_{slot}_{family}"
        roots.append(len(nodes))
        module = {"name": name, "extras": {"mount": mount}, "children": []}
        nodes.append(module)

        def add_child(node):
            module["children"].append(len(nodes))
            nodes.append(node)

        materials = next(iter(model.sections.values()))
        add_child({"name": f"geometry_{mount}_{family}", "mesh": len(meshes)})
        meshes.append({"primitives": [primitive(buffers, faces, material, pivot) for material, faces in materials.items()]})
        for suffix, point in [("muzzle", muzzle), *((f"tube_{i}", point) for i, point in enumerate(exits))]:
            add_child({"name": f"{name}_{suffix}", "translation": times(minus(point, pivot), 0.001)})

    document = {
        "asset": {"version": "2.0", "generator": "Heavy Rig pixel variant cartridges"},
        "scene": 0,
        "scenes": [{"nodes": roots, "extras": {"baseSha256": asset["sha256"]}}],
        "nodes": nodes,
        "bufferViews": buffers.views,
        "accessors": buffers.accessors,
        "materials": source["materials"],
        "meshes": meshes,
    }
    target = output / chassis / "variants.glb"
    target.parent.mkdir()
    glb.write_glb(target, document, buffers.data)
    expected = selection["approval"]["bundleSha256"]
    base.verify(target, expected)
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="New directory under design/mechs/generated")
    args = parser.parse_args()
    output = fresh_output(base.REPO, args.out)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        staging = Path(temporary)
        hashes = {chassis: rebuild(chassis, recipe, modules, staging) for chassis, (recipe, modules) in RECIPES.items()}
        fresh_output(base.REPO, output, directory=True)
        for chassis in hashes:
            (staging / chassis).rename(output / chassis)
    for chassis, digest in hashes.items():
        print(f"{digest}  {output / chassis / 'variants.glb'}")


if __name__ == "__main__":
    main()
