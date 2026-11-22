"""Hand-authored Warden A plates, on the approved source rig."""

from math import fsum

from .geometry import average, clipped_rect, minus, ring_z

PALETTE = {
    "armor": "7798b0",
    "deep": "405772",
    "cheek": "b5c5c4",
    "rim": "d5dbcc",
    "gold": "e1a449",
    "ochre": "a97741",
    "glass": "2bc3bd",
    "shine": "80e0c9",
}
VISOR_EMISSIVE = [0.008, 0.34, 0.33]


def torso(mesh):
    mesh.section = "geometry_rig_torso"
    # The lower tub holds the side bridges. The upper silhouette and narrowed nose
    # come from longitudinal sections, with the dark keel visible below the glacis.
    mesh.hull_z(
        [
            (-342, 0, 624, 788, 278, 30, 24),
            (-273, 0, 575, 829, 418, 47, 37),
            (-100, 0, 566, 834, 456, 58, 38),
            (80, 0, 550, 748, 336, 42, 33),
            (208, 0, 552, 662, 143, 24, 18),
        ],
        "deep",
    )
    body_sections = [
        (-350, 0, 652, 813, 270, 26, 29),
        (-277, 0, 625, 872, 386, 43, 34),
        (-97, 0, 620, 888, 403, 47, 40),
        (32, 0, 612, 835, 339, 49, 40),
        (154, 0, 589, 744, 236, 40, 32),
        (214, 0, 568, 662, 126, 16, 17),
    ]
    mesh.hull_z(body_sections, lambda i, j: "deep" if j in (0, 1, 7) else "armor", ("cast", "deep"))
    # Twin fairings flank the canopy. Each has a single dark inlet on its front face.
    for sign in (1, -1):
        mesh.hull_z(
            [
                (-270, sign * 153, 679, 821, 113, 18, 22),
                (-168, sign * 169, 674, 847, 123, 18, 22),
                (-31, sign * 166, 665, 827, 132, 18, 20),
                (92, sign * 141, 654, 762, 87, 11, 14),
            ],
            lambda i, j: "deep" if j in (0, 1, 7) else "cheek",
            ("cast", "cast"),
        )
        mesh.hull_z(
            [(92.3, sign * 141, 676, 746, 70, 9, 8), (96, sign * 141, 682, 741, 60, 6, 6)],
            "joint",
            ("joint", "shadow"),
        )
    # The visor stands proud of the spine on a continuous, sloped dark gasket.
    mesh.hull_z(
        [
            (-173, 0, 842, 887, 134, 17, 9),
            (-96, 0, 855, 911, 183, 18, 13),
            (-22, 0, 831, 897, 187, 20, 13),
            (20, 0, 816, 880, 181, 16, 10),
            (72, 0, 800, 833, 156, 13, 7),
            (108, 0, 764, 797, 125, 12, 7),
        ],
        lambda i, j: "deep" if j in (0, 1, 7) or i == 3 else "armor",
        ("deep", "deep"),
    )

    def canopy_y(z):
        return 880 - 47 * (z - 20) / 52

    def canopy(points, pigment):
        mesh.patch(
            [(x, canopy_y(z) + {"shadow": 1, "glass": 2.4, "shine": 3.7}[pigment], z) for x, z in points], pigment
        )

    canopy([(-74, 24), (74, 24), (70, 58), (54, 63), (-55, 63), (-70, 57)], "shadow")
    canopy([(-66, 29), (66, 29), (63, 51), (50, 57), (-52, 57), (-64, 51)], "glass")
    canopy([(-54, 31), (0, 31), (-7, 37), (-54, 39)], "shine")

    # The sloping cheek plates converge at the prow; the pale tip is a broad
    # painted area of the glacis, mirroring the light shoe and arm shields.
    def glacis_y(z):
        if z <= 154:
            return 835 + (744 - 835) * (z - 32) / (154 - 32)
        return 744 + (662 - 744) * (z - 154) / (214 - 154)

    for z0, z1, w0, w1 in [(107, 154, 60, 48), (154, 204, 48, 33)]:
        mesh.patch(
            [
                (-w0, glacis_y(z0) + 1.5, z0),
                (w0, glacis_y(z0) + 1.5, z0),
                (w1, glacis_y(z1) + 1.5, z1),
                (-w1, glacis_y(z1) + 1.5, z1),
            ],
            "cheek",
        )
    # Two large rear exhaust wells, with one simple exhaust sill per side.
    for sign in (1, -1):
        mesh.hull_z(
            [(-347, sign * 125, 673, 785, 93, 9, 10), (-351, sign * 125, 679, 779, 82, 8, 8)],
            "cast",
            ("cast", "shadow"),
        )
        mesh.hull_z([(-352, sign * 125, 705, 718, 68, 5, 3), (-356, sign * 125, 705, 717, 66, 4, 3)], "deep")
    mesh.hull_z(
        [(-369, 0, 671, 805, 102, 13, 12), (-334, 0, 646, 824, 150, 16, 16), (-294, 0, 660, 861, 139, 17, 15)],
        "armor",
        ("cheek", "armor"),
    )


