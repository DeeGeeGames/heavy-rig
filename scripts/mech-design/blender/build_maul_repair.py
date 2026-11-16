"""Build the exact reviewed Maul source into a neutral articulation candidate.

This is a source-specific adapter. Component ownership and pivots come from its
hash-pinned recipe; no anatomical thresholds are inherited from another mech.
"""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion

sys.path.insert(0, str(Path(__file__).resolve().parent))
from optimization_io import blender_arguments, fresh_output, resolve_input
from source_inventory import inventory_meshes, verify_inventory_equivalence, verify_ownership
from rigid_packaging import read_glb, write_glb, package_neutral_rig
from build_kestrel_repair import component_geometry, build_mesh, clean_exported_triangles, turned_bearing


def launcher_cell(x, z, settings):
    """Square cell with an annular face and a real recessed cylindrical bore."""
    count = settings['segments']
    front, back = settings['frontY'], settings['frontY'] + settings['boreDepth']
    half, radius = settings['pitch'] / 2, settings['radius']
    points, faces = [], []
    for ring in range(4):
        for i in range(count):
            angle = 2 * math.pi * i / count
            c, s = math.cos(angle), math.sin(angle)
            r = half / max(abs(c), abs(s)) if ring in (0, 3) else radius
            y = front if ring < 2 else back if ring == 2 else back + .008
            points.append((x+r*c, y, z+r*s))
    for ring in range(2):
        for i in range(count):
            j = (i+1) % count
            faces.append((ring*count+i, ring*count+j, (ring+1)*count+j, (ring+1)*count+i))
    # Close the back and exterior walls; every blind bore is a closed solid.
    faces.append(tuple(range(2*count, 3*count)))
    faces.append(tuple(reversed(range(3*count, 4*count))))
    for i in range(count):
        j = (i+1) % count
        faces.append((3*count+i, 3*count+j, j, i))
    return points, faces


