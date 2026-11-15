"""Apply the frozen Warden ownership decisions to a complete shared inventory."""

from pathlib import Path
import hashlib
import json
import os
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from recipe import load_recipe
from source_inventory import inventory_meshes, verify_ownership
import bpy

config = load_recipe()
repo = Path(os.environ["WARDEN_GAME_REPO"]).resolve()
work = Path(os.environ["WARDEN_GAME_WORK"]).resolve()
source = Path(os.environ["WARDEN_GAME_SOURCE"]).resolve()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
inventory = inventory_meshes(bpy.context.scene.objects)
# Warden feature repairs index one frozen mesh. Never silently omit extra meshes.
if len(inventory["meshes"]) != 1:
    raise ValueError("Warden repair adapter requires its single frozen source mesh; use shared inventory for a new source")
mapping = json.loads((repo / config["inputs"]["ownership"]["path"]).read_text())
approval = json.loads((repo / mapping["approval"]["evidence"]).read_text())
if mapping["approval"].get("assetSha256") != approval["asset"]["sha256"]:
    raise ValueError("Inherited ownership no longer refers to the selected approval")
assigned = verify_ownership(inventory, mapping, hashlib.sha256(source.read_bytes()).hexdigest())
# Keep the existing Warden feature IDs and face/vertex order for exact reproduction.
rows = [
    {"id": index, **{key: component[key] for key in ("vertices", "faces", "triangles", "minimum", "maximum", "group")}}
    for index, component in enumerate(assigned)
]
(work / "source-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
(work / "components.json").write_text(json.dumps(rows, separators=(",", ":")))
print(json.dumps({"meshes": len(inventory["meshes"]), "assignedComponents": len(rows)}))
