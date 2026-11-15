"""Six explicit louvre inserts replacing overlapping P2 vent slivers.

Coordinates belong to the frozen Warden P2 source. Frames remain untouched.
Each insert has a recessed dark backing and six separate structural slats;
visible surfaces are separated in depth rather than using a depth-bias shader.
"""

from mathutils import Vector

VENT_IDS = (
    {53, *range(486, 498), *range(589, 602)}
    | {220, 221, 222, 393, 394, *range(570, 579), *range(637, 647)}
    | {*range(211, 219), 230, *range(565, 570), *range(397, 407), 415, *range(647, 652)}
)


def is_vent_backing(row):
    lo, hi = row["minimum"], row["maximum"]
    absolute_x = sorted([abs(lo[0]), abs(hi[0])])
    return (
        row["triangles"] <= 4
        and absolute_x[0] > 0.08
        and absolute_x[1] < 0.14
        and lo[1] > 0.329
        and hi[1] < 0.358
        and lo[2] > 0.685
        and hi[2] < 0.756
    )


def build_inserts():
    points, faces, materials = [], [], []

    def box(map_point, u0, u1, z0, z1, front, back, material):
        start = len(points)
        points.extend(
            map_point(u, z, depth)
            for depth in [back, front]
            for u, z in [(u0, z0), (u1, z0), (u1, z1), (u0, z1)]
        )
        faces.extend(
            tuple(start + i for i in f)
            for f in [
                (0, 3, 2, 1),
                (4, 5, 6, 7),
                (0, 1, 5, 4),
                (1, 2, 6, 5),
                (2, 3, 7, 6),
                (3, 0, 4, 7),
            ]
        )
        materials.extend([material] * 6)

    for sign in [1, -1]:
        for kind in ["front", "rear", "side"]:
            if kind == "front":
                low, high = 0.682, 0.746

                def surface(u, z, depth):
                    y = -0.069 - (z - low) / (high - low) * 0.010
                    return Vector((sign * (0.1275 + u * 0.046), y - depth, z))

                protrusion = 0.0025
            elif kind == "rear":
                low, high = 0.688, 0.752

                def surface(u, z, depth):
                    y = 0.344 - (z - low) / (high - low) * 0.010
                    return Vector((sign * (0.084 + u * 0.050), y + depth, z))

                protrusion = 0.005
            else:
                low, high = 0.684, 0.760

                def surface(u, z, depth):
                    return Vector(
                        (sign * (0.171 - u * 0.022 + depth), 0.296 + u * 0.041, z)
                    )

                protrusion = 0.003
            box(surface, 0, 1, low, high, 0, -0.001, 1)
            spacing = (high - low) / 6
            for index in range(6):
                z = low + (index + 0.5) * spacing
                box(
                    surface, 0.015, 0.985, z - 0.0025, z + 0.0025, protrusion, 0.0002, 0
                )
    return points, faces, materials
