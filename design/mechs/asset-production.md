# Mech asset production

This is the evolving production procedure. Keep observations separate from defaults: a successful generator job, high part count or exported GLB does not establish a usable game asset.

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

## Source and derivative conventions

Keep approved reference art in `chassis/<id>/drafts/`. Keep large experimental exports, audit renders and `.blend` files in ignored `generated/` until an asset-storage policy is selected. Record durable findings and reusable scripts in version control. Never overwrite a provider export. A derivative manifest should identify source hashes, axis/scale conventions, source-part-to-assembly mapping, pivot coordinates, repair operations, unresolved findings and acceptance state. Unknown or unassigned pieces must fail review rather than silently disappear.

Suggested rigid names: `pelvis`, `torso`, `leg_left_thigh`, `leg_left_shin`, `leg_left_foot` (and right counterparts), `mount_<gameplay-id>`, plus explicit muzzle anchors. Read actual mount IDs from the generated gameplay contract. Choose the hierarchy from intended motion, not arbitrary provider mesh names. Parent stationary armor to its moving assembly; avoid permanent welding until boundaries are verified. Pistons spanning joints may need independent linkage handling rather than rigid attachment to one segment.

## Current Warden evidence

- Single-view A: exported 12 meshes, 192,430 triangles; feet remain fused with shins and arm connection concerns prompted the turnaround stage.
- Four-view A / Balanced: preview listed 14 parts; saved export has 13 meshes and 189,164 triangles. Preserve the distinction between preview and exported counts. Owner screenshot shows some foot/shin fusion.
- Four-view B / Detailed: exported 107 meshes and 189,050 triangles. No skeleton or animation in either four-view export. Detailed may make grouping easier, but has not yet been proven to split every necessary joint.
- Settings tested: H3.1 HD, 200k polygon target, geometry only, Generate in Parts; 60 Studio credits per run at trial time. These are recorded observations, not stable prices or recommended defaults.
- Local audit and the first B motion probe are recorded in [Warden articulation review](chassis/warden/articulation-review.md). All 107 pieces have a provisional assignment to 12 rigid assemblies. Ankle openings and unresolved joint-spanning pistons fail articulation acceptance. Next evidence needed: repaired joint coverage, accurate pivots and bilateral motion sweeps. Do not label Detailed segmentation the default until its repair effort and boundaries have been assessed. A/B are different generations, so their comparison is not a controlled same-mesh segmentation test.

## Definition of done for this process

A second agent or human can find the approved inputs, reproduce the documented transformations, inspect explicit acceptance evidence, and identify remaining manual work without reading the originating chat. At least one mech must complete the path into a reviewed game derivative, and another chassis must exercise the instructions before the process is considered broadly validated.

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

The first [Warden modular trial](chassis/warden/modular-review.md) demonstrates identical bodies and shared rear pod housings with extracted front cartridges. It does not yet pass mechanical, seam or runtime acceptance.

## Mechanical repair lessons from Warden

The [shared repair candidate](chassis/warden/repair-review.md) adds a second lesson to the modular trial: generator segmentation can produce disconnected fragments of armor and piston surfaces instead of complete mechanical components. Audit individual pieces before assigning them to moving assemblies.

Repair the shared master once. Preserve useful exterior surfaces, rebuild simple joint internals where needed, attach actuator endpoints to the actual moving assemblies, and test both direction and stroke. Local cap checks should follow connected boundary loops when a cut intersects an existing segmentation hole. State precisely what was closed; do not equate one repaired interface with a watertight whole model.

Validate three layers separately: visible shape/clearance, mechanical hierarchy/constraints, and exported geometry. Blender constraints require an explicit runtime equivalent or baked animation; a neutral GLB export does not preserve their behavior automatically. Keep the source master, recipe, part-map hash and exported consistency evidence together. Reuse acceptance of unchanged shared geometry while reviewing changes that affect joint motion or module clearance.

## Approval and animation transfer

