# Warden modular assembly trial 1

Status: **preview-unapproved**. This demonstrates shared geometry across A/B/C; it does not promote a repaired or approved chassis master. Ankle/piston defects from the articulation trial remain unresolved.

## What is shared

Warden B's four-view Detailed export supplies the provisional body. All three assemblies link the exact same 105 objects and mesh datablocks: feet, legs, pelvis, torso, cockpit, cannons, shoulder supports and rear pod housings. The shared geometry/transform fingerprint is `f5cd88ff1a1169f7249a8e4bc3de4c8f98baac766d4e00d01c4e8dbb9191012f`.

Only the front cartridges differ:

| Assembly | Own-left shoulder | Own-right shoulder | Guns |
| --- | --- | --- | --- |
| Warden A (`warden`) | Launcher | Launcher | Two shared ballistic |
| Warden B (`warden-b`) | Energy | Energy | Two shared ballistic |
| Warden C (`warden-c`) | Energy | Launcher | Two shared ballistic |

These assignments were checked against current `getHardpoints()` output. The recipe refuses an input contract whose mount IDs/families differ. It is a visual representative of each mount family, not a separate model for every compatible weapon or magazine size. Eight visible launcher tubes still represent one mount, not an ammunition-capacity rule.

## Extraction and interfaces

[modular-draft.json](modular-draft.json) binds the recipe to the hashes of the untouched A/B source exports. B parts 1/2 are split at Blender Y=0.12. Their rear sections become shared housings; their fronts plus energy optics 59/68 become removable energy cartridges. A parts 1/2 supply launcher fronts, cropped above Z=0.80 to exclude support geometry and ahead of the same Y plane. Each launcher front is fitted to its corresponding B front's X/Z envelope (about 1.6–1.9% wider and 4.0–4.1% taller).

The cut is deliberately behind the visible front bezel: the replaceable cartridge includes the bezel and face, while rear housing, armor straps and support remain common. Imported source units are not yet real-world dimensions. `socket_left_shoulder` and `socket_right_shoulder` mark provisional attachment planes, facing -Y. They are **not muzzle origins**. Source-part provenance survives on derived objects.

This trial exports components in common chassis coordinates, not a finalized socket-local asset format. The assembly scenes link shared geometry rather than loading and attaching components through a runtime. Production packaging must normalize module origins, parent sockets to the articulated torso, define muzzle anchors/clearance envelopes and supply empty-mount caps.

## Reproduce

Use Blender 5.2.0 LTS with access to this checkout and both exact source GLBs. Run `git lfs pull` and the asset verifier first. Required original GLBs and the retained assembly checkpoint are stored under `design/mechs/assets/warden/`. New runs write ignored candidates.

First refresh the contract from the current checkout:

```sh
mkdir -p design/mechs/generated/modular-assembly-candidate
bun -e "import {getHardpoints} from './src/hardpoints'; await Bun.write('design/mechs/generated/modular-assembly-candidate/gameplay-contract.json', JSON.stringify(Object.fromEntries(['warden','warden-b','warden-c'].map(id => [id,getHardpoints(id)])),null,2)+'\n')"
```

In Blender's Python environment, set `REPO_ROOT` to the absolute repository path and execute `scripts/mech-design/blender/modular_assembly.py`. It verifies source hashes and the supplied current contract, preserves source exports, creates isolated scenes, and restores the previously active scene. It refuses colliding scene or stable assembly object names. The default output is `generated/modular-assembly-candidate`; set `OUTPUT_FOLDER` for a different fresh candidate. Never regenerate over the retained checkpoint.

Retained checkpoint outputs under `design/mechs/assets/warden/modular-assembly/`:

- `warden-modular-library.blend`: linked shared objects, component library and A/B/C scenes.
- `warden-shared-chassis.glb` and four side/family cartridge GLBs: component extracts.
- `warden-assembled.glb`, `warden-b-assembled.glb`, `warden-c-assembled.glb`: standalone review snapshots, not independent masters or shipping assets.
- `assembly-report.json` includes source hashes, fitting transforms and limitations. Preview renders are disposable.
- `gameplay-contract.json`: recorded mount snapshot. Generate a fresh contract in the candidate directory for each run.

## Validation and remaining gates

The exported GLBs were independently inspected, and the same export checks are now part of the assembly script: all 105 shared meshes have identical geometry attributes, topology and node transforms across the component export and all three complete assemblies. Each assembly contains one scene and the same stable socket IDs. Mesh/triangle counts are A 107/192,439; B 109/189,826; C 108/191,082. Cutting adds vertices/triangles; this is not an optimization pass. Local detailed verification is retained in `export-verification.json`.

Visual review found the expected launcher/energy faces, two shared cannons and unchanged chassis. C places energy on the mech's own left (image-right in a frontal view). The donor fronts fit the common silhouette, but matching bounding envelopes does not establish matched seam loops or watertightness. Inspect and repair cartridge-to-housing seams before acceptance. Rear renders and shared-geometry checks support consistency, not complete mechanical approval.

Next: review this modular boundary, repair the common chassis joints once, finish cartridge seams/interfaces, then validate bilateral motion, muzzle placement and empty mounts. Apply accepted common repairs to every assembly through the shared master. Render the final four views directly from those assemblies for owner approval. Do not regenerate entire variants. Optimize the common body and cartridges only after these gates pass.

The next [shared mechanical repair candidate](repair-review.md) closes the cut boundaries and rebuilds ankle internals while preserving one common body across A/B/C. It remains a separate unapproved derivative.
