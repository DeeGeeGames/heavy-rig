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
P2 recipe above. Historical scripts remain to preserve authoring knowledge;
they are not extra steps required for every future mech.
