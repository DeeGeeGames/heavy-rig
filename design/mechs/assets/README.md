# Retained mech authoring inputs

The selected Warden A derivative is documented in
[game-ready/README.md](warden/game-ready/README.md). Its manifest identifies the
owner-approved visual revision; normal game startup remains procedural until
in-game integration and acceptance.

```sh
git lfs install --local
git lfs pull
bun install --frozen-lockfile
python scripts/mech-design/verify-assets.py
```

`manifest.json` pins all retained assets by path, size and SHA-256. GLB and Blender
files use Git LFS. The current build directly reads only:

- `warden/game-ready/source.glb`: unchanged P2.0 source generated from approved views.
- `warden/optimization/{pod,right-pod}/pod.glb`: approved geometry and embedded bakes.
- The selected recipe and shared gait implementation named by the game-ready package.

Keep the packed `pod.blend` files and original pod comparisons to refine or
rebake those modules. The right pod recipe also reads
`warden/components/physical-origins.json`. Approved component comparisons remain
complete so their existing review builder can still reproduce the review page.

Other retained Blender files under `modular-assembly`, `repaired-chassis`,
`articulation-base`, `guards`, `interfaces` and `motions` are editable historical
checkpoints. They preserve useful earlier assembly and animation work; they are
not additional inputs to the selected P2 build. Original generated body and
launcher-donor models remain unchanged as provenance and potential module sources.

Superseded dense-master GLB exports, component bundles, per-frame matrix traces
and the old guard GIF are indexed in [archived-outputs.json](warden/archived-outputs.json).
Their original hashes and containing Git revision are preserved. Historical
approval records label archived artifact paths with `storage: git-history`.
To recover PR ancestry after a squash merge or branch deletion, run
`git fetch origin refs/pull/69/head`. To run the complete historical workflow,
use a separate checkout at the archive revision,
restore its LFS files and use its original manifest and commands. No Git history
or shared LFS object storage is pruned by this cleanup.

New candidates and bulk validation evidence belong in ignored `generated/`.
Retain the advancing result, necessary inputs, recipe, compact validation summary
and approval record. Regenerate derivative exports instead of retaining duplicate
review packages for every animation and intermediate assembly step.

The selected-export [modularity proof](warden/game-ready/modularity-proof.md) retains
only the exact owner-approved alternate/empty GLBs, nine matched review stills
and compact approval/fingerprint evidence in `warden/game-ready/modularity/`.
These are authoring experiments, not installed production configurations.
