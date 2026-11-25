"""Square Slate. Dimensions and paint boundaries follow the retained Rook A concept."""

import math

from .geometry import average, clipped_rect, minus, ring_z
from .kestrel import barrel_ring, tube

PALETTE = {
    "slate": "62718c",
    "deck": "4d5b75",
    "keel": "3d485f",
    "ivory": "e9dcc7",
    "cast": "57585e",
    "joint": "404249",
    "shadow": "252832",
    "bore": "10141b",
    "silver": "abb0b6",
    "steel": "696c73",
    "glass": "f5aa44",
    "shine": "ffd06e",
    "violet": "aa92d0",
    "aqua": "84c9bf",
}
PAINT = {"slate": (1, 1), "deck": (1, 0.80), "keel": (1, 0.63), "ivory": (2, 1)}
PELVIS = (0, 516, -14)
TORSO = (0, 565, -12)
HIP = (117, 495, -14)
KNEE = (177, 326, 58)
ANKLE = (207, 99, -14)
SOCKETS = (
    ("rig_mount_left-gun", (290, 602, -20)),
    ("rig_mount_right-gun", (-290, 602, -20)),
    ("rig_mount_dorsal-launcher", (0, 870, -64)),
)
SLOTS = (3, 3, 3)


def armor(segment, edge):
    return "keel" if edge in (0, 1, 7) else "slate"


def chest(m):
    m.section = "rig_torso"
    m.cylinder((0, 556, -12), (0, 611, -12), 64, "joint", 12)
    m.cylinder((0, 567, -12), (0, 585, -12), 71, "steel", 12)
    # The cream mantle wraps around the prow and raises two cheeks beside the visor.
    m.hull_z(
        [
            (-133, 0, 644, 768, 167, 25, 23),
            (-91, 0, 614, 794, 206, 30, 28),
            (-25, 0, 593, 804, 216, 29, 30),
            (55, 0, 594, 760, 204, 26, 29),
            (114, 0, 612, 707, 157, 19, 21),
            (166, 0, 619, 673, 96, 12, 12),
        ],
        armor,
        ("deck", "deck"),
    )
    m.hull_z(
        [
            (-78, 0, 716, 799, 176, 22, 17),
            (-25, 0, 702, 811, 192, 28, 16),
            (28, 0, 686, 790, 203, 30, 19),
            (67, 0, 676, 757, 187, 27, 16),
            (119, 0, 661, 716, 149, 22, 15),
            (169, 0, 654, 686, 88, 9, 8),
        ],
        "ivory",
    )
    # The armored brow ends ahead of the dark frame; glass is inset under its edge.
    m.hull_z(
        [
            (-82, 0, 786, 803, 65, 9, 4),
            (-33, 0, 793, 822, 87, 10, 5),
            (20, 0, 780, 818, 89, 9, 5),
            (58, 0, 759, 795, 84, 8, 5),
            (66, 0, 754, 775, 78, 7, 4),
        ],
        "deck",
        ("deck", "shadow"),
    )
    m.hull_z([(63, 0, 751, 777, 66, 5, 4), (70, 0, 752, 775, 63, 4, 3)], "joint")
    m.patch([(-25, 755, 70.5), (24, 755, 70.5), (27, 772, 70.5), (-22, 772, 70.5)], "glass", (0, 0, 1))
    m.hull_z(
        [
            (-33, 0, 810, 824, 80, 9, 3),
            (20, 0, 806, 822, 88, 9, 4),
            (59, 0, 780, 800, 86, 9, 5),
            (75, 0, 776, 783, 73, 7, 2),
        ],
        "slate",
    )
    for s in (1, -1):
        # Each intake has its own shadowed plenum and louvers, well above the arm pivot.
        m.hull_z(
            [
                (-139, s * 130, 687, 771, 65, 12, 13),
                (-104, s * 131, 671, 798, 87, 15, 19),
                (-50, s * 137, 658, 804, 100, 15, 23),
                (25, s * 142, 650, 787, 97, 13, 20),
                (90, s * 140, 656, 743, 78, 11, 14),
                (102, s * 139, 663, 735, 70, 8, 11),
            ],
            armor,
            ("keel", "deck"),
        )
        m.hull_z(
            [(101, s * 139, 670, 726, 57, 6, 6), (105, s * 139, 671, 725, 55, 6, 6)], "joint", ("joint", "shadow")
        )
        for y in (681, 695, 709):
            m.hull_z([(105, s * 139, y - 2, y + 6, 43, 4, 2), (110, s * 139, y, y + 4, 40, 3, 1)], "steel")
        m.beam((s * 124, 697, -33), (s * 151, 626, -24), 47, 57, "joint")
        m.cylinder((s * 109, 634, -25), (s * 206, 634, -25), 32, "joint", 10)
        m.beam((s * 188, 635, -25), (s * 275, 604, -19), 49, 56, "cast")
        m.cylinder((s * 247, 602, -20), (s * 297, 602, -20), 42, "joint", 12)
        # Paired swept roof struts carry the high center pod; keep their daylight.
        m.beam((s * 62, 782, -30), (s * 62, 878, -62), 33, 40, "joint")
        m.beam((s * 62, 795, -101), (s * 62, 875, -104), 30, 32, "cast")
    m.hull_z([(-113, 0, 863, 884, 169, 13, 5), (-31, 0, 861, 882, 167, 13, 6)], "cast")
    m.hull_z([(-129, 0, 642, 754, 143, 16, 14), (-147, 0, 650, 743, 134, 15, 11)], "keel", ("deck", "shadow"))
    for y in (671, 692, 713):
        m.hull_z([(-146, 0, y - 2, y + 9, 106, 8, 3), (-152, 0, y + 1, y + 7, 99, 7, 2)], "deck")


