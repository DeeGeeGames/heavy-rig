"""Pack the six hand-authored chassis, rigid joints and removable cartridges.

Run with --check to reproduce the shipped GLBs. With --out, write to a fresh
scratch directory. A variant references each identical cartridge by name, so
the body, leg pivots and shared weapons have a single physical source.
"""

import argparse
import hashlib
import json
import math
import tempfile
from importlib import import_module
from pathlib import Path

from blender.optimization_io import fresh_output
from pixel_mechs.export import ARRAY_BUFFER, Buffers, primitive, read_rows
from pixel_mechs.geometry import PlateMesh, minus, times

ROOT = Path(__file__).resolve().parents[2]
FAMILIES = ("rook", "longbow", "morrow", "bastion", "harrow", "specter")
write_glb = import_module("modular-export").write_glb
ZERO = (0, 0, 0)


class Package:
    def __init__(self, chassis, recipe):
        self.nodes = []
        self.names = {}
        self.positions = {}
        self.roots = []
        self.meshes = []
        self.buffers = Buffers()
        self.motion = []
        self.layout = {}
        self.plates = PlateMesh(self.nodes, recipe.PALETTE)
        self.chassis = chassis
        self.paint_mask = {
            self.plates.colors[key]: (round(zone * 127.5), round(value * 255), 0, 255)
            for key, (zone, value) in recipe.PAINT.items()
        }

    def node(self, name, position, parent=None, **extras):
        if name in self.names:
            raise ValueError(f"Duplicate node {name}")
        origin = self.positions[parent] if parent else ZERO
        node = {"name": name, "translation": times(minus(position, origin), .001)}
        if extras:
            node["extras"] = extras
        index = len(self.nodes)
        if parent:
            self.nodes[self.names[parent]].setdefault("children", []).append(index)
        else:
            self.roots.append(index)
        self.nodes.append(node)
        self.names[name] = index
        self.positions[name] = position

    def pack_mesh(self, name, materials):
        node = self.nodes[self.names[name]]
        node["mesh"] = len(self.meshes)
        primitives = []
        for material, faces in materials.items():
            part = primitive(self.buffers, faces, material, self.positions[name])
            if material == 0:
                colors = read_rows(self.buffers, part["attributes"]["COLOR_0"])
                mask = [self.paint_mask.get(color, (0, 0, 0, 255)) for color in colors]
                part["attributes"]["_MECH_PAINT"] = self.buffers.attribute(mask, "B", "VEC4", ARRAY_BUFFER, normalized=True)
            primitives.append(part)
        self.meshes.append({"name": name + "_plates", "primitives": primitives})

    def write(self, path):
        title = self.chassis.title()
        document = {
            "asset": {"version": "2.0", "generator": "Heavy Rig plate workshop"},
            "scene": 0, "scenes": [{"name": title, "nodes": self.roots, "extras": self.layout}],
            "nodes": self.nodes, "meshes": self.meshes,
            "materials": [
                {"name": title + " plate colors", "pbrMetallicRoughness": {"metallicFactor": .12, "roughnessFactor": .86}},
                {"name": title + " visor", "emissiveFactor": [.13, .12, .07], "pbrMetallicRoughness": {"metallicFactor": .04, "roughnessFactor": .67}},
            ],
            "bufferViews": self.buffers.views, "accessors": self.buffers.accessors,
        }
        if self.motion:
            document["animations"] = self.motion
        write_glb(path, document, self.buffers.data)


def motion_clips(package, recipe):
    # Export a portable joint cycle. In play the fixed-step contact solver
    # uses these same bind pivots, including while steering and backing up.
    for name, duration, stride, swing in (("walk", 1.04, .38, .18), ("run", .83, .70, .32), ("backward", 1.18, -.29, -.14)):
        samples = 16
        timespan = package.buffers.attribute([(i * duration / samples,) for i in range(samples + 1)], "f", "SCALAR", None, bounds=True)
        samplers, channels = [], []
        for side, offset in (("left", 0), ("right", math.pi)):
            flex = 1 if recipe.KNEE[2] > recipe.HIP[2] else -1
            for joint in ("thigh", "shin", "foot"):
                rotations = []
                for i in range(samples + 1):
                    phase = 2 * math.pi * i / samples + offset
                    thigh = swing * math.sin(phase)
                    shin = flex * abs(swing) * max(0, math.sin(phase + math.pi * .5)) * 1.4
                    angle = {"thigh": thigh, "shin": shin, "foot": -thigh - shin}[joint]
                    rotations.append((math.sin(angle / 2), 0, 0, math.cos(angle / 2)))
                track = package.buffers.attribute(rotations, "f", "VEC4", None)
                channels.append({"sampler": len(samplers), "target": {"node": package.names[f"rig_leg_{side}_{joint}"], "path": "rotation"}})
                samplers.append({"input": timespan, "output": track, "interpolation": "LINEAR"})
        package.motion.append({"name": name, "samplers": samplers, "channels": channels, "extras": {"nativeUnitsPerSecond": stride / duration}})


