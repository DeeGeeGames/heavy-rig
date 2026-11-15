"""Chassis-neutral rigid hierarchy packaging for Blender authoring adapters.

Input pivots/anchors are Blender Z-up/-Y-forward world positions. All imported
mesh nodes must be assigned; rig anatomy and motion generation belong to callers.
The returned mesh bindings retain source world transforms for caller-specific
sole, clearance and other probes. Geometry/material buffers are copied unchanged.
"""

import copy
import json
import math
import struct
from mathutils import Matrix, Quaternion, Vector
from rigid_contract import validate_groups, validate_source_nodes, ordered_anchors

def read_glb(path):
    data = path.read_bytes()
    if struct.unpack_from("<II", data, 0) != (0x46546C67, 2):
        raise ValueError("Expected GLB2")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A:
        raise ValueError("Missing JSON chunk")
    document = json.loads(data[20 : 20 + length])
    offset = 20 + length
    bin_length, bin_kind = struct.unpack_from("<II", data, offset)
    if bin_kind != 0x004E4942:
        raise ValueError("Missing BIN chunk")
    binary = data[offset + 8 : offset + 8 + bin_length]
    if len(document.get("buffers", [])) != 1:
        raise ValueError("Expected single embedded buffer")
    return document, binary[: document["buffers"][0]["byteLength"]]


