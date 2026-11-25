"""Bulwark missile carrier. A low bridge and two breech saddles share a yaw bearing."""

from .geometry import average, clipped_rect, minus, ring_z

PALETTE = {
    "olive": "85885c",
    "leaf": "a3a375",
    "peat": "5e6547",
    "buff": "dfb889",
    "sand": "b99a72",
    "rack": "575650",
    "silver": "959892",
    "glass": "e7a337",
    "shine": "ffd46b",
}
PAINT = {"olive": (1, 0.85), "leaf": (1, 1), "peat": (1, 0.64), "buff": (2, 1), "sand": (2, 0.8)}
PELVIS = (0, 360, -18)
TORSO = (0, 422, -23)
HIP = (160, 350, 0)
KNEE = (236, 213, -150)
ANKLE = (259, 70, 27)
SOCKETS = (("rig_mount_left-silo", (303, 656, 13)), ("rig_mount_right-silo", (-303, 656, 13)))
SLOTS = (2, 2, 2)


def shell(segment, edge):
    return "peat" if edge in (0, 1, 7) else "olive"


def body(m):
    m.section = "rig_torso"
    m.cylinder((0, 402, -23), (0, 461, -23), 94, "joint", 12)
    m.cylinder((0, 415, -23), (0, 438, -23), 111, "rack", 12)
    # Broad cockpit bridge descends between the pods. The long nose and short
    # visor stay below the cartridge mouths even with both silos fitted.
    m.hull_z(
        [
            (-202, 0, 454, 567, 220, 30, 20),
            (-155, 0, 432, 599, 300, 40, 29),
            (-56, 0, 424, 613, 340, 48, 31),
            (47, 0, 420, 604, 303, 47, 28),
            (135, 0, 427, 568, 230, 31, 25),
            (207, 0, 440, 507, 153, 22, 18),
            (224, 0, 453, 490, 112, 15, 10),
        ],
        lambda i, j: "leaf" if j in (3, 4, 5) and i >= 2 else shell(i, j),
        ("peat", "olive"),
    )
    m.hull_z([(125, 0, 419, 454, 118, 14, 8), (177, 0, 420, 450, 126, 14, 8), (202, 0, 427, 445, 103, 12, 6)], "buff")
    m.hull_z(
        [
            (-96, 0, 585, 622, 95, 13, 8),
            (-31, 0, 587, 639, 125, 17, 11),
            (40, 0, 578, 635, 140, 16, 12),
            (98, 0, 562, 605, 123, 15, 9),
            (116, 0, 559, 596, 113, 13, 8),
        ],
        "joint",
    )
    # The glazing slopes ahead of the brow: it can be read from the higher
    # Practice camera as well as head-on. The sill seats above the bridge.
    m.hull_z(
        [
            (84, 0, 566, 604, 112, 13, 7),
            (108, 0, 559, 602, 124, 14, 8),
            (121, 0, 555, 592, 121, 14, 8),
            (149, 0, 553, 572, 99, 11, 6),
        ],
        "joint",
    )

    def windscreen(x, z, rise):
        return (x, 592 - 20 * (z - 121) / 28 + rise, z)

    m.patch([windscreen(x, z, 1) for x, z in [(-46, 122), (46, 122), (36, 144), (-38, 144)]], "glass")
    m.patch([windscreen(x, z, 1.4) for x, z in [(-41, 124), (-10, 124), (-13, 130), (-38, 130)]], "shine")
    m.hull_z(
        [
            (-79, 0, 605, 626, 91, 12, 5),
            (-24, 0, 620, 651, 123, 17, 7),
            (47, 0, 618, 649, 148, 21, 8),
            (106, 0, 591, 613, 144, 17, 6),
            (119, 0, 593, 607, 133, 14, 4),
        ],
        "buff",
    )
    for s in (-1, 1):
        m.hull_z(
            [
                (-44, s * 131, 443, 555, 82, 12, 16),
                (47, s * 139, 439, 565, 80, 11, 15),
                (112, s * 132, 444, 530, 65, 9, 13),
                (142, s * 127, 452, 514, 57, 8, 10),
            ],
            "olive",
            ("peat", "peat"),
        )
        m.hull_z([(140, s * 127, 458, 503, 46, 4, 5), (145, s * 127, 459, 502, 44, 4, 5)], "rack", ("rack", "shadow"))
        for y in (470, 484, 497):
            m.hull_z([(144, s * 127, y - 4, y + 2, 33, 3, 1), (149, s * 127, y - 2, y + 2, 31, 3, 1)], "rack")
        saddle(m, s)
    # A recessed transverse radiator under the rear of the bridge.
    m.hull_z([(-190, 0, 461, 566, 193, 18, 15), (-216, 0, 469, 556, 183, 19, 13)], "rack", ("joint", "shadow"))
    for y in (483, 505, 527):
        m.hull_z([(-215, 0, y, y + 11, 157, 10, 3), (-224, 0, y + 3, y + 10, 148, 10, 2)], "peat")
    m.section = "rig_pelvis"
    m.cylinder((0, 360, -20), (0, 421, -23), 81, "joint", 12)
    m.cylinder((-172, 350, 0), (172, 350, 0), 39, "joint", 12)
    m.hull_y(
        [
            (281, 0, 8, 123, 87, 18, 14),
            (305, 0, 9, 164, 112, 23, 17),
            (364, 0, -9, 183, 127, 26, 19),
            (394, 0, -18, 148, 110, 21, 17),
        ],
        "olive",
        ("peat", "peat"),
    )
    for side, s in (("left", 1), ("right", -1)):
        leg(m, side, s)


