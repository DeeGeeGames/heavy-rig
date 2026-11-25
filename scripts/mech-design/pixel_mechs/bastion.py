"""Bastion. A split mantlet wraps two recessed cartridges above a short walking frame."""

from .geometry import average, minus, ring_z
from .kestrel import barrel_ring, tube

PALETTE = {
    "tide": "66958b", "deep": "3c6869", "foam": "ddd4b7", "bronze": "b29159",
    "silver": "99aca8", "glass": "edaa52", "shine": "ffdb86", "lens": "54c8c0",
}
PAINT = {"tide": (1, 1), "deep": (1, .70), "foam": (2, 1)}
PELVIS = (0, 382, -33)
TORSO = (0, 493, -23)
HIP = (184, 392, -30)
KNEE = (229, 242, 63)
ANKLE = (246, 77, -30)
SOCKETS = (("rig_mount_left-battery", (274, 671, -48)), ("rig_mount_right-battery", (-274, 671, -48)))
SLOTS = (2, 2, 2)


def shield(m, s):
    # The bridge runs above the gun. A lower shelf and an outboard hinge cheek
    # complete the opening without painting a dark rectangle over a solid face.
    rows = [
        (-219, s * 266, 690, 791, 176, 26, 21),
        (-129, s * 289, 699, 868, 236, 35, 29),
        (-39, s * 280, 733, 879, 262, 40, 29),
        (78, s * 271, 735, 850, 263, 47, 24),
        (173, s * 238, 727, 799, 246, 42, 20),
        (223, s * 212, 716, 760, 188, 40, 15),
    ]
    slopes = (.06, .08, .11, .19, .29, .35)
    rings = [[(x, y + s * (x - row[1]) * slope, z) for x, y, z in ring_z(row)]
             for row, slope in zip(rows, slopes)]
    m.join(rings, lambda i, j: "deep" if j in (0, 1, 7) else "foam" if s > 0 and i > 0 else "tide",
           ("deep", "foam" if s > 0 else "tide"))
    m.hull_z([
        (-149, s * 364, 624, 772, 63, 10, 19),
        (-62, s * 385, 606, 792, 63, 10, 22),
        (39, s * 382, 615, 769, 68, 12, 17),
        (123, s * 369, 649, 754, 52, 9, 15),
        (167, s * 354, 689, 743, 40, 8, 10),
    ], lambda i, j: "deep" if i == 0 or j == 0 else "tide", ("deep", "tide"))
    m.hull_z([
        (-93, s * 248, 573, 629, 185, 29, 12),
        (7, s * 265, 574, 627, 217, 31, 13),
        (128, s * 267, 602, 629, 201, 27, 7),
        (187, s * 253, 612, 635, 158, 22, 6),
    ], "deep")
    # Cast hinge pins sit behind the removable breeches.
    m.cylinder((s * 148, 671, -65), (s * 381, 671, -65), 52, "joint", 10)
    m.cylinder((s * 376, 671, -65), (s * 427, 671, -65), 52, "deep", 10)
    m.cylinder((s * 426, 671, -65), (s * 431, 671, -65), 30, "bronze", 10)


