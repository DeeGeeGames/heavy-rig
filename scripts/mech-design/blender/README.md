# Mech authoring commands

Start with [the selected Warden package](../../../design/mechs/assets/warden/game-ready/README.md)
and [the optimization procedure](../../../design/mechs/game-optimization.md).
Normal game startup is unchanged. Derive candidates into a new ignored
`design/mechs/generated/` directory; promote only after the required review.

## Restore and rebuild the selected derivative

```sh
git lfs install --local
git lfs pull
bun install --frozen-lockfile
python scripts/mech-design/verify-assets.py
python scripts/mech-design/build-warden-game-ready.py --repo . \
  --output design/mechs/generated/warden-rebuild \
  --blender-command 'flatpak run org.blender.Blender'
```

Use `--blender-command blender` with a native installation. The selected build
was reproduced using Python 3.14.7, Pillow 12.3.0, Blender 5.2.0 LTS, Bun 1.3.14
and glTF Transform 4.5.1. Source inputs and Warden-specific decisions are pinned
by the package recipe. The rebuild records actual tool versions and fingerprints
its dependencies, including the shared gait implementation.

The build reuses approved pod geometry/bakes, assigns rigid ownership, repairs
selected source features, retargets the shared walk/run/backward gait, and
packages animations, UVs, MikkTSpace tangents and physical firing anchors.
Quantization retains native GLTFLoader support. A fresh candidate directory is
required; generated artifacts do not overwrite accepted sources.

## Validate the retained export without Blender

```sh
bun scripts/mech-design/verify-game-ready.mjs
```

This is also a CI check. It reads the selected manifest/recipe and actual GLB,
checks rigid ownership, sampled gait and physical origins, and requires no
ignored reports. Add an asset path and a new report path as positional arguments
to save fresh evidence. The retained validation summary pins its source hashes.

Checkpoint mode requires exact hash and measured cost equality. For a changed
Warden candidate use `--candidate`, which retains the ownership, hierarchy, gait
and physical-origin checks but permits costs within explicit ceilings:

```sh
bun scripts/mech-design/verify-game-ready.mjs \
  design/mechs/generated/warden-rebuild/warden.glb --candidate
```

The default `game-ready/candidate-budget.json` conservatively caps each cost at
the selected asset's current value. Use `--candidate --budget path.json` for an
explicit alternative with chassis, rationale and all maximum costs. These are
experiment limits, not hardware acceptance or budgets for every chassis. The
cost parser is reusable; the Warden structural/runtime verifier stays an adapter.

## Inventory and package a new source

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python "$PWD/scripts/mech-design/blender/source_inventory.py" -- \
  --repo "$PWD" --input design/mechs/assets/CHASSIS/source.glb \
  --output design/mechs/generated/CHASSIS-inventory
```

Use absolute script paths with Flatpak (`flatpak run org.blender.Blender`). The
inventory covers all imported mesh instances, local/world bounds, transforms,
geometry hashes and disconnected components, including loose vertices. Mesh and
component IDs are local to the exact source/import fingerprint. They are not
stable across regeneration or changed import tools.

The command emits `inventory.json` and draft `ownership.json`. Review every
component, supply semantic `groups` and one assignment for every component ID,
and record explicit scoped approval in `approval.status`/`approval.evidence`.
Before applying source-specific repairs, call `verify_ownership(inventory,
mapping, source_sha256)`; changed geometry, transforms, missing/stale assignments
and unreviewed mappings fail. Keep groups for parts being replaced so their source
coverage remains accounted for. The Warden map inherits existing approval only
through byte-for-byte equivalence with its selected asset; new source mappings
require their own review. Do not copy Warden component IDs or spatial thresholds.

After source-specific separation/repair, use `package_neutral_rig(source,
contract, scene_name=..., generator=...)` from `rigid_packaging.py`. `source` is
the GLB JSON returned with its buffer by `read_glb`; the contract declares
`groups` (name, parent, world pivot), `meshGroups` (source node name to assembly),
and optional anchors (name, parent, world position/direction). Coordinates are
Blender Z-up/-Y-forward. Every mesh instance must resolve to one owner, explicitly
or through a named group ancestor. Duplicate names, unknown/stale assignments,
cycles, skins, morph targets and GPU instancing are rejected; expand instances
with an explicit adapter before packaging. The returned tuple contains document,
node indices, groups, pivots, owned geometry and mesh bindings. The document
preserves neutral world placement and can be saved with `write_glb` using the source buffer.
It contains no generated locomotion; chassis-specific adapters add their own
motion and runtime contracts and validate the actual export.

`warden_game_ready/package_rig.py` demonstrates an adapter around this shared
packager. It retains Warden's twelve-group anatomy and accepted gait. A synthetic
two-group fixture verifies shared packaging beyond that anatomy; it is not a
second-chassis art or game-readiness acceptance claim.

Regression checks:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
python3 tests/mech-rigid-contract_test.py
blender --background --factory-startup --python-exit-code 1 \
  --python "$PWD/tests/mech-rigid-packaging_blender.py"
blender --background --factory-startup --python-exit-code 1 \
  --python "$PWD/tests/mech-source-inventory_blender.py"
```

