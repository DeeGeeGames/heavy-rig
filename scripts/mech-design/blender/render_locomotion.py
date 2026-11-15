"""Render matched, camera-following locomotion previews without saving the source.

Run in background Blender with -- --input FILE --output NEW_DIRECTORY --view
three-quarter|side|ankles. Floor and grid are preview-only. Output defaults to
30 fps; use --fps 60 for smoother playback of faster gaits.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--view', choices=['three-quarter', 'side', 'ankles'], default='three-quarter')
    parser.add_argument('--fps', type=int, choices=[30, 60], default=30)
    parser.add_argument('--reverse', action='store_true')
    parser.add_argument('--duration', type=float)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.output.exists():
        raise RuntimeError('Render output exists; select a new revision.')
    with bpy.data.libraries.load(str(args.input), link=False) as (available, loaded):
        if len(available.scenes) != 1:
            raise RuntimeError('Expected a single source scene.')
        loaded.scenes = available.scenes
    scene = loaded.scenes[0]
    bpy.context.window.scene = scene
    args.output.mkdir(parents=True)
    pelvis = scene.objects['rig_pelvis']
    scene.frame_set(scene.frame_end if args.reverse else scene.frame_start)
    # Review cameras are framed against the Warden's neutral pelvis Y=.08.
    # Track displacement from that origin even when playback starts at clip end.
    neutral_y = .08
    camera = scene.camera
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 480
    scene.render.resolution_y = 520 if args.view != 'ankles' else 360
    scene.render.resolution_percentage = 100
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'OBJECT'
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.show_shadows = True
    scene.display.shading.background_type = 'WORLD'
    scene.world.color = (.045, .055, .07)
    for obj in list(scene.objects):
        if obj.type == 'MESH':
            obj.color = (.52, .56, .60, 1)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -.002))
    floor = bpy.context.object
    floor.name = 'motion_preview_floor'
    floor.color = (.14, .16, .19, 1)
    # Common spacing divides the review clips' travel (walk .1333, jog .2667,
    # run .32), so the camera-following background also loops without a jump.
    for index in range(-60, 61):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, index*(.08/3), -.0015))
        line = bpy.context.object
        line.name = 'motion_preview_grid'
        line.scale = (3, .0004, .0002)
        line.color = (.31, .34, .38, 1)
    views = {'three-quarter': ((1.6, -2.4, 1.05), (0, .04, .49), 1.32),
             'side': ((2.7, -.28, .85), (0, .04, .49), 1.32),
             'ankles': ((.8, -.9, .38), (0, .04, .15), .70)}
    position, target, scale = views[args.view]
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = scale
    source_frames = scene.frame_end-scene.frame_start
    duration = args.duration if args.duration is not None else source_frames/scene.render.fps
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('Preview duration must be finite and positive.')
    frame_count = round(duration*args.fps)
    if frame_count < 2 or abs(frame_count/args.fps-duration) > 1e-7:
        raise ValueError('Duration must contain a whole number of output frames.')
    for index in range(frame_count):
        phase = index/frame_count
        source_frame = scene.frame_start+source_frames*(1-phase if args.reverse else phase)
        frame = math.floor(source_frame)
        scene.frame_set(frame, subframe=source_frame-frame)
        offset = Vector((0, pelvis.location.y-neutral_y, 0))
        camera.location = Vector(position)+offset
        camera.rotation_euler = (Vector(target)+offset-camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(args.output / f'frame-{index:03d}.png')
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
