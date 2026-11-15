"""Run in Blender: all mesh instances and loose components must be inventoried."""

import sys
import unittest
from pathlib import Path
import bpy

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/mech-design/blender"))
from source_inventory import inventory_meshes, signature


class SourceInventoryTests(unittest.TestCase):
    def test_shared_mesh_instances_and_loose_vertex_are_not_dropped(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        mesh = bpy.data.meshes.new("source")
        mesh.from_pydata([(0, 0, 0), (1, 0, 0), (0, 1, 0), (5, 5, 5)], [], [(0, 1, 2)])
        for name, x in [("body", 0), ("module", 10)]:
            obj = bpy.data.objects.new(name, mesh)
            bpy.context.scene.collection.objects.link(obj)
            obj.location.x = x
        bpy.context.view_layer.update()
        inventory = inventory_meshes(bpy.context.scene.objects)
        self.assertEqual(len(inventory["meshes"]), 2)
        self.assertEqual(len(inventory["components"]), 4)
        for source in inventory["meshes"]:
            components = [c for c in inventory["components"] if c["mesh"] == source["id"]]
            self.assertEqual(sorted(v for c in components for v in c["vertices"]), [0, 1, 2, 3])
            self.assertEqual([f for c in components for f in c["faces"]], [0])
        self.assertEqual(sorted(c["worldMinimum"][0] for c in inventory["components"]), [0, 5, 10, 15])
        before = signature(inventory)
        bpy.data.objects["module"].location.x += 1
        bpy.context.view_layer.update()
        self.assertNotEqual(before, signature(inventory_meshes(bpy.context.scene.objects)))


if __name__ == "__main__":
    unittest.main(argv=[__file__])
