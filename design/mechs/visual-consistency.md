# Shared-world visual consistency

New chassis baselines use the individually owner-approved Warden, Kestrel and
Maul concepts listed in [visual-references.json](visual-references.json). This
reference set supplies shared construction and material cues; the requested
chassis retains its own silhouette, role, proportions, leg anatomy and mounts.
Selecting existing approved images as references does not create a new owner
approval of the set, a candidate or a production model.

## Prepare references

Run `bun run mech:prompt request.json new-output-directory`. Existing request
JSON remains valid. For a baseline, the CLI verifies every reference's active
baseline ID, chassis, recorded owner approval, image path and actual SHA-256.
An outdated or modified reference stops composition; review and explicitly
update the reference set instead of silently changing the hashes.

Attach each actual PNG listed in the emitted `attachments.json` to the image
generator as a style reference. The prompt identifies their role and forbids
copying another chassis's equipment or producing a reference collage. A path in
the prompt does not attach an image. Keep the exact prompt, request, attachment
manifest and resulting PNG together during iteration.

For variants, the attachment manifest contains the same-chassis approved
baseline as the edit target. Existing variant geometry-preservation rules take
precedence; a variant is not an opportunity to redesign the body to resemble a
different reference chassis.

The offline builder verifies the set when built and emits the same baseline
reference instructions. Rebuild it after approvals or references change. Export
its request and run the CLI to obtain the attachment manifest and pending family
review record before promotion.

## Family review before turnaround generation

The CLI creates `family-review.json` with every criterion and owner approval
pending. Compare the generated candidate beside the actual reference images
using matched framing and presentation size. Record its repository-relative image
path and SHA-256; evaluate the emitted criteria with `pass`, `fail` or `uncertain`
and concrete visual evidence:

- Material finish and armor/mechanism contrast.
- Armor plate, bevel and subassembly construction.
- Detail scale and density at matching presentation size.
- Joint and interface construction language.
- The new chassis's distinct identity and legal mounts.

Keep the mount checklist separate. Plausible mount counts do not prove family
consistency, and shared styling does not prove correct mounts or unseen surfaces.
Resolve failures and uncertain visible evidence before presenting the baseline
for approval. Present the candidate and reference comparison to the owner; record
the explicit decision and exact candidate hash in the review. A single explicit
decision may approve both the baseline and its presented family comparison.

Retain the completed family review and attachment manifest alongside the approved
concept. Only proceed to turnaround generation once the review passes and the
owner has approved the exact baseline. This remains a manual visual/owner gate:
the prompt composer cannot evaluate images or grant approval. Re-review after a
candidate image change; changes to the reference set require checking affected
pending work. Do not retroactively mark existing concepts as family-reviewed or
invalidate their recorded approvals merely because this gate was introduced.
