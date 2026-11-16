"""Candidate Kestrel locomotion using its measured pivots and actual foot soles.

The shared Hermite foot-path function supplies curve mathematics only. Kestrel
timing, strides and body motion below are provisional authoring choices, not
Warden gait approval or runtime/hardware acceptance.
"""

import math
import struct

from mathutils import Euler, Matrix, Quaternion, Vector
from locomotion_trial import foot_path
from rigid_packaging import accessor_values


def add_candidate_motions(document, source_binary, indices, rest, bindings):
    basis = Matrix.Rotation(-math.pi / 2, 4, "X")
    inverse = basis.inverted()
    soles = {side: [] for side in ("left", "right")}
    for binding in bindings:
        for side in soles:
            owner = f"rig_leg_{side}_foot"
            if binding["owner"] != owner:
                continue
            for primitive in document["meshes"][binding["node"]["mesh"]]["primitives"]:
                for point in accessor_values(document, source_binary, primitive["attributes"]["POSITION"]):
                    soles[side].append(inverse @ (binding["matrix"] @ Vector(point)) - rest[owner])
    if any(not points for points in soles.values()):
        raise ValueError("Kestrel motion requires the actual exported feet")
    binary = bytearray(source_binary)

    def floats(rows, width):
        binary.extend(b"\0" * (-len(binary) % 4))
        start = len(binary)
        values = [float(value) for row in rows for value in row]
        if not all(math.isfinite(value) for value in values):
            raise ValueError("Non-finite Kestrel animation")
        binary.extend(struct.pack("<" + "f" * len(values), *values))
        view = len(document["bufferViews"])
        document["bufferViews"].append({"buffer": 0, "byteOffset": start, "byteLength": len(values) * 4})
        index = len(document["accessors"])
        accessor = {"bufferView": view, "componentType": 5126, "count": len(rows),
                    "type": {1: "SCALAR", 3: "VEC3", 4: "VEC4"}[width]}
        if width == 1:
            accessor.update(min=[min(values)], max=[max(values)])
        document["accessors"].append(accessor)
        return index

    configurations = {
        "walk": {"frames": 60, "travel": .18, "stanceFraction": .62, "swingLift": .04,
                 "toePointDegrees": 6, "toeRecoveryDegrees": 4, "lower": .008, "bob": .004,
                 "lean": 1.0, "profile": "kestrel-walk"},
        "run": {"frames": 48, "travel": .32, "stanceFraction": .44, "swingLift": .075,
                "toePointDegrees": 9, "toeRecoveryDegrees": 6, "lower": .015, "bob": .009,
                "lean": 3.0, "profile": "suspended-run"},
        "backward": {"frames": 72, "travel": -.14, "stanceFraction": .64, "swingLift": .035,
                     "toePointDegrees": 6, "toeRecoveryDegrees": 4, "lower": .008, "bob": .003,
                     "lean": .3, "profile": "backward-walk"},
    }
    reports = {}
    animated = ["rig_pelvis", "rig_torso"] + [f"rig_leg_{side}_{part}"
                for side in ("left", "right") for part in ("thigh", "shin", "foot")]
    for name, parameters in configurations.items():
        frames, fps = parameters["frames"], 60
        rows = {group: [] for group in animated}
        translations, times, samples = [], [], []
        contacts = {}
        error, slip, floor = 0.0, 0.0, math.inf
        for frame in range(frames + 1):
            phase = frame / frames
            height = -parameters["bob"] * math.cos(4 * math.pi * phase)
            if name == "run":
                flight_center = (parameters["stanceFraction"] + .5) / 2
                height = parameters["bob"] * math.cos(4 * math.pi * (phase - flight_center))
            pelvis = rest["rig_pelvis"] + Vector((0, 0, -parameters["lower"] + height))
            body_q = Euler((math.radians(parameters["lean"]), 0, 0)).to_quaternion()
            rotations = {group: Quaternion() for group in animated}
            rotations["rig_pelvis"] = body_q
            rotations["rig_torso"] = Quaternion((1, 0, 0), math.radians(-.4 * math.sin(4 * math.pi * phase)))
            sample = {"phase": phase, "feet": {}}
            for side, offset in [("left", 0), ("right", .5)]:
                y, lift, pitch, stance = foot_path((phase + offset) % 1, parameters)
                foot_q = Quaternion((1, 0, 0), pitch)
                support = min((foot_q @ point).z for point in soles[side])
                hip0, knee0, ankle0 = [rest[f"rig_leg_{side}_{part}"]
                                       for part in ("thigh", "shin", "foot")]
                target = Vector((ankle0.x, ankle0.y + y, max(ankle0.z, -support) + lift))
                first, second = knee0 - hip0, ankle0 - knee0
                hip = pelvis + body_q @ (hip0 - rest["rig_pelvis"])
                delta = target - hip
                length, upper, lower = delta.length, first.length, second.length
                if not abs(upper - lower) + 1e-7 < length < upper + lower - 1e-7:
                    raise ValueError(f"Unreachable Kestrel {name}/{side} target at phase {phase}")
                direction = delta / length
                along = (upper * upper - lower * lower + length * length) / (2 * length)
                neutral = (ankle0 - hip0).normalized()
                pole = body_q @ (first - neutral * first.dot(neutral))
                pole -= direction * pole.dot(direction)
                if pole.length < 1e-7:
                    raise ValueError("Degenerate Kestrel knee pole")
                pole.normalize()
                knee = hip + direction * along + pole * math.sqrt(max(0, upper * upper - along * along))
                hip_world = first.rotation_difference(knee - hip)
                shin_world = second.rotation_difference(target - knee)
                rotations[f"rig_leg_{side}_thigh"] = body_q.inverted() @ hip_world
                rotations[f"rig_leg_{side}_shin"] = hip_world.inverted() @ shin_world
                rotations[f"rig_leg_{side}_foot"] = shin_world.inverted() @ foot_q
                actual = hip + hip_world @ first + shin_world @ second
                error = max(error, (actual - target).length)
                minimum = min((foot_q @ point + actual).z for point in soles[side])
                floor = min(floor, minimum)
                world = actual + Vector((0, -parameters["travel"] * phase, 0))
                key = (side, math.floor(phase + offset))
                if stance:
                    if key in contacts:
                        slip = max(slip, (world - contacts[key]).length)
                    else:
                        contacts[key] = world.copy()
                sample["feet"][side] = {"stance": stance, "ankle": list(actual), "minimumHeight": minimum}
            translations.append(list(basis @ pelvis))
            times.append([frame / fps])
            for group, rotation in rotations.items():
                q = (basis.to_3x3() @ rotation.to_matrix() @ inverse.to_3x3()).to_quaternion()
                values = [q.x, q.y, q.z, q.w]
                if rows[group] and sum(a * b for a, b in zip(rows[group][-1], values)) < 0:
                    values = [-value for value in values]
                rows[group].append(values)
            samples.append(sample)
        if error > 1e-5 or slip > 1e-5 or floor < -1e-5:
            raise ValueError(f"Failed Kestrel {name} analytical reach/contact/ground check")
        animation = {"name": name, "samplers": [], "channels": [], "extras": {
            "inPlace": True, "approvalStatus": "candidate-unapproved", "virtualTravelPerCycle": parameters["travel"],
            "nominalForwardSpeed": parameters["travel"] / (frames / fps),
            "removedRootMotion": [0, 0, parameters["travel"]], "sourceGaitProfile": parameters["profile"],
        }}
        time_accessor = floats(times, 1)

        def track(group, path, values, width):
            sampler = len(animation["samplers"])
            animation["samplers"].append({"input": time_accessor, "output": floats(values, width), "interpolation": "LINEAR"})
            animation["channels"].append({"sampler": sampler, "target": {"node": indices[group], "path": path}})

        track("rig_pelvis", "translation", translations, 3)
        for group in animated:
            track(group, "rotation", rows[group], 4)
        document.setdefault("animations", []).append(animation)
        reports[name] = {"parameters": parameters, "fps": fps, "duration": frames / fps,
                         "maximumTargetError": error, "maximumVirtualStanceSlip": slip,
                         "minimumGroundHeight": floor, "samples": samples,
                         "scope": "Analytical authoring checks only; actual exported motion, actuator endpoints, clearance and owner feel need review."}
    return binary, reports
