"""Inventory the exact retained stage 6 exports without modifying their geometry.

Counts refer to default-scene instances at the sole exported LOD. Geometry byte
counts exclude animation, JSON and padding; file payload is reported separately.
"""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "blender"))
from optimization_io import fresh_output, verified_checkpoint


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inspect(path):
    data = path.read_bytes()
    magic, version, length, json_size, chunk_type = struct.unpack_from("<5I", data)
    if (magic, version, length, chunk_type) != (
        0x46546C67, 2, len(data), 0x4E4F534A
    ):
        raise ValueError(f"Expected complete GLB 2.0: {path}")
    gltf = json.loads(data[20 : 20 + json_size])
    bin_size, bin_type = struct.unpack_from("<2I", data, 20 + json_size)
    if bin_type != 0x004E4942:
        raise ValueError("Expected embedded binary chunk")
    binary = data[28 + json_size : 28 + json_size + bin_size]
    nodes = gltf["nodes"]
    parents = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
    component_sizes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    widths = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

    def accessor_bytes(index):
        accessor = gltf["accessors"][index]
        if "sparse" in accessor:
            raise ValueError("Sparse accessors need explicit inventory support")
        view = gltf["bufferViews"][accessor["bufferView"]]
        size = component_sizes[accessor["componentType"]] * widths[accessor["type"]]
        stride = view.get("byteStride", size)
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        packed = b"".join(binary[start + i * stride : start + i * stride + size] for i in range(accessor["count"]))
        if len(packed) != accessor["count"] * size:
            raise ValueError("Truncated vertex/index buffer")
        return packed

    reachable = []

    def visit(index):
        if index in reachable:
            raise ValueError("Repeated or cyclic default-scene node")
        reachable.append(index)
        for child in nodes[index].get("children", []):
            visit(child)

    for index in gltf["scenes"][gltf.get("scene", 0)]["nodes"]:
        visit(index)
    records = []
    for index in reachable:
        node = nodes[index]
        if "mesh" not in node:
            continue
        mesh = gltf["meshes"][node["mesh"]]
        primitives = mesh["primitives"]
        triangles = 0
        attributes_bytes = 0
        hashes = []
        for primitive in primitives:
            if primitive.get("mode", 4) != 4:
                raise ValueError("Only triangle lists are supported")
            count = gltf["accessors"][primitive.get("indices", primitive["attributes"]["POSITION"])]["count"]
            if count % 3:
                raise ValueError("Incomplete triangle")
            triangles += count // 3
            fields = dict(primitive["attributes"])
            if "indices" in primitive:
                fields["indices"] = primitive["indices"]
            fingerprint = hashlib.sha256()
            for key, accessor_index in sorted(fields.items()):
                packed = accessor_bytes(accessor_index)
                attributes_bytes += len(packed)
                descriptor = gltf["accessors"][accessor_index]
                fingerprint.update(json.dumps([key, descriptor["componentType"], descriptor["type"], descriptor.get("normalized", False)]).encode())
                fingerprint.update(packed)
            hashes.append(fingerprint.hexdigest())
        parent = nodes[parents[index]]["name"] if index in parents else "root"
        records.append({
            "name": node["name"], "parent": parent,
            "triangles": triangles, "meshSections": len(primitives),
            "materials": sorted({p["material"] for p in primitives if "material" in p}),
            "vertexAndIndexBytes": attributes_bytes,
            "geometryFingerprints": hashes,
        })
    groups = {}
    for record in records:
        # Piston barrels/rods retain their independent animated endpoints.
        group = groups.setdefault(record["parent"], {"triangles": 0, "meshInstances": 0, "meshSections": 0, "nodes": []})
        group["triangles"] += record["triangles"]
        group["meshInstances"] += 1
        group["meshSections"] += record["meshSections"]
        group["nodes"].append(record["name"])
    return {
        "sha256": digest(data), "bytes": len(data),
        "triangles": sum(r["triangles"] for r in records),
        "meshInstances": len(records),
        "meshSections": sum(r["meshSections"] for r in records),
        "materials": len({m for r in records for m in r["materials"]}),
        "assignedMaterialDefinitions": sorted({
            json.dumps({k: v for k, v in gltf["materials"][m].items() if k != "name"}, sort_keys=True)
            for r in records for m in r["materials"]
        }),
        "textureImages": len(gltf.get("images", [])),
        "embeddedImageBytes": sum(gltf["bufferViews"][im["bufferView"]]["byteLength"] for im in gltf.get("images", [])),
        "vertexAndIndexBytes": sum(r["vertexAndIndexBytes"] for r in records),
        "animationClips": len(gltf.get("animations", [])),
        "parentGroups": groups, "meshes": records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    output = fresh_output(repo, args.output)
    assets = {}
    for motion in ["walk", "run", "backward"]:
        for filename in ["chassis", "left-launcher", "right-launcher", "left-energy", "right-energy", "left-empty", "right-empty"]:
            relative = f"design/mechs/assets/warden/components/{motion}/{filename}.glb"
            assets[f"{motion}/{filename}"] = inspect(verified_checkpoint(repo, relative))
    reference = assets["walk/chassis"]
    def identity(asset):
        return {r["name"]: (r["parent"], r["geometryFingerprints"]) for r in asset["meshes"]}
    equal = all(identity(assets[f"{motion}/chassis"]) == identity(reference) for motion in ["run", "backward"])
    if not equal:
        raise ValueError("Chassis geometry/ownership differs between motion packages")
    variants = {}
    for variant, left, right in [("A", "launcher", "launcher"), ("B", "energy", "energy"), ("C", "energy", "launcher"), ("empty-shoulders", "empty", "empty")]:
        selected = [reference, assets[f"walk/left-{left}"], assets[f"walk/right-{right}"]]
        variants[variant] = {key: sum(a[key] for a in selected) for key in ["triangles", "meshInstances", "meshSections", "bytes", "textureImages", "embeddedImageBytes"]}
        variants[variant]["materials"] = {
            "standaloneFiles": sum(a["materials"] for a in selected),
            "uniqueAssignedMaterialDefinitions": len({m for a in selected for m in a["assignedMaterialDefinitions"]}),
        }
    report = {
        "schemaVersion": 1,
        "scope": "Unoptimized retained stage 6, sole LOD, actual default scenes. Empty shoulders retain ballistic guns. No runtime draw-call or performance measurement.",
        "coordinateSystem": "glTF Y-up, +Z forward; source units retained",
        "chassisGeometryAndParentOwnershipEqualAcrossMotions": equal,
        "variants": variants, "assets": assets,
        "byteAccounting": "Encoded GLB payload includes animation/JSON/padding. Vertex/index bytes are summed per mesh instance, excluding those costs. Standalone material objects may be compatible but are not yet consolidated.",
    }
    output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(output), "variants": variants, "sharedChassisIdentity": equal}, indent=2))


if __name__ == "__main__":
    main()