def build(chassis, folder):
    recipe = import_module("pixel_mechs." + chassis)
    base, modules = Package(chassis, recipe), Package(chassis, recipe)
    base.node("rig_pelvis", recipe.PELVIS)
    base.node("rig_torso", recipe.TORSO, "rig_pelvis")
    for side, sign in (("left", 1), ("right", -1)):
        parent = "rig_pelvis"
        for name, (x, y, z) in (("thigh", recipe.HIP), ("shin", recipe.KNEE), ("foot", recipe.ANKLE)):
            joint = f"rig_leg_{side}_{name}"
            base.node(joint, (sign * x, y, z), parent)
            parent = joint
    for slot, (name, position) in enumerate(recipe.SOCKETS):
        base.node(name, position, "rig_torso", mountSlot=slot)
    recipe.body(base.plates)
    expected = {name for name in base.names if not name.startswith("rig_mount_")}
    if base.plates.sections.keys() != expected:
        raise ValueError(f"Missing or unowned structural geometry: {expected ^ base.plates.sections.keys()}")
    # A rigid pivot must remain a Group after GLTFLoader splits materials.
    for owner, materials in base.plates.sections.items():
        leaf = "plates_" + owner
        base.node(leaf, base.positions[owner], owner)
        base.pack_mesh(leaf, materials)

    seen = {}
    for vi, variant in enumerate("abc"):
        target = base if variant == "a" else modules
        layout = []
        for slot in range(recipe.SLOTS[vi]):
            socket, pivot = recipe.SOCKETS[slot]
            name = f"kit_{variant}_{slot}"
            plates = PlateMesh([], recipe.PALETTE)
            plates.section = name
            muzzle, exits = recipe.cartridge(plates, variant, slot)
            if muzzle[2] <= pivot[2] or not plates.sections[name] or any(not all(map(math.isfinite, p)) for p in (muzzle, *exits)):
                raise ValueError(f"Invalid {chassis} {name} cartridge or firing exit")
            signature = (slot, json.dumps([plates.sections[name], muzzle, exits], sort_keys=True, allow_nan=False))
            if signature not in seen:
                seen[signature] = name
                target.node(name, pivot, socket if target is base else None, socket=socket, tubeCount=len(exits))
                leaf = name + "_plates"
                target.node(leaf, pivot, name)
                target.pack_mesh(leaf, plates.sections[name])
                target.node(name + "_muzzle", muzzle, name)
                for index, point in enumerate(exits):
                    target.node(f"{name}_tube_{index}", point, name)
            layout.append(seen[signature])
        target.layout["fit_" + variant] = layout
        if hasattr(recipe, "brace"):
            name = "fitting_" + variant
            plates = PlateMesh([], recipe.PALETTE)
            plates.section = name
            recipe.brace(plates, variant)
            if plates.sections.get(name):
                signature = ("fitting", json.dumps(plates.sections[name], sort_keys=True, allow_nan=False))
                if signature not in seen:
                    seen[signature] = name
                    target.node(name, recipe.TORSO, "rig_torso" if target is base else None)
                    target.pack_mesh(name, plates.sections[name])
                target.layout["brace_" + variant] = seen[signature]
    motion_clips(base, recipe)
    folder.mkdir()
    base.write(folder / "pixel.glb")
    modules.layout["baseSha256"] = hashlib.sha256((folder / "pixel.glb").read_bytes()).hexdigest()
    modules.write(folder / "variants.glb")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--out", type=Path, help="Fresh directory under design/mechs/generated")
    parser.add_argument("--family", action="append", choices=FAMILIES)
    args = parser.parse_args()
    target = fresh_output(ROOT, args.out) if args.out else None
    parent = target.parent if target else None
    with tempfile.TemporaryDirectory(dir=parent) as temp:
        stage = Path(temp)
        for family in args.family or FAMILIES:
            build(family, stage / family)
            for asset in sorted((stage / family).glob("*.glb")):
                data = asset.read_bytes()
                if args.check and data != (ROOT / "public/assets/mechs" / family / asset.name).read_bytes():
                    raise ValueError(f"Shipped asset differs: {family}/{asset.name}")
                print(f"{hashlib.sha256(data).hexdigest()}  {family}/{asset.name}  ({len(data)} bytes)")
        if target:
            fresh_output(ROOT, target, directory=True)
            for family in args.family or FAMILIES:
                (stage / family).rename(target / family)


if __name__ == "__main__":
    main()
