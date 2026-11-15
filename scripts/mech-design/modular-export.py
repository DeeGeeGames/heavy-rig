"""Small GLB assembly helpers. Fingerprints resolve actual accessor/image bytes.

No Blender dependency: assembly edits preserve existing resources and node indices.
Only explicitly selected module nodes may change; animation targets remain stable.
"""
import copy
import hashlib
import json
import struct
from pathlib import Path


def digest(value):
    return hashlib.sha256(value).hexdigest()


def read_glb(path):
    data = path.read_bytes()
    magic, version, total = struct.unpack_from('<III', data)
    if (magic, version, total) != (0x46546c67, 2, len(data)):
        raise ValueError('Invalid GLB2')
    length, kind = struct.unpack_from('<II', data, 12)
    if kind != 0x4e4f534a:
        raise ValueError('Missing JSON chunk')
    document = json.loads(data[20:20+length])
    offset = 20+length
    length, kind = struct.unpack_from('<II', data, offset)
    if kind != 0x004e4942:
        raise ValueError('Missing binary chunk')
    return document, bytearray(data[offset+8:offset+8+length][:document['buffers'][0]['byteLength']])


def write_glb(path, document, binary):
    document = copy.deepcopy(document)
    document['buffers'] = [{'byteLength': len(binary)}]
    body = json.dumps(document, separators=(',', ':'), allow_nan=False).encode()
    body += b' ' * (-len(body) % 4)
    payload = bytes(binary) + b'\0' * (-len(binary) % 4)
    path.write_bytes(struct.pack('<III', 0x46546c67, 2, 28+len(body)+len(payload)) + struct.pack('<II', len(body), 0x4e4f534a) + body + struct.pack('<II', len(payload), 0x004e4942) + payload)


def fingerprint(document, binary, value):
    """Resolve resource references, so changed buffers cannot hide behind IDs."""
    def resolve(item, key=None):
        if key == 'bufferView' and isinstance(item, int):
            view = document['bufferViews'][item]
            start = view.get('byteOffset', 0)
            return {'layout': {k:v for k,v in view.items() if k not in ('buffer', 'byteOffset')}, 'bytes': digest(binary[start:start+view['byteLength']])}
        if isinstance(item, dict):
            return {k: resolve(v, k) for k,v in item.items()}
        if isinstance(item, list):
            return [resolve(v) for v in item]
        return item
    return digest(json.dumps(resolve(value), sort_keys=True, separators=(',', ':')).encode())


def reuse_fingerprints(document, binary, excluded):
    nodes = document['nodes']
    parents = {child:i for i,node in enumerate(nodes) for child in node.get('children', [])}
    def binding(index):
        node = nodes[index]
        return {k:v for k,v in node.items() if k != 'children'} | {'parent': parents.get(index)}
    geometry = {}
    for i,node in enumerate(nodes):
        if 'mesh' not in node or node['name'] in excluded:
            continue
        mesh = document['meshes'][node['mesh']]
        accessors = sorted({a for p in mesh['primitives'] for a in [*p['attributes'].values(), p['indices']]})
        geometry[node['name']] = fingerprint(document, binary, {'mesh':mesh, 'accessors':[document['accessors'][a] for a in accessors], 'binding':binding(i)})
    animations = document.get('animations', [])
    animation_accessors = sorted({s[k] for a in animations for s in a['samplers'] for k in ('input','output')})
    return {'geometryAndBindings':geometry, 'rigAndNeutralTransforms': fingerprint(document,binary,[binding(i) for i,n in enumerate(nodes) if n['name'].startswith('rig_')]), 'motion': fingerprint(document,binary,{'animations':animations,'accessors':[document['accessors'][a] for a in animation_accessors]}), 'materialsAndImages':fingerprint(document,binary,{k:document.get(k,[]) for k in ('materials','textures','images','samplers')})}


def append_accessor(document, binary, values, width, component=5126):
    binary.extend(b'\0' * (-len(binary) % 4))
    offset = len(binary)
    code = {5126:'f',5125:'I'}[component]
    flat = [v for row in values for v in row]
    binary.extend(struct.pack('<'+code*len(flat), *flat))
    view = len(document['bufferViews'])
    document['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(binary)-offset})
    a = {'bufferView':view,'componentType':component,'count':len(values),'type':{1:'SCALAR',3:'VEC3'}[width]}
    if width == 3:
        a.update(min=[min(row[k] for row in values) for k in range(width)],max=[max(row[k] for row in values) for k in range(width)])
    document['accessors'].append(a)
    return len(document['accessors'])-1


def verify_reuse(source, candidate, excluded):
    """Re-read both disk exports; do not trust a stored report or authoring scene."""
    reference, reference_bytes = read_glb(source)
    actual, actual_bytes = read_glb(candidate)
    expected = reuse_fingerprints(reference, reference_bytes, excluded)
    observed = reuse_fingerprints(actual, actual_bytes, excluded)
    if expected != observed:
        raise ValueError('Actual export shared geometry, bindings, rig, materials or motion diverged')
    return observed


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Compare shared resources in actual exports')
    parser.add_argument('source', type=Path)
    parser.add_argument('candidate', type=Path)
    parser.add_argument('--exclude', action='append', default=[])
    args = parser.parse_args()
    print(json.dumps(verify_reuse(args.source, args.candidate, set(args.exclude)), indent=2))
