"""Specter. A light survey walker with a protected instrument on a separate fitting."""

from .geometry import average
from .kestrel import barrel_ring, tube

PALETTE = {
    "mineral": "d6cebb", "stone": "9c9698", "plum": "855b77", "wine": "513d55",
    "silver": "adb3b3", "glass": "55cabb", "shine": "baeee3",
    "screen": "739b9f", "coating": "9bc7c1", "amber": "eab568",
}
PAINT = {"mineral": (1, 1), "stone": (1, .70), "plum": (2, 1), "wine": (2, .65)}
PELVIS = (0, 432, -8)
TORSO = (0, 515, -9)
HIP = (97, 427, -12)
KNEE = (128, 292, 60)
ANKLE = (146, 55, 17)
SOCKETS = (("rig_mount_left-utility", (160, 590, -33)), ("rig_mount_right-utility", (-160, 590, -33)))
SLOTS = (2, 2, 2)


def body(m):
    m.section = "rig_pelvis"
    m.hull_y([(373, 0, -5, 120, 102, 24, 19), (402, 0, 0, 190, 132, 31, 23),
              (442, 0, -6, 223, 144, 36, 27), (468, 0, -14, 157, 116, 25, 24)],
             lambda i, j: "mineral" if j in (3, 4) else "stone" if j == 5 else "joint", ("stone", "cast"))
    m.cylinder((0, 462, -9), (0, 500, -9), 64, "cast", 10)
    m.cylinder((0, 490, -9), (0, 529, -9), 54, "joint", 10)
    m.section = "rig_torso"
    m.cylinder((0, 504, -9), (0, 564, -9), 69, "cast", 10)
    # A sloping pale chest hangs ahead of a narrow ribbed equipment spine.
    m.hull_z([
        (-155, 12, 580, 706, 104, 22, 21), (-101, 8, 541, 731, 156, 28, 28),
        (-37, 0, 523, 722, 190, 35, 32), (39, -7, 520, 675, 178, 34, 30),
        (99, -14, 533, 631, 139, 29, 20), (143, -19, 547, 594, 98, 21, 12),
    ], lambda i, j: "joint" if j in (0, 1, 7) else "stone" if i < 2 or j in (2, 6) else "mineral",
        ("wine", "mineral"))
    # Cockpit and operator visor sit forward and on the opposite side from
    # the raised observing head. Their two sight lines are vertically separated.
    m.hull_z([
        (-85, -39, 660, 720, 106, 20, 15), (-33, -42, 664, 764, 119, 22, 21),
        (13, -42, 649, 755, 119, 22, 23), (66, -43, 628, 680, 104, 19, 12),
        (89, -41, 624, 651, 81, 15, 7),
    ], lambda i, j: "wine" if j in (0, 1, 7) else "plum", ("wine", "wine"))
    def glazing(x, z, lift):
        return (x - 42, 755 - (z - 13) * 75 / 53 + lift, z)
    for shape, color, height in (
        ([(-38, 36), (39, 36), (36, 53), (-36, 53)], "joint", 1.5),
        ([(-31, 38), (32, 38), (29, 50), (-31, 50)], "glass", 2.8),
        ([(-26, 39), (15, 39), (10, 42), (-26, 43)], "shine", 3.7),
    ):
        m.patch([glazing(x, z, height) for x, z in shape], color)
    for s in (1, -1):
        # Cross pins and dust shields remain when either weapon is removed.
        m.cylinder((s * 73, 604, -36), (s * 156, 592, -32), 33, "cast")
        m.cylinder((s * 110, 606, -41), (s * 155, 599, -38), 42, "stone")
        m.hull_z([(-89, s * 112, 611, 666, 54, 10, 12), (-43, s * 124, 610, 685, 61, 12, 15),
                  (26, s * 112, 619, 672, 54, 10, 12), (61, s * 99, 612, 644, 42, 9, 7)],
                 lambda i, j: "stone" if j in (0, 1, 7) else "mineral")
    # Cranked mast with a transverse service pivot and an open, swept return
    # stay. The receiving equipment has no connection to a weapon socket.
    m.beam((26, 671, -95), (66, 791, -116), 62, 52, "cast")
    m.beam((70, 692, -48), (100, 775, -68), 25, 22, "stone")
    m.cylinder((34, 775, -91), (109, 775, -91), 37, "joint", 10)
    m.cylinder((103, 775, -91), (114, 775, -91), 25, "stone", 10)
    m.hull_z([(-159, 24, 589, 681, 112, 18, 15), (-147, 23, 577, 698, 131, 21, 21),
              (-121, 21, 575, 715, 135, 24, 23)], "wine", ("joint", "wine"))
    for y in (613, 641):
        m.hull_z([(-157, 24, y, y + 12, 79, 10, 3), (-164, 24, y + 3, y + 11, 73, 9, 2)], "cast")
    for side, s in (("left", 1), ("right", -1)):
        leg(m, side, s)


