"""Conservative offline derivative. Requires bunx; pins glTF Transform CLI."""
from pathlib import Path
import subprocess,json,struct,hashlib,argparse
parser=argparse.ArgumentParser()
parser.add_argument('--under-20k',action='store_true',help='Aggressive separate candidate with a strict assembled triangle budget')
args=parser.parse_args()
ratio,error,lock=(0.06,1.0,False) if args.under_20k else (0.5,0.001,True)
root=Path(__file__).resolve().parents[2]
source=root/'design/mechs/generated/warden-components-v2'
out=root/'design/mechs/generated'/('warden-under20k-v1' if args.under_20k else 'warden-optimized-v1')
if out.exists():raise RuntimeError('Output exists')
out.mkdir()
report=[]
for file in sorted(source.glob('*.glb')):
    target=out/file.name
    subprocess.run(['bunx','@gltf-transform/cli@4.3.0','simplify',str(file),str(target),'--ratio',str(ratio),'--error',str(error),'--lock-border',str(lock).lower()],check=True)
    def stats(path):
        data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+length]);counts={}
        for node in doc.get('nodes',[]):
            if 'mesh' not in node:continue
            count=sum(doc['accessors'][p['indices']]['count']//3 for p in doc['meshes'][node['mesh']]['primitives'])
            counts[node['name'].removesuffix('__export')]=count
        return counts
    before=stats(file);after=stats(target)
    assert before.keys()==after.keys()
    report.append({'file':file.name,'sourceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytesBefore':file.stat().st_size,'bytesAfter':target.stat().st_size,'trianglesBefore':sum(before.values()),'trianglesAfter':sum(after.values())})
manifest=json.loads((source/'package.json').read_text())
# Preserve source transform oracle; use explicit derivative triangle expectations.
for file in out.glob('*.glb'):
    for name,count in stats(file).items():manifest['geometry'][name]={'triangles':count}
manifest['status']='simplified-candidate-owner-review-pending'
manifest['sourceGeometry']=json.loads((source/'package.json').read_text())['geometry']
(out/'package.json').write_text(json.dumps(manifest)+'\n')
(out/'optimization.json').write_text(json.dumps({'tool':'@gltf-transform/cli@4.3.0','ratio':ratio,'error':error,'lockBorder':lock,'files':report},indent=2)+'\n')

counts={item['file']:item['trianglesAfter'] for item in report}
totals={label:counts['chassis.glb']+counts['left-'+left+'.glb']+counts['right-'+right+'.glb'] for label,left,right in [('A','launcher','launcher'),('B','energy','energy'),('C','energy','launcher'),('empty','empty','empty')]}
(out/'triangle-budget.json').write_text(json.dumps(totals,indent=2)+'\n')
print(totals)
if args.under_20k and max(totals.values())>=20000:raise RuntimeError('Candidate exceeds requested triangle budget')
