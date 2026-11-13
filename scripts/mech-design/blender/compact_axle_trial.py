"""Concealed axle-cavity trial, derived from the approved unsplit walk."""
import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Vector
repo=Path(REPO_ROOT);out=repo/'design/mechs/generated/warden-clearance-v8'
record=json.loads((repo/'design/mechs/chassis/warden/approved-motion.json').read_text())['artifacts']['warden-walk.blend']
if hashlib.sha256((repo/record['path']).read_bytes()).hexdigest()!=record['sha256']:raise RuntimeError('Source changed.')
if (out/'cavity-candidate.blend').exists():raise RuntimeError('Candidate exists.')
previous=bpy.context.window.scene
with bpy.data.libraries.load(str(repo/record['path']),link=False) as (available,loaded):loaded.scenes=['Warden gait trial v2']
s=loaded.scenes[0];s.name='Warden gait trial v8';bpy.context.window.scene=s
try:
    s.frame_set(1)
    changes=[]
    for side in ['left','right']:
        obj=s.objects['repair_'+side+'_ankle_axle'];obj.data=obj.data.copy()
        for v in obj.data.vertices:
            v.co.x*=.032/.046;v.co.y*=.032/.046;v.co.z*=.09/.135
        changes.append({'part':obj.name,'radius':.032,'length':.09})
    bpy.data.libraries.write(str(out/'cavity-candidate.blend'),{s})
    s.render.resolution_x=600;s.render.resolution_y=600;s.render.resolution_percentage=100
    for i in range(0,90,3):
        s.frame_set(i+1);offset=Vector((0,-.13333333333333333*i/90,0))
        s.camera.location=Vector((.8,-.9,.38))+offset;s.camera.rotation_euler=(Vector((0,.04,.14))+offset-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.ortho_scale=.85
        s.render.filepath=str(out/('ankle-%03d.png'%(i//3)));bpy.ops.render.render(write_still=True)
    s.frame_set(1)
    report={'status':'candidate-unapproved','sourceSha256':record['sha256'],'changes':changes,'method':'Reduced internal axles only, radius 0.032 and length 0.09. All original guard and foot geometry unchanged.'}
    (out/'cavity-report.json').write_text(json.dumps(report,indent=2)+'\n')
finally:bpy.context.window.scene=previous
