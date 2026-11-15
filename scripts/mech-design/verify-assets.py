"""Verify the exact checked-in asset checkpoints after git lfs pull."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
manifest = json.loads((root / 'design/mechs/assets/manifest.json').read_text())
errors = []
for asset in manifest['files']:
    path = root / asset['path']
    if not path.is_file():
        errors.append(f"Missing: {asset['path']}")
        continue
    data = path.read_bytes()
    if data.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
        errors.append(f"LFS pointer instead of asset: {asset['path']}; run git lfs pull")
    elif len(data) != asset['bytes'] or hashlib.sha256(data).hexdigest() != asset['sha256']:
        errors.append(f"Size/hash mismatch: {asset['path']}")
if errors:
    raise SystemExit('\n'.join(errors))
print(f"Verified {len(manifest['files'])} checkpoint files.")
