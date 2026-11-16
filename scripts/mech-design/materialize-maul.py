"""Apply the source-reviewed Maul palette while preserving geometry and motion.

The shared palette/accessor helpers provide storage only. Component roles and
new launcher-surface classification belong to this exact Maul recipe.
"""
import argparse
import copy
import importlib.util
import itertools
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

spec = importlib.util.spec_from_file_location('palette_helpers', Path(__file__).with_name('materialize-kestrel.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve()
    recipe_path = repo / args.recipe
    recipe = json.loads(recipe_path.read_text())
    output = helper.fresh_output(repo, args.output, directory=True)
    inputs = {}
    for name, record in recipe['inputs'].items():
        path = repo / record['path']
        if helper.glb.digest(path.read_bytes()) != record['sha256']:
            raise ValueError('Changed Maul material input: ' + name)
        inputs[name] = path
    document, binary = helper.glb.read_glb(inputs['articulation'])
    original, original_binary = copy.deepcopy(document), bytes(binary)
    source, source_binary = helper.glb.read_glb(inputs['source'])
    inventory = json.loads(inputs['inventory'].read_text())
    source_positions = helper.read_accessor(source, source_binary, source['meshes'][0]['primitives'][0]['attributes']['POSITION'])
    vertex_parts = {v: component['id'] for component in inventory['components'] for v in component['vertices']}
    if set(recipe['componentRoles']) != {component['id'] for component in inventory['components']}:
        raise ValueError('Every source component needs an explicit material role')
    if set(vertex_parts) != set(range(len(source_positions))):
        raise ValueError('Incomplete source vertex inventory')
    cells = defaultdict(list)
    cell_size = 1e-6
    cell = lambda p: tuple(math.floor(value / cell_size) for value in p)
    for index, position in enumerate(source_positions):
        cells[cell(position)].append(index)

    def match(position):
        center = cell(position)
        candidates = (index for delta in itertools.product((-1, 0, 1), repeat=3)
                      for index in cells.get(tuple(a+b for a,b in zip(center,delta)), []))
        distance, index = min(((sum((a-b)**2 for a,b in zip(position,source_positions[index])),index)
                               for index in candidates), default=(math.inf,-1))
        return index if distance <= (2e-7)**2 else -1

    palette = recipe['palette']
    roles = list(palette)
    atlas_width = 2**math.ceil(math.log2(len(roles)))
    offsets = helper.translations(document)
    classifications, applied_overrides = Counter(), Counter()
    overrides = {tuple(sorted(record['vertices'])): record['role'] for record in recipe['sourceFaceOverrides']}
    source_indices = [row[0] for row in helper.read_accessor(source, source_binary, source['meshes'][0]['primitives'][0]['indices'])]
    source_faces = {tuple(sorted(source_indices[i:i+3])) for i in range(0,len(source_indices),3)}
    if not set(overrides).issubset(source_faces) or len(overrides)!=len(recipe['sourceFaceOverrides']):
        raise ValueError('Invalid or repeated source face override')
    for mesh_index, mesh in enumerate(document['meshes']):
        for primitive in mesh['primitives']:
            if set(primitive['attributes']) != {'POSITION','NORMAL'}:
                raise ValueError('Unexpected Maul authoring attributes')
            positions = helper.read_accessor(document,binary,primitive['attributes']['POSITION'])
            normals = helper.read_accessor(document,binary,primitive['attributes']['NORMAL'])
            indices = [row[0] for row in helper.read_accessor(document,binary,primitive['indices'])]
            world = [tuple(a+b for a,b in zip(position,offsets[mesh_index])) for position in positions]
            matched = [match(position) for position in world]
            out_positions, out_normals, uvs, out_indices = [],[],[],[]
            reused = {}
            for start in range(0,len(indices),3):
                triangle = indices[start:start+3]
                ids = [matched[index] for index in triangle]
                parts = Counter(vertex_parts[index] for index in ids if index>=0)
                component,count = parts.most_common(1)[0] if parts else (None,0)
                role = recipe['componentRoles'][component] if count>=2 else 'mechanism'
                override = overrides.get(tuple(sorted(ids)))
                if override is not None:
                    role = override
                    applied_overrides[tuple(sorted(ids))] += 1
                if count<2 and 'mount_' in mesh['name']:
                    centroid = [sum(world[index][axis] for index in triangle)/3 for axis in range(3)]
                    settings = recipe['launcher']
                    centers = [(sign*settings['centerX']+(column-1.5)*settings['pitch'],
                                settings['centerZ']+(row-1.5)*settings['pitch'])
                               for sign in (-1,1) for row in range(4) for column in range(4)]
                    radius = min(math.hypot(centroid[0]-x,centroid[1]-z) for x,z in centers)
                    front = -settings['frontY']
                    inside = radius < settings['radius']*1.01 and front-settings['boreDepth']-1e-6 <= centroid[2] < front-1e-6
                    role = 'bore' if inside else 'armor'
                if role not in palette:
                    raise ValueError('Unknown Maul palette role '+role)
                classifications[role] += 1
                role_index = roles.index(role)
                for index in triangle:
                    key = (index,role_index)
                    if key not in reused:
                        reused[key] = len(out_positions)
                        out_positions.append(positions[index])
                        out_normals.append(normals[index])
                        uvs.append(((role_index+.5)/atlas_width,.5))
                    out_indices.append((reused[key],))
            primitive['attributes'] = {'POSITION':helper.append(document,binary,out_positions,3),
                                       'NORMAL':helper.append(document,binary,out_normals,3),
                                       'TEXCOORD_0':helper.append(document,binary,uvs,2)}
            primitive['indices'] = helper.append(document,binary,out_indices,1,'I')
            primitive['material'] = 0
    if set(applied_overrides)!=set(overrides) or any(count!=1 for count in applied_overrides.values()):
        raise ValueError('Every reviewed face override must apply exactly once')
    document['images'],document['textures'] = [],[]
    document['samplers'] = [{'magFilter':9728,'minFilter':9728,'wrapS':33071,'wrapT':33071}]
    for name,colors in [('base-color',[role['color'] for role in palette.values()]),
                        ('metallic-roughness',[[255,round(role['roughness']*255),round(role['metallic']*255)] for role in palette.values()])]:
        colors += [colors[-1]]*(atlas_width-len(colors))
        png = helper.palette_png(colors)
        binary.extend(b'\0'*(-len(binary)%4))
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(png)})
        binary.extend(png)
        image = len(document['images'])
        document['images'].append({'name':'maul-'+name,'bufferView':view,'mimeType':'image/png'})
        document['textures'].append({'source':image,'sampler':0})
    document['materials'] = [{'name':'maul-concept-palette','pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':1},'metallicFactor':1,'roughnessFactor':1},'alphaMode':'OPAQUE','doubleSided':False}]
    fingerprints = helper.shape_fingerprint(original,original_binary)
    if helper.shape_fingerprint(document,binary)!=fingerprints or document['nodes']!=original['nodes'] or document.get('animations')!=original.get('animations'):
        raise ValueError('Maul material assignment changed geometry, graph or motion')
    if bytes(binary[:len(original_binary)])!=original_binary:
        raise ValueError('Maul material pass overwrote original bytes')
    target = output/'maul.glb'
    helper.glb.write_glb(target,document,binary)
    exported,buffer = helper.glb.read_glb(target)
    if helper.shape_fingerprint(exported,buffer)!=fingerprints:
        raise ValueError('Written Maul geometry differs')
    report = {'status':'material-candidate-pending-owner-review','candidateSha256':helper.glb.digest(target.read_bytes()),'recipeSha256':helper.glb.digest(recipe_path.read_bytes()),'triangles':sum(classifications.values()),'meshSections':len(document['meshes']),'materials':1,'textures':2,'textureSize':[atlas_width,1],'triangleRoles':dict(classifications),'faceOverridesApplied':len(applied_overrides),'exactOrderedTrianglePositionNormalFingerprints':fingerprints,'unchangedNodesAndAnimations':True,'originalBufferPrefixUnchanged':True}
    (output/'material-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':
    main()
