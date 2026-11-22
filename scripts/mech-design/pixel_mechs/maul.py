"""Hand-authored Maul A plates, on the approved source rig."""

from math import fsum

from .geometry import average, clipped_rect, minus, ring_z

PALETTE = {
    "oxide": "bb605b",
    "redshade": "854748",
    "coal": "374455",
    "porcelain": "d2d3cc",
    "silver": "94a9ad",
    "podrim": "b2a99a",
    "hot": "faad54",
    "glint": "ffd998",
}
VISOR_EMISSIVE = [0.44, 0.15, 0.015]


def polygon_z(loop, z):
    return [(x, y, z) for x, y in loop]


def forearm_plate(mesh, side):
    # One open-faced cartridge. Grid boundaries are halfway between adjacent
    # physical firing centers; all sixteen wells meet the actual source exits.
    points = [[mesh.anchor(f"physical_exit_{side}_{r}_{c}") for c in range(4)] for r in range(4)]
    xs = [fsum(points[j][i][0] for j in range(4)) / 4 for i in range(4)]
    ys = [fsum(p[1] for p in row) / 4 for row in points]
    cx = (xs[0] + xs[-1]) / 2
    cy = (ys[0] + ys[-1]) / 2
    z = max(p[2] for row in points for p in row)

    def borders(vals):
        return (
            [vals[0] - (vals[1] - vals[0]) * 0.5]
            + [(a + b) * 0.5 for a, b in zip(vals, vals[1:])]
            + [vals[-1] + (vals[-1] - vals[-2]) * 0.5]
        )

    bx, by = borders(xs), borders(ys)

    def boundary(left, right, bottom, top, cut):
        return [
            (left + cut, bottom),
            (right - cut, bottom),
            (right, bottom),
            (right, top),
            (right - cut, top),
            (left + cut, top),
            (left, top),
            (left, bottom),
        ]

    outer = polygon_z(clipped_rect(cx, cy, 170, 174, 18, 18), z)
    bounds = polygon_z(boundary(bx[0], bx[-1], by[0], by[-1], 11), z)
    for j in range(8):
        k = (j + 1) % 8
        mesh.face([outer[j], outer[k], bounds[k], bounds[j]], (0, 0, 1), "podrim")
    for r, row in enumerate(points):
        for c, (x, y, _) in enumerate(row):
            border = polygon_z(boundary(bx[c], bx[c + 1], by[r], by[r + 1], 5), z)
            well = polygon_z(clipped_rect(x, y, 23.2, 23.4, 4.7, 4.7), z)
            inner = polygon_z(clipped_rect(x, y, 20.9, 21.1, 4.6, 4.6), z - 16)
            for j in range(8):
                k = (j + 1) % 8
                mesh.face([border[j], border[k], well[k], well[j]], (0, 0, 1), "silver")
                q = [well[j], well[k], inner[k], inner[j]]
                mesh.face(q, minus((x, y, z - 10), average(q)), "joint")
            mesh.face(inner, (0, 0, 1), "bore")
    return cx, cy, z


