"""Verify lossless Kestrel packaging against its material authoring export.

Resource indices may change during prune/dedup. Compare actual ordered triangle
position/normal/UV values, named graph bindings, animation samples and image bytes.
This does not establish player acceptance or hardware performance.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('kestrel_materials', Path(__file__).with_name('materialize-kestrel.py'))
materials = importlib.util.module_from_spec(spec)
spec.loader.exec_module(materials)


def inspect(path):
    document, binary = materials.glb.read_glb(path)
    nodes = document['nodes']
    names = [node.get('name') for node in nodes]
    if None in names or len(set(names)) != len(names):
        raise ValueError('Every packaged node must have a unique stable name')
    parents = {child: names[i] for i, node in enumerate(nodes) for child in node.get('children', [])}
    def binding(i, node):
        translation = node.get('translation', [0, 0, 0])
        if 'matrix' in node:
            matrix = node['matrix']
            identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            if any(value != identity[k] for k, value in enumerate(matrix) if k not in (12, 13, 14)):
                raise ValueError('Expected translation-only neutral mesh matrix')
            translation = matrix[12:15]
        return {'translation': translation, 'rotation': node.get('rotation', [0, 0, 0, 1]), 'scale': node.get('scale', [1, 1, 1]), 'extras': node.get('extras', {}), 'parent': parents.get(i), 'mesh': document['meshes'][node['mesh']]['name'] if 'mesh' in node else None}
    graph = {names[i]: binding(i, node) for i, node in enumerate(nodes)}
    shapes = {}
    triangle_count = 0
    for mesh in document['meshes']:
        primitives = []
        for primitive in mesh['primitives']:
            attributes = {key: materials.read_accessor(document, binary, index) for key, index in primitive['attributes'].items()}
            indices = materials.read_accessor(document, binary, primitive['indices'])
            triangle_count += len(indices) // 3
            digest = hashlib.sha256()
            for (index,) in indices:
                digest.update(json.dumps({key: values[index] for key, values in sorted(attributes.items())}, separators=(',', ':')).encode())
            primitives.append({'attributes': sorted(attributes), 'orderedTriangles': digest.hexdigest(), 'material': document['materials'][primitive['material']]['name']})
        shapes[mesh['name']] = primitives
    animations = {}
    for clip in document.get('animations', []):
        channels = []
        for channel in clip['channels']:
            sampler = clip['samplers'][channel['sampler']]
            channels.append({'node': names[channel['target']['node']], 'path': channel['target']['path'], 'interpolation': sampler.get('interpolation', 'LINEAR'), 'times': materials.read_accessor(document, binary, sampler['input']), 'values': materials.read_accessor(document, binary, sampler['output'])})
        animations[clip['name']] = {'extras': clip.get('extras'), 'channels': sorted(channels, key=lambda c: (c['node'], c['path']))}
    images = []
    for image in document.get('images', []):
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        images.append({'mimeType': image['mimeType'], 'sha256': hashlib.sha256(binary[start:start + view['byteLength']]).hexdigest()})
    # glTF Transform may omit explicit default values but must preserve sampling.
    sampler_defaults = {'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}
    samplers = [sampler_defaults | sampler for sampler in document.get('samplers', [])]
    normalized_materials = []
    for material in document['materials']:
        pbr = {'metallicFactor': 1, 'roughnessFactor': 1} | material.get('pbrMetallicRoughness', {})
        normalized_materials.append({'alphaMode': 'OPAQUE', 'doubleSided': False} | material | {'pbrMetallicRoughness': pbr})
    return {'graph': graph, 'meshes': shapes, 'animations': animations, 'images': images, 'samplers': samplers, 'materials': normalized_materials, 'textures': document.get('textures', []), 'triangles': triangle_count, 'meshSections': sum(len(m['primitives']) for m in document['meshes'])}


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('authoring', type=Path)
parser.add_argument('packaged', type=Path)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
expected = inspect(args.authoring)
actual = inspect(args.packaged)
differences = [key for key in expected if expected[key] != actual[key]]
if differences:
    raise ValueError('Packaged export differs: ' + ', '.join(differences))
report = {'schemaVersion': 1, 'status': 'passed', 'authoringSha256': hashlib.sha256(args.authoring.read_bytes()).hexdigest(), 'packagedSha256': hashlib.sha256(args.packaged.read_bytes()).hexdigest(), 'authoringBytes': args.authoring.stat().st_size, 'packagedBytes': args.packaged.stat().st_size, 'triangles': actual['triangles'], 'meshSections': actual['meshSections'], 'materials': len(actual['materials']), 'textures': len(actual['textures']), 'verified': ['Exact ordered triangle positions, normals and UVs', 'Named node graph, neutral transforms and anchors', 'Exact animation sample values and metadata', 'Exact embedded palette images, material and sampling definitions'], 'scope': 'Lossless packaging equivalence; inherits approved articulation geometry checks. No game or hardware acceptance.'}
if args.report.exists():
    raise ValueError('Choose a new report path')
args.report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