Freeze accepted shared-master artifact hashes separately from the original candidate reports, which retain their historical status. Guard repair scripts against overwriting an approved revision; derive further work into a new output revision.

The [Warden gait trial](chassis/warden/gait-review.md) demonstrates the next validation layer: bake DCC-only constraints into animation and load the actual exported clip in the intended runtime library. Compare sample times, planted contact positions, foot orientation and actuator endpoints. An animation export can be visually plausible yet shifted by one frame. Keep observed joint excursions separate from validated limits, and keep overlap candidates separate from confirmed armor collisions. Neither a planted-foot check nor a neutral visual approval completes the clearance gate.

Motion review must include weight transfer through the pelvis and upper body, not just correctly planted feet. In [Warden gait v2](chassis/warden/gait-v2-review.md), moving hips required a 3D leg solve to retain the accepted world-space contact paths. Validate the exported body transforms as well as the feet, and re-audit waist/hip clearances when body motion changes. Keep motion feedback and acceptance distinct from approval of the static shared master.

Warden guard decision: retain the approved unsplit exterior on both front and rear ankles. The visible split experiments were superseded by the owner. Investigate concealed surface trimming or joint ownership before proposing exterior seams; crossing counts alone did not establish a need for those seams. See `chassis/warden/clearance-review.md`.

The [Warden interface trial](chassis/warden/interfaces-review.md) separates stable shoulder sockets from module-specific muzzle origins and an empty-mount cover. Verify unchanged mesh transforms over the full walk cycle after reparenting. A bank-level origin is provisional until actual firing exits and runtime axes are checked. Empty covers require visual approval but do not create new gameplay variants.

For component export, explicitly apply evaluated modifiers and compare exported mesh counts with evaluated source geometry. Warden component v1 preserved animation transforms but silently omitted cover bevels; v2 corrected this. Transform validation alone cannot establish appearance fidelity.

The [Warden optimization trial](chassis/warden/optimization-review.md) demonstrates error-limited component simplification with locked borders, actual-export comparisons, and separate source-transform/derivative-geometry checks. Preserve a source geometry record when a derivative intentionally changes triangle counts. Straight firing rays during a walk do not establish aim-sweep clearance or per-tube muzzle accuracy. Record game-scale comparisons before changing physical dimensions.

The [Warden baked-detail trial](chassis/warden/baked-detail-review.md) transfers shallow detail to tangent-space normal maps while retaining geometry for openings and silhouettes. Use shared chassis UVs across variants, bake matching part pairs to avoid cross-projection, and validate exported texture payloads and tangent attributes. Review with a material-aware renderer; clay previews cannot establish normal-map quality.

## Current direction: targeted surface replacement

Owner direction supersedes the whole-model reduction experiment: restart from the unreduced approved master and replace selected shallow relief with clean surfaces and local texture bakes. Preserve rims, openings, silhouettes, moving assemblies, and unrelated mesh data. Review one isolated surface group in front and oblique views before expanding. Track net triangle savings after boundary closure, not just polygons deleted. See [Warden targeted surface review](chassis/warden/targeted-surface-review.md).

## Draft checkpoint: optimization unresolved

Owner stopped the optimization experiments because their visual quality was insufficient. No reduced or texture-baked derivative is approved for production. Preserve the original approved high-detail master and the prior approved articulation/guard decisions. Targeted trial v11 may contain the last interrupted attempt; it is not reviewed or accepted. Earlier trial comparisons likewise do not establish acceptance.

Before selecting a production budget, investigate the owner's reference figures for MechWarrior 5: Atlas approximately 47k polygons and Stalker approximately 12k. These are user-provided, unverified figures. Establish whether each count means triangles or polygons, which LOD is measured, whether weapons/equipment are included, and how materials, textures and draw calls contribute. Do not treat either figure as a project requirement without that context.

This draft checkpoints the workflow, images, approval records, validation tools, and experimental recipes. Large generated 3D artifacts remain ignored/local. Source hashes are provenance, not a distributable artifact archive; storage and fresh-clone reproducibility remain open work.