def leg(m, side, s):
    prefix = f"rig_leg_{side}_"
    hx, hy, hz = HIP
    kx, ky, kz = KNEE
    ax, ay, az = ANKLE
    m.section = prefix + "thigh"
    m.cylinder((s * (hx - 29), hy, hz), (s * (hx + 41), hy, hz), 39, "joint", 10)
    m.cylinder((s * (hx + 39), hy, hz), (s * (hx + 46), hy, hz), 25, "stone", 10)
    m.beam((s * (hx - 4), hy, hz), (s * kx, ky, kz), 38, 39, "cast")
    m.cylinder((s * (hx + 17), hy - 15, hz - 11), (s * (kx + 21), ky + 12, kz - 19), 12, "silver")
    m.hull_y([(292, s * kx, kz + 4, 52, 62, 11, 15), (324, s * (kx - 9), 53, 69, 73, 13, 16),
              (390, s * (hx + 5), 5, 62, 65, 13, 15), (415, s * hx, -6, 51, 52, 10, 12)],
             lambda i, j: "mineral" if j in (3, 4, 5) else "stone", ("stone", "stone"))
    m.section = prefix + "shin"
    m.cylinder((s * (kx - 30), ky, kz), (s * (kx + 36), ky, kz), 36, "joint")
    # The shin folds back at a braced idler above a long exposed piston. The
    # hollow triangle behind the purple knee remains visible from either side.
    hx2, hy2, hz2 = ax + 2, 214, -52
    m.beam((s * kx, ky, kz), (s * hx2, hy2, hz2), 40, 32, "mineral")
    m.hull_y([(251, s * (kx + 4), 45, 57, 48, 12, 10), (274, s * (kx + 1), 67, 73, 75, 15, 15),
              (315, s * (kx - 2), 61, 77, 77, 16, 16), (337, s * (kx - 6), 48, 57, 60, 12, 12)],
             lambda i, j: "wine" if j in (0, 1, 7) else "plum", ("wine", "plum"))
    m.beam((s * (kx + 8), ky + 4, kz - 4), (s * (hx2 + 7), hy2 + 23, hz2 + 4), 20, 16, "cast")
    m.cylinder((s * (hx2 - 25), hy2, hz2), (s * (hx2 + 28), hy2, hz2), 33, "stone")
    m.cylinder((s * (hx2 + 26), hy2, hz2), (s * (hx2 + 34), hy2, hz2), 19, "cast")
    m.beam((s * (hx2 - 12), hy2, hz2), (s * (ax - 13), ay + 6, az), 31, 29, "joint")
    m.cylinder((s * (hx2 + 8), hy2 - 16, hz2 + 6), (s * (ax + 11), ay + 17, az + 16), 14, "silver")
    m.hull_y([(58, s * ax, az + 3, 40, 43, 9, 10), (87, s * ax, 15, 56, 49, 13, 12),
              (120, s * ax, -2, 49, 41, 10, 10), (139, s * ax, -10, 34, 32, 8, 7)],
             "mineral", ("stone", "stone"))
    m.section = prefix + "foot"
    m.cylinder((s * (ax - 32), ay, az), (s * (ax + 32), ay, az), 31, "cast")
    m.hull_z([(-42, s * ax, 15, 42, 55, 11, 7), (7, s * ax, 12, 59, 80, 17, 9),
              (48, s * ax, 7, 48, 91, 18, 9)], "joint")
    for t in (-1, 1):
        tx = s * ax + t * 25
        m.hull_z([(21, tx, 7, 38, 36, 7, 7), (54, tx + t * 2, 0, 43, 45, 9, 8),
                  (104, tx + t * 6, 0, 32, 46, 10, 7), (137, tx + t * 10, 0, 14, 37, 8, 4)],
                 lambda i, j: "wine" if j in (0, 1, 7) else "plum" if i == 2 else "mineral", ("stone", "plum"))
    m.hull_z([(-115, s * (ax + 11), 0, 13, 40, 9, 3), (-85, s * (ax + 9), 10, 43, 44, 10, 7),
              (-59, s * (ax + 6), 27, 62, 44, 10, 8), (-18, s * ax, 20, 50, 48, 10, 8)],
             "plum", ("wine", "wine"))


