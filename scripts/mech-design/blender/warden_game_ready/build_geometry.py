"""Warden-specific selective repair/reuse. Approved inputs are read-only."""

from pathlib import Path
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vent_rebuild import is_vent_backing, build_inserts
from recipe import load_recipe
from mount_connections import add_mount_connections
from collections import defaultdict
import bpy, bmesh, json, math, hashlib
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

r = Path(os.environ["WARDEN_GAME_WORK"]).resolve()
repo = Path(os.environ["WARDEN_GAME_REPO"]).resolve()
source = Path(os.environ["WARDEN_GAME_SOURCE"]).resolve()
config = load_recipe(repo)
features = config["featureDecisions"]
assert (
    hashlib.sha256(source.read_bytes()).hexdigest()
    == config["inputs"]["source"]["sha256"]
)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
scene = bpy.context.scene
source_meshes = [o for o in scene.objects if o.type == "MESH"]
if len(source_meshes) != 1:
    raise ValueError("Warden repair adapter requires exactly one frozen source mesh")
raw = source_meshes[0]
raw.data.calc_loop_triangles()
rows = json.loads((r / "components.json").read_text())
atlas = json.loads((r / "atlas.json").read_text())
body = bpy.data.materials.new("Warden structure")
body.use_nodes = True
p = body.node_tree.nodes.get("Principled BSDF")
p.inputs["Base Color"].default_value = (0.32, 0.37, 0.39, 1)
p.inputs["Roughness"].default_value = 0.65
p.inputs["Metallic"].default_value = 0.22
podmat = bpy.data.materials.new("Warden shared pod atlas")
podmat.use_nodes = True
n = podmat.node_tree.nodes
links = podmat.node_tree.links
p = n.get("Principled BSDF")
p.inputs["Roughness"].default_value = 0.63
p.inputs["Metallic"].default_value = 0.22
tex = n.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(str(r / "pod-color.png"))
links.new(tex.outputs["Color"], p.inputs["Base Color"])
normal = n.new("ShaderNodeTexImage")
normal.image = bpy.data.images.load(str(r / "pod-normal.png"))
normal.image.colorspace_settings.name = "Non-Color"
uvnode = n.new("ShaderNodeUVMap")
uvnode.uv_map = "UVMap"
links.new(uvnode.outputs["UV"], tex.inputs["Vector"])
links.new(uvnode.outputs["UV"], normal.inputs["Vector"])
normalmap = n.new("ShaderNodeNormalMap")
links.new(normal.outputs["Color"], normalmap.inputs["Color"])
links.new(normalmap.outputs["Normal"], p.inputs["Normal"])
vent_inset = bpy.data.materials.new("Warden vent recess")
vent_inset.use_nodes = True
vent_shader = vent_inset.node_tree.nodes.get("Principled BSDF")
vent_shader.inputs["Base Color"].default_value = (0.025, 0.035, 0.04, 1)
vent_shader.inputs["Roughness"].default_value = 0.92
vent_shader.inputs["Metallic"].default_value = 0.05
parts = defaultdict(list)
removed = []
before = {}
after = {}
anchors = []
fits = []
round_reductions = []
reduced = defaultdict(list)
for row in rows:
    if row["group"].startswith("pod_"):
        continue
    if row["id"] in features["ventComponentIds"] or is_vent_backing(row):
        removed.append(
            {
                "id": row["id"],
                "triangles": row["triangles"],
                "reason": "overlapping vent relief replaced with explicit louvres",
                "bounds": [row["minimum"], row["maximum"]],
            }
        )
        continue
    if row["id"] in features["gunRoofSliverIds"]:
        removed.append(
            {
                "id": row["id"],
                "triangles": row["triangles"],
                "reason": "nonstructural forward-pointing gun-roof sliver",
                "bounds": [row["minimum"], row["maximum"]],
            }
        )
        continue
    size = Vector(row["maximum"]) - Vector(row["minimum"])
    rank = sorted(size, reverse=True)
    if row["triangles"] <= 4 and rank[0] > 0.04 and rank[1] < 0.002:
        removed.append(
            {
                "id": row["id"],
                "triangles": row["triangles"],
                "reason": "isolated thin sliver",
                "bounds": [row["minimum"], row["maximum"]],
            }
        )
        continue
    # Components remain intact at joints; deliberate ownership follows rigid anatomy.
    if (
        580 <= row["triangles"] <= 640
        and size.x < 0.05
        and size.y < 0.06
        and 0.11 < size.z < 0.14
    ):
        ids = sorted({i for f in row["faces"] for i in raw.data.polygons[f].vertices})
        lookup = {v: i for i, v in enumerate(ids)}
        points = [raw.matrix_world @ raw.data.vertices[i].co for i in ids]
        faces = [
            tuple(lookup[i] for i in raw.data.polygons[f].vertices)
            for f in row["faces"]
        ]
        cm = bpy.data.meshes.new("Round collar working")
        cm.from_pydata(points, [], faces)
        cm.update()
        co = bpy.data.objects.new("Round collar working", cm)
        scene.collection.objects.link(co)
        bpy.context.view_layer.objects.active = co
        co.select_set(True)
        mod = co.modifiers.new("Scoped round collar reduction", "DECIMATE")
        mod.ratio = features["roundCollarRatio"]
        bpy.ops.object.modifier_apply(modifier=mod.name)
        cm.calc_loop_triangles()
        newpoints = [v.co.copy() for v in cm.vertices]
        newfaces = [tuple(t.vertices) for t in cm.loop_triangles]
        oldtree = BVHTree.FromPolygons(points, faces, all_triangles=True)
        newtree = BVHTree.FromPolygons(newpoints, newfaces, all_triangles=True)

        def samples(ps, fs):
            return ps + [sum((ps[i] for i in f), Vector()) / len(f) for f in fs]

        error = max(
            [newtree.find_nearest(v)[3] for v in samples(points, faces)]
            + [oldtree.find_nearest(v)[3] for v in samples(newpoints, newfaces)]
        )
        if error > features["roundCollarMaximumSurfaceError"]:
            raise ValueError("Round collar exceeds scoped surface tolerance")
        reduced[row["group"]].append((newpoints, newfaces))
        round_reductions.append(
            {
                "component": row["id"],
                "before": len(faces),
                "after": len(newfaces),
                "sampledBidirectionalSurfaceError": error,
                "tolerance": features["roundCollarMaximumSurfaceError"],
            }
        )
        bpy.data.objects.remove(co, do_unlink=True)
    else:
        parts[row["group"]].extend(row["faces"])