def leg(m, side, s):
    hx, hy, hz = HIP
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    m.section = f"rig_leg_{side}_thigh"
    m.cylinder((s * (hx - 27), hy, hz), (s * (hx + 29), hy, hz), 43, "joint", 12)
    m.beam((s * hx, hy, hz), (s * kx, ky, kz), 56, 65, "joint")
    m.hull_y(
        [
            (363, s * 164, 47, 67, 67, 9, 9),
            (381, s * 162, 47, 91, 94, 12, 14),
            (461, s * 132, 5, 104, 117, 16, 19),
            (487, s * 122, -11, 82, 98, 13, 16),
            (507, s * 117, -19, 60, 69, 10, 12),
        ],
        "slate",
        ("keel", "deck"),
    )
    m.cylinder((s * (hx + 42), 464, 13), (s * (kx + 34), 345, 78), 13, "silver")
    m.cylinder((s * (hx + 43), 463, 13), (s * 197, 405, 44), 18, "steel")
    m.section = f"rig_leg_{side}_shin"
    m.cylinder((s * (kx - 34), ky, kz), (s * (kx + 37), ky, kz), 39, "joint", 12)
    m.cylinder((s * (kx + 36), ky, kz), (s * (kx + 42), ky, kz), 27, "steel", 12)
    m.beam((s * kx, ky, kz), (s * ax, ay, az), 46, 54, "joint")
    # A U-shaped greave frames the bright working piston. The two cheeks enclose
    # the cast spine behind it and leave the piston visible in a front view.
    for edge in (-1, 1):
        m.hull_y(
            [
                (135, s * 203 + edge * 28, -11, 30, 63, 5, 10),
                (150, s * 202 + edge * 32, -13, 38, 80, 6, 12),
                (258, s * 186 + edge * 36, 3, 46, 110, 7, 18),
                (303, s * 180 + edge * 31, 6, 37, 97, 6, 18),
                (316, s * 179 + edge * 22, 20, 31, 68, 5, 13),
            ],
            "slate",
            ("keel", "deck"),
        )
    m.cylinder((s * 199, 138, 40), (s * 180, 299, 87), 14, "silver", 10)
    m.cylinder((s * 182, 265, 78), (s * 177, 313, 90), 18, "joint", 10)
    m.hull_y(
        [
            (294, s * 180, 87, 57, 38, 8, 7),
            (306, s * 178, 91, 70, 51, 9, 9),
            (345, s * 174, 98, 72, 45, 10, 8),
            (366, s * 171, 81, 57, 40, 8, 7),
        ],
        "ivory",
    )
    m.section = f"rig_leg_{side}_foot"
    m.cylinder((s * (ax - 37), ay, az), (s * (ax + 38), ay, az), 35, "joint", 12)
    m.cylinder((s * (ax + 36), ay, az), (s * (ax + 41), ay, az), 25, "steel", 12)
    m.hull_z(
        [
            (-114, s * ax, 0, 22, 101, 12, 6),
            (-83, s * ax, 0, 62, 117, 14, 10),
            (-48, s * ax, 0, 84, 115, 14, 13),
            (-2, s * ax, 0, 71, 105, 11, 11),
            (46, s * ax, 0, 48, 123, 13, 10),
            (116, s * ax, 0, 25, 124, 14, 6),
            (151, s * ax, 0, 16, 113, 11, 4),
        ],
        armor,
        ("keel", "keel"),
    )
    m.hull_z(
        [
            (-35, s * ax, 63, 112, 79, 11, 9),
            (-11, s * ax, 71, 127, 94, 11, 10),
            (29, s * ax, 59, 113, 94, 12, 9),
            (49, s * ax, 54, 87, 89, 10, 7),
        ],
        "ivory",
        ("ivory", "joint"),
    )
    for toe in (-1, 1):
        x = s * ax + toe * 42
        m.hull_z(
            [
                (26, x, 6, 51, 44, 6, 7),
                (56, x, 4, 55, 51, 6, 7),
                (106, x, 2, 37, 54, 6, 6),
                (153, x, 2, 24, 57, 6, 5),
                (158, x, 3, 18, 49, 4, 3),
            ],
            lambda i, j: "keel" if i == 0 else "ivory",
            ("deck", "ivory"),
        )


