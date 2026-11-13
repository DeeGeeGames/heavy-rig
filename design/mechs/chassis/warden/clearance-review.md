# Warden clearance investigation 3

Current direction: **retain unsplit front and rear ankle guards**, per the owner's explicit decision. V4/V5 split treatments are superseded; their historical evidence remains below. Continue from the approved shared master and v2 walk, preserving their exterior. Mechanical clearance remains unresolved.

The surface audit narrows BVH candidates using segment/triangle intersection checks, excluding coplanar contact and intersections inside the existing hinge neighborhood. This finds surface crossings, not penetration depth or solid-volume collisions. It does not automatically distinguish intentional internal nesting from unacceptable armor interference.

Run `scripts/mech-design/blender/surface_clearance_audit.py` after loading the approved v2 walk in a fresh Blender session with `REPO_ROOT` set. Local outputs are under `design/mechs/generated/warden-clearance-v3/`. The audit covers waist and six adjacent leg pairs at nineteen frames. Source files remain untouched.

The right rear ankle shell, source part 29, crosses foot pieces 12, 33, 35 and 66 during the approved walk. The added axle also intersects several foot surfaces; these need explicit internal-envelope review, not blanket exclusion. The left ankle and waist retain crossings too.

A diagnostic derivative reparents the entire right shell to the foot while preserving its neutral placement. Reproduction: parent `repair_shared_tripo_part_29` to `rig_leg_right_foot`, set parent inverse to identity, and set its local matrix to translation `(0.22, -0.035, -0.095)` in the existing Blender coordinates. This changes ownership only; mesh vertices/topology remain unchanged. The derivative is saved as `ownership-candidate.blend` and is not approved.

Across nineteen samples, new right shin/foot triangle-pair occurrences decrease from 5,208 to 4,670, approximately 10%. These are repeated occurrences across samples, not unique collision counts. Other pairs are unchanged. Whole-part reassignment therefore does not resolve clearance and is not promoted to the master. The shell spans more than one mechanical region; this motivated the split experiments below, which the owner subsequently superseded in favor of the unsplit appearance. Further repairs must preserve that exterior.

The approved 3D leg solve also requires lateral/twist motion at knees/ankles. Single-axis hinge compatibility remains unvalidated. Resolve the articulation model and joint ownership before treating observed animation excursions as safe limits. Preserve the approved visible motion where possible; any changed appearance or motion needs another preview.

Evidence: `before.json`, `surface-crossings.json`, `ownership-comparison.json`, and `ownership-candidate.blend` in the local output directory. These results do not authorize optimization or production integration yet.

## Split-guard candidate 4 — superseded

`scripts/mech-design/blender/split_ankle_guard.py` derives a candidate from the hash-verified approved walk. Part 29 is split at neutral Z=0.133/0.137: the lower guard follows the foot, while the upper section remains attached to the shin. The resulting 0.004-source-unit relief seam is a visible change and needs owner review. Caps close the cut boundaries. Approved source files remain unchanged.

The repeated right-ankle crossing total is 4,670 over nineteen samples, equal to the whole-part ownership trial and below the original 5,208. This does not establish cleared joints. Other ankle/waist crossings and hinge-axis compatibility remain open. Candidate/evidence files are local under `generated/warden-clearance-v4/`, including `split-candidate.blend`, matched before/after GIFs and the surface audit. Pause this derivative at visual review before propagating its seam treatment.

## Bilateral side-guard candidate 5 — superseded

Owner approved the v4 rear-guard appearance; hashes are in `approved-guard.json`. Candidate v5 extends the same cut planes to side guards 85/88 and 53/100 as well as rear guard 29. It preserves approved source files and animation but creates a more visible break across the side armor of both ankles. This broader appearance is pending visual review.

The new cut/cap topology changes the triangle-pair population. Repeated crossing counts are 5,668 left and 5,711 right; this is not evidence of clearance improvement. The derivative is not promoted. The results show that a common horizontal split is not sufficient to certify mechanical clearance; subsequent work must assess the swept mating surfaces and internal housings. Candidate files and report remain local under `generated/warden-clearance-v5/`.

## Unsplit trials 6–8

V6/V7 attempted internal cylindrical cavities in the foot pieces. The enlarged swept cavity visibly removed exterior material, so these attempts are rejected and not promoted. Approved sources remain untouched.

V8 starts again from the approved unsplit v2 walk and changes only the two added axle cylinders, reducing radius from 0.046 to 0.032 and length from 0.135 to 0.09 source units. Every original foot/guard mesh and all animation channels remain unchanged. The smaller core is visible through joint gaps and is pending owner visual review.

With the same axle topology and audit sampling, repeated new crossing occurrences fall from 3,727 to 2,139 on the left and 5,208 to 3,803 on the right. This supports reducing the internal axle envelope but does not clear other armor/waist intersections or validate hinge axes. Script: `scripts/mech-design/blender/compact_axle_trial.py`; local evidence: `generated/warden-clearance-v8/`. The candidate Blender file retains the generic trial filename `cavity-candidate.blend`, but v8 performs no cavity cuts.

## Retained axle and rigid front guards — candidate 9

Owner chose the previously approved larger axle and requested the front guard be rejoined, preferring coherent armor movement to freely moving upper pieces even if some intersections remain. V8 is superseded. V9 starts from the approved unsplit v2 model: original mesh data, axle dimensions and animation are retained. Parts 53/100 on the left and 88/85 on the right now share the foot/front-guard rigid transform. This is a hierarchy change, not a mesh weld or a new seam.

All four attachments were checked through 91 frames for a constant transform relative to the foot. Matched before/after motion and `guard-candidate.blend` are in `generated/warden-guard-v9/`. The resulting motion is pending visual review. Intersection elimination is not claimed, and the earlier crossing-count experiments should not override the owner's chosen appearance and motion priority.

## Corrected front-guard ownership — candidate 10

Owner clarified that the lower guard should join the shin, not that the upper pieces should join the foot. V9 is superseded. V10 starts from the approved v2 source: upper guard pieces retain their original shin ownership; lower front plates 51 (left) and 44 (right) are attached to the respective shin with neutral placement preserved. Feet articulate independently below the guard. Original larger axles, mesh data and walking channels are retained. All six front-guard pieces were checked through 91 frames for constant shin-relative placement. Matched previews and `guard-candidate.blend` are in `generated/warden-guard-v10/`; the owner subsequently explicitly approved this corrected shin-owned guard motion. Exact accepted hashes are in `approved-front-guard.json`.
