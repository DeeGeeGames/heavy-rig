"""Spire precision hunter. One tall cooling cabinet counterweights its left rifle."""

from .geometry import average, clipped_rect, minus, ring_z
from .kestrel import tube

PALETTE = {
    "plum": "896777",
    "berry": "705263",
    "umber": "543f4f",
    "bone": "dfd1ba",
    "rail": "716d72",
    "silver": "b2aca6",
    "glass": "edac47",
    "shine": "ffcd72",
    "ceramic": "b39bd2",
    "aqua": "82c7bc",
}
PAINT = {"plum": (1, 1), "berry": (1, 0.81), "umber": (1, 0.63), "bone": (2, 1)}
PELVIS = (0, 642, -16)
TORSO = (0, 696, -18)
HIP = (92, 643, -7)
KNEE = (127, 438, 53)
ANKLE = (153, 115, -22)
SOCKETS = (
    ("rig_mount_left-accelerator", (267, 617, -68)),
    ("rig_mount_right-compact-offhand", (-256, 596, 80)),
)
SLOTS = (1, 2, 2)


def plum_shell(segment, edge):
    return "umber" if edge in (0, 1, 7) else "plum"


def cooler(m):
    # Tall back cabinet, with a return line into the thorax at its mounting foot.
    m.hull_z(
        [
            (-248, 0, 804, 1081, 130, 18, 23),
            (-221, 0, 782, 1125, 175, 24, 27),
            (-161, 0, 784, 1135, 179, 25, 29),
            (-119, 0, 795, 1129, 175, 26, 27),
            (-91, 0, 813, 1104, 149, 21, 23),
        ],
        lambda i, j: "bone" if i == 2 else plum_shell(i, j),
        ("berry", "umber"),
    )
    m.hull_z(
        [
            (-217, 0, 1110, 1126, 107, 15, 4),
            (-183, 0, 1118, 1140, 129, 16, 6),
            (-146, 0, 1119, 1137, 123, 16, 5),
            (-130, 0, 1116, 1127, 98, 12, 3),
        ],
        "rail",
    )
    m.hull_z([(-241, 0, 850, 1050, 118, 13, 15), (-255, 0, 865, 1046, 115, 12, 13)], "rail", ("rail", "shadow"))
    for y in (880, 910, 940, 970, 1000, 1030):
        m.hull_z([(-253, 0, y - 7, y + 7, 94, 7, 3), (-261, 0, y - 3, y + 5, 88, 7, 2)], "rail")
    for s in (-1, 1):
        # Side grille is on the uninterrupted plum portion behind the bone band.
        x = s * 91
        m.hull_z(
            [
                (-222, x - s * 7, 846, 1055, 11, 2, 10),
                (-211, x, 839, 1066, 8, 2, 12),
                (-167, x, 840, 1063, 9, 2, 12),
                (-160, x - s * 2, 848, 1054, 8, 2, 9),
            ],
            "shadow",
        )
        for y in (862, 890, 918, 946, 974, 1002, 1030, 1054):
            m.beam((x + s * 5, y, -212), (x + s * 5, y + 3, -168), 8, 9, "rail")
        m.beam((s * 52, 794, -214), (s * 54, 745, -98), 36, 42, "joint")


