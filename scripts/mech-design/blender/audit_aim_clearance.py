"""Sample approved weapon assemblies against lower-body geometry during torso yaw.

Read-only source audit; outputs candidate evidence, never approval. Run with
--repo PATH --motion walk|run|backward --output NEW_JSON in a fresh Blender.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path, required=True)
parser.add_argument('--motion', choices=['walk', 'run', 'backward'], required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
if args.output.exists():
    raise RuntimeError('Preserve previous evidence; choose a new output.')
record = json.loads((args.repo / 'design/mechs/chassis/warden/approved-locomotion.json').read_text())['motions'][args.motion]['artifacts']['motion.blend']
source = args.repo / record['path']
if hashlib.sha256(source.read_bytes()).hexdigest() != record['sha256']:
    raise RuntimeError('Approved source hash mismatch.')
with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
    loaded.scenes = available.scenes
scene = loaded.scenes[0]
bpy.context.window.scene = scene

def belongs(obj, name):
    while obj:
        if obj.name == name:
            return True
        obj = obj.parent
    return False

def mesh_data(objects):
    vertices, faces, owners = [], [], []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        offset = len(vertices)
        vertices.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
        for triangle in mesh.loop_triangles:
            faces.append(tuple(offset + i for i in triangle.vertices))
            owners.append(obj.name)
        evaluated.to_mesh_clear()
    return vertices, faces, owners

weapons = [o for o in scene.objects if o.type == 'MESH' and any(belongs(o, 'rig_mount_' + side + mount) for side in ['left', 'right'] for mount in ['-gun', '-shoulder bank'])]
lower = [o for o in scene.objects if o.type == 'MESH' and not belongs(o, 'rig_torso')]
torso = scene.objects['rig_torso']
findings = []
samples = 0
# Mechanical torso-local swivel only. Runtime also has independent weapon
# yaw/pitch and stabilized headings; this audit does not close that gate.
frames = sorted(set(round(scene.frame_start + (scene.frame_end-scene.frame_start)*i/8) for i in range(9)))
for frame in frames:
    scene.frame_set(frame)
    bpy.context.view_layer.update()
    original = torso.matrix_basis.copy()
    lv, lf, lo = mesh_data(lower)
    lower_tree = BVHTree.FromPolygons(lv, lf, all_triangles=True)
    for degrees in range(-180, 180, 5):
        torso.matrix_basis = original @ Matrix.Rotation(math.radians(degrees), 4, 'Z')
        bpy.context.view_layer.update()
        wv, wf, wo = mesh_data(weapons)
        overlaps = BVHTree.FromPolygons(wv, wf, all_triangles=True).overlap(lower_tree)
        pairs = sorted(set((wo[a], lo[b]) for a,b in overlaps))
        if pairs:
            findings.append({'frame': frame, 'yawDegrees': degrees, 'pairs': pairs, 'trianglePairs': len(overlaps)})
        samples += 1
    torso.matrix_basis = original
report = {'status': 'intersections-found' if findings else 'sampled-clear', 'sourceSha256': record['sha256'], 'motion': args.motion, 'scope': 'Gun and shoulder assembly surfaces versus lower body; 5-degree torso-local yaw steps at nine gait phases. Surface intersection sampling is not a continuous clearance proof. Independent weapon yaw/pitch, runtime heading stabilization and firing exits require separate validation. All shoulder module alternatives are included.', 'samples': samples, 'findings': findings}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'status':report['status'],'samples':samples,'findings':len(findings)}))
