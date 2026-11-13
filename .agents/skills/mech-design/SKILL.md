---
name: mech-design
description: Create Heavy Rig chassis baseline images and derive visually consistent weapon variants using the repository design kit and current gameplay mounts. Use for mech image design, not gameplay balance or production model replacement.
---

Read `design/mechs/README.md` from the repository root, then the selected chassis's `design/mechs/chassis/<id>/design.json` if present. Run the kit against the current checkout; never copy a stale mount list from chat history.

For a new baseline, use its A variant with a fully fitted, legal representative loadout unless the owner specifies otherwise. Compose with `bun run mech:prompt <request.json> <output-directory>`. Read the emitted prompt and mount checklist. Generate with the available image-generation skill/tool. Save the exact request, prompt, generated PNG, and mount review in a new versioned draft directory. Do not overwrite approved artwork. If the image tool is unavailable, report the limitation; do not substitute a diagram or silently use another provider.

For a variant, require an explicitly owner-approved baseline and its actual image. The composer refuses draft, wrong-chassis or stale-contract baselines. Inspect the baseline, pass its PNG to the image tool as the edit target, and use the emitted variant-edit prompt. Keep the shared chassis unchanged; apply only the listed module changes and explicitly allowed structural exceptions. Derive every variant directly from the same approved baseline, never from another variant.

Inspect the generated image, not merely its prompt. Count mount assemblies (a pod or barrel array is one mount), verify own-left/own-right families, positions and empty interfaces, and check for added weapons and chassis drift. Mark occluded or ambiguous mounts uncertain; do not claim they pass. Repair concrete defects before presenting a candidate. Report the mount checklist separately from the owner's aesthetic approval.

Baseline approval and each variant's approval are separate owner decisions. Approval is never inferred from generation, an agent review or silence. Record the owner's explicit approval and exact image hash before changing the active baseline. A new baseline makes derivatives of an older baseline stale. Creating art does not authorize replacing gameplay assets. Honor the current session's commit policy.
