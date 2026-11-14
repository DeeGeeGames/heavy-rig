# Warden shared mechanical repair candidate 1

Status: **owner-approved shared visual master for rigging**. The owner explicitly said “Approved” after this repair review and the next-step discussion. Exact accepted artifact hashes are recorded in [shared-master.json](shared-master.json); generated reports retain their original pre-approval status as historical evidence. This is the next derivative of the modular trial, not a production model replacement. Source exports, the modular library and prior pose evidence remain unchanged.

## Changes made once to the shared master

- Closed the six cartridge/housing cut boundaries. Some cut edges joined existing segmentation holes, so the repair follows the connected boundary loop rather than attempting to cap only edges on the cut plane. All six report zero remaining boundary edges on that plane. This is a local interface check, not proof that every generated surface is watertight.
- Added a small shared overlap collar inside each cartridge interface. This supplies backing where donor and master contours differ; it does not weld the removable parts together.
- Added enclosed ankle axles behind the existing armor.
- Replaced narrow front and rear ankle-piston interiors with simple barrel/rod assemblies on both legs. The extraction preserves surrounding armor where possible, but changes generated geometry inside the recorded repair volumes. The original segmented parts were often incomplete surface fragments, not usable mechanical components.
- Moved the two front lower actuator mounts (source parts 99 and 96) from shin to foot ownership. Endpoints now attach to the two assemblies they connect.
- Added Blender tracking constraints: each barrel follows its shin endpoint and aims at the foot endpoint; the rod follows the foot and aims at the shin. Fixed lengths maintain telescoping overlap. The saved Blender scene responds to joint movement without rerunning a manual position script.

Feet, body, repaired mechanisms, cannons, pod supports and rear housings remain shared across A/B/C. Each variant swaps only its front weapon cartridges. The common body is now 117 meshes, including twelve added collar/axle/piston meshes. This count is an authoring diagnostic, not a draw-call budget.

## Evidence and limits

The script renders neutral, both signs of ankle/knee/hip motion on both legs, both signs of waist motion and a combined pose: sixteen samples. Ankle samples use ±20°, knees ±25°, hips ±20° and waist ±25°. It additionally samples each leg joint at 5° intervals (58 states), verifies piston endpoints and tracking direction, and rejects insufficient stroke/overlap. These are diagnostic samples, **not approved motion limits or collision-free gait**.

The ankle detail views show enclosed internal volume and continuous actuator attachment through the sampled movement. Front and rear mechanisms were inspected. Whole-body samples retain the intended silhouette, but hip/knee surfaces and armor clearances still need a production rig review. Foot planting, collision testing and motion against terrain remain unimplemented.

All 117 shared exported meshes are checked across A/B/C for matching geometry attributes, topology, transforms and immediate parent names. Standalone review GLBs contain A 119 meshes / 192,883 triangles, B 121 / 190,240, and C 120 / 191,504. Each contains one scene and only the intended shared body plus two cartridges. These counts are prior to optimization.

**Blender constraints do not transfer as live mechanisms in these GLBs.** The GLBs are neutral review snapshots. Runtime integration needs corresponding endpoint tracking or baked animation, plus supported joint limits and muzzle/socket contracts. Do not label the snapshots animated or game-ready.

## Reproduce and inspect

[repair-draft.json](repair-draft.json) records the exact modular `.blend` hash, source-part map/hash and output directory. With those local sources available, set `REPO_ROOT` in Blender's Python environment and execute `scripts/mech-design/blender/repair_shared_chassis.py`. The script verifies inputs, copies meshes into its own candidate scene, renders checks, verifies the exported variants and saves a separate library. It restores the previously active scene. This approved recipe is now frozen: the script refuses to overwrite it. To derive or reproduce a candidate, copy the recipe to a new manifest, set its status to `repair-candidate-unapproved`, choose a new output directory and pass its repository-relative path as `REPAIR_MANIFEST`. Use a fresh session.

Retained checkpoint outputs under `design/mechs/assets/warden/repaired-chassis/` include:

- `warden-repair.blend`: editable candidate with shared geometry, hierarchy and live actuator constraints. It contains both cartridge families; B is visible initially.
- `warden-repair.glb`, `warden-b-repair.glb`, `warden-c-repair.glb`: neutral review exports.
- `repair-report.json`: caps, changed source pieces, sampled poses/strokes and export verification.
- Neutral, individual joint and combined-pose PNGs; ankle details include front/rear angles.

Changing the modular source or part map requires reviewing the repair recipe and explicitly updating the input hashes. Required source/intermediate files are retained through Git LFS; restore and verify the asset manifest before deriving a candidate.

## Next gate

The repaired neutral shape and joint details are accepted as the shared visual master. Next complete final joint limits/clearances, socket-local component packaging, muzzle anchors and empty-mount treatment. Optimize the accepted body/modules once, derive final approval views from the assembled geometry, and test the result in the actual game. No additional whole-mech generation is needed for A/B/C.
