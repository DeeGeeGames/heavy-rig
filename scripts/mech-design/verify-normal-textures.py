"""Validate embedded normal-map payloads and tangent/UV attributes in component GLBs."""
import io,json,struct,sys
from pathlib import Path
from PIL import Image
folder=Path(sys.argv[1]);results=[]
for path in sorted(folder.glob('*.glb')):
    raw=path.read_bytes();json_length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+json_length]);binary=raw[28+json_length:]
    normal_primitives=0;images=set()
    for mesh in doc.get('meshes',[]):
        for primitive in mesh['primitives']:
            material=doc['materials'][primitive['material']]
            normal=material.get('normalTexture')
            if normal is None:
                assert material.get('name','').startswith('Geometry_only_'),f'{path.name}: unexpected missing normal texture'
                continue
            attrs=primitive['attributes']
            assert 'TEXCOORD_0' in attrs and 'TANGENT' in attrs,(path.name,attrs.keys())
            assert doc['accessors'][attrs['TANGENT']]['count']==doc['accessors'][attrs['POSITION']]['count']
            images.add(doc['textures'][normal['index']]['source']);normal_primitives+=1
    for index in images:
        source=doc['images'][index];view=doc['bufferViews'][source['bufferView']]
        start=view.get('byteOffset',0);payload=binary[start:start+view['byteLength']]
        image=Image.open(io.BytesIO(payload));image.verify()
    results.append({'file':path.name,'normalMappedPrimitives':normal_primitives,'embeddedImages':len(images)})
assert len(results)==7,'Expected shared chassis plus six cartridges'
(folder/'texture-validation.json').write_text(json.dumps({'status':'passed','scope':'PNG payload decoding, normal texture binding, UV and tangent presence; not GPU shading','files':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
