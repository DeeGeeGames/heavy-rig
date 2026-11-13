# Warden gait trial 2: weight transfer

Status: **owner-approved visual walking motion; clearance and mechanical hinge limits remain pending**. The owner explicitly said “Approved” after viewing v2. Exact accepted artifact hashes are recorded in [approved-motion.json](approved-motion.json). Generated reports retain their original pre-approval status as historical evidence. Owner feedback on v1: the legs look good, but the stationary hips and upper body make the mech appear to float. This revision addresses that feedback without changing the approved mesh geometry or the foot-target paths. V1 artifacts remain preserved.

## Motion changes

The pelvis shifts toward the support side, rises through the step and settles at footfall, and adds small alternating roll/yaw with restrained pitch. Torso counter-rotation trails the hips slightly, keeping the weapon platform steadier while allowing the body to respond to the steps. These are presentation offsets for this authored walk, not changes to the game's independent aim controls.

The stance/swing timing, forward travel, lift and world-space foot targets are unchanged. A three-dimensional two-link solve replaces the earlier planar solve so moving/rotating hips can reach the same contacts. The ankle cancels the shin's world rotation to keep the foot level and its heading fixed. Joint angles necessarily adjust to accommodate the moving pelvis; the leg meshes and lengths do not change.

Configured amplitudes: ±0.016 source units of lateral pelvis transfer, ±0.007 vertical motion, up to 2° of pelvis roll/yaw, and smaller delayed torso counter-rotation. The cycle remains 1.5 seconds with 0.133333 source units of forward root travel. This remains a root-motion clip requiring explicit runtime handling.

## Validation

- Approved mesh coordinate/topology fingerprint matches v1 exactly: `e45c8f349d2ec8517de4b973ad7624deaba2a787f35fa11f43f776a12c22bb3e`.
- Blender checked all 91 samples: maximum stance drift ≈7.6e-8 source units; maximum foot-target error ≈8.0e-8.
- The Three.js verifier checks the actual exported clip's feet, actuator endpoints/directions/overlap, **and pelvis/torso world matrices** against source samples. It also rejects loss of the intended pelvis travel.
- Exported ankle error ≈1.1e-7 source units; body matrix error ≈8.9e-8; minimum actuator overlap ≈0.0318 source units. Measured pelvis travel is ≈0.032 lateral and ≈0.014 vertical.
- Contact and actuator checks remain sampled checks; they do not establish collision-free movement or final safe joint limits.

The 3D solve also introduces small local lateral/twist rotations: up to approximately 3.80° at the hips, 2.91° at the knees and 2.98° at the ankles. Reports retain `jointRangesDegrees` as pitch-only and add all three axes in `jointRangesXYZDegrees`. Compatibility with single-axis mechanical hinges is not yet validated; this remains part of the rig/clearance review.

The clearance audit now resets quaternion joints correctly and includes the waist pair. It reports 133 pose/pair samples, with a maximum of 348 new overlap candidates versus neutral and 212 at the waist. These are BVH candidates, including internal nesting, not confirmed collision counts. The changed body motion requires renewed waist/hip/ankle clearance review; the prior clearance gate remains open.

## Reproduce and review

The current `scripts/mech-design/blender/gait_trial.py` produces `design/mechs/generated/warden-gait-v2/` from the same hash-verified approved master. It refuses existing output reports or conflicting scene objects. Use a fresh session and a new output revision for further tuning. `clearance_audit.py` defaults to v2; set `GAIT_REVISION='v1'` when inspecting the historical v1 scene.

```sh
bun scripts/mech-design/verify-walk.ts design/mechs/generated/warden-gait-v2/warden-b-walk.glb design/mechs/generated/warden-gait-v2/gait-report.json
```

Outputs include `warden-walk.blend`, `warden-b-walk.glb`, source/Three.js/clearance JSON reports, frames and `walk.gif`. The source master and v1 outputs are unchanged. The comparison preview uses the same camera, cadence and ground reference. Visual motion is now accepted alongside the shared visual master. Clearance and mechanical hinge validation remain separate open checks; the approval does not establish production readiness.

The subsequent [clearance investigation](clearance-review.md) narrows the surface candidates and tests a shell-ownership change. That diagnostic derivative is not accepted; clearance remains open.
