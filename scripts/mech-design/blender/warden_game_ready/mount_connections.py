"""Four fixed structural necks measured against the preserved neutral geometry.

Each combined solid neck and its end collars belong rigidly to the torso.
The four weapon groups share that torso transform, so no bridge deformation,
per-weapon articulation or runtime connection controls are required.
"""

import math
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree



def surface_tree(objects):
    vertices, faces = [], []
    for obj in objects:
        obj.data.calc_loop_triangles()
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(
            tuple(i + offset for i in tri.vertices) for tri in obj.data.loop_triangles
        )
    return BVHTree.FromPolygons(vertices, faces, all_triangles=True, epsilon=0)


def measure_connections(group_objects, connection_specs):
    torso = surface_tree(group_objects["rig_torso"])
    result = []
    for identifier, mount, side, y, z, radius, collar_radius in connection_specs:
        tree = surface_tree(group_objects[mount])
        start, direction = Vector((0, y, z)), Vector((side, 0, 0))
        body_hit, body_normal, _, body_distance = torso.ray_cast(
            Vector((side * 0.6, y, z)), -direction, 0.6
        )
        mount_hit, mount_normal, _, mount_distance = tree.ray_cast(
            start, direction, 0.6
        )
        if body_hit is None or mount_hit is None:
            raise ValueError("Missing physical attachment skin at " + identifier)
        gap = side * (mount_hit.x - body_hit.x)
        if (
            gap < 0.004
            or body_normal.dot(direction) < 0.4
            or mount_normal.dot(direction) > -0.4
        ):
            raise ValueError(
                "Attachment probes did not find facing exterior skins: " + identifier
            )
        # Positive embed is intentional: the collar is not balanced on a paper edge.
        embed = 0.006
        body_anchor = body_hit - direction * embed
        mount_anchor = mount_hit + direction * embed
        if (mount_anchor - body_anchor).length < 0.008:
            # Overlapping source skins still need a finite structural connection span.
            mount_anchor += direction * 0.012
        length = (mount_anchor - body_anchor).length
        if not 0.008 < length < 0.14:
            raise ValueError(
                "Unexpected connection span " + identifier + ": " + str(length)
            )
        result.append(
            {
                "id": identifier,
                "mountGroup": mount,
                "bodyGroup": "rig_torso",
                "bodySkinPoint": list(body_hit),
                "mountSkinPoint": list(mount_hit),
                "bodyAnchorWorld": list(body_anchor),
                "mountAnchorWorld": list(mount_anchor),
                "bodySkinNormal": list(body_normal),
                "mountSkinNormal": list(mount_normal),
                "axialSkinGapNative": gap,
                "lengthNative": length,
                "radiusNative": radius,
                "collarRadiusNative": collar_radius,
                "collarDepthNative": 0.010,
                "embedDepthNative": embed,
                "bodyPenetrationNative": embed,
                "mountPenetrationNative": embed,
                "sleeveOverlapNative": length * 0.28,
            }
        )
    return result


def coupling_mesh(name, length, radius, collar_radius, material):
    vertices, faces = [], []
    segments = 10

    def profile(rings):
        offset = len(vertices)
        for axial, radial in rings:
            vertices.extend(
                (
                    math.cos(2 * math.pi * i / segments) * radial,
                    math.sin(2 * math.pi * i / segments) * radial,
                    axial,
                )
                for i in range(segments)
            )
        for row in range(len(rings) - 1):
            for i in range(segments):
                nxt = (i + 1) % segments
                faces.append(
                    (
                        offset + row * segments + i,
                        offset + row * segments + nxt,
                        offset + (row + 1) * segments + nxt,
                        offset + (row + 1) * segments + i,
                    )
                )
        for row, reverse in [(0, True), (len(rings) - 1, False)]:
            center = len(vertices)
            vertices.append((0, 0, rings[row][0]))
            for i in range(segments):
                a, b = (
                    offset + row * segments + i,
                    offset + row * segments + (i + 1) % segments,
                )
                faces.append((center, b, a) if reverse else (center, a, b))

    sleeve_length = length * 0.64
    bevel = min(0.002, sleeve_length * 0.15)
    profile(
        [
            (0, radius * 0.85),
            (bevel, radius),
            (sleeve_length - bevel, radius),
            (sleeve_length, radius * 0.85),
        ]
    )
    profile([(length * 0.36, radius * 0.66), (length, radius * 0.66)])
    thickness = 0.010
    for center in [0, length]:
        profile(
            [
                (center - thickness * 0.5, collar_radius * 0.77),
                (center - thickness * 0.25, collar_radius),
                (center + thickness * 0.25, collar_radius),
                (center + thickness * 0.5, collar_radius * 0.77),
            ]
        )
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def add_mount_connections(objects, anchors, material, connection_specs):
    group_objects = {obj.name: [obj] for obj in objects}
    measured = measure_connections(group_objects, connection_specs)
    contracts = []
    neck_objects = []
    for row in measured:
        identifier = row["id"]
        name = "joint_" + identifier
        start, end = Vector(row["bodyAnchorWorld"]), Vector(row["mountAnchorWorld"])
        direction = (end - start).normalized()
        obj = coupling_mesh(
            name,
            row["lengthNative"],
            row["radiusNative"],
            row["collarRadiusNative"],
            material,
        )
        obj.matrix_world = Matrix.LocRotScale(
            start, Vector((0, 0, 1)).rotation_difference(direction), Vector((1, 1, 1))
        )
        joint_tree = surface_tree([obj])
        body_pairs = len(joint_tree.overlap(surface_tree(group_objects["rig_torso"])))
        mount_pairs = len(
            joint_tree.overlap(surface_tree(group_objects[row["mountGroup"]]))
        )
        if min(body_pairs, mount_pairs) == 0:
            raise ValueError(
                "Connector lacks positive skin intersection: " + identifier
            )
        row["neutralSkinTrianglePairs"] = {"body": body_pairs, "mount": mount_pairs}
        neck_objects.append(obj)
        body_anchor = "connection_" + identifier + "_torso"
        mount_anchor = "connection_" + identifier + "_mount"
        anchors.extend(
            [
                {
                    "name": body_anchor,
                    "parent": "rig_torso",
                    "worldPosition": row["bodyAnchorWorld"],
                    "extras": {
                        "role": "mount-connection-endpoint",
                        "embeddedNative": row["embedDepthNative"],
                    },
                },
                {
                    "name": mount_anchor,
                    "parent": row["mountGroup"],
                    "worldPosition": row["mountAnchorWorld"],
                    "extras": {
                        "role": "mount-connection-endpoint",
                        "embeddedNative": row["embedDepthNative"],
                    },
                },
            ]
        )
        contracts.append(
            {
                "id": identifier,
                "node": "geometry_mount_connections",
                "meshName": "mount_connections",
                "parent": "rig_torso",
                "binding": "rigid-to-torso",
                "bodyAnchor": body_anchor,
                "mountAnchor": mount_anchor,
                "style": "fixed solid neck with two embedded bearing collars",
                "measurement": row,
            }
        )
    # Consolidate only these new static parts; the original armor data remains separate.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in neck_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = neck_objects[0]
    bpy.ops.object.join()
    merged = neck_objects[0]
    merged.name = "mount_connections"
    merged.data.name = "mount_connections_mesh"
    objects.append(merged)
    return contracts