def torso(m):
    m.section = "rig_torso"
    m.cylinder((0, 683, -18), (0, 751, -18), 63, "joint", 12)
    m.cylinder((0, 695, -18), (0, 715, -18), 72, "rail", 12)
    m.hull_z(
        [
            (-159, 0, 739, 898, 151, 24, 23),
            (-103, 0, 725, 929, 229, 32, 27),
            (-29, 0, 716, 946, 238, 35, 32),
            (53, 0, 717, 929, 202, 30, 29),
            (125, 0, 734, 892, 131, 18, 21),
            (150, 0, 748, 858, 83, 11, 15),
        ],
        plum_shell,
        ("umber", "berry"),
    )
    # The bone breastplate narrows into a keel under the raised pilot cell.
    m.hull_z(
        [
            (-94, 0, 892, 932, 119, 17, 8),
            (-32, 0, 866, 952, 145, 21, 14),
            (42, 0, 852, 941, 129, 19, 14),
            (103, 0, 781, 910, 101, 15, 16),
            (139, 0, 747, 885, 76, 10, 16),
            (155, 0, 751, 873, 61, 8, 13),
        ],
        "bone",
    )
    for s in (-1, 1):
        m.hull_z(
            [
                (-98, s * 74, 757, 928, 68, 9, 21),
                (-24, s * 83, 746, 940, 72, 10, 20),
                (47, s * 83, 741, 926, 60, 9, 18),
                (91, s * 77, 754, 908, 44, 6, 15),
            ],
            plum_shell,
            ("berry", "berry"),
        )
        # Forward-facing chest vents flank the ivory keel.
        m.hull_z([(89, s * 77, 786, 863, 35, 4, 7), (94, s * 77, 790, 861, 31, 4, 6)], "joint", ("joint", "shadow"))
        for y in (805, 824, 843):
            m.hull_z([(94, s * 77, y - 3, y + 6, 23, 2, 2), (98, s * 77, y, y + 5, 21, 2, 1)], "rail")
    # Raised seat and descending glass are protected by two ivory cheeks.
    m.hull_z(
        [
            (-123, 0, 901, 1004, 89, 14, 15),
            (-78, 0, 913, 1051, 113, 18, 18),
            (-25, 0, 921, 1064, 111, 17, 16),
            (25, 0, 929, 1044, 104, 15, 14),
            (60, 0, 934, 988, 91, 12, 10),
            (75, 0, 931, 971, 78, 10, 9),
        ],
        "bone",
    )
    visor_base = [
        (-72, 0, 1020, 1058, 69, 10, 6),
        (-27, 0, 1010, 1069, 82, 12, 8),
        (14, 0, 989, 1057, 81, 11, 9),
        (41, 0, 970, 1035, 74, 10, 8),
        (68, 0, 947, 976, 67, 9, 6),
    ]
    m.hull_z(visor_base, "joint")

    def incline(x, z, lift):
        return (x, 1035 + (976 - 1035) * (z - 41) / 27 + lift, z)

    m.patch([incline(x, z, 0.9) for x, z in [(-23, 45), (23, 45), (21, 64), (-21, 64)]], "glass")
    m.hull_z(
        [
            (-68, 0, 1047, 1062, 65, 8, 4),
            (-23, 0, 1050, 1071, 81, 10, 5),
            (17, 0, 1040, 1062, 83, 10, 5),
            (42, 0, 1029, 1042, 79, 9, 4),
            (48, 0, 1025, 1033, 69, 8, 2),
        ],
        "rail",
    )
    cooler(m)
    for s in (1, -1):
        m.cylinder((s * 92, 857, -44), (s * 172, 857, -44), 43, "joint", 12)
        m.hull_z(
            [
                (-102, s * 162, 853, 891, 65, 10, 9),
                (-65, s * 167, 839, 908, 91, 13, 12),
                (6, s * 176, 834, 901, 101, 15, 13),
                (59, s * 173, 842, 881, 82, 12, 8),
            ],
            lambda i, j: "bone" if s < 0 and j in (3, 4, 5) else plum_shell(i, j),
            ("berry", "plum"),
        )
    # On the rifle side the exposed bent return yoke and the plum upper link
    # converge at the elbow pin, which remains on the chassis during refits.
    m.beam((160, 838, -40), (220, 730, -66), 55, 61, "berry")
    m.cylinder((186, 729, -69), (253, 729, -69), 32, "joint", 10)
    m.beam((201, 865, -53), (278, 823, -100), 31, 39, "rail")
    m.beam((278, 823, -100), (295, 738, -119), 33, 42, "rail")
    m.beam((231, 731, -72), (267, 622, -67), 44, 49, "joint")
    m.hull_y(
        [
            (617, 269, -79, 55, 92, 10, 15),
            (654, 270, -86, 73, 99, 12, 15),
            (712, 270, -90, 80, 98, 12, 14),
            (743, 263, -91, 63, 78, 9, 12),
        ],
        "berry",
    )
    m.cylinder((227, 617, -68), (308, 617, -68), 43, "joint", 12)
    m.cylinder((299, 617, -68), (314, 617, -68), 30, "rail", 12)
    # Closed service clamp on the unarmed right forearm. The B/C adapter
    # nests around the last knuckle and adds a second pinned load path.
    m.beam((-166, 846, -23), (-205, 753, -5), 48, 52, "joint")
    m.cylinder((-241, 747, 6), (-180, 747, 6), 31, "rail", 10)
    m.hull_y(
        [
            (632, -241, 58, 49, 57, 8, 9),
            (650, -238, 51, 66, 72, 11, 11),
            (711, -220, 21, 66, 73, 11, 12),
            (737, -211, 12, 49, 57, 8, 9),
        ],
        "plum",
        ("umber", "berry"),
    )
    m.beam((-241, 647, 49), (-256, 601, 77), 36, 39, "joint")
    m.hull_z(
        [
            (46, -253, 588, 626, 36, 5, 7),
            (66, -256, 582, 628, 45, 6, 8),
            (87, -256, 578, 620, 42, 6, 7),
            (98, -256, 580, 608, 35, 5, 6),
        ],
        "bone",
    )
    for shift in (-13, 13):
        m.beam((-256 + shift, 593, 87), (-256 + shift, 570, 85), 14, 17, "rail")
        m.beam((-256 + shift, 571, 85), (-256 + shift * 0.5, 568, 76), 13, 14, "joint")


