"""Ironclad forearms fitted to the Maul's four-mount rig. Dimensions are in millimetres."""

from math import atan2, fsum

from .export import Buffers, primitive, read_rows
from .geometry import PlateMesh, average, clipped_rect, minus, ring_z, unit
from .kestrel import barrel_ring


ELBOW = 13
LAUNCHER_LENGTH = 316
CASTING_SCALE = 0.5  # Approved Ironclad taper shared by all three weapons.
BARREL_SCALE = 0.25
CASTING_FACE = ELBOW + LAUNCHER_LENGTH * CASTING_SCALE
RECEIVER = ELBOW + LAUNCHER_LENGTH * BARREL_SCALE
EXTENSIONS = {"launcher": 0, "ballistic": 164, "energy": 65}


def polygon_z(points, z):
    return [(x, y, z) for x, y in points]


def forearm_cells(mesh, side):
    points = [[mesh.anchor(f"physical_exit_{side}_{r}_{c}") for c in range(4)] for r in range(4)]
    xs = [fsum(points[j][i][0] for j in range(4)) / 4 for i in range(4)]
    ys = [fsum(p[1] for p in row) / 4 for row in points]
    cx = (xs[0] + xs[-1]) / 2
    cy = (ys[0] + ys[-1]) / 2
    z = max(p[2] for row in points for p in row)
    return points, xs, ys, (cx, cy, z)


def launcher_grid(mesh, side, z):
    # One open-faced cartridge. Grid boundaries are halfway between adjacent
    # physical firing centers; all sixteen wells meet the actual source exits.
    points, xs, ys, _ = forearm_cells(mesh, side)

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

    bounds = polygon_z(boundary(bx[0], bx[-1], by[0], by[-1], 11), z)
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
    return bounds


def housing(mesh, cx, cy, native_face):
    rows = [
        (-249, cx, 563, 635, 105, 15, 12), (-179, cx, 522, 697, 180, 20, 19),
        (-77, cx, 484, 708, 222, 25, 22), (ELBOW, cx, 483, 678, 213, 25, 18),
        (89, cx, 493, 640, 178, 20, 15), (native_face - 48, cx, cy - 70, cy + 66, 157, 16, 13),
    ]

    def armor(segment, edge):
        if edge in (0, 1, 7):
            return "coal"
        if segment <= 2 and edge in (2, 3, 5, 6):
            return "oxide"
        return "silver" if segment < 4 and edge == 4 else "cast"

    mesh.hull_z(rows, armor, ("redshade", None))
    for sign in (-1, 1):
        left, right = sorted((cx + sign * 28, cx + sign * 53))
        mesh.patch([(x, 697 + 11 * (z + 179) / 102 + 1.3, z)
                    for x, z in [(left, -158), (right, -158), (right, -91), (left, -91)]], "porcelain", (0, 1, 0))
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


def ballistic(mesh, x, y, front):
    mesh.hull_z([
        (front + 9, x, y - 45, y + 45, 98, 13, 12), (front + 29, x, y - 43, y + 43, 92, 12, 12),
        (front + 68, x, y - 30, y + 30, 67, 9, 8),
    ], "cast", ("cast", "coal"))
    lip = front + EXTENSIONS["ballistic"]
    rows = [(front + 60, x, y - 28, y + 28, 62, 7, 7), (front + 86, x, y - 31, y + 31, 68, 7, 7),
            (lip, x, y - 27, y + 27, 60, 6, 6)]
    mesh.hull_z(rows, lambda i, j: "cast" if j in (3, 4, 5) else "coal", ("coal", None))
    border = ring_z(rows[-1])
    hole = polygon_z(clipped_rect(x, y, 42, 40, 6, 6), lip)
    back = [(a, b, lip - 24) for a, b, _ in hole]
    for i, a in enumerate(border):
        j = (i + 1) % 8
        mesh.face([a, border[j], hole[j], hole[i]], (0, 0, 1), "cast")
        wall = [hole[i], hole[j], back[j], back[i]]
        mesh.face(wall, minus((x, y, lip - 12), average(wall)), "joint")
    mesh.face(back, (0, 0, 1), "bore")


def energy(mesh, x, y, front):
    rings = [barrel_ring(x, y, front + offset, radius) for offset, radius in
             [(11, 64), (50, 62), (65, 54), (65, 44), (37, 44)]]
    mesh.join(rings, lambda i, j: "silver" if i == 2 else "joint", (None, None))
    mesh.face(rings[-1], (0, 0, 1), "plasma")
    for z in (front + 14, front + 37):
        mesh.join([barrel_ring(x, y, level, radius) for level, radius in
                   [(z, 64), (z, 72), (z + 8, 72), (z + 8, 64)]], "podrim", (None, None))


def half_station(native_face, z):
    """The selected elbow and its sloping nose were shaped at the half-length fit."""
    if z <= ELBOW:
        return z
    face = ELBOW + (native_face - ELBOW) * CASTING_SCALE
    if z < native_face - 48:
        return ELBOW + (z - ELBOW) * (face - 48 - ELBOW) / (native_face - 48 - ELBOW)
    if z <= native_face:
        return z + (face - native_face)
    return face + (z - native_face) * CASTING_SCALE


