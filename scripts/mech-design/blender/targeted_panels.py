"""Explicit planar vent replacements derived from the approved original, not reduced meshes."""
import bpy,bmesh,hashlib,json,math
from pathlib import Path
root=Path(REPO_ROOT);out=root/'design/mechs/generated/warden-targeted-v11'
if out.exists():raise RuntimeError('Output exists')
out.mkdir();previous=bpy.context.window.scene
record=json.loads((root/'design/mechs/chassis/warden/approved-interfaces.json').read_text())['artifacts']['interfaces.blend']
assert hashlib.sha256((root/record['path']).read_bytes()).hexdigest()==record['sha256']
with bpy.data.libraries.load(str(root/record['path']),link=False) as (a,b):b.scenes=['Warden interface trial v1']
s=b.scenes[0];s.name='Targeted clean panels';bpy.context.window.scene=s;s.frame_set(1);bpy.context.view_layer.update()
def fingerprint(o):return hashlib.sha256(repr(([tuple(v.co) for v in o.data.vertices],[tuple(p.vertices) for p in o.data.polygons],tuple(v for row in o.matrix_world for v in row))).encode()).hexdigest()
original={o.name:fingerprint(o) for o in s.objects if o.type=='MESH'}
face=s.objects['repair_left_energy_face'];face.data.calc_loop_triangles();before=len(face.data.loop_triangles)
source=face.copy();source.data=face.data.copy();source.name='target_source_face';s.collection.objects.link(source)
# One broad flat insert; retain source geometry surrounding its octagonal boundary.
xmin,xmax,zmin,zmax,c=.155,.347,.835,.936,.018
outline=[(xmin+c,zmin),(xmax-c,zmin),(xmax,zmin+c),(xmax,zmax-c),(xmax-c,zmax),(xmin+c,zmax),(xmin,zmax-c),(xmin,zmin+c)]
def inside(x,z):
    return all((outline[(i+1)%8][0]-a[0])*(z-a[1])-(outline[(i+1)%8][1]-a[1])*(x-a[0])>=0 for i,a in enumerate(outline))
bm=bmesh.new();bm.from_mesh(face.data)
# Only remove triangles fully inside the insert. Preserve boundary-crossing triangles verbatim.
patches=[(.163,.207,.847,.918),(.298,.339,.847,.918)]
remove=[f for f in bm.faces if any(all(a<v.co.x<b and c<v.co.z<d for v in f.verts) for a,b,c,d in patches) and f.calc_center_median().y<.115]
bmesh.ops.delete(bm,geom=remove,context='FACES');bm.to_mesh(face.data);bm.free();face.data.update()
material=bpy.data.materials.new('Targeted panel normal');material.use_nodes=True;nodes=material.node_tree.nodes;shader=nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.22,.28,.30,1);shader.inputs['Roughness'].default_value=.65
image=bpy.data.images.new('Targeted panels normal',width=1024,height=1024);image.colorspace_settings.name='Non-Color'
texture=nodes.new('ShaderNodeTexImage');texture.image=image;nodes.active=texture;normal=nodes.new('ShaderNodeNormalMap');material.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color'])
outer=[]
for i,a in enumerate(outline):
    b=outline[(i+1)%8];outer.extend([a,((a[0]+b[0])/2,(a[1]+b[1])/2)])
inner=[]
for x,z in outer:
    angle=math.atan2(z-.882,x-.251);inner.append((.251+.052*math.cos(angle),.882+.046*math.sin(angle)))
vertices=[(x,.085,z) for x,z in outer+inner]
ring=[(i,(i+1)%16,(i+1)%16+16,i+16) for i in range(16)]
mesh=bpy.data.meshes.new('Clean weapon insert');mesh.from_pydata(vertices,[],ring);mesh.update();panels=bpy.data.objects.new('target_vent_panels',mesh);s.collection.objects.link(panels);panels.parent=face.parent;panels.matrix_world=face.matrix_world.copy();mesh.materials.append(material)
uv=mesh.uv_layers.new(name='UVMap')
for poly in mesh.polygons:
    for loop in poly.loop_indices:
        co=mesh.vertices[mesh.loops[loop].vertex_index].co;uv.data[loop].uv=((co.x-xmin)/(xmax-xmin)*.96+.02,(co.z-zmin)/(zmax-zmin)*.96+.02)
tri=bmesh.new();tri.from_mesh(mesh);bmesh.ops.triangulate(tri,faces=list(tri.faces));tri.to_mesh(mesh);tri.free()
bpy.ops.object.select_all(action='DESELECT');panels.select_set(True);source.hide_set(False);source.hide_render=False;source.select_set(True);bpy.context.view_layer.objects.active=panels
s.render.engine='CYCLES';s.cycles.samples=32;s.render.bake.use_selected_to_active=True;s.render.bake.use_clear=True;s.render.bake.cage_extrusion=.06;s.render.bake.max_ray_distance=.15;s.render.bake.margin=8
bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT')
# Restrict normal detail to the two grilles; preserve neutral shading around structural edges.
values=list(image.pixels);width,height=image.size
for py in range(height):
    z=zmin+((py+.5)/height-.02)/.96*(zmax-zmin)
    for px in range(width):
        x=xmin+((px+.5)/width-.02)/.96*(xmax-xmin);index=(py*width+px)*4
        if not (.845<z<.922 and (.160<x<.207 or .298<x<.342)) or values[index+2]<.5:
            values[index:index+3]=[.5,.5,1.0]
image.pixels.foreach_set(values);image.update()
material.node_tree.links.new(normal.outputs['Normal'],shader.inputs['Normal']);image.filepath_raw=str(out/'panels-normal.png');image.file_format='PNG';image.save();image.pack()
source.hide_render=True;source.hide_set(True)
face.data.calc_loop_triangles();mesh.calc_loop_triangles();after=len(face.data.loop_triangles)+len(mesh.loop_triangles)
assert all(fingerprint(s.objects[name])==h for name,h in original.items() if name!=face.name)
bpy.data.libraries.write(str(out/'targeted.blend'),{s})
report={'modifiedObject':face.name,'addedObject':panels.name,'trianglesBefore':before,'trianglesAfterIncludingPanels':after,'unchangedMeshes':len(original)-1,'sourceSha256':record['sha256'],'status':'isolated-targeted-trial'}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n');result=report