def write_glb(path, document, binary):
    document["buffers"] = [{"byteLength": len(binary)}]
    body = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
    body += b" " * (-len(body) % 4)
    binary += b"\0" * (-len(binary) % 4)
    path.write_bytes(
        struct.pack("<III", 0x46546C67, 2, 28 + len(body) + len(binary))
        + struct.pack("<II", len(body), 0x4E4F534A)
        + body
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def local_matrix(node):
    if "matrix" in node:
        return Matrix(
            tuple(
                tuple(node["matrix"][col * 4 + row] for col in range(4))
                for row in range(4)
            )
        )
    q = node.get("rotation", [0, 0, 0, 1])
    return Matrix.LocRotScale(
        Vector(node.get("translation", [0, 0, 0])),
        Quaternion((q[3], q[0], q[1], q[2])),
        Vector(node.get("scale", [1, 1, 1])),
    )


def column_major(matrix):
    return [matrix[row][col] for col in range(4) for row in range(4)]


def accessor_values(document, binary, identifier):
    a = document["accessors"][identifier]
    if a.get("sparse"):
        raise ValueError("Sparse accessors not supported in authoring input")
    view = document["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    code = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[a["componentType"]]
    fmt = "<" + code * width
    stride = view.get("byteStride", struct.calcsize(fmt))
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return [
        struct.unpack_from(fmt, binary, start + i * stride) for i in range(a["count"])
    ]


def package_neutral_rig(source, contract, *, scene_name, generator):
    groups = validate_groups(contract["groups"])
    rest = {name: Vector(item["pivot"]) for name, item in groups.items()}
    basis = Matrix.Rotation(-math.pi / 2, 4, "X")
    # Preserve only geometry/material resources from the candidate input. Source
    # motion geometry is never appended. glTF Transform prunes unused resources.
    document = copy.deepcopy(source)
    document.pop("animations", None)
    document.pop("skins", None)
    document["asset"] = {
        "version": "2.0",
        "generator": generator,
    }
    document["nodes"] = []
    document["scenes"] = [{"name": scene_name, "nodes": []}]
    document["scene"] = 0
    node_indices = {}
    for name in groups:
        node_indices[name] = len(document["nodes"])
        parent = groups[name]["parent"]
        translation = basis @ (
            rest[name] - (rest[parent] if parent else Vector((0, 0, 0)))
        )
        document["nodes"].append(
            {
                "name": name,
                "translation": list(translation),
                "children": [],
                "extras": {
                    "role": "rigid-motion-group",
                    "sourceDirection": "Blender Z-up/-Y-forward",
                },
            }
        )
    for name, index in node_indices.items():
        parent = groups[name]["parent"]
        if parent:
            document["nodes"][node_indices[parent]]["children"].append(index)
        else:
            document["scenes"][0]["nodes"].append(index)
    source_parents = validate_source_nodes(source)
    world_cache = {}

    def world(index):
        if index not in world_cache:
            own = local_matrix(source["nodes"][index])
            world_cache[index] = (
                world(source_parents[index]) @ own if index in source_parents else own
            )
        return world_cache[index]

    assignments = contract.get("meshGroups", {})
    if any(owner not in groups for owner in assignments.values()):
        raise ValueError("Mesh assignment references unknown rigid group")
    static_connections = {}
    for item in contract.get("staticConnections", []):
        if item["parent"] not in groups:
            raise ValueError("Static connection has unknown parent")
        static_connections.setdefault(item["meshName"], []).append(item)
    owned = {name: [] for name in groups}
    mesh_bindings = []
    used_assignments = set()
    for index, node in enumerate(source["nodes"]):
        if "mesh" not in node:
            continue
        ancestor = index
        if node.get("name") in assignments:
            used_assignments.add(node["name"])
        owner = assignments.get(node.get("name", "")) or node.get("extras", {}).get(
            "rigGroup"
        )
        while not owner:
            ancestor_name = source["nodes"][ancestor].get("name", "")
            if ancestor_name in groups:
                owner = ancestor_name
                break
            if ancestor not in source_parents:
                break
            ancestor = source_parents[ancestor]
        if owner not in groups:
            raise ValueError("Unassigned mesh " + node.get("name", str(index)))
        matrix = world(index)
        mesh_bindings.append({"node": node, "owner": owner, "matrix": matrix})
        pivot_glb = basis @ rest[owner]
        local = Matrix.Translation(-pivot_glb) @ matrix
        child = {
            "name": "geometry_" + node.get("name", str(index)),
            "mesh": node["mesh"],
            "matrix": column_major(local),
            "extras": {"rigGroup": owner, "sourceNode": node.get("name", str(index))},
        }
        connections = static_connections.get(node.get("name", ""), [])
        if connections:
            child["extras"].update(
                role="static-mount-connections",
                connectionIds=[item["id"] for item in connections],
            )
        document["nodes"][node_indices[owner]]["children"].append(
            len(document["nodes"])
        )
        document["nodes"].append(child)
        owned[owner].append(child["name"])
    if set(assignments) != used_assignments:
        raise ValueError("Mesh assignments refer to absent geometry")
    for name, items in static_connections.items():
        matched = [entry for entry in mesh_bindings if entry["node"].get("name") == name]
        if len(matched) != 1 or any(item["parent"] != matched[0]["owner"] for item in items):
            raise ValueError("Static connection mesh or ownership differs: " + name)
    anchor_world_positions = dict(rest)
    for anchor in ordered_anchors(contract, groups):
        name, parent = anchor["name"], anchor["parent"]
        if name in node_indices or parent not in node_indices:
            raise ValueError("Duplicate anchor or missing parent " + name)
        translation = basis @ (
            Vector(anchor["worldPosition"]) - anchor_world_positions[parent]
        )
        node = {
            "name": name,
            "translation": list(translation),
            "extras": copy.deepcopy(anchor.get("extras", {})),
        }
        if "direction" in anchor:
            node["extras"]["forwardDirection"] = list(
                basis.to_3x3() @ Vector(anchor["direction"])
            )
        document["nodes"][node_indices[parent]]["children"].append(
            len(document["nodes"])
        )
        node_indices[name] = len(document["nodes"])
        document["nodes"].append(node)
        anchor_world_positions[name] = Vector(anchor["worldPosition"])
    names = [node["name"] for node in document["nodes"]]
    if len(set(names)) != len(names):
        raise ValueError("Generated geometry, group and anchor names collide")
    return document, node_indices, groups, rest, owned, mesh_bindings
