"""Warden modular proof: run in Blender with REPO_ROOT set; sources stay immutable.

Rebuild gameplay-contract.json as documented before running. All outputs are trials.
This script extracts front cartridges, not final watertight production modules.
"""
import hashlib
import json
import struct
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

repo = Path(REPO_ROOT)
config = json.loads((repo / 'design/mechs/chassis/warden/modular-draft.json').read_text())
out = repo / 'design/mechs/generated' / globals().get('OUTPUT_FOLDER', 'modular-assembly-candidate')
contract = json.loads((out / 'gameplay-contract.json').read_text())
for variant, families in config['variants'].items():
    expected = [('left-gun', 'ballistic'), ('right-gun', 'ballistic')]
    expected += [(side + '-shoulder ' + ('bank' if family == 'energy' else 'pod'), family) for side, family in zip(('left', 'right'), families)]
    if [(m['id'], m['family']) for m in contract[variant]] != expected:
        raise RuntimeError('Gameplay mounts changed; review the assembly recipe.')
for source in config['sources'].values():
    if hashlib.sha256((repo / source['path']).read_bytes()).hexdigest() != source['sha256']:
        raise RuntimeError('Source differs from reviewed extraction recipe.')
if any(o.name.startswith('shared_tripo_part_') or o.name in ('socket_left_shoulder', 'socket_right_shoulder') for o in bpy.data.objects):
    raise RuntimeError('Stable assembly names already exist; use a fresh session.')
previous = bpy.context.window.scene
created = []


def new_scene(name):
    if name in bpy.data.scenes:
        raise RuntimeError('Scene exists; use a fresh session for this revision: ' + name)
    scene = bpy.data.scenes.new(name)
    created.append(scene)
    bpy.context.window.scene = scene
    return scene


def import_source(key):
    scene = new_scene('Warden modular source ' + key)
    bpy.ops.import_scene.gltf(filepath=str(repo / config['sources'][key]['path']))
    return {o.name.split('.')[0]: o for o in scene.objects if o.type == 'MESH'}


def copy_world(source, name):
    mesh = source.data.copy()
    mesh.transform(source.matrix_world)
    obj = bpy.data.objects.new(name, mesh)
    obj['source_part'] = source.name.split('.')[0]
    return obj


def cut(obj, axis, value, keep_positive):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    normal = [0, 0, 0]
    normal[axis] = 1
    point = [0, 0, 0]
    point[axis] = value
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), dist=1e-7,
                           plane_co=point, plane_no=normal,
                           clear_inner=keep_positive, clear_outer=not keep_positive)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    if not obj.data.polygons:
        raise RuntimeError('Extraction produced an empty module.')


def bounds(objects):
    points = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    return [[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]]


def fingerprint(objects):
    # Include mesh coordinates, topology and placement. Names are stable across assemblies.
    data = [(o.name, [list(v.co) for v in o.data.vertices], [list(p.vertices) for p in o.data.polygons],
             [list(row) for row in o.matrix_world]) for o in objects]
    return hashlib.sha256(json.dumps(data, separators=(',', ':')).encode()).hexdigest()


def export(scene, name, objects):
    bpy.context.window.scene = scene
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / (name + '.glb')), use_selection=True,
                              use_active_scene=True, export_animations=False)


