"""Surface-crossing audit, not a volume collision or motion-limit proof.
Load the gait trial .blend first; run with REPO_ROOT. Restores frame and active scene.
"""
import json
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri

repo = Path(REPO_ROOT)
revision = globals().get('GAIT_REVISION', 'v2')
scene = bpy.data.scenes.get('Warden gait trial '+revision)
if scene is None:
    raise RuntimeError('Load the Warden gait trial .blend first.')
previous, previous_frame = bpy.context.window.scene, scene.frame_current
pairs = [('pelvis','torso'),('pelvis','leg_left_thigh'),('pelvis','leg_right_thigh'),
         ('leg_left_thigh','leg_left_shin'),('leg_right_thigh','leg_right_shin'),
         ('leg_left_shin','leg_left_foot'),('leg_right_shin','leg_right_foot')]
try:
    bpy.context.window.scene = scene
    rig = {o.name.removeprefix('rig_'):o for o in scene.objects if o.name.startswith('rig_')}
    def crosses(a,b):
        # Strict interior segment/triangle crossings exclude mere contact and
        # coplanar overlap. This still does not measure solid penetration depth.
        for source,target in [(a,b),(b,a)]:
            for i in range(3):
                start,end = source[i],source[(i+1)%3]
                delta = end-start
                if delta.length < 1e-9: continue
                hit = intersect_ray_tri(*target,delta.normalized(),start,True)
                if hit is not None:
                    t = (hit-start).dot(delta)/delta.length_squared
                    if 1e-5 < t < 1-1e-5: return True
        return False
    def tree(group):
        vertices, faces, identities, centers, triangles = [], [], [], [], []
        for obj in rig[group].children:
            if obj.type != 'MESH':
                continue
            obj.data.calc_loop_triangles()
            base = len(vertices)
            points = [obj.matrix_world @ v.co for v in obj.data.vertices]
            vertices.extend(points)
            for triangle in obj.data.loop_triangles:
                faces.append(tuple(base+i for i in triangle.vertices))
                triangles.append(tuple(points[i] for i in triangle.vertices))
                identities.append((obj.name,triangle.index))
                centers.append(sum((points[i] for i in triangle.vertices),Vector())/3)
        return BVHTree.FromPolygons(vertices,faces,all_triangles=True),identities,centers,triangles
    baseline, rows = {}, []
    for frame in [None]+list(range(scene.frame_start,scene.frame_end+1,5)):
        if frame is None:
            scene.frame_set(1)
            for obj in rig.values():
                if obj.rotation_mode == 'QUATERNION': obj.rotation_quaternion = (1,0,0,0)
                else: obj.rotation_euler = (0,0,0)
            rig['pelvis'].location = (0,.08,.48)
            bpy.context.view_layer.update()
        else:
            scene.frame_set(frame)
        trees = {name:tree(name) for name in {name for pair in pairs for name in pair}}
        for a,b in pairs:
            ta,ia,ca,ga = trees[a]
            tb,ib,cb,gb = trees[b]
            pivot = rig[b].matrix_world.translation
            hits = {(ia[i],ib[j]) for i,j in ta.overlap(tb)
                    if ((ca[i]-pivot).length>.07 or (cb[j]-pivot).length>.07) and crosses(ga[i],gb[j])}
            key = a+' / '+b
            if frame is None:
                baseline[key] = hits
            else:
                new = hits-baseline[key]
                rows.append({'frame':frame,'pair':key,'outsideHingeCandidates':len(hits),
                             'newVsNeutral':len(new),'examples':sorted(new)[:3], 'objectPairs':sorted(set((x[0][0],x[1][0]) for x in new))})
    report = {'status':'needs-clearance-review',
              'method':'BVH candidates narrowed to strict segment/triangle surface crossings outside hinge neighborhood. Excludes coplanar contact; not a volume penetration-depth proof.',
              'scope':'Direct rigid child meshes of waist and pelvis/leg adjacency pairs; excludes other-body, weapon, terrain and containment checks.',
              'baselineCounts':{k:len(v) for k,v in baseline.items()},'samples':rows}
    (repo/globals().get('AUDIT_OUTPUT','design/mechs/generated/warden-clearance-v3/surface-crossings.json')).write_text(json.dumps(report,indent=2)+'\n')
finally:
    scene.frame_set(previous_frame)
    bpy.context.window.scene = previous