def torso(mesh):
    mesh.section = "geometry_maul_torso"
    # Broad breastplate above a recessed abdomen and swivel bearing. The crown
    # is only slightly higher than the two shoulders, as in the high-detail rig.
    mesh.cylinder((0, 594, -129), (0, 696, -129), 92, "cast", 12)
    mesh.hull_y(
        [
            (654, 0, -119, 174, 177, 24, 31),
            (695, 0, -114, 192, 204, 32, 34),
            (798, 0, -109, 244, 229, 36, 32),
            (841, 0, -102, 223, 208, 32, 33),
        ],
        "coal",
    )
    breast = [
        (-278, 0, 758, 877, 214, 28, 25),
        (-200, 0, 725, 927, 283, 34, 29),
        (-96, 0, 723, 939, 313, 37, 26),
        (17, 0, 737, 917, 305, 35, 32),
        (91, 0, 762, 869, 251, 28, 22),
        (116, 0, 774, 831, 165, 20, 13),
    ]
    rings = []
    for row, rise in zip(breast, [3, 8, 10, 13, 17, 8]):
        ring = ring_z(row)
        ring.insert(5, (row[1], row[3] + rise, row[0]))
        rings.append(ring)
    mesh.join(
        rings, lambda i, j: "coal" if j in (0, 1, 8) else "silver" if j in (2, 7) else "porcelain", ("cast", "silver")
    )
    # One broad cooling recess beneath the breastplate.
    mesh.hull_z(
        [(-32, 0, 682, 771, 134, 14, 14), (32, 0, 681, 775, 133, 16, 14), (52, 0, 697, 762, 108, 12, 9)],
        "cast",
        ("cast", "shadow"),
    )
    for y in (712, 735):
        mesh.hull_z([(52.8, 0, y - 4, y + 4, 89, 4, 2), (56, 0, y - 3, y + 5, 88, 4, 2)], "silver")
    # The little pilot turret has a wraparound amber slit under a forward brow.
    # The brow and glass make different silhouettes from the monolithic chest.
    mesh.hull_z(
        [
            (-223, 0, 909, 975, 103, 15, 13),
            (-160, 0, 904, 999.8, 162, 21, 17),
            (-70, 0, 900, 993, 174, 23, 18),
            (-3, 0, 898, 973, 164, 21, 14),
            (62, 0, 897, 924, 135, 16, 8),
        ],
        lambda i, j: "joint" if i == 3 else "coal" if j in (0, 1, 7) else "cast",
        ("coal", "coal"),
    )

    def brow(points, pigment, offset):
        mesh.patch([(x, 973 - (z + 3) * 49 / 65 + offset, z) for x, z in points], pigment)

    brow([(-65, 0), (66, 0), (62, 40), (49, 51), (-50, 51), (-62, 40)], "shadow", 1.2)
    brow([(-54, 7), (54, 7), (52, 31), (43, 38), (-43, 38), (-53, 32)], "hot", 2.8)
    brow([(-45, 9), (-6, 9), (-11, 17), (-46, 19)], "glint", 4.0)
    # Backpack, paired vent wells, and the upright central exhaust spine.
    mesh.hull_z(
        [(-319, 0, 748, 897, 173, 23, 18), (-288, 0, 727, 935, 208, 23, 23), (-224, 0, 724, 942, 211, 23, 27)],
        "redshade",
        ("cast", "redshade"),
    )
    mesh.hull_z([(-321, 0, 793, 861, 117, 9, 9), (-324, 0, 799, 853, 108, 8, 8)], "cast", ("cast", "shadow"))
    for y in (813, 834):
        mesh.hull_z([(-324.5, 0, y - 3, y + 4, 93, 5, 2), (-328, 0, y - 2, y + 4, 91, 4, 2)], "redshade")
    for side, sign in [("left", 1), ("right", -1)]:
        # A high fixed inner shoulder lug, present on both sides of the source.
        # Its dark gap separates head, shoulder and elbow in the elevated view.
        mesh.hull_y(
            [
                (872, sign * 198, -169, 56, 127, 9, 18),
                (918, sign * 199, -171, 71, 148, 13, 18),
                (974, sign * 198, -184, 66, 139, 11, 16),
                (987, sign * 195, -192, 51, 113, 9, 15),
            ],
            lambda i, j: "redshade" if i == 0 else "oxide",
        )
        mesh.cylinder((sign * 112, 848, -148), (sign * 263, 848, -148), 63, "cast", 10)
        mesh.cylinder((sign * 186, 848, -148), (sign * 214, 848, -148), 70, "silver", 10)
        # Overhanging square pauldrons with lower cutaway. The upper arm stays
        # visible between the pauldron and the forearm pod in side and rear view.
        mesh.hull_y(
            [
                (805, sign * 279, -147, 168, 174, 20, 25),
                (834, sign * 285, -143, 211, 244, 24, 27),
                (878, sign * 293, -139, 208, 250, 23, 26),
                (946, sign * 276, -152, 183, 235, 20, 27),
                (960, sign * 269, -161, 163, 204, 19, 24),
            ],
            lambda i, j: "redshade" if i == 0 else "oxide",
        )
        mesh.cylinder((sign * 268, 828, -148), (sign * 332, 676, -54), 48, "cast")
        mesh.beam((sign * 261, 803, -163), (sign * 306, 716, -102), 60, 83, "redshade")
        mesh.cylinder((sign * 277, 780, -88), (sign * 327, 678, -27), 26, "silver")
        mesh.cylinder((sign * 294, 662, -48), (sign * 391, 662, -48), 58, "cast", 10)
        mesh.cylinder((sign * 380, 662, -48), (sign * 396, 662, -48), 44, "redshade", 10)
        # Exposed diagonal lower braces keep the heavy torso tied into the waist.
        mesh.beam((sign * 111, 751, -32), (sign * 84, 655, -62), 31, 42, "cast")