def leg(m, side, s):
    hx, hy, hz = HIP
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    m.section = f"rig_leg_{side}_thigh"
    m.cylinder((s * (hx - 29), hy, hz), (s * (hx + 32), hy, hz), 39, "joint", 12)
    m.beam((s * hx, hy, hz), (s * kx, ky, kz), 48, 57, "joint")
    m.hull_y(
        [
            (461, s * 125, 52, 58, 59, 8, 9),
            (488, s * 121, 48, 72, 80, 10, 12),
            (611, s * 99, 4, 86, 97, 12, 16),
            (657, s * 88, -13, 76, 87, 11, 14),
            (679, s * 85, -22, 52, 55, 8, 10),
        ],
        plum_shell,
    )
    m.section = f"rig_leg_{side}_shin"
    m.cylinder((s * (kx - 31), ky, kz), (s * (kx + 36), ky, kz), 38, "joint", 12)
    m.cylinder((s * (kx + 34), ky, kz), (s * (kx + 40), ky, kz), 29, "rail", 12)
    m.beam((s * kx, ky, kz), (s * ax, ay, az), 43, 51, "joint")
    m.hull_y(
        [
            (128, s * 150, -12, 58, 58, 9, 10),
            (164, s * 149, -14, 69, 74, 10, 12),
            (274, s * 139, -1, 73, 83, 11, 15),
            (334, s * 136, 1, 96, 91, 16, 14),
            (379, s * 132, 2, 84, 84, 13, 14),
            (410, s * 130, 10, 55, 55, 9, 10),
        ],
        plum_shell,
    )
    # A cutaway above the long greave exposes the working length of the ram.
    m.cylinder((s * 135, 283, 47), (s * 127, 415, 78), 12, "silver", 10)
    m.cylinder((s * 138, 267, 42), (s * 135, 317, 56), 17, "joint", 10)
    m.hull_y(
        [
            (138, s * 151, 8, 47, 63, 7, 11),
            (176, s * 148, 10, 58, 67, 8, 11),
            (273, s * 142, 19, 60, 64, 9, 10),
            (307, s * 139, 23, 56, 49, 8, 8),
        ],
        "plum",
        ("berry", "berry"),
    )
    m.hull_y(
        [
            (403, s * 127, 76, 48, 41, 7, 7),
            (420, s * 127, 86, 62, 53, 9, 8),
            (459, s * 125, 83, 63, 47, 9, 8),
            (483, s * 121, 69, 53, 43, 8, 7),
        ],
        "bone",
    )
    m.section = f"rig_leg_{side}_foot"
    m.cylinder((s * (ax - 29), ay, az), (s * (ax + 34), ay, az), 34, "joint", 10)
    m.cylinder((s * (ax + 32), ay, az), (s * (ax + 39), ay, az), 24, "rail", 10)
    m.hull_z(
        [
            (-100, s * ax, 0, 32, 91, 11, 6),
            (-77, s * ax, 0, 66, 104, 13, 11),
            (-30, s * ax, 0, 68, 97, 12, 12),
            (13, s * ax, 0, 53, 91, 10, 9),
            (75, s * ax, 0, 34, 91, 10, 6),
            (109, s * ax, 0, 17, 86, 8, 4),
        ],
        plum_shell,
    )
    m.hull_z(
        [
            (-36, s * ax, 79, 120, 63, 10, 7),
            (-17, s * ax, 86, 141, 81, 11, 9),
            (21, s * ax, 67, 122, 81, 12, 9),
            (39, s * ax, 55, 89, 77, 11, 7),
        ],
        "plum",
    )
    for shift in (-30, 30):
        x = s * ax + shift
        m.hull_z(
            [(18, x, 0, 50, 39, 6, 8), (48, x, 0, 56, 46, 7, 9), (86, x, 0, 39, 48, 7, 7), (121, x, 0, 22, 48, 6, 5)],
            lambda i, j: "rail" if j in (0, 1, 7) else "bone",
            ("berry", "rail"),
        )


