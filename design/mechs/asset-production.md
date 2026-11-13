# Mech asset production

## Stages and acceptance

1. **Concept:** validate current gameplay mounts, approve a 3/4 baseline, retain prompt, request and image hashes.
2. **Turnaround:** derive and approve front/back/own-left/own-right views. Review physical connections and shared proportions. Reuse unchanged projections for variants when their changed inserts are fully hidden. Store exact view provenance.
3. **Generated source:** upload the approved set; record provider/model, settings, credit cost, source hashes, job URL and export hash. Preserve the raw export unchanged. Public model uploads are permitted. Record failures separately from visual rejection.
4. **Structural audit:** inspect front/rear/both sides and underside; verify weapon families/counts, connectors, leg bulk, missing surfaces and joint boundaries. Inventory actual meshes, triangles, materials, textures, transforms and animation data. Identify repair work explicitly.
5. **Articulation prototype:** work on a derivative. Assign every source piece to a named rigid assembly; separate remaining fused joints before acceptance. Set hip/knee/ankle/waist and weapon pivots, preserve neutral world placement and retain source-part provenance. Sweep one joint at a time, then test a combined pose. Check gaps, collisions, detached armor and unintended movement. A diagnostic hierarchy with estimated pivots is not a validated rig.
6. **Variant assembly:** use the same shared chassis geometry for every variant. Establish module boundaries before repairing multiple generated bodies. Keep existing pod housings and supports shared where possible; replace front cartridges or weapon assemblies at explicit interfaces. Separately generated variants are references or module donors, not alternate chassis masters. Test replacement, empty mounts and muzzle alignment. See the mandatory [modular consistency rules](#modular-consistency-rules).
7. **Game derivative:** simplify the accepted structure, consolidate materials, bake/recreate detail as needed, normalize units/orientation and export GLB. Preserve source and intermediate assets. A 10–20k-triangle first candidate is an experiment, not an accepted universal budget. Establish budgets using actual camera distance and representative on-screen crowds.
8. **In-game acceptance:** validate independent torso aim, gait, muzzle origins, equipped/empty variants, lighting and silhouette in the real runtime. Report measured performance separately from owner acceptance. Do not replace production models until the agreed preview gate passes.
9. **Repeatability:** run the documented procedure on another chassis before calling it general. Record special cases, repair steps and automation gaps; revise this document and the skill as evidence changes.

## Checkpoints and storage

Keep one approved advancing result per named step. Concepts and turnarounds live
under `chassis/<id>/concept/` and `chassis/<id>/turnaround/`. Required 3D source
inputs and accepted intermediate checkpoints live under `assets/<id>/`.
Blender and GLB files use Git LFS; manifests, recipes and approval records use
ordinary Git. Candidates and generated previews stay ignored under `generated/`.
Use Git history for previous accepted states rather than retaining v1/v2/v3
folders. A necessary donor or intermediate remains even if it is not itself the
final production model. Never overwrite the raw provider inputs.

Run `git lfs pull` and `python3 scripts/mech-design/verify-assets.py` after cloning.
The [asset manifest](assets/manifest.json) records exact paths, sizes and hashes.
See [checkpoint roles](assets/README.md) and
[authoring commands](../../scripts/mech-design/blender/README.md).

## Current Warden acceptance

Stages 1–4 have approved references, original generated inputs, a source-part
map and repaired shared chassis. Stage 5 is accepted for the reviewed motion
envelope: current walk, suspended run and dedicated backward gait. The owner
accepted the visible geometry with remaining fine-tuning deferred. Preserve the
original large axles, unsplit exterior and shin-owned front guards. This does
not establish exhaustive joint limits or zero mesh intersections.

Stage 6 is complete for the usable draft pass, recorded in
`chassis/warden/approved-stage6.json`. A/B/C and empty-shoulder configurations
use the shared chassis and interchangeable cartridges with all three current
motions. Twenty geometry-measured physical exit definitions are retained;
9,975 center-ray checks across the actual GLB assemblies pass. Empty shoulders
retain the two ballistic guns. Logical bank anchors are preserved separately.

The owner accepted the demonstrated run/swivel gun-detail-to-leg contact and
independent gun-aim contacts as-is. These are recorded draft limitations, not
claims of collision-free or exhaustive aiming. The process goal is a usable
full-roster result with polish allowed later; this step addresses Warden only.
Physical launcher cartridges have eight exits each, while current production
rigs use six. Resolve that mapping during runtime integration without silently
changing gameplay salvo size.
Stage 7 has no accepted optimized derivative. Previous reduction/baking trials
were rejected and are excluded from this deliverable. Establish a measured
budget, preserve silhouette/openings, consolidate materials and normalize common
scale/orientation. The owner's MW5 Atlas/Stalker reference counts still need
verification of triangle/polygon, LOD and equipment context.

Stages 8 and 9 remain outstanding: runtime combat/aim/movement integration and
performance acceptance, then exercising the complete workflow on another
chassis. Kestrel and Maul currently have approved concepts only. No production
game assets are replaced by these authoring checkpoints.

## Reproduction and acceptance

Retain named checkpoint hashes separately from candidate reports. Reports can
retain their historical trial IDs and measurements; acceptance lives in the
approval records. Derive into a fresh ignored candidate directory, verify its
export, obtain review, then replace the corresponding accepted step and refresh
all dependent hashes in one commit.

The retained checkpoint chain lets a fresh worker resume at any saved step.
Re-running every historical Blender transformation from raw generation is a
separate validation claim; file restoration alone does not prove it. Original
provider outputs are kept because external generation cannot be assumed to
produce the same mesh again.

Check actual GLBs in Three.js as well as Blender. Verify planted contacts, ankle
pitch, body/guard transforms, actuator endpoints/stroke and signed root travel.
Transforms alone do not validate material appearance or geometry. Apply evaluated
modifiers when exporting components; compare evaluated triangle counts so bevels
cannot silently disappear. Straight firing rays do not establish full aim arcs,
projectile clearance or per-tube origins.

## Modular consistency rules

The default after a usable 3D chassis exists is **assemble variants, do not regenerate complete mechs**. A new concept may still need a full baseline generation. Before that chassis exists, image edits remain concept exploration, not proof of identical geometry.

1. Select one provisional chassis master, record its source hash and approval state, and repair its shared anatomy once. Establish module boundaries early; do not independently repair A/B/C bodies. Promote the master only after its own visual/articulation approval.
2. Reuse the exact geometry, materials and rig of feet, legs, pelvis, torso, cockpit and unchanged armor. Reuse pod shells, supports and arm weapons when the contract permits. Prefer linked objects/data during authoring and shared asset references at runtime. Standalone review GLBs may duplicate bytes without becoming independent masters.
3. Define each interface by stable socket ID, parent assembly, local coordinate convention, attachment transform, permitted dimensions/clearance, supported module family, and muzzle anchors. Map sockets to current gameplay hardpoint IDs; these may differ between variants. A socket is not a muzzle. A final module must fit the interface without changing the body.
4. Extract useful modules from existing sources first. If a module is missing, generate isolated component views against the master socket/housing dimensions; approve the component views before generation. Model or repair simple mechanical adapters directly when suitable. A generated component still needs fitting and inspection.
5. Preserve shells by replacing the smallest practical weapon cartridge. Complete housings may differ only where weapon dimensions or an approved structural exception require it. Record such exceptions rather than silently allowing chassis drift.
6. Assemble every variant from the same master revision and versioned modules. Validate the live gameplay mount contract, module family, own-left/right placement, muzzle position, clearance and empty-mount treatment. Generate front/rear/left/right and approval renders from this assembled geometry; do not ask an image model to redraw the unchanged chassis.
7. Verify shared mesh geometry, transforms and rig bindings are identical across variants, preferably by machine-readable fingerprints. Check actual exports as well as the DCC scene. Shared chassis changes invalidate affected variant approvals; module-only changes require review of affected variants and interaction checks, not regeneration of the body.
8. Optimize the accepted shared body and each module once, with compatible materials and LOD interfaces. Separately purchasable gameplay rigs can reference the same body assets. No game/save-system changes are implied by this authoring policy.

## Definition of done

A fresh worker can restore approved inputs, reproduce documented transformations,
inspect acceptance evidence and identify remaining manual work without reading
chat history. At least one mech must reach a reviewed in-game derivative, and
another chassis must exercise the procedure before calling it broadly validated.
