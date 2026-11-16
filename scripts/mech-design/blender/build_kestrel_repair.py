"""Build a source-specific Kestrel repair and neutral rigid hierarchy.

The source/ownership/feature recipe is explicit and hash-pinned. This adapter
does not infer anatomy for another generated source or approve its own output.
All candidates are written into a new ignored generated directory.
"""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from optimization_io import blender_arguments, fresh_output, resolve_input
from rigid_packaging import accessor_values, package_neutral_rig, read_glb, write_glb
from source_inventory import inventory_meshes, verify_inventory_equivalence, verify_ownership
from kestrel_motion import add_candidate_motions


def load_verified(repo, record):
    path = resolve_input(repo, Path(record["path"]))
    if hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
        raise ValueError("Changed repair input: " + str(path))
    return path


def component_geometry(mesh, component):
    indices = sorted(component["vertices"])
    remap = {old: new for new, old in enumerate(indices)}
    points = [tuple(mesh.vertices[index].co) for index in indices]
    faces = [tuple(remap[index] for index in mesh.polygons[face].vertices)
             for face in component["faces"]]
    return points, faces


def split_geometry(points, faces, position, normal, positive):
    """Bisect only a reviewed fused source component; close only new cut edges."""
    temporary = bpy.data.meshes.new("Kestrel reviewed joint cut")
    temporary.from_pydata(points, [], faces)
    bm = bmesh.new()
    try:
        bm.from_mesh(temporary)
        plane, axis = Vector(position), Vector(normal).normalized()
        bmesh.ops.bisect_plane(
            bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
            dist=1e-7, plane_co=plane, plane_no=axis,
            clear_inner=positive, clear_outer=not positive,
        )
        cut_edges = [edge for edge in bm.edges if len(edge.link_faces) == 1
                     and all(abs((vertex.co - plane).dot(axis)) < 2e-6
                             for vertex in edge.verts)]
        if cut_edges:
            caps = bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)["faces"]
            outward = -axis if positive else axis
            bm.normal_update()
            for face in caps:
                if face.normal.dot(outward) < 0:
                    face.normal_flip()
        bm.normal_update()
        bm.verts.index_update()
        result = ([tuple(vertex.co) for vertex in bm.verts],
                  [tuple(vertex.index for vertex in face.verts) for face in bm.faces])
        if not result[1]:
            raise ValueError("Reviewed joint split produced an empty half")
        signs = [(Vector(point) - plane).dot(axis) for point in result[0]]
        if positive and min(signs) < -3e-6 or not positive and max(signs) > 3e-6:
            raise ValueError("Joint cut retained the wrong side")
        cut_points = [Vector(point) for point in result[0]
                      if abs((Vector(point) - plane).dot(axis)) < 2e-6]
        if not cut_points:
            raise ValueError("Reviewed split produced no new attachment boundary")
        cut_center = sum(cut_points, Vector()) / len(cut_points)
        return result, cut_center, cut_points
    finally:
        bm.free()
        bpy.data.meshes.remove(temporary)


def orient_closed_geometry(points, faces):
    """Orient newly built closed solids without flipping open source panels."""
    bm = bmesh.new()
    try:
        vertices = [bm.verts.new(point) for point in points]
        for face in faces:
            bm.faces.new([vertices[index] for index in face])
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.verts.index_update()
        return ([tuple(vertex.co) for vertex in bm.verts],
                [tuple(vertex.index for vertex in face.verts) for face in bm.faces])
    finally:
        bm.free()


def hollow_barrel(record, settings):
    """A closed tube with a real blind bore, not a dark painted muzzle disk."""
    low, high = record["worldMinimum"], record["worldMaximum"]
    x, z = (low[0] + high[0]) / 2, (low[2] + high[2]) / 2
    radius = ((high[0] - low[0]) + (high[2] - low[2])) / 4
    inner = radius * settings["innerRadiusRatio"]
    front, back = low[1], high[1]
    depth = min(settings["boreDepth"], (back - front) * 0.4)
    count = settings["segments"]
    points, faces = [], []
    for y, r in [(back, radius), (front, radius), (front, inner), (front + depth, inner)]:
        points.extend((x + r * math.cos(i * 2 * math.pi / count), y,
                       z + r * math.sin(i * 2 * math.pi / count)) for i in range(count))
    for ring in range(3):
        for i in range(count):
            j = (i + 1) % count
            faces.append((ring * count + i, ring * count + j,
                          (ring + 1) * count + j, (ring + 1) * count + i))
    faces.extend([tuple(reversed(range(count))), tuple(range(3 * count, 4 * count))])
    points, faces = orient_closed_geometry(points, faces)
    return points, faces, {"center": [x, front, z], "outerRadius": radius,
                           "innerRadius": inner, "depth": depth}