def body(m):
    torso(m)
    m.section = "rig_pelvis"
    m.cylinder((0, 641, -16), (0, 695, -18), 63, "joint", 12)
    m.cylinder((-101, 643, -7), (101, 643, -7), 33, "joint", 12)
    m.hull_y(
        [
            (574, 0, 13, 61, 66, 9, 11),
            (596, 0, 16, 81, 81, 13, 12),
            (644, 0, 2, 102, 97, 16, 15),
            (667, 0, -7, 89, 79, 13, 12),
        ],
        "berry",
    )
    for side, s in (("left", 1), ("right", -1)):
        leg(m, side, s)


def brace(m, variant):
    if variant == "a":
        return
    m.beam((-209, 742, 4), (-272, 672, 60), 24, 30, "rail")
    m.beam((-272, 672, 60), (-276, 605, 81), 27, 33, "joint")
    m.hull_z(
        [
            (35, -257, 570, 610, 65, 10, 8),
            (63, -257, 566, 623, 80, 11, 9),
            (101, -256, 569, 619, 77, 11, 9),
            (113, -256, 577, 611, 66, 9, 7),
        ],
        "berry",
        ("rail", "joint"),
    )
    m.cylinder((-314, 595, 77), (-302, 595, 77), 20, "rail", 10)


def particle(m, x, y):
    m.hull_z(
        [
            (-232, x, y - 32, y + 61, 69, 11, 14),
            (-193, x, y - 54, y + 77, 113, 17, 18),
            (-82, x, y - 58, y + 80, 129, 17, 18),
            (36, x, y - 57, y + 57, 124, 16, 16),
            (167, x, y - 32, y + 51, 109, 14, 14),
            (324, x, y - 30, y + 42, 100, 12, 13),
            (380, x, y - 36, y + 36, 107, 14, 11),
            (411, x, y - 30, y + 30, 96, 11, 10),
        ],
        lambda i, j: "bone" if i >= 5 and j not in (0, 1, 7) else plum_shell(i, j),
        ("umber", None),
    )
    m.hull_z(
        [
            (-50, x, y + 51, y + 77, 72, 10, 7),
            (18, x, y + 48, y + 84, 82, 11, 7),
            (121, x, y + 42, y + 71, 77, 11, 7),
            (171, x, y + 41, y + 56, 65, 9, 5),
        ],
        "bone",
    )
    m.hull_z(
        [
            (180, x, y + 47, y + 57, 55, 7, 3),
            (206, x, y + 46, y + 66, 66, 9, 5),
            (301, x, y + 35, y + 57, 66, 9, 5),
            (327, x, y + 35, y + 47, 55, 6, 3),
        ],
        "bone",
    )
    m.cylinder((x + 49, y + 8, -63), (x + 72, y + 8, -63), 40, "rail", 12)
    m.cylinder((x + 71, y + 8, -63), (x + 78, y + 8, -63), 29, "joint", 12)

    # The three dark service slots lie against the tapered flank of the barrel cradle.
    def flank(z, h):
        width = 124 + (109 - 124) * (z - 36) / (167 - 36)
        return (x + width / 2 + 0.7, y + h, z)

    for z in (66, 87, 108):
        m.patch([flank(z, -9), flank(z + 7, -6), flank(z + 7, 14), flank(z, 11)], "umber", (1, 0, 0))
    # Squared ceramic accelerator window inside the split collar. The aperture
    # is physically recessed behind the bone nose by 15 mm.
    rim = ring_z((411, x, y - 30, y + 30, 96, 11, 10))
    opening = [(*p, 412) for p in clipped_rect(x, y, 74, 46, 8, 6)]
    bed = [(*p, 397) for p in clipped_rect(x, y, 68, 40, 7, 5)]
    for j in range(8):
        k = (j + 1) % 8
        m.face([rim[j], rim[k], opening[k], opening[j]], (0, 0, 1), "rail")
        wall = [opening[j], opening[k], bed[k], bed[j]]
        m.face(wall, minus((x, y, 406), average(wall)), "joint")
    m.face(bed, (0, 0, 1), "ceramic")
    return (x, y, 412), ()


