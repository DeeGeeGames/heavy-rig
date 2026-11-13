"""Superseded failed flattening experiment. Use targeted_panels.py for the current trial."""
import bpy,bmesh,hashlib,json,math
from pathlib import Path
from mathutils import Vector
root=Path(REPO_ROOT);out=root/'design/mechs/generated/warden-targeted-v2'
if out.exists():raise RuntimeError('Output exists')
out.mkdir();previous=bpy.data.scenes['Scene']
s=bpy.data.scenes['Targeted surface trial'];bpy.context.window.scene=s
record=json.loads((root/'design/mechs/chassis/warden/approved-interfaces.json').read_text())['artifacts']['interfaces.blend']
assert hashlib.sha256((root/record['path']).read_bytes()).hexdigest()==record['sha256']
def fingerprint(o):
    return hashlib.sha256(repr(([tuple(v.co) for v in o.data.vertices],[tuple(p.vertices) for p in o.data.polygons],tuple(v for row in o.matrix_world for v in row))).encode()).hexdigest()
original={o.name:fingerprint(o) for o in s.objects if o.type=='MESH'}
face=s.objects['repair_left_energy_face'];face.data.calc_loop_triangles();before=len(face.data.loop_triangles)
source=face.copy();source.data=face.data.copy();source.name='target_source_face';s.collection.objects.link(source)
patches=[(.163,.202,.855,.909),(.300,.339,.855,.909)]
bm=bmesh.new();bm.from_mesh(face.data)
for xmin,xmax,zmin,zmax in patches:
    selected=[v for v in bm.verts if xmin<v.co.x<xmax and zmin<v.co.z<zmax and v.co.y<.105]
    # Flatten only the shallow relief within the insert, retaining its existing boundary.
    for v in selected:v.co.y=.09
    edges=[e for e in bm.edges if all(v in selected for v in e.verts)]
    bmesh.ops.dissolve_degenerate(bm,dist=1e-6,edges=edges)
    selected=[v for v in selected if v.is_valid]
    edges=[e for e in bm.edges if all(v in selected for v in e.verts)]
    bmesh.ops.dissolve_limit(bm,angle_limit=.001,use_dissolve_boundaries=False,verts=selected,edges=edges,delimit=set())
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(face.data);bm.free();face.data.update()
face.data.calc_loop_triangles();after=len(face.data.loop_triangles)
# One isolated component bake; all other meshes retain their original geometry and transforms.
bpy.ops.object.select_all(action='DESELECT');face.hide_set(False);face.hide_render=False;face.select_set(True);bpy.context.view_layer.objects.active=face
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.01);bpy.ops.object.mode_set(mode='OBJECT')
image=bpy.data.images.new('targeted_energy_normal',width=1024,height=1024);image.colorspace_settings.name='Non-Color'
mat=bpy.data.materials.new('Targeted vent surface');mat.use_nodes=True;nodes=mat.node_tree.nodes;shader=nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.22,.28,.30,1);shader.inputs['Roughness'].default_value=.65
texture=nodes.new('ShaderNodeTexImage');texture.image=image;nodes.active=texture
normal=nodes.new('ShaderNodeNormalMap');mat.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color'])
face.data.materials.clear();face.data.materials.append(mat)
source.hide_set(False);source.hide_render=False;source.select_set(True)
s.render.engine='CYCLES';s.cycles.samples=32;s.render.bake.use_selected_to_active=True;s.render.bake.use_clear=True;s.render.bake.cage_extrusion=.012;s.render.bake.max_ray_distance=.03;s.render.bake.margin=8
bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT')
mat.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal']);image.filepath_raw=str(out/'vent-normal.png');image.file_format='PNG';image.save();image.pack()
source.hide_render=True;source.hide_set(True)
unchanged=[name for name,h in original.items() if name!=face.name and fingerprint(s.objects[name])==h]
assert len(unchanged)==len(original)-1
bpy.data.libraries.write(str(out/'targeted.blend'),{s})
report={'sourceSha256':record['sha256'],'modifiedObject':face.name,'trianglesBefore':before,'trianglesAfter':after,'unchangedMeshes':len(unchanged),'patchBoundsXZ':patches,'status':'targeted-preview-pending'}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');result=report
