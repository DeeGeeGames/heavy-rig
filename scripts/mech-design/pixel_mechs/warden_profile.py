"""Fit the Warden's leaning torso and square gun arms to its existing rig.

The selected export was shaped in two passes on the packed vertex streams. Keep
that order and its float32 rounding so the production rebuild reproduces it.
"""

import math
import struct

from .export import ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, Buffers, primitive, read_rows
from .geometry import PlateMesh, average, clipped_rect, minus, ring_z


def stored_bounds(buffers, index):
    vertices = read_rows(buffers, index)
    buffers.accessors[index].update(min=list(map(min, zip(*vertices))), max=list(map(max, zip(*vertices))))


def transform_vec3(buffers, index, transform):
    accessor = buffers.accessors[index]
    offset = buffers.views[accessor["bufferView"]]["byteOffset"]
    for i, vector in enumerate(read_rows(buffers, index)):
        struct.pack_into("<3f", buffers.data, offset + i * 12, *transform(*vector))
    if "min" in accessor:
        stored_bounds(buffers, index)


def normalized(x, y, z):
    length = math.hypot(x, y, z)
    return (x / length, y / length, z / length)


def nose_facets(triangle, hinge):
    """Split a facet at the start of the nose taper; keep vertex winding on each side."""
    if max(p[2] for p in triangle) <= hinge:
        yield triangle, False
        return
    if min(p[2] for p in triangle) >= hinge:
        yield triangle, True
        return
    for front in (False, True):
        polygon = []
        for a, b in zip(triangle, triangle[1:] + triangle[:1]):
            keep = a[2] >= hinge if front else a[2] <= hinge
            if keep:
                polygon.append(a)
            if (a[2] - hinge) * (b[2] - hinge) < 0:
                t = (hinge - a[2]) / (b[2] - a[2])
                polygon.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, hinge))
        yield polygon, front


def shape_nose(buffers, surface, floor, hinge, stretch):
    """Elongate the prow and lower the roof, including its coplanar paint and glazing."""
    attributes = surface["attributes"]
    positions = read_rows(buffers, attributes["POSITION"])
    normals = read_rows(buffers, attributes["NORMAL"])
    colors = read_rows(buffers, attributes["COLOR_0"])
    indices = [index for (index,) in read_rows(buffers, surface["indices"])]
    vertices = {}
    new_indices = []
    height = 0.88
    for i in range(0, len(indices), 3):
        a, b, c = indices[i : i + 3]
        if not (normals[a] == normals[b] == normals[c] and colors[a] == colors[b] == colors[c]):
            raise ValueError("Warden torso facets must have flat shading and a single paint color")
        triangle = [positions[a], positions[b], positions[c]]
        nx, ny, nz = normals[a]
        for polygon, front in nose_facets(triangle, hinge):
            normal = normalized(nx, ny / height, nz / stretch if front else nz)
            corners = []
            for x, y, z in polygon:
                point = (x, floor + (y - floor) * height, hinge + (z - hinge) * stretch if front else z)
                corners.append(vertices.setdefault((point, normal, colors[a]), len(vertices)))
            for j in range(1, len(corners) - 1):
                new_indices.extend([(corners[0],), (corners[j],), (corners[j + 1],)])
    new_positions, new_normals, new_colors = zip(*vertices)
    attributes["POSITION"] = buffers.attribute(new_positions, "f", "VEC3", ARRAY_BUFFER, bounds=True)
    attributes["NORMAL"] = buffers.attribute(new_normals, "f", "VEC3", ARRAY_BUFFER, bounds=True)
    attributes["COLOR_0"] = buffers.attribute(new_colors, "B", "VEC4", ARRAY_BUFFER, normalized=True)
    surface["indices"] = buffers.attribute(new_indices, "H", "SCALAR", ELEMENT_ARRAY_BUFFER)


