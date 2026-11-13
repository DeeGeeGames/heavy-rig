# Warden articulation trial 1

Status: diagnostic, not owner-approved or game-ready. This trial records why the next step is joint repair rather than another generation or polygon reduction.

## Inputs and reproduction

- A: `design/mechs/generated/tripo-warden-a-02/warden-a-multiview-balanced.glb` (13 meshes, 189,164 triangles).
- B: `design/mechs/generated/tripo-warden-b-01/warden-b-multiview-detailed.glb` (107 meshes, 189,050 triangles).
- B SHA-256: `c4b8771f6c31e81475b75dcef3bee57f38e4ec9d0949ac16d0983c9d31543763`.
- Blender 5.2.0 LTS. Source files were preserved unchanged. Generated files remain local and ignored; obtain the exact source before reproducing the trial on another machine.
- [Part map](articulation-draft.json) records all 107 B pieces, twelve assemblies, parents and estimated pivots. Coordinates are Blender Z-up, -Y-forward and +X toward the mech's own left; scale has not been normalized.
- Run `scripts/mech-design/blender/articulation_probe.py` in Blender's Python environment after defining `REPO_ROOT` as the absolute repository path. It verifies the source hash and complete unique assignment, creates a separate scene, renders diagnostic poses, and writes outputs under `design/mechs/generated/warden-articulation-v1/`. It refuses to overwrite an existing probe scene; use a fresh session for reproduction. Existing scenes are not modified.

## Evidence and findings

Both exports were inspected in neutral front three-quarter, rear, side and underside renders. They retain two cannons, the correct two shoulder modules (launcher A, energy B), substantial legs and visible arm connectors. Neutral silhouette inspection does not establish watertightness, clearance or useful joint ranges. The opposite side and all joints still need a complete bilateral review.

For B, the map preserves neutral world transforms to within 3.73e-9 source units. Probes rotate the waist 25 degrees, own-left ankle 20 degrees, knee 25 degrees, hip -20 degrees and gun -15 degrees, separately, then combine several rotations. These are diagnostic samples, not accepted animation limits. The weapon and waist renders demonstrate independent movement of the assigned assemblies; they do not establish clearance throughout a sweep.

The ankle probe exposes a visible opening above the foot. Knee and combined poses also expose unresolved coverage/linkage concerns. Pistons were grouped rigidly for this trial and do not extend or track both endpoints. These findings fail the articulation gate. Do not hide them through a favorable camera angle or treat greater segmentation count as a solution.

Outputs include `probe-neutral.png`, `probe-waist.png`, `probe-ankle.png`, `probe-knee.png`, `probe-hip.png`, `probe-weapon.png`, `probe-combined.png`, `probe-report.json`, `warden-b-probe.blend` and `warden-b-probe.glb`. Audit images use `a-*` and `b-*` names in the same folder. The final GLB was checked for exactly 107 meshes, 189,050 triangles and one scene, without the default Cube. It contains a rigid object hierarchy, not a skeleton or animation clips.

## Next repair and acceptance

The subsequent [modular assembly trial](modular-review.md) establishes a provisional shared body before repair. Apply these repairs once to that master and propagate them to all assemblies; do not repair independently generated A/B/C bodies.

1. Verify both ankle axes against the circular hinge centers. Separate misplaced details, then add concealed overlapping joint geometry where motion reveals empty space. Preserve the approved neutral silhouette.
2. Identify every piston crossing a moving boundary. Use separate endpoint tracking/telescoping parts or a documented simplified mechanism; do not attach the entire linkage to one limb segment.
3. Repeat positive and negative motion sweeps on both legs, waist and weapon pivots. Inspect gaps, intersections, detached armor and joint clearance from multiple angles. Record actual supported ranges.
4. Preview the repaired neutral and moving model for owner acceptance. Only then establish the shared chassis and interchangeable A/B/C shoulder modules, followed by polygon/material reduction and runtime validation.

## Process refinements learned

- Source part count and mechanical assembly count are different. Detailed segmentation permitted provisional grouping but still needs manual mechanical work; it is not yet a default recommendation.
- Bind part maps to an export hash. Provider names and part indices are not stable interfaces across generations.
- Restrict Blender GLB export to the active scene as well as selected objects. Selection alone initially included other scenes; the corrected export was independently inspected.
- Preserve neutral placement numerically and inspect motion visually. Passing one does not imply passing the other.
- This comparison uses different A/B generations, so it cannot isolate the effect of Balanced versus Detailed segmentation.
