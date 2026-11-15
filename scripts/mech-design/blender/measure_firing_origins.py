"""Measure front-facing firing exits from an explicit, hashed Blender seed contract.

Run in a fresh Blender process with --repo PATH --seeds REPO_RELATIVE_JSON
--output NEW_JSON. Does not save or change source geometry. Seeds identify each
parent, mesh set and local search center; no chassis-specific names are assumed.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--seeds', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
if args.output.exists():
    raise RuntimeError('Preserve previous evidence; choose a new output path.')
seeds_path = args.repo / args.seeds
seeds = json.loads(seeds_path.read_text())
source = args.repo / seeds['source']['path']
if hashlib.sha256(source.read_bytes()).hexdigest() != seeds['source']['sha256']:
    raise RuntimeError('Source hash mismatch.')
if any(o.type == 'MESH' and o.name != 'Cube' for o in bpy.data.objects):
    raise RuntimeError('Use a fresh Blender process.')


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Expected finite number.')
    return value


radial_start = finite(seeds['radialStart'])
offset = finite(seeds['surfaceOffset'])
radial_samples = seeds['radialSamples']
depth_samples = seeds['depthSamples']
if radial_start <= 0 or offset <= 0 or not isinstance(radial_samples, int) or radial_samples < 8 or not isinstance(depth_samples, int) or depth_samples < 8:
    raise ValueError('Invalid measurement resolution or offset.')
with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
    if seeds['scene'] not in available.scenes:
        raise RuntimeError('Seed scene missing.')
    loaded.scenes = [seeds['scene']]
scene = loaded.scenes[0]
bpy.context.window.scene = scene
scene.frame_set(1)
bpy.context.view_layer.update()
origins = []
ids = set()
for spec in seeds['origins']:
    if not isinstance(spec['id'], str) or spec['id'] in ids:
        raise ValueError('Expected unique origin ID.')
    ids.add(spec['id'])
    parent = scene.objects[spec['parent']]
    if len(spec['seedLocal']) != 3:
        raise ValueError('Expected three local seed coordinates.')
    cx, _, cz = [finite(v) for v in spec['seedLocal']]
    search_radius = finite(spec['searchRadius'])
    if search_radius <= radial_start:
        raise ValueError('Search radius must exceed radial start.')
    vertices, faces = [], []
    for name in spec['meshes']:
        obj = scene.objects[name]
        if obj.type != 'MESH' or obj.modifiers:
            raise RuntimeError('Measurement requires explicit mesh geometry without unevaluated modifiers.')
        transform = parent.matrix_world.inverted() @ obj.matrix_world
        base = len(vertices)
        vertices.extend(transform @ v.co for v in obj.data.vertices)
        faces.extend(tuple(base + i for i in polygon.vertices) for polygon in obj.data.polygons)
    if not vertices or not faces:
        raise RuntimeError('Empty measurement geometry.')
    tree = BVHTree.FromPolygons(vertices, faces)
    front = min(v.y for v in vertices) - .01
    rim = []
    for angle in np.linspace(0, 2 * np.pi, radial_samples, endpoint=False):
        profile = []
        for radius in np.linspace(radial_start, search_radius, depth_samples):
            x = cx + float(np.cos(angle) * radius)
            z = cz + float(np.sin(angle) * radius)
            hit = tree.ray_cast(Vector((x, front, z)), Vector((0, 1, 0)))
            if hit[0] is not None:
                profile.append((hit[0].y, x, z, float(radius)))
        if not profile:
            raise RuntimeError('A radial profile missed the measured surface.')
        rim.append(min(profile))
    points = np.array([[p[1], p[2]] for p in rim])
    a = np.column_stack([2 * points[:, 0], 2 * points[:, 1], np.ones(len(points))])
    fit, _, rank, _ = np.linalg.lstsq(a, np.sum(points * points, axis=1), rcond=None)
    if rank != 3:
        raise RuntimeError('Degenerate lip-circle fit.')
    center = fit[:2]
    radius = float(np.sqrt(fit[2] + np.sum(center * center)))
    finite(radius)
    depths = [p[0] for p in rim]
    origin = Vector((float(center[0]), min(depths) - offset, float(center[1])))
    hits = []
    for dx, dz in [(0, 0), (.001, 0), (-.001, 0), (0, .001), (0, -.001)]:
        hit = tree.ray_cast(origin + Vector((dx, 0, dz)), Vector((0, -1, 0)), 2)
        if hit[0] is not None:
            hits.append(list(hit[0]))
    entry = {'id': spec['id'], 'parent': spec['parent'], 'local': list(origin),
             'direction': [0, -1, 0], 'lipDepthRange': [min(depths), max(depths)],
             'lipRadius': radius, 'radialRms': float(np.sqrt(np.mean((np.linalg.norm(points-center, axis=1)-radius)**2))),
             'radialSamples': len(rim), 'selfExitRayHits': hits}
    if 'physicalTube' in spec:
        entry['physicalTube'] = spec['physicalTube']
    origins.append(entry)
report = {'status': 'measured-review-pending', 'sourceSha256': seeds['source']['sha256'],
          'seedSha256': hashlib.sha256(seeds_path.read_bytes()).hexdigest(),
          'coordinates': seeds['coordinates'], 'surfaceOffset': offset,
          'method': 'Radial front-surface profiles locate surrounding lips; least-squares XZ circle gives center and frontmost measured lip Y minus outward offset gives exit plane. Sampled mesh geometry is not an analytic bore definition. Five outgoing self-rays per exit; assembly rays and visual review are separate.',
          'origins': origins}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'origins': len(origins), 'selfExitRayHits': sum(len(o['selfExitRayHits']) for o in origins)}))