def add_diagnostic_clip(document, binary, indices):
    """Single-joint sweeps followed by a combined pose; deliberately no gait claim."""
    binary = bytearray(binary)
    def accessor(rows, width):
        binary.extend(b'\0' * (-len(binary) % 4))
        offset = len(binary)
        values = [float(v) for row in rows for v in row]
        binary.extend(struct.pack('<'+'f'*len(values), *values))
        view = len(document['bufferViews'])
        document['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(values)*4})
        index = len(document['accessors'])
        item = {'bufferView':view,'componentType':5126,'count':len(rows),'type':'SCALAR' if width==1 else 'VEC4'}
        if width==1: item.update(min=[min(values)],max=[max(values)])
        document['accessors'].append(item)
        return index
    times = [[i/30] for i in range(406)]
    time_accessor = accessor(times,1)
    animation = {'name':'diagnostic-articulation','samplers':[],'channels':[],
                 'extras':{'scope':'Sequential joint sweeps and combined pose; not locomotion or clearance acceptance.'}}
    basis = Matrix.Rotation(-math.pi/2,4,'X').to_3x3()
    tracks = [('rig_torso',(0,0,1),35,0),('rig_leg_left_thigh',(1,0,0),-20,1),
              ('rig_leg_left_shin',(1,0,0),30,2),('rig_leg_left_foot',(1,0,0),15,3),
              ('rig_leg_right_thigh',(1,0,0),15,4),('rig_leg_right_shin',(1,0,0),25,5),
              ('rig_leg_right_foot',(1,0,0),-12,6)]
    for name,axis,degrees,slot in tracks:
        rows=[]
        for frame in range(406):
            t=frame/30
            active = slot*1.5 <= t < (slot+1)*1.5
            amount = math.sin(math.pi*(t-slot*1.5)/1.5) if active else 0
            if t>=10.5: amount=math.sin(math.pi*(t-10.5)/3)
            q=Quaternion(axis,math.radians(degrees)*amount)
            q=(basis@q.to_matrix()@basis.inverted()).to_quaternion()
            rows.append([q.x,q.y,q.z,q.w])
        sampler=len(animation['samplers'])
        animation['samplers'].append({'input':time_accessor,'output':accessor(rows,4),'interpolation':'LINEAR'})
        animation['channels'].append({'sampler':sampler,'target':{'node':indices[name],'path':'rotation'}})
    document['animations']=[animation]
    return binary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--recipe',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(blender_arguments())
    repo=args.repo.resolve()
    recipe_path=resolve_input(repo,args.recipe)
    recipe=json.loads(recipe_path.read_text())
    if recipe['chassis']!='maul': raise ValueError('Maul adapter requires Maul recipe')
    inputs={}
    for name,record in recipe['inputs'].items():
        path=resolve_input(repo,Path(record['path']))
        if hashlib.sha256(path.read_bytes()).hexdigest()!=record['sha256']: raise ValueError('Changed input '+name)
        inputs[name]=path
    output=fresh_output(repo,args.output,directory=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(inputs['source']))
    original=list(bpy.context.scene.objects)
    frozen=json.loads(inputs['inventory'].read_text())
    verify_inventory_equivalence(inventory_meshes(original),frozen)
    mapping=json.loads(inputs['ownership'].read_text())
    reviewed=verify_ownership(frozen,mapping,recipe['inputs']['source']['sha256'])
    raw=next(o for o in original if o.type=='MESH')
    if raw.matrix_world!=Matrix.Identity(4): raise ValueError('Expected reviewed identity source transform')
    pieces={g['name']:[] for g in recipe['groups']}
    provenance=[]
    for component in reviewed:
        number=int(component['id'].split(':')[-1])
        decision='replace-launcher-front' if number in recipe['replaceComponents'] else 'remove-source-artifact' if number in recipe['removeArtifacts'] else 'retain'
        owner=mapping['assignments'][component['id']]
        if decision=='retain': pieces[owner].append(component_geometry(raw.data,component))
        provenance.append({'component':component['id'],'decision':decision,'owner':owner,'triangles':component['triangles']})
    anchors=[]
    settings=recipe['launcher']
    for side,sign in [('left',1),('right',-1)]:
        owner=f'rig_mount_{side}-pod'
        for row in range(settings['rows']):
            for column in range(settings['columns']):
                x=sign*settings['centerX']+(column-1.5)*settings['pitch']
                z=settings['centerZ']+(row-1.5)*settings['pitch']
                pieces[owner].append(launcher_cell(x,z,settings))
                anchors.append({'name':f'physical_exit_{side}_{row}_{column}','parent':owner,'worldPosition':[x,settings['frontY'],z],'direction':[0,-1,0]})
        anchors.append({'name':f'muzzle_{side}-forearm pod','parent':owner,'worldPosition':[sign*settings['centerX']-.5*settings['pitch'],settings['frontY'],settings['centerZ']-.5*settings['pitch']],'direction':[0,-1,0]})
    bearing=recipe['waistBearing']
    pieces['rig_pelvis'].append(turned_bearing(bearing['center'],bearing['profile'],bearing['segments']))
    material=bpy.data.materials.new('Maul neutral geometry inspection')
    material.diffuse_color=(.42,.45,.47,1)
    objects=[]
    removed=0
    for name,parts in pieces.items():
        if not parts: raise ValueError('Empty owner '+name)
        obj,count=build_mesh('maul_'+name.removeprefix('rig_'),parts,material,65)
        objects.append(obj)
        removed+=count
    for obj in original: bpy.data.objects.remove(obj,do_unlink=True)
    geometry=output/'geometry.glb'
    bpy.ops.export_scene.gltf(filepath=str(geometry),export_format='GLB',export_animations=False,export_extras=True)
    document,binary=read_glb(geometry)
    binary,cleanup=clean_exported_triangles(document,binary)
    contract={'groups':recipe['groups'],'meshGroups':{obj.name:name for obj,name in zip(objects,pieces)},'anchors':anchors}
    document,indices,groups,pivots,owned,bindings=package_neutral_rig(document,contract,scene_name='Maul A repair candidate',generator='Heavy Rig Maul source-specific repair')
    document['extras']={'chassisId':'maul','approvalStatus':'candidate-unapproved','sourceSha256':recipe['inputs']['source']['sha256'],'weaponBinding':'rigid-to-torso'}
    binary=add_diagnostic_clip(document,binary,indices)
    target=output/'maul.glb'
    write_glb(target,document,binary)
    (output/'rig-contract.json').write_text(json.dumps(contract,indent=2)+'\n')
    report={'status':'candidate-needs-articulation-review','sourceSha256':recipe['inputs']['source']['sha256'],'recipeSha256':hashlib.sha256(recipe_path.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(target.read_bytes()).hexdigest(),'candidateBytes':target.stat().st_size,'sourceDecisions':provenance,'removedDegeneratePolygons':removed,'exportedTriangleCleanup':cleanup,'anchors':anchors,'blenderVersion':bpy.app.version_string}
    (output/'repair-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print('MAUL_CANDIDATE',target)


if __name__=='__main__':
    main()
