"""Bake approved surface normals onto a budgeted, shared rigid chassis and cartridges."""
import bpy,json,hashlib,math
from pathlib import Path
from mathutils import Vector
root=Path(REPO_ROOT);out=root/'design/mechs/generated/warden-baked-v3'
if out.exists():raise RuntimeError('Output exists')
out.mkdir()
record=json.loads((root/'design/mechs/chassis/warden/approved-interfaces.json').read_text())['artifacts']['interfaces.blend']
assert hashlib.sha256((root/record['path']).read_bytes()).hexdigest()==record['sha256']
previous=bpy.context.window.scene
with bpy.data.libraries.load(str(root/record['path']),link=False) as (available,loaded):loaded.scenes=['Warden interface trial v1']
s=loaded.scenes[0];s.name='Warden baked trial v1';bpy.context.window.scene=s
try:
    s.frame_set(1);bpy.context.view_layer.update();s.render.engine='CYCLES';s.cycles.samples=16
    meshes=[o for o in s.objects if o.type=='MESH'];groups={'chassis':[]};high={};stats={}
    def select(objects,active):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.hide_set(False);o.hide_render=False;o.select_set(True)
        bpy.context.view_layer.objects.active=active
    deps=bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        highmesh=bpy.data.meshes.new_from_object(o.evaluated_get(deps),depsgraph=deps)
        h=bpy.data.objects.new('bake_high_'+o.name,highmesh);s.collection.objects.link(h);h.matrix_world=o.matrix_world.copy();high[o]=h
        group=next((side+'-'+family for side in ['left','right'] for family in ['energy','launcher','empty'] if o.name.startswith('repair_'+side+'_'+family) or o.name=='module_'+side+'_'+family),'chassis')
        groups.setdefault(group,[]).append(o)
        select([o],o)
        for modifier in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
        if not o.name.startswith('module_'):
            gun=any(p.name.startswith('rig_mount_') and p.name.endswith('-gun') for p in [o.parent] if p)
            ratio=.16 if o.name in ['repair_shared_tripo_part_1','repair_shared_tripo_part_2'] else (.18 if group!='chassis' or gun else .065)
            modifier=o.modifiers.new('Budgeted surface','DECIMATE');modifier.ratio=ratio;bpy.ops.object.modifier_apply(modifier=modifier.name)
        if any(len(p.vertices)>4 for p in o.data.polygons):
            modifier=o.modifiers.new('Bake tessellation','TRIANGULATE');modifier.min_vertices=5;bpy.ops.object.modifier_apply(modifier=modifier.name)
        o.data.calc_loop_triangles();stats[o.name]=len(o.data.loop_triangles)
        h.hide_set(True);h.hide_render=True
    for group,objects in groups.items():
        # Multi-object unwrap/pack allocates one atlas across the whole shared component.
        select(objects,objects[0]);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.006);bpy.ops.object.mode_set(mode='OBJECT')
        resolution=2048 if group=='chassis' else 512
        image=bpy.data.images.new('warden_'+group+'_normal',width=resolution,height=resolution);image.generated_color=(.5,.5,1,1);image.colorspace_settings.name='Non-Color'
        material=bpy.data.materials.new('warden_'+group+'_baked');material.use_nodes=True
        nodes=material.node_tree.nodes;bsdf=nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(.32,.38,.40,1);bsdf.inputs['Metallic'].default_value=.15;bsdf.inputs['Roughness'].default_value=.65
        texture=nodes.new('ShaderNodeTexImage');texture.image=image;nodes.active=texture
        normal=nodes.new('ShaderNodeNormalMap');material.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color'])
        # Connect after baking to avoid a circular texture dependency.
        for o in objects:o.data.materials.clear();o.data.materials.append(material)
        s.render.bake.use_selected_to_active=True;s.render.bake.use_clear=False;s.render.bake.cage_extrusion=.02;s.render.bake.max_ray_distance=.06;s.render.bake.margin=8
        for low in objects:
            hi=high[low];select([hi,low],low)
            bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT')
            hi.hide_set(True);hi.hide_render=True
        material.node_tree.links.new(normal.outputs['Normal'],bsdf.inputs['Normal'])
        image.filepath_raw=str(out/(group+'-normal.png'));image.file_format='PNG';image.save();image.pack()
        for o in objects:high[o].hide_set(True);high[o].hide_render=True
    for o in high.values():bpy.data.objects.remove(o,do_unlink=True)
    for side in ['left','right']:
        for family in ['energy','launcher','empty']:
            for o in groups[side+'-'+family]:o.hide_render=family!='energy';o.hide_set(o.hide_render)
    counts={g:sum(stats[o.name] for o in objects) for g,objects in groups.items()}
    totals={label:counts['chassis']+counts['left-'+left]+counts['right-'+right] for label,left,right in [('A','launcher','launcher'),('B','energy','energy'),('C','energy','launcher'),('empty','empty','empty')]}
    assert max(totals.values())<20000,totals
    bpy.data.libraries.write(str(out/'baked.blend'),{s})
    (out/'bake-report.json').write_text(json.dumps({'status':'candidate','sourceSha256':record['sha256'],'componentTriangles':counts,'assembledTriangles':totals,'normalOnly':True,'cageExtrusion':.02,'maxRayDistance':.06,'projection':'matched object pairs'},indent=2)+'\n')
    result={'triangles':totals,'output':str(out)}
finally:
    bpy.context.window.scene=previous
    objects=list(s.objects);bpy.data.scenes.remove(s)
    for o in objects:
        if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
