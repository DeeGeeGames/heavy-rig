"""Render actual component GLBs assembled at their exported sockets.

Preview-only scene, camera and materials; never writes source or GLB assets.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument('--package', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--phase', type=float, default=.25)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
if args.output.exists():
    raise RuntimeError('Choose a fresh render output folder.')
if not 0 <= args.phase <= 1:
    raise ValueError('Phase must be between zero and one.')
manifest = json.loads((args.package / 'package.json').read_text())
args.output.mkdir(parents=True)
for variant, families in {'A': ('launcher', 'launcher'), 'B': ('energy', 'energy'),
                          'C': ('energy', 'launcher'), 'empty': ('empty', 'empty')}.items():
    scene = bpy.data.scenes.new('Variant ' + variant)
    bpy.context.window.scene = scene
    scene.render.fps = 120
    bpy.ops.import_scene.gltf(filepath=str(args.package / manifest['chassis']))
    for side, family in zip(('left', 'right'), families):
        socket = next(o for o in scene.objects if o.name.split('.')[0] == 'socket_' + side + '_shoulder')
        before = set(scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(args.package / (side + '-' + family + '.glb')))
        for obj in set(scene.objects) - before:
            if obj.parent is None:
                obj.parent = socket
    source_frame = args.phase * manifest['duration'] * scene.render.fps
    frame = int(source_frame)
    scene.frame_set(frame, subframe=source_frame-frame)
    bpy.context.view_layer.update()
    meshes = [o for o in scene.objects if o.type == 'MESH']
    corners = [o.matrix_world @ Vector(p) for o in meshes for p in o.bound_box]
    center = Vector([(min(p[i] for p in corners)+max(p[i] for p in corners))/2 for i in range(3)])
    camera = bpy.data.objects.new('Review camera', bpy.data.cameras.new('Review camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 1.65
    camera.location = center + Vector((1.6, -2.4, 1.2))
    camera.rotation_euler = (center-camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.world = bpy.data.worlds.new('Review world')
    scene.world.color = (.045, .055, .07)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'SINGLE'
    scene.display.shading.single_color = (.52, .56, .60)
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.background_type = 'WORLD'
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(args.output / (variant+'.png'))
    bpy.ops.render.render(write_still=True)
    # Remove only this task-owned scene and its objects before the next assembly.
    objects = list(scene.objects)
    bpy.data.scenes.remove(scene)
    for obj in objects:
        if not obj.users_scene:
            bpy.data.objects.remove(obj, do_unlink=True)
(args.output / 'render.json').write_text(json.dumps({
    'package': str(args.package), 'sourceSha256': manifest['sourceSha256'],
    'phase': args.phase, 'timeSeconds': args.phase*manifest['duration'],
    'appearance': 'Neutral workbench geometry review; not material acceptance',
    'variants': ['A', 'B', 'C', 'empty'],
}, indent=2)+'\n')
