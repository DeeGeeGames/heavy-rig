"""Export approved shared animated chassis and socket-local modules, with source samples."""
import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Matrix
root=Path(REPO_ROOT)
decimate_ratio=globals().get('DECIMATE_RATIO')
out=root/'design/mechs/generated'/globals().get('OUTPUT_FOLDER','components-candidate')
record=globals().get('SOURCE_OVERRIDE') or json.loads((root/'design/mechs/chassis/warden/approved-interfaces.json').read_text())['artifacts']['interfaces.blend']
source=root/record['path']
if hashlib.sha256(source.read_bytes()).hexdigest()!=record['sha256']:
    raise RuntimeError('Source differs from its approved hash.')
if out.exists():raise RuntimeError('Output revision already exists')
out.mkdir(parents=True)
previous=bpy.context.window.scene
owned=[]
try:
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):loaded.scenes=[globals().get('SOURCE_SCENE','Warden interface trial v1')]
    scene=loaded.scenes[0];owned.append(scene);bpy.context.window.scene=scene
    fps=scene.render.fps/scene.render.fps_base
    start,end=scene.frame_start,scene.frame_end
    if fps<=0 or end<=start:raise RuntimeError('Expected a positive-rate multi-frame motion.')
    scene.frame_set(start);bpy.context.view_layer.update()
    if decimate_ratio is not None:
        for o in scene.objects:
            if o.type=='MESH' and not o.name.startswith('module_'):
                modifier=o.modifiers.new('Candidate triangle reduction','DECIMATE');modifier.ratio=decimate_ratio
        bpy.context.view_layer.update()
    # Tangent export cannot process n-gons; make their tessellation explicit.
    for o in scene.objects:
        if o.type=='MESH' and any(len(p.vertices)>4 for p in o.data.polygons):
            modifier=o.modifiers.new('Explicit export tessellation','TRIANGULATE');modifier.min_vertices=5
    bpy.context.view_layer.update()
    physical_origins=[];origins_hash=None
    origins_path=globals().get('FIRING_ORIGINS')
    if origins_path:
        origins_bytes=Path(origins_path).read_bytes()
        origins_record=json.loads(origins_bytes)
        interface=json.loads((root/'design/mechs/chassis/warden/approved-interfaces.json').read_text())
        if origins_record.get('sourceSha256')!=interface['artifacts']['interfaces.blend']['sha256']:
            raise RuntimeError('Physical exits were measured from a different interface checkpoint.')
        expected={side+'-launcher-'+row+'-'+str(index):(side,'launcher')
                  for side in ['left','right'] for row in ['upper','lower'] for index in range(1,5)}
        expected.update({side+'-'+family+'-1':(side,family)
                         for side in ['left','right'] for family in ['energy','gun']})
        entries=origins_record.get('origins')
        if not isinstance(entries,list) or len(entries)!=len(expected):
            raise RuntimeError('Expected all 20 physical weapon exits.')
        seen=set()
        for entry in entries:
            if not isinstance(entry,dict):raise RuntimeError('Invalid physical exit record.')
            identifier=entry.get('id')
            if not isinstance(identifier,str) or identifier not in expected or identifier in seen:
                raise RuntimeError('Unsupported or repeated physical exit ID.')
            seen.add(identifier);side,family=expected[identifier]
            parent_name='rig_mount_'+side+'-gun' if family=='gun' else 'socket_'+side+'_shoulder'
            parent=scene.objects.get(parent_name)
            if entry.get('parent')!=parent_name or parent is None:
                raise RuntimeError('Unsupported physical exit parent.')
            position=entry.get('local')
            if not isinstance(position,list) or len(position)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) for v in position):
                raise RuntimeError('Physical exit coordinates must be three finite numbers.')
            if entry.get('direction')!=[0,-1,0]:
                raise RuntimeError('Only parent-local -Y firing directions are supported.')
            name='physical_exit_'+identifier.replace('-','_')
            if name in bpy.data.objects:raise RuntimeError('Physical exit name already exists.')
            anchor=bpy.data.objects.new(name,None);scene.collection.objects.link(anchor)
            anchor.parent=parent;anchor.location=position;anchor.empty_display_type='ARROWS';anchor.empty_display_size=.01
            physical_origins.append({'id':identifier,'node':name,'parent':parent_name,'local':position,'direction':[0,-1,0]})
        origins_hash=hashlib.sha256(origins_bytes).hexdigest()
        bpy.context.view_layer.update()
    modules={};excluded=set();specs=[]
    for side in ['left','right']:
        socket=scene.objects['socket_'+side+'_shoulder']
        for family in ['energy','launcher','empty']:
            parts=[o for o in scene.objects if (o.type=='MESH' and (o.name.startswith('repair_'+side+'_'+family) or o.name=='module_'+side+'_'+family)) or o.name=='muzzle_'+side+'_'+family or o.name.startswith('physical_exit_'+side+'_'+family+'_')]
            assert parts
            modules[side+'-'+family]=(socket,parts)
            excluded.update(parts)
            specs.append({'id':side+'-'+family,'file':side+'-'+family+'.glb','socket':socket.name,'nodes':[o.name for o in parts]})
    # Full-cycle reference matrices, converted into glTF basis and column-major order.
    basis=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    tracked=[o for o in scene.objects if o.type=='MESH' or o.name.startswith(('socket_','muzzle_','physical_exit_'))]
    geometry={}
    depsgraph=bpy.context.evaluated_depsgraph_get()
    for o in tracked:
        if o.type!='MESH':continue
        evaluated=o.evaluated_get(depsgraph);mesh=evaluated.to_mesh()
        mesh.calc_loop_triangles()
        geometry[o.name]={'triangles':len(mesh.loop_triangles)}
        evaluated.to_mesh_clear()
    samples=[]
    for frame in range(start,end+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        matrices={}
        for o in tracked:
            m=basis@o.matrix_world@basis.inverted()
            matrices[o.name]=[m[row][col] for col in range(4) for row in range(4)]
        samples.append({'time':(frame-start)/fps,'matrices':matrices})
    scene.frame_set(start);bpy.context.view_layer.update()
    for o in scene.objects:
        o.hide_set(False);o.select_set(o not in excluded and o.type in ['MESH','EMPTY'])
    bpy.ops.export_scene.gltf(filepath=str(out/'chassis.glb'),export_format='GLB',export_tangents=True,export_apply=True,use_selection=True,use_active_scene=True,export_animations=True,export_animation_mode='SCENE',export_anim_scene_split_object=False,export_frame_range=True,export_frame_step=1,export_bake_animation=True,export_anim_slide_to_zero=True,export_optimize_animation_size=False)
    for name,(socket,parts) in modules.items():
        local=bpy.data.scenes.new('Component '+name);owned.append(local);bpy.context.window.scene=local
        for o in parts:
            clone=o.copy();clone.animation_data_clear();clone.parent=None;clone.matrix_world=socket.matrix_world.inverted()@o.matrix_world
            local.collection.objects.link(clone);clone.name=o.name+'__export';clone.hide_render=False;clone.hide_set(False);clone.select_set(True)
            # Export names are restored in the manifest mapping below; originals retain stable names.
        bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')),export_format='GLB',export_tangents=True,export_apply=True,use_selection=True,use_active_scene=True,export_animations=False)
    manifest={'status':'unoptimized-component-validation','sourceSha256':record['sha256'],'chassis':'chassis.glb','coordinateSystem':'glTF Y-up, +Z forward; source scale retained','decimateRatio':decimate_ratio,'physicalOriginsSha256':origins_hash,'physicalOrigins':physical_origins,'fps':fps,'frameCount':end-start+1,'duration':(end-start)/fps,'modules':specs,'geometry':geometry,'samples':samples}
    (out/'package.json').write_text(json.dumps(manifest)+'\n')
    result={'output':str(out),'modules':len(specs),'samples':len(samples)}
finally:
    bpy.context.window.scene=previous
    for scene in reversed(owned):
        objects=list(scene.objects);bpy.data.scenes.remove(scene)
        for o in objects:
            if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
