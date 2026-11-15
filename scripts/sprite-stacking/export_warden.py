"""Bake Warden's retained GLBs to horizontal sprite slices; run inside Blender.

No polygon reduction, render capture or mesh data is used by the browser proof.
Blender supplies animation evaluation and BVH queries; the export is a sampled
solid volume, with one small top-down RGBA image per height layer.
"""

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


SOURCE_COMMIT = '9881bcfbc23d9fd1109f5f33609900ad9869ea17'
SOURCE_FILES = {
    'walk/chassis.glb': 'f261981a90ebc58da763f0a6804c2ed9654e85d25a90ca47fb99bcee3ba868a8',
    'walk/left-launcher.glb': 'd58c79e3c19439e26b2d29f06c1216813a5a620a79bf5ff6dcbfb23bde1bf5a3',
    'walk/right-launcher.glb': 'c572cb55b3ba79610dc28b3c1fdfe8ec105a6efc6e58abfd7d330bf0aa663581',
    'run/chassis.glb': '02eb6737ab81b267081d4e7507b173fdb9b53721374b23cbf19210800c4584e1',
    'run/left-launcher.glb': '243df07beb21c3f242daba579a4734a49ad4b5c33eebf8678b77d03f543aa005',
    'run/right-launcher.glb': '3f6d0b93b9dd8feb30c19343a5e5144f65a4b20a6b7d39d790540929a2aa0e96',
    'backward/chassis.glb': '866f151d3bfbb903bc0956ba91732cd35b336d35e65268b7bbd648de7caba155',
    'backward/left-launcher.glb': '4e9cf2bf55160493ad0f951a8e9c0cdae6c46484549581cbe5bfd708808f6e89',
    'backward/right-launcher.glb': 'b939fff5204a7423f234fd354b0ac5192e5596f1dcd1590f358fd158671f7a27',
}
PALETTE = [
    '#17252a', '#26383c', '#354a4b', '#475e5a', '#5c7468',
    '#748c78', '#92a28a', '#b2bca0', '#293038', '#414952',
    '#606a70', '#85908e', '#b3bdb0', '#16434c', '#36828b',
    '#81c8c3', '#b87c3c', '#e5b769',
]
RAMPS = {
    'armor': [1, 2, 3, 4, 5, 6, 7],
    'gun': [0, 8, 9, 10, 11, 12],
    'joint': [0, 8, 9, 10, 11],
    'launcher': [0, 8, 9, 10, 11, 12],
    'glass': [13, 14, 15],
}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path,
                        help='Directory containing walk/run/backward component packages from PR 67.')
    parser.add_argument('--output', required=True, type=Path, help='New output directory.')
    parser.add_argument('--samples', type=int, default=16)
    parser.add_argument('--motion', choices=('walk', 'run', 'backward'), action='append')
    parser.add_argument('--pixels-per-unit', type=int, default=96)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])


def ancestry(obj):
    result = []
    while obj is not None:
        result.append(obj.name)
        obj = obj.parent
    return result


def load_motion(source, motion):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    folder = source / motion
    package = json.loads((folder / 'package.json').read_text())
    bpy.ops.import_scene.gltf(filepath=str(folder / 'chassis.glb'))
    scene = bpy.context.scene
    scene.frame_set(0)
    bpy.context.view_layer.update()
    for side in ('left', 'right'):
        socket = scene.objects.get(f'socket_{side}_shoulder')
        if socket is None:
            raise ValueError(f'Missing {side} shoulder socket')
        bpy.ops.import_scene.gltf(filepath=str(folder / f'{side}-launcher.glb'))
        for obj in list(bpy.context.selected_objects):
            if obj.parent is None:
                local = obj.matrix_world.copy()
                obj.parent = socket
                obj.matrix_parent_inverse = Matrix.Identity(4)
                obj.matrix_basis = local
    bpy.context.view_layer.update()
    return scene, package


def material_kind(obj):
    names = ancestry(obj)
    if any('launcher_face' in name for name in names):
        return 'launcher'
    if any('rig_mount_' in name and '-gun' in name for name in names):
        return 'gun'
    if obj.name.startswith(('Cylinder', 'repair_')) and 'tripo_part' not in obj.name:
        return 'joint'
    return 'armor'