objects = []
for group, face_ids in sorted(parts.items()):
    face_ids = sorted(set(face_ids))
    vertex_ids = sorted({i for f in face_ids for i in raw.data.polygons[f].vertices})
    remap = {v: i for i, v in enumerate(vertex_ids)}
    points = [tuple(raw.matrix_world @ raw.data.vertices[i].co) for i in vertex_ids]
    faces = [tuple(remap[i] for i in raw.data.polygons[f].vertices) for f in face_ids]
    for ps, fs in reduced[group]:
        offset = len(points)
        points.extend(tuple(p) for p in ps)
        faces.extend(tuple(i + offset for i in f) for f in fs)
    face_materials = [0] * len(faces)
    if group == "rig_torso":
        ps, fs, ms = build_inserts()
        offset = len(points)
        points.extend(tuple(p) for p in ps)
        faces.extend(tuple(i + offset for i in f) for f in fs)
        face_materials.extend(ms)
    m = bpy.data.meshes.new(group + "_mesh")
    m.from_pydata(points, [], faces)
    m.materials.append(body)
    if group == "rig_torso":
        m.materials.append(vent_inset)
    for polygon, material_index in zip(m.polygons, face_materials):
        polygon.material_index = material_index
    m.update()
    m.calc_loop_triangles()
    before[group] = len(m.loop_triangles)
    bm = bmesh.new()
    bm.from_mesh(m)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=list(bm.edges))
    # Remove only near-coplanar internal tessellation; no collapse decimation.
    bmesh.ops.dissolve_limit(
        bm,
        angle_limit=math.radians(features["planarDissolveDegrees"]),
        use_dissolve_boundaries=False,
        verts=list(bm.verts),
        edges=list(bm.edges),
        delimit={"MATERIAL"},
    )
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() < math.radians(40)
    bm.to_mesh(m)
    bm.free()
    m.update()
    m.calc_loop_triangles()
    after[group] = len(m.loop_triangles)
    o = bpy.data.objects.new(group, m)
    scene.collection.objects.link(o)
    objects.append(o)