def turned_bearing(center, profile, count):
    """Closed load-bearing rotational body; profile supplies measured extents."""
    points, faces = [], []
    for z, radius in profile:
        points.extend((center[0] + radius * math.cos(i * 2 * math.pi / count),
                       center[1] + radius * math.sin(i * 2 * math.pi / count), z)
                      for i in range(count))
    for ring in range(len(profile) - 1):
        for i in range(count):
            j = (i + 1) % count
            faces.append((ring * count + i, ring * count + j,
                          (ring + 1) * count + j, (ring + 1) * count + i))
    faces.extend([tuple(reversed(range(count))),
                  tuple(range((len(profile) - 1) * count, len(profile) * count))])
    return orient_closed_geometry(points, faces)


def cast_joint_neck(boundary, pivot, axis, half, radius, plane_position, plane_normal):
    """Bridge the complete cut contour to the internal axle with a solid casting."""
    first = axis.orthogonal().normalized()
    second = axis.cross(first).normalized()
    points = list(boundary)
    for end in (-half, half):
        for index in range(16):
            angle = index * 2 * math.pi / 16
            points.append(pivot + axis * end + radius * (first * math.cos(angle) + second * math.sin(angle)))
    bm = bmesh.new()
    try:
        vertices = [bm.verts.new(point) for point in points]
        bmesh.ops.convex_hull(bm, input=vertices, use_existing_faces=False)
        bm.normal_update()
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        # The retained upper shell already supplies this internal base cap.
        normal = Vector(plane_normal).normalized()
        plane = Vector(plane_position)
        base = [face for face in bm.faces
                if all(abs((vertex.co - plane).dot(normal)) < 2e-6 for vertex in face.verts)]
        if base:
            bmesh.ops.delete(bm, geom=base, context="FACES_ONLY")
        bm.verts.index_update()
        return ([tuple(vertex.co) for vertex in bm.verts],
                [tuple(vertex.index for vertex in face.verts) for face in bm.faces])
    finally:
        bm.free()


