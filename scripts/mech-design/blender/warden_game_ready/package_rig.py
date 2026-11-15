"""Attach labeled neutral geometry to a rigid hierarchy and retarget Warden gait.

Run with Blender 5.2 --background --factory-startup --python this.py --
--repo ROOT --input geometry.glb --contract rig-contract.json --output NEW_FOLDER.
Input contract uses Blender Z-up/-Y-forward world coordinates. Mesh ownership is
explicit in meshGroups, or inherited from a rig_* ancestor/name. Sources remain
unchanged. Existing approved gait parameters/foot-path/IK direction are reused;
new limb lengths and actual sole geometry determine joint rotations and contacts.
"""

import argparse, copy, hashlib, json, math, runpy, struct, sys
from pathlib import Path
from mathutils import Euler, Matrix, Quaternion, Vector


def read_glb(path):
    data = path.read_bytes()
    if struct.unpack_from("<II", data, 0) != (0x46546C67, 2):
        raise ValueError("Expected GLB2")
    length, kind = struct.unpack_from("<II", data, 12)
    if kind != 0x4E4F534A:
        raise ValueError("Missing JSON chunk")
    document = json.loads(data[20 : 20 + length])
    offset = 20 + length
    bin_length, bin_kind = struct.unpack_from("<II", data, offset)
    if bin_kind != 0x004E4942:
        raise ValueError("Missing BIN chunk")
    binary = data[offset + 8 : offset + 8 + bin_length]
    if len(document.get("buffers", [])) != 1:
        raise ValueError("Expected single embedded buffer")
    return document, binary[: document["buffers"][0]["byteLength"]]


def write_glb(path, document, binary):
    document["buffers"] = [{"byteLength": len(binary)}]
    body = json.dumps(document, separators=(",", ":"), allow_nan=False).encode()
    body += b" " * (-len(body) % 4)
    binary += b"\0" * (-len(binary) % 4)
    path.write_bytes(
        struct.pack("<III", 0x46546C67, 2, 28 + len(body) + len(binary))
        + struct.pack("<II", len(body), 0x4E4F534A)
        + body
        + struct.pack("<II", len(binary), 0x004E4942)
        + binary
    )


def local_matrix(node):
    if "matrix" in node:
        return Matrix(
            tuple(
                tuple(node["matrix"][col * 4 + row] for col in range(4))
                for row in range(4)
            )
        )
    q = node.get("rotation", [0, 0, 0, 1])
    return Matrix.LocRotScale(
        Vector(node.get("translation", [0, 0, 0])),
        Quaternion((q[3], q[0], q[1], q[2])),
        Vector(node.get("scale", [1, 1, 1])),
    )


def column_major(matrix):
    return [matrix[row][col] for col in range(4) for row in range(4)]


