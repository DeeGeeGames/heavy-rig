"""Reject back-facing normal projections; fall back to low-poly surface normals."""
import bpy,json
from pathlib import Path
root=Path(REPO_ROOT);out=root/'design/mechs/generated/warden-baked-v5'
if out.exists():raise RuntimeError('Output exists')
out.mkdir();previous=bpy.context.window.scene
with bpy.data.libraries.load(str(root/'design/mechs/generated/warden-baked-v3/baked.blend'),link=False) as (available,loaded):loaded.scenes=['Warden baked trial v1']
s=loaded.scenes[0];bpy.context.window.scene=s
try:
    images={n.image for o in s.objects if o.type=='MESH' for m in o.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
    report=[]
    for image in images:
        values=list(image.pixels);rejected=0
        for index in range(0,len(values),4):
            if values[index+2]<.5:
                values[index:index+3]=[.5,.5,1.0];rejected+=1
        image.pixels.foreach_set(values);image.update()
        image.filepath_raw=str(out/(image.name+'.png'));image.file_format='PNG';image.save();image.pack()
        report.append({'image':image.name,'pixels':len(values)//4,'rejectedBackFacingSamples':rejected})
    # Housing cut surfaces and unchanged covers do not have a reliable/useful bake.
    for o in s.objects:
        if o.name in ['repair_shared_tripo_part_1','repair_shared_tripo_part_2'] or o.name.startswith('module_'):
            for slot in o.material_slots:
                material=slot.material.copy();material.name='Geometry_only_'+o.name;slot.material=material
                shader=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
                for link in list(shader.inputs['Normal'].links):material.node_tree.links.remove(link)
    bpy.data.libraries.write(str(out/'baked.blend'),{s})
    (out/'projection-filter.json').write_text(json.dumps(report,indent=2)+'\n')
    result={'images':report}
finally:
    bpy.context.window.scene=previous;objects=list(s.objects);bpy.data.scenes.remove(s)
    for o in objects:
        if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
