"""Concealed axle-cavity trial, derived from the approved unsplit walk."""
import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Vector
repo=Path(REPO_ROOT);out=repo/'design/mechs/generated/warden-clearance-v7'
record=json.loads((repo/'design/mechs/chassis/warden/approved-motion.json').read_text())['artifacts']['warden-walk.blend']
if hashlib.sha256((repo/record['path']).read_bytes()).hexdigest()!=record['sha256']:raise RuntimeError('Source changed.')
if (out/'cavity-candidate.blend').exists():raise RuntimeError('Candidate exists.')
previous=bpy.context.window.scene
with bpy.data.libraries.load(str(repo/record['path']),link=False) as (available,loaded):loaded.scenes=['Warden gait trial v2']
s=loaded.scenes[0];s.name='Warden gait trial v7';bpy.context.window.scene=s
try:
    s.frame_set(1)
    changes=[]
    for side in ['left','right']:
        foot=s.objects['rig_leg_'+side+'_foot']
        originals=[o for o in foot.children if o.type=='MESH' and 'shared_tripo' in o.name]
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.054,depth=.155)
        cutter=bpy.context.object;cutter.name='trial_axle_cavity_'+side;cutter.parent=foot;cutter.location=(0,0,0);cutter.rotation_euler=(0,math.pi/2,0)
        bpy.context.view_layer.update()
        for obj in originals:
            before=len(obj.data.polygons)
            original=obj.data
            obj.data=original.copy()
            mod=obj.modifiers.new('Concealed axle clearance','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.modifier_apply(modifier=mod.name)
            after=len(obj.data.polygons)
            if after==0:
                obj.data=original
                changes.append({'part':obj.name,'status':'rejected-empty-result'})
            else:changes.append({'part':obj.name,'before':before,'after':after})
        bpy.data.objects.remove(cutter,do_unlink=True)
    bpy.data.libraries.write(str(out/'cavity-candidate.blend'),{s})
    s.render.resolution_x=600;s.render.resolution_y=600;s.render.resolution_percentage=100
    for i in range(0,90,3):
        s.frame_set(i+1);offset=Vector((0,-.13333333333333333*i/90,0))
        s.camera.location=Vector((.8,-.9,.38))+offset;s.camera.rotation_euler=(Vector((0,.04,.14))+offset-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.ortho_scale=.85
        s.render.filepath=str(out/('ankle-%03d.png'%(i//3)));bpy.ops.render.render(write_still=True)
    s.frame_set(1)
    report={'status':'candidate-unapproved','sourceSha256':record['sha256'],'changes':changes,'method':'Foot-local cylindrical cavity, radius 0.054 and length 0.155 source units. Original unsplit guards and motion retained.'}
    (out/'cavity-report.json').write_text(json.dumps(report,indent=2)+'\n')
finally:bpy.context.window.scene=previous
