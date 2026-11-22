"""Pack flat-painted sections and copy the source rig and animation samples."""

import copy
import struct

from .geometry import minus, times


ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


class Buffers:
    def __init__(self):
        self.data = bytearray()
        self.views = []
        self.accessors = []

    def add_view(self, raw, target=None):
        self.data.extend(b"\0" * (-len(self.data) % 4))
        view = {"buffer": 0, "byteOffset": len(self.data), "byteLength": len(raw)}
        if target is not None:
            view["target"] = target
        self.views.append(view)
        self.data.extend(raw)
        return len(self.views) - 1

    def attribute(self, rows, fmt, kind, target, normalized=False, bounds=False):
        flat = [value for row in rows for value in row]
        raw = struct.pack(f"<{len(flat)}{fmt}", *flat)
        accessor = {
            "bufferView": self.add_view(raw, target),
            "componentType": {"f": 5126, "H": 5123, "B": 5121}[fmt],
            "count": len(rows),
            "type": kind,
        }
        if normalized:
            accessor["normalized"] = True
        if bounds:
            accessor.update(min=list(map(min, zip(*rows))), max=list(map(max, zip(*rows))))
        self.accessors.append(accessor)
        return len(self.accessors) - 1

    def copy_animations(self, source, source_bytes):
        """Retain the original keyframes, sharing any reused animation accessors and views."""
        accessors = {}
        views = {}

        def copy_accessor(index):
            if index not in accessors:
                accessor = copy.deepcopy(source["accessors"][index])
                source_index = accessor["bufferView"]
                if source_index not in views:
                    view = source["bufferViews"][source_index]
                    start = view.get("byteOffset", 0)
                    target_index = self.add_view(source_bytes[start : start + view["byteLength"]])
                    self.views[target_index].update(
                        {k: v for k, v in view.items() if k not in ("buffer", "byteOffset", "byteLength")}
                    )
                    views[source_index] = target_index
                accessor["bufferView"] = views[source_index]
                accessors[index] = len(self.accessors)
                self.accessors.append(accessor)
            return accessors[index]

        animations = copy.deepcopy(source["animations"])
        for animation in animations:
            for sampler in animation["samplers"]:
                for attribute in ("input", "output"):
                    sampler[attribute] = copy_accessor(sampler[attribute])
        return animations


def primitive(buffers, faces, material, parent):
    positions, normals, colors, indices = [], [], [], []
    vertices = {}
    for corners, normal, color in faces:
        polygon = []
        for corner in corners:
            local = times(minus(corner, parent), 0.001)
            key = (local, normal, color)
            if key not in vertices:
                vertices[key] = len(positions)
                positions.append(local)
                normals.append(normal)
                colors.append(color)
            polygon.append(vertices[key])
        for i in range(1, len(polygon) - 1):
            indices.extend((polygon[0], polygon[i], polygon[i + 1]))
    return {
        "attributes": {
            "POSITION": buffers.attribute(positions, "f", "VEC3", ARRAY_BUFFER, bounds=True),
            "NORMAL": buffers.attribute(normals, "f", "VEC3", ARRAY_BUFFER),
            "COLOR_0": buffers.attribute(colors, "B", "VEC4", ARRAY_BUFFER, normalized=True),
        },
        "indices": buffers.attribute([(index,) for index in indices], "H", "SCALAR", ELEMENT_ARRAY_BUFFER),
        "material": material,
    }


def assemble(chassis, source_hash, source, source_bytes, model, visor_emissive):
    mesh_nodes = {node["name"] for node in source["nodes"] if "mesh" in node}
    if mesh_nodes != model.sections.keys():
        raise ValueError(f"Geometry nodes differ from {chassis} rig: {mesh_nodes ^ model.sections.keys()}")

    buffers = Buffers()
    # Animation views precede geometry in the approved binary.
    animations = buffers.copy_animations(source, source_bytes)
    nodes = copy.deepcopy(source["nodes"])
    meshes = []
    for name, materials in model.sections.items():
        index = model.by_name[name]
        parent = model.origin(model.parents[index])
        # Geometry is in rigid-parent space. Original quantization transforms on
        # mesh leaves disappear; rig pivots, mount sockets and firing exits stay.
        nodes[index] = {"name": name, "mesh": len(meshes)}
        primitives = [primitive(buffers, faces, material, parent) for material, faces in materials.items()]
        meshes.append({"name": name + "_plates", "primitives": primitives})

    title = chassis.title()
    # Keep the metadata and field order of the GLBs selected in the art studies.
    document = {
        "asset": {"version": "2.0", "generator": f"Heavy Rig / {title} A pixel study"},
        "scene": source["scene"],
        "scenes": source["scenes"],
        "nodes": nodes,
        "extras": {"chassisId": chassis, "studySourceSHA256": source_hash, "status": "appearance-study"},
        "buffers": [],
        "bufferViews": buffers.views,
        "accessors": buffers.accessors,
        "materials": [
            {
                "name": f"{title} plate colors",
                "pbrMetallicRoughness": {"metallicFactor": 0.12, "roughnessFactor": 0.86},
            },
            {
                "name": f"{title} visor",
                "emissiveFactor": visor_emissive,
                "pbrMetallicRoughness": {"metallicFactor": 0.04, "roughnessFactor": 0.67},
            },
        ],
        "meshes": meshes,
        "animations": animations,
    }
    return document, buffers.data
