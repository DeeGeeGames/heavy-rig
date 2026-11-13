# Warden authoring recipes

Approved inputs live under `design/mechs/assets/warden/` in named production
steps. Run `git lfs pull`, then `python3 scripts/mech-design/verify-assets.py`.
Use Blender 5.2 in a fresh process. Work on candidate outputs under ignored
`design/mechs/generated/`; never write into an accepted checkpoint directly.

The retained chain is generated-source → modular-assembly → repaired-chassis →
articulation-base → guards → interfaces → motions/components. The articulation
base is an approved intermediate required to reproduce the guard repair; it is
not the current walking animation. Internal Blender scene names and historical
approval IDs retain their original identifiers so the accepted binary bytes stay
unchanged. Folder names describe steps, and Git records revisions.

For recipes using `REPO_ROOT`, set it to the checkout's absolute path before
executing the script in Blender. `OUTPUT_FOLDER` selects a new ignored candidate
folder for modular assembly, base gait, guards, interfaces and components.
Repair uses `repair-draft.json`: copy it to a temporary candidate manifest, set
status to `repair-candidate-unapproved`, choose a new output and supply its path
as `REPAIR_MANIFEST`. Approved sources and part-map hashes are checked first.

The current motions can be regenerated from the interface checkpoint:

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/locomotion_trial.py -- \
  --repo "$PWD" --output walk-candidate --speed 4
```

Use `--profile suspended-run --speed 8` for the run and
`--profile backward-walk --speed 3` for backward. Use separate candidate folders.
Validate the exported GLB with `verify-walk.ts` against its generated report.
`render_locomotion.py` creates review views without changing the source file.

Only owner-approved results replace a named checkpoint. Refresh its approval
record and asset manifest in the same commit. Generated reports may retain
historical IDs; that does not make a rejected experiment part of the retained
asset set. No production optimization recipe is accepted yet.

Component and firing-scale checks print results without modifying the input
checkpoint. Supply an optional second CLI argument for a new report path under
`design/mechs/generated/` when retaining validation output.
