"""Export approved shared animated chassis and socket-local modules, with source samples."""
import bpy,json,hashlib
from pathlib import Path
from mathutils import Matrix
root=Path(REPO_ROOT)
decimate_ratio=globals().get('DECIMATE_RATIO')
out=root/'design/mechs/generated'/globals().get('OUTPUT_FOLDER','components-candidate')
record=globals().get('SOURCE_OVERRIDE') or json.loads((root/'design/mechs/chassis/warden/approved-interfaces.json').read_text())['artifacts']['interfaces.blend']
source=root/record['path']
assert hashlib.sha256(source.read_bytes()).hexdigest()==record['sha256']
if out.exists():raise RuntimeError('Output revision already exists')
out.mkdir(parents=True)
previous=bpy.context.window.scene
owned=[]
try:
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):loaded.scenes=[globals().get('SOURCE_SCENE','Warden interface trial v1')]
    scene=loaded.scenes[0];owned.append(scene);bpy.context.window.scene=scene
    scene.frame_set(1);bpy.context.view_layer.update()
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
    modules={};excluded=set();specs=[]
    for side in ['left','right']:
        socket=scene.objects['socket_'+side+'_shoulder']
        for family in ['energy','launcher','empty']:
            parts=[o for o in scene.objects if (o.type=='MESH' and (o.name.startswith('repair_'+side+'_'+family) or o.name=='module_'+side+'_'+family)) or o.name=='muzzle_'+side+'_'+family]
            assert parts
            modules[side+'-'+family]=(socket,parts)
            excluded.update(parts)
            specs.append({'id':side+'-'+family,'file':side+'-'+family+'.glb','socket':socket.name,'nodes':[o.name for o in parts]})
    # Full-cycle reference matrices, converted into glTF basis and column-major order.
    basis=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    tracked=[o for o in scene.objects if o.type=='MESH' or o.name.startswith(('socket_','muzzle_'))]
    geometry={}
    depsgraph=bpy.context.evaluated_depsgraph_get()
    for o in tracked:
        if o.type!='MESH':continue
        evaluated=o.evaluated_get(depsgraph);mesh=evaluated.to_mesh()
        mesh.calc_loop_triangles()
        geometry[o.name]={'triangles':len(mesh.loop_triangles)}
        evaluated.to_mesh_clear()
    samples=[]
    for frame in range(1,92):
        scene.frame_set(frame);bpy.context.view_layer.update()
        matrices={}
        for o in tracked:
            m=basis@o.matrix_world@basis.inverted()
            matrices[o.name]=[m[row][col] for col in range(4) for row in range(4)]
        samples.append({'time':(frame-1)/60,'matrices':matrices})
    scene.frame_set(1);bpy.context.view_layer.update()
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
    manifest={'status':'unoptimized-component-validation','sourceSha256':record['sha256'],'chassis':'chassis.glb','coordinateSystem':'glTF Y-up, +Z forward; source scale retained','decimateRatio':decimate_ratio,'modules':specs,'geometry':geometry,'samples':samples}
    (out/'package.json').write_text(json.dumps(manifest)+'\n')
    result={'output':str(out),'modules':len(specs),'samples':len(samples)}
finally:
    bpy.context.window.scene=previous
    for scene in reversed(owned):
        objects=list(scene.objects);bpy.data.scenes.remove(scene)
        for o in objects:
            if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
