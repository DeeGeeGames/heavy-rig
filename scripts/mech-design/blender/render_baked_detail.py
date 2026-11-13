"""Matched renders of actual source and simplified GLB assemblies."""
import bpy,json
from pathlib import Path
from mathutils import Vector
candidate='warden-baked-components-v6'
root=Path(REPO_ROOT);out=root/'design/mechs/generated'/candidate;previous=bpy.context.window.scene
owned=[]
try:
    with bpy.data.libraries.load(str(root/'design/mechs/generated/warden-interfaces-v1/interfaces.blend'),link=False) as (available,loaded):loaded.scenes=['Warden interface trial v1']
    reference=loaded.scenes[0];owned.append(reference)
    for revision,folder in [('source','warden-components-v2'),('plain',candidate),('baked',candidate)]:
        for view,families,location,target,scale in [('front',['energy','energy'],(1.6,-2.8,1.4),(0,0,.5),1.22),('rear',['energy','energy'],(-1.6,2.8,1.4),(0,0,.5),1.22),('weapons',['launcher','launcher'],(1.4,-2.4,1.4),(0,.08,.82),1.08)]:
            scene=bpy.data.scenes.new('Render '+revision+' '+view);owned.append(scene);bpy.context.window.scene=scene
            scene.world=bpy.data.worlds.new('Bake review world');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.3,.3,.3,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
            scene.render.engine='CYCLES';scene.cycles.samples=32
            camera=reference.camera.copy();camera.data=reference.camera.data.copy();scene.collection.objects.link(camera);scene.camera=camera
            for position,power,size in [((2,-3,4),450,4),((-3,-1,2),250,3),((0,3,3),500,3)]:
                light=bpy.data.lights.new('Review softbox','AREA');light.energy=power;light.shape='DISK';light.size=size
                lamp=bpy.data.objects.new('Review softbox',light);scene.collection.objects.link(lamp);lamp.location=position;lamp.rotation_euler=(Vector((0,0,.5))-lamp.location).to_track_quat('-Z','Y').to_euler()
            bpy.ops.import_scene.gltf(filepath=str(root/'design/mechs/generated'/folder/'chassis.glb'))
            for side,family in zip(['left','right'],families):
                socket=next(o for o in scene.objects if o.name.split('.')[0]=='socket_'+side+'_shoulder')
                before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(root/'design/mechs/generated'/folder/(side+'-'+family+'.glb')))
                for o in set(scene.objects)-before:
                    if o.parent is None:o.parent=socket
            for mesh in scene.objects:
                if mesh.type!='MESH':continue
                if not mesh.data.materials:
                    mat=bpy.data.materials.new('Review gray');mat.use_nodes=True;mesh.data.materials.append(mat)
                for mat in mesh.data.materials:
                    if not mat:continue
                    mat.use_nodes=True
                    shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
                    shader.inputs['Base Color'].default_value=(.32,.38,.40,1);shader.inputs['Roughness'].default_value=.65;shader.inputs['Metallic'].default_value=.15
                    if revision!='baked':
                        for link in list(shader.inputs['Normal'].links):mat.node_tree.links.remove(link)
            scene.frame_set(1);bpy.context.view_layer.update()
            camera=scene.camera;camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
            scene.render.resolution_x=700;scene.render.resolution_y=700;scene.render.resolution_percentage=100
            scene.render.filepath=str(out/(revision+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
            objects=list(scene.objects);bpy.data.scenes.remove(scene);owned.remove(scene)
            for o in objects:
                if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
    result={'rendered':9}
finally:
    bpy.context.window.scene=previous
    for scene in reversed(owned):
        objects=list(scene.objects);bpy.data.scenes.remove(scene)
        for o in objects:
            if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