def gun_arm(mesh, side, sign):
    mesh.section = f"geometry_rig_mount_{side}-gun"
    x, y, z = mesh.anchor(f"physical_exit_{side}_gun_1")
    mesh.cylinder((sign * 228, 689, -116), (x, 689, -116), 41, "joint", 10)
    mesh.hull_z(
        [
            (-276, x, 593, 692, 139, 9, 10),
            (-209, x, 560, 716, 168, 12, 15),
            (-82, x, 566, 716, 165, 12, 14),
            (84, x, 578, 688, 132, 10, 10),
            (143, x, 596, 658, 94, 8, 8),
        ],
        lambda i, j: "deep" if j in (0, 1, 7) else "armor" if j in (2, 6) else "plate",
        ("deep", "cast"),
    )
    mesh.cylinder((x + sign * 75, 641, -141), (x + sign * 90, 641, -141), 41, "joint", 10)
    mesh.cylinder((x + sign * 89, 641, -141), (x + sign * 94, 641, -141), 29, "cast", 10)
    mesh.hull_z(
        [(-186, x, 706, 726, 123, 7, 5), (-86, x, 706, 726, 127, 7, 5), (-11, x, 692, 708, 109, 5, 4)],
        "cheek", ("deep", "frame"),
    )
    mesh.cylinder((x, y, 96), (x, y, 290), 25, "frame")
    mesh.cylinder((x, y, 136), (x, y, 185), 33, "cast")
    mesh.cylinder((x, y, 181), (x, y, 195), 35, "plate")
    sleeve = [
        (264, x, y - 27, y + 27, 54, 5, 5),
        (294, x, y - 29, y + 29, 61, 5, 5),
        (z, x, y - 25, y + 25, 54, 4, 4),
    ]
    mesh.hull_z(sleeve, "frame", ("cast", None))
    edge = ring_z(sleeve[-1])
    opening = [(u, v, z) for u, v in clipped_rect(x, y, 34, 31, 3, 3)]
    inside = [(u, v, z - 23) for u, v, _ in opening]
    for j in range(8):
        k = (j + 1) % 8
        mesh.face([edge[j], edge[k], opening[k], opening[j]], (0, 0, 1), "cheek")
        wall = [opening[j], opening[k], inside[k], inside[j]]
        mesh.face(wall, minus((x, y, z - 11), average(wall)), "joint")
    mesh.face(inside, (0, 0, 1), "bore")


def finish_warden(document, binary, mesh, palette):
    buffers = Buffers()
    buffers.data = binary
    buffers.views = document["bufferViews"]
    buffers.accessors = document["accessors"]

    def surfaces(name):
        node = document["nodes"][mesh.by_name[name]]
        return document["meshes"][node["mesh"]]["primitives"]

    # The inboard ends of the supports reach into the narrower torso at the same pivots.
    for surface in surfaces("geometry_mount_connections"):
        transform_vec3(
            buffers, surface["attributes"]["POSITION"],
            lambda x, y, z: (x - math.copysign(max(0, 0.213 - abs(x)) * 1.5, x), y, z),
        )
    torso = surfaces("geometry_rig_torso")
    for surface in torso:
        attributes = surface["attributes"]
        transform_vec3(
            buffers, attributes["POSITION"], lambda x, y, z: (x * 0.64, y * 0.93 + 0.025 * z + 0.006, z * 0.75)
        )
        transform_vec3(
            buffers, attributes["NORMAL"],
            lambda x, y, z: normalized(x / 0.64, y / 0.93, (z - 0.025 * y / 0.93) / 0.75),
        )
    extents = [buffers.accessors[surface["attributes"]["POSITION"]] for surface in torso]
    floor = min(a["min"][1] for a in extents)
    tip = max(a["max"][2] for a in extents)
    hinge = 0.107
    stretch = 1 + tip * 0.25 / (tip - hinge)
    for surface in torso:
        shape_nose(buffers, surface, floor, hinge, stretch)

    arms = PlateMesh(mesh.nodes, palette)
    for side, sign in (("left", 1), ("right", -1)):
        gun_arm(arms, side, sign)
        pivot = arms.anchor(f"rig_mount_{side}-gun")
        target, = surfaces(arms.section)
        refined = primitive(buffers, arms.sections[arms.section][0], 0, pivot)
        # The selected arm bounds were read from the packed float32 geometry.
        for key in ("POSITION", "NORMAL"):
            stored_bounds(buffers, refined["attributes"][key])
        target.update(refined)
