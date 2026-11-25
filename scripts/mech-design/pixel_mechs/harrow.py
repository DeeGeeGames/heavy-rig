"""Harrow. A low walking recoil bed with an off-centre cab and interchangeable dorsal tools."""

import math

from .geometry import average, cross, minus, plus, times, unit
from .kestrel import tube

PALETTE = {
    "ochre": "d4a258", "clay": "9e704c", "chalk": "ddd0aa", "iron": "51616a",
    "silver": "a7b0ab", "glass": "44b3ad", "shine": "9cddd0",
}
PAINT = {"ochre": (1, 1), "clay": (1, .70), "chalk": (2, 1)}
PELVIS = (0, 350, -28)
TORSO = (0, 442, -33)
HIP = (149, 355, -27)
KNEE = (258, 218, -130)
ANKLE = (255, 74, 11)
SOCKETS = (("rig_mount_dorsal-artillery", (0, 650, -72)), ("rig_mount_right-backup", (-277, 553, -43)))
SLOTS = (2, 2, 2)


def cradle(m):
    # Two pierced plates flank the common trunnion. All of this hardware stays
    # with the deck, including the diagonal return links and the rear catch.
    for s in (1, -1):
        x = s * 113
        m.hull_z([
            (-254, x, 501, 566, 51, 10, 13), (-183, x, 484, 606, 71, 13, 22),
            (-88, x, 512, 678, 67, 12, 23), (-51, x, 539, 685, 59, 11, 22),
            (8, x, 559, 619, 49, 10, 14), (51, x, 548, 581, 44, 9, 9),
        ], lambda i, j: "clay" if j in (0, 1, 7) else "ochre", ("clay", "clay"))
        m.cylinder((s * 61, 650, -72), (s * 151, 650, -72), 46, "joint", 10)
        m.cylinder((s * 149, 650, -72), (s * 158, 650, -72), 31, "silver", 10)
        # Tall fork cheeks continue above the pilot deck, making the carriage
        # visible head-on as well as from the side of the elevated barrel.
        m.hull_z([(-153, x, 591, 671, 50, 10, 15), (-99, x, 605, 739, 57, 11, 20),
                  (-42, x, 651, 765, 58, 12, 21), (2, x, 673, 750, 53, 12, 16),
                  (28, x, 663, 712, 44, 9, 12)], "ochre", ("clay", "clay"))
        m.cylinder((s * 75, 702, -55), (s * 146, 702, -55), 31, "iron", 10)
        m.cylinder((s * 143, 702, -55), (s * 152, 702, -55), 21, "silver", 10)
        m.beam((s * 161, 509, -204), (s * 156, 577, -140), 34, 36, "iron")
        m.cylinder((s * 158, 565, -153), (s * 151, 631, -88), 12, "silver")
    m.hull_z([(-299, 0, 494, 565, 209, 28, 15), (-273, 0, 472, 584, 292, 40, 19),
              (-233, 0, 490, 582, 271, 37, 17), (-184, 0, 502, 545, 195, 28, 11)],
             "iron", ("joint", "iron"))


def cab(m):
    m.hull_z([
        (-136, 188, 527, 597, 123, 23, 15), (-71, 211, 523, 661, 159, 31, 25),
        (10, 217, 526, 707, 162, 28, 29), (77, 210, 521, 697, 157, 28, 27),
        (159, 190, 510, 623, 151, 26, 19), (204, 179, 525, 568, 107, 22, 13),
    ], lambda i, j: "iron" if j in (0, 1, 7) else "clay" if j in (2, 6) else "ochre", ("clay", "clay"))
    # One sloped glazed face, offset all the way beside the mortar barrel.
    def window(x, z, lift):
        return (x, 697 - (z - 77) * 74 / 82 + lift, z)
    for outline, color, dy in (
        ([(162, 88), (250, 88), (238, 144), (217, 156), (151, 150)], "joint", 1.5),
        ([(169, 94), (241, 94), (231, 137), (215, 146), (159, 141)], "glass", 2.8),
        ([(174, 98), (226, 98), (218, 107), (171, 113)], "shine", 4),
    ):
        m.patch([window(x, z, dy) for x, z in outline], color)
    # A broad flange binds the cab to the transverse crosshead behind the visor.
    m.hull_z([(-108, 221, 595, 617, 118, 17, 5), (-66, 225, 613, 667, 145, 21, 12),
              (-35, 224, 619, 684, 147, 22, 13)], "clay")


