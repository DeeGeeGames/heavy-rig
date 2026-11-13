"""Socket/muzzle and empty-cover candidate derived from approved guard motion."""
import hashlib,json
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
repo=Path(REPO_ROOT);out=repo/'design/mechs/generated/warden-interfaces-v1'
record=json.loads((repo/'design/mechs/chassis/warden/approved-front-guard.json').read_text())['artifacts']['guard-candidate.blend']
if hashlib.sha256((repo/record['path']).read_bytes()).hexdigest()!=record['sha256']:raise RuntimeError('Approved guard source changed.')
if (out/'interfaces.blend').exists():raise RuntimeError('Output exists.')
previous=bpy.context.window.scene
with bpy.data.libraries.load(str(repo/record['path']),link=False) as (available,loaded):loaded.scenes=['Warden guard trial v10']
s=loaded.scenes[0];s.name='Warden interface trial v1';bpy.context.window.scene=s
try:
    s.frame_set(1);bpy.context.view_layer.update()
    original={o:o.matrix_world.copy() for o in s.objects if o.type=='MESH'}
    modules={};sockets={};anchors=[];manifest={}
    def empty(name,parent,location):
        o=bpy.data.objects.new(name,None);s.collection.objects.link(o);o.parent=parent;o.location=location;o.empty_display_type='ARROWS';o.empty_display_size=.025;return o
    for side,sign in [('left',1),('right',-1)]:
        shoulder=s.objects['rig_mount_'+side+'-shoulder bank'];pivot=Vector((sign*.22,.18,.76));origin=Vector((sign*.251,.12,.89))
        socket=empty('socket_'+side+'_shoulder',shoulder,origin-pivot);sockets[side]=socket
        bpy.context.view_layer.update()
        for family in ['energy','launcher']:
            parts=[o for o in list(s.objects) if o.type=='MESH' and o.name.startswith('repair_'+side+'_'+family)]
            modules[(side,family)]=parts
            for o in parts:
                world=o.matrix_world.copy();o.parent=socket;o.matrix_world=world
            vertices=[v.co for o in parts for v in o.data.vertices]
            point=Vector(((min(v.x for v in vertices)+max(v.x for v in vertices))/2,min(v.y for v in vertices)-.005,(min(v.z for v in vertices)+max(v.z for v in vertices))/2))
            muzzle=empty('muzzle_'+side+'_'+family,socket,point-origin);anchors.append(muzzle)
            manifest[side+'-'+family]={'socket':socket.name,'muzzle':muzzle.name,'muzzleLocal':list(point-origin),'forward':'-Y','scope':'Single logical bank origin; individual launcher tube exits are not defined.'}
        gun=s.objects['rig_mount_'+side+'-gun'];vertices=[v.co for o in gun.children if o.type=='MESH' for v in o.data.vertices]
        front=min(v.y for v in vertices);tip=[v for v in vertices if v.y<front+.002]
        point=Vector(((min(v.x for v in tip)+max(v.x for v in tip))/2,front-.002,(min(v.z for v in tip)+max(v.z for v in tip))/2))
        muzzle=empty('muzzle_'+side+'_gun',gun,point-Vector((sign*.27,.07,.62)));anchors.append(muzzle)
        manifest[side+'-gun']={'muzzle':muzzle.name,'muzzleLocal':list(muzzle.location),'forward':'-Y','scope':'Estimated center of the terminal barrel rim.'}
        # Solid chamfered blank cartridge, defined in socket-local coordinates.
        w,h,c=.120,.071,.016
        perimeter=[(-w+c,-h),(w-c,-h),(w,-h+c),(w,h-c),(w-c,h),(-w+c,h),(-w,h-c),(-w,-h+c)]
        vertices=[(x,y,z) for y in [-.064,-.045] for x,z in perimeter]
        faces=[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)]
        mesh=bpy.data.meshes.new(side+'_blank_cartridge');mesh.from_pydata(vertices,[],faces);mesh.update()
        cover=bpy.data.objects.new('module_'+side+'_empty',mesh);s.collection.objects.link(cover);cover.parent=socket
        bevel=cover.modifiers.new('Plate edge','BEVEL');bevel.width=.002;bevel.segments=2
        modules[(side,'empty')]=[cover]
    bpy.context.view_layer.update()
    drift=max(abs(o.matrix_world[i][j]-matrix[i][j]) for o,matrix in original.items() for i in range(4) for j in range(4))
    if drift>1e-5:raise RuntimeError('Socket parenting moved approved geometry.')
    states={'A':['launcher','launcher'],'B':['energy','energy'],'C':['energy','launcher'],'empty':['empty','empty']}
    s.render.resolution_x=900;s.render.resolution_y=700;s.render.resolution_percentage=100
    for label,families in states.items():
        for (side,family),parts in modules.items():
            for o in parts:o.hide_render=family!=families[0 if side=='left' else 1];o.hide_set(o.hide_render)
        camera=s.camera;camera.location=(1.4,-2.4,1.4);camera.rotation_euler=(Vector((0,.08,.82))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=1.08
        s.render.filepath=str(out/(label+'.png'));bpy.ops.render.render(write_still=True)
    for (side,family),parts in modules.items():
        for o in parts:o.hide_render=family!='energy';o.hide_set(o.hide_render)
    bpy.data.libraries.write(str(out/'interfaces.blend'),{s})
    report={'status':'interfaces-and-empty-cover-preview','sourceSha256':record['sha256'],'interfaces':manifest,'maximumReparentDrift':drift,'remaining':['Empty cover appearance approval','Verify exact muzzle exits and runtime axis conversion','Socket-local component packaging and optimization']}
    (out/'interfaces.json').write_text(json.dumps(report,indent=2)+'\n')
finally:bpy.context.window.scene=previous
