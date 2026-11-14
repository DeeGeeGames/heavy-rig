"""Warden-specific protected-interface checks for the isolated pod.
The aperture classifier, 90 underside samples and 40 firing rays are explicit
contracts for this component. Adapt these contracts for another part; passing
this command is not an aesthetic, full aim-arc or runtime-performance approval.
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

sys.path.insert(0, str(Path(__file__).resolve().parent))
from optimization_io import (
    blender_arguments,
    fresh_output,
    resolve_input,
    verified_checkpoint,
)

parser = argparse.ArgumentParser(
    description="Verify Warden pod interfaces and export geometry, not visual acceptance or a universal triangle budget."
)
parser.add_argument("--repo", type=Path, required=True)
parser.add_argument("--side", choices=["left", "right"], default="left")
parser.add_argument("--candidate", type=Path)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args(blender_arguments())
ROOT = args.repo.resolve()
component = "right-pod" if args.side == "right" else "pod"
source = verified_checkpoint(
    ROOT, f"design/mechs/assets/warden/optimization/{component}/source.glb"
)
candidate = (
    resolve_input(ROOT, args.candidate)
    if args.candidate
    else verified_checkpoint(
        ROOT, f"design/mechs/assets/warden/optimization/{component}/pod.glb"
    )
)
output = fresh_output(ROOT, args.output)
paths = {"source": source, "candidate": candidate}
results = {}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def aperture(mesh):
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
    edges = [e for e in bm.edges if len(e.link_faces) == 1]
    seen = set()
    candidates = []
    for edge in edges:
        if edge in seen:
            continue
        todo = [edge]
        component = []
        while todo:
            e = todo.pop()
            if e in seen:
                continue
            seen.add(e)
            component.append(e)
            for v in e.verts:
                todo.extend(
                    k for k in v.link_edges if len(k.link_faces) == 1 and k not in seen
                )
        points = [mesh.matrix_world @ v.co for e in component for v in e.verts]
        if (
            max(p.z for p in points) < -0.025
            and min(p.y for p in points) > 0.015
            and max(p.y for p in points) < 0.19
            and len(component) > 20
        ):
            candidates.append(
                [[list(mesh.matrix_world @ v.co) for v in e.verts] for e in component]
            )
    bm.free()
    return candidates


for key, path in paths.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    anchors = {
        o.name: o
        for o in bpy.context.scene.objects
        if o.name.startswith(("muzzle_", "physical_exit_"))
    }
    points = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    r = {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "anchors": {
            n: [list(row) for row in o.matrix_world] for n, o in anchors.items()
        },
        "triangles": 0,
        "meshes": {},
        "outgoingRays": 0,
        "outgoingHits": [],
        "inwardDistances": {},
        "bounds": {
            "min": [min(v[i] for v in points) for i in range(3)],
            "max": [max(v[i] for v in points) for i in range(3)],
        },
        "invalidNormals": 0,
        "nonFinitePositions": 0,
        "zeroAreaTriangles": 0,
    }
    for o in meshes:
        o.data.calc_loop_triangles()
        r["triangles"] += len(o.data.loop_triangles)
        r["meshes"][o.name] = len(o.data.loop_triangles)
        r["invalidNormals"] += sum(
            not math.isfinite(n.vector.length) or abs(n.vector.length - 1) > 0.001
            for n in o.data.corner_normals
        )
        r["nonFinitePositions"] += sum(
            not all(math.isfinite(c) for c in v.co) for v in o.data.vertices
        )
        r["zeroAreaTriangles"] += sum(t.area < 1e-12 for t in o.data.loop_triangles)
    r["mountingApertures"] = aperture(max(meshes, key=lambda o: len(o.data.polygons)))
    r["undersideCoverage"] = []
    for ix in range(9):
        for iy in range(10):
            p = Vector((-0.08 + 0.02 * ix, 0.01 + 0.02 * iy, -0.5))
            solid = False
            for ob in meshes:
                inv = ob.matrix_world.inverted()
                hit, loc, n, idx = ob.ray_cast(
                    inv @ p, inv.to_3x3() @ Vector((0, 0, 1)), distance=1
                )
                if hit and (ob.matrix_world @ loc).z < -0.025:
                    solid = True
            r["undersideCoverage"].append(solid)
    for name, o in anchors.items():
        if not name.startswith("physical_exit_"):
            continue
        origin = o.matrix_world.translation
        for dx, dz in [(0, 0), (0.004, 0), (-0.004, 0), (0, 0.004), (0, -0.004)]:
            p = origin + Vector((dx, 0, dz))
            r["outgoingRays"] += 1
            for ob in meshes:
                inv = ob.matrix_world.inverted()
                hit, loc, n, idx = ob.ray_cast(
                    inv @ p, inv.to_3x3() @ Vector((0, -1, 0)), distance=1
                )
                if hit:
                    r["outgoingHits"].append(
                        {"origin": name, "mesh": ob.name, "offset": [dx, dz]}
                    )
        distances = []
        for ob in meshes:
            inv = ob.matrix_world.inverted()
            hit, loc, n, idx = ob.ray_cast(
                inv @ origin, inv.to_3x3() @ Vector((0, 1, 0)), distance=0.1
            )
            if hit:
                distances.append((ob.matrix_world @ loc - origin).length)
        r["inwardDistances"][name] = min(distances) if distances else None
    results[key] = r
c = results["candidate"]
a = results["source"]
require(
    a["anchors"] == c["anchors"] and len(c["anchors"]) == 9,
    "Logical/physical anchor matrices changed",
)
require(
    not c["outgoingHits"] and c["outgoingRays"] == 40,
    "An outgoing firing sample hit geometry",
)
require(
    all(d is not None and 0 < d < 0.003 for d in c["inwardDistances"].values()),
    "Visual face must remain behind the frozen firing exits",
)
require(
    c["invalidNormals"] == c["nonFinitePositions"] == c["zeroAreaTriangles"] == 0,
    "Invalid normals, positions or triangles",
)
require(
    len(a["mountingApertures"]) == len(c["mountingApertures"]) == 1,
    "Expected exactly one identifiable mounting aperture",
)


def edge_distance(p, edge):
    u, v = [Vector(q) for q in edge]
    _, t = intersect_point_line(p, u, v)
    return (p - u.lerp(v, max(0, min(1, t)))).length


errors = []
for source, target in [(a, c), (c, a)]:
    edges = target["mountingApertures"][0]
    errors.extend(
        min(edge_distance(Vector(p), edge) for edge in edges)
        for pair in source["mountingApertures"][0]
        for p in pair
    )
c["mountApertureMaximumBoundaryError"] = max(errors)
c["undersideCoverageDifferences"] = sum(
    x != y for x, y in zip(a["undersideCoverage"], c["undersideCoverage"])
)
require(
    max(errors) < 1e-6 and c["undersideCoverageDifferences"] == 0,
    "Mounting boundary or underside coverage changed",
)
c["boundsDeltaFromAccepted"] = {
    k: [c["bounds"][k][i] - a["bounds"][k][i] for i in range(3)] for k in ["min", "max"]
}
results["scope"] = (
    "Isolated pod render geometry; visual mesh has a solid launcher face and must not serve as a projectile collision mesh. No production integration or frame-time measurement."
)
output.write_text(json.dumps(results, indent=2) + "\n")
print(
    "PASSED",
    json.dumps(
        {
            k: {"triangles": v["triangles"], "bytes": v["bytes"]}
            for k, v in results.items()
            if isinstance(v, dict)
        }
    ),
)