def brace(m, variant):
    # The open handle and the side panel turn down around a closed receiver.
    # None of the three fittings has a bore or a muzzle marker.
    x = 75
    if variant == "b":
        m.hull_y([(780, x, -95, 83, 66, 15, 13), (816, x, -94, 132, 83, 21, 16),
                  (839, x, -91, 126, 71, 19, 14)], "stone")
        for s in (-1, 1):
            # Shallow, solid canted antenna panels with a single broad inset.
            # Their faces look across the field; the narrow edges contain no
            # openings that could be mistaken for upward-pointing guns.
            def panel(u, y, depth):
                return (x + s * u, y, -71 - (u - 14) * .33 - (y - 811) * .39 + depth)
            outline = [(9,815),(92,821),(126,838),(131,893),(117,902),(19,877),(8,866)]
            rear = [panel(u, y, -17) for u, y in outline]
            front = [panel(u, y, 0) for u, y in outline]
            m.join([rear, front], "wine", ("plum", "plum"))
            inset = [(19,827),(91,835),(116,846),(118,889),(26,867),(18,859)]
            m.patch([panel(u, y, 1.3) for u, y in inset], "screen", (s * .33,.39,1))
            stripe = [(28,839),(91,848),(90,853),(28,845)]
            m.patch([panel(u, y, 2) for u, y in stripe], "coating", (s * .33,.39,1))
        m.cylinder((x,817,-90),(x,879,-93),11,"cast")
        return
    guided = variant == "c"
    width = 151 if guided else 211
    m.hull_z([(-152, x - 4, 786, 853, width - 32, 19, 15), (-124, x, 776, 871, width, 23, 19),
              (-62, x + 5, 779, 865, width + 5, 23, 18), (-39, x + 5, 790, 852, width - 9, 17, 13)],
             lambda i, j: "stone" if j in (0, 1, 7) else "mineral", ("stone", "mineral"))
    cx = x + 5
    if guided:
        m.hull_z([(-161, x - 4, 801, 854, 113, 19, 12), (-129, x - 2, 826, 888, 128, 21, 16),
                  (-82, x, 844, 883, 120, 18, 11), (-56, x + 2, 845, 860, 96, 13, 4)],
                 "plum", ("wine","wine"))
        # Individually glazed optics in a single shallow mask with a copper bevel.
        m.hull_z([(-40, cx, 800, 845, 118, 11, 9), (-34, cx, 801, 844, 113, 11, 9)], "cast")
        for ox, radius, color in ((-24, 18, "coating"), (21, 12, "amber")):
            r = barrel_ring(cx + ox, 823, -32, radius)
            m.face(r, (0, 0, 1), color)
    else:
        # A wide closed glass panel, inset in the pale case.
        for w, y0, y1, z, color in ((151,799,846,-37,"joint"),(133,803,842,-35,"screen")):
            m.patch([(cx-w/2+8,y0,z),(cx+w/2-7,y0,z),(cx+w/2,y0+7,z),
                     (cx+w/2,y1,z),(cx-w/2+6,y1,z),(cx-w/2,y1-6,z)], color, (0,0,1))
        m.patch([(cx-54,805,-34),(cx-18,805,-34),(cx+12,839,-34),(cx-19,839,-34)], "coating", (0,0,1))
    # A bent strap leaves a visible slot above the head from front and rear;
    # its inboard foot wraps down to the pivot without resembling an antenna.
    m.beam((x-width/2-3,809,-92),(x-width/2-9,851,-93),23,34,"plum")
    m.beam((x-width/2-9,851,-93),(x-width/2+21,890,-100),22,34,"plum")
    m.beam((x-width/2+21,890,-100),(x+width/2-16,897,-100),21,34,"plum")
    m.beam((x+width/2-16,897,-100),(x+width/2+4,857,-93),20,33,"wine")


def cartridge(m, variant, slot):
    x, y, rear = SOCKETS[slot][1]
    laser = slot == 0 and variant != "b"
    guided = slot == 1 and variant == "c"
    m.hull_z([(rear - 36, x, y - 23, y + 24, 54, 10, 8), (-26, x, y - 36, y + 39, 88, 16, 13),
              (23, x, y - 37, y + 40, 99, 16, 14), (65, x, y - 35, y + 36, 93, 15, 12),
              (83, x, y - 29, y + 30, 82, 13, 10)],
             lambda i, j: "wine" if j in (0, 1, 7) else "plum" if i < 2 else "mineral",
             ("wine", "cast"))
    if guided:
        m.hull_z([(71, x, y - 30, y + 30, 86, 12, 9), (91, x, y - 39, y + 37, 109, 16, 11),
                  (114, x, y - 37, y + 35, 105, 16, 10)],
                 lambda i, j: "plum" if j in (3, 4, 5) else "wine", ("wine", "cast"))
        exits = tuple((x + offset, y, 147) for offset in (-24, 24))
        for ex, ey, ez in exits:
            tube(m, ex, ey, 112, ez, 20)
        return average(exits), exits
    if laser:
        precision = variant == "c"
        lip = 168 if precision else 114
        m.hull_z([(75, x, y - 24, y + 24, 68, 11, 8), (92, x, y - 28, y + 27, 69, 11, 9),
                  (lip - 7, x, y - 18, y + 18, 54 if precision else 59, 10, 7)],
                 "stone" if precision else "cast", ("cast", "joint"))
        ring = barrel_ring(x, y, lip - 6, 18 if precision else 22)
        end = barrel_ring(x, y, lip, 15 if precision else 18)
        m.join([ring, end], "silver", (None, None))
        m.face(end, (0,0,1), "coating")
        core = barrel_ring(x, y, lip + .5, 10)
        m.face(core, (0,0,1), "glass")
        return (x, y, lip + .5), ()
    m.cylinder((x, y, 76), (x, y, 104), 28, "cast")
    for dx,dy in ((0,12),(-11,-6),(11,-6)):
        tube(m, x + dx, y + dy, 102, 153, 10)
    m.cylinder((x, y, 118), (x, y, 132), 24, "joint")
    return (x, y + 12, 153), ()