def torso(m):
    m.section = "rig_torso"
    m.cylinder((0, 472, -23), (0, 555, -23), 103, "joint", 12)
    m.cylinder((0, 520, -23), (0, 571, -23), 136, "cast", 12)
    # The front narrows into a dropped central armor tooth between the ports.
    m.hull_z([
        (-254, 0, 593, 748, 323, 43, 28), (-181, 0, 545, 806, 450, 55, 38),
        (-47, 0, 514, 824, 468, 65, 46), (79, 0, 529, 807, 388, 64, 45),
        (173, 0, 551, 769, 267, 50, 38), (242, 0, 568, 719, 187, 35, 30),
        (253, 0, 597, 692, 113, 24, 19),
    ], lambda i, j: "joint" if i < 2 and j in (0, 1, 7) else "deep" if j in (0, 1, 7) else "tide",
        ("deep", "deep"))
    for s in (1, -1):
        shield(m, s)
        # Paired power heads have sealed forward faces and a recessed vertical
        # grille aft. The hoods visibly rise behind the sloping armor brows.
        m.hull_z([(-260, s * 128, 772, 900, 119, 20, 23), (-230, s * 128, 756, 940, 149, 25, 31),
                  (-130, s * 125, 778, 941, 148, 24, 31), (-79, s * 115, 800, 893, 123, 22, 18)],
                 lambda i, j: "joint" if j in (0, 1, 7) else "cast", ("shadow", "joint"))
        for h in (817, 856):
            m.hull_z([(-259, s * 128, h, h + 17, 86, 10, 4),
                      (-265, s * 128, h + 3, h + 15, 78, 9, 3)], "cast")
    # One continuous proud rib drops from the pilot recess between the ports.
    # Its forward face is vertical while the shoulder armor slopes away.
    m.hull_z([(91, 0, 627, 814, 125, 25, 27), (157, 0, 590, 800, 131, 28, 33),
              (242, 0, 558, 740, 118, 25, 25), (285, 0, 570, 699, 95, 19, 19),
              (296, 0, 588, 683, 77, 15, 15)],
             lambda i, j: "deep" if j in (0, 1, 7) else "tide", ("deep", "deep"))
    # A short amber pilot slot sits under a plate brow with an overhanging lip.
    m.hull_z([
        (-137, -26, 791, 848, 157, 24, 13), (-70, -26, 813, 918, 184, 28, 21),
        (63, -26, 803, 909, 171, 26, 19), (104, -26, 793, 843, 148, 22, 14),
        (128, -26, 778, 824, 116, 16, 9),
    ], lambda i, j: "joint" if j in (0, 1, 7) else "cast", ("joint", "joint"))
    def screen(x, z, lift):
        return (x - 26, 909 - 66 * (z - 63) / 41 + lift, z)
    for outline, color, lift in [
        ([(-61, 72), (61, 72), (58, 94), (48, 99), (-51, 99), (-59, 94)], "joint", 1.3),
        ([(-53, 75), (53, 75), (50, 91), (43, 95), (-46, 95), (-52, 91)], "glass", 2.6),
        ([(-44, 77), (19, 77), (14, 81), (-45, 81)], "shine", 3.6),
    ]:
        m.patch([screen(x, z, lift) for x, z in outline], color)
    # The exposed rear machine face interrupts the paint only on the service side.
    m.hull_z([
        (-190, 0, 623, 779, 302, 35, 19), (-256, 0, 619, 762, 299, 31, 25),
        (-275, 0, 626, 747, 266, 28, 18),
    ], "cast", ("joint", "shadow"))
    for y in (657, 700):
        m.hull_z([(-272, 0, y, y + 20, 218, 13, 5), (-282, 0, y + 5, y + 16, 206, 12, 3)], "deep")


def leg(m, side, s):
    prefix = f"rig_leg_{side}_"
    hx, hy, hz = HIP
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    m.section = prefix + "thigh"
    m.cylinder((s * (hx - 56), hy, hz), (s * (hx + 53), hy, hz), 59, "joint", 10)
    m.beam((s * hx, hy, hz), (s * kx, ky, kz), 87, 73, "cast")
    m.hull_y([
        (252, s * (kx + 7), 65, 115, 99, 18, 15),
        (301, s * 226, 51, 159, 150, 23, 21),
        (362, s * 218, 10, 154, 175, 25, 28),
        (412, s * 201, -28, 118, 134, 17, 24),
    ], lambda i, j: "deep" if j in (0, 1, 7) else "tide", ("deep", "tide"))
    m.section = prefix + "shin"
    m.cylinder((s * (kx - 58), ky, kz), (s * (kx + 71), ky, kz), 59, "joint", 10)
    m.cylinder((s * (kx + 68), ky, kz), (s * (kx + 78), ky, kz), 39, "bronze", 10)
    m.beam((s * kx, ky, kz), (s * ax, ay, az), 80, 57, "cast")
    m.cylinder((s * (ax - 32), ay + 16, az - 5), (s * (kx - 32), ky - 12, kz - 61), 17, "silver")
    m.hull_y([
        (71, s * ax, az + 16, 107, 107, 18, 18), (122, s * (ax + 2), 2, 158, 126, 26, 21),
        (194, s * (kx + 8), 57, 147, 112, 25, 21), (234, s * (kx + 2), 77, 114, 83, 20, 16),
    ], lambda i, j: "foam" if s > 0 and j == 4 else "deep" if j == 0 else "tide", ("deep", "deep"))
    m.section = prefix + "foot"
    m.cylinder((s * (ax - 50), ay, az), (s * (ax + 52), ay, az), 42, "cast")
    m.hull_z([
        (-140, s * (ax + 8), 0, 35, 118, 16, 7), (-104, s * (ax + 6), 0, 67, 149, 20, 12),
        (-29, s * ax, 0, 67, 159, 23, 12), (51, s * ax, 0, 56, 173, 25, 9),
        (136, s * (ax + 2), 0, 30, 172, 24, 7), (160, s * (ax + 2), 0, 17, 146, 18, 4),
    ], lambda i, j: "joint" if j in (0, 1, 7) else "deep" if i < 2 else "tide", ("joint", "deep"))
    # A single central tread lug steps down towards the toe.
    m.hull_z([(-28, s * ax, 45, 94, 113, 18, 9), (21, s * ax, 44, 98, 139, 22, 11),
              (106, s * ax, 27, 67, 146, 21, 8), (144, s * ax, 20, 38, 130, 17, 5)],
             lambda i, j: "foam" if i > 0 and j in (2, 3, 4, 5, 6) else "cast", ("cast", "deep"))