def pelvis(mesh):
    mesh.section = "geometry_maul_pelvis"
    mesh.cylinder((0, 611, -133), (0, 675, -133), 111, "cast", 12)
    mesh.hull_y(
        [
            (479, 0, -122, 153, 186, 24, 29),
            (520, 0, -126, 193, 262, 26, 33),
            (576, 0, -126, 227, 285, 34, 39),
            (634, 0, -129, 211, 275, 30, 42),
            (655, 0, -133, 164, 219, 26, 35),
        ],
        "coal",
    )
    mesh.hull_z(
        [(-59, 0, 505, 624, 173, 20, 18), (9, 0, 515, 632, 175, 21, 18), (30, 0, 544, 609, 143, 17, 15)], "porcelain"
    )


def pod(mesh, side, sign):
    mesh.section = f"geometry_maul_mount_{side}-pod"
    cx, cy, z = forearm_plate(mesh, side)
    mesh.hull_z(
        [
            (-53, cx, 528, 681, 165, 23, 22),
            (-15, cx, 495, 717, 209, 28, 34),
            (51, cx, 477, 718, 244, 31, 35),
            (161, cx, 475, 708, 242, 30, 32),
            (241, cx, 483, 682, 233, 29, 29),
            (z - 22, cx, 489, 669, 207, 24, 22),
            (z, cx, cy - 87, cy + 87, 170, 18, 18),
        ],
        lambda i, j: "coal"
        if j in (0, 1, 7)
        else "oxide"
        if i in (4, 5)
        else "porcelain"
        if j in (3, 4, 5)
        else "redshade",
        ("cast", None),
    )
    # Torso-owned elbow plugs into this rear pod yoke.
    mesh.hull_z(
        [
            (-152, cx, 616, 685, 123, 16, 14),
            (-109, cx, 615, 729, 158, 20, 22),
            (-52, cx, 602, 729, 164, 21, 25),
            (4, cx, 569, 692, 137, 18, 19),
        ],
        "cast",
    )
    mesh.hull_z([(-54, cx, 552, 637, 108, 13, 13), (-57, cx, 560, 629, 96, 11, 10)], "cast", ("cast", "joint"))
    # One solid contrasting service panel per side, with no tiny grille lines.
    bx = cx + sign * 119
    mesh.patch([(bx, 541, 78), (bx, 594, 78), (bx, 597, 132), (bx, 546, 145)], "cast", (sign, 0, 0))