def torso(m):
    m.section = "rig_torso"
    m.cylinder((0, 432, -33), (0, 502, -33), 111, "cast", 12)
    # Wide but shallow cross-bridge. The cast front apron rises on one side to
    # the cab and drops on the other for a much smaller close-defence gun.
    m.hull_z([
        (-247, 0, 480, 551, 312, 47, 17), (-186, 0, 469, 598, 431, 66, 30),
        (-63, 11, 456, 592, 523, 83, 35), (29, 15, 455, 580, 521, 74, 31),
        (94, 8, 467, 553, 434, 65, 22), (138, 7, 486, 532, 295, 43, 12),
    ], lambda i, j: "iron" if j in (0, 1, 7) else "clay" if j in (2, 6) else "ochre", ("iron", "clay"))
    cradle(m)
    cab(m)
    # A shallow service hatch overhangs the leading crossbeam. Its pale
    # lower casting marks the chassis centre below the high dorsal opening.
    m.hull_z([(17, -9, 494, 579, 196, 25, 19), (96, -8, 486, 569, 240, 34, 17),
              (141, -7, 482, 548, 214, 32, 15), (158, -6, 493, 527, 178, 22, 9)],
             lambda i, j: "clay" if j in (0, 1, 7) else "ochre", ("clay", "clay"))
    m.hull_z([(149, -6, 482, 532, 125, 17, 10), (165, -6, 478, 531, 142, 20, 10),
              (173, -6, 485, 521, 127, 16, 8)], "chalk")
    # Rear bank sits crosswise and reads as a single engine with two louvers.
    m.hull_z([(-203, 6, 554, 619, 287, 34, 16), (-187, 6, 546, 634, 351, 36, 18),
              (-143, 6, 552, 653, 348, 41, 23), (-101, 6, 555, 618, 302, 38, 16)],
             lambda i, j: "clay" if j in (3, 4, 5) else "iron", ("joint", "iron"))
    for y in (576, 600):
        m.hull_z([(-201, 6, y, y + 12, 245, 17, 3), (-209, 6, y + 2, y + 11, 222, 15, 2)], "iron")
    m.cylinder((-187, 553, -43), (-290, 553, -43), 36, "cast")
    m.hull_z([(-107, -229, 551, 598, 84, 12, 11), (-64, -252, 553, 629, 100, 18, 15),
              (10, -247, 573, 620, 100, 18, 10), (65, -229, 567, 592, 78, 14, 6)],
             "clay")