def pelvis_and_connections(mesh):
    mesh.section = "geometry_rig_pelvis"
    mesh.cylinder((0, 542, -73), (0, 603, -73), 126, "joint", 12)
    mesh.cylinder((0, 568, -73), (0, 590, -73), 133, "cast", 12)
    mesh.hull_y(
        [
            (444, 0, -67, 199, 155, 30, 32),
            (470, 0, -76, 291, 216, 42, 44),
            (521, 0, -76, 295, 222, 43, 45),
            (559, 0, -80, 214, 180, 31, 36),
        ],
        "deep",
    )
    mesh.hull_z(
        [(-51, 0, 463, 543, 158, 16, 13), (48, 0, 465, 538, 156, 18, 12), (78, 0, 480, 527, 120, 13, 10)], "armor"
    )

    mesh.section = "geometry_mount_connections"
    for sign in (1, -1):
        # Coaxial bridges connect both the arm and the higher pod to the torso.
        mesh.cylinder((sign * 166, 710, -120), (sign * 306, 710, -120), 50, "joint")
        mesh.cylinder((sign * 218, 710, -120), (sign * 247, 710, -120), 56, "cast")
        mesh.cylinder((sign * 169, 750, -104), (sign * 259, 750, -104), 41, "cast")


def shoulder_bank(mesh, side, sign):
    mesh.section = f"geometry_rig_mount_{side}-shoulder bank"
    cx = sign * 263
    mesh.hull_y(
        [
            (721, sign * 228, -113, 67, 93, 9, 15),
            (758, sign * 238, -127, 80, 129, 11, 18),
            (857, sign * 266, -187, 88, 150, 15, 21),
            (886, sign * 267, -190, 105, 159, 16, 17),
        ],
        "cast",
    )
    # One continuous shoulder envelope; the transverse hazard band is paint on
    # exactly the same mesh faces so it adds no sculpted mini-panels.
    front_offset = 4.2 if sign < 0 else 0
    roof = 999.48
    pod = [
        (-371, cx, 875 + front_offset, 963, 210, 20, 20),
        (-335, cx, 851 + front_offset, roof, 256, 24, 29),
        (-225, cx, 851 + front_offset, roof, 256, 24, 29),
        (-171, cx, 851 + front_offset, roof, 256, 24, 29),
        (-94, cx, 851 + front_offset, roof, 256, 24, 29),
        (-64, cx, 852 + front_offset, 976 + front_offset, 234, 22, 18),
    ]
    mesh.hull_z(pod, lambda i, j: "cast" if j in (0, 1, 7) else "gold" if i >= 2 else "armor", ("deep", None))
    # Sloped socket plate, eight flat-walled wells. Each well follows a physical
    # center from the actual source GLB; the centers vary slightly by side.
    bore_points = [
        mesh.anchor(f"physical_exit_{side}_launcher_{row}_{i}") for row in ("lower", "upper") for i in range(1, 5)
    ]
    mid_y = fsum(p[1] for p in bore_points) / 8

    def front_z(y):
        return -60.5 + (y - mid_y) * 0.12

    def plate_loop(w, h, cutx, cuty):
        return [(x, y, front_z(y)) for x, y in clipped_rect(cx, mid_y, w, h, cutx, cuty)]

    rim = plate_loop(233, 126, 21, 17)
    # Set outer skirt clearly in front of the shell's foremost cap.
    mesh.join([ring_z(pod[-1]), rim], "cheek", (None, None))
    left = cx - 90
    right = cx + 90
    bottom = mid_y - 43
    top = mid_y + 43
    # Eight vertex rectangle with quarter edges to keep a centered opening.
    inner = [
        (left + 16, bottom, front_z(bottom)),
        (right - 16, bottom, front_z(bottom)),
        (right, bottom, front_z(bottom)),
        (right, top, front_z(top)),
        (right - 16, top, front_z(top)),
        (left + 16, top, front_z(top)),
        (left, top, front_z(top)),
        (left, bottom, front_z(bottom)),
    ]
    for j in range(8):
        k = (j + 1) % 8
        mesh.face([rim[j], rim[k], inner[k], inner[j]], (0, 0, 1), "ochre")
    for row in range(2):
        for col in range(4):
            x, y, z = bore_points[4 * row + col]
            x0 = left + 45 * col
            x1 = x0 + 45
            y0 = bottom + 43 * row
            y1 = y0 + 43
            box = [(x0 + 6, y0), (x1 - 6, y0), (x1, y0), (x1, y1), (x1 - 6, y1), (x0 + 6, y1), (x0, y1), (x0, y0)]
            ring = clipped_rect(x, y, 32, 31, 6, 6)
            front = [(u, v, front_z(v) + 0.03) for u, v in ring]
            inside = [(u * 0.86 + x * 0.14, v * 0.86 + y * 0.14, z - 15) for u, v in ring]
            for j in range(8):
                k = (j + 1) % 8
                border = [
                    (box[j][0], box[j][1], front_z(box[j][1])),
                    (box[k][0], box[k][1], front_z(box[k][1])),
                    front[k],
                    front[j],
                ]
                mesh.face(border, (0, 0, 1), "cheek")
                q = [front[j], front[k], inside[k], inside[j]]
                mesh.face(q, minus((x, y, z), average(q)), "joint")
            mesh.face(inside, (0, 0, 1), "bore")
    mesh.hull_z(
        [
            (-372, cx, 897 + front_offset, 945 + front_offset, 151, 10, 9),
            (-375, cx, 901 + front_offset, 940 + front_offset, 139, 10, 8),
        ],
        "cast",
        ("cast", "joint"),
    )