def body(m):
    torso(m)
    m.section = "rig_pelvis"
    m.hull_y([
        (327, 0, -34, 232, 145, 28, 22), (362, 0, -30, 347, 191, 46, 34),
        (406, 0, -37, 379, 213, 46, 37), (448, 0, -31, 327, 195, 45, 34),
        (463, 0, -26, 228, 164, 31, 24),
    ], lambda i, j: "deep" if i == 0 or j in (0, 1, 7) else "tide", ("cast", "deep"))
    m.cylinder((0, 439, -23), (0, 508, -23), 100, "cast", 12)
    for side, s in (("left", 1), ("right", -1)):
        leg(m, side, s)


def cartridge(m, variant, slot):
    _, (x, y, rear) = SOCKETS[slot]
    m.hull_z([
        (rear - 42, x, y - 29, y + 30, 85, 12, 11), (rear + 8, x, y - 40, y + 42, 135, 18, 14),
        (44, x, y - 41, y + 45, 148, 21, 12), (117, x, y - 36, y + 38, 136, 18, 12),
    ], lambda i, j: "cast" if j in (3, 4, 5) else "joint", ("joint", "cast"))
    if variant == "b" and slot == 0:
        # A low oval hood and a solid blue lens identify the defensive emitter.
        rows = [(91, 49, 33), (172, 55, 40), (223, 64, 38), (241, 57, 32), (241, 40, 20), (223, 38, 18)]
        rings = [[(x + (a - x) * w, y + (b - y) * h, z) for a, b, _ in barrel_ring(x, y, z, 1)]
                 for z, w, h in rows]
        m.join(rings[:4], lambda i, j: "foam" if i == 1 else "deep", ("deep", None))
        m.join(rings[3:5], "silver", (None, None))
        for j, outer in enumerate(rings[4]):
            k = (j + 1) % len(rings[4])
            wall = [outer, rings[4][k], rings[5][k], rings[5][j]]
            m.face(wall, minus((x, y, 232), average(wall)), "joint")
        m.face(rings[-1], (0, 0, 1), "lens")
        return (x, y, 241), ()
    if variant != "a" and slot == 1:
        guided = variant == "c"
        lip = 252 if guided else 226
        radius = 32 if guided else 21
        back = lip - 1.45 * radius - 5
        m.hull_z([(106, x, y - 36, y + 38, 134, 16, 11),
                  (153, x, y - 51, y + 53, 166, 21, 13),
                  (back, x, y - 48, y + 49, 151, 16, 13)],
                 lambda i, j: "foam" if guided and j in (3, 4, 5) else "deep", ("cast", "joint"))
        centers = [(x - 36, y), (x + 36, y)] if guided else [(x + dx, y + dy) for dy in (22, -22) for dx in (-33, 33)]
        for bx, by in centers:
            tube(m, bx, by, back - 3, lip, radius)
        exits = tuple((bx, by, lip) for bx, by in centers)
        return average(exits), exits
    # The sustained pair ends just beyond the mantlet. Sentinel has a longer
    # single precision tube, with a pale sleeve visible in overhead projection.
    precision = variant == "c"
    m.cylinder((x, y, 101), (x, y, 170), 48, "deep" if precision else "cast", 10)
    m.cylinder((x, y, 153), (x, y, 211 if precision else 197), 39, "foam" if precision else "deep", 10)
    lip = 339 if precision else 258
    tube(m, x, y, 191 if precision else 185, lip, 24 if precision else 30)
    if not precision:
        m.cylinder((x, y, 193), (x, y, 208), 34, "bronze", 10)
    return (x, y, lip), ()