def rifle(m, x, y):
    m.hull_z(
        [
            (-213, x, y - 35, y + 45, 69, 11, 12),
            (-157, x, y - 48, y + 59, 92, 14, 16),
            (-50, x, y - 49, y + 60, 99, 14, 16),
            (86, x, y - 39, y + 47, 87, 12, 13),
            (161, x, y - 30, y + 34, 71, 11, 10),
            (198, x, y - 24, y + 27, 59, 8, 9),
        ],
        plum_shell,
        ("umber", "rail"),
    )
    m.hull_z(
        [
            (-63, x + 44, y - 34, y + 29, 23, 4, 6),
            (-23, x + 51, y - 38, y + 40, 37, 6, 9),
            (60, x + 48, y - 36, y + 34, 33, 5, 8),
            (78, x + 42, y - 27, y + 22, 21, 4, 5),
        ],
        "bone",
    )
    m.hull_z(
        [(174, x, y - 26, y + 32, 64, 8, 9), (243, x, y - 25, y + 30, 61, 8, 9), (351, x, y - 16, y + 23, 45, 6, 6)],
        "rail",
        ("rail", "joint"),
    )
    m.cylinder((x, y, 333), (x, y, 472), 17, "rail", 12)
    m.cylinder((x, y, 338), (x, y, 368), 24, "joint", 12)
    tube(m, x, y, 463, 516, 24, 12)
    return (x, y, 516), ()


def cartridge(m, variant, slot):
    if slot == 0:
        x = SOCKETS[0][1][0]
        return rifle(m, x, 607) if variant == "b" else particle(m, x, 607)
    x, y = SOCKETS[1][1][0], 590
    if variant == "b":
        m.hull_z(
            [
                (64, x, y - 17, y + 24, 52, 7, 5),
                (98, x, y - 30, y + 33, 69, 10, 8),
                (145, x, y - 28, y + 32, 67, 10, 8),
                (191, x, y - 18, y + 19, 49, 7, 6),
            ],
            lambda i, j: "bone" if i == 2 and j in (3, 4, 5) else plum_shell(i, j),
            ("joint", "rail"),
        )
        m.hull_z([(190, x, y - 12, y + 13, 38, 5, 4), (195, x, y - 10, y + 11, 33, 4, 3)], "joint", ("rail", "aqua"))
        return (x, y, 195), ()
    m.hull_z(
        [
            (64, x, y - 17, y + 24, 53, 7, 6),
            (95, x, y - 32, y + 39, 87, 13, 10),
            (142, x, y - 31, y + 40, 95, 14, 10),
            (180, x, y - 25, y + 32, 88, 13, 8),
        ],
        plum_shell,
        ("joint", "joint"),
    )
    for dx in (-21, 21):
        tube(m, x + dx, y + 3, 178, 196, 17, 8)
    m.hull_z(
        [
            (139, x, y + 32, y + 42, 65, 9, 3),
            (170, x, y + 30, y + 41, 70, 10, 3),
            (196, x, y + 19, y + 29, 69, 10, 3),
        ],
        "bone",
    )
    return (x, y + 3, 196), ((x - 21, y + 3, 196), (x + 21, y + 3, 196))
