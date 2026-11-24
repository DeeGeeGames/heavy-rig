"""Hand-authored Kestrel A plates, on the approved source rig."""

import math

from .geometry import average, minus

PALETTE = {
    "sage": "729e76",
    "forest": "42694f",
    "ivory": "d0d6d5",
    "silver": "94a9ad",
    "glass": "216861",
    "shine": "6ac4b3",
}
VISOR_EMISSIVE = [0.002, 0.14, 0.17]


def barrel_ring(x, y, z, r, sides=8):
    return [
        (x + r * math.cos((i + 0.5) * 2 * math.pi / sides), y + r * math.sin((i + 0.5) * 2 * math.pi / sides), z)
        for i in range(sides)
    ]


def tube(mesh, x, y, back, lip, r, sides=8):
    base = barrel_ring(x, y, back, r, sides)
    end = barrel_ring(x, y, lip, r, sides)
    hole = barrel_ring(x, y, lip, 0.68 * r, sides)
    inner = barrel_ring(x, y, lip - 1.45 * r, 0.67 * r, sides)
    mesh.join([base, end], "cast", ("cast", None))
    for j in range(sides):
        k = (j + 1) % sides
        mesh.face([end[j], end[k], hole[k], hole[j]], (0, 0, 1), "silver")
        p = [hole[j], hole[k], inner[k], inner[j]]
        mesh.face(p, minus((x, y, lip - r / 2), average(p)), "joint")
    mesh.face(inner, (0, 0, 1), "bore")


def torso(mesh):
    mesh.section = "geometry_kestrel_torso"
    # A single down-swept bill, roughly a full source height from engine to tip.
    # Three different values define the ivory crown, green flanks and dark keel.
    spine = [
        (-307, -5, 779, 902, 249, 28, 21),
        (-176, -5, 734, 930, 289, 35, 25),
        (-25, -5, 716, 916, 289, 36, 27),
        (122, -6, 683, 860, 236, 35, 23),
        (266, -7, 649, 793, 149, 24, 18),
        (438, -7, 595, 649, 59, 11, 8),
        (482, -7, 578, 603, 24, 5, 5),
    ]
    mesh.hull_z(
        spine, lambda i, j: "ivory" if j in (3, 4, 5) else "sage" if j in (2, 6) else "forest", ("forest", "forest")
    )
    # A narrow raised cover follows the power pack above its dark rear vent.
    mesh.hull_z(
        [
            (-487, -5, 844, 944, 193, 22, 16),
            (-440, -5, 813, 966, 244, 29, 22),
            (-326, -5, 804, 976, 249, 26, 23),
            (-263, -5, 810, 956, 248, 23, 19),
            (-225, -5, 826, 930, 207, 20, 15),
        ],
        lambda i, j: "forest" if j in (0, 1, 7) else "sage",
    )
    mesh.hull_z(
        [
            (-458, -5, 950, 963, 101, 9, 4),
            (-408, -5, 954, 999.8, 137, 12, 9),
            (-333, -5, 962, 990, 134, 12, 7),
            (-270, -5, 948, 959, 107, 9, 3),
        ],
        lambda i, j: "sage" if j in (3, 4, 5) else "forest",
        ("forest", "forest"),
    )
    mesh.hull_z([(-488, -5, 858, 927, 167, 15, 12), (-492, -5, 866, 922, 153, 14, 10)], "cast", ("cast", "shadow"))
    for y in (882, 903):
        mesh.hull_z([(-492.5, -5, y - 2, y + 4, 125, 5, 1), (-494.8, -5, y - 2, y + 4, 123, 5, 1)], "forest")
    # Asymmetric side trunnions sit under the wing-shaped cheek fairings.
    for side, sign in [("left", 1), ("right", -1)]:
        sx, sy, sz = mesh.anchor(f"socket_{side}-gun")
        mesh.cylinder((sign * 127 - 5, 723, -110), (sx, sy, sz), 38, "cast")
        mesh.cylinder((sign * 190 - 5, 701, -100), (sx + sign * 18, sy, sz), 36, "forest")
        mesh.beam((sx, sy - 6, sz), (sign * 118 - 5, 685, 40), 41, 26, "silver")
        mesh.hull_z(
            [
                (z, -5 + sign * offset * 0.94, low, high, width * 0.86, bevel_x * 0.86, bevel_y * 0.86)
                for z, offset, low, high, width, bevel_x, bevel_y in (
                    (-226, 146, 789, 869, 79, 12, 15),
                    (-145, 160, 796, 882, 108, 15, 20),
                    (8, 153, 793, 854, 106, 17, 16),
                    (103, 119, 753, 807, 80, 14, 14),
                )
            ],
            lambda i, j: "sage" if j in (2, 3, 4, 5, 6) else "forest",
            ("cast", "cast"),
        )

    # Faceted canopy in the upper face of the beak. Its footprint is long
    # along the chassis like the source pilot hatch, not a transverse lightbar.
    def roof(z):
        if z <= 266:
            return 860 + (793 - 860) * (z - 122) / 144
        return 793 + (649 - 793) * (z - 266) / 172

    def glass_plate(points, pigment, offset):
        # Split on the change of slope to keep the panel flush to both facets.
        split_z = 266

        def slice_poly(poly, below):
            def inside(point):
                return point[1] <= split_z if below else point[1] >= split_z

            clipped = []
            for a, b in zip(poly, poly[1:] + poly[:1]):
                if inside(a):
                    clipped.append(a)
                if inside(a) != inside(b):
                    f = (split_z - a[1]) / (b[1] - a[1])
                    clipped.append((a[0] + (b[0] - a[0]) * f, split_z))
            return clipped

        for section in (slice_poly(points, True), slice_poly(points, False)):
            if len(section) >= 3:
                mesh.patch([(x - 6, roof(z) + offset, z) for x, z in section], pigment)

    glass_plate([(-61, 164), (60, 164), (38, 303), (11, 333), (-21, 327), (-43, 300)], "shadow", 1.4)
    glass_plate([(-47, 179), (48, 179), (30, 292), (5, 317), (-23, 304)], "glass", 2.9)
    glass_plate([(-37, 197), (-9, 197), (-15, 262), (-33, 286)], "shine", 4.3)
    # Visible mechanical base underneath a high swept hull.
    mesh.hull_z(
        [
            (-252, -5, 671, 819, 227, 26, 21),
            (-162, -5, 638, 814, 259, 36, 31),
            (-37, -5, 624, 800, 234, 39, 23),
            (80, -4, 646, 757, 198, 28, 19),
        ],
        "forest",
    )
    mesh.cylinder((-5, 573, -12), (-5, 666, -12), 91, "cast", 12)


