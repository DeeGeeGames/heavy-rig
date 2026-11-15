"""Run in Blender Python: verify independent mesh instances survive neutral packaging."""

import copy
import sys
import unittest
from pathlib import Path
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/mech-design/blender"))
from rigid_packaging import local_matrix, package_neutral_rig


class RigidPackagingTests(unittest.TestCase):
    def setUp(self):
        self.source = {
            "asset": {"version": "2.0"},
            "nodes": [
                {"name": "transform", "translation": [2, 3, 4], "children": [1]},
                {"name": "armor", "mesh": 0, "translation": [1, 2, 3]},
                {"name": "module", "mesh": 0, "translation": [-1, 5, 2]},
            ],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        }
        self.contract = {
            "groups": [
                {"name": "bridge", "parent": None, "pivot": [0, 0, 1]},
                {"name": "carrier", "parent": "bridge", "pivot": [1, 0, 2]},
            ],
            "meshGroups": {"armor": "bridge", "module": "carrier"},
            "anchors": [{"name": "exit", "parent": "carrier", "worldPosition": [1, -1, 2]}],
        }

    def package(self):
        return package_neutral_rig(self.source, self.contract, scene_name="Carrier", generator="Test")

    def test_two_mesh_instances_preserve_world_placement_and_resources(self):
        original = copy.deepcopy(self.source)
        document, indices, groups, rest, owned, bindings = self.package()
        self.assertEqual(set(groups), {"bridge", "carrier"})
        self.assertEqual(owned, {"bridge": ["geometry_armor"], "carrier": ["geometry_module"]})
        self.assertEqual(document["meshes"], original["meshes"])
        self.assertEqual(self.source, original)
        self.assertEqual(len(bindings), 2)
        for entry in bindings:
            name = "geometry_" + entry["node"]["name"]
            geometry = next(node for node in document["nodes"] if node["name"] == name)
            owner = entry["owner"]
            result = local_matrix(document["nodes"][indices[owner]]) @ local_matrix(geometry)
            parent = groups[owner]["parent"]
            if parent:
                result = local_matrix(document["nodes"][indices[parent]]) @ result
            self.assertLess(max(abs(result[row][col] - entry["matrix"][row][col]) for row in range(4) for col in range(4)), 1e-6)
        exit_node = document["nodes"][indices["exit"]]
        self.assertLess((Vector(exit_node["translation"]) - Vector((0, 0, 1))).length, 1e-6)

    def test_unassigned_second_mesh_or_stale_mapping_fails(self):
        del self.contract["meshGroups"]["module"]
        with self.assertRaisesRegex(ValueError, "Unassigned mesh"):
            self.package()
        self.contract["meshGroups"]["module"] = "carrier"
        self.contract["meshGroups"]["absent"] = "carrier"
        with self.assertRaisesRegex(ValueError, "absent geometry"):
            self.package()

    def test_connection_cannot_claim_a_different_owner(self):
        self.contract["staticConnections"] = [{"meshName": "module", "parent": "bridge", "id": "joint"}]
        with self.assertRaisesRegex(ValueError, "ownership differs"):
            self.package()


if __name__ == "__main__":
    unittest.main(argv=[__file__])