def casting_triangles(polygons, pivot, native_face):
    """Reproduce the float32 casting on which the final cut was made."""
    cast_faces = []
    for points, normal, color in polygons:
        low, high = min(p[2] for p in points), max(p[2] for p in points)
        if high - low > 1e-9:
            stretch = (half_station(native_face, high) - half_station(native_face, low)) / (high - low)
            if abs(stretch - 1) > 1e-9:
                normal = unit((normal[0], normal[1], normal[2] / stretch))
        fitted = [(x, y, half_station(native_face, z)) for x, y, z in points]
        cast_faces.append((fitted, normal, color))

    buffers = Buffers()
    surface = primitive(buffers, cast_faces, 0, pivot)
    attributes = surface["attributes"]
    points = [tuple(v * 1000 + base for v, base in zip(row, pivot))
              for row in read_rows(buffers, attributes["POSITION"])]
    normals = read_rows(buffers, attributes["NORMAL"])
    colors = read_rows(buffers, attributes["COLOR_0"])
    indices = [n for (n,) in read_rows(buffers, surface["indices"])]
    for i in range(0, len(indices), 3):
        a, b, c = indices[i:i + 3]
        yield [points[a], points[b], points[c]], normals[a], colors[a]


def clip_housing(triangles):
    """Keep the existing roof, and cut each crossing triangle at the shared receiver."""
    rear, trimmed, perimeter = [], [], set()
    for triangle, normal, color in triangles:
        if all(p[2] < RECEIVER for p in triangle):
            rear.append((triangle, normal, color))
        elif any(p[2] < RECEIVER for p in triangle):
            face = []
            for a, b in zip(triangle, triangle[1:] + triangle[:1]):
                if a[2] < RECEIVER:
                    face.append(a)
                if (a[2] < RECEIVER) != (b[2] < RECEIVER):
                    k = (RECEIVER - a[2]) / (b[2] - a[2])
                    cut_point = (a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, RECEIVER)
                    face.append(cut_point)
                    perimeter.add(tuple(round(c, 7) for c in cut_point))
            trimmed.append((face, normal, color))
    if len(perimeter) != 16:
        raise ValueError("Expected one corner and one diagonal edge from each of the eight armor facets")
    x, y, _ = average(perimeter)
    boundary = sorted(perimeter, key=lambda p: atan2(p[1] - y, p[0] - x))
    bottom = min(p[1] for p in boundary)
    start = min((p for p in boundary if abs(p[1] - bottom) < 0.0001), key=lambda p: p[0])
    index = boundary.index(start)
    return rear + trimmed, boundary[index:] + boundary[:index]


def seat(mesh, outline, inside):
    for i, inner in enumerate(inside):
        a, middle, b = (outline[(2 * i + j) % len(outline)] for j in range(3))
        for triangle in [(inner, a, middle), (inner, middle, b), (inner, b, inside[(i + 1) % len(inside)])]:
            mesh.face(triangle, (0, 0, 1), "podrim")


def build(mesh, side, family, palette):
    """Fit one cast housing and its family insert to the existing native socket."""
    x, y, native_face = forearm_cells(mesh, side)[-1]
    pivot = mesh.anchor(f"rig_mount_{side}-pod")
    if family != "launcher":
        # Module construction reads the fitted A rig. Recover the native launcher
        # plane, retaining the imported rig's sub-millimetre coordinate precision.
        half_from_rig = native_face + (CASTING_FACE - RECEIVER)
        native_face = ELBOW + (half_from_rig - ELBOW) / CASTING_SCALE

    parts = PlateMesh(mesh.nodes, palette)
    parts.section = "casting"
    housing(parts, x, y, native_face)
    armor, outline = clip_housing(casting_triangles(parts.sections["casting"][0], pivot, native_face))

    parts.section = "insert"
    if family == "launcher":
        rim = launcher_grid(parts, side, native_face)
        rim = [(a, b, RECEIVER) for a, b, _ in rim]
    else:
        builders = {"ballistic": ballistic, "energy": energy}
        builders[family](parts, x, y, native_face)
        rim = ring_z((RECEIVER + 13 * BARREL_SCALE, x, y - 68, y + 58, 151, 16, 14))

    parts.section = "flange"
    seat(parts, outline, rim)
    if family != "launcher":
        parts.face(rim, (0, 0, 1), "coal")

    faces = mesh.sections[mesh.section][0]
    faces.extend(armor)
    faces.extend(parts.sections["flange"][0])
    depth = 1 if family == "launcher" else BARREL_SCALE / CASTING_SCALE
    for triangle, normal, color in casting_triangles(parts.sections["insert"][0], pivot, native_face):
        points = [(a, b, RECEIVER + (z - CASTING_FACE) * depth) for a, b, z in triangle]
        if depth != 1:
            normal = unit((normal[0], normal[1], normal[2] / depth))
        faces.append((points, normal, color))
    native_tip = native_face + EXTENSIONS[family]
    cut_length = (LAUNCHER_LENGTH + EXTENSIONS[family]) * (CASTING_SCALE - BARREL_SCALE)
    # Use the same two longitudinal translations as the source-space fitted rig.
    offset = (native_tip - pivot[2]) * 0.001
    offset += (half_station(native_face, native_tip) - native_tip) * 0.001
    offset -= cut_length * 0.001
    return (x, y, pivot[2] + offset * 1000), ()


def place_launcher_exits(nodes, mesh):
    for side in ("left", "right"):
        names = [f"muzzle_{side}-forearm pod"]
        names.extend(f"physical_exit_{side}_{row}_{column}" for row in range(4) for column in range(4))
        for name in names:
            translation = nodes[mesh.by_name[name]]["translation"]
            z = mesh.anchor(name)[2]
            translation[2] += (half_station(z, z) - z) * 0.001
            translation[2] -= LAUNCHER_LENGTH * (CASTING_SCALE - BARREL_SCALE) * 0.001
