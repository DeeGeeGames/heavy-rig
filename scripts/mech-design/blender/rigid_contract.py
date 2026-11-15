"""Validate source coverage and authored rigid contracts without Blender.

No chassis anatomy is inferred here. Stable semantic names and explicit parents
come from a source-specific reviewed contract; motion adapters add their own rules.
"""

import math


def finite_vector(value, size=3):
    if not isinstance(value, (list, tuple)) or len(value) != size or any(
        isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item)
        for item in value
    ):
        raise ValueError("Expected finite vector of length " + str(size))


def validate_groups(records):
    if not isinstance(records, list) or not records:
        raise ValueError("At least one rigid group is required")
    groups = {}
    for item in records:
        name = item.get("name")
        if not isinstance(name, str) or not name or name in groups:
            raise ValueError("Missing or duplicate rigid group name")
        finite_vector(item.get("pivot"))
        groups[name] = item
    for name, item in groups.items():
        parent = item.get("parent")
        if parent is not None and parent not in groups:
            raise ValueError("Missing rigid parent for " + name)
        visited = {name}
        while parent is not None:
            if parent in visited:
                raise ValueError("Cyclic rigid hierarchy at " + name)
            visited.add(parent)
            parent = groups[parent].get("parent")
    return groups


def validate_source_nodes(source):
    """Account for all mesh instances, including nodes outside the default scene."""
    nodes = source.get("nodes", [])
    names = set()
    parents = {}
    for index, node in enumerate(nodes):
        name = node.get("name")
        if name:
            if name in names:
                raise ValueError("Duplicate source node name " + name)
            names.add(name)
        if "skin" in node:
            raise ValueError("Skinned sources need a separate packaging adapter")
        if "EXT_mesh_gpu_instancing" in node.get("extensions", {}):
            raise ValueError("GPU-instanced sources need an explicit instance expansion adapter")
        if "mesh" in node:
            mesh = node["mesh"]
            if not isinstance(mesh, int) or isinstance(mesh, bool) or not 0 <= mesh < len(source.get("meshes", [])):
                raise ValueError("Invalid mesh index")
            primitives = source["meshes"][mesh].get("primitives", [])
            if not primitives or any(primitive.get("targets") for primitive in primitives):
                raise ValueError("Rigid input needs nonempty geometry without morph targets")
        for key, size in [("translation", 3), ("rotation", 4), ("scale", 3), ("matrix", 16)]:
            if key in node:
                finite_vector(node[key], size)
        for child in node.get("children", []):
            if not isinstance(child, int) or isinstance(child, bool) or not 0 <= child < len(nodes):
                raise ValueError("Invalid source child index")
            if child in parents:
                raise ValueError("Shared input node parents are unsupported")
            parents[child] = index
    for index in range(len(nodes)):
        current = index
        visited = set()
        while current in parents:
            if current in visited:
                raise ValueError("Cyclic source hierarchy")
            visited.add(current)
            current = parents[current]
    return parents


def ordered_anchors(contract, groups):
    """Allow arbitrary declaration order while preserving already ordered inputs."""
    records = contract.get("anchors", [])
    names = set(groups)
    for anchor in records:
        name = anchor.get("name")
        if not isinstance(name, str) or not name or name in names:
            raise ValueError("Missing or duplicate anchor name")
        names.add(name)
        finite_vector(anchor.get("worldPosition"))
        if "direction" in anchor:
            finite_vector(anchor["direction"])
    available = set(groups)
    remaining = list(records)
    ordered = []
    while remaining:
        before = len(remaining)
        for anchor in list(remaining):
            if anchor.get("parent") not in available:
                continue
            ordered.append(anchor)
            available.add(anchor["name"])
            remaining.remove(anchor)
        if len(remaining) == before:
            raise ValueError("Anchor cycle or missing parent")
    return ordered
