"""Complete isolated pod proof. Explicit structural surfaces, no collapse decimation.
Read-only retained authoring checkpoint; only a new ignored candidate folder is written.
The section coordinates, vent masks and source names below are Warden-specific.
This is a worked recipe, not a universal optimizer. Use Blender 5.2 in a fresh process.
"""

import argparse
import hashlib
import json
import math
import statistics
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import (
    delaunay_2d_cdt,
    intersect_point_tri_2d,
    tessellate_polygon,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from optimization_io import blender_arguments, fresh_output, verified_checkpoint

parser = argparse.ArgumentParser(
    description="Rebuild the approved own-right Warden pod from its retained authoring checkpoint."
)
parser.add_argument("--repo", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args(blender_arguments())
ROOT = args.repo.resolve()
source = verified_checkpoint(ROOT, "design/mechs/assets/warden/optimization/right-pod/pod.blend")
origin_file = verified_checkpoint(ROOT, "design/mechs/assets/warden/components/physical-origins.json")
OUT = fresh_output(ROOT, args.output, directory=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
s = bpy.context.scene
high_shell = bpy.data.objects["repair_shared_tripo_part_2"]
high_collar = bpy.data.objects["repair_right_cartridge_collar"]
accepted_launcher = bpy.data.objects["repair_right_launcher_face__export"]
cup_source = bpy.data.objects["right_reconstructed_cup_bake_reference"]
anchors = [o for o in s.objects if o.type == "EMPTY"]
references = [high_shell, high_collar, accepted_launcher, cup_source] + anchors
for o in list(s.objects):
    if o not in references:
        bpy.data.objects.remove(o, do_unlink=True)
for o in references:
    o.hide_set(False)
anchor_matrices = {o.name: [list(r) for r in o.matrix_world] for o in anchors}


def select(objects, active):
    for o in s.objects:
        o.select_set(False)
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def mesh(name, vertices, faces):
    m = bpy.data.meshes.new(name)
    m.from_pydata(vertices, [], faces)
    m.update()
    bm = bmesh.new()
    bm.from_mesh(m)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(name, m)
    s.collection.objects.link(o)
    return o


def octagon(w, h, c):
    return [
        (-w + c, -h),
        (w - c, -h),
        (w, -h + c),
        (w, h - c),
        (w - c, h),
        (-w + c, h),
        (-w, h - c),
        (-w, -h + c),
    ]


def join(objects, active, name):
    select(objects, active)
    bpy.ops.object.join()
    active.name = name
    return active


def prepare(objects):
    for o in objects:
        select([o], o)
        # Remove only coplanar/collinear construction redundancy, before UVs or bake.
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
        bmesh.ops.dissolve_limit(
            bm,
            angle_limit=math.radians(0.01),
            verts=list(bm.verts),
            edges=list(bm.edges),
            delimit={"MATERIAL"},
        )
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(o.data)
        bm.free()
        tri = o.modifiers.new("Fixed export triangulation", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=tri.name)
        for p in o.data.polygons:
            p.use_smooth = True
        bm = bmesh.new()
        bm.from_mesh(o.data)
        for e in bm.edges:
            e.smooth = len(e.link_faces) == 2 and e.calc_face_angle() < math.radians(35)
        bm.to_mesh(o.data)
        bm.free()
    select(objects, objects[0])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")


# Only section changes that define the casing, raised rails, middle band and rear taper.
ys = [0.0001, 0.035, 0.06, 0.073, 0.107, 0.121, 0.128, 0.18, 0.196, 0.207, 0.215]
xs = [
    -0.115,
    -0.095,
    -0.083,
    -0.075,
    -0.053,
    -0.043,
    0,
    0.043,
    0.053,
    0.075,
    0.083,
    0.095,
    0.115,
]
zs = [0.03, 0.009, -0.045, -0.068]
perimeter = (
    [(x, 0.09, "top") for x in xs]
    + [(0.14, z, "right") for z in zs]
    + [(x, -0.08, "bottom") for x in [0.09, 0, -0.09]]
    + [(-0.14, z, "left") for z in reversed(zs)]
)
n = len(perimeter)
vertices = []
valid = []


# Median neighborhood measurements avoid spending vertices on small rivet bumps.
def sample(x, y, z, kind):
    values = []
    for delta in [-0.0015, 0, 0.0015]:
        if kind in ["top", "bottom"]:
            direction = Vector((0, 0, 1 if kind == "top" else -1))
            origin = Vector((x + delta, y, 0))
        else:
            direction = Vector((1 if kind == "right" else -1, 0, 0))
            origin = Vector((0, y + delta, z))
        hit, p, normal, index = high_shell.ray_cast(
            origin + direction * 0.5, -direction
        )
        if hit and (p - origin).dot(direction) > 0.025 and normal.dot(direction) > 0.03:
            values.append(p.dot(direction))
    if not values and kind in ["left", "right"] and z < -0.05:
        sign = 1 if kind == "right" else -1
        hit, p, normal, index = high_shell.ray_cast(
            Vector((sign * 0.09, y, -0.5)), Vector((0, 0, 1))
        )
        if hit and p.z < -0.025:
            adjusted_z = p.z + 0.006
            hit, p, normal, index = high_shell.ray_cast(
                Vector((sign * 0.5, y, adjusted_z)), Vector((-sign, 0, 0))
            )
            if hit:
                return Vector((p.x, y, adjusted_z)), True
    if not values:
        return Vector((x, y, z)), False
    distance = statistics.median(values)
    if kind in ["top", "bottom"]:
        return Vector((x, y, distance * (1 if kind == "top" else -1))), True
    return Vector((distance * (1 if kind == "right" else -1), y, z)), True


for y in ys:
    for x, z, kind in perimeter:
        p, okay = sample(x, y, z, kind)
        # Rear corner fastener bumps belong in the bake, not in the broad roof slope.
        # Sampling a bump here creates a pinched triangular ridge at the transition.
        if kind == "top" and y in [0.207, 0.215] and abs(x) <= 0.095:
            p.z = 0.0572 if y == 0.207 else 0.0505
        vertices.append(tuple(p))
        valid.append(okay)
faces = []
vent_edges = {}
for row in range(len(ys) - 1):
    for i in range(n):
        j = (i + 1) % n
        ids = (row * n + i, row * n + j, (row + 1) * n + j, (row + 1) * n + i)
        side = perimeter[i][2]
        is_vent = (
            side in ["left", "right"]
            and perimeter[j][2] == side
            and {perimeter[i][1], perimeter[j][1]} == {0.009, -0.045}
            and ys[row] >= 0.128
            and ys[row + 1] <= 0.207
        )
        if is_vent:
            pass
        elif side == "bottom" and perimeter[j][2] == "bottom":
            pass
        elif all(valid[k] for k in ids):
            faces.append(ids)
        else:
            missing = [vertices[k] for k in ids if not valid[k]]
            raise RuntimeError(
                f"Unresolved casing samples at row {row}, edge {i}: {missing}"
            )
# Constrained triangulation keeps the actual source mounting aperture boundary.
# The shell grid must not turn missing center samples into an enlarged opening.
bm = bmesh.new()
bm.from_mesh(high_shell.data)
edges = [e for e in bm.edges if len(e.link_faces) == 1]
seen = set()
boundaries = []
for edge in edges:
    if edge in seen:
        continue
    todo = [edge]
    component = set()
    while todo:
        e = todo.pop()
        if e in seen:
            continue
        seen.add(e)
        component.add(e)
        for v in e.verts:
            todo.extend(
                k for k in v.link_edges if len(k.link_faces) == 1 and k not in seen
            )
    boundaries.append(component)
opening = max(boundaries, key=len)
start = next(iter(opening)).verts[0]
current = start
previous = None
hole = []
while True:
    hole.append(current.co.copy())
    adjacent = [
        e.other_vert(current)
        for e in current.link_edges
        if e in opening and e.other_vert(current) != previous
    ]
    following = adjacent[0]
    if following == start:
        break
    previous, current = current, following
if len(hole) != 86:
    raise RuntimeError(
        "The retained mounting boundary changed; review its explicit contract."
    )
right = next(i for i, (x, z, k) in enumerate(perimeter) if k == "bottom" and x == 0.09)
left = next(i for i, (x, z, k) in enumerate(perimeter) if k == "bottom" and x == -0.09)
middle = next(i for i, (x, z, k) in enumerate(perimeter) if k == "bottom" and x == 0)
outer_ids = (
    [r * n + right for r in range(len(ys))]
    + [(len(ys) - 1) * n + middle]
    + [r * n + left for r in reversed(range(len(ys)))]
    + [middle]
)
floor = [Vector(vertices[i]) for i in outer_ids] + hole
outer_count = len(outer_ids)
hole_ids = list(range(outer_count, len(floor)))
constraints = [
    (ids[i], ids[(i + 1) % len(ids)])
    for ids in [list(range(outer_count)), hole_ids]
    for i in range(len(ids))
]
uv, edges_2d, tris, orig_verts, orig_edges, orig_faces = delaunay_2d_cdt(
    [Vector((p.x, p.y)) for p in floor],
    constraints,
    [list(range(outer_count))],
    1,
    1e-8,
)
hole_tris = tessellate_polygon([[Vector((p.x, p.y, 0)) for p in hole]])
hole_tris = [
    [hole[i].to_2d() if isinstance(i, int) else i.to_2d() for i in tri]
    for tri in hole_tris
]
mapped = []
for i, point in enumerate(uv):
    if not orig_verts[i]:
        raise RuntimeError("Unexpected intersecting floor boundary")
    mapped.append(len(vertices))
    vertices.append(tuple(floor[orig_verts[i][0]]))
floor_triangles = 0
for tri in tris:
    center = sum((uv[i] for i in tri), Vector((0, 0))) / len(tri)
    inside = any(intersect_point_tri_2d(center, a, b, c) for a, b, c in hole_tris)
    if not inside:
        faces.append(tuple(mapped[i] for i in tri))
        floor_triangles += len(tri) - 2
bm.free()
for side in ["left", "right"]:
    a = next(i for i, (x, z, k) in enumerate(perimeter) if k == side and z == 0.009)
    b = next(i for i, (x, z, k) in enumerate(perimeter) if k == side and z == -0.045)
    rows = [r for r, y in enumerate(ys) if 0.128 <= y <= 0.207]
    vent_edges[side] = [r * n + a for r in rows] + [r * n + b for r in reversed(rows)]
# Each side opening retains a frame and a shallow backing panel, not separate slats.
for side, outer_ids in vent_edges.items():
    sign = 1 if side == "right" else -1
    outer = [Vector(vertices[i]) for i in outer_ids]
    # Preserve the exact four source-aligned boundary corners; ring ordering follows them.
    loops = [list(outer_ids)]
    for x, y0, y1, z0, z1 in [
        (0.133, 0.130, 0.205, -0.034, 0.006),
        (0.133, 0.134, 0.201, -0.029, 0.002),
        (0.126, 0.134, 0.201, -0.029, 0.002),
    ]:
        ids = []
        for v in outer:
            yy = y0 + (y1 - y0) * (v.y - 0.128) / (0.207 - 0.128)
            zz = z0 if v.z < -0.018 else z1
            ids.append(len(vertices))
            vertices.append((sign * x, yy, zz))
        loops.append(ids)
    for a, b in zip(loops, loops[1:]):
        for i in range(len(a)):
            j = (i + 1) % len(a)
            faces.append((a[i], a[j], b[j], b[i]))
    faces.append(tuple(reversed(loops[-1])))
# Rear rings use their actual octagonal corners, not projected casing samples.
# Angular bridging connects the casing's detailed section to eight-corner rings.
terminal = [(len(ys) - 1) * n + i for i in range(n)]
rear_profiles = [
    (0.226, 0.110, 0.055, 0.015, -0.006),
    (0.234, 0.094, 0.053, 0.012, -0.006),
    (0.234, 0.072, 0.030, 0.004, -0.017),
    (0.238, 0.068, 0.027, 0.003, -0.017),
    (0.238, 0.056, 0.020, 0.003, -0.017),
    (0.229, 0.056, 0.020, 0.003, -0.017),
]
loops = [terminal]
for y, w, h, c, cz in rear_profiles:
    ids = []
    for x, z in octagon(w, h, c):
        ids.append(len(vertices))
        vertices.append((x, y, z + cz))
    loops.append(ids)


def bridge(a, b):
    def angle(i):
        return math.atan2(vertices[i][2] + 0.006, vertices[i][0]) % math.tau

    a = sorted(a, key=angle)
    b = sorted(b, key=angle)
    i = j = 0
    while i < len(a) or j < len(b):
        next_a = angle(a[(i + 1) % len(a)]) + (math.tau if i + 1 >= len(a) else 0)
        next_b = angle(b[(j + 1) % len(b)]) + (math.tau if j + 1 >= len(b) else 0)
        if j == len(b) or (i < len(a) and next_a < next_b):
            faces.append((a[i % len(a)], a[(i + 1) % len(a)], b[j % len(b)]))
            i += 1
        else:
            faces.append((a[i % len(a)], b[(j + 1) % len(b)], b[j % len(b)]))
            j += 1


for a, b in zip(loops, loops[1:]):
    bridge(a, b)
faces.append(tuple(reversed(loops[-1])))
body = mesh("pod_housing_surface", vertices, faces)
collar = high_collar.copy()
collar.data = high_collar.data.copy()
s.collection.objects.link(collar)
collar.name = "pod_collar_surface"

# Cartridge rebuilds a chamfered rim and a six-triangle baked face.
verts = []
polys = []
profiles = [
    (0, 0.117, 0.069, 0.018),
    (-0.040, 0.120, 0.071, 0.021),
    (-0.056, 0.112, 0.066, 0.018),
    (-0.062, 0.106, 0.059, 0.017),
    (-0.062, 0.099, 0.052, 0.014),
    (-0.057, 0.096, 0.049, 0.014),
]
for y, w, h, c in profiles:
    verts.extend((x, y, z) for x, z in octagon(w, h, c))
for j in range(len(profiles) - 1):
    for i in range(8):
        polys.append(
            (j * 8 + i, j * 8 + (i + 1) % 8, (j + 1) * 8 + (i + 1) % 8, (j + 1) * 8 + i)
        )
# A shallow offset keeps all original physical exits in front of the solid render face.
offset = len(verts)
verts.extend((x, -0.0556 - 0.1 * z, z) for x, z in octagon(0.096, 0.049, 0.014))
polys.append(tuple(reversed(range(offset, offset + 8))))
rim = mesh("pod_launcher_rim", verts[:offset], polys[:-1])
plate = mesh("pod_launcher_face", verts[offset:], [tuple(reversed(range(8)))])

for group in [[body, collar], [rim, plate]]:
    prepare(group)
# Give the rebuilt rim/plate their own existing UV regions in the shared atlas.
# Front bevels will be masked neutral after baking, while outer side details transfer.
for loop in plate.data.uv_layers.active.data:
    loop.uv = loop.uv * 0.92 + Vector((0.08, 0.08))
for loop in rim.data.uv_layers.active.data:
    loop.uv = loop.uv * 0.92 + Vector((0.08, 0.08))
# The unchanged collar needs no high-to-low transfer. Reserve a neutral texture
# patch for it in the same housing material; coincident source AO would blacken it.
for loop in body.data.uv_layers.active.data:
    loop.uv = loop.uv * 0.92 + Vector((0.08, 0.08))
for loop in collar.data.uv_layers.active.data:
    loop.uv = loop.uv * 0.06 + Vector((0.01, 0.01))
# Reconstructed cups use the approved left reference fitted to frozen right
# exit centers. The housing still bakes from its own right source.
high_launcher = cup_source

s.render.engine = "CYCLES"
s.cycles.samples = 48
s.render.bake.use_selected_to_active = True
s.render.bake.margin = 12
bake_reports = []
for name, objects, pairs, resolution, ao_strength in [
    ("housing", [body, collar], [(body, high_shell, 0.015, 0.045)], 1024, 0.55),
    (
        "launcher",
        [rim, plate],
        [(rim, accepted_launcher, 0.012, 0.060), (plate, high_launcher, 0.012, 0.060)],
        512,
        0.82,
    ),
]:
    material = bpy.data.materials.new("pod_" + name + "_atlas")
    material.use_nodes = True
    bs = material.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (0.24, 0.29, 0.32, 1)
    bs.inputs["Roughness"].default_value = 0.42
    bs.inputs["Metallic"].default_value = 0.3
    for o in objects:
        o.data.materials.clear()
        o.data.materials.append(material)
    maps = {}
    for kind in ["NORMAL", "AO"]:
        im = bpy.data.images.new(
            name + "_" + kind, width=resolution, height=resolution, alpha=False
        )
        im.colorspace_settings.name = "Non-Color"
        im.generated_color = (0.5, 0.5, 1, 1) if kind == "NORMAL" else (1, 1, 1, 1)
        tex = material.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = im
        material.node_tree.nodes.active = tex
        for index, (low, high, cage, ray) in enumerate(pairs):
            for o in s.objects:
                o.hide_render = o not in [low, high]
                o.hide_set(False)
            s.render.bake.use_clear = index == 0
            s.render.bake.cage_extrusion = cage
            s.render.bake.max_ray_distance = ray
            select([high, low], low)
            bpy.ops.object.bake(type=kind)
        # A missed transfer has no valid normal. Keep the target surface normal there.
        data = np.empty(len(im.pixels), dtype=np.float32)
        im.pixels.foreach_get(data)
        data = data.reshape(resolution, resolution, 4)
        if kind == "NORMAL":
            missing = np.max(data[:, :, :3], axis=2) < 0.01
            data[missing] = (0.5, 0.5, 1, 1)
        if name == "housing":
            # Vent bevels are already geometry. Keep their normals geometric instead of
            # projecting different source bevel edges across the frame at oblique angles.
            mask = np.zeros((resolution, resolution), dtype=bool)
            for poly in body.data.polygons:
                pts = [body.data.vertices[i].co for i in poly.vertices]
                rear = all(
                    p.y >= 0.2289 and abs(p.x) <= 0.073 and abs(p.z + 0.017) <= 0.031
                    for p in pts
                ) and any(p.y > 0.237 for p in pts)
                side = all(
                    0.1279 <= p.y <= 0.2071
                    and -0.0451 <= p.z <= 0.0091
                    and abs(p.x) >= 0.1259
                    for p in pts
                ) and any(abs(p.x) > 0.127 for p in pts)
                if not (rear or side):
                    continue
                uv = (
                    np.array(
                        [
                            body.data.uv_layers.active.data[i].uv[:]
                            for i in poly.loop_indices
                        ]
                    )
                    * resolution
                )
                lo = np.maximum(0, np.floor(uv.min(axis=0) - 1).astype(int))
                hi = np.minimum(resolution, np.ceil(uv.max(axis=0) + 1).astype(int))
                if np.any(hi <= lo):
                    continue
                xx, yy = np.meshgrid(
                    np.arange(lo[0], hi[0]) + 0.5, np.arange(lo[1], hi[1]) + 0.5
                )
                signs = []
                for a, b in zip(uv, np.roll(uv, -1, axis=0)):
                    signs.append(
                        (b[0] - a[0]) * (yy - a[1]) - (b[1] - a[1]) * (xx - a[0])
                    )
                mask[lo[1] : hi[1], lo[0] : hi[0]] |= np.all(
                    np.array(signs) >= -1e-7, axis=0
                ) | np.all(np.array(signs) <= 1e-7, axis=0)
            for _ in range(3):
                mask = (
                    mask
                    | np.roll(mask, 1, 0)
                    | np.roll(mask, -1, 0)
                    | np.roll(mask, 1, 1)
                    | np.roll(mask, -1, 1)
                )
            data[mask] = (0.5, 0.5, 1, 1) if kind == "NORMAL" else (1, 1, 1, 1)
            data[:80, :80, :] = (0.5, 0.5, 1, 1) if kind == "NORMAL" else (1, 1, 1, 1)
        if name == "launcher":
            # Only the front bevel/inner rim needs neutral geometric shading.
            # Keep normal/AO transfer on rearward outer surfaces, including the
            # visible side fasteners and top surface marks. A full neutral rim
            # incorrectly erased these source details.
            mask = np.zeros((resolution, resolution), dtype=bool)
            for poly in rim.data.polygons:
                if max(rim.data.vertices[i].co.y for i in poly.vertices) > -0.0559:
                    continue
                uv = np.array([rim.data.uv_layers.active.data[i].uv[:] for i in poly.loop_indices]) * resolution
                lo = np.maximum(0, np.floor(uv.min(axis=0)-1).astype(int))
                hi = np.minimum(resolution, np.ceil(uv.max(axis=0)+1).astype(int))
                if np.any(hi <= lo): continue
                xx, yy = np.meshgrid(np.arange(lo[0],hi[0])+0.5, np.arange(lo[1],hi[1])+0.5)
                signs = [(b[0]-a[0])*(yy-a[1])-(b[1]-a[1])*(xx-a[0]) for a,b in zip(uv,np.roll(uv,-1,axis=0))]
                mask[lo[1]:hi[1],lo[0]:hi[0]] |= np.all(np.array(signs)>=-1e-7,axis=0)|np.all(np.array(signs)<=1e-7,axis=0)
            for _ in range(2):
                mask = mask | np.roll(mask,1,0) | np.roll(mask,-1,0) | np.roll(mask,1,1) | np.roll(mask,-1,1)
            data[mask] = (0.5,0.5,1,1) if kind == "NORMAL" else (1,1,1,1)
        im.pixels.foreach_set(data.ravel())
        im.filepath_raw = str(OUT / (name + "-" + kind.lower() + ".png"))
        im.file_format = "PNG"
        im.save()
        im.pack()
        maps[kind] = (im, tex)
    # Cavity darkening in base color; no painted finish added.
    ao = maps["AO"][0]
    pixels = np.empty(len(ao.pixels), dtype=np.float32)
    ao.pixels.foreach_get(pixels)
    pixels = pixels.reshape(-1, 4)
    for channel, value in enumerate([0.24, 0.29, 0.32]):
        pixels[:, channel] = value * (
            (1 - ao_strength) + ao_strength * np.clip(pixels[:, channel], 0, 1)
        )
    pixels[:, 3] = 1
    color = bpy.data.images.new(
        name + "_basecolor", width=resolution, height=resolution, alpha=False
    )
    color.colorspace_settings.name = "Linear Rec.709"
    color.pixels.foreach_set(pixels.ravel())
    color.filepath_raw = str(OUT / (name + "-basecolor.png"))
    color.file_format = "PNG"
    color.save()
    color.pack()
    color_tex = material.node_tree.nodes.new("ShaderNodeTexImage")
    color_tex.image = color
    material.node_tree.links.new(color_tex.outputs["Color"], bs.inputs["Base Color"])
    normal = material.node_tree.nodes.new("ShaderNodeNormalMap")
    material.node_tree.links.new(
        maps["NORMAL"][1].outputs["Color"], normal.inputs["Color"]
    )
    material.node_tree.links.new(normal.outputs["Normal"], bs.inputs["Normal"])
    bake_reports.append(
        {
            "component": name,
            "resolution": resolution,
            "sourcePairs": [(low.name, high.name) for low, high, _, _ in pairs],
        }
    )
# One housing primitive, one interchangeable cartridge primitive.
housing = join([body, collar], body, "right_pod_shared_housing")
cartridge = join([rim, plate], rim, "right_pod_launcher_cartridge")
keep = [housing, cartridge] + anchors
for o in s.objects:
    o.hide_render = o not in keep
    o.hide_set(o not in keep)
if anchor_matrices != {o.name: [list(r) for r in o.matrix_world] for o in anchors}:
    raise RuntimeError("Source anchor matrices changed during the rebuild")
select(keep, housing)
bpy.ops.export_scene.gltf(
    filepath=str(OUT / "pod-raw.glb"),
    export_format="GLB",
    use_selection=True,
    export_tangents=True,
    export_animations=False,
)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "pod.blend"))
report = {
    "status": "unapproved-pod-only-candidate",
    "authoringCheckpointSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
    "strategy": "Explicit reduced section layout and structural vent recesses; housing detail baked from accepted source and launcher from documented reconstructed cups fitted to right exits, front rim bevels kept neutral with selective source transfer on the outer rim. No collapse decimation.",
    "geometry": {},
    "bakes": bake_reports,
    "sourceNormalsTreatment": "Retained right shell and raw launcher/rim working references were welded/reoriented before approval. Native comparison normals remain unchanged. Reuse the already-fitted reconstructed cup reference without fitting it again.",
    "cupReference": "Right-fitted reconstructed cup reference packed in this authoring checkpoint",
    "physicalOriginsSha256": hashlib.sha256(origin_file.read_bytes()).hexdigest(),
    "cupSourceTreatment": "Approved left reconstructed cup geometry moved at mouth/cup vertices to the matching right exit centers; short smooth transition on nearby plate vertices. No raw-bore transfer claim.",
    "anchorsUnchanged": len(anchors),
    "preserved": [
        "Outer chamfers",
        "Raised top rails and central band",
        "Side and rear vent frames/recess depth",
        "Exact source mounting-opening boundary and surrounding skin",
        "Unchanged collar and deliberately rebuilt launcher rim with selectively baked side fasteners",
        "Source scale and socket-local coordinates",
    ],
    "baked": [
        "Eight launcher openings",
        "Individual side and rear vent slats",
        "Fasteners and latch faces",
        "Shallow panel seams and surface relief",
    ],
    "limitations": [
        "Flat launcher face is visual geometry, not a projectile collision surface.",
        "No production integration, full-mech acceptance or hardware performance claim.",
    ],
}
for o in [housing, cartridge]:
    o.data.calc_loop_triangles()
    report["geometry"][o.name] = len(o.data.loop_triangles)
(OUT / "build-report.json").write_text(json.dumps(report, indent=2) + "\n")
print("REPORT", json.dumps(report))
