from pathlib import Path
import os
import bpy, bmesh, json
from mathutils import Vector

r = Path(os.environ["WARDEN_GAME_WORK"]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
p = Path(os.environ["WARDEN_GAME_SOURCE"]).resolve()
bpy.ops.import_scene.gltf(filepath=str(p))
o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
m = o.data
bm = bmesh.new()
bm.from_mesh(m)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
seen = set()
rows = []
for start in bm.verts:
    if start.index in seen:
        continue
    stack = [start]
    vs = []
    while stack:
        v = stack.pop()
        if v.index in seen:
            continue
        seen.add(v.index)
        vs.append(v)
        stack.extend(e.other_vert(v) for e in v.link_edges)
    fs = {f for v in vs for f in v.link_faces}
    lo = Vector(tuple(min(v.co[i] for v in vs) for i in range(3)))
    hi = Vector(tuple(max(v.co[i] for v in vs) for i in range(3)))
    c = (lo + hi) / 2
    side = "left" if c.x > 0 else "right"
    if lo.z > 0.835 and lo.y > 0.04 and abs(c.x) > 0.13:
        group = "pod_" + side
    elif lo.z > 0.67 and abs(c.x) > 0.12 and hi.z > 0.83:
        group = "rig_mount_" + side + "-shoulder bank"
    elif abs(c.x) > 0.25 and lo.z > 0.50:
        group = "rig_mount_" + side + "-gun"
    elif hi.z > 0.59:
        group = "rig_torso"
    elif abs(c.x) < 0.125 and lo.z > 0.43:
        group = "rig_pelvis"
    elif hi.z > 0.43 and lo.z > 0.27:
        group = "rig_leg_" + side + "_thigh"
    elif hi.z < 0.15:
        group = "rig_leg_" + side + "_foot"
    else:
        group = "rig_leg_" + side + "_shin"
    rows.append(
        {
            "id": len(rows),
            "vertices": [v.index for v in vs],
            "faces": sorted(f.index for f in fs),
            "triangles": len(fs),
            "minimum": list(lo),
            "maximum": list(hi),
            "group": group,
        }
    )
(r / "components.json").write_text(json.dumps(rows, separators=(",", ":")))
from collections import Counter

print(
    Counter(
        {
            g: sum(x["triangles"] for x in rows if x["group"] == g)
            for g in {x["group"] for x in rows}
        }
    )
)
print(
    "podcomponents",
    [
        (x["id"], x["triangles"], x["minimum"], x["maximum"])
        for x in rows
        if x["group"].startswith("pod_") and x["triangles"] > 100
    ],
)