def pelvis(mesh):
    mesh.section = "geometry_kestrel_pelvis"
    mesh.hull_y(
        [
            (449, -5, -12, 153, 117, 21, 18),
            (481, -5, -7, 209, 159, 29, 25),
            (532, -5, -16, 240, 182, 34, 29),
            (564, -5, -18, 201, 167, 31, 26),
        ],
        "forest",
    )
    mesh.cylinder((-5, 550, -12), (-5, 591, -12), 95, "cast", 12)


def gun_housing(mesh, side, sign):
    mesh.section = f"geometry_kestrel_mount_{side}-gun"
    x, y, z = mesh.anchor(f"muzzle_{side}-gun")
    dz = z - (264 if sign > 0 else 254)
    # The elongated receiver is common to the gun, laser and launcher cartridges.
    def receiver_paint(segment, edge):
        if edge in (0, 1, 7):
            return "cast"
        if edge == 4 and segment in (1, 2):
            return "ivory"
        return "forest" if edge in (2, 6) else "sage"

    mesh.hull_z(
        [
            (-284 + dz, x, 632, 728, 93, 10, 11),
            (-218 + dz, x, 619, 752, 131, 13, 16),
            (-137 + dz, x, 617, 762, 141, 14, 17),
            (-31 + dz, x, 621, 734, 122, 12, 12),
            (32 + dz, x, 629, 711, 103, 10, 10),
        ],
        receiver_paint,
        ("forest", "cast"),
    )
    return x, y, dz


def gun(mesh, side, sign):
    x, y, dz = gun_housing(mesh, side, sign)
    mesh.cylinder((x, y, 3 + dz), (x, y, 72 + dz), 47, "cast")
    mesh.cylinder((x, y, 52 + dz), (x, y, 78 + dz), 49, "forest")
    for i in range(1, 8):
        bx, by, bz = mesh.anchor(f"physical_exit_{side}_gun_{i}")
        tube(mesh, bx, by, 67 + dz, bz, 10.6, 8)
    mesh.cylinder((x, y, 175 + dz), (x, y, 205 + dz), 36, "cast", 10)