def leg(m, side, s):
    prefix = f"rig_leg_{side}_"
    hx, hy, hz = HIP
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    m.section = prefix + "thigh"
    m.cylinder((s * (hx - 33), hy, hz), (s * (hx + 75), hy, hz), 57, "joint", 10)
    m.hull_y([
        (215, s * 258, -129, 91, 86, 18, 16), (259, s * 242, -107, 118, 132, 24, 24),
        (328, s * 193, -50, 128, 142, 24, 25), (375, s * 169, -15, 112, 104, 21, 20),
    ], lambda i, j: "clay" if j in (0, 1, 7) else "ochre", ("clay", "ochre"))
    m.cylinder((s * (hx - 4), hy - 12, hz + 34), (s * (kx - 16), ky + 11, kz + 22), 19, "silver")
    m.section = prefix + "shin"
    m.cylinder((s * (kx - 58), ky, kz), (s * (kx + 59), ky, kz), 53, "joint", 10)
    m.cylinder((s * (kx + 56), ky, kz), (s * (kx + 69), ky, kz), 36, "ochre", 10)
    # A forked lower link leaves a daylight triangle for the polished rod.
    m.beam((s * (kx + 23), ky - 5, kz), (s * (ax + 22), ay + 6, az + 10), 55, 42, "iron")
    m.hull_z([(-126, s * (kx + 22), 188, 224, 70, 13, 8), (-80, s * (kx + 21), 153, 205, 79, 14, 10),
              (-22, s * (ax + 21), 104, 155, 68, 11, 10), (17, s * (ax + 22), 71, 116, 58, 10, 9)],
             lambda i, j: "chalk" if j in (3, 4, 5) else "clay", ("clay", "clay"))
    m.beam((s * (kx - 25), ky - 5, kz + 10), (s * (kx - 28), ky - 16, kz + 77), 40, 31, "clay")
    m.cylinder((s * (kx - 25), ky - 17, kz + 67), (s * (ax - 29), ay + 14, az + 11), 17, "silver")
    m.section = prefix + "foot"
    m.cylinder((s * (ax - 51), ay, az), (s * (ax + 53), ay, az), 40, "cast")
    # Wide heel spade, forward shoe and a low tread; their common sole is y=0.
    m.hull_z([(-181, s * (ax + 17), 0, 16, 76, 13, 4), (-149, s * (ax + 13), 21, 68, 85, 16, 11),
              (-110, s * (ax + 10), 46, 91, 89, 15, 10), (-69, s * (ax + 5), 38, 89, 93, 17, 11),
              (-20, s * ax, 17, 66, 105, 18, 11)], "ochre", ("clay", "clay"))
    m.hull_z([(-42, s * ax, 0, 47, 110, 18, 9), (-8, s * ax, 0, 68, 123, 18, 12),
              (47, s * ax, 0, 64, 134, 19, 12), (93, s * ax, 0, 40, 142, 21, 8)],
             lambda i, j: "joint" if j in (0, 1, 7) else "iron", ("cast", "iron"))
    for t in (-1, 1):
        tx = s * ax + t * 36
        m.hull_z([(58, tx, 6, 47, 62, 11, 9), (92, tx + t * 2, 0, 49, 68, 12, 11),
                  (145, tx + t * 4, 0, 35, 66, 12, 8), (167, tx + t * 6, 0, 19, 59, 10, 5)],
                 lambda i, j: "clay" if j in (0, 1, 7) else "chalk", ("cast", "chalk"))
    m.hull_z([(-51, s * (ax + 4), 29, 62, 83, 15, 7), (-19, s * ax, 32, 98, 95, 16, 13),
              (31, s * ax, 36, 99, 109, 18, 14), (79, s * ax, 32, 66, 83, 14, 9)], "clay")


def body(m):
    torso(m)
    m.section = "rig_pelvis"
    m.hull_y([(295, 0, -30, 181, 142, 29, 22), (332, 0, -39, 307, 198, 46, 31),
              (372, 0, -40, 364, 216, 49, 38), (405, 0, -30, 261, 174, 39, 29)],
             lambda i, j: "clay" if j in (3, 4, 5) else "iron", ("cast", "iron"))
    m.cylinder((0, 394, -33), (0, 455, -33), 105, "joint", 12)
    for side, s in (("left", 1), ("right", -1)):
        leg(m, side, s)


def axis_point(offset, dx=0, dy=0):
    # Every dorsal cartridge sits in the same two-sided recoil bed.
    return (dx, 650 + .8 * offset + .6 * dy, -72 + .6 * offset - .8 * dy)