def sample_volume(objects, transform, args):
    size = 128
    pitch = 1 / args.pixels_per_unit
    half = size / 2
    # Sample the complete assembly together. Its generated mesh partitions are
    # often open individually; adjacent pieces close one another's surfaces.
    all_vertices = []
    all_triangles = []
    triangle_kinds = []
    kinds = ['armor', 'gun', 'joint', 'launcher']
    offset = 0
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        local = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get('co', local)
        local = local.reshape((-1, 3))
        matrix = np.array(transform @ obj.matrix_world)
        world = local @ matrix[:3, :3].T + matrix[:3, 3]
        if not np.isfinite(world).all():
            raise ValueError(f'Non-finite geometry in {obj.name}')
        triangles = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
        mesh.loop_triangles.foreach_get('vertices', triangles)
        all_vertices.extend(world.tolist())
        all_triangles.extend((triangles.reshape((-1, 3)) + offset).tolist())
        triangle_kinds.extend([kinds.index(material_kind(obj)) + 1] * len(mesh.loop_triangles))
        offset += len(local)
    vertices = np.array(all_vertices)
    tree = BVHTree.FromPolygons(all_vertices, all_triangles, all_triangles=True)
    prepared = [(objects[0], vertices, tree)]
    low = np.min(np.array([v.min(axis=0) for _, v, _ in prepared]), axis=0)
    high = np.max(np.array([v.max(axis=0) for _, v, _ in prepared]), axis=0)
    if max(abs(low[0]), abs(high[0]), abs(low[1]), abs(high[1])) >= half * pitch:
        raise ValueError(f'Footprint exceeds fixed sprite grid: {low}, {high}')
    z_min = math.floor(low[2] / pitch)
    z_max = math.ceil(high[2] / pitch)
    volume = np.zeros((z_max - z_min, size, size), dtype=np.uint8)
    odd_rays = 0
    ray_count = 0
    epsilon = pitch * 0.001
    direction = Vector((0, 1, 0))
    for obj, vertices, tree in prepared:
        bounds_low = vertices.min(axis=0)
        bounds_high = vertices.max(axis=0)
        x0 = max(0, math.floor(bounds_low[0] / pitch + half))
        x1 = min(size, math.ceil(bounds_high[0] / pitch + half))
        z0 = max(z_min, math.floor(bounds_low[2] / pitch))
        z1 = min(z_max, math.ceil(bounds_high[2] / pitch))
        for z in range(z0, z1):
            height = (z + 0.5) * pitch
            for x in range(x0, x1):
                lateral = (x - half + 0.5) * pitch
                cursor = float(bounds_low[1] - pitch)
                hits = []
                ray_count += 1
                # Skip coincident triangle hits; bound the walk for malformed meshes.
                for _ in range(128):
                    location, normal, _, _ = tree.ray_cast(Vector((lateral, cursor, height)), direction)
                    if location is None:
                        break
                    hits.append(float(location.y))
                    cursor = location.y + epsilon
                else:
                    raise ValueError(f'Unbounded surface crossings in {obj.name}')
                if not hits:
                    continue
                if len(hits) % 2:
                    odd_rays += 1
                    # Retain a one-voxel shell for open source surfaces. Do not
                    # fill unbounded space or bridge a missing partner surface.
                    hits.append(hits[-1] + pitch)
                for entry, exit_y in zip(hits[::2], hits[1::2]):
                    y0 = max(0, math.ceil(entry / pitch + half - 0.5))
                    y1 = min(size, math.floor(exit_y / pitch + half - 0.5) + 1)
                    if y0 >= y1:
                        # Sub-pixel details get their nearest representative voxel.
                        y0 = min(size - 1, max(0, round((entry + exit_y) / (2 * pitch) + half - 0.5)))
                        y1 = y0 + 1
                    for y in range(y0, y1):
                        point = Vector((lateral, (y - half + 0.5) * pitch, height))
                        _, normal, triangle, distance = tree.find_nearest(point)
                        if distance is None or normal is None or triangle is None:
                            raise ValueError(f'No nearest surface in {obj.name}')
                        slot = (z - z_min, y, x)
                        volume[slot] = triangle_kinds[triangle]
    # Surface normals from a small density neighborhood suppress sub-pixel
    # source scratches and prevent random nearest-triangle shading speckles.
    occupied = volume > 0
    density = np.zeros(volume.shape, dtype=np.float32)
    padded = np.pad(occupied.astype(np.float32), 1)
    for dz in range(3):
        for dy in range(3):
            for dx in range(3):
                density += padded[dz:dz + volume.shape[0], dy:dy + size, dx:dx + size]
    # One fixed resolution-dependent majority pass removes tiny isolated chips
    # and sampling cracks; it does not require component-level mesh editing.
    occupied = (occupied & (density >= 5)) | (density >= 22)
    density.fill(0)
    padded = np.pad(occupied.astype(np.float32), 1)
    for dz in range(3):
        for dy in range(3):
            for dx in range(3):
                density += padded[dz:dz + volume.shape[0], dy:dy + size, dx:dx + size]
    gz, gy, gx = np.gradient(density)
    length = np.maximum(0.001, np.sqrt(gx * gx + gy * gy + gz * gz))
    light = Vector((-0.45, -0.6, 1.0)).normalized()
    intensity = np.clip(0.48 - 0.46 * (gx * light.x + gy * light.y + gz * light.z) / length, 0, 0.999)
    colors = np.zeros(volume.shape, dtype=np.uint8)
    for code, kind in enumerate(kinds, start=1):
        ramp = np.array(RAMPS[kind])
        mask = occupied & ((volume == code) | ((volume == 0) & (code == 1)))
        colors[mask] = ramp[(intensity[mask] * len(ramp)).astype(np.int32)] + 1
    return colors, z_min, {'openSurfaceRays': odd_rays, 'sampledRays': ray_count,
                          'solidSampling': 'Combined-assembly BVH crossings'}


