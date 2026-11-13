"""Matched isolated front and oblique review of a targeted panel replacement."""
import bpy
from pathlib import Path
from mathutils import Vector
root=Path(REPO_ROOT);out=root/'design/mechs/generated/warden-targeted-v11'
s=bpy.data.scenes['Targeted clean panels'];bpy.context.window.scene=s
panels=s.objects['target_vent_panels'];face=s.objects['repair_left_energy_face'];source=s.objects['target_source_face'];optic=s.objects['repair_left_energy_optic']
for o in s.objects:
    if o.type=='MESH':o.hide_render=o not in [face,source,optic,panels]
neutral=bpy.data.materials.new('Target review gray');neutral.use_nodes=True;shader=neutral.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.22,.28,.30,1);shader.inputs['Roughness'].default_value=.65
face.data.materials.clear();face.data.materials.append(neutral);source.data.materials.clear();source.data.materials.append(neutral);optic.data.materials.clear();optic.data.materials.append(neutral)
s.world=bpy.data.worlds.new('Target review world');s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.3,.3,.3,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.4
for position,power,size in [((1,-2,3),180,3),((-2,-1,1),100,3)]:
    light=bpy.data.lights.new('Target softbox','AREA');light.energy=power;light.size=size;lamp=bpy.data.objects.new('Target softbox',light);s.collection.objects.link(lamp);lamp.location=position;lamp.rotation_euler=(Vector((.25,.08,.89))-lamp.location).to_track_quat('-Z','Y').to_euler()
s.render.engine='CYCLES';s.cycles.samples=48;s.render.resolution_x=840;s.render.resolution_y=600;s.render.resolution_percentage=100
normal=next(n for n in panels.data.materials[0].node_tree.nodes if n.type=='NORMAL_MAP')
for view,position in [('front',(.251,-1,.89)),('angle',(.65,-1,1.1))]:
    s.camera.location=position;s.camera.rotation_euler=(Vector((.251,.08,.89))-s.camera.location).to_track_quat('-Z','Y').to_euler();s.camera.data.ortho_scale=.28
    for state in ['source','plain','baked']:
        source.hide_render=state!='source';face.hide_render=state=='source';panels.hide_render=state=='source';normal.inputs['Strength'].default_value=0 if state=='plain' else 1
        s.render.filepath=str(out/(state+'-'+view+'.png'));bpy.ops.render.render(write_still=True)
result={'rendered':6}
