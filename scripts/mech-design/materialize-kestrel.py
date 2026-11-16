"""Apply a measured palette to the approved Kestrel without changing its shape.

Source-specific assignments are recipe data, not an automatic texturing system.
Only UVs, palette resources and duplicated vertices at palette boundaries change.
The output is deliberately uncompressed; package-optimized-glb.py removes unused
authoring buffers and validates the final self-contained GLB.
"""
import argparse
import copy
import hashlib
import importlib.util
import itertools
import json
import math
import struct
import sys
import zlib
from collections import Counter, defaultdict
from pathlib import Path

spec = importlib.util.spec_from_file_location("modular_export", Path(__file__).with_name("modular-export.py"))
glb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(glb)
sys.path.insert(0, str(Path(__file__).resolve().parent / 'blender'))
from optimization_io import fresh_output


def read_accessor(document, binary, index):
    accessor = document['accessors'][index]
    if accessor.get('sparse') or accessor.get('normalized'):
        raise ValueError('Authoring input must use explicit unnormalized accessors')
    view = document['bufferViews'][accessor['bufferView']]
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[accessor['type']]
    code, size = {5121: ('B', 1), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}[accessor['componentType']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    stride = view.get('byteStride', width * size)
    return [struct.unpack_from('<' + code * width, binary, start + i * stride) for i in range(accessor['count'])]


def append(document, binary, rows, width, code='f'):
    binary.extend(b'\0' * (-len(binary) % 4))
    start = len(binary)
    for row in rows:
        binary.extend(struct.pack('<' + code * width, *row))
    view = len(document['bufferViews'])
    document['bufferViews'].append({'buffer': 0, 'byteOffset': start, 'byteLength': len(binary) - start})
    accessor = {'bufferView': view, 'componentType': {'f': 5126, 'I': 5125}[code], 'count': len(rows), 'type': {1: 'SCALAR', 2: 'VEC2', 3: 'VEC3'}[width]}
    if width == 3:
        accessor.update(min=[min(row[k] for row in rows) for k in range(width)], max=[max(row[k] for row in rows) for k in range(width)])
    document['accessors'].append(accessor)
    return len(document['accessors']) - 1


def palette_png(colors):
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    pixels = b'\0' + bytes(v for color in colors for v in color)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', len(colors), 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels, 9)) + chunk(b'IEND', b'')


def translations(document):
    parents = {child: i for i, node in enumerate(document['nodes']) for child in node.get('children', [])}
    def total(index):
        node = document['nodes'][index]
        if 'rotation' in node or 'scale' in node:
            raise ValueError('Expected approved neutral translation-only graph')
        matrix = node.get('matrix')
        if matrix is not None and [v for i, v in enumerate(matrix) if i not in (12, 13, 14)] != [v for i, v in enumerate([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) if i not in (12, 13, 14)]:
            raise ValueError('Expected neutral mesh matrix to contain only translation')
        local = matrix[12:15] if matrix is not None else node.get('translation', [0, 0, 0])
        inherited = total(parents[index]) if index in parents else [0, 0, 0]
        return tuple(a + b for a, b in zip(local, inherited))
    return {node['mesh']: total(i) for i, node in enumerate(document['nodes']) if 'mesh' in node}


def shape_fingerprint(document, binary):
    result = []
    for mesh in document['meshes']:
        for primitive in mesh['primitives']:
            positions = read_accessor(document, binary, primitive['attributes']['POSITION'])
            normals = read_accessor(document, binary, primitive['attributes']['NORMAL'])
            indices = read_accessor(document, binary, primitive['indices'])
            # Ordered triangle positions and normals, independent of vertex reuse.
            digest = hashlib.sha256()
            for (index,) in indices:
                digest.update(struct.pack('<6f', *positions[index], *normals[index]))
            result.append(digest.hexdigest())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    recipe_path = repo / args.recipe
    recipe = json.loads(recipe_path.read_text())
    output = fresh_output(repo, args.output, directory=True)
    inputs = {}
    for key, item in recipe['inputs'].items():
        path = repo / item['path']
        if glb.digest(path.read_bytes()) != item['sha256']:
            raise ValueError(f'Input hash differs: {key}')
        inputs[key] = path
    document, binary = glb.read_glb(inputs['articulation'])
    original = copy.deepcopy(document)
    original_binary = bytes(binary)
    source, source_binary = glb.read_glb(inputs['source'])
    inventory = json.loads(inputs['inventory'].read_text())
    repair = json.loads(inputs['repair'].read_text())
    positions = read_accessor(source, source_binary, source['meshes'][0]['primitives'][0]['attributes']['POSITION'])
    vertex_parts = {v: part['id'] for part in inventory['components'] for v in part['vertices']}
    component_ids = {part['id'] for part in inventory['components']}
    if not set(recipe['componentRoles']).issubset(component_ids):
        raise ValueError('Material recipe references unknown source components')
    if set(vertex_parts) != set(range(len(positions))):
        raise ValueError('Frozen source inventory must account for every raw vertex')
    cells = defaultdict(list)
    cell_size, tolerance = 1e-6, 2e-7
    cell = lambda p: tuple(math.floor(v / cell_size) for v in p)
    for i, position in enumerate(positions):
        cells[cell(position)].append(i)
    def source_vertex(position):
        center = cell(position)
        candidates = (i for delta in itertools.product((-1, 0, 1), repeat=3) for i in cells.get(tuple(a + b for a, b in zip(center, delta)), []))
        nearby = [(sum((a - b) ** 2 for a, b in zip(position, positions[i])), i) for i in candidates]
        distance, index = min(nearby, default=(math.inf, -1))
        return index if distance <= tolerance ** 2 else -1
    palette = recipe['palette']
    roles = list(palette)
    atlas_width = 2 ** math.ceil(math.log2(len(roles)))
    offsets = translations(document)
    classified, component_counts = Counter(), Counter()
    source_face_roles = {tuple(sorted(face['vertices'])): face['role'] for face in recipe.get('sourceFaceOverrides', [])}
    raw_indices = [row[0] for row in read_accessor(source, source_binary, source['meshes'][0]['primitives'][0]['indices'])]
    raw_faces = {tuple(sorted(raw_indices[i:i + 3])) for i in range(0, len(raw_indices), 3)}
    if not set(source_face_roles).issubset(raw_faces) or len(source_face_roles) != len(recipe.get('sourceFaceOverrides', [])):
        raise ValueError('Face overrides must reference unique actual raw triangles')
    applied_overrides = Counter()
    component_bounds = {part['id']: part for part in inventory['components']}
    for mesh_index, mesh in enumerate(document['meshes']):
        for primitive in mesh['primitives']:
            if set(primitive['attributes']) != {'POSITION', 'NORMAL'}:
                raise ValueError('Unexpected authoring attributes')
            old_positions = read_accessor(document, binary, primitive['attributes']['POSITION'])
            old_normals = read_accessor(document, binary, primitive['attributes']['NORMAL'])
            indices = [row[0] for row in read_accessor(document, binary, primitive['indices'])]
            world = [tuple(a + b for a, b in zip(p, offsets[mesh_index])) for p in old_positions]
            matched = [source_vertex(p) for p in world]
            out_positions, out_normals, uvs, out_indices = [], [], [], []
            reused = {}
            for start in range(0, len(indices), 3):
                triangle = indices[start:start + 3]
                ids = [matched[i] for i in triangle]
                parts = Counter(vertex_parts[i] for i in ids if i >= 0)
                component, count = parts.most_common(1)[0] if parts else (None, 0)
                role = recipe['componentRoles'].get(component, recipe['defaultRole']) if count >= 2 else recipe['newGeometryRole']
                override = source_face_roles.get(tuple(sorted(ids)))
                if override is not None:
                    role = override
                    applied_overrides[tuple(sorted(ids))] += 1
                # Real bores remain dark inside; outer tubes and front annuli are steel.
                centroid = [sum(world[i][axis] for i in triangle) / 3 for axis in range(3)]
                for side in repair['barrels'].values():
                    for barrel in side:
                        x, minus_z, y = barrel['center']
                        forward = -minus_z
                        back = -component_bounds[barrel['sourceComponent']]['worldMaximum'][1]
                        radial = math.hypot(centroid[0] - x, centroid[1] - y)
                        if radial < barrel['outerRadius'] * 1.01 and back - 1e-7 <= centroid[2] <= forward + 1e-7:
                            inside = radial < barrel['innerRadius'] * 1.01 and forward - barrel['depth'] - 1e-7 <= centroid[2] < forward - 1e-6
                            role = 'bore' if inside else 'steel'
                if role not in palette:
                    raise ValueError(f'Unknown palette role {role}')
                classified[role] += 1
                component_counts[component or 'new'] += 1
                role_index = roles.index(role)
                for index in triangle:
                    key = (index, role_index)
                    if key not in reused:
                        reused[key] = len(out_positions)
                        out_positions.append(old_positions[index])
                        out_normals.append(old_normals[index])
                        uvs.append(((role_index + 0.5) / atlas_width, 0.5))
                    out_indices.append((reused[key],))
            primitive['attributes'] = {'POSITION': append(document, binary, out_positions, 3), 'NORMAL': append(document, binary, out_normals, 3), 'TEXCOORD_0': append(document, binary, uvs, 2)}
            primitive['indices'] = append(document, binary, out_indices, 1, 'I')
            primitive['material'] = 0
    if set(applied_overrides) != set(source_face_roles) or any(count != 1 for count in applied_overrides.values()):
        raise ValueError('Every cockpit/source-face override must apply to exactly one retained triangle')
    document['images'], document['textures'] = [], []
    document['samplers'] = [{'magFilter': 9728, 'minFilter': 9728, 'wrapS': 33071, 'wrapT': 33071}]
    for name, colors in [('base-color', [v['color'] for v in palette.values()]), ('metallic-roughness', [[255, round(v['roughness'] * 255), round(v['metallic'] * 255)] for v in palette.values()])]:
        colors += [colors[-1]] * (atlas_width - len(colors))
        png = palette_png(colors)
        binary.extend(b'\0' * (-len(binary) % 4))
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(png)})
        binary.extend(png)
        image = len(document['images'])
        document['images'].append({'name': f'kestrel-{name}', 'bufferView': view, 'mimeType': 'image/png'})
        document['textures'].append({'source': image, 'sampler': 0})
    document['materials'] = [{'name': 'kestrel-concept-palette', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicRoughnessTexture': {'index': 1}, 'metallicFactor': 1, 'roughnessFactor': 1}, 'alphaMode': 'OPAQUE', 'doubleSided': False}]
    before = shape_fingerprint(original, original_binary)
    if before != shape_fingerprint(document, binary) or document['nodes'] != original['nodes'] or document.get('animations') != original.get('animations'):
        raise ValueError('Material assignment changed geometry, normals, graph or animations')
    # Appending resources must also leave all original animation bytes intact.
    if bytes(binary[:len(original_binary)]) != original_binary:
        raise ValueError('Material assignment overwrote source buffers')
    asset = output / 'kestrel.glb'
    glb.write_glb(asset, document, binary)
    reread, payload = glb.read_glb(asset)
    if shape_fingerprint(reread, payload) != before:
        raise ValueError('Written GLB shape differs')
    report = {'schemaVersion': 1, 'status': 'material-candidate-pending-owner-review', 'sourceSha256': recipe['inputs']['articulation']['sha256'], 'recipeSha256': glb.digest(recipe_path.read_bytes()), 'authoringScriptSha256': glb.digest(Path(__file__).read_bytes()), 'candidateSha256': glb.digest(asset.read_bytes()), 'candidateBytes': asset.stat().st_size, 'triangles': sum(classified.values()), 'meshSections': len(document['meshes']), 'materials': 1, 'textures': 2, 'textureSize': [atlas_width, 1], 'triangleRoles': dict(classified), 'faceOverridesApplied': len(applied_overrides), 'exactOrderedTrianglePositionNormalFingerprints': before, 'unchangedNodesAndAnimations': True, 'originalBufferPrefixUnchanged': True, 'notes': ['Opaque tinted cockpit; no transmission, extra transparent pass or new geometry.', 'Palette classification is specific to this approved source; no paid texturing operations.']}
    (output / 'material-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ('candidateSha256', 'triangles', 'meshSections', 'triangleRoles')}))


if __name__ == '__main__':
    main()