bpy.data.objects.remove(raw, do_unlink=True)
for pod in config["inputs"]["pods"]:
    side = pod["side"]
    path = repo / pod["path"]
    existing = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [o for o in scene.objects if o not in existing]
    meshes = [o for o in imported if o.type == "MESH"]
    empties = [o for o in imported if o.type == "EMPTY"]
    points = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    candidates = [c for c in rows if c["group"] == "pod_" + side]
    targetlo = Vector(tuple(min(c["minimum"][i] for c in candidates) for i in range(3)))
    targethi = Vector(tuple(max(c["maximum"][i] for c in candidates) for i in range(3)))
    scale = Vector(
        tuple((targethi[i] - targetlo[i]) / (hi[i] - lo[i]) for i in range(3))
    )

    def fit(point):
        return Vector(
            tuple(targetlo[i] + (point[i] - lo[i]) * scale[i] for i in range(3))
        )

    fits.append(
        {
            "side": side,
            "source": str(path.relative_to(repo)),
            "sourceSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "sourceBounds": [list(lo), list(hi)],
            "targetBounds": [list(targetlo), list(targethi)],
            "scale": list(scale),
        }
    )
    group = "rig_mount_" + side + "-shoulder bank"
    for o in empties:
        name = o.name.removesuffix(".001")
        position = fit(o.matrix_world.translation)
        # The accepted launcher is a visual baked face; exit anchors are independent.
        anchors.append(
            {
                "name": name,
                "parent": group,
                "worldPosition": list(position),
                "direction": [0, -1, 0],
                "extras": {"source": "fitted approved pod", "visualOnlyCavity": True},
            }
        )
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        uv = o.data.uv_layers.active
        if uv is None:
            raise ValueError("Missing approved pod UV")
        uv.name = "UVMap"
        uv.active_render = True
        for poly in o.data.polygons:
            material = o.data.materials[poly.material_index]
            name = material.name.split(".")[0]
            tile = next(
                t for t in atlas["tiles"] if t["side"] == side and t["material"] == name
            )
            for i in poly.loop_indices:
                uv.data[i].uv = Vector(tile["uvOffset"]) + uv.data[i].uv * Vector(
                    tile["uvScale"]
                )
        for v in o.data.vertices:
            v.co = fit(v.co)
        o.data.materials.clear()
        o.data.materials.append(podmat)
        for poly in o.data.polygons:
            poly.material_index = 0
        o.name = "fitted_pod_" + side + "_" + o.name
        objects.append(o)
    for o in empties:
        bpy.data.objects.remove(o, do_unlink=True)
    # Merge reused housing+cartridge with its moving support: two materials, one group.
    members = [
        o
        for o in objects
        if o.name == group or o.name.startswith("fitted_pod_" + side + "_")
    ]
    bpy.ops.object.select_all(action="DESELECT")
    for o in members:
        o.select_set(True)
    bpy.context.view_layer.objects.active = members[0]
    bpy.ops.object.join()
    members[0].name = group
    members[0].data.uv_layers.active_index = 0
    members[0].data.uv_layers[0].active_render = True
    objects = [o for o in scene.objects if o.type == "MESH"]
pivots = {item["name"]: item["pivot"] for item in config["rigGroups"]}
parents = {item["name"]: item["parent"] for item in config["rigGroups"]}
for side, sign in [("left", 1), ("right", -1)]:
    anchors.append(
        {
            "name": "physical_exit_" + side + "_gun",
            "parent": "rig_mount_" + side + "-gun",
            "worldPosition": [sign * config["gunExit"]["positiveX"], config["gunExit"]["y"], config["gunExit"]["z"]],
            "direction": [0, -1, 0],
            "extras": {"source": "P2 barrel lip center; outside front plane by0.0031"},
        }
    )