def accessor_values(document, binary, identifier):
    a = document["accessors"][identifier]
    if a.get("sparse"):
        raise ValueError("Sparse accessors not supported in authoring input")
    view = document["bufferViews"][a["bufferView"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    code = {5121: "B", 5123: "H", 5125: "I", 5126: "f"}[a["componentType"]]
    fmt = "<" + code * width
    stride = view.get("byteStride", struct.calcsize(fmt))
    start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
    return [
        struct.unpack_from(fmt, binary, start + i * stride) for i in range(a["count"])
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--contract", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])
    root = args.repo.resolve()
    output = args.output.resolve()
    if output.exists():
        raise ValueError("Output folder must be new")
    if not output.is_relative_to(root / "design/mechs/generated"):
        raise ValueError("Candidate output must be under ignored generated directory")
    contract = json.loads(args.contract.read_text())

    def canonical_anchor(name):
        name = name.removesuffix("__export")
        if name in ("physical_exit_left_gun", "physical_exit_right_gun"):
            name += "_1"
        return name

    for anchor in contract.get("anchors", []):
        anchor["name"] = canonical_anchor(anchor["name"])
        anchor["parent"] = canonical_anchor(anchor["parent"])
    source, source_binary = read_glb(args.input)
    geometry_hash = hashlib.sha256(args.input.read_bytes()).hexdigest()
    basis = Matrix.Rotation(-math.pi / 2, 4, "X")
    inverse_basis = basis.inverted()
    expected = (
        {"rig_pelvis", "rig_torso"}
        | {
            f"rig_leg_{side}_{part}"
            for side in ("left", "right")
            for part in ("thigh", "shin", "foot")
        }
        | {
            f"rig_mount_{side}-{family}"
            for side in ("left", "right")
            for family in ("gun", "shoulder bank")
        }
    )
    groups = {item["name"]: item for item in contract["groups"]}
    if set(groups) != expected:
        raise ValueError("Expected exact twelve rigid motion groups")
    rest = {name: Vector(item["pivot"]) for name, item in groups.items()}
    if any(
        len(item["pivot"]) != 3 or not all(math.isfinite(v) for v in item["pivot"])
        for item in groups.values()
    ):
        raise ValueError("Finite three-component pivots required")
    for name, item in groups.items():
        parent = item["parent"]
        if parent is not None and parent not in groups:
            raise ValueError("Missing parent " + str(parent))
    # Preserve only geometry/material resources from the candidate input. Source
    # motion geometry is never appended. glTF Transform prunes unused resources.
    document = copy.deepcopy(source)
    document.pop("animations", None)
    document.pop("skins", None)
    document["asset"] = {
        "version": "2.0",
        "generator": "Heavy Rig rigid Warden game-asset packager",
    }
    document["nodes"] = []
    document["scenes"] = [{"name": "Warden", "nodes": []}]
    document["scene"] = 0
    node_indices = {}
    for name in groups:
        node_indices[name] = len(document["nodes"])
        parent = groups[name]["parent"]
        translation = basis @ (
            rest[name] - (rest[parent] if parent else Vector((0, 0, 0)))
        )
        document["nodes"].append(
            {
                "name": name,
                "translation": list(translation),
                "children": [],
                "extras": {
                    "role": "rigid-motion-group",
                    "sourceDirection": "Blender Z-up/-Y-forward",
                },
            }
        )
    for name, index in node_indices.items():
        parent = groups[name]["parent"]
        if parent:
            document["nodes"][node_indices[parent]]["children"].append(index)
        else:
            document["scenes"][0]["nodes"].append(index)
    source_parents = {}
    for index, node in enumerate(source["nodes"]):
        for child in node.get("children", []):
            if child in source_parents:
                raise ValueError("Shared input node parents are unsupported")
            source_parents[child] = index
    world_cache = {}

    def world(index):
        if index not in world_cache:
            own = local_matrix(source["nodes"][index])
            world_cache[index] = (
                world(source_parents[index]) @ own if index in source_parents else own
            )
        return world_cache[index]

    assignments = contract.get("meshGroups", {})
    connectors = {item["meshName"]: item for item in contract.get("connectors", [])}
    owned = {name: [] for name in groups}
    soles = {side: [] for side in ("left", "right")}
    for index, node in enumerate(source["nodes"]):
        if "mesh" not in node:
            continue
        ancestor = index
        owner = assignments.get(node.get("name", "")) or node.get("extras", {}).get(
            "rigGroup"
        )
        while not owner:
            ancestor_name = source["nodes"][ancestor].get("name", "")
            if ancestor_name in groups:
                owner = ancestor_name
                break
            if ancestor not in source_parents:
                break
            ancestor = source_parents[ancestor]
        if owner not in groups:
            raise ValueError("Unassigned mesh " + node.get("name", str(index)))
        matrix = world(index)
        pivot_glb = basis @ rest[owner]
        local = Matrix.Translation(-pivot_glb) @ matrix
        child = {
            "name": "geometry_" + node.get("name", str(index)),
            "mesh": node["mesh"],
            "matrix": column_major(local),
            "extras": {"rigGroup": owner, "sourceNode": node.get("name", str(index))},
        }
        connector = connectors.get(node.get("name", ""))
        if connector is not None:
            control_index = len(document["nodes"])
            control = {
                "name": connector["node"],
                "matrix": column_major(local),
                "children": [control_index + 1],
                "extras": dict(connector, role="dynamic-mount-connection"),
            }
            child["matrix"] = column_major(Matrix.Identity(4))
            document["nodes"][node_indices[owner]]["children"].append(control_index)
            document["nodes"].append(control)
            document["nodes"].append(child)
            node_indices[connector["node"]] = control_index
        else:
            document["nodes"][node_indices[owner]]["children"].append(
                len(document["nodes"])
            )
            document["nodes"].append(child)
        owned[owner].append(child["name"])
        for side in ("left", "right"):
            if owner != f"rig_leg_{side}_foot":
                continue
            for primitive in source["meshes"][node["mesh"]]["primitives"]:
                for point in accessor_values(
                    source, source_binary, primitive["attributes"]["POSITION"]
                ):
                    soles[side].append(
                        inverse_basis @ (matrix @ Vector(point)) - rest[owner]
                    )
    if any(not value for value in owned.values()):
        raise ValueError("Each of twelve motion groups must own geometry")
    if any(not value for value in soles.values()):
        raise ValueError("Foot geometry needed for ground/sole checks")
    anchor_world_positions = dict(rest)
    for anchor in contract.get("anchors", []):
        name, parent = anchor["name"], anchor["parent"]
        if name in node_indices or parent not in node_indices:
            raise ValueError("Duplicate anchor or missing parent " + name)
        translation = basis @ (
            Vector(anchor["worldPosition"]) - anchor_world_positions[parent]
        )
        node = {
            "name": name,
            "translation": list(translation),
            "extras": anchor.get("extras", {}),
        }
        if "direction" in anchor:
            node["extras"]["forwardDirection"] = list(
                basis.to_3x3() @ Vector(anchor["direction"])
            )
        document["nodes"][node_indices[parent]]["children"].append(
            len(document["nodes"])
        )
        node_indices[name] = len(document["nodes"])
        document["nodes"].append(node)
        anchor_world_positions[name] = Vector(anchor["worldPosition"])
    library = runpy.run_path(
        str(root / "scripts/mech-design/blender/locomotion_trial.py")
    )
    binary = bytearray(source_binary)
    document.setdefault("bufferViews", [])
    document.setdefault("accessors", [])

    def append_floats(values, width):
        binary.extend(b"\0" * (-len(binary) % 4))
        start = len(binary)
        flat = [float(v) for row in values for v in row]
        if not all(math.isfinite(v) for v in flat):
            raise ValueError("Non-finite animation values")
        binary.extend(struct.pack("<" + "f" * len(flat), *flat))
        view = len(document["bufferViews"])
        document["bufferViews"].append(
            {"buffer": 0, "byteOffset": start, "byteLength": 4 * len(flat)}
        )
        identifier = len(document["accessors"])
        accessor = {
            "bufferView": view,
            "componentType": 5126,
            "count": len(values),
            "type": {1: "SCALAR", 3: "VEC3", 4: "VEC4"}[width],
        }
        if width == 1:
            accessor.update(min=[min(flat)], max=[max(flat)])
        document["accessors"].append(accessor)
        return identifier

    def glb_quaternion(q):
        result = (
            basis.to_3x3() @ q.to_matrix() @ inverse_basis.to_3x3()
        ).to_quaternion()
        return [result.x, result.y, result.z, result.w]

    reports = {}
    for clip_name, speed, profile in [
        ("walk", 4, "scaled"),
        ("run", 8, "suspended-run"),
        ("backward", 3, "backward-walk"),
    ]:
        p = library["parameters"](speed, profile)
        stride_scale = float(contract.get("strideScale", 1))
        p["travel"] *= stride_scale
        rows = {name: [] for name in groups}
        translations, times, samples = [], [], []
        ground_minimum, maximum_error, maximum_slip = math.inf, 0.0, 0.0
        contacts = {}
        for index in range(p["frames"] + 1):
            phase = index / p["frames"]
            weight = math.sin(2 * math.pi * (phase - 0.05))
            body_height = -p["pelvisBob"] * math.cos(4 * math.pi * phase)
            if profile == "suspended-run":
                flight_center = (p["stanceFraction"] + 0.5) / 2
                body_height = p["pelvisBob"] * math.cos(
                    4 * math.pi * (phase - flight_center)
                )
            pelvis_position = rest["rig_pelvis"] + Vector(
                (
                    p["pelvisSway"] * weight,
                    0,
                    -p["pelvisLowering"]
                    + body_height
                    + float(contract.get("pelvisHeightOffset", 0)),
                )
            )
            pitch_pulse, roll, yaw = (
                (0.3, 1.2, 2.0)
                if profile in ["suspended-run", "backward-walk"]
                else (0.65, 2.0, 2.0)
            )
            pelvis_q = Euler(
                (
                    math.radians(
                        p["forwardLeanDegrees"]
                        + pitch_pulse * math.sin(4 * math.pi * phase)
                    ),
                    math.radians(roll) * weight,
                    math.radians(yaw) * math.sin(2 * math.pi * phase),
                )
            ).to_quaternion()
            lag = phase - 0.045
            torso_q = Euler(
                (
                    math.radians(-0.35 - 0.45 * math.sin(4 * math.pi * lag)),
                    -math.radians(1.1) * math.sin(2 * math.pi * (lag - 0.05)),
                    -math.radians(1.2) * math.sin(2 * math.pi * lag),
                )
            ).to_quaternion()
            rotations = {name: Quaternion() for name in groups}
            rotations["rig_pelvis"] = pelvis_q
            rotations["rig_torso"] = torso_q
            sample = {"phase": phase, "feet": {}}
            for side, offset in [("left", 0), ("right", 0.5)]:
                local_phase = (phase + offset) % 1
                y, lift, pitch, stance = library["foot_path"](local_phase, p)
                foot_q = Quaternion((1, 0, 0), pitch)
                support = min((foot_q @ v).z for v in soles[side])
                hip0, knee0, ankle0 = [
                    rest[f"rig_leg_{side}_{part}"] for part in ("thigh", "shin", "foot")
                ]
                target = Vector(
                    (ankle0.x, ankle0.y + y, max(ankle0.z, -support) + lift)
                )
                first, second = knee0 - hip0, ankle0 - knee0
                hip = pelvis_position + pelvis_q @ (hip0 - rest["rig_pelvis"])
                delta = target - hip
                length, l1, l2 = delta.length, first.length, second.length
                if not abs(l1 - l2) + 1e-7 < length < l1 + l2 - 1e-7:
                    raise ValueError(
                        f"Unreachable {clip_name}/{side} target at phase{phase}: {length}, allowed{abs(l1-l2)}..{l1+l2}"
                    )
                direction = delta / length
                along = (l1 * l1 - l2 * l2 + length * length) / (2 * length)
                neutral_direction = (ankle0 - hip0).normalized()
                pole = pelvis_q @ (
                    first - neutral_direction * first.dot(neutral_direction)
                )
                pole = pole - direction * pole.dot(direction)
                if pole.length < 1e-6:
                    raise ValueError("Degenerate knee pole")
                pole.normalize()
                knee = (
                    hip
                    + direction * along
                    + pole * math.sqrt(max(0, l1 * l1 - along * along))
                )
                hip_world = first.rotation_difference(knee - hip)
                shin_world = second.rotation_difference(target - knee)
                rotations[f"rig_leg_{side}_thigh"] = pelvis_q.inverted() @ hip_world
                rotations[f"rig_leg_{side}_shin"] = hip_world.inverted() @ shin_world
                rotations[f"rig_leg_{side}_foot"] = shin_world.inverted() @ foot_q
                actual = hip + hip_world @ first + shin_world @ second
                maximum_error = max(maximum_error, (actual - target).length)
                floor = min((foot_q @ v + actual).z for v in soles[side])
                ground_minimum = min(ground_minimum, floor)
                key = (side, math.floor(phase + offset))
                virtual_travel = actual + Vector((0, -p["travel"] * phase, 0))
                if stance:
                    if key in contacts:
                        maximum_slip = max(
                            maximum_slip, (virtual_travel - contacts[key]).length
                        )
                    else:
                        contacts[key] = virtual_travel.copy()
                sample["feet"][side] = {
                    "ankle": list(actual),
                    "stance": stance,
                    "minimumGroundHeight": floor,
                }
            translations.append(list(basis @ pelvis_position))
            times.append([index / p["fps"]])
            for name, rotation in rotations.items():
                values = glb_quaternion(rotation)
                if (
                    rows[name]
                    and sum(a * b for a, b in zip(rows[name][-1], values)) < 0
                ):
                    values = [-v for v in values]
                rows[name].append(values)
            samples.append(sample)
        if maximum_error > 1e-5 or maximum_slip > 1e-5 or ground_minimum < -1e-5:
            raise ValueError("Failed retargeted contact/reach/ground invariant")
        animation = {
            "name": clip_name,
            "samplers": [],
            "channels": [],
            "extras": {
                "inPlace": True,
                "sourceGaitProfile": profile,
                "speedMultiplier": speed,
                "virtualTravelPerCycle": p["travel"],
                "nominalForwardSpeed": p["travel"] / p["durationSeconds"],
                "nativeUnitsPerSecond": abs(p["travel"] / p["durationSeconds"]),
                "removedRootMotion": [0, 0, p["travel"]],
            },
        }
        time_accessor = append_floats(times, 1)

        def track(node_name, path, values, width):
            sampler = len(animation["samplers"])
            animation["samplers"].append(
                {
                    "input": time_accessor,
                    "output": append_floats(values, width),
                    "interpolation": "LINEAR",
                }
            )
            animation["channels"].append(
                {
                    "sampler": sampler,
                    "target": {"node": node_indices[node_name], "path": path},
                }
            )

        track("rig_pelvis", "translation", translations, 3)
        for name in ("rig_pelvis", "rig_torso") + tuple(
            f"rig_leg_{side}_{part}"
            for side in ("left", "right")
            for part in ("thigh", "shin", "foot")
        ):
            track(name, "rotation", rows[name], 4)
        document.setdefault("animations", []).append(animation)
        reports[clip_name] = {
            "frames": p["frames"] + 1,
            "fps": p["fps"],
            "duration": p["durationSeconds"],
            "parameters": p,
            "minimumGroundHeight": ground_minimum,
            "maximumTargetError": maximum_error,
            "maximumVirtualStanceSlip": maximum_slip,
            "rootHorizontalTravel": 0,
            "nominalForwardSpeed": p["travel"] / p["durationSeconds"],
            "nativeUnitsPerSecond": abs(p["travel"] / p["durationSeconds"]),
            "removedRootMotion": [0, 0, p["travel"]],
            "samples": samples,
        }
    document["extras"] = {
        "chassisId": "warden",
        "coordinateSystem": "glTF Y-up,+Z-forward,+X-own-left",
        "neutralHeight": contract.get("neutralHeight"),
        "rigContractVersion": 1,
        "sourceGeometrySha256": geometry_hash,
        "rigMotionSource": "Approved Warden locomotion recipe, retargeted to measured candidate pivots and soles",
        "inPlaceClips": True,
        "mountConnections": contract.get("connectors", []),
    }
    output.mkdir(parents=True)
    write_glb(output / "warden.glb", document, binary)
    report = {
        "geometryInput": str(args.input.resolve()),
        "geometrySha256": geometry_hash,
        "gaitRecipe": {
            "path": "scripts/mech-design/blender/locomotion_trial.py",
            "sha256": hashlib.sha256(
                (root / "scripts/mech-design/blender/locomotion_trial.py").read_bytes()
            ).hexdigest(),
        },
        "contractSha256": hashlib.sha256(args.contract.read_bytes()).hexdigest(),
        "outputSha256": hashlib.sha256(
            (output / "warden.glb").read_bytes()
        ).hexdigest(),
        "outputBytes": (output / "warden.glb").stat().st_size,
        "groups": groups,
        "ownedMeshNodes": owned,
        "anchors": contract.get("anchors", []),
        "connectors": contract.get("connectors", []),
        "clips": reports,
        "sourceGeometryUnchanged": hashlib.sha256(args.input.read_bytes()).hexdigest()
        == geometry_hash,
        "scope": "Retargeted existing authored gait using new rigid anatomy; no claim of owner acceptance or exhaustive clearance.",
    }
    (output / "rig-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                key: value
                for key, value in report.items()
                if key not in ("groups", "ownedMeshNodes", "anchors", "clips")
            },
            indent=2,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
