"""Regression protection against silently dropping source meshes or ownership."""

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/mech-design/blender"))
from source_inventory import signature, verify_ownership


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


if __name__ == "__main__":
    unittest.main()