# Reproject the inherited source-depth anchors onto the fitted baked render face.
# A flat visual launcher has no real cavity; flash/projectile origins sit just outside it.
for anchor in anchors:
    if not (
        anchor["name"].startswith("physical_exit_") and "_launcher_" in anchor["name"]
    ):
        continue
    bank = next(o for o in objects if o.name == anchor["parent"])
    bank.data.calc_loop_triangles()
    ps = [bank.matrix_world @ v.co for v in bank.data.vertices]
    fs = [tuple(t.vertices) for t in bank.data.loop_triangles]
    tree = BVHTree.FromPolygons(ps, fs, all_triangles=True)
    original = Vector(anchor["worldPosition"])
    hit, normal, face, distance = tree.ray_cast(
        Vector((original.x, -1, original.z)), Vector((0, 1, 0)), 2
    )
    if hit is None:
        raise ValueError("Missing launcher face at exit " + anchor["name"])
    anchor["extras"]["inheritedDepth"] = original.y
    anchor["extras"]["reprojectedRenderFaceY"] = hit.y
    anchor["worldPosition"][1] = hit.y - 0.001
connections = add_mount_connections(objects, anchors, body, config["mountConnections"])
report = {
    "staticConnections": connections,
    "shinGuardBinding": {
        "description": "Front ankle guard plates and their fasteners follow the shin; soles, toes and ankle bearings follow the foot",
        "sourceComponents": [
            {"id": row["id"], "group": row["group"], "triangles": row["triangles"]}
            for row in rows
            if row["id"] in {item["id"] for item in config["ownershipOverrides"]}
        ],
    },
    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "originalImportedTriangles": 44783,
    "removedOriginalPodTriangles": sum(
        c["triangles"] for c in rows if c["group"].startswith("pod_")
    ),
    "removedSlivers": removed,
    "roundCollarReductions": round_reductions,
    "bodyBeforePlanarDissolve": before,
    "bodyAfterPlanarDissolve": after,
    "podFits": fits,
    "atlas": atlas,
    "objects": [],
    "featureDecisions": {
        "mountConnections": "Four measured solid sleeve/rod necks with embedded bearing collars; one combined static neck mesh, all weapon groups and necks remain rigidly fixed to the torso",
        "bankPivot": "Pitch axis through measured lower bracket-to-torso contact band Y~0.103 Z~0.750; X remains along the bearing axis",
        "ventRepair": "Six rebuilt noncoplanar geometric louvres, source frames retained; browser z-fighting repaired without texture growth",
        "keep": "body outline,major armor,joints,bores,pod supports",
        "reuse": "approved housing/cartridge topology and selective bakes, fitted toP2 pod envelope",
        "simplify": "near-coplanar interior body tessellation at0.8degrees; no collapse",
        "bake": "reuse accepted shallow relief and launcher face bakes in shared128pxcolor+normalatlas",
        "remove": "original cracked P2podskins and replaced geometric launcher detail; isolated thin slivers",
    },
}
for o in objects:
    o.data.calc_loop_triangles()
    report["objects"].append(
        {
            "name": o.name,
            "triangles": len(o.data.loop_triangles),
            "materials": len(o.data.materials),
        }
    )
report["triangles"] = sum(x["triangles"] for x in report["objects"])
contract = {
    "coordinateSystem": "Blender Z-up,-Y forward,+Xown-left",
    "neutralHeight": 0.99951171875,
    "groups": [
        {"name": name, "parent": parents[name], "pivot": point}
        for name, point in pivots.items()
    ],
    "anchors": anchors,
    "staticConnections": connections,
    "meshGroups": {item["meshName"]: item["parent"] for item in connections},
    "weaponBinding": "rigid-to-torso",
    "source": "geometry-report.json",
    "bakedLauncherCollisionPolicy": "renderface only; analytic gameplaycolliders and independent exit anchors; eightvisiblecells,sixmappedgameplaytubes",
}
(r / "rig-contract.json").write_text(json.dumps(contract, indent=2) + "\n")
(r / "geometry-report.json").write_text(json.dumps(report, indent=2) + "\n")
bpy.ops.object.select_all(action="DESELECT")
for o in objects:
    o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=str(r / "geometry.blend"))
bpy.ops.export_scene.gltf(
    filepath=str(r / "geometry.glb"),
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_apply=True,
    export_yup=True,
    export_materials="EXPORT",
    export_cameras=False,
    export_lights=False,
)
print("GEOMETRY_COMPLETE", report["triangles"], before, after, flush=True)
