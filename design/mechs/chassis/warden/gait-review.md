# Warden gait trial 1

Historical revision. The owner accepted the leg-motion direction but requested moving hips and upper body to remove the floating appearance. See [gait trial 2](gait-v2-review.md); the current generator now produces v2, while these v1 artifacts remain preserved.

Status: **motion preview, not approved**. The owner approved the repaired shared visual master; this walking cycle and final motion limits are separate acceptance steps. [shared-master.json](shared-master.json) freezes the exact approved source artifacts. The trial preserves mesh vertex positions and topology; no production game assets were changed.

## Motion and export

`scripts/mech-design/blender/gait_trial.py` loads the approved Blender source after checking its hash, solves a two-link leg in the sagittal plane, and compensates at the ankle to keep each foot level. Stance targets remain fixed in world space while the pelvis travels forward. Swing targets use a smooth return curve and a small lift. The trial uses 60% stance, a 1.5-second cycle, 0.08 source units of stance travel and 0.022 source units of swing lift.

The clip travels 0.133333 source units forward per cycle. Blender forward is -Y; exported glTF forward is +Z. This is **root motion**, not a runtime-controlled in-place animation. A game must handle root displacement/looping explicitly; simply restarting the clip will reset its world translation. There is no turning, terrain adaptation or combat-aim acceptance yet.

Piston constraints are sampled and baked at 60 Hz into local transforms before export. Unlike the earlier neutral review GLBs, `warden-b-walk.glb` contains one actual 1.5-second animation with the actuator motion included. B exercises the common body; it does not introduce a separate B chassis master.

## Validation

- All approved mesh coordinates/topology remain unchanged through the trial.
- The Blender solve checked 91 samples including both endpoints. Maximum stance drift was approximately 8.2e-8 source units; feet stayed level.
- `scripts/mech-design/verify-walk.ts` loads the exported GLB into Three.js without a renderer, plays the actual clip, and checks foot positions/tilt plus actuator attachment, direction and overlap against the source samples. Exported ankle error was approximately 6.9e-8 source units. Minimum actuator overlap was approximately 0.0304 source units.
- This cross-tool check caught a one-frame time offset in the first export. `export_anim_slide_to_zero=True` fixes the time origin; do not compensate by weakening the verification tolerance.
- These are sampled numerical checks, not hardware performance measurements, collision approval, or proof of zero interpolation error between samples.

Observed local joint excursions, relative to the approved neutral pose:

| Joint | Minimum | Maximum |
| --- | ---: | ---: |
| Hip pitch | -8.22° | +5.48° |
| Knee pitch | -4.42° | +12.08° |
| Ankle pitch | -8.37° | +8.24° |

These values describe this walk, **not final safe joint limits**.

## Clearance findings

`scripts/mech-design/blender/clearance_audit.py` compares 19 sampled poses with neutral for six adjacent pelvis/leg assembly pairs. It reports BVH overlap candidates outside a 0.07-source-unit hinge neighborhood. It does not establish volume penetration or distinguish intentional nesting automatically. Joint-internal overlaps, such as axle housings, can still appear in the results.

The largest increase was 340 new triangle-pair candidates around the right shin/foot at frame 46. Examples involve the rear ankle shell (source part 29), foot pieces 12/33, and the added axle. The neutral source already has overlap candidates. A focused render shows substantial internal nesting; counts alone cannot justify trimming approved exterior armor or declaring collision-free motion. The left ankle also requires boundary review.

The next mechanical task is to classify these pairs, refine ownership of armor spanning a joint, and inspect the resulting clearance throughout the walk. If hidden surfaces need splitting/reassignment, preserve the approved silhouette and record the derivative. Any visible reshaping needs a new visual preview. **The clearance gate remains open.**

## Reproduce and inspect

With the approved local `.blend` available, set `REPO_ROOT` in Blender and execute `scripts/mech-design/blender/gait_trial.py` in a fresh session. It refuses object-name collisions or an existing trial report. Create a new revision rather than overwriting reviewed output. Then run the clearance audit against its loaded scene.

```sh
bun scripts/mech-design/verify-walk.ts design/mechs/generated/warden-gait-v1/warden-b-walk.glb design/mechs/generated/warden-gait-v1/gait-report.json
```

Ignored local outputs in `design/mechs/generated/warden-gait-v1/`: `warden-walk.blend`, `warden-b-walk.glb`, `gait-report.json`, `three-verification.json`, `clearance-report.json`, rendered frame PNGs and `walk.gif`. The floor/grid are preview aids and are excluded from exported model assets. The camera follows the moving body; grid lines help show the planted contacts. Regenerate the GIF with:

```sh
ffmpeg -y -framerate 20 -i design/mechs/generated/warden-gait-v1/walk-%03d.png -vf 'split[a][b];[a]palettegen[p];[b][p]paletteuse' design/mechs/generated/warden-gait-v1/walk.gif
```

Clearance resolution and motion approval precede component packaging, muzzle/empty-mount completion, optimization and in-game integration. Approval of the visual master does not automatically approve this walk.
