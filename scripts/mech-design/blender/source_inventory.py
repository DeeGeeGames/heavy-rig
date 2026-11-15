"""Inventory every imported mesh without guessing its anatomical ownership.

Run in Blender with -- --repo ROOT --input SOURCE.glb --output NEW_DIRECTORY.
The output includes a draft mapping; source-specific decisions belong there.
"""

import hashlib
import json


def signature(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def inventory_meshes(objects):
    import bmesh

    meshes = []
    components = []
    for mesh_index, obj in enumerate(o for o in objects if o.type == "MESH"):
        mesh = obj.data
        mesh.calc_loop_triangles()
        mesh_id = f"mesh:{mesh_index}"
        mesh_record = {
            "id": mesh_id, "name": obj.name,
            "vertices": len(mesh.vertices), "polygons": len(mesh.polygons),
            "triangles": len(mesh.loop_triangles),
            "matrixWorld": [list(row) for row in obj.matrix_world],
            "materials": [material.name if material else None for material in mesh.materials],
            "geometrySha256": signature({
                "vertices": [list(v.co) for v in mesh.vertices],
                "polygons": [list(p.vertices) for p in mesh.polygons],
            }),
        }
        meshes.append(mesh_record)
        bm = bmesh.new()
        try:
            bm.from_mesh(mesh)
            bm.verts.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            seen = set()
            component_index = 0
            for start in bm.verts:
                if start.index in seen:
                    continue
                stack, vertices = [start], []
                while stack:
                    vertex = stack.pop()
                    if vertex.index in seen:
                        continue
                    seen.add(vertex.index)
                    vertices.append(vertex)
                    stack.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
                faces = {face for vertex in vertices for face in vertex.link_faces}
                positions = [obj.matrix_world @ v.co for v in vertices]
                components.append({
                    "id": f"{mesh_id}/component:{component_index}", "mesh": mesh_id,
                    "vertices": [v.index for v in vertices],
                    "faces": sorted(f.index for f in faces),
                    "triangles": sum(len(face.verts) - 2 for face in faces),
                    "minimum": [min(v.co[i] for v in vertices) for i in range(3)],
                    "maximum": [max(v.co[i] for v in vertices) for i in range(3)],
                    "worldMinimum": [min(v[i] for v in positions) for i in range(3)],
                    "worldMaximum": [max(v[i] for v in positions) for i in range(3)],
                })
                component_index += 1
        finally:
            bm.free()
    if not meshes or not components:
        raise ValueError("Source must contain mesh components")
    return {"schemaVersion": 1, "meshes": meshes, "components": components}


def verify_ownership(inventory, mapping, source_sha256):
    if not isinstance(mapping, dict) or mapping.get("schemaVersion") != 1 or mapping.get("sourceSha256") != source_sha256:
        raise ValueError("Ownership source differs; re-inventory and review the mapping")
    if mapping.get("inventorySha256") != signature(inventory):
        raise ValueError("Ownership inventory differs (mesh data, transforms or components changed)")
    approval = mapping.get("approval", {})
    if not isinstance(approval, dict) or approval.get("status") not in ("approved", "inherited-from-selected-asset") or not isinstance(approval.get("evidence"), str) or not approval["evidence"].strip():
        raise ValueError("Component ownership requires scoped approval evidence")
    groups = mapping.get("groups", [])
    if not isinstance(groups, list) or not groups or not all(isinstance(g, str) and g.strip() for g in groups) or len(set(groups)) != len(groups):
        raise ValueError("Expected unique named ownership groups")
    assignments = mapping.get("assignments", {})
    expected = {item["id"] for item in inventory["components"]}
    if not isinstance(assignments, dict) or set(assignments) != expected:
        raise ValueError("Every source component must have exactly one ownership assignment; no stale assignments")
    if any(not isinstance(owner, str) or owner not in groups for owner in assignments.values()):
        raise ValueError("Unknown or unreviewed component owner")
    return [{**component, "group": assignments[component["id"]]} for component in inventory["components"]]


def main():
    import argparse
    from pathlib import Path
    import sys
    import bpy
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from optimization_io import blender_arguments, fresh_output, resolve_input

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(blender_arguments())
    repo = args.repo.resolve()
    source = resolve_input(repo, args.input)
    output = fresh_output(repo, args.output, directory=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    inventory = inventory_meshes(bpy.context.scene.objects)
    mapping = {
        "schemaVersion": 1, "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "inventorySha256": signature(inventory),
        "approval": {"status": "draft", "evidence": None},
        "groups": [], "assignments": {item["id"]: None for item in inventory["components"]},
    }
    (output / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
    (output / "ownership.json").write_text(json.dumps(mapping, indent=2) + "\n")
    print(json.dumps({"meshes": len(inventory["meshes"]), "components": len(inventory["components"]), "output": str(output)}))


if __name__ == "__main__":
    main()