def saddle(m, s):
    x = s * 303
    # One outboard trunnion and two fore/aft supports. They carry each receiver
    # directly from the bridge without introducing arms or shoulders.
    m.cylinder((s * 117, 509, -26), (s * 267, 509, -26), 54, "joint", 12)
    m.cylinder((s * 170, 509, -26), (s * 206, 509, -26), 59, "rack", 12)
    for z in (-103, 34):
        m.beam((s * 228, 510, z + 12), (x, 614, z - 16), 66, 76, "joint")
    m.hull_z(
        [
            (-182, x, 566, 632, 143, 23, 14),
            (-105, x, 549, 644, 186, 27, 17),
            (30, x, 567, 638, 178, 26, 16),
            (76, x, 586, 622, 140, 21, 9),
        ],
        "rack",
    )
    # Fixed aft half and the shut feed door give the empty saddle a solid back.
    m.hull_z(
        [
            (-234, x, 615, 732, 164, 24, 20),
            (-206, x, 584, 762, 214, 29, 24),
            (-129, x, 574, 775, 231, 33, 29),
            (-51, x, 575, 777, 233, 34, 30),
            (16, x, 582, 770, 226, 33, 28),
        ],
        shell,
        ("peat", "rack"),
    )
    m.hull_z([(14, x, 603, 745, 186, 25, 21), (23, x, 610, 737, 173, 23, 20)], "joint", ("rack", "shadow"))
    m.hull_z([(23, x, 638, 707, 106, 14, 11), (27, x, 643, 702, 94, 13, 10)], "rack")
    m.hull_z(
        [
            (-163, x, 761, 779, 105, 16, 4),
            (-130, x, 768, 791, 127, 17, 6),
            (-63, x, 768, 792, 124, 17, 6),
            (-48, x, 768, 780, 101, 14, 4),
        ],
        "rack",
    )
    # Rear-facing louver cassette and two raised side plates protect the casing.
    m.hull_z([(-231, x, 627, 724, 154, 17, 16), (-239, x, 634, 719, 143, 16, 13)], "rack", ("rack", "shadow"))
    for y in (650, 672, 694):
        m.hull_z([(-238, x, y - 3, y + 9, 117, 8, 3), (-243, x, y, y + 7, 109, 8, 2)], "peat")
    panel_x = x + s * 116
    m.hull_z(
        [
            (-176, panel_x - s * 15, 613, 700, 15, 3, 8),
            (-130, panel_x, 608, 706, 10, 2, 8),
            (-74, panel_x, 609, 705, 10, 2, 8),
        ],
        "rack",
        ("rack", "rack"),
    )
    for y in (633, 654, 675):
        m.beam((panel_x + s * 4, y, -132), (panel_x + s * 4, y, -78), 9, 8, "peat")