def gun(mesh, side, sign):
    mesh.section = f"geometry_rig_mount_{side}-gun"
    gun = mesh.anchor(f"physical_exit_{side}_gun_1")
    gx, gy, gz = gun
    mesh.hull_z(
        [
            (-240, gx, 581, 712, 164, 27, 25),
            (-188, gx, 549, 750, 229, 30, 30),
            (-32, gx, 549, 753, 226, 33, 33),
            (67, gx, 562, 715, 196, 29, 25),
            (111, gx, 582, 677, 142, 20, 20),
        ],
        lambda i, j: "deep" if j in (0, 1, 7) else "armor",
        ("cast", "cast"),
    )
    mesh.hull_z(
        [
            (-161, gx, 714, 754, 145, 17, 12),
            (-91, gx, 720, 768, 148, 18, 15),
            (-7, gx, 716, 761, 141, 16, 12),
            (45, gx, 695, 727, 111, 12, 7),
        ],
        "cheek",
    )
    # One inset at the main pivot, one chunky sleeve, one muzzle per assembly.
    mesh.cylinder((gx + sign * 94, 647, -105), (gx + sign * 119, 647, -105), 65, "cast")
    mesh.cylinder((gx + sign * 118, 647, -105), (gx + sign * 124, 647, -105), 40, "deep")
    mesh.cylinder((gx, gy, 76), (gx, gy, 151), 53, "joint")
    mesh.cylinder((gx, gy, 121), (gx, gy, 159), 48, "cast")
    mesh.cylinder((gx, gy, 147), (gx, gy, 318), 29, "cast")
    muzzle = [
        (283, gx, gy - 31, gy + 31, 67, 10, 10),
        (302, gx, gy - 43, gy + 43, 85, 14, 14),
        (gz, gx, gy - 36, gy + 36, 77, 13, 13),
    ]
    mesh.hull_z(muzzle, "cheek", ("cast", None))
    outer = ring_z(muzzle[-1])
    opening = [(a, b, gz) for a, b in clipped_rect(gx, gy, 44, 42, 9, 9)]
    inside = [(gx + 0.85 * (a - gx), gy + 0.85 * (b - gy), gz - 28) for a, b, _ in opening]
    for j in range(8):
        k = (j + 1) % 8
        mesh.face([outer[j], outer[k], opening[k], opening[j]], (0, 0, 1), "rim")
        q = [opening[j], opening[k], inside[k], inside[j]]
        mesh.face(q, minus((gx, gy, gz - 10), average(q)), "joint")
    mesh.face(inside, (0, 0, 1), "bore")


