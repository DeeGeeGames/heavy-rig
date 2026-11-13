"""Matched renders of actual source and simplified GLB assemblies."""
import bpy,json
from pathlib import Path
from mathutils import Vector
candidate=globals().get('CANDIDATE_FOLDER','components-candidate')
root=Path(REPO_ROOT);out=root/'design/mechs/generated'/candidate;previous=bpy.context.window.scene
owned=[]
try:
    with bpy.data.libraries.load(str(root/'design/mechs/assets/warden/interfaces/interfaces.blend'),link=False) as (available,loaded):loaded.scenes=['Warden interface trial v1']
    reference=loaded.scenes[0];owned.append(reference)
    for revision,folder in [('source','assets/warden/components'),('candidate','generated/'+candidate)]:
        for view,families,location,target,scale in [('front',['energy','energy'],(1.6,-2.8,1.4),(0,0,.5),1.22),('rear',['energy','energy'],(-1.6,2.8,1.4),(0,0,.5),1.22),('weapons',['launcher','launcher'],(1.4,-2.4,1.4),(0,.08,.82),1.08)]:
            scene=bpy.data.scenes.new('Render '+revision+' '+view);owned.append(scene);bpy.context.window.scene=scene
            scene.world=reference.world;scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='SINGLE';scene.display.shading.single_color=(.55,.60,.62);scene.display.shading.show_cavity=True;scene.display.shading.cavity_type='BOTH'
            for o in reference.objects:
                if o.type not in ['LIGHT','CAMERA']:continue
                clone=o.copy();clone.data=o.data.copy();scene.collection.objects.link(clone)
                if o==reference.camera:scene.camera=clone
            bpy.ops.import_scene.gltf(filepath=str(root/'design/mechs'/folder/'chassis.glb'))
            for side,family in zip(['left','right'],families):
                socket=next(o for o in scene.objects if o.name.split('.')[0]=='socket_'+side+'_shoulder')
                before=set(scene.objects);bpy.ops.import_scene.gltf(filepath=str(root/'design/mechs'/folder/(side+'-'+family+'.glb')))
                for o in set(scene.objects)-before:
                    if o.parent is None:o.parent=socket
            scene.frame_set(1);bpy.context.view_layer.update()
            camera=scene.camera;camera.location=location;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=scale
            scene.render.resolution_x=700;scene.render.resolution_y=700;scene.render.resolution_percentage=100
            scene.render.filepath=str(out/(revision+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
            objects=list(scene.objects);bpy.data.scenes.remove(scene);owned.remove(scene)
            for o in objects:
                if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
    result={'rendered':6}
finally:
    bpy.context.window.scene=previous
    for scene in reversed(owned):
        objects=list(scene.objects);bpy.data.scenes.remove(scene)
        for o in objects:
            if not o.users_scene:bpy.data.objects.remove(o,do_unlink=True)