def build_mesh(name, pieces, material, crease_degrees):
    points, faces = [], []
    for vertices, polygons in pieces:
        offset = len(points)
        points.extend(vertices)
        faces.extend(tuple(index + offset for index in face) for face in polygons)
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(points, [], faces)
    mesh.materials.append(material)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        before = len(bm.faces)
        degenerate = [face for face in bm.faces if face.calc_area() <= 1e-12]
        if degenerate:
            bmesh.ops.delete(bm, geom=degenerate, context="FACES_ONLY")
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
        # Preserve the generated source's surface winding. Reorienting all of
        # its disconnected open panels can invert valid cockpit/armor surfaces.
        bm.normal_update()
        for face in bm.faces:
            face.smooth = True
        for edge in bm.edges:
            edge.smooth = (len(edge.link_faces) == 2
                           and edge.calc_face_angle() < math.radians(crease_degrees))
        bm.to_mesh(mesh)
        removed = before - len(bm.faces)
    finally:
        bm.free()
    mesh.update()
    mesh.calc_loop_triangles()
    if not mesh.polygons or any(not all(math.isfinite(v) for v in vertex.co)
                                for vertex in mesh.vertices):
        raise ValueError("Empty or non-finite repaired geometry: " + name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj, removed


def clean_exported_triangles(document, source_binary):
    """Drop exact zero-area float32 export triangles without moving vertices.

    Axis conversion can collapse extremely thin source triangles even when the
    corresponding Blender polygon had nonzero area. Inspect the actual export.
    Retained index data fits inside the same buffer range; unused trailing bytes
    are harmless and later packaging can prune them.
    """
    binary = bytearray(source_binary)
    used, report = set(), []
    for mesh in document["meshes"]:
        removed = 0
        for primitive in mesh["primitives"]:
            identifier = primitive["indices"]
            if identifier in used or primitive.get("mode", 4) != 4:
                raise ValueError("Expected independently indexed triangle-list geometry")
            used.add(identifier)
            accessor = document["accessors"][identifier]
            view = document["bufferViews"][accessor["bufferView"]]
            if "byteStride" in view or accessor.get("sparse"):
                raise ValueError("Expected contiguous exported indices")
            positions = accessor_values(document, source_binary, primitive["attributes"]["POSITION"])
            indices = [row[0] for row in accessor_values(document, source_binary, identifier)]
            if len(indices) % 3:
                raise ValueError("Incomplete exported triangle")
            kept = []
            for start in range(0, len(indices), 3):
                triangle = indices[start:start + 3]
                a, b, c = [positions[index] for index in triangle]
                ab = [b[i] - a[i] for i in range(3)]
                ac = [c[i] - a[i] for i in range(3)]
                cross = [ab[1] * ac[2] - ab[2] * ac[1],
                         ab[2] * ac[0] - ab[0] * ac[2],
                         ab[0] * ac[1] - ab[1] * ac[0]]
                if all(value == 0 for value in cross):
                    removed += 1
                else:
                    kept.extend(triangle)
            if not kept:
                raise ValueError("Export cleanup would remove a whole primitive")
            code = {5121: "B", 5123: "H", 5125: "I"}[accessor["componentType"]]
            offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            struct.pack_into("<" + code * len(kept), binary, offset, *kept)
            accessor.update(count=len(kept), min=[min(kept)], max=[max(kept)])
        report.append({"mesh": mesh.get("name"), "removedZeroAreaTriangles": removed})
    return binary, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(blender_arguments())
    repo = args.repo.resolve()
    recipe_path = resolve_input(repo, args.recipe)
    recipe = json.loads(recipe_path.read_text())
    if recipe["chassis"] != "kestrel":
        raise ValueError("This adapter only handles the reviewed Kestrel source")
    source = load_verified(repo, recipe["inputs"]["source"])
    inventory_path = load_verified(repo, recipe["inputs"]["inventory"])
    mapping_path = load_verified(repo, recipe["inputs"]["ownership"])
    output = fresh_output(repo, args.output, directory=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    source_objects = list(bpy.context.scene.objects)
    inventory = inventory_meshes(source_objects)
    frozen = json.loads(inventory_path.read_text())
    verify_inventory_equivalence(inventory, frozen)
    mapping = json.loads(mapping_path.read_text())
    reviewed = verify_ownership(frozen, mapping, recipe["inputs"]["source"]["sha256"])
    meshes = [obj for obj in source_objects if obj.type == "MESH"]
    if len(meshes) != 1 or meshes[0].matrix_world != Matrix.Identity(4):
        raise ValueError("Expected the reviewed single source mesh")
    raw = meshes[0]
    groups = recipe["rig"]["groups"]
    pieces = {group["name"]: [] for group in groups}
    replacements = {item["id"] for barrels in recipe["barrels"].values() for item in barrels}
    replacements.update(recipe["waist"]["sourceComponents"])
    removals = set(recipe["removedArtifacts"])
    splits = {item["component"]: item for item in recipe["legSplits"]}
    provenance, joint_connections = [], []
    for component in reviewed:
        identifier = component["id"]
        entry = {"sourceComponent": identifier, "sourceTriangles": component["triangles"]}
        if identifier in replacements or identifier in removals:
            entry["decision"] = "replace" if identifier in replacements else "remove-detached-source-marker"
            provenance.append(entry)
            continue
        vertices, polygons = component_geometry(raw.data, component)
        if identifier in splits:
            split = splits[identifier]
            owners = []
            cut_center, cut_boundary = None, None
            for positive, owner in [(True, split["positiveOwner"]), (False, split["negativeOwner"])]:
                separated, center, boundary = split_geometry(vertices, polygons, split["position"], split["normal"], positive)
                pieces[owner].append(separated)
                if positive:
                    cut_center = center
                    cut_boundary = boundary
                owners.append(owner)
            connection = split.get("internalBearing")
            if connection:
                if cut_center is None or cut_boundary is None:
                    raise ValueError("Missing thigh cut attachment")
                pivot = Vector(connection["pivot"])
                axis = Vector(connection["axis"]).normalized()
                half = connection["axleHalfLength"]
                pieces[split["positiveOwner"]].append(cast_joint_neck(
                    cut_boundary, pivot, axis, half, connection["axleRadius"], split["position"], split["normal"]))
                joint_connections.append({"sourceComponent": identifier,
                                          "thighAttachment": list(cut_center), "pivot": list(pivot),
                                          "scope": "A thigh-owned cast eye spans the upper cut contour and overlaps the complete shin-owned knee housing."})
            entry.update(decision="separate-at-reviewed-joint", owners=owners)
        else:
            owner = recipe["componentOwners"].get(identifier)
            if owner not in pieces:
                raise ValueError("Missing final owner for retained source component " + identifier)
            pieces[owner].append((vertices, polygons))
            entry.update(decision="retain", owner=owner)
        provenance.append(entry)
    barrel_report, anchors = {}, list(recipe["rig"].get("anchors", []))
    for side, records in recipe["barrels"].items():
        owner = f"rig_mount_{side}-gun"
        barrel_report[side] = []
        for index, record in enumerate(records):
            vertices, polygons, bore = hollow_barrel(record, recipe["barrelSettings"])
            pieces[owner].append((vertices, polygons))
            barrel_report[side].append({"sourceComponent": record["id"], **bore})
            anchors.append({"name": f"physical_exit_{side}_gun_{index + 1}", "parent": owner,
                            "worldPosition": bore["center"], "direction": [0, -1, 0]})
        centers = [item["center"] for item in barrel_report[side]]
        mean = Vector([sum(point[i] for point in centers) / len(centers) for i in range(3)])
        central = min(centers, key=lambda point: (Vector(point) - mean).length)
        anchors.append({"name": f"muzzle_{side}-gun", "parent": owner,
                        "worldPosition": central, "direction": [0, -1, 0]})
    waist = recipe["waist"]
    for name, profile in waist["profiles"].items():
        pieces[name].append(turned_bearing(waist["center"], profile, waist["segments"]))
    neutral = bpy.data.materials.new("Kestrel neutral geometry inspection")
    neutral.diffuse_color = (0.42, 0.45, 0.47, 1)
    neutral.use_nodes = True
    shader = neutral.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (0.42, 0.45, 0.47, 1)
    shader.inputs["Roughness"].default_value = 0.58
    objects, removed_degenerate = [], 0
    for group, parts in pieces.items():
        if not parts:
            raise ValueError("Rigid owner has no geometry: " + group)
        obj, removed = build_mesh("kestrel_" + group.removeprefix("rig_"), parts, neutral,
                                  recipe["normalCreaseDegrees"])
        objects.append(obj)
        removed_degenerate += removed
    for obj in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in objects)
    geometry = output / "geometry.glb"
    bpy.ops.export_scene.gltf(filepath=str(geometry), export_format="GLB", use_selection=True,
                              export_animations=False, export_extras=True)
    contract = {**recipe["rig"], "anchors": anchors,
                "meshGroups": {obj.name: name for obj, name in zip(objects, pieces)}}
    document, binary = read_glb(geometry)
    binary, exported_cleanup = clean_exported_triangles(document, binary)
    write_glb(geometry, document, binary)
    document, indices, checked_groups, rest, owned, bindings = package_neutral_rig(
        document, contract, scene_name="Kestrel A repair candidate",
        generator="Heavy Rig Kestrel source-specific repair and rigid packaging",
    )
    for name, index in indices.items():
        axis = recipe.get("hingeAxes", {}).get(name)
        if axis:
            document["nodes"][index].setdefault("extras", {})["hingeAxis"] = [axis[0], axis[2], -axis[1]]
    document["extras"] = {"chassisId": "kestrel", "approvalStatus": "candidate-unapproved",
                           "coordinateSystem": "glTF Y-up,+Z-forward,+X-own-left",
                           "sourceSha256": recipe["inputs"]["source"]["sha256"],
                           "weaponBinding": "rigid-to-torso", "rigContractVersion": 1}
    binary, motions = add_candidate_motions(document, binary, indices, rest, bindings)
    (output / "motion-report.json").write_text(json.dumps(motions, indent=2) + "\n")
    candidate = output / "kestrel.glb"
    write_glb(candidate, document, binary)
    (output / "rig-contract.json").write_text(json.dumps(contract, indent=2) + "\n")
    report = {"sourceSha256": recipe["inputs"]["source"]["sha256"],
              "recipeSha256": hashlib.sha256(recipe_path.read_bytes()).hexdigest(),
              "candidateSha256": hashlib.sha256(candidate.read_bytes()).hexdigest(),
              "candidateBytes": candidate.stat().st_size, "blenderVersion": bpy.app.version_string,
              "sourceComponentCount": len(reviewed), "sourceDecisions": provenance,
              "removedDegeneratePolygons": removed_degenerate, "barrels": barrel_report,
              "exportedTriangleCleanup": exported_cleanup,
              "jointConnections": joint_connections,
              "ownedMeshNodes": owned, "rigGroups": groups, "anchors": anchors,
              "status": "candidate-needs-articulation-and-visual-review"}
    report["authoringScripts"] = [
        {"path": str(path.relative_to(repo)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in [Path(__file__).resolve()] + [Path(__file__).resolve().parent / name for name in (
            "kestrel_motion.py", "source_inventory.py", "rigid_packaging.py", "rigid_contract.py", "locomotion_trial.py")]
    ]
    (output / "repair-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(candidate), "bytes": candidate.stat().st_size,
                      "groups": len(groups), "removedDegeneratePolygons": removed_degenerate}))


if __name__ == "__main__":
    main()