def leg(m, side, s):
    hx, hy, hz = HIP
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    m.section = f"rig_leg_{side}_thigh"
    m.cylinder((s * (hx - 33), hy, hz), (s * (hx + 43), hy, hz), 46, "joint", 12)
    # A rigid dogleg bends forward inside the rotator guard, then sweeps back
    # to the hock. Only the hock and ankle below it articulate.
    m.beam((s * hx, hy, hz), (s * 196, 303, 73), 64, 78, "rack")
    m.beam((s * 195, 301, 76), (s * kx, ky, kz), 61, 66, "joint")
    m.cylinder((s * 168, 306, 60), (s * 217, 306, 60), 37, "rack", 10)
    m.hull_z(
        [
            (-63, s * 166, 341, 395, 72, 11, 11),
            (-32, s * 174, 322, 418, 93, 16, 15),
            (13, s * 185, 304, 419, 108, 17, 14),
            (76, s * 196, 279, 389, 105, 14, 18),
            (120, s * 199, 278, 349, 92, 13, 12),
            (132, s * 198, 285, 328, 76, 10, 10),
        ],
        shell,
        ("peat", "olive"),
    )
    m.section = f"rig_leg_{side}_shin"
    m.cylinder((s * (kx - 37), ky, kz), (s * (kx + 43), ky, kz), 40, "joint", 12)
    m.cylinder((s * (kx + 39), ky, kz), (s * (kx + 48), ky, kz), 30, "rack", 12)
    m.beam((s * kx, ky, kz), (s * ax, ay, az), 50, 55, "joint")
    m.cylinder((s * (kx - 19), 207, kz + 9), (s * (ax - 19), 82, az + 22), 13, "silver", 10)
    m.hull_z(
        [
            (-147, s * 236, 185, 214, 53, 8, 7),
            (-115, s * 242, 151, 210, 82, 11, 11),
            (-64, s * 246, 112, 181, 96, 15, 14),
            (1, s * 257, 82, 144, 81, 13, 12),
            (32, s * 258, 80, 115, 67, 10, 8),
        ],
        shell,
        ("peat", "olive"),
    )
    m.section = f"rig_leg_{side}_foot"
    m.cylinder((s * (ax - 37), ay, az), (s * (ax + 41), ay, az), 34, "joint", 12)
    m.cylinder((s * (ax + 37), ay, az), (s * (ax + 44), ay, az), 26, "rack", 12)
    m.hull_z(
        [
            (-84, s * ax, 0, 28, 125, 15, 8),
            (-60, s * ax, 0, 51, 140, 18, 10),
            (3, s * ax, 0, 62, 134, 18, 13),
            (73, s * ax, 0, 39, 124, 15, 9),
            (103, s * ax, 0, 24, 122, 13, 6),
        ],
        "joint",
    )
    for toe in (-1, 0, 1):
        x = s * ax + toe * 47
        m.hull_z(
            [
                (32, x, 0, 42, 37, 5, 7),
                (62, x, 0, 54, 45, 7, 9),
                (111, x + toe * 3, 0, 36, 46, 7, 7),
                (135 + (toe == 0) * 8, x + toe * 3, 0, 18, 43, 6, 4),
            ],
            "rack",
            ("joint", "rack"),
        )
    m.hull_z(
        [
            (-4, s * ax, 61, 89, 71, 10, 6),
            (19, s * ax, 69, 107, 88, 12, 8),
            (64, s * ax, 57, 90, 92, 13, 7),
            (77, s * ax, 46, 69, 85, 10, 6),
        ],
        "buff",
    )