def leg(mesh, side, sign):
    mesh.section = f"geometry_rig_leg_{side}_thigh"
    hip = mesh.anchor(f"rig_leg_{side}_thigh")
    knee = mesh.anchor(f"rig_leg_{side}_shin")
    mesh.cylinder((sign * 82, hip[1], hip[2]), (sign * 201, hip[1], hip[2]), 49, "joint")
    mesh.cylinder(hip, knee, 48, "joint")
    mesh.hull_y(
        [
            (334, sign * 202, 50, 116, 122, 17, 21),
            (370, sign * 198, 41, 146, 159, 23, 28),
            (457, sign * 164, -34, 171, 184, 26, 34),
            (509, sign * 149, -73, 149, 155, 25, 26),
            (526, sign * 147, -86, 122, 112, 19, 22),
        ],
        "armor",
    )
    # A single forward shield establishes a light thigh plane either side of the dark hip.
    mesh.hull_y(
        [
            (365, sign * 198, 92, 93, 64, 13, 16),
            (388, sign * 191, 90, 113, 76, 16, 18),
            (485, sign * 159, 21, 125, 74, 16, 18),
            (506, sign * 155, 3, 98, 67, 14, 17),
        ],
        "cheek",
    )

    mesh.section = f"geometry_rig_leg_{side}_shin"
    ankle = mesh.anchor(f"rig_leg_{side}_foot")
    kx, ky, kz = knee
    mesh.cylinder((kx - sign * 85, ky, kz), (kx + sign * 82, ky, kz), 66, "joint")
    mesh.cylinder((kx + sign * 80, ky, kz), (kx + sign * 89, ky, kz), 49, "cast")
    mesh.cylinder((kx + sign * 88, ky, kz), (kx + sign * 92, ky, kz), 31, "cheek")
    mesh.cylinder(knee, ankle, 39, "cast")
    # The calf steps back under the knee and opens into a broad slanted shin guard.
    mesh.hull_y(
        [
            (94, sign * 224, -41, 94, 84, 14, 17),
            (153, sign * 235, -79, 112, 110, 17, 22),
            (224, sign * 227, -83, 129, 135, 20, 25),
            (280, sign * 217, -37, 133, 122, 21, 21),
            (313, sign * 205, 22, 92, 88, 15, 15),
        ],
        lambda i, j: "cheek" if j in (0, 1, 7) and i in (1, 2) else "deep",
    )
    # A narrow mechanical spar behind the knee and one visible piston replace
    # the source cluster of small links. Leave air beside the forward piston.
    mesh.cylinder((sign * 193, 121, 28), (sign * 188, 288, 68), 27, "cast")
    mesh.cylinder((sign * 193, 126, 31), (sign * 191, 198, 52), 24, "cheek")
    mesh.hull_y(
        [
            (95, sign * 239, 20, 75, 62, 12, 12),
            (147, sign * 247, 11, 78, 70, 13, 15),
            (233, sign * 240, -19, 87, 89, 16, 19),
            (256, sign * 233, -20, 73, 69, 11, 15),
        ],
        "armor",
    )
    mesh.hull_y(
        [
            (79, sign * 219, 38, 136, 69, 15, 14),
            (103, sign * 218, 43, 152, 79, 17, 16),
            (151, sign * 219, 28, 140, 65, 17, 13),
            (173, sign * 222, 13, 114, 57, 14, 13),
        ],
        lambda i, j: "deep" if j in (0, 1, 7) else "cheek",
    )
    mesh.section = f"geometry_rig_leg_{side}_foot"
    ax = ankle[0]
    mesh.cylinder((ax - sign * 65, ankle[1], ankle[2]), (ax + sign * 72, ankle[1], ankle[2]), 41, "joint")
    mesh.hull_y(
        [
            (0, ax, -33, 164, 220, 22, 27),
            (19, ax, -36, 174, 250, 24, 29),
            (52, ax, -38, 158, 211, 20, 24),
            (86, ax, -33, 102, 119, 14, 16),
        ],
        "cast",
    )
    # Toe notch and two heel cleats carry the silhouette down to the ground.
    for toe in (-1, 1):
        tx = ax + toe * 54
        tip = 198 if toe == sign else 211
        mesh.hull_z(
            [
                (6, tx, 3, 55, 74, 10, 10),
                (71, tx, 0, 70, 92, 12, 12),
                (137, tx, 0, 62, 94, 13, 11),
                (tip, tx, 0, 33, 73, 10, 8),
            ],
            lambda i, j: "armor" if i == 0 else "cheek",
            ("cast", "cheek"),
        )
    mesh.hull_z(
        [(-183, ax, 0, 39, 155, 20, 10), (-141, ax, 0, 67, 163, 22, 14), (-76, ax, 0, 58, 144, 16, 10)],
        lambda i, j: "armor" if i == 0 and j not in (0, 1, 7) else "deep",
    )


def build(mesh):
    torso(mesh)
    pelvis_and_connections(mesh)
    for side, sign in (("left", 1), ("right", -1)):
        shoulder_bank(mesh, side, sign)
        gun(mesh, side, sign)
        leg(mesh, side, sign)