def body(m):
    chest(m)
    m.section = "rig_pelvis"
    m.cylinder((0, 520, -12), (0, 568, -12), 64, "joint", 12)
    m.cylinder((0, 543, -12), (0, 561, -12), 69, "steel", 12)
    m.cylinder((-127, 495, -14), (127, 495, -14), 40, "joint", 12)
    m.hull_y(
        [
            (433, 0, 3, 95, 82, 14, 14),
            (453, 0, 7, 118, 98, 19, 16),
            (488, 0, 0, 142, 116, 22, 18),
            (525, 0, -6, 140, 118, 20, 17),
            (545, 0, -9, 108, 88, 15, 14),
        ],
        lambda i, j: "ivory" if i >= 2 and j in (3, 4, 5) else "deck",
    )
    for side, s in (("left", 1), ("right", -1)):
        leg(m, side, s)


def dorsal(m, guided):
    # The approved eight-cell external face depletes in two-round cycles. Guided
    # cartridges reuse the casing and exchange the entire nose for a two-well insert.
    rear = [
        (-167, 0, 900, 966, 144, 17, 13),
        (-145, 0, 875, 984, 191, 22, 17),
        (-107, 0, 873, 988, 204, 23, 18),
        (-7, 0, 873, 987, 206, 24, 20),
        (26, 0, 879, 984, 195, 21, 18),
        (41, 0, 886, 976, 183, 15, 14),
    ]
    m.hull_z(rear, lambda i, j: "ivory" if i >= 3 else "keel" if j in (0, 1, 7) else "slate", ("deck", None))
    m.hull_z(
        [
            (-108, 0, 979, 990, 64, 8, 3),
            (-76, 0, 982, 999, 76, 9, 4),
            (-38, 0, 983, 998, 72, 9, 4),
            (-10, 0, 981, 988, 58, 8, 2),
        ],
        "deck",
    )
    # The per-cell rectangular tiles share edges; their octagonal openings extend
    # into the cassette. No solid face crosses the front of any opening.
    z = 43
    cx, cy = 0, 931
    cols, rows = (2, 1) if guided else (4, 2)
    pitch_x, pitch_y = 150 / cols, 71 / rows
    cut = 6
    rim = ring_z(rear[-1])
    boundary = [
        (-75 + cut, cy - 35.5),
        (75 - cut, cy - 35.5),
        (75, cy - 35.5),
        (75, cy + 35.5),
        (75 - cut, cy + 35.5),
        (-75 + cut, cy + 35.5),
        (-75, cy + 35.5),
        (-75, cy - 35.5),
    ]
    boundary = [(x, y, z) for x, y in boundary]
    for j in range(8):
        k = (j + 1) % 8
        m.face([rim[j], rim[k], boundary[k], boundary[j]], (0, 0, 1), "ivory")
    exits = []
    for r in range(rows):
        for c in range(cols):
            x = cx + (c - (cols - 1) / 2) * pitch_x
            y = cy + (r - (rows - 1) / 2) * pitch_y
            left, bottom = x - pitch_x / 2, y - pitch_y / 2
            right, top = x + pitch_x / 2, y + pitch_y / 2
            tile = [
                (left + cut, bottom),
                (right - cut, bottom),
                (right, bottom),
                (right, top),
                (right - cut, top),
                (left + cut, top),
                (left, top),
                (left, bottom),
            ]
            w, hole_h = (50, 48) if guided else (26, 26)
            mouth = clipped_rect(x, y, w, hole_h, w * 0.26, hole_h * 0.26)
            back = clipped_rect(x, y, w * 0.83, hole_h * 0.83, w * 0.22, hole_h * 0.22)
            floor = [(u, v, z - 19) for u, v in back]
            for j in range(8):
                k = (j + 1) % 8
                lip = [(*mouth[n], z) for n in (k, j)]
                m.face([(*tile[j], z), (*tile[k], z), *lip], (0, 0, 1), "steel")
                wall = [(*mouth[j], z), (*mouth[k], z), floor[k], floor[j]]
                m.face(wall, minus((x, y, z - 9), average(wall)), "joint")
            m.face(floor, (0, 0, 1), "bore")
            exits.append((x, y, z))
    firing = exits if guided else (exits[1], exits[6])
    return (cx, cy, z), tuple(firing)