def leg(mesh, side, sign):
    hx, hy, hz = mesh.anchor(f"rig_leg_{side}_thigh")
    kx, ky, kz = mesh.anchor(f"rig_leg_{side}_shin")
    ax, ay, az = mesh.anchor(f"rig_leg_{side}_foot")
    mesh.section = f"geometry_kestrel_leg_{side}_thigh"
    # The front thigh shield and the link behind it form a folded Z.
    mesh.cylinder((hx - sign * 28, hy, hz), (hx + sign * 63, hy, hz), 63, "cast")
    mesh.hull_z(
        [
            (hz - 56, hx + sign * 31, 471, 552, 85, 15, 16),
            (hz + 7, hx + sign * 38, 443, 578, 106, 16, 20),
            (hz + 87, hx + sign * 44, 380, 510, 111, 17, 22),
            (hz + 147, hx + sign * 48, 358, 426, 78, 12, 13),
        ],
        lambda i, j: "ivory" if j in (3, 4, 5) else "sage",
        ("forest", "forest"),
    )
    mesh.beam((hx + sign * 41, 423, hz + 68), (kx, ky, kz), 56, 53, "forest")
    mesh.cylinder((kx, ky + 32, kz + 24), (hx + sign * 37, 464, hz + 27), 18, "silver")
    mesh.section = f"geometry_kestrel_leg_{side}_shin"
    mesh.cylinder((kx - sign * 45, ky, kz), (kx + sign * 48, ky, kz), 56, "cast")
    mesh.cylinder((kx + sign * 47, ky, kz), (kx + sign * 53, ky, kz), 33, "silver")
    # Dark spar and light outer blade leave a readable open channel for the piston.
    mesh.beam((kx + sign * 12, ky - 14, kz + 7), (ax + sign * 7, ay + 19, az - 10), 49, 53, "forest")
    mesh.cylinder((kx - sign * 23, ky - 46, kz + 27), (ax - sign * 18, ay + 47, az - 13), 17, "silver")
    mesh.hull_y(
        [
            (108, ax + sign * 4, az - 11, 55, 56, 10, 10),
            (149, ax + sign * 3, az - 37, 70, 72, 12, 15),
            (211, ax - sign * 7, az - 88, 64, 69, 11, 13),
            (228, ax - sign * 9, az - 104, 54, 52, 10, 11),
        ],
        lambda i, j: "forest" if j == 0 else "ivory",
    )
    mesh.section = f"geometry_kestrel_leg_{side}_foot"
    mesh.cylinder((ax - sign * 53, ay, az), (ax + sign * 52, ay, az), 48, "cast")
    mesh.cylinder((ax + sign * 52, ay, az), (ax + sign * 57, ay, az), 30, "ivory")
    for toe in (-1, 1):
        tx = ax + toe * 42
        mesh.hull_z(
            [
                (az - 12, tx, 6, 55, 57, 8, 7),
                (az + 32, tx, 0, 65, 70, 9, 11),
                (az + 115, tx + toe * 5, 0, 44, 71, 10, 8),
                (az + 194, tx + toe * 10, 0, 19, 52, 8, 5),
            ],
            lambda i, j: "sage" if i == 0 else "ivory",
        )
    # One continuous hooked heel spur, with daylight underneath the arch.
    mesh.hull_z(
        [
            (az - 221, ax, 2, 18, 17, 3, 3),
            (az - 202, ax, 42, 64, 29, 4, 5),
            (az - 161, ax, 69, 102, 43, 6, 8),
            (az - 110, ax, 73, 112, 45, 7, 8),
            (az - 43, ax, 28, 73, 55, 8, 10),
            (az - 7, ax, 31, 70, 61, 8, 10),
        ],
        lambda i, j: "cast" if j in (0, 1, 7) else "sage",
    )


def build(mesh):
    torso(mesh)
    pelvis(mesh)
    for side, sign in (("left", 1), ("right", -1)):
        gun(mesh, side, sign)
        leg(mesh, side, sign)
