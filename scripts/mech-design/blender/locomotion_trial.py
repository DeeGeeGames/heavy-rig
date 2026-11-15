"""Draft speed-scaled Warden walk/run; preserve the approved interface master.

Run in a fresh background Blender with --python-exit-code 1 --python this_file
-- --repo ROOT --output REVISION --speed 1.0. Speed is relative to the approved
walk and bounded to 1..4 for the original scaled profile. The suspended-run
profile covers 4..8 with longer strides at the same cadence. Outputs are new
revisions, never approved implicitly. Backward-walk covers retreat speeds 1..3;
speed is a positive magnitude and its signed root travel is negative.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


def smooth(value):
    return value * value * (3 - 2 * value)


def smoother(value):
    return value**3 * (value * (value * 6 - 15) + 10)


def parameters(speed, profile='scaled'):
    if profile == 'backward-walk':
        if not math.isfinite(speed) or not 1 <= speed <= 3:
            raise ValueError('Backward-walk preview speed must be between 1 and 3.')
        blend = smooth((speed-1)/2)
        frames = 2*round((156-36*blend)/2)
        duration = frames/120
        return {'profile': profile, 'speedMultiplier': speed, 'runBlend': 0.,
                'fps': 120, 'durationSeconds': duration, 'frames': frames,
                'travel': -(.08/.6/1.5)*speed*duration,
                'stanceFraction': .60, 'swingLift': .035,
                'pelvisSway': .008, 'pelvisBob': .004,
                'pelvisLowering': .012, 'forwardLeanDegrees': .5,
                'toePointDegrees': 6., 'toeRecoveryDegrees': 4.}
    if profile == 'suspended-run':
        if not math.isfinite(speed) or not 4 <= speed <= 8:
            raise ValueError('Suspended-run preview speed must be between 4 and 8.')
        blend = smooth((speed - 4) / 4)
        mix = lambda start, end: start + (end - start) * blend
        return {'profile': profile, 'speedMultiplier': speed, 'runBlend': blend,
                'fps': 120, 'durationSeconds': .9, 'frames': 108,
                'travel': (.08 / .6 / 1.5) * speed * .9,
                'stanceFraction': mix(.46, .38), 'swingLift': mix(.06, .08),
                'pelvisSway': .008, 'pelvisBob': mix(.011, .012),
                'pelvisLowering': mix(.025, .020), 'forwardLeanDegrees': mix(4.5, 5.5),
                'toePointDegrees': mix(10., 14.), 'toeRecoveryDegrees': 7.}
    if not math.isfinite(speed) or not 1 <= speed <= 4:
        raise ValueError('Preview speed must be between 1 and 4.')
    blend = smooth((speed - 1) / 3)
    mix = lambda start, end: start + (end - start) * blend
    frames = 2 * round(mix(90, 54) / 2)
    duration = frames / 60
    travel = (.08 / .6 / 1.5) * speed * duration
    return {'speedMultiplier': speed, 'runBlend': blend, 'fps': 60,
            'durationSeconds': duration, 'frames': frames, 'travel': travel,
            'stanceFraction': mix(.6, .46), 'swingLift': mix(.022, .06),
            'pelvisSway': mix(.016, .011), 'pelvisBob': mix(.007, .011),
            'pelvisLowering': mix(0, .025), 'forwardLeanDegrees': mix(.8, 4.5),
            'toePointDegrees': mix(6, 10), 'toeRecoveryDegrees': mix(4, 7)}


def foot_path(phase, p):
    stance = p['stanceFraction']
    half = p['travel'] * stance / 2
    if phase < stance:
        return -half + p['travel'] * phase, 0., 0., True
    t = (phase - stance) / (1 - stance)
    tangent = p['travel'] * (1 - stance)
    y = ((2*t**3-3*t**2+1)*half + (t**3-2*t**2+t)*tangent
         + (-2*t**3+3*t**2)*(-half) + (t**3-t**2)*tangent)
    # Smooth flex is restricted to swing; planted geometry never rotates/slides.
    knots = [(0., 0.), (.25, p['toePointDegrees']),
             (.7, -p['toeRecoveryDegrees']), (1., 0.)]
    if p.get('profile') == 'backward-walk':
        # Keep the rear edge raised while reaching backward, then flatten before
        # accepting load. Do not simply reverse the forward ankle recovery.
        knots = [(0., 0.), (.3, p['toePointDegrees']),
                 (.75, p['toeRecoveryDegrees']), (1., 0.)]
    pitch = 0.
    for (a, x), (b, z) in zip(knots, knots[1:]):
        if a <= t <= b:
            pitch = math.radians(x + (z - x) * smooth((t - a) / (b - a)))
            break
    lift = math.sin(math.pi*t)**2
    if p.get('profile') == 'suspended-run':
        # Tuck the recovering leg early and prepare the landing late. This leaves
        # visible clearance for both feet during the short interval between steps.
        lift = smoother(min(1., t/.27, (1-t)/.27))
    return y, p['swingLift'] * lift, pitch, False


def fingerprint(meshes):
    values = [(o.name, [list(v.co) for v in o.data.vertices],
               [list(p.vertices) for p in o.data.polygons]) for o in meshes]
    return hashlib.sha256(json.dumps(values, separators=(',', ':')).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True, type=Path)
    parser.add_argument('--output', required=True)
    parser.add_argument('--speed', required=True, type=float)
    parser.add_argument('--profile', choices=['scaled', 'suspended-run', 'backward-walk'], default='scaled')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if Path(args.output).name != args.output or args.output in ('.', '..'):
        raise ValueError('Output must be a new revision name.')
    p = parameters(args.speed, args.profile)
    root = args.repo.resolve()
    out = root / 'design/mechs/generated' / args.output
    approval = json.loads((root / 'design/mechs/chassis/warden/approved-interfaces.json').read_text())
    source_record = approval['artifacts']['interfaces.blend']
    source = root / source_record['path']
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_record['sha256']:
        raise RuntimeError('Approved interface source changed.')
    if out.exists():
        raise RuntimeError('Output exists; preserve it and choose a new revision.')
    if any(o.name.startswith(('rig_', 'repair_')) for o in bpy.data.objects):
        raise RuntimeError('Use a fresh Blender process.')
    out.mkdir(parents=True)
    with bpy.data.libraries.load(str(source), link=False) as (_, loaded):
        loaded.scenes = ['Warden interface trial v1']
    scene = loaded.scenes[0]
    scene.name = args.output
    bpy.context.window.scene = scene
    scene.frame_set(1)
    groups = {o.name.removeprefix('rig_'): o for o in scene.objects if o.name.startswith('rig_')}
    meshes = [o for o in scene.objects if o.type == 'MESH']
    before_geometry = fingerprint(meshes)
    before_parents = {o.name: o.parent.name if o.parent else None for o in scene.objects}
    mapping_path = root / 'design/mechs/chassis/warden/articulation-draft.json'
    mapping_hash = hashlib.sha256(mapping_path.read_bytes()).hexdigest()
    repair_record = json.loads((root / 'design/mechs/chassis/warden/repair-draft.json').read_text())
    if mapping_hash != repair_record['partMapSha256']:
        raise RuntimeError('Neutral pivot map differs from the approved repair source.')
    mapping = json.loads(mapping_path.read_text())
    rest = {g['name']: Vector(g['pivot']) for g in mapping['groups']}
    # Clear animation on this isolated loaded derivative only, restoring measured
    # neutral pivots. Mesh ownership, including the approved v10 guards, is retained.
    for name, obj in groups.items():
        obj.animation_data_clear()
        parent = obj.parent.name.removeprefix('rig_') if obj.parent else None
        obj.location = rest[name] - rest[parent] if parent else rest[name]
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = Quaternion()
    actuators = [o for o in scene.objects if o.name.endswith(('_piston_barrel', '_piston_rod'))]
    if len(actuators) != 8:
        raise RuntimeError('Expected eight piston pieces.')
    for obj in actuators:
        obj.animation_data_clear()
    bpy.context.view_layer.update()
    for part, side in [(51, 'left'), (44, 'right')]:
        if scene.objects[f'repair_shared_tripo_part_{part}'].parent != groups[f'leg_{side}_shin']:
            raise RuntimeError('Approved front-guard ownership was lost.')
    soles = {}
    for side in ['left', 'right']:
        foot = groups[f'leg_{side}_foot']
        inverse = foot.matrix_world.inverted()
        soles[side] = [inverse @ o.matrix_world @ v.co for o in meshes
                       if o.parent == foot for v in o.data.vertices]
    pelvis = groups['pelvis']
    rest_pelvis = pelvis.matrix_world.copy()
    ranges = {name: {axis: [math.inf, -math.inf] for axis in 'xyz'}
              for name in groups if name.startswith('leg_')}

    def solve(side, target, foot_rotation):
        hip0, knee0, ankle0 = [rest[f'leg_{side}_{part}'] for part in ['thigh', 'shin', 'foot']]
        first, second = knee0-hip0, ankle0-knee0
        hip = pelvis.matrix_world @ (rest_pelvis.inverted() @ hip0)
        delta = target-hip
        length, l1, l2 = delta.length, first.length, second.length
        if not abs(l1-l2) < length < l1+l2:
            raise RuntimeError(f'Unreachable {side} ankle at frame {scene.frame_current}.')
        direction = delta/length
        along = (l1*l1-l2*l2+length*length)/(2*length)
        neutral_direction = (ankle0-hip0).normalized()
        pole = first-neutral_direction*first.dot(neutral_direction)
        pole = pelvis.matrix_world.to_quaternion() @ pole
        pole = (pole-direction*pole.dot(direction)).normalized()
        knee = hip+direction*along+pole*math.sqrt(max(0, l1*l1-along*along))
        hip_world = first.rotation_difference(knee-hip)
        shin_world = second.rotation_difference(target-knee)
        rotations = [('thigh', pelvis.matrix_world.to_quaternion().inverted() @ hip_world),
                     ('shin', hip_world.inverted() @ shin_world),
                     ('foot', shin_world.inverted() @ foot_rotation)]
        for part, rotation in rotations:
            name = f'leg_{side}_{part}'
            groups[name].rotation_quaternion = rotation
            for axis, angle in zip('xyz', rotation.to_euler()):
                extent = ranges[name][axis]
                extent[0] = min(extent[0], math.degrees(angle))
                extent[1] = max(extent[1], math.degrees(angle))

    scene.render.fps = p['fps']
    scene.frame_start, scene.frame_end = 1, p['frames'] + 1
    basis = Matrix.Rotation(-math.pi/2, 4, 'X')
    samples, contacts = [], {}
    maximum_slip, maximum_target_error, maximum_rotation_error = 0., 0., 0.
    minimum_ground, minimum_overlap = math.inf, math.inf
    maximum_compression = 0.
    airborne_samples, airborne_peak_clearance = 0, 0.
    airborne_apex_clearance = []
    guards = ['repair_shared_tripo_part_' + str(i) for i in [51, 44, 53, 100, 88, 85]]
    all_rig = list(groups.values()) + actuators
    for index in range(p['frames'] + 1):
        phase, frame = index/p['frames'], index+1
        scene.frame_set(frame)
        weight = math.sin(2*math.pi*(phase-.05))
        body_height = -p['pelvisBob']*math.cos(4*math.pi*phase)
        if args.profile == 'suspended-run':
            # Compress halfway through support; crest halfway between push-off
            # and the opposite touchdown. Body and foot flight now agree.
            flight_center = (p['stanceFraction']+.5)/2
            body_height = p['pelvisBob']*math.cos(4*math.pi*(phase-flight_center))
        pelvis.location = rest['pelvis'] + Vector((p['pelvisSway']*weight, -p['travel']*phase,
            -p['pelvisLowering']+body_height))
        pitch_pulse, roll, yaw = (.3, 1.2, 2.) if args.profile in ['suspended-run', 'backward-walk'] else (.65, 2., 2.)
        pelvis.rotation_quaternion = Euler((math.radians(p['forwardLeanDegrees']+pitch_pulse*math.sin(4*math.pi*phase)),
            math.radians(roll)*weight, math.radians(yaw)*math.sin(2*math.pi*phase))).to_quaternion()
        lag = phase-.045
        groups['torso'].rotation_quaternion = Euler((math.radians(-.35-.45*math.sin(4*math.pi*lag)),
            -math.radians(1.1)*math.sin(2*math.pi*(lag-.05)), -math.radians(1.2)*math.sin(2*math.pi*lag))).to_quaternion()
        bpy.context.view_layer.update()
        targets = {}
        for side, offset in [('left', 0), ('right', .5)]:
            local_phase = (phase+offset) % 1
            y, lift, pitch, stance = foot_path(local_phase, p)
            rotation = Quaternion((1, 0, 0), pitch)
            # Account for the entire unchanged foot surface when flexing, so toes
            # and heels clear the floor without shortening either leg segment.
            support = min((rotation @ v).z for v in soles[side])
            z = max(rest[f'leg_{side}_foot'].z, -support) + lift
            target = Vector((rest[f'leg_{side}_foot'].x,
                             rest[f'leg_{side}_foot'].y+y-p['travel']*phase, z))
            solve(side, target, rotation)
            targets[side] = (target, rotation, stance, math.floor(phase+offset), pitch)
        bpy.context.view_layer.update()
        # Evaluate the same telescoping mechanism explicitly, then bake its local
        # rotations. Existing source constraints were already baked away in v2.
        for side in ['left', 'right']:
            for location, lengths in [('front', (.067, .083)), ('rear', (.095, .105))]:
                prefix = f'repair_{side}_{location}_piston_'
                top = scene.objects[prefix+'top'].matrix_world.translation.copy()
                bottom = scene.objects[prefix+'bottom'].matrix_world.translation.copy()
                distance = (top-bottom).length
                minimum_overlap = min(minimum_overlap, sum(lengths)-distance)
                maximum_compression = max(maximum_compression, max(lengths)-distance)
                if not max(lengths) < distance < sum(lengths):
                    raise RuntimeError(f'Piston stroke exceeded: {prefix}, frame {frame}, distance {distance}, range {max(lengths)}..{sum(lengths)}.')
                for label, start, end in [('barrel', top, bottom), ('rod', bottom, top)]:
                    obj = scene.objects[prefix+label]
                    # Solve in anchor-local coordinates. World-matrix decomposition
                    # amplified roundoff for nearly vertical piston directions.
                    parent = obj.parent.matrix_world @ obj.matrix_parent_inverse
                    direction = parent.to_quaternion().inverted() @ (end-start).normalized()
                    obj.location = (0, 0, 0)
                    obj.rotation_mode = 'QUATERNION'
                    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
        bpy.context.view_layer.update()
        row = {'frame': frame, 'phase': phase, 'feet': {}, 'body': {}, 'guards': {}}
        for name in ['pelvis', 'torso']:
            matrix = basis @ groups[name].matrix_world @ basis.inverted()
            row['body'][name] = [matrix[r][c] for c in range(4) for r in range(4)]
        for name in guards:
            matrix = basis @ scene.objects[name].matrix_world @ basis.inverted()
            row['guards'][name] = [matrix[r][c] for c in range(4) for r in range(4)]
        for side, (target, rotation, stance, cycle, pitch) in targets.items():
            foot = groups[f'leg_{side}_foot']
            actual = foot.matrix_world.translation.copy()
            maximum_target_error = max(maximum_target_error, (actual-target).length)
            maximum_rotation_error = max(maximum_rotation_error,
                max(abs(a-b) for a, b in zip(foot.matrix_world.to_quaternion(), rotation)))
            floor = min((foot.matrix_world @ v).z for v in soles[side])
            minimum_ground = min(minimum_ground, floor)
            key = (side, cycle)
            if stance:
                if key in contacts:
                    maximum_slip = max(maximum_slip, (actual-contacts[key]).length)
                else:
                    contacts[key] = actual.copy()
            row['feet'][side] = {'stance': stance, 'ankle': list(actual),
                'pitchRadians': pitch, 'minimumGroundHeight': floor}
        clearance = min(row['feet'][side]['minimumGroundHeight'] for side in ['left', 'right'])
        if not any(row['feet'][side]['stance'] for side in ['left', 'right']):
            airborne_peak_clearance = max(airborne_peak_clearance, clearance)
            if clearance > .002:
                airborne_samples += 1
            center = (p['stanceFraction']+.5)/2
            if abs(phase % .5-center) < .5/p['frames']:
                airborne_apex_clearance.append(clearance)
        samples.append(row)
        for obj in all_rig:
            obj.rotation_mode = 'QUATERNION'
            obj.keyframe_insert(data_path='location', frame=frame)
            obj.keyframe_insert(data_path='rotation_quaternion', frame=frame)
    if max(maximum_slip, maximum_target_error, maximum_rotation_error) > 1e-5 or minimum_ground < -1e-5:
        raise RuntimeError('Contact, reach, rotation or floor check failed.')
    if args.profile == 'suspended-run' and args.speed == 8:
        if len(airborne_apex_clearance) != 2 or min(airborne_apex_clearance) < .015:
            raise RuntimeError('Both feet must visibly clear the ground in each suspension interval.')
    if args.profile == 'backward-walk':
        if any(not any(foot['stance'] for foot in row['feet'].values()) for row in samples):
            raise RuntimeError('Backward walk must retain ground support throughout the cycle.')
    for obj in all_rig:
        for layer in obj.animation_data.action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.interpolation = 'LINEAR'
    if fingerprint(meshes) != before_geometry:
        raise RuntimeError('Source mesh geometry changed.')
    if before_parents != {o.name: o.parent.name if o.parent else None for o in scene.objects}:
        raise RuntimeError('Approved mesh/guard ownership changed.')
    scene.frame_set(1)
    for obj in scene.objects:
        obj.select_set(obj.type in ('MESH', 'EMPTY') and not obj.hide_get())
    bpy.ops.export_scene.gltf(filepath=str(out/'motion.glb'), use_selection=True, use_active_scene=True,
        export_animations=True, export_animation_mode='SCENE', export_anim_scene_split_object=False,
        export_frame_range=True, export_frame_step=1, export_bake_animation=True, export_anim_slide_to_zero=True,
        export_optimize_animation_size=False)
    bpy.data.libraries.write(str(out/'motion.blend'), {scene})
    report = {'status': 'motion-preview-unapproved', 'revision': 'speed-scaled-ankle-flex-v1',
        'sourceSha256': source_record['sha256'], 'sourceApproval': approval['id'],
        'partMapSha256': mapping_hash,
        'geometrySha256': before_geometry, 'parameters': p, 'rootTravelPerCycle': p['travel'],
        'maximumStanceSlip': maximum_slip, 'maximumTargetError': maximum_target_error,
        'maximumFootRotationError': maximum_rotation_error, 'minimumGroundHeight': minimum_ground,
        'minimumActuatorOverlap': minimum_overlap, 'maximumActuatorCompression': maximum_compression,
        'airborneSamplesAbove002': airborne_samples,
        'airbornePeakClearance': airborne_peak_clearance,
        'airborneApexClearance': airborne_apex_clearance,
        'jointRangesXYZDegrees': ranges, 'samples': samples,
        'limitations': ['New motion requires owner review', 'Straight level-ground clips only',
            'Root-motion playback needs runtime integration', 'Mechanical clearance remains a separate review',
            'Speed interpolation generates each clip; live acceleration transitions are not implemented']}
    (out/'gait-report.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['samples', 'jointRangesXYZDegrees']}))


if __name__ == '__main__':
    main()
