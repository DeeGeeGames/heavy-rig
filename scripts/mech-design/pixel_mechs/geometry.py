"""Rigid, vertex-painted plate geometry in source-rig space, in millimetres.

Y is up, +Z is forward. Mesh sections are named for geometry nodes in the rig.
Only visor swatches use the emissive material.
"""

import math
from collections import defaultdict


def plus(a, b):
    return tuple(x + y for x, y in zip(a, b))


def minus(a, b):
    return tuple(x - y for x, y in zip(a, b))


def times(vector, scale):
    return tuple(value * scale for value in vector)


def average(points):
    return times(tuple(map(math.fsum, zip(*points))), 1 / len(points))


def dot(a, b):
    return math.fsum(x * y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(vector):
    return times(vector, 1 / math.sqrt(dot(vector, vector)))


def clipped_rect(x, y, width, height, cut_x, cut_y):
    """Eight corners of a rectangle with clipped edges, counterclockwise."""
    left, right = x - width / 2, x + width / 2
    bottom, top = y - height / 2, y + height / 2
    return [
        (left + cut_x, bottom),
        (right - cut_x, bottom),
        (right, bottom + cut_y),
        (right, top - cut_y),
        (right - cut_x, top),
        (left + cut_x, top),
        (left, top - cut_y),
        (left, bottom + cut_y),
    ]


def ring_z(row):
    z, x, bottom, top, width, cut_x, cut_y = row
    return [(u, v, z) for u, v in clipped_rect(x, (bottom + top) / 2, width, top - bottom, cut_x, cut_y)]


def linear_color(hex_rgb):
    def linear_byte(channel):
        value = channel / 255
        return round(255 * (value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4))

    return tuple(linear_byte(int(hex_rgb[k : k + 2], 16)) for k in (0, 2, 4)) + (255,)


class PlateMesh:
    def __init__(self, nodes, palette):
        self.nodes = nodes
        self.by_name = {node["name"]: i for i, node in enumerate(nodes)}
        self.parents = {child: i for i, node in enumerate(nodes) for child in node.get("children", [])}
        shared = {"cast": "485561", "joint": "2c3542", "shadow": "151e2a", "bore": "0c1420"}
        self.colors = {key: linear_color(value) for key, value in (shared | palette).items()}
        self.sections = defaultdict(lambda: defaultdict(list))
        self.section = None

    def origin(self, index):
        node = self.nodes[index]
        if any(key in node for key in ("rotation", "scale", "matrix")):
            raise ValueError(f"Expected a translation-only pivot: {node['name']}")
        parent = self.origin(self.parents[index]) if index in self.parents else (0, 0, 0)
        return plus(parent, times(node.get("translation", (0, 0, 0)), 1000))

    def anchor(self, name):
        """World-space centre of a named pivot, socket or firing exit."""
        return self.origin(self.by_name[name])

    def face(self, points, outward, pigment):
        a, b, c = points[:3]
        normal = cross(minus(b, a), minus(c, a))
        if dot(normal, normal) < 1e-12:
            raise ValueError(f"Degenerate face in {self.section}: {points}")
        if dot(normal, outward) < 0:
            points = list(reversed(points))
            normal = times(normal, -1)
        material = int(pigment in ("glass", "shine", "hot", "glint"))
        self.sections[self.section][material].append((points, unit(normal), self.colors[pigment]))

    def join(self, rings, pigment, caps=None):
        """Bridge matching ring edges, then close each end with its chosen paint.

        A paint function takes the longitudinal segment and perimeter edge indices.
        Passing None for either cap leaves that end open.
        """
        for segment, (start, end) in enumerate(zip(rings, rings[1:])):
            center = average(start + end)
            for edge in range(len(start)):
                next_edge = (edge + 1) % len(start)
                quad = [start[edge], start[next_edge], end[next_edge], end[edge]]
                color = pigment(segment, edge) if callable(pigment) else pigment
                self.face(quad, minus(average(quad), center), color)
        if caps is None:
            caps = (pigment(0, 0), pigment(len(rings) - 2, 0)) if callable(pigment) else (pigment, pigment)
        if caps[0]:
            self.face(rings[0], minus(average(rings[0]), average(rings[1])), caps[0])
        if caps[1]:
            self.face(rings[-1], minus(average(rings[-1]), average(rings[-2])), caps[1])

    def hull_z(self, rows, pigment, caps=None):
        """Cross-sections (z, x, bottom, top, width, horizontal cut, vertical cut)."""
        self.join([ring_z(row) for row in rows], pigment, caps)

    def hull_y(self, rows, pigment, caps=None):
        """Cross-sections (y, x, z, width, depth, horizontal cut, depth cut)."""
        rings = [
            [(u, y, v) for u, v in clipped_rect(x, z, width, depth, cut_x, cut_z)]
            for y, x, z, width, depth, cut_x, cut_z in rows
        ]
        self.join(rings, pigment, caps)

    def cylinder(self, a, b, radius, pigment, sides=8):
        direction = unit(minus(b, a))
        reference = (0, 1, 0) if abs(direction[1]) < 0.92 else (0, 0, 1)
        u = unit(cross(direction, reference))
        v = cross(direction, u)

        def ring(center):
            points = []
            for edge in range(sides):
                angle = (edge + 0.5) * 2 * math.pi / sides
                points.append(
                    plus(center, plus(times(u, radius * math.cos(angle)), times(v, radius * math.sin(angle))))
                )
            return points

        self.join([ring(a), ring(b)], pigment)

    def beam(self, a, b, width, depth, pigment):
        """Clipped rectangular cross-section through two structural hardpoints."""
        direction = unit(minus(b, a))
        reference = (0, 0, 1) if abs(direction[2]) < 0.94 else (0, 1, 0)
        lateral = unit(cross(direction, reference))
        normal = cross(direction, lateral)
        profile = clipped_rect(0, 0, width, depth, width * 0.15, depth * 0.15)
        rings = [[plus(center, plus(times(lateral, x), times(normal, y))) for x, y in profile] for center in (a, b)]
        self.join(rings, pigment)

    def patch(self, points, pigment, outward=(0, 1, 1)):
        self.face(points, outward, pigment)
