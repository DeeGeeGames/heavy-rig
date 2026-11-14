# Warden authoring recipes

Approved inputs live under `design/mechs/assets/warden/` in named production
steps. Run `git lfs pull`, then `python3 scripts/mech-design/verify-assets.py`.
Use Blender 5.2 in a fresh process. Work on candidate outputs under ignored
`design/mechs/generated/`; never write into an accepted checkpoint directly.

The retained chain is generated-source → modular-assembly → repaired-chassis →
articulation-base → guards → interfaces → motions/components. The articulation
base is an approved intermediate required to reproduce the guard repair; it is
not the current walking animation. Internal Blender scene names and historical
approval IDs retain their original identifiers so the accepted binary bytes stay
unchanged. Folder names describe steps, and Git records revisions.

For recipes using `REPO_ROOT`, set it to the checkout's absolute path before
executing the script in Blender. `OUTPUT_FOLDER` selects a new ignored candidate
folder for modular assembly, base gait, guards, interfaces and components.
Repair uses `repair-draft.json`: copy it to a temporary candidate manifest, set
status to `repair-candidate-unapproved`, choose a new output and supply its path
as `REPAIR_MANIFEST`. Approved sources and part-map hashes are checked first.

The current motions can be regenerated from the interface checkpoint:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/locomotion_trial.py -- \
  --repo "$PWD" --output walk-candidate --speed 4
```

Use `--profile suspended-run --speed 8` for the run and
`--profile backward-walk --speed 3` for backward. Use separate candidate folders.
Validate the exported GLB with `verify-walk.ts` against its generated report.
`render_locomotion.py` creates review views without changing the source file.

Only owner-approved results replace a named checkpoint. Refresh its approval
record and asset manifest in the same commit. Generated reports may retain
historical IDs; that does not make a rejected experiment part of the retained
asset set. The own-left pod is now an approved component optimization proof;
the complete Warden game derivative remains unfinished.

Component and firing-scale checks print results without modifying the input
checkpoint. Supply an optional second CLI argument for a new report path under
`design/mechs/generated/` when retaining validation output.

## Stage 6 candidate packaging and review

Use `package_locomotion.py` in a fresh Blender process to package a selected
approved motion without replacing its checkpoint:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/package_locomotion.py -- \
  --repo "$PWD" --motion run --output stage6-run-candidate
bun scripts/mech-design/verify-components.ts \
  design/mechs/generated/stage6-run-candidate
```

The motion choices are `walk`, `run`, and `backward`. The exporter records each
source clip's actual frame count, FPS and duration. The component verifier
checks A/B/C and empty **shoulder** cartridges against every source sample;
ballistic guns remain fitted in the empty-shoulder case. It checks evaluated
triangle counts and transforms, not material appearance or full vertex identity.

`audit_aim_clearance.py --repo PATH --motion run --output NEW_JSON` samples
weapon assemblies against the lower body over a full torso-local swivel at
nine gait phases and 5-degree increments. This is a mechanical clearance
experiment, not runtime aim acceptance: the runtime additionally stabilizes
weapon headings and independently converges each weapon in yaw and pitch.
Passing this audit alone does not close stage 6. Candidate reports and renders
belong under ignored `generated/`; accepted checkpoints require owner review.

For the complete retained stage 6 package, pass the frozen origin definitions:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/package_locomotion.py -- \
  --repo "$PWD" --motion walk --output stage6-walk-candidate \
  --origins "$PWD/design/mechs/assets/warden/components/physical-origins.json"
bun scripts/mech-design/verify-components.ts design/mechs/generated/stage6-walk-candidate
bun scripts/mech-design/verify-firing-origins.ts design/mechs/generated/stage6-walk-candidate
```

Repeat for run/backward. Both validators must pass together: component validation
checks identities/transforms and firing validation checks outgoing physical exit
center rays. `physical_exit_*` nodes are geometry-measured exits; `muzzle_*`
anchors remain historical logical bank origins. Physical tube count does not
set salvo size. The eight physical launcher exits still need mapping to the
current six-tube production rig during stage 8.

Render actual assembled GLBs with `render_variant_package.py --package PATH
--output NEW_DIRECTORY --phase 0.25` in fresh Blender. It renders A/B/C/empty
shoulders in neutral materials; appearance, performance and gameplay acceptance
remain separate. On this machine the executable is
`flatpak run org.blender.Blender`; use absolute script/input paths because its
working directory is inside the application sandbox.

### Measuring physical exits for the next chassis

Inspect the actual mesh and mark one seed center per barrel/emitter/tube. Supply
an explicit seed contract with the source path/hash, scene, parent, mesh list,
local center and search radius. Do not infer tube count from salvo size or use
whole-bank bounds as a physical muzzle. The Warden contract is
`design/mechs/chassis/warden/firing-origin-seeds.json`.

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/measure_firing_origins.py -- \
  --repo "$PWD" --seeds design/mechs/chassis/warden/firing-origin-seeds.json \
  --output "$PWD/design/mechs/generated/new-origins.json"
```

