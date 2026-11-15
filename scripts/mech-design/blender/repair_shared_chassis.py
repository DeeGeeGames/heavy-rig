"""Preserved Warden derivative: mechanical repair candidate, not a production rig.
Run in Blender with REPO_ROOT set. Inputs and outputs are recorded in repair-draft.json.
"""
import hashlib
import json
import math
import struct
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

repo = Path(REPO_ROOT)
config = json.loads((repo / globals().get('REPAIR_MANIFEST', 'design/mechs/chassis/warden/repair-draft.json')).read_text())
if config['status'] != 'repair-candidate-unapproved':
    raise RuntimeError('Approved repair revision is frozen; copy the recipe to a new candidate revision/output and set REPAIR_MANIFEST.')
source = repo / config['source']
if hashlib.sha256(source.read_bytes()).hexdigest() != config['sourceSha256']:
    raise RuntimeError('Modular source changed; re-review repair recipe.')
out = repo / config['output']
if (out / 'repair-report.json').exists():
    raise RuntimeError('Repair output already exists; choose a new revision.')
approval_path = repo / 'design/mechs/chassis/warden/shared-master.json'
if approval_path.exists():
    approved = json.loads(approval_path.read_text())
    if any((repo / item['path']).resolve().parent == out.resolve() for item in approved['artifacts'].values()):
        raise RuntimeError('Output directory contains approved artifacts; choose a new revision.')
out.mkdir(parents=True, exist_ok=True)
if any(s.name.startswith('Warden repair candidate') for s in bpy.data.scenes):
    raise RuntimeError('Repair scene exists; preserve it and use a new revision.')
if any(o.name.startswith(('shared_tripo_part_', 'left_energy_', 'right_energy_', 'left_launcher_', 'right_launcher_', 'repair_')) for o in bpy.data.objects):
    raise RuntimeError('Source/candidate object names already exist; use a fresh session.')
previous = bpy.context.window.scene
created = []


def bisect(bm, axis, value, positive):
    point, normal = [0, 0, 0], [0, 0, 0]
    point[axis], normal[axis] = value, 1
    bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                           plane_co=point, plane_no=normal, dist=1e-7,
                           clear_inner=positive, clear_outer=not positive)


def remove_box(obj, minimum, maximum):
    # Partition a copied mesh; discard only the interior of the specified box.
    remainder = bmesh.new()
    remainder.from_mesh(obj.data)
    chunks = []
    for axis in range(3):
        outside = remainder.copy()
        bisect(outside, axis, minimum[axis], False)
        chunks.append(outside)
        bisect(remainder, axis, minimum[axis], True)
        outside = remainder.copy()
        bisect(outside, axis, maximum[axis], True)
        chunks.append(outside)
        bisect(remainder, axis, maximum[axis], False)
    removed = len(remainder.faces)
    remainder.free()
    vertices, faces = [], []
    for chunk in chunks:
        chunk.verts.index_update()
        offset = len(vertices)
        vertices.extend(tuple(v.co) for v in chunk.verts)
        faces.extend(tuple(offset + v.index for v in f.verts) for f in chunk.faces)
        chunk.free()
    if removed:
        mesh = bpy.data.meshes.new(obj.data.name + '_trimmed')
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj.data = mesh
    return removed


def cap_interface(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    edges = [e for e in bm.edges if e.is_boundary and all(abs(v.co.y - .12) < 1e-6 for v in e.verts)]
    # Source segmentation can leave a small hole adjoining the cut. Follow its
    # connected boundary so the cap closes the complete loop, not an open chain.
    connected = set(edges)
    queue = list(edges)
    while queue:
        edge = queue.pop()
        for vertex in edge.verts:
            for neighbor in vertex.link_edges:
                if neighbor.is_boundary and neighbor not in connected:
                    connected.add(neighbor)
                    queue.append(neighbor)
    result = bmesh.ops.holes_fill(bm, edges=list(connected), sides=0) if connected else {'faces': []}
    remaining = len([e for e in bm.edges if e.is_boundary and all(abs(v.co.y - .12) < 1e-6 for v in e.verts)])
    bm.to_mesh(obj.data)
    bm.free()
    return {'filledFaces': len(result['faces']), 'remainingPlaneBoundaryEdges': remaining}


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    return obj


def ring(name, cx, cz, outer, inner, y0, y1):
    def octagon(w, h):
        c = .012
        return [(-w+c,-h),(w-c,-h),(w,-h+c),(w,h-c),(w-c,h),(-w+c,h),(-w,h-c),(-w,-h+c)]
    vertices = [(cx+x,y,cz+z) for y in (y0,y1) for size in (outer,inner) for x,z in octagon(*size)]
    faces = []
    for i in range(8):
        j = (i+1)%8
        faces += [(i,j,16+j,16+i),(8+j,8+i,24+i,24+j),(j,i,8+i,8+j),(16+i,16+j,24+j,24+i)]
    return mesh_object(name,vertices,faces)


def cylinder(name, radius, length):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=length)
    obj = bpy.context.object
    obj.name = name
    for face in obj.data.polygons:
        face.use_smooth = abs(face.normal.z) < .5
    return obj


