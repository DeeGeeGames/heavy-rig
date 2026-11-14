# Mech design kit

Use this kit to discuss and generate Heavy Rig art across chats. Start with “Create a new Warden baseline using the mech-design skill” or “Derive Warden B from its approved baseline.” `AGENTS.md` routes assistants to the repository skill. Humans can use the generated offline builder or copy the CLI's prompt into their image generator.

## Sources and tools

For the stages after reference approval, read [Mech asset production](asset-production.md): source audit, articulation, shared variant modules, optimization, in-game acceptance and repeatability. This is the evolving process record; experimental results are not yet production defaults.

For stage 7, use the [game optimization procedure](game-optimization.md). It defines feature decisions, structural and bake checks, exported-model comparisons, and where to resume the Warden from its approved pod proof. The pod establishes a reviewed component example; full-model optimization and runtime acceptance remain open.

- `src/frames.ts`, `src/hardpoints.ts`, `src/arsenal.ts` and `src/combat-resources.ts` own gameplay facts. The kit reads them directly, including mount limits and loaded mass. Never maintain another weapon compatibility table.
- `design/mechs/style.json` owns shared art direction and chassis anatomy. The supplied V3.1 specification is preserved in `source/` for provenance.
- `bun run mech:builder` exports a self-contained offline builder to ignored `design/mechs/generated/builder.html`. Rebuild after gameplay, style or approval changes. Exported HTML is a dated snapshot; CLI prompts always use the current checkout.
- `bun run mech:prompt request.json output-directory` validates a request and writes `prompt.txt`, `request.json`, and `contract.json`. Output directories must be new so earlier design evidence is never overwritten.

## Baselines and variants

Once a 3D chassis exists, use the [modular consistency workflow](asset-production.md#modular-consistency-rules): one shared body, replaceable weapon cartridges, and approval views rendered from assembled geometry. Whole-mech image edits below are for concept exploration before that stage. See the [Warden assembly trial](chassis/warden/modular-review.md) for the first executable example.

Use `chassis/warden/baseline-request.json` as a working baseline example. A fully fitted baseline is a concept loadout, not the one-weapon purchase loadout. `mode` is `baseline` or `variant`. A variant request also supplies `baselineId`. Equipment entries follow current mount order; each has `weaponId` or null and integer `rounds`. Base anatomy and attachment locations must remain consistent even when a mount is empty.

Create temporary candidates under ignored `generated/`. Promote only the approved image to `chassis/<chassis>/concept/<variant>/`, alongside its exact prompt, request, contract, and `review.md`. Use the image-generation tool's real output, preserving alpha. Do not redraw it with code. These are authored design assets intended for version control after owner review; generated UI and transient validation evidence stay ignored/outside the repo. Nothing here is automatically shipped in the game.

A chassis's `design.json` contains `chassisId`, `activeBaseline`, `baselines`, and `variants`. Start with no approved baseline. Each approved baseline entry must include `id`, `status: "approved"`, `image` (repository-relative PNG path), `imageSha256`, `request` (repository-relative JSON path), `requestSha256`, `contractSignature` (from the candidate contract), and `approval` (owner's explicit decision and date). Keep draft/rejected entries separate or with their actual status. Only set `activeBaseline` after owner approval. Retain one current approved result per named step; Git history preserves earlier accepted states.

For each derivative record, store its variant ID, revision, status, image and SHA-256, parent baseline ID and image SHA-256, exact request/prompt paths, gameplay contract signature and owner approval if any. A derivative is current only if its parent ID/hash matches the active baseline and its gameplay contract still matches. Record older derivatives as needing review when the baseline changes. Never silently regenerate or approve them.

Variant prompts require the active approved baseline. The CLI verifies its image hash, source request, chassis and complete chassis-family gameplay contract. If gameplay definitions change, review the baseline against those changes and explicitly revalidate its contract; do not silently refresh the stored signature. Attach the baseline PNG as the actual edit target to the image generator; a path written in a prompt is not an attachment. Humans must attach the indicated image themselves. Every derivative starts from that same image, avoiding chained drift.

## Review and approval

### Directional references before 3D generation

The approved 3/4 concept establishes the visual baseline. Before model generation, derive four separate PNGs: front, back, own-left and own-right. Use the actual approved image as a reference attachment. Keep camera height, scale, pose, materials and lighting consistent, preferably with orthographic framing. Label views in filenames and metadata rather than inside the images. Own-left profile faces image-left; own-right profile faces image-right. Do not substitute a four-panel sheet as the model input. A top view is optional supplementary design evidence, not a default Tripo input.

Review the four views together. Check weapon assemblies against a newly composed gameplay contract, then check arm trunnions, shoulder supports, waist bearing, hips, knees and ankles for continuous physical connections and articulation seams. Side views may legitimately hide the far-side weapons; record occlusion instead of claiming a full count. Rear anatomy is a proposed design decision until approved. More generated views do not prove geometric consistency: repair contradictory proportions, joint positions, equipment or poses before using the set.

Store each approved set in `chassis/<chassis>/turnaround/<variant>/` with four image files, exact per-view prompts, copied current contract/request, a manifest containing baseline ID/hash and each output hash, and a review. Keep approval status pending until the owner approves the complete set. Concept, turnaround and resulting 3D model approvals are separate. A changed baseline or gameplay contract requires turnaround revalidation. The existing CLI composes baseline/variant contracts; directional prompts and this approval gate are currently a documented manual workflow, not a new CLI mode.

After turnaround approval, supply the separate views to Tripo's multi-view input. Inspect the generated model from all sides before texturing or reducing polygon count. Separate meshes do not guarantee attachment geometry, usable pivots or an animation hierarchy. Retain a cleaned source and derive lower-detail assets from it. Reuse one chassis across variants and change weapon modules; corresponding variant views should preserve the approved chassis geometry. Public model generations/uploads are permitted by the owner.

Tripo references: [multi-view inputs](https://www.tripo3d.ai/product-doc/model-generation/multi-view-to-3d) and [view consistency guidance](https://www.tripo3d.ai/help/features/how-to-use-multi-view-input-effectively).

Check the candidate image for exact assembly count, mount locations and families, own-left/own-right placement, empty interfaces, absent extra guns, readable joints, and complete framing. A multi-tube pod is one mount; salvo size is not tube count or total ammunition capacity. Distinguish visible evidence from uncertain/occluded geometry. For variants, compare cockpit, torso, pelvis, legs, armor, proportions, pose, camera and materials against the approved baseline. Longbow B/C's auxiliary brace is an explicit allowed exception; Warden weapon swaps do not justify a new torso.

Present the mount review and the actual image to the owner. Wait for baseline approval before producing variants, then obtain variant approvals separately. Image prompts and automation cannot establish owner approval. Approval of concept art does not authorize game asset replacement or bypass a preview-before-commit instruction.
