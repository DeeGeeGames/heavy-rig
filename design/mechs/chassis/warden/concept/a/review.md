# Warden baseline candidate 01

Status: draft; no owner approval. No variants generated. No active baseline or gameplay assets changed.

Generated 2026-11-12 using the built-in image_gen tool. `prompt.txt` is the exact initial tool prompt; `request.json` and `contract.json` are the unmodified CLI outputs from the current checkout. The fully fitted Warden A example was used as the representative legal loadout. `repair-prompt.txt` records the one targeted framing edit, using `initial.png` as the actual edit target. `image.png` is the final candidate. Both PNGs are actual generated outputs, copied without alteration.

Final image SHA-256: `ab40ced7dad57b56db416246b80bcbbbc76bf0b95251d78b48edd73816f526b3`.

Initial image SHA-256: `514a2463b19ced45ab911d76c303818ef81913e3e515e4eaa747a49a68d353f7`.

Gameplay contract signature: `159059be1a516a8404eff0bbfddee6eb6aa12b369047101a5d678aad9c143c83`.

## Actual image inspection

The final image was inspected visually. Mech-own left corresponds to the image-right side in this view.

| Required mount | Visible evidence | Result |
| --- | --- | --- |
| Own-left lateral ballistic AC/38 | Image-right lateral assembly has one cannon barrel, open bore, substantial recoil housing and an adjacent ammunition enclosure. | Count, location and ballistic family pass. |
| Own-right lateral ballistic AC/38 | Image-left lateral assembly has one cannon barrel, open bore and recoil housing. Rear connection is partly hidden by the torso. | Count, location and ballistic family pass; complete rear feed geometry uncertain. |
| Own-left shoulder NEEDLE/2 launcher | Image-right shoulder has one rectangular integrated pod with eight visible apertures. | Count, location and launcher family pass. |
| Own-right shoulder NEEDLE/2 launcher | Image-left shoulder has one rectangular integrated pod with eight visible apertures. | Count, location and launcher family pass. |

Exactly four visible weapon assemblies; no empty interfaces and no apparent extra weapons. Multiple launch tubes are one pod each; visible tube count is not claimed to equal salvo size or ammunition capacity. Guided capability and precise AC/38 versus other cannon identity cannot be proved from appearance alone. Both cannons point along the shared forward direction.

The compact wedge torso, narrow protected visor, substantial waist bearing, two lateral guns and two modular shoulder housings are visible. Both legs and broad feet are fully visible, with identifiable mechanical joints. The legs have bent segmented mechanical anatomy, but the intended reverse-jointed configuration is not unambiguous from this near-frontal view. The cannon feed loops look segmented; whether these are enclosed protective chutes or exposed ammunition is uncertain. Shoulder shell modularity is visually plausible but replacement compatibility is not established by this single image.

Gray hard-surface materials, neutral pose and transparent background are present. No text, logos, extra machines or ground plane. Actual camera angle appears shallower than the requested 35–45 degrees; exact angle is unmeasured. Cockpit glazing is visibly small relative to torso frontage. Full geometry is readable, but rear surfaces remain occluded.

Initial framing touched all canvas boundaries. The one permitted repair added margin and retained the four-mount layout and overall identity. The final 1312 x 1199 RGBA PNG has alpha extrema 0–255; nonzero-alpha bounds are (39, 25, 1282, 1173), confirming transparent margins. Faint edge pixels extend beyond the main silhouette, so exact 85% image-height occupancy is not claimed. Some thin light/red edge fringe is visible at shoulder edges; keep this as a draft-quality limitation.

## Workflow trial findings

AGENTS.md successfully routed to the local skill and README. The chassis record correctly showed no approved baseline. CLI composition succeeded with the supplied Warden example and created the new candidate directory once its parent drafts directory existed. The generated prompt and contract made mount order/families and owner-approval boundaries clear. No tool errors or source-tooling defects were encountered in this trial.

The built-in image tool supplied both image data and an existing saved PNG path, so copying the real file preserved alpha without needing to decode data. A usability consideration: README says the output directory must be new, but does not explicitly say to create its parent first; this trial received that instruction from the task. No tooling files were modified. The image generator did not fully obey initial framing, and the repair did not resolve all articulation/camera ambiguities; these are output limitations, not established composer bugs.

Owner aesthetic approval remains pending and separate from this mount review. This candidate is not asserted to be a fully passing reference because the uncertainties above remain. No further repair was attempted under the one-repair limit. No task-created servers, browser tabs or long-lived processes remain.