def artillery_tube(m, start, axis, profile, well, paint):
    # Octagonal flared rim and a visibly inset cup. This follows the launch
    # direction, so the flash point lies at the actual centre of the tilted lip.
    u = unit(cross((0, 1, 0), axis))
    v = cross(axis, u)
    def ring(center, radius):
        return [plus(center, plus(times(u, radius * math.cos(angle)), times(v, radius * math.sin(angle))))
                for angle in (math.radians(22.5 + 45 * i) for i in range(8))]
    shells = [ring(plus(start, times(axis, distance)), radius) for distance, radius in profile]
    m.join(shells, lambda i, j: paint[i], ("iron", None))
    length, radius = profile[-1]
    muzzle = plus(start, times(axis, length))
    rim = ring(muzzle, radius * .68)
    bottom = ring(plus(muzzle, times(axis, -well)), radius * .57)
    for j in range(8):
        k = (j + 1) % 8
        m.face([shells[-1][j], shells[-1][k], rim[k], rim[j]], axis, "silver")
        wall = [rim[j], rim[k], bottom[k], bottom[j]]
        m.face(wall, minus(plus(muzzle, times(axis, -.5 * well)), average(wall)), "joint")
    m.face(bottom, axis, "bore")
    return muzzle


def cartridge(m, variant, slot):
    if slot == 1:
        x, y, rear = SOCKETS[1][1]
        m.hull_z([(rear - 64, x, y - 23, y + 28, 66, 12, 8), (rear - 22, x, y - 42, y + 42, 102, 17, 14),
                  (44, x, y - 42, y + 43, 106, 18, 14), (88, x, y - 34, y + 34, 85, 14, 10)],
                 lambda i, j: "ochre" if j in (3, 4, 5) else "iron", ("clay", "joint"))
        m.cylinder((x, y, 78), (x, y, 124), 36, "chalk")
        for dx, dy in ((0, 16), (-15, -9), (15, -9)):
            tube(m, x + dx, y + dy, 121, 204, 13)
        m.cylinder((x, y, 145), (x, y, 163), 32, "iron")
        return (x, y + 16, 204), ()
    axis = (0, .8, .6)
    if variant == "a":
        tip = artillery_tube(m, axis_point(-143), axis,
                            [(0, 55), (53, 74), (128, 85), (196, 83), (294, 75), (337, 77),
                             (358, 90), (418, 98), (439, 93)], 65,
                            ("iron", "clay", "iron", "joint", "iron", "chalk", "chalk", "chalk"))
        return tip, ()
    if variant == "b":
        # Three fanned barrels are one cartridge. Each outside muzzle follows
        # its own slight toe-out rather than a printed row of dark discs.
        m.hull_z([(-165, 0, 559, 642, 112, 22, 18), (-105, 0, 562, 699, 144, 24, 21),
                  (-24, 0, 609, 740, 176, 26, 24), (19, 0, 649, 757, 192, 25, 17)],
                 lambda i, j: "ochre" if j in (3, 4, 5) else "iron", ("iron", "iron"))
        exits = []
        for s in (-1, 0, 1):
            start = axis_point(64, s * 56, 20 if s == 0 else 0)
            tip = artillery_tube(m, start, unit((s * .14, .80 if s == 0 else .76, .60)),
                                [(0, 35), (44, 39), (155, 32), (178, 40), (209, 40)], 30,
                                ("iron", "clay", "ochre", "chalk"))
            exits.append(tip)
        return exits[1], tuple(exits)
    # A deep breech block and long pale jacket make the siege barrel visible
    # along its full length from the high Practice camera.
    m.beam(axis_point(-161), axis_point(79), 131, 156, "iron")
    m.beam(axis_point(-127, 0, 28), axis_point(66, 0, 28), 138, 103, "clay")
    tip = artillery_tube(m, axis_point(46), axis,
                        [(0, 67), (56, 70), (90, 50), (212, 49), (224, 63), (277, 62), (319, 43), (352, 44)],
                        41, ("iron", "ochre", "chalk", "clay", "iron", "clay", "iron"))
    return tip, ()