## Generate a standalone study and opt-in game preview

```sh
bun scripts/mech-design/build-authored-preview.ts \
  public/assets/mechs/warden/game-ready.glb \
  design/mechs/generated/warden-preview
```

The new directory contains `study.html`, `game.html` and a manifest identifying
the embedded GLB hash. Open either HTML directly; no server is required. The study
includes a close shin-guard view and gait/aim/fire controls. The game bundle uses
the opt-in startup without changing `index.html` or the normal game build.
Bulk browser captures and transient reports stay ignored.

## Refine the retained pod modules

Packed `optimization/pod/pod.blend` and `optimization/right-pod/pod.blend` include
their required bake references. Reuse the already-fitted right cup reference;
refitting it changes the approved bake. The right recipe also needs the retained
`components/physical-origins.json`. The existing approved GLBs remain immutable.

Verify either export in a fresh Blender process (omit `--side right` for left):

```sh
blender --background --factory-startup --python-exit-code 1 \
  --python scripts/mech-design/blender/verify_optimized_pod.py -- \
  --repo "$PWD" --side right \
  --output design/mechs/generated/right-pod-validation.json
```

To derive a new candidate, use `build_warden_pod.py` or
`build_warden_right_pod.py` with `--repo "$PWD" --output` set to a new generated
folder. Then package and verify the actual export:

```sh
python scripts/mech-design/package-optimized-glb.py \
  --repo "$PWD" --input design/mechs/generated/right-pod-rebuild/pod-raw.glb \
  --output design/mechs/generated/right-pod-rebuild/pod.glb
```

Keep actual aperture boundaries, coverage and exit anchors. Geometric bevels
retain their shading; surface relief transfers selectively. Baked launcher cells
have no physical cavity depth and are not projectile collision surfaces.

The retained matched views can still build the original comparison:

```sh
bun scripts/mech-design/optimization-review.ts \
  --source design/mechs/assets/warden/optimization/pod/source.glb \
  --candidate design/mechs/assets/warden/optimization/pod/pod.glb \
  --renders design/mechs/assets/warden/optimization/pod/review \
  --output design/mechs/generated/pod-review.html
```

Substitute `right-pod` for the right package. Geometry-only evidence remains in
its `review/geometry` folder. Render manifests pin GLB and PNG hashes; a different
candidate requires fresh renders using `render_optimization_proof.py`.

## Historical dense-master authoring

The former assembly → repair → guards → interfaces → motions/components workflow
is historical. Editable Blender checkpoints, original provider inputs and
accepted component sources remain available for recovery or future module work.
Superseded GLB exports, verbose matrix samples and old guard animation evidence
are recorded in [archived-outputs.json](../../../design/mechs/assets/warden/archived-outputs.json).

Fetch `git fetch origin refs/pull/69/head` if the archived commit is absent
from a fresh clone after merge. To rerun historical component packaging/inventory
commands, use a separate
checkout at that record's Git revision, restore LFS, and follow the README and
manifest from that revision. Current production continuation is the selected
P2 recipe above. Retained historical helpers preserve editable authoring work; five superseded
audit/trial/render tools are archived at their per-file revisions in that index.
The [history index](../../../design/mechs/history/warden/README.md) separates the
old narrative reviews from current continuation. These are not extra steps for
every future mech.

## Selected-export module proof

The P2 Warden modularity proof uses the selected exported GLB directly, rather
than resuming the historical dense-master assembly. Its commands and boundaries
are in [modularity-proof.md](../../../design/mechs/assets/warden/game-ready/modularity-proof.md).
`../modular-export.py` supplies Blender-independent actual-resource fingerprints
and append-only GLB assembly helpers. `../build-warden-modularity.py` is the
source-specific complete-left-gun adapter; its dimensions are not a general
chassis segmentation algorithm. `../verify-warden-modularity.mjs` exercises the
actual exported module/socket/muzzle geometry through shared Three.js motion.

The exact alternate and empty exports are owner-approved for bounded proof
retention (2026-11-15). The linked record includes fresh-checkout LFS retrieval,
byte-for-byte rebuilding and preview reconstruction from retained stills.
