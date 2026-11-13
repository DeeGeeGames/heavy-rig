"""Run in Blender with REPO_ROOT set. Creates a diagnostic scene, never edits source files.

This Warden trial consumes an explicit reviewed-by-agent part map. Estimated pivots
and static pose sweeps are evidence for repair, not a production animation rig.
"""
import hashlib
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Vector

repo = Path(REPO_ROOT)
manifest = json.loads((repo / 'design/mechs/chassis/warden/articulation-draft.json').read_text())
source = repo / manifest['source']
if hashlib.sha256(source.read_bytes()).hexdigest() != manifest['sourceSha256']:
    raise RuntimeError('Source hash differs from the mapped export.')
out = repo / 'design/mechs/generated/warden-articulation-v1'
out.mkdir(parents=True, exist_ok=True)
scene_name = 'Warden articulation probe v1'
if scene_name in bpy.data.scenes:
    raise RuntimeError('Probe scene already exists; preserve it and use a new revision.')
previous = bpy.context.window.scene
scene = bpy.data.scenes.new(scene_name)
bpy.context.window.scene = scene
try:
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = {o.name: o for o in scene.objects if o.type == 'MESH'}
    # Blender suffixes names when another imported copy exists in this session.
    meshes = {name.split('.')[0]: obj for name, obj in meshes.items()}
    assigned = [part for group in manifest['groups'] for part in group['parts']]
    if len(assigned) != len(set(assigned)) or set(assigned) != set(meshes):
        raise RuntimeError('Part map has duplicates, unknown parts or missing source meshes.')
    original = {name: obj.matrix_world.copy() for name, obj in meshes.items()}
    groups = {}
    for group in manifest['groups']:
        obj = bpy.data.objects.new(group['name'], None)
        scene.collection.objects.link(obj)
        obj.location = group['pivot']
        obj['acceptance'] = 'diagnostic; estimated pivot'
        groups[group['name']] = obj
    bpy.context.view_layer.update()
    for group in manifest['groups']:
        obj = groups[group['name']]
        if group['parent']:
            world = obj.matrix_world.copy()
            obj.parent = groups[group['parent']]
            obj.matrix_world = world
        for name in group['parts']:
            mesh = meshes[name]
            mesh.parent = obj
            mesh.matrix_world = original[name]
            mesh['source_part'] = name
    bpy.context.view_layer.update()
    drift = max(max(abs(obj.matrix_world[i][j] - original[name][i][j]) for i in range(4) for j in range(4)) for name, obj in meshes.items())
    if drift > 0.00001:
        raise RuntimeError('Parenting changed neutral placement.')
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'SINGLE'
    scene.display.shading.single_color = (0.52, 0.56, 0.60)
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.world = bpy.data.worlds.new('Probe world')
    scene.world.color = (0.12, 0.12, 0.12)
    camera = bpy.data.objects.new('Probe camera', bpy.data.cameras.new('Probe camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 1.4
    camera.location = (1.6, -2.4, 1.3)
    camera.rotation_euler = (Vector((0, 0, 0.49)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    poses = {'neutral': {}, 'waist': {'torso': (2, 25)}, 'ankle': {'leg_left_foot': (0, 20)}, 'knee': {'leg_left_shin': (0, 25)}, 'hip': {'leg_left_thigh': (0, -20)}, 'weapon': {'mount_left-gun': (0, -15)}, 'combined': {'torso': (2, 20), 'leg_left_thigh': (0, -15), 'leg_left_shin': (0, 25), 'leg_left_foot': (0, -10)}}
    for label, rotations in poses.items():
        for obj in groups.values():
            obj.rotation_euler = (0, 0, 0)
        for name, (axis, degrees) in rotations.items():
            groups[name].rotation_euler[axis] = math.radians(degrees)
        bpy.context.view_layer.update()
        scene.render.filepath = str(out / ('probe-' + label + '.png'))
        bpy.ops.render.render(write_still=True)
    for obj in groups.values():
        obj.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    bpy.data.libraries.write(str(out / 'warden-b-probe.blend'), {scene})
    bpy.ops.object.select_all(action='DESELECT')
    for obj in list(meshes.values()) + list(groups.values()):
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / 'warden-b-probe.glb'), use_selection=True, use_active_scene=True, export_animations=False)
    exported = (out / 'warden-b-probe.glb').read_bytes()
    chunk_size = struct.unpack_from('<I', exported, 12)[0]
    gltf = json.loads(exported[20:20 + chunk_size])
    triangles = sum(gltf['accessors'][primitive['indices']]['count'] // 3 for mesh in gltf['meshes'] for primitive in mesh['primitives'])
    source_triangles = sum(sum(len(face.vertices) - 2 for face in obj.data.polygons) for obj in meshes.values())
    if len(gltf['scenes']) != 1 or len(gltf['meshes']) != len(meshes) or triangles != source_triangles:
        raise RuntimeError('Export contains unexpected scenes or geometry.')
    report = {'status': 'diagnostic-unapproved', 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'sourceMeshes': len(meshes), 'assignedMeshes': len(assigned), 'groups': len(groups), 'maximumNeutralTransformDrift': drift, 'poses': list(poses), 'limitations': ['Estimated pivots', 'No collision validation', 'No piston linkage solving', 'No locomotion or foot planting', 'No runtime integration']}
    (out / 'probe-report.json').write_text(json.dumps(report, indent=2) + '\n')
finally:
    bpy.context.window.scene = previous