def cells(m, x, front, row, width, height, cols, rows):
    """Cut open wells through a recessed matrix whose perimeter follows the nose."""
    cy = (row[2] + row[3]) / 2
    w, h = width, height

    def rectangular_tile(cx, cy, w, h):
        left, right = cx - w / 2, cx + w / 2
        bottom, top = cy - h / 2, cy + h / 2
        return [
            (left + w * 0.16, bottom),
            (right - w * 0.16, bottom),
            (right, bottom),
            (right, top),
            (right - w * 0.16, top),
            (left + w * 0.16, top),
            (left, top),
            (left, bottom),
        ]

    rim = ring_z(row)
    seat = clipped_rect(x, cy, w + 20, h + 20, 14, 13)
    grid = rectangular_tile(x, cy, w, h)
    for j in range(8):
        k = (j + 1) % 8
        m.face([rim[j], rim[k], (*seat[k], front + 2), (*seat[j], front + 2)], (0, 0, 1), "buff")
        m.face(
            [(*seat[j], front + 2), (*seat[k], front + 2), (*grid[k], front - 6), (*grid[j], front - 6)],
            (0, 0, 1),
            "sand",
        )
    exits = []
    step_x, step_y = w / cols, h / rows
    for r in range(rows):
        for c in range(cols):
            u = x + (c - (cols - 1) / 2) * step_x
            v = cy + (r - (rows - 1) / 2) * step_y
            tile = rectangular_tile(u, v, step_x, step_y)
            dw, dh = step_x * 0.85, step_y * 0.87
            mouth = clipped_rect(u, v, dw, dh, dw * 0.20, dh * 0.21)
            deep = clipped_rect(u, v, dw * 0.80, dh * 0.80, dw * 0.17, dh * 0.18)
            floor = [(*pt, front - 36) for pt in deep]
            for j in range(8):
                k = (j + 1) % 8
                m.face(
                    [(*tile[j], front - 6), (*tile[k], front - 6), (*mouth[k], front - 6), (*mouth[j], front - 6)],
                    (0, 0, 1),
                    "rack",
                )
                wall = [(*mouth[j], front - 6), (*mouth[k], front - 6), floor[k], floor[j]]
                m.face(wall, minus((u, v, front - 23), average(wall)), "joint")
            m.face(floor, (0, 0, 1), "bore")
            exits.append((u, v, front - 6))
    return (x, cy, front - 6), tuple(exits)


def cartridge(m, variant, slot):
    x = SOCKETS[slot][1][0]
    # Each cassette seats around the same heel; the two ready-service ridges
    # make its direction legible in top view and continue onto the fixed shell.
    cy = 676
    width, height, front, cols, rows = {
        "a": (236, 195, 202, 2, 2),
        "b": (306, 166, 175, 3, 2),
        "c": (148, 176, 259, 1, 2),
    }[variant]
    nose = [
        (8, x, 586, 764, 215, 28, 24),
        (27, x, 577, 776, 232, 32, 29),
        (75, x, cy - height / 2, cy + height / 2, width, 30, 26),
        (front - 40, x, cy - height / 2, cy + height / 2, width, 30, 26),
        (front - 22, x, cy - height / 2 + 2, cy + height / 2 - 2, width, 30, 26),
        (front, x, cy - height / 2 + 10, cy + height / 2 - 10, width - 13, 27, 22),
    ]
    m.hull_z(nose, lambda i, j: "buff" if i >= 3 else shell(i, j), ("rack", None))
    for s in (-1, 1):
        y = cy + height / 2
        xx = x + s * width * 0.23
        m.hull_z(
            [
                (61, xx, y - 5, y + 3, 31, 5, 2),
                (85, xx, y - 2, y + 13, 36, 5, 4),
                (front - 53, xx, y - 1, y + 13, 36, 5, 4),
                (front - 40, xx, y - 3, y + 5, 29, 5, 2),
            ],
            "olive",
        )
    return cells(m, x, front, nose[-1], width - 68, height - 65, cols, rows)