def inspect_export(path):
    raw = path.read_bytes()
    chunk_size = struct.unpack_from('<I', raw, 12)[0]
    gltf = json.loads(raw[20:20 + chunk_size])
    binary = raw[28 + chunk_size:]
    if len(gltf['scenes']) != 1:
        raise RuntimeError('Export contains extra scenes.')

    def accessor(index):
        data = gltf['accessors'][index]
        view = gltf['bufferViews'][data['bufferView']]
        start = view.get('byteOffset', 0)
        return {'layout': {k: v for k, v in data.items() if k != 'bufferView'},
                'stride': view.get('byteStride'),
                'bytes': hashlib.sha256(binary[start:start + view['byteLength']]).hexdigest()}

    shared_data = {}
    for node in gltf['nodes']:
        if node.get('name', '').startswith('shared_'):
            mesh = gltf['meshes'][node['mesh']]
            shared_data[node['name']] = {
                'transform': {k: node[k] for k in ('matrix', 'translation', 'rotation', 'scale') if k in node},
                'primitives': [{'attributes': {k: accessor(v) for k, v in p['attributes'].items()},
                                'indices': accessor(p['indices'])} for p in mesh['primitives']]}
    return shared_data, {'meshes': len(gltf['meshes']),
                         'triangles': sum(gltf['accessors'][p['indices']]['count'] // 3 for m in gltf['meshes'] for p in m['primitives']),
                         'sockets': sorted(n['name'] for n in gltf['nodes'] if n.get('name', '').startswith('socket_'))}


try:
    b = import_source('bodyB')
    a = import_source('launcherA')
    library = new_scene('Warden modular library v1')
    shared = []
    modules = {}
    fit_records = {}
    split = config['interface']['planeY']
    for name, source in b.items():
        if name in ('tripo_part_59', 'tripo_part_68'):
            continue  # Energy optics belong to the removable cartridges.
        obj = copy_world(source, 'shared_' + name)
        if name in ('tripo_part_1', 'tripo_part_2'):
            cut(obj, 1, split, True)
        library.collection.objects.link(obj)
        shared.append(obj)
    for side, part, lens in [('left', 'tripo_part_1', 'tripo_part_59'), ('right', 'tripo_part_2', 'tripo_part_68')]:
        face = copy_world(b[part], side + '_energy_face')
        cut(face, 1, split, False)
        optic = copy_world(b[lens], side + '_energy_optic')
        modules[(side, 'energy')] = [face, optic]
        launcher = copy_world(a[part], side + '_launcher_face')
        cut(launcher, 2, config['interface']['donorMinimumZ'], True)
        cut(launcher, 1, split, False)
        # Fit donor front X/Z envelope to the canonical energy cartridge envelope.
        # Depth and attachment plane remain fixed; this is not a seam-topology weld.
        target = bounds([face])
        donor = bounds([launcher])
        scale = [1.0, 1.0, 1.0]
        offset = [0.0, 0.0, 0.0]
        for axis in (0, 2):
            scale[axis] = (target[1][axis] - target[0][axis]) / (donor[1][axis] - donor[0][axis])
            offset[axis] = target[0][axis] - donor[0][axis] * scale[axis]
        for vertex in launcher.data.vertices:
            for axis in (0, 2):
                vertex.co[axis] = vertex.co[axis] * scale[axis] + offset[axis]
        modules[(side, 'launcher')] = [launcher]
        fit_records[side] = {'scale': scale, 'offset': offset, 'targetBounds': target}
        for obj in [face, optic, launcher]:
            library.collection.objects.link(obj)
            obj['acceptance'] = 'extraction trial; seam cleanup pending'
    canonical_hash = fingerprint(shared)
    export(library, 'warden-shared-chassis', shared)
    for (side, family), objects in modules.items():
        export(library, 'warden-' + side + '-' + family, objects)
    anchors = []
    for side in ('left', 'right'):
        anchor = bpy.data.objects.new('socket_' + side + '_shoulder', None)
        library.collection.objects.link(anchor)
        anchor.location = config['interface']['anchors'][side]
        anchor['forward_axis'] = '-Y'
        anchor['acceptance'] = 'provisional cartridge interface; not a muzzle'
        anchors.append(anchor)
    reports = {}
    for variant, families in config['variants'].items():
        scene = new_scene('Warden modular ' + variant)
        # Link the exact objects and mesh datablocks, avoiding independent body copies.
        selected = shared + [o for side, family in zip(('left', 'right'), families) for o in modules[(side, family)]]
        for obj in selected:
            scene.collection.objects.link(obj)
        if fingerprint(shared) != canonical_hash:
            raise RuntimeError('Shared geometry or transforms drifted.')
        for anchor in anchors:
            scene.collection.objects.link(anchor)
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.render.resolution_x = 900
        scene.render.resolution_y = 900
        scene.render.resolution_percentage = 100
        scene.display.shading.light = 'STUDIO'
        scene.display.shading.color_type = 'SINGLE'
        scene.display.shading.single_color = (.52, .56, .60)
        scene.display.shading.show_cavity = True
        scene.display.shading.cavity_type = 'BOTH'
        scene.world = bpy.data.worlds.new(variant + ' world')
        scene.world.color = (.12, .12, .12)
        camera = bpy.data.objects.new(variant + ' camera', bpy.data.cameras.new(variant + ' camera'))
        scene.collection.objects.link(camera)
        scene.camera = camera
        camera.data.type = 'ORTHO'
        for view, position, target, scale in [('three-quarter', (1.6,-2.4,1.3), (0,0,.49), 1.4),
                                               ('front', (0,-3,.49), (0,0,.49), 1.2),
                                               ('rear', (0,3,.49), (0,0,.49), 1.2),
                                               ('pods', (1.2,-2,1.25), (0,.18,.86), .85)]:
            camera.location = position
            camera.rotation_euler = (Vector(target) - camera.location).to_track_quat('-Z', 'Y').to_euler()
            camera.data.ortho_scale = scale
            scene.render.filepath = str(out / (variant + '-' + view + '.png'))
            bpy.ops.render.render(write_still=True)
        export(scene, variant + '-assembled', selected + anchors)
        reports[variant] = {'sharedGeometrySha256': canonical_hash, 'sharedMeshes': len(shared),
                            'modules': families, 'meshes': len(selected),
                            'triangles': sum(len(p.vertices)-2 for o in selected for p in o.data.polygons)}
    canonical_export, _ = inspect_export(out / 'warden-shared-chassis.glb')
    if len(canonical_export) != len(shared):
        raise RuntimeError('Shared component export lost meshes.')
    verified = {}
    for variant in config['variants']:
        exported_shared, metadata = inspect_export(out / (variant + '-assembled.glb'))
        if exported_shared != canonical_export or metadata['sockets'] != ['socket_left_shoulder', 'socket_right_shoulder']:
            raise RuntimeError('Exported shared geometry, transforms or sockets differ.')
        if metadata['meshes'] != reports[variant]['meshes'] or metadata['triangles'] != reports[variant]['triangles']:
            raise RuntimeError('Exported assembly contains unexpected geometry.')
        verified[variant] = metadata
    (out / 'export-verification.json').write_text(json.dumps({'sharedMeshesIdentical': len(shared), 'variants': verified}, indent=2) + '\n')
    bpy.data.libraries.write(str(out / 'warden-modular-library.blend'), set(created[2:]))
    report = {'status': 'preview-unapproved', 'sources': config['sources'], 'variants': reports,
              'donorFit': fit_records, 'interface': config['interface'],
              'limitations': ['Inherited unresolved ankle/piston articulation', 'Cartridge seams not welded or closed',
                              'No muzzle anchors or runtime integration', 'No empty-mount cap', 'Source scale unnormalized']}
    (out / 'assembly-report.json').write_text(json.dumps(report, indent=2) + '\n')
finally:
    bpy.context.window.scene = previous
