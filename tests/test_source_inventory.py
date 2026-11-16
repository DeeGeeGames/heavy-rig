"""Regression protection against silently dropping source meshes or ownership."""

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/mech-design/blender"))
from source_inventory import signature, verify_inventory_equivalence, verify_ownership


class SourceOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.inventory = {
            "meshes": [{"id": "mesh:0"}, {"id": "mesh:1"}],
            "components": [{"id": "mesh:0/component:0"}, {"id": "mesh:1/component:0"}],
        }
        self.mapping = {
            "schemaVersion": 1, "sourceSha256": "frozen-source",
            "inventorySha256": signature(self.inventory),
            "approval": {"status": "approved", "evidence": "fixture approval"},
            "groups": ["body", "weapon"],
            "assignments": {"mesh:0/component:0": "body", "mesh:1/component:0": "weapon"},
        }

    def test_missing_second_mesh_or_stale_assignment_is_rejected(self):
        self.assertEqual([r["group"] for r in verify_ownership(self.inventory, self.mapping, "frozen-source")], ["body", "weapon"])
        for key in ["mesh:1/component:0", "unknown"]:
            mapping = copy.deepcopy(self.mapping)
            if key == "unknown":
                mapping["assignments"][key] = "body"
            else:
                del mapping["assignments"][key]
            with self.assertRaisesRegex(ValueError, "Every source component"):
                verify_ownership(self.inventory, mapping, "frozen-source")

    def test_changed_source_inventory_unreviewed_and_unknown_ownership_fail(self):
        with self.assertRaisesRegex(ValueError, "source differs"):
            verify_ownership(self.inventory, self.mapping, "new-source")
        changed = copy.deepcopy(self.inventory)
        changed["meshes"][1]["matrixWorld"] = "moved"
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            verify_ownership(changed, self.mapping, "frozen-source")
        for field, value in [("approval", {"status": "draft"}), ("assignments", {"mesh:0/component:0": "body", "mesh:1/component:0": "unknown"})]:
            mapping = {**self.mapping, field: value}
            with self.assertRaises(ValueError):
                verify_ownership(self.inventory, mapping, "frozen-source")

    def test_malformed_approval_and_group_records_cannot_authorize_ownership(self):
        for field, value in [("groups", "body"), ("groups", [None]), ("approval", True), ("approval", {"status": "approved", "evidence": True}), ("assignments", [])]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                verify_ownership(self.inventory, {**self.mapping, field: value}, "frozen-source")


class InventoryImportRepeatabilityTests(unittest.TestCase):
    def setUp(self):
        self.frozen = {
            "schemaVersion": 1,
            "meshes": [{"id": "mesh:0", "geometrySha256": "exact-geometry", "matrixWorld": [1, 0]}],
            "components": [{"id": "mesh:0/component:0", "vertices": [0, 8, 7, 3],
                            "faces": [2, 4], "worldMinimum": [0, 0, 0]}],
        }

    def test_import_traversal_order_can_vary_without_rewriting_the_retained_fingerprint(self):
        before = signature(self.frozen)
        current = copy.deepcopy(self.frozen)
        current["components"][0]["vertices"] = [0, 3, 8, 7]
        verify_inventory_equivalence(current, self.frozen)
        self.assertEqual(signature(self.frozen), before)
        self.assertNotEqual(signature(current), before)

    def test_changed_geometry_transform_membership_faces_and_bounds_still_fail(self):
        for section, key, value in [
            ("meshes", "geometrySha256", "changed"),
            ("meshes", "matrixWorld", [1, 1]),
            ("components", "id", "mesh:0/component:1"),
            ("components", "vertices", [0, 8, 7]),
            ("components", "vertices", [0, 8, 7, 7]),
            ("components", "faces", [2, 5]),
            ("components", "worldMinimum", [0, 0, 0.01]),
        ]:
            changed = copy.deepcopy(self.frozen)
            changed[section][0][key] = value
            with self.subTest(section=section, key=key), self.assertRaisesRegex(ValueError, "inventory differs"):
                verify_inventory_equivalence(changed, self.frozen)


if __name__ == "__main__":
    unittest.main()
