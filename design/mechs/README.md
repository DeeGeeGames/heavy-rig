# Mech design kit

Use this kit to discuss and generate Heavy Rig art across chats. Start with “Create a new Warden baseline using the mech-design skill” or “Derive Warden B from its approved baseline.” `AGENTS.md` routes assistants to the repository skill. Humans can use the generated offline builder or copy the CLI's prompt into their image generator.

## Sources and tools

- `src/frames.ts`, `src/hardpoints.ts`, `src/arsenal.ts` and `src/combat-resources.ts` own gameplay facts. The kit reads them directly, including mount limits and loaded mass. Never maintain another weapon compatibility table.
- `design/mechs/style.json` owns shared art direction and chassis anatomy. The supplied V3.1 specification is preserved in `source/` for provenance.
- `bun run mech:builder` exports a self-contained offline builder to ignored `design/mechs/generated/builder.html`. Rebuild after gameplay, style or approval changes. Exported HTML is a dated snapshot; CLI prompts always use the current checkout.
- `bun run mech:prompt request.json output-directory` validates a request and writes `prompt.txt`, `request.json`, and `contract.json`. Output directories must be new so earlier design evidence is never overwritten.

## Baselines and variants

Use `chassis/warden/baseline-request.json` as a working baseline example. A fully fitted baseline is a concept loadout, not the one-weapon purchase loadout. `mode` is `baseline` or `variant`. A variant request also supplies `baselineId`. Equipment entries follow current mount order; each has `weaponId` or null and integer `rounds`. Base anatomy and attachment locations must remain consistent even when a mount is empty.

Keep each image revision under `chassis/<chassis>/drafts/<revision>/`, alongside the exact prompt, request, contract, and `review.md`. Use the image-generation tool's real output, preserving alpha. Do not redraw it with code. These are authored design assets intended for version control after owner review; generated UI and transient validation evidence stay ignored/outside the repo. Nothing here is automatically shipped in the game.

A chassis's `design.json` contains `chassisId`, `activeBaseline`, `baselines`, and `variants`. Start with no approved baseline. Each approved baseline entry must include `id`, `status: "approved"`, `image` (repository-relative PNG path), `imageSha256`, `request` (repository-relative JSON path), `requestSha256`, `contractSignature` (from the candidate contract), and `approval` (owner's explicit decision and date). Keep draft/rejected entries separate or with their actual status. Only set `activeBaseline` after owner approval; retain old records and assets.

For each derivative record, store its variant ID, revision, status, image and SHA-256, parent baseline ID and image SHA-256, exact request/prompt paths, gameplay contract signature and owner approval if any. A derivative is current only if its parent ID/hash matches the active baseline and its gameplay contract still matches. Record older derivatives as needing review when the baseline changes. Never silently regenerate or approve them.

Variant prompts require the active approved baseline. The CLI verifies its image hash, source request, chassis and complete chassis-family gameplay contract. If gameplay definitions change, review the baseline against those changes and explicitly revalidate its contract; do not silently refresh the stored signature. Attach the baseline PNG as the actual edit target to the image generator; a path written in a prompt is not an attachment. Humans must attach the indicated image themselves. Every derivative starts from that same image, avoiding chained drift.

## Review and approval

Check the candidate image for exact assembly count, mount locations and families, own-left/own-right placement, empty interfaces, absent extra guns, readable joints, and complete framing. A multi-tube pod is one mount; salvo size is not tube count or total ammunition capacity. Distinguish visible evidence from uncertain/occluded geometry. For variants, compare cockpit, torso, pelvis, legs, armor, proportions, pose, camera and materials against the approved baseline. Longbow B/C's auxiliary brace is an explicit allowed exception; Warden weapon swaps do not justify a new torso.

Present the mount review and the actual image to the owner. Wait for baseline approval before producing variants, then obtain variant approvals separately. Image prompts and automation cannot establish owner approval. Approval of concept art does not authorize game asset replacement or bypass a preview-before-commit instruction.
