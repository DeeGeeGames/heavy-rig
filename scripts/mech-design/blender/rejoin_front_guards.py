"""Rigid front-guard candidate; retain approved axle dimensions and all mesh data."""
import hashlib,json
from pathlib import Path
import bpy
from mathutils import Matrix,Vector
repo=Path(REPO_ROOT);out=repo/'design/mechs/generated/warden-guard-v9'
record=json.loads((repo/'design/mechs/chassis/warden/approved-motion.json').read_text())['artifacts']['warden-walk.blend']
if hashlib.sha256((repo/record['path']).read_bytes()).hexdigest()!=record['sha256']:raise RuntimeError('Approved source changed.')
if (out/'guard-candidate.blend').exists():raise RuntimeError('Candidate exists.')
previous=bpy.context.window.scene
with bpy.data.libraries.load(str(repo/record['path']),link=False) as (available,loaded):loaded.scenes=['Warden gait trial v2']
s=loaded.scenes[0];s.name='Warden guard trial v9';bpy.context.window.scene=s
try:
    s.render.resolution_x=700;s.render.resolution_y=700;s.render.resolution_percentage=100
    def render(prefix):
        for i in range(0,90,3):
            s.frame_set(i+1);offset=Vector((0,-.13333333333333333*i/90,0))
            s.camera.location=Vector((.8,-.9,.38))+offset
            s.camera.rotation_euler=(Vector((0,.04,.14))+offset-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.ortho_scale=.85
            s.render.filepath=str(out/(prefix+'-%03d.png'%(i//3)));bpy.ops.render.render(write_still=True)
    render('before')
    changes=[]
    for side,parts,x in [('left',[53,100],-.22),('right',[88,85],.22)]:
        for part in parts:
            obj=s.objects['repair_shared_tripo_part_'+str(part)]
            obj.parent=s.objects['rig_leg_'+side+'_foot'];obj.matrix_parent_inverse=Matrix.Identity(4)
            obj.matrix_basis=Matrix.Translation((x,-.035,-.095))
            changes.append({'part':part,'rigidAssembly':side+' foot/front guard'})
    render('after');s.frame_set(1)
    bpy.data.libraries.write(str(out/'guard-candidate.blend'),{s})
    report={'status':'visual-review-pending','sourceSha256':record['sha256'],'changes':changes,
            'geometry':'No mesh vertices or topology changed; original larger axle retained.',
            'intent':'Keep front guard and its two upper side pieces moving as one rigid foot-owned assembly. No visible split seams. Intersections are not claimed eliminated.'}
    (out/'guard-report.json').write_text(json.dumps(report,indent=2)+'\n')
finally:bpy.context.window.scene=previous
