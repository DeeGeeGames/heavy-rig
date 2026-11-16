"""Append measured Maul authoring locomotion to its approved rigid GLB.

Run inside background Blender. Geometry, neutral hierarchy and firing anchors
remain byte-for-byte unchanged; the output is a visual-review candidate.
"""

import argparse
import bisect
import hashlib
import json
import math
import sys
from pathlib import Path

from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent / 'blender'))
from optimization_io import blender_arguments, fresh_output, resolve_input
from rigid_packaging import read_glb, write_glb, local_matrix, accessor_values
from maul_motion import add_candidate_motions
from locomotion_trial import foot_path

APPROVED_SOURCE = '5860f1a6814c6c7da6ed5fb78a971de74b7e407a8cec11dad0c363a5a03cee41'


def graph(document):
    parents = {child: i for i, node in enumerate(document['nodes']) for child in node.get('children', [])}
    cache = {}
    def world(index):
        if index not in cache:
            own = local_matrix(document['nodes'][index])
            cache[index] = world(parents[index]) @ own if index in parents else own
        return cache[index]
    return parents, world


def validate_export(document, binary, analytical):
    """Evaluate written animation tracks rather than trusting solver reports."""
    nodes = document['nodes']
    names = {node.get('name'): i for i, node in enumerate(nodes)}
    parents, neutral_world = graph(document)
    soles = {}
    for side in ('left', 'right'):
        owner = names[f'rig_leg_{side}_foot']
        soles[side] = [(i, accessor_values(document, binary, primitive['attributes']['POSITION']))
                       for i, node in enumerate(nodes) if 'mesh' in node and parents.get(i) == owner
                       for primitive in document['meshes'][node['mesh']]['primitives']]
        if not soles[side]:
            raise ValueError('No actual foot geometry for ' + side)
    exits = [i for i, node in enumerate(nodes) if node.get('name', '').startswith('physical_exit_')]
    if len(exits) != 32:
        raise ValueError('Expected all 32 physical launcher exits')
    torso = names['rig_torso']
    neutral_exits = {i: neutral_world(torso).inverted() @ neutral_world(i).translation for i in exits}
    reports = {}
    for animation in document['animations']:
        if animation['name'] not in ('walk', 'run', 'backward'):
            continue
        curves = []
        for channel in animation['channels']:
            sampler = animation['samplers'][channel['sampler']]
            if sampler.get('interpolation', 'LINEAR') != 'LINEAR':
                raise ValueError('Expected linear animation')
            times = [row[0] for row in accessor_values(document, binary, sampler['input'])]
            values = accessor_values(document, binary, sampler['output'])
            curves.append((channel['target']['node'], channel['target']['path'], times, values))
        duration = curves[0][2][-1]
        minimum_floor, maximum_exit_error = math.inf, 0.
        maximum_loop_error, maximum_stance_slip = 0., 0.
        contacts = {}
        parameters = analytical[animation['name']]['parameters']
        endpoints = []
        # Four samples per authored key interval include interpolation artifacts.
        count = round(duration * 60) * 4
        for sample in range(count + 1):
            time = duration * sample / count
            transforms = [local_matrix(node) for node in nodes]
            for index, path, times, values in curves:
                left = min(len(times)-2, max(0, bisect.bisect_right(times, time)-1))
                fraction = (time-times[left]) / (times[left+1]-times[left])
                a, b = values[left], values[left+1]
                if path == 'translation':
                    transforms[index].translation = Vector(a).lerp(Vector(b), fraction)
                elif path == 'rotation':
                    q = Quaternion((a[3], a[0], a[1], a[2])).slerp(Quaternion((b[3], b[0], b[1], b[2])), fraction)
                    transforms[index] = Matrix.LocRotScale(transforms[index].translation, q, Vector((1, 1, 1)))
                else:
                    raise ValueError('Unexpected Maul animated path')
            world_cache = {}
            def world(index):
                if index not in world_cache:
                    world_cache[index] = world(parents[index]) @ transforms[index] if index in parents else transforms[index]
                return world_cache[index]
            for side in soles:
                for index, points in soles[side]:
                    minimum_floor = min(minimum_floor, min((world(index) @ Vector(p)).y for p in points))
                offset = 0. if side == 'left' else .5
                phase = time / duration
                stance = foot_path((phase + offset) % 1, parameters)[3]
                ankle = world(names[f'rig_leg_{side}_foot']).translation
                virtual = ankle + Vector((0, 0, parameters['travel'] * phase))
                key = (side, math.floor(phase + offset))
                if stance:
                    if key in contacts:
                        maximum_stance_slip = max(maximum_stance_slip, (virtual-contacts[key]).length)
                    else:
                        contacts[key] = virtual.copy()
            inverse_torso = world(torso).inverted()
            for index in exits:
                error = (inverse_torso @ world(index).translation - neutral_exits[index]).length
                maximum_exit_error = max(maximum_exit_error, error)
            if sample in (0, count):
                endpoints.append([world(i).copy() for i in range(len(nodes))])
            if any(not math.isfinite(value) for matrix in world_cache.values() for row in matrix for value in row):
                raise ValueError('Non-finite exported motion')
        for a, b in zip(*endpoints):
            maximum_loop_error = max(maximum_loop_error, max(abs(a[r][c]-b[r][c]) for r in range(4) for c in range(4)))
        if minimum_floor < -.0005 or maximum_exit_error > 1e-5 or maximum_loop_error > 1e-5 or maximum_stance_slip > .0005:
            raise ValueError(f'Failed exported motion {animation["name"]}: floor={minimum_floor}, exits={maximum_exit_error}, loop={maximum_loop_error}, stance={maximum_stance_slip}')
        reports[animation['name']] = {'samples': count+1, 'minimumFootHeight': minimum_floor,
                                      'maximumRigidExitError': maximum_exit_error, 'maximumLoopMatrixError': maximum_loop_error,
                                      'maximumVirtualStanceSlip': maximum_stance_slip}
    if set(reports) != {'walk', 'run', 'backward'}:
        raise ValueError('Incomplete locomotion clips')
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(blender_arguments())
    repo = args.repo.resolve()
    source = resolve_input(repo, args.input)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != APPROVED_SOURCE:
        raise ValueError('Maul articulation differs from the owner-approved revision')
    output = fresh_output(repo, args.output, directory=True)
    document, binary = read_glb(source)
    original_nodes = json.dumps(document['nodes'], sort_keys=True)
    original_meshes = json.dumps(document['meshes'], sort_keys=True)
    original_prefix = bytes(binary)
    parents, world = graph(document)
    basis_inverse = Matrix.Rotation(math.pi/2, 4, 'X')
    indices = {node['name']: i for i, node in enumerate(document['nodes']) if node.get('extras', {}).get('role') == 'rigid-motion-group'}
    rest = {name: basis_inverse @ world(index).translation for name, index in indices.items()}
    bindings = [{'node': node, 'owner': document['nodes'][parents[i]]['name'], 'matrix': world(i)}
                for i, node in enumerate(document['nodes']) if 'mesh' in node]
    document['animations'] = [clip for clip in document.get('animations', []) if clip['name'] == 'diagnostic-articulation']
    binary, analytical = add_candidate_motions(document, binary, indices, rest, bindings)
    if original_nodes != json.dumps(document['nodes'], sort_keys=True) or original_meshes != json.dumps(document['meshes'], sort_keys=True) or bytes(binary[:len(original_prefix)]) != original_prefix:
        raise ValueError('Locomotion changed neutral hierarchy or geometry')
    target = output / 'maul.glb'
    write_glb(target, document, binary)
    written, payload = read_glb(target)
    exported = validate_export(written, payload, analytical)
    report = {'status': 'locomotion-candidate-awaiting-visual-review', 'input': str(source.relative_to(repo)),
              'inputSha256': digest, 'candidateSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
              'candidateBytes': target.stat().st_size, 'restPivotsBlender': {name:list(pivot) for name,pivot in rest.items()},
              'analytical': analytical, 'actualExport': exported,
              'unchangedNeutralHierarchyAndGeometry': True,
              'authoringScripts': [{'path': str(path.relative_to(repo)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                                   for path in (Path(__file__).resolve(), Path(__file__).parent/'blender/maul_motion.py',
                                                Path(__file__).parent/'blender/locomotion_trial.py', Path(__file__).parent/'blender/rigid_packaging.py')],
              'scope': 'IK reach, virtual stance slip, actual foot floor, loop and rigid exits. Joint collisions, actuator stroke, visual feel and runtime gait remain separate review gates.'}
    (output / 'motion-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({'asset': str(target), 'sha256': report['candidateSha256'], 'actualExport': exported}))


if __name__ == '__main__':
    main()
