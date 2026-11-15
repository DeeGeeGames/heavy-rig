"""Bounded selected-P2 module proof; never writes outside a fresh generated folder."""
import argparse
import copy
import importlib.util
import json
import math
from pathlib import Path

spec = importlib.util.spec_from_file_location('modular_export', Path(__file__).with_name('modular-export.py'))
glb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(glb)
ROOT = Path(__file__).resolve().parents[2]
SELECTED = '734620011cfa6f846cc4bf6819a6f140695815a35311581984b148be881c71de'
GUN = 'geometry_rig_mount_left-gun'
EXIT = 'physical_exit_left_gun_1'


def module_geometry(equipped):
    positions, normals, indices = [], [], []
    # Positions in socket-local glTF Y-up/+Z-forward coordinates. Socket shares
    # the existing left-gun rigid group's origin, not a firing origin.
    def face(points):
        a,b,c = points[:3]
        u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
        n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
        length=math.sqrt(sum(x*x for x in n));n=[x/length for x in n]
        start=len(positions);positions.extend(points);normals.extend([n]*len(points))
        for i in range(1,len(points)-1):indices.extend([start,start+i,start+i+1])
    def box(lo,hi):
        p=[(x,y,z) for z in (lo[2],hi[2]) for y in (lo[1],hi[1]) for x in (lo[0],hi[0])]
        for ids in ((0,2,3,1),(4,5,7,6),(0,1,5,4),(2,6,7,3),(0,4,6,2),(1,3,7,5)):face([p[i] for i in ids])
    # Bearing housing encloses the retained neck endpoint (.00628,.085,-.05).
    box((-.008,.052,-.075),(.055,.112,-.025))
    exits=[]
    if equipped:
        box((.035,-.027,-.065),(.115,.085,.055))
        # Three hollow barrels, a compact mechanical machine-gun cartridge.
        for dx,dy in ((-.016,-.010),(.016,-.010),(0,.018)):
            x,y=.08083+dx,-.0005+dy
            rings=[[(x+math.cos(i*math.tau/12)*r,y+math.sin(i*math.tau/12)*r,z) for i in range(12)] for r,z in ((.012,.035),(.012,.28),(.0075,.28),(.0075,.04))]
            for a,b in ((0,1),(1,2),(2,3)):
                for i in range(12):
                    j=(i+1)%12;face([rings[a][i],rings[a][j],rings[b][j],rings[b][i]])
            exits.append([x,y,.282])
    else:
        # Sealed structural socket, no barrel, muzzle or active exit.
        box((.048,.057,-.069),(.062,.107,-.031))
    return positions,normals,indices,exits


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
    out=args.output.resolve()
    if out.exists() or not out.is_relative_to(ROOT/'design/mechs/generated'):raise ValueError('Use a fresh ignored generated directory')
    source=ROOT/'public/assets/mechs/warden/game-ready.glb'
    if glb.digest(source.read_bytes()) != SELECTED:raise ValueError('Selected source changed')
    contract_path=ROOT/'design/mechs/assets/warden/game-ready/modularity-contract.json'
    contract=json.loads(contract_path.read_text())
    if contract['selectedSha256'] != SELECTED or contract['replaceableGeometry'] != GUN or contract['replacedExit'] != EXIT:raise ValueError('Unsupported authoring boundary')
    doc,binary=glb.read_glb(source)
    out.mkdir(parents=True)
    (out/'original.glb').write_bytes(source.read_bytes())
    excluded={GUN};reference=glb.reuse_fingerprints(doc,binary,excluded)
    report={'status':contract['status'],'sourceSha256':SELECTED,'authoringContract':contract,'authoringContractSha256':glb.digest(contract_path.read_bytes()),'boundary':'complete left-gun module; original torso-owned neck and all other geometry retained', 'interface':{'socket':'socket_left_gun','parent':'rig_mount_left-gun','frame':'warden','hardpoint':'left-gun','alternate':'machine-gun','axes':'glTF Y-up/+Z-forward/+X-own-left','socketLocalTransform':'identity','housingBounds':[[-.008,.052,-.075],[.055,.112,-.025]],'retainedNeckEndpointLocal':[.006281863,.085,-.05]},'reference':reference,'assemblies':{}}
    for label,equipped in (('alternate',True),('empty',False)):
        d=copy.deepcopy(doc);b=bytearray(binary)
        gun=next(n for n in d['nodes'] if n['name']==GUN)
        gun.pop('mesh') # Explicit unbound tombstone preserves existing animation IDs.
        exit_node=next(n for n in d['nodes'] if n['name']==EXIT)
        exit_node.clear();exit_node['name']='inactive_removed_left_gun_exit'
        parent=next(i for i,n in enumerate(d['nodes']) if n['name']=='rig_mount_left-gun')
        socket=len(d['nodes']);d['nodes'].append({'name':'socket_left_gun','children':[],'extras':{'role':'structural-socket','hardpoint':'left-gun'}})
        d['nodes'][parent].setdefault('children',[]).append(socket)
        p,n,idx,exits=module_geometry(equipped)
        primitive={'attributes':{'POSITION':glb.append_accessor(d,b,p,3),'NORMAL':glb.append_accessor(d,b,n,3)},'indices':glb.append_accessor(d,b,[(i,) for i in idx],1,5125),'material':0}
        mesh=len(d['meshes']);d['meshes'].append({'name':'draft_left_'+label,'primitives':[primitive]})
        d['nodes'][socket]['children'].append(len(d['nodes']));d['nodes'].append({'name':'module_left_'+label,'mesh':mesh,'extras':{'role':'weapon-module' if equipped else 'sealed-empty-housing'}})
        for i,point in enumerate(exits,1):
            d['nodes'][socket]['children'].append(len(d['nodes']));d['nodes'].append({'name':f'physical_exit_left_machine_gun_{i}','translation':point,'extras':{'role':'active-firing-exit','forwardDirection':[0,0,1]}})
        path=out/(label+'.glb');glb.write_glb(path,d,b)
        actual,actual_b=glb.read_glb(path)
        reuse=glb.reuse_fingerprints(actual,actual_b,excluded|{'module_left_'+label})
        if reuse != reference:raise ValueError('Shared export resources diverged')
        report['assemblies'][label]={'sha256':glb.digest(path.read_bytes()),'reuse':reuse,'moduleTriangles':len(idx)//3,'activeLeftExits':len(exits)}
    report['scriptSha256']={p.name:glb.digest(p.read_bytes()) for p in (Path(__file__),Path(__file__).with_name('modular-export.py'))}
    (out/'assembly-proof.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output':str(out),'assemblies':{k:v['sha256'] for k,v in report['assemblies'].items()}},indent=2))

if __name__=='__main__':main()
