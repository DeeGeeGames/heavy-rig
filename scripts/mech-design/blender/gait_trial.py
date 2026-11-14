"""Measured root-motion walk derived from the approved Warden master.
Run with REPO_ROOT. No approved mesh data or source files are modified.
"""
import hashlib
import json
import math
import struct
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

repo = Path(REPO_ROOT)
master = json.loads((repo / 'design/mechs/chassis/warden/shared-master.json').read_text())
source_record = master['artifacts']['warden-repair.blend']
source = repo / source_record['path']
if master['status'] != 'approved-for-rigging' or hashlib.sha256(source.read_bytes()).hexdigest() != source_record['sha256']:
    raise RuntimeError('Approved master missing or changed.')
if any(o.name.startswith(('rig_', 'repair_')) for o in bpy.data.objects):
    raise RuntimeError('Rig object names already exist; use a fresh session.')
out = repo / 'design/mechs/generated' / globals().get('OUTPUT_FOLDER', 'articulation-base-candidate')
if (out / 'gait-report.json').exists():
    raise RuntimeError('Gait trial output exists; preserve it and use a new revision.')
out.mkdir(parents=True, exist_ok=True)
previous = bpy.context.window.scene
scene = None
try:
    with bpy.data.libraries.load(str(source),link=False) as (available,loaded):
        loaded.scenes = ['Warden repair candidate v1']
    scene = loaded.scenes[0]
    scene.name = 'Warden gait trial v2'
    bpy.context.window.scene = scene
    groups = {o.name.removeprefix('rig_'):o for o in scene.objects if o.name.startswith('rig_')}
    meshes = [o for o in scene.objects if o.type=='MESH']
    def geometry_hash():
        value = [(o.name,[list(v.co) for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons]) for o in meshes]
        return hashlib.sha256(json.dumps(value,separators=(',',':')).encode()).hexdigest()
    initial_geometry = geometry_hash()
    pelvis = groups['pelvis']
    rest_pelvis = pelvis.location.copy()
    rest = {name:obj.matrix_world.translation.copy() for name,obj in groups.items()}
    actuators = [o for o in scene.objects if o.constraints and '_piston_' in o.name]
    if len(actuators)!=8:
        raise RuntimeError('Expected eight constrained actuator pieces.')
    parameters = {'durationSeconds':1.5,'fps':60,'stanceFraction':.6,'stanceTravel':.08,'swingLift':.022,
                  'pelvisSway':.016,'pelvisBob':.007,'pelvisRollDegrees':2.,'pelvisYawDegrees':2.}
    steps = round(parameters['durationSeconds']*parameters['fps'])
    travel = parameters['stanceTravel']/parameters['stanceFraction']
    half_stance = parameters['stanceTravel']/2
    scene.render.fps = parameters['fps']
    scene.frame_start,scene.frame_end = 1,steps+1
    samples = []
    baked = {o.name:[] for o in actuators}
    previous_contact = {}
    maximum_slip,maximum_target_error,maximum_pitch = 0.,0.,0.
    ranges = {name:[float('inf'),-float('inf')] for name in groups if name.startswith('leg_')}
    ranges_xyz = {name:{axis:[float('inf'),-float('inf')] for axis in ['x','y','z']} for name in ranges}
    def foot_target(phase):
        if phase < parameters['stanceFraction']:
            return -half_stance+travel*phase,0.,True
        t = (phase-parameters['stanceFraction'])/(1-parameters['stanceFraction'])
        tangent = travel*(1-parameters['stanceFraction'])
        y = (2*t**3-3*t**2+1)*half_stance + (t**3-2*t**2+t)*tangent + (-2*t**3+3*t**2)*(-half_stance) + (t**3-t**2)*tangent
        return y,parameters['swingLift']*math.sin(math.pi*t)**2,False
    rest_pelvis_world = pelvis.matrix_world.copy()
    def solve(side,target):
        hip0,knee0,ankle0 = [rest['leg_'+side+'_'+part] for part in ['thigh','shin','foot']]
        first,second = knee0-hip0,ankle0-knee0
        hip = pelvis.matrix_world @ (rest_pelvis_world.inverted() @ hip0)
        delta = target-hip
        length = delta.length
        l1,l2 = first.length,second.length
        if not abs(l1-l2) < length < l1+l2:
            raise RuntimeError('Unreachable foot target.')
        direction = delta/length
        along = (l1*l1-l2*l2+length*length)/(2*length)
        neutral_direction = (ankle0-hip0).normalized()
        pole = first-neutral_direction*first.dot(neutral_direction)
        pole = pelvis.matrix_world.to_quaternion() @ pole
        pole = (pole-direction*pole.dot(direction)).normalized()
        knee = hip+direction*along+pole*math.sqrt(max(0,l1*l1-along*along))
        hip_world = first.rotation_difference(knee-hip)
        shin_world = second.rotation_difference(target-knee)
        rotations = [('thigh',pelvis.matrix_world.to_quaternion().inverted()@hip_world),
                     ('shin',hip_world.inverted()@shin_world),('foot',shin_world.inverted())]
        for part,rotation in rotations:
            obj = groups['leg_'+side+'_'+part]
            obj.rotation_mode = 'QUATERNION'
            obj.rotation_quaternion = rotation
            for axis,angle in zip(['x','y','z'],rotation.to_euler()):
                extent = ranges_xyz['leg_'+side+'_'+part][axis]
                extent[0] = min(extent[0],math.degrees(angle))
                extent[1] = max(extent[1],math.degrees(angle))
            value = math.degrees(rotation.to_euler().x)
            ranges['leg_'+side+'_'+part][0] = min(ranges['leg_'+side+'_'+part][0],value)
            ranges['leg_'+side+'_'+part][1] = max(ranges['leg_'+side+'_'+part][1],value)
    conversion = Matrix.Rotation(-math.pi/2,4,'X')
    for index in range(steps+1):
        frame,phase = index+1,index/steps
        scene.frame_set(frame)
        weight = math.sin(2*math.pi*(phase-.05))
        pelvis.location = rest_pelvis + Vector((parameters['pelvisSway']*weight,-travel*phase,-parameters['pelvisBob']*math.cos(4*math.pi*phase)))
        pelvis.rotation_euler = (math.radians(.8+.65*math.sin(4*math.pi*phase)),math.radians(parameters['pelvisRollDegrees'])*weight,math.radians(parameters['pelvisYawDegrees'])*math.sin(2*math.pi*phase))
        # Slight lag and opposing rotation keep the heavy weapon platform steadier than the hips.
        lag = phase-.045
        groups['torso'].rotation_euler = (math.radians(-.35-.45*math.sin(4*math.pi*lag)),
                                        -math.radians(1.1)*math.sin(2*math.pi*(lag-.05)),
                                        -math.radians(1.2)*math.sin(2*math.pi*lag))
        bpy.context.view_layer.update()
        targets = {}
        for side,offset in [('left',0),('right',.5)]:
            local_phase = (phase+offset)%1
            offset_y,lift,stance = foot_target(local_phase)
            target = rest['leg_'+side+'_foot'] + Vector((0,offset_y-travel*phase,lift))
            solve(side,target)
            targets[side] = (target,stance,math.floor(phase+offset))
        bpy.context.view_layer.update()
        row = {'frame':frame,'phase':phase,'feet':{},'body':{}}
        for name in ['pelvis','torso']:
            matrix = conversion @ groups[name].matrix_world @ conversion.inverted()
            row['body'][name] = [matrix[r][c] for c in range(4) for r in range(4)]
        for side,(target,stance,cycle) in targets.items():
            foot = groups['leg_'+side+'_foot']
            actual = foot.matrix_world.translation.copy()
            maximum_target_error = max(maximum_target_error,(actual-target).length)
            maximum_pitch = max(maximum_pitch,max(abs(v) for v in foot.matrix_world.to_euler()))
            key = side+':'+str(cycle)
            if stance:
                if key in previous_contact:
                    maximum_slip = max(maximum_slip,(actual-previous_contact[key]).length)
                else: previous_contact[key] = actual.copy()
            row['feet'][side] = {'stance':stance,'ankle':list(actual)}
        samples.append(row)
        for obj in groups.values():
            obj.keyframe_insert(data_path='location',frame=frame)
            obj.keyframe_insert(data_path='rotation_quaternion' if obj.rotation_mode=='QUATERNION' else 'rotation_euler',frame=frame)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for obj in actuators:
            evaluated = obj.evaluated_get(depsgraph).matrix_world.copy()
            local = obj.parent.matrix_world.inverted() @ evaluated
            baked[obj.name].append((frame,local.decompose()))
    if maximum_slip>1e-5 or maximum_target_error>1e-5 or maximum_pitch>1e-5:
        raise RuntimeError('Foot planting or orientation failed.')
    for obj in actuators:
        for constraint in list(obj.constraints): obj.constraints.remove(constraint)
        obj.rotation_mode = 'QUATERNION'
        for frame,(location,rotation,scale) in baked[obj.name]:
            obj.location,obj.rotation_quaternion,obj.scale = location,rotation,scale
            obj.keyframe_insert(data_path='location',frame=frame)
            obj.keyframe_insert(data_path='rotation_quaternion',frame=frame)
            obj.keyframe_insert(data_path='scale',frame=frame)
    # Linear interpolation between dense samples avoids Bezier overshoot.
    for obj in list(groups.values())+actuators:
        action = obj.animation_data.action
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points: key.interpolation='LINEAR'
    if geometry_hash()!=initial_geometry:
        raise RuntimeError('Approved geometry changed.')
    scene.frame_set(1)
    # Export B using the same shared body. Only visible energy cartridges are selected.
    for obj in scene.objects: obj.select_set(False)
    selected = [o for o in scene.objects if o.type in ('MESH','EMPTY') and not o.hide_get()]
    for obj in selected: obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out/'warden-b-walk.glb'),use_selection=True,use_active_scene=True,
        export_animations=True,export_animation_mode='SCENE',export_anim_scene_split_object=False,
        export_frame_range=True,export_frame_step=1,export_bake_animation=True,export_anim_slide_to_zero=True,
        export_optimize_animation_size=False)
    bpy.data.libraries.write(str(out/'warden-walk.blend'),{scene})
    raw=(out/'warden-b-walk.glb').read_bytes();size=struct.unpack_from('<I',raw,12)[0];gltf=json.loads(raw[20:20+size])
    if len(gltf.get('animations',[]))!=1 or len(gltf['meshes'])!=121:
        raise RuntimeError('Unexpected exported animation or mesh count.')
    # Floor/grid are preview-only, added after exporting the asset.
    bpy.ops.mesh.primitive_plane_add(size=12,location=(0,0,-.001))
    floor=bpy.context.object;floor.name='gait_preview_floor';floor.color=(.15,.17,.19,1)
    for index in range(-8,9):
        bpy.ops.mesh.primitive_cube_add(size=1,location=(0,index*travel,-.0006))
        line=bpy.context.object;line.name='gait_preview_grid';line.scale=(2,.001,.0002);line.color=(.28,.30,.32,1)
    scene.display.shading.color_type='OBJECT'
    for obj in meshes:obj.color=(.52,.56,.60,1)
    camera=scene.camera
    scene.render.resolution_x=600;scene.render.resolution_y=600;scene.render.resolution_percentage=100
    for index in range(0,steps,3):
        scene.frame_set(index+1)
        phase=index/steps
        offset=Vector((0,-travel*phase,0))
        camera.location=Vector((1.6,-2.4,1.3))+offset
        camera.rotation_euler=(Vector((0,0,.49))+offset-camera.location).to_track_quat('-Z','Y').to_euler()
        camera.data.ortho_scale=1.4
        scene.render.filepath=str(out/('walk-%03d.png'%(index//3)))
        bpy.ops.render.render(write_still=True)
    scene.frame_set(1)
    report={'status':'gait-trial-unapproved','revision':'v2-weight-transfer','masterId':master['id'],'sourceSha256':source_record['sha256'],
        'geometrySha256':initial_geometry,'parameters':parameters,'rootTravelPerCycle':travel,
        'maximumStanceSlip':maximum_slip,'maximumTargetError':maximum_target_error,'maximumFootPitchRadians':maximum_pitch,
        'jointRangesDegrees':ranges,'jointRangesMeaning':'Local Euler X (pitch) only',
        'jointRangesXYZDegrees':ranges_xyz,'animationClips':len(gltf['animations']),'samples':samples,
        'limitations':['Straight level-ground trial only','Root-motion clip needs runtime integration','Clearance audit pending','No terrain, turning or combat aim acceptance']}
    (out/'gait-report.json').write_text(json.dumps(report,indent=2)+'\n')
finally:
    bpy.context.window.scene=previous