The portable measurement recipe currently assumes parent-local Z up and -Y
forward, explicit mesh geometry, and roughly circular front-facing lips. It
fits radial front-surface samples, reports residuals and uses a declared outward
offset. Inspect marker overlays before accepting measurements; non-circular or
angled emitters need a reviewed measurement method instead of forcing this fit.
Use the measured definitions with packaging, then validate actual GLBs. The
Warden seed recipe reproduced all twenty frozen local positions exactly.

## Stage 7 component optimization and handoff

Read [the optimization procedure](../../../design/mechs/game-optimization.md)
before extending this work. The selected pod is recorded in
`design/mechs/chassis/warden/approved-pod-optimization.json`; its exact export is
`design/mechs/assets/warden/optimization/pod/pod.glb`. The GLB remains byte-for-byte
the owner-reviewed 922-triangle proof. The packed `pod.blend` includes its low
meshes and four required high-detail/bake references. Its reconstructed cup
reference is a dependency of the chosen bake, not another selected model.

The retained source GLB, report, validation and review images allow inspection
without rerunning Blender. From the repository root, after `git lfs pull`,
`python3 scripts/mech-design/verify-assets.py` and `bun install --frozen-lockfile`:

```sh
mkdir -p design/mechs/generated
bun scripts/mech-design/optimization-review.ts \
  --source design/mechs/assets/warden/optimization/pod/source.glb \
  --candidate design/mechs/assets/warden/optimization/pod/pod.glb \
  --renders design/mechs/assets/warden/optimization/pod/review \
  --output design/mechs/generated/pod-review.html \
  --source-label "Accepted source" --candidate-label "Approved pod proof"
```

The output is a self-contained HTML file: open it directly or use the HTML
preview tool, without starting a server. The builder refuses existing output files, paths outside
that directory, external GLB resources and decoder-dependent compression. Use
an uncompressed review GLB. The `render-report.json` must match both GLB hashes
and every PNG hash and describe a textured pass, so stale images cannot silently
accompany a different candidate. It counts actual default-scene mesh instances and
provides wireframe, neutral geometry, both sides, underside and native-size
camera estimates. It does not measure runtime frame time.

To verify the retained export in a fresh Blender 5.2 process:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/verify_optimized_pod.py -- \
  --repo "$PWD" --output design/mechs/generated/pod-validation.json
```

The verifier compares against the checksummed source GLB. It checks nine exact
anchor matrices, 40 outward clearance samples, the source mounting-aperture
boundary, 90 underside coverage samples, finite positions, normals and triangle
areas. These are Warden pod contracts, not generic sample locations for every
component. The flat visual launcher face must not become a projectile collision
mesh. Straight samples do not establish full aim arcs or projectile-volume
clearance.

To reproduce a new candidate from the retained packed authoring checkpoint:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/build_warden_pod.py -- \
  --repo "$PWD" --output design/mechs/generated/pod-rebuild
python3 scripts/mech-design/package-optimized-glb.py \
  --repo "$PWD" --input design/mechs/generated/pod-rebuild/pod-raw.glb \
  --output design/mechs/generated/pod-rebuild/pod.glb
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/verify_optimized_pod.py -- \
  --repo "$PWD" --candidate design/mechs/generated/pod-rebuild/pod.glb \
  --output design/mechs/generated/pod-rebuild/validation.json
```

The packager invokes pinned glTF Transform CLI 4.5.1 through Bun, requiring a
network download on its first use. It deduplicates, prunes with `--keep-leaves
true` to preserve anchors, and runs glTF validation. Inspect the adjacent
`.gltf.log`; empty-anchor informational messages are expected. Output paths must
be fresh and inside `generated/`, and neither the build nor packaging overwrites
the retained checkpoint.

This reproduces the component from its authoring checkpoint and retained bake
references, not every historical operation from raw Tripo output. The section
coordinates, opening classifier and vent masks in the worked recipe are
Warden-specific. Rebaking/exporting may change binary hashes; verify the actual
output and review it before promotion. The approved artifact hash remains the
one in the approval record.