def parent_world(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world



def inspect_export(path, shared_names):
    data = path.read_bytes()
    size = struct.unpack_from('<I',data,12)[0]
    gltf = json.loads(data[20:20+size])
    binary = data[28+size:]
    if len(gltf['scenes']) != 1:
        raise RuntimeError('Unexpected exported scenes.')
    parents = {child:node['name'] for node in gltf['nodes'] for child in node.get('children',[])}
    def accessor(index):
        a = gltf['accessors'][index]
        view = gltf['bufferViews'][a['bufferView']]
        offset = view.get('byteOffset',0)
        return {'layout':{k:v for k,v in a.items() if k!='bufferView'},'stride':view.get('byteStride'),
                'bytes':hashlib.sha256(binary[offset:offset+view['byteLength']]).hexdigest()}
    shared_data = {}
    for index,node in enumerate(gltf['nodes']):
        if node.get('name') in shared_names:
            mesh = gltf['meshes'][node['mesh']]
            shared_data[node['name']] = {'parent':parents.get(index),
                'transform':{k:node[k] for k in ('matrix','translation','rotation','scale') if k in node},
                'primitives':[{'attributes':{k:accessor(v) for k,v in primitive['attributes'].items()},
                               'indices':accessor(primitive['indices'])} for primitive in mesh['primitives']]}
    if set(shared_data) != shared_names:
        raise RuntimeError('Export lost shared meshes.')
    return shared_data, {'meshes':len(gltf['meshes']),
                        'triangles':sum(gltf['accessors'][p['indices']]['count']//3 for m in gltf['meshes'] for p in m['primitives'])}


try:
    with bpy.data.libraries.load(str(source), link=False) as (available, loaded):
        loaded.scenes = ['Warden modular library v1']
    library = loaded.scenes[0]
    created.append(library)
    scene = bpy.data.scenes.new('Warden repair candidate v1')
    created.append(scene)
    bpy.context.window.scene = scene
    source_objects = {o.name: o for o in library.objects if o.type == 'MESH'}
    objects = {}
    for name, original in source_objects.items():
        obj = original.copy()
        obj.data = original.data.copy()
        obj.name = 'repair_' + name
        scene.collection.objects.link(obj)
        objects[name] = obj
    expected_source_names = {'shared_tripo_part_'+str(i) for i in range(107) if i not in (59,68)}
    expected_source_names.update(side+'_'+suffix for side in ['left','right'] for suffix in ['energy_face','energy_optic','launcher_face'])
    if set(objects) != expected_source_names:
        raise RuntimeError('Imported modular library has unexpected or renamed meshes.')
    # Reconstruct the diagnostic hierarchy with the same complete source-part mapping.
    mapping_path = repo / config['partMap']
    if hashlib.sha256(mapping_path.read_bytes()).hexdigest() != config['partMapSha256']:
        raise RuntimeError('Part map changed; re-review repairs.')
    mapping = json.loads(mapping_path.read_text())
    assigned = [part for group in mapping['groups'] for part in group['parts']]
    if len(assigned) != len(set(assigned)) or set(assigned) != {'tripo_part_'+str(i) for i in range(107)}:
        raise RuntimeError('Part map does not uniquely cover the source.')
    groups = {}
    for group in mapping['groups']:
        obj = bpy.data.objects.new('rig_' + group['name'], None)
        scene.collection.objects.link(obj)
        obj.location = group['pivot']
        groups[group['name']] = obj
    bpy.context.view_layer.update()
    for group in mapping['groups']:
        if group['parent']:
            parent_world(groups[group['name']], groups[group['parent']])
    shared = [o for name,o in objects.items() if name.startswith('shared_')]
    seam_report = {}
    for name,obj in objects.items():
        if name in ['shared_tripo_part_1','shared_tripo_part_2'] or '_face' in name:
            seam_report[name] = cap_interface(obj)
    if any(record['remainingPlaneBoundaryEdges'] for record in seam_report.values()):
        raise RuntimeError('Cartridge cut boundary remains open.')
    # Remove only narrow front/rear piston interiors, preserving the surrounding armor.
    trim_report = {}
    for side, sign in [('left',1),('right',-1)]:
        for y0,y1,z0,z1 in [(-.052,.016,.135,.251),(.070,.134,.121,.277)]:
            minimum = [min(sign*.174,sign*.232),y0,z0]
            maximum = [max(sign*.174,sign*.232),y1,z1]
            for name,obj in objects.items():
                if not name.startswith('shared_'):
                    continue
                points = [v.co for v in obj.data.vertices]
                if all(max(v[i] for v in points) > minimum[i] and min(v[i] for v in points) < maximum[i] for i in range(3)):
                    removed = remove_box(obj,minimum,maximum)
                    if removed: trim_report[name] = trim_report.get(name,0) + removed
    for group in mapping['groups']:
        for part in group['parts']:
            obj = objects.get('shared_' + part)
            if obj:
                target_group = {'tripo_part_99':'leg_left_foot','tripo_part_96':'leg_right_foot'}.get(part,group['name'])
                parent_world(obj, groups[target_group])
    modules = {}
    additions = []
    pistons = []
    piston_anchors = []
    for side, sign in [('left',1),('right',-1)]:
        shoulder = groups['mount_' + side + '-shoulder bank']
        for family in ['energy','launcher']:
            modules[(side,family)] = [o for name,o in objects.items() if name.startswith(side+'_'+family)]
            for obj in modules[(side,family)]: parent_world(obj,shoulder)
        # A common overlap collar masks donor contour differences at the cut plane.
        collar = ring('repair_'+side+'_cartridge_collar',sign*.251,.89,(.120,.070),(.110,.060),.118,.140)
        parent_world(collar,shoulder)
        additions.append(collar)
        # Enclosed axle supplies continuous volume behind the original ankle armor.
        axle = cylinder('repair_'+side+'_ankle_axle',.046,.135)
        axle.location = (sign*.22,.035,.095)
        axle.rotation_euler[1] = math.pi/2
        bpy.context.view_layer.update()
        parent_world(axle,groups['leg_'+side+'_shin'])
        additions.append(axle)
        # Fixed-length barrel and rod telescope, tracking endpoints on separate assemblies.
        for location,top,bottom,barrel_length,rod_length in [
                ('front',Vector((sign*.203,-.018,.249)),Vector((sign*.212,-.023,.139)),.067,.083),
                ('rear',Vector((sign*.203,.100,.276)),Vector((sign*.203,.103,.128)),.095,.105)]:
            prefix = 'repair_'+side+'_'+location+'_piston_'
            barrel = cylinder(prefix+'barrel',.022,barrel_length)
            rod = cylinder(prefix+'rod',.012,rod_length)
            additions += [barrel,rod]
            shin, foot = groups['leg_'+side+'_shin'],groups['leg_'+side+'_foot']
            bpy.context.view_layer.update()
            anchors = []
            for label,point,parent in [('top',top,shin),('bottom',bottom,foot)]:
                anchor = bpy.data.objects.new(prefix+label,None)
                scene.collection.objects.link(anchor)
                anchor.location = point
                bpy.context.view_layer.update()
                parent_world(anchor,parent)
                anchors.append(anchor)
            bpy.context.view_layer.update()
            for obj,anchor,target,length in [(barrel,anchors[0],anchors[1],barrel_length),(rod,anchors[1],anchors[0],rod_length)]:
                for vertex in obj.data.vertices: vertex.co.z += length/2
                obj.matrix_world = Matrix.Translation(anchor.matrix_world.translation)
                parent_world(obj,anchor)
                constraint = obj.constraints.new('DAMPED_TRACK')
                constraint.target = target
                constraint.track_axis = 'TRACK_Z'
            piston_anchors.extend(anchors)
            pistons.append({'id':side+'-'+location,'topAnchor':anchors[0],'bottomAnchor':anchors[1],
                            'barrelLength':barrel_length,'rodLength':rod_length,'barrel':barrel,'rod':rod})
    bpy.context.view_layer.update()
    def set_pose(rotations):
        for obj in groups.values(): obj.rotation_euler = (0,0,0)
        for name,(axis,degrees) in rotations.items(): groups[name].rotation_euler[axis] = math.radians(degrees)
        bpy.context.view_layer.update()
        distances = {}
        for p in pistons:
            top = p['topAnchor'].matrix_world.translation
            bottom = p['bottomAnchor'].matrix_world.translation
            distance = (top-bottom).length
            total = p['barrelLength'] + p['rodLength']
            if not max(p['barrelLength'],p['rodLength']) < distance < total:
                raise RuntimeError('Piston stroke exceeded on ' + p['id'])
            for obj,start,end in [(p['barrel'],top,bottom),(p['rod'],bottom,top)]:
                world = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).matrix_world
                if (world.translation-start).length > 1e-6:
                    raise RuntimeError('Piston endpoint detached: ' + p['id'])
                axis = (world.to_3x3() @ Vector((0,0,1))).normalized()
                if axis.dot((end-start).normalized()) < 1-1e-6:
                    raise RuntimeError('Piston does not track opposite endpoint: ' + p['id'])
            distances[p['id']] = {'endpointDistance':distance,'overlap':total-distance}
        bpy.context.view_layer.update()
        return distances
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'SINGLE'
    scene.display.shading.single_color = (.52,.56,.60)
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.world = bpy.data.worlds.new('Warden repair world')
    scene.world.color = (.12,.12,.12)
    camera = bpy.data.objects.new('Warden repair camera',bpy.data.cameras.new('Warden repair camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = 'ORTHO'
    def render(label, close=False, rear=False):
        camera.location = (1.6,2.4 if rear else -2.4,1.3) if not close else (.8,.9 if rear else -.9,.38)
        target = Vector((0,0,.49)) if not close else Vector((0,0,.17))
        camera.rotation_euler = (target-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.ortho_scale = 1.4 if not close else .78
        scene.render.filepath = str(out/(label+'.png'))
        bpy.ops.render.render(write_still=True)
    def variant(families):
        for (side,family), parts in modules.items():
            for obj in parts:
                obj.hide_render = family != families[0 if side=='left' else 1]
                obj.hide_set(obj.hide_render)
    variant(['energy','energy'])
    pose_report = {}
    poses = {'neutral':{}}
    for side in ['left','right']:
        for joint,angle in [('foot',20),('shin',25),('thigh',20)]:
            for sign in [-1,1]: poses[side+'-'+joint+'-'+str(sign*angle)] = {'leg_'+side+'_'+joint:(0,sign*angle)}
    for angle in [-25,25]: poses['waist-'+str(angle)] = {'torso':(2,angle)}
    poses['combined'] = {'torso':(2,20),'leg_left_thigh':(0,-15),'leg_left_shin':(0,25),'leg_left_foot':(0,-10),
                         'leg_right_thigh':(0,10),'leg_right_shin':(0,-10),'leg_right_foot':(0,10)}
    for label,rotation in poses.items():
        pose_report[label] = set_pose(rotation)
        render(label)
        if 'foot' in label or label=='neutral':
            render(label+'-detail',True)
            render(label+'-rear-detail',True,True)
    # Check intermediate actuator strokes without claiming collision acceptance.
    sweep_report = {}
    for side in ['left','right']:
        for joint,limit in [('foot',20),('shin',25),('thigh',20)]:
            for angle in range(-limit,limit+1,5):
                sweep_report[side+'-'+joint+'-'+str(angle)] = set_pose({'leg_'+side+'_'+joint:(0,angle)})
    set_pose({})
    export_report = {}
    common_export = None
    for name,families in [('warden',['launcher','launcher']),('warden-b',['energy','energy']),('warden-c',['energy','launcher'])]:
        variant(families)
        render(name+'-neutral')
        for obj in scene.objects: obj.select_set(False)
        selected = shared + additions + piston_anchors + list(groups.values()) + [o for (side,family),parts in modules.items() if family==families[0 if side=='left' else 1] for o in parts]
        for obj in selected: obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(out/(name+'-repair.glb')),use_selection=True,use_active_scene=True,export_animations=False)
        inspected,metadata = inspect_export(out/(name+'-repair.glb'),{o.name for o in shared+additions})
        if common_export is not None and inspected != common_export:
            raise RuntimeError('Repaired shared geometry or hierarchy differs between variants.')
        common_export = inspected
        if metadata['meshes'] != len(shared)+len(additions)+sum(len(modules[(side,family)]) for side,family in zip(['left','right'],families)):
            raise RuntimeError('Export contains unexpected meshes.')
        export_report[name] = metadata
    variant(['energy','energy'])
    bpy.data.libraries.write(str(out/'warden-repair.blend'),{scene})
    report = {'status':'repair-candidate-unapproved','sourceSha256':config['sourceSha256'],
              'seamCaps':seam_report,'trimmedPistonParts':trim_report,'poses':pose_report,
              'actuatorSweeps':sweep_report,'exportVerification':export_report,
              'sharedExportSha256':hashlib.sha256(json.dumps(common_export,sort_keys=True).encode()).hexdigest(),
              'sharedMeshes':len(shared)+len(additions),'limitations':['Estimated pivots remain','No collision or gait solver',
              'Front/rear ankle actuators rebuilt; other joint surfaces remain provisional','No production muzzle or empty mount interfaces','GLB snapshots do not carry Blender tracking constraints']}
    (out/'repair-report.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
    bpy.context.window.scene = previous