def save_atlas(output, name, volume, z_min):
    size = volume.shape[1]
    columns = 8
    rows = math.ceil(len(volume) / columns)
    palette = np.array([[int(color[i:i + 2], 16) for i in (1, 3, 5)] + [255] for color in PALETTE], dtype=np.uint8)
    colors = np.vstack([np.zeros((1, 4), dtype=np.uint8), palette])
    atlas = np.zeros((rows * size, columns * size, 4), dtype=np.uint8)
    for index, layer in enumerate(volume):
        row, column = divmod(index, columns)
        atlas[row * size:(row + 1) * size, column * size:(column + 1) * size] = colors[layer]
    # Blender's image API handles PNG encoding; no renderer is involved.
    image = bpy.data.images.new(name, width=atlas.shape[1], height=atlas.shape[0], alpha=True)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(np.flipud(atlas).astype(np.float32).ravel() / 255)
    image.file_format = 'PNG'
    image.filepath_raw = str(output / (name + '.png'))
    image.save()
    bpy.data.images.remove(image)
    return {'image': name + '.png', 'sliceCount': len(volume), 'zMin': z_min,
            'occupiedVoxels': int(np.count_nonzero(volume)),
            'sha256': hashlib.sha256((output / (name + '.png')).read_bytes()).hexdigest()}


def main():
    args = parse_args()
    if not 1 <= args.samples <= 64 or not 32 <= args.pixels_per_unit <= 128:
        raise ValueError('Samples must be 1..64; pixels-per-unit must be 32..128')
    args.source = args.source.resolve()
    args.output = args.output.resolve()
    motions = args.motion or ['walk', 'run', 'backward']
    for motion in motions:
        for name in ('chassis.glb', 'left-launcher.glb', 'right-launcher.glb'):
            relative = motion + '/' + name
            actual = hashlib.sha256((args.source / relative).read_bytes()).hexdigest()
            if actual != SOURCE_FILES[relative]:
                raise ValueError(f'Source does not match retained PR 67 checkpoint: {relative}')
    args.output.mkdir(parents=True, exist_ok=False)
    manifest = {'version': 1, 'grid': {'size': 128, 'columns': 8, 'pitch': 1 / args.pixels_per_unit},
                'source': {'commit': SOURCE_COMMIT, 'files': {}}, 'palette': PALETTE,
                'motions': {}, 'method': 'Horizontal solid sampling; fixed object-relative palette shading; Canvas2D slice runtime'}
    report = {'motions': {}, 'limits': [
        'Sampled open source surfaces keep a one-voxel shell; not a watertight mesh repair.',
        'Static torso omits source torso pitch/roll. Waist translation and bob follow sampled lower-body motion.',
        'Fixed gait cycles do not establish planted-foot turns, speed transitions or game integration.',
        'No runtime frame-time, GPU or crowd-performance claim.',
    ]}
    for motion in motions:
        scene, package = load_motion(args.source, motion)
        pelvis = scene.objects.get('rig_pelvis')
        torso = scene.objects.get('rig_torso')
        if pelvis is None or torso is None:
            raise ValueError('Missing approved torso/pelvis split')
        for name in ('chassis.glb', 'left-launcher.glb', 'right-launcher.glb'):
            relative = motion + '/' + name
            manifest['source']['files'][relative] = hashlib.sha256((args.source / relative).read_bytes()).hexdigest()
        if 'torso' not in manifest:
            upper = [obj for obj in scene.objects if obj.type == 'MESH' and 'rig_torso' in ancestry(obj)]
            volume, z_min, audit = sample_volume(upper, torso.matrix_world.inverted(), args)
            manifest['torso'] = save_atlas(args.output, 'torso', volume, z_min)
            report['torso'] = audit
            print('STACK_TORSO', manifest['torso'], flush=True)
        frames = []
        audits = []
        lower = [obj for obj in scene.objects if obj.type == 'MESH' and 'rig_torso' not in ancestry(obj)]
        for index in range(args.samples):
            started = time.monotonic()
            frame = package['duration'] * scene.render.fps / scene.render.fps_base * index / args.samples
            scene.frame_set(math.floor(frame), subframe=frame % 1)
            bpy.context.view_layer.update()
            root = pelvis.matrix_world.translation
            transform = Matrix.Translation(Vector((-root.x, -root.y, 0)))
            volume, z_min, audit = sample_volume(lower, transform, args)
            atlas = save_atlas(args.output, f'{motion}-{index:02}', volume, z_min)
            anchor = transform @ torso.matrix_world.translation
            frames.append({'atlas': atlas, 'anchor': {axis: float(anchor[i] * args.pixels_per_unit) for i, axis in enumerate(('x', 'y', 'z'))}})
            audits.append(audit)
            print('STACK_FRAME', motion, index, atlas['occupiedVoxels'], 'seconds', round(time.monotonic() - started, 2), flush=True)
        manifest['motions'][motion] = {'duration': package['duration'], 'frames': frames}
        report['motions'][motion] = audits
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (args.output / 'sampling-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('STACK_EXPORT_COMPLETE', args.output, flush=True)


if __name__ == '__main__':
    main()