### Approved own-right pod

The owner-approved own-right package is under
`design/mechs/assets/warden/optimization/right-pod/`, with approval in
`approved-right-pod-optimization.json`. Its exact GLB has 914 triangles. The
packed checkpoint contains the right housing, collar, original launcher bake
reference and an already-fitted reconstructed cup reference. No generated
scratch inputs or repeated left-to-right fitting are needed.

Verify the retained export, rebuild a separate candidate, then package/verify:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/verify_optimized_pod.py -- \
  --repo "$PWD" --side right --output design/mechs/generated/right-pod-validation.json
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/build_warden_right_pod.py -- \
  --repo "$PWD" --output design/mechs/generated/right-pod-rebuild
python3 scripts/mech-design/package-optimized-glb.py \
  --repo "$PWD" --input design/mechs/generated/right-pod-rebuild/pod-raw.glb \
  --output design/mechs/generated/right-pod-rebuild/pod.glb
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/verify_optimized_pod.py -- \
  --repo "$PWD" --side right \
  --candidate design/mechs/generated/right-pod-rebuild/pod.glb \
  --output design/mechs/generated/right-pod-rebuild/validation.json
```

Without `--side`, the verifier keeps its own-left default. Both sides check the
actual source aperture and surrounding coverage; the right boundary has 86
edges, versus 94 left. Both preserve nine anchors and check 40 outward samples.
Use the comparison builder with the right package's `source.glb`, `pod.glb`
and `review/` directory. `review/geometry/` retains its matched geometry-only
views. Existing renderer commands accept the right paths unchanged.

Front rim bevels use geometric shading; outer-rim fasteners and surface marks
transfer selectively. Launcher circles bake from reconstructed cups and lack
physical depth. The render face is not a projectile collision mesh. These
isolated approvals do not complete whole-model stage 7 or runtime acceptance.

Generate fresh matching evidence using the **own-left example** below. For the
right pod, substitute `optimization/right-pod/` and the `right-pod-rebuild`
candidate paths (and choose a fresh render output):

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/render_optimization_proof.py -- \
  --repo "$PWD" \
  --source design/mechs/assets/warden/optimization/pod/source.glb \
  --candidate design/mechs/generated/pod-rebuild/pod.glb \
  --camera-scale design/mechs/assets/warden/optimization/pod/camera-scale.json \
  --target 0 0.055 0 --span 0.43 \
  --output design/mechs/generated/pod-rebuild-renders
```

Use that render directory and candidate with the HTML builder above, choosing a
new HTML output. Add `--geometry-only` and a different output directory for a
neutral geometry render pass. The renderer writes input/PNG hashes, camera values
and material-mode evidence to `render-report.json`. It accepts other components;
omit `--target`/`--span` to frame from source bounds and supply the appropriate
camera-scale contract. The retained Warden scale is a height-matched estimate
for a 1280×720 production camera, not an approved integration scale.

On this machine, substitute `flatpak run org.blender.Blender` for `blender` and
pass absolute script paths (`"$PWD/scripts/..."`). The `--repo "$PWD"` argument
resolves assets independently of Flatpak's working directory.

The next actor should follow
[Resume the remaining Warden work](../../../design/mechs/game-optimization.md#resume-the-remaining-warden-work).
Start with the remaining component cost/feature inventory, preserve shared
ownership and stage 6 motion/aim contracts, and keep PR 67 in draft. This handoff
does not replace runtime models or close full-model stage 7, stage 8 or stage 9.

### Remaining component inventory

The [Warden component plan](../../../design/mechs/chassis/warden/optimization-plan.md)
records the measured source costs and priority order. Reproduce the inventory
without opening Blender or modifying assets:

```sh
python3 scripts/mech-design/inventory-warden-components.py \
  --repo "$PWD" --output design/mechs/generated/stage7-inventory.json
```

The output must be fresh and under ignored `generated/`. The command verifies
the hashes of all 21 stage 6 GLBs and compares chassis geometry fingerprints and
parent ownership across all three motions. It counts actual default-scene mesh
instances/sections and indexed triangles at the sole exported LOD, lists module
and equipped-configuration costs, and separates vertex/index bytes from encoded
file payload. Identical assigned material definitions are counted separately
from the material objects in standalone files. It does not measure runtime
performance, validate motion matrices, or approve new geometry.
