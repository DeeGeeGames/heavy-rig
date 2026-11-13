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
asset set. No production optimization recipe is accepted yet.

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
