"""Visual-review candidate: split a guard spanning the ankle; preserve approved inputs."""
import hashlib,json
from pathlib import Path
import bpy,bmesh
from mathutils import Matrix,Vector
repo=Path(REPO_ROOT)
approval=json.loads((repo/'design/mechs/chassis/warden/approved-motion.json').read_text())
source=approval['artifacts']['warden-walk.blend']
if hashlib.sha256((repo/source['path']).read_bytes()).hexdigest()!=source['sha256']:raise RuntimeError('Approved source changed.')
out=repo/'design/mechs/generated/warden-clearance-v5'
if (out/'split-candidate.blend').exists():raise RuntimeError('Candidate exists; use a new revision.')
out.mkdir(parents=True,exist_ok=True)
previous=bpy.context.window.scene
with bpy.data.libraries.load(str(repo/source['path']),link=False) as (available,loaded):loaded.scenes=['Warden gait trial v2']
scene=loaded.scenes[0];scene.name='Warden gait trial v5';bpy.context.window.scene=scene
try:
    for side,part in [('right',29),('right',85),('right',88),('left',53),('left',100)]:
        upper=scene.objects['repair_shared_tripo_part_'+str(part)]
        lower=upper.copy();lower.data=upper.data.copy();lower.name='repair_'+side+'_lower_guard_'+str(part);scene.collection.objects.link(lower)
        upper.data=upper.data.copy()
        for obj,height,keep_top in [(upper,.137,True),(lower,.133,False)]:
            bm=bmesh.new();bm.from_mesh(obj.data)
            bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),plane_co=(0,0,height),plane_no=(0,0,1),dist=1e-7,clear_inner=keep_top,clear_outer=not keep_top)
            edges=set(e for e in bm.edges if e.is_boundary and all(abs(v.co.z-height)<1e-6 for v in e.verts));queue=list(edges)
            while queue:
                e=queue.pop()
                for v in e.verts:
                    for other in v.link_edges:
                        if other.is_boundary and other not in edges:edges.add(other);queue.append(other)
            bmesh.ops.holes_fill(bm,edges=list(edges),sides=0)
            bm.to_mesh(obj.data);bm.free();obj.data.update()
        lower.parent=scene.objects['rig_leg_'+side+'_foot'];lower.matrix_parent_inverse=Matrix.Identity(4);lower.matrix_basis=Matrix.Translation((.22 if side=='right' else -.22,-.035,-.095))
    scene.frame_set(1)
    bpy.data.libraries.write(str(out/'split-candidate.blend'),{scene})
    scene.render.resolution_x=600;scene.render.resolution_y=600;scene.render.resolution_percentage=100
    camera=scene.camera
    for index in range(0,90,3):
        scene.frame_set(index+1);offset=Vector((0,-.13333333333333333*index/90,0))
        camera.location=Vector((.8,-.9,.38))+offset
        camera.rotation_euler=(Vector((0,.04,.14))+offset-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=.85
        scene.render.filepath=str(out/('ankle-%03d.png'%(index//3)));bpy.ops.render.render(write_still=True)
    scene.frame_set(1)
    report={'status':'visual-review-required','sourceSha256':source['sha256'],'change':'Parts 29, 85, 88, 53 and 100 split: upper z>=0.137 remains shin-owned; lower z<=0.133 follows foot; 0.004 neutral relief gap with capped boundaries.','limitations':['Approved seam treatment applied bilaterally; resulting appearance remains a candidate','Other ankle/waist crossings unresolved','Hinge axes remain unvalidated']}
    (out/'split-report.json').write_text(json.dumps(report,indent=2)+'\n')
finally:bpy.context.window.scene=previous