def cannon_sleeve(m, x, y):
    # Two elongated cooling slots appear on the visible cheek of the reference
    # cuff. Cut them into the cast wall so the recesses survive a grazing view.
    sides = 12
    back = barrel_ring(x, y, 164, 33, sides)
    rim = barrel_ring(x, y, 251, 33, sides)
    mouth = barrel_ring(x, y, 251, 23, sides)
    well = barrel_ring(x, y, 217, 22, sides)
    for j in range(sides):
        k = (j + 1) % sides
        normal = minus(average([rim[j], rim[k]]), (x, y, 251))
        if j in (0, 4, 6, 10):

            def wall_sample(a, b, depth=0):
                xy = tuple((1 - a) * rim[j][n] + a * rim[k][n] for n in range(2))
                return (x + (xy[0] - x) * (33 - depth) / 33, y + (xy[1] - y) * (33 - depth) / 33, b)

            contour = [
                (0.08, 189),
                (0.20, 179),
                (0.80, 179),
                (0.92, 189),
                (0.92, 224),
                (0.80, 231),
                (0.20, 231),
                (0.08, 224),
            ]
            hole = [wall_sample(a, b) for a, b in contour]
            deep = [wall_sample(a, b, 5) for a, b in contour]
            outer = [
                wall_sample(0, 174),
                wall_sample(0.16, 164),
                wall_sample(0.84, 164),
                wall_sample(1, 174),
                wall_sample(1, 239),
                wall_sample(0.84, 251),
                wall_sample(0.16, 251),
                wall_sample(0, 239),
            ]
            for n in range(8):
                v = (n + 1) % 8
                m.face([outer[n], outer[v], hole[v], hole[n]], normal, "steel")
                wall = [hole[n], hole[v], deep[v], deep[n]]
                m.face(wall, minus(average(deep), average(wall)), "joint")
            for a, b, c in [
                (back[j], outer[1], outer[0]),
                (back[k], outer[3], outer[2]),
                (rim[k], outer[5], outer[4]),
                (rim[j], outer[7], outer[6]),
            ]:
                m.face([a, b, c], normal, "steel")
            m.face(deep, normal, "shadow")
        else:
            m.face([back[j], back[k], rim[k], rim[j]], normal, "steel")
        m.face([rim[j], rim[k], mouth[k], mouth[j]], (0, 0, 1), "steel")
        wall = [mouth[j], mouth[k], well[k], well[j]]
        m.face(wall, minus((x, y, 235), average(wall)), "joint")
    m.face(well, (0, 0, 1), "bore")


