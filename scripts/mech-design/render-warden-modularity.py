"""Blender review renders from actual exports, never authoring substitutes."""
import argparse
import sys
from pathlib import Path
import bpy
from mathutils import Vector

parser=argparse.ArgumentParser();parser.add_argument('--input',required=True,type=Path)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);folder=args.input.resolve()
for label in ('original','alternate','empty'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(folder/(label+'.glb')))
    scene=bpy.context.scene
    # Still comparison uses the same imported first pose in every assembly.
    # Motion/aim evidence comes from the Three.js verifier and interactive viewer.
    scene.render.engine='CYCLES';scene.cycles.samples=16
    scene.render.resolution_x=720;scene.render.resolution_y=720;scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('review world');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.17,.19,.23,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
    for position,power,size in (((2,-3,4),350,4),((-2,1,2),220,3)):
        data=bpy.data.lights.new('review light','AREA');data.energy=power;data.shape='DISK';data.size=size
        o=bpy.data.objects.new('review light',data);scene.collection.objects.link(o);o.location=position;o.rotation_euler=(Vector((0,0,.5))-o.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('review camera');camera=bpy.data.objects.new('review camera',data);scene.collection.objects.link(camera);scene.camera=camera;data.type='ORTHO'
    for view,position,target,scale,frame in (
        ('front',(1.7,-3,1.5),(0,0,.52),1.3,0),
        ('rear',(-1.8,3,1.4),(0,0,.52),1.3,0),
        ('socket-close',(1.5,-2,1.35),(.29,-.02,.68),.62,0)):
        scene.frame_set(frame);camera.location=position;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();data.ortho_scale=scale
        scene.render.filepath=str(folder/(label+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
print('REVIEW_RENDERS_COMPLETE')