def leg(mesh, side, sign):
    hx, hy, hz = mesh.anchor(f"rig_leg_{side}_thigh")
    kx, ky, kz = mesh.anchor(f"rig_leg_{side}_shin")
    ax, ay, az = mesh.anchor(f"rig_leg_{side}_foot")
    mesh.section = f"geometry_maul_leg_{side}_thigh"
    mesh.cylinder((hx - sign * 84, hy, hz), (hx + sign * 64, hy, hz), 70, "cast", 10)
    mesh.cylinder((hx + sign * 63, hy, hz), (hx + sign * 73, hy, hz), 49, "redshade", 10)
    mesh.beam((hx, hy - 5, hz), (kx, ky + 4, kz), 84, 95, "coal")
    mesh.hull_y(
        [
            (386, kx, -87, 126, 150, 16, 21),
            (424, kx, -82, 164, 183, 20, 27),
            (484, hx + sign * 7, -106, 159, 189, 21, 25),
            (530, hx, -138, 132, 151, 18, 22),
        ],
        lambda i, j: "redshade" if j in (0, 1, 7) else "porcelain",
    )
    mesh.section = f"geometry_maul_leg_{side}_shin"
    mesh.cylinder((kx - sign * 70, ky, kz), (kx + sign * 82, ky, kz), 59, "cast", 10)
    mesh.cylinder((kx + sign * 80, ky, kz), (kx + sign * 91, ky, kz), 46, "silver", 10)
    mesh.hull_y(
        [
            (303, kx, -62, 120, 122, 18, 19),
            (333, kx, -63, 152, 142, 22, 24),
            (398, kx, -67, 158, 143, 20, 22),
            (433, kx, -79, 130, 117, 18, 18),
        ],
        "oxide",
    )
    # A heavy V-shaped calf with one large light piston visible in front.
    mesh.hull_y(
        [
            (126, ax, -128, 154, 110, 22, 17),
            (169, ax, -148, 171, 130, 24, 24),
            (260, kx + sign * 12, -166, 181, 123, 23, 23),
            (308, kx + sign * 3, -152, 158, 130, 21, 22),
            (343, kx, -128, 135, 92, 18, 17),
        ],
        lambda i, j: "oxide" if j in (0, 1, 6, 7) else "redshade",
    )
    for dx in (-46, 46):
        mesh.cylinder((ax + dx, 145, -52), (kx + dx, 328, -50), 21, "silver")
    mesh.hull_y(
        [
            (110, ax, -70, 153, 134, 23, 24),
            (138, ax, -69, 174, 151, 24, 25),
            (185, ax, -69, 164, 134, 23, 23),
            (202, ax, -75, 137, 110, 20, 21),
        ],
        lambda i, j: "oxide" if j in (3, 4, 5) else "coal",
    )
    mesh.section = f"geometry_maul_leg_{side}_foot"
    mesh.cylinder((ax - sign * 77, ay, az), (ax + sign * 85, ay, az), 48, "cast", 10)
    mesh.hull_y(
        [
            (0, ax, -65, 259, 334, 33, 38),
            (21, ax, -67, 279, 359, 37, 39),
            (64, ax, -76, 267, 325, 33, 35),
            (91, ax, -91, 210, 275, 28, 32),
        ],
        "coal",
    )
    mesh.hull_z(
        [(-254, ax, 9, 74, 186, 24, 17), (-214, ax, 8, 103, 218, 29, 18), (-138, ax, 12, 107, 206, 27, 18)], "redshade"
    )
    mesh.hull_z(
        [
            (-137, ax, 48, 122, 165, 24, 24),
            (-80, ax, 46, 151, 182, 25, 27),
            (-9, ax, 44, 123, 182, 24, 24),
            (52, ax, 28, 87, 157, 22, 18),
        ],
        "oxide",
    )
    for n in (-1, 0, 1):
        tx = ax + n * 85
        tip = 162 if n == 0 else 142
        mesh.hull_z(
            [
                (-7, tx, 7, 64, 78, 11, 11),
                (47, tx, 0, 80, 83, 12, 13),
                (104, tx, 0, 62, 83, 13, 10),
                (tip, tx, 0, 36, 69, 11, 8),
            ],
            lambda i, j: "porcelain" if i >= 1 and j not in (0, 1, 7) else "cast",
        )


def build(mesh):
    torso(mesh)
    pelvis(mesh)
    for side, sign in (("left", 1), ("right", -1)):
        pod(mesh, side, sign)
        leg(mesh, side, sign)