def cartridge(m, variant, slot):
    if slot == 2:
        return dorsal(m, variant != "a")
    kind = {"a": ("cannon", "cluster"), "b": ("particle", "cluster"), "c": ("cluster", "laser")}[variant][slot]
    x = SOCKETS[slot][1][0]
    y = 591
    width = 135 if kind in ("cannon", "particle") else 110
    # All four arm cartridges have the Square Slate cream retaining collar,
    # an armored rear magazine and a common inset side pin.
    m.hull_z(
        [
            (-140, x, y - 39, y + 39, width * 0.76, 12, 12),
            (-121, x, y - 60, y + 54, width, 17, 16),
            (-79, x, y - 64, y + 64, width * 1.12, 18, 18),
            (-1, x, y - 64, y + 64, width * 1.12, 18, 18),
            (51, x, y - 58, y + 57, width, 17, 16),
            (74, x, y - 48, y + 46, width * 0.9, 13, 13),
        ],
        lambda i, j: "ivory" if i == 4 and j not in (0, 1, 7) or i == 3 and j in (3, 4, 5) else armor(i, j),
        ("deck", "joint"),
    )
    m.hull_z(
        [
            (-79, x, y + 48, y + 65, width * 0.53, 9, 4),
            (-53, x, y + 54, y + 73, width * 0.59, 9, 4),
            (1, x, y + 54, y + 72, width * 0.60, 8, 4),
            (34, x, y + 47, y + 58, width * 0.53, 8, 3),
        ],
        "slate",
    )
    # The armor cheeks run behind the cream collar, as on the own-left
    # silhouette of Square Slate. A deep inset closes at the back of each pack.
    sign = 1 if slot == 0 else -1
    cheek_x = x + sign * width * 0.43
    m.hull_z(
        [
            (-120, cheek_x, y - 39, y + 28, 22, 3, 8),
            (-96, cheek_x, y - 47, y + 42, 34, 5, 9),
            (5, cheek_x, y - 46, y + 37, 33, 5, 9),
            (46, cheek_x, y - 33, y + 30, 25, 4, 7),
        ],
        "deck",
    )
    if kind == "cannon":
        m.cylinder((x, y, 63), (x, y, 114), 41, "joint", 12)
        m.cylinder((x, y, 92), (x, y, 198), 30, "steel", 12)
        cannon_sleeve(m, x, y)
        return (x, y, 251), ()
    if kind == "cluster":
        m.hull_z(
            [(60, x, y - 41, y + 41, 77, 11, 11), (94, x, y - 36, y + 36, 70, 10, 10)], "joint", ("joint", "shadow")
        )
        for step in range(6):
            angle = math.radians(30 + step * 60)
            tube(m, x + 22 * math.cos(angle), y + 22 * math.sin(angle), 89, 165, 10.7, 8)
        return (x + 22 * math.cos(math.radians(30)), y + 11, 165), ()
    if kind == "particle":
        rows = [
            (64, x, y - 34, y + 35, 80, 13, 12),
            (104, x, y - 36, y + 38, 79, 12, 12),
            (171, x, y - 22, y + 27, 57, 8, 8),
            (198, x, y - 24, y + 26, 62, 9, 8),
        ]
        m.hull_z(rows, lambda i, j: "ivory" if i == 1 and j in (3, 4, 5) else "deck", ("joint", "joint"))
        m.hull_z(
            [(198, x, y - 16, y + 17, 45, 6, 5), (201, x, y - 13, y + 14, 39, 6, 4)], "shadow", ("shadow", "violet")
        )
        return (x, y, 201), ()
    m.hull_z(
        [(69, x, y - 30, y + 28, 67, 10, 8), (110, x, y - 25, y + 25, 62, 10, 8), (123, x, y - 21, y + 20, 55, 9, 7)],
        "deck",
        ("joint", "joint"),
    )
    m.hull_z([(123, x, y - 9, y + 10, 39, 6, 4), (124, x, y - 8, y + 9, 36, 5, 3)], "shadow", ("joint", "aqua"))
    return (x, y, 124), ()
