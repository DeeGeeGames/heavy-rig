"""Reject hierarchy ambiguity before it can drop or mis-parent authored geometry."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/mech-design/blender"))
from rigid_contract import ordered_anchors, validate_groups, validate_source_nodes


class RigidContractTests(unittest.TestCase):
    def test_arbitrary_anatomy_and_forward_declared_anchors(self):
        groups = validate_groups([
            {"name": "bridge", "parent": None, "pivot": [0, 0, 1]},
            {"name": "carrier", "parent": "bridge", "pivot": [1, 0, 2]},
        ])
        anchors = ordered_anchors({"anchors": [
            {"name": "exit", "parent": "socket", "worldPosition": [1, -1, 2]},
            {"name": "socket", "parent": "carrier", "worldPosition": [1, 0, 2]},
        ]}, groups)
        self.assertEqual([anchor["name"] for anchor in anchors], ["socket", "exit"])

    def test_cycles_duplicates_and_missing_parents_are_rejected(self):
        for records in [
            [{"name": "a", "parent": "b", "pivot": [0, 0, 0]}, {"name": "b", "parent": "a", "pivot": [0, 0, 0]}],
            [{"name": "a", "parent": None, "pivot": [0, 0, 0]}] * 2,
            [{"name": "a", "parent": "absent", "pivot": [0, 0, 0]}],
        ]:
            with self.assertRaises(ValueError):
                validate_groups(records)
        for nodes in [
            [{"children": [1]}, {"children": [0]}],
            [{"name": "same"}, {"name": "same"}],
            [{"children": [2]}, {}],
            [{"children": [2]}, {"children": [2]}, {}],
        ]:
            with self.assertRaises(ValueError):
                validate_source_nodes({"nodes": nodes})

    def test_skin_or_morph_geometry_cannot_be_silently_rigidified(self):
        with self.assertRaises(ValueError):
            validate_source_nodes({"nodes": [{"skin": 0}]})
        with self.assertRaises(ValueError):
            validate_source_nodes({"nodes": [{"mesh": 0}], "meshes": [{"primitives": [{"targets": [{"POSITION": 0}]}]}]})

    def test_anchor_parent_and_name_ambiguity_are_rejected(self):
        groups = validate_groups([{"name": "root", "parent": None, "pivot": [0, 0, 0]}])
        for anchors in [
            [{"name": "root", "parent": "root", "worldPosition": [0, 0, 0]}],
            [{"name": "a", "parent": "b", "worldPosition": [0, 0, 0]}, {"name": "b", "parent": "a", "worldPosition": [0, 0, 0]}],
            [{"name": "a", "parent": "missing", "worldPosition": [0, 0, 0]}],
        ]:
            with self.assertRaises(ValueError):
                ordered_anchors({"anchors": anchors}, groups)


class InstancedSourceTests(unittest.TestCase):
    def test_gpu_instances_cannot_be_silently_flattened(self):
        source = {"nodes": [{"name": "instanced", "mesh": 0, "extensions": {"EXT_mesh_gpu_instancing": {"attributes": {"TRANSLATION": 0}}}}], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}]}
        with self.assertRaisesRegex(ValueError, "instance expansion"):
            validate_source_nodes(source)


if __name__ == "__main__":
    unittest.main()
