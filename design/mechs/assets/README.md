# Retained mech authoring inputs

Warden A, Kestrel A and Maul A use hand-faceted armor, broad blocks of vertex color and an emissive visor. Each playable GLB retains the rigid pivots, firing anchors and animation clips of its high-detail source. The [in-game lineup](playable-a-lineup.png) shows their Original finish in the Practice range and Mech Bay.

| Playable model | Triangles | Approved comparison | High-detail source |
| --- | ---: | --- | --- |
| [Warden A](warden/pixel/manifest.json) | 4,306 | [Warden comparison](warden/pixel/comparison.png) | [39,748 triangles](warden/game-ready/README.md) |
| [Kestrel A](kestrel/pixel/manifest.json) | 3,123 | [Kestrel comparison](kestrel/pixel/comparison.png) | [42,796 triangles](kestrel/game-ready/README.md) |
| [Maul A](maul/pixel/manifest.json) | 4,830 | [Maul comparison](maul/pixel/comparison.png) | [50,718 triangles](maul/game-ready/README.md) |

To restore the checkpoints and independently rebuild the three playable exports, run the following from the repository root. Give the rebuild a new output directory each time. It verifies the SHA-256 of each source and rebuilt model against the selection record.

```sh
git lfs install --local
git lfs pull
bun install --frozen-lockfile
python3 scripts/mech-design/verify-assets.py
python3 scripts/mech-design/build-pixel-mechs.py --out design/mechs/generated/approved-pixel-rebuild
```

`manifest.json` pins all retained assets by path, size and SHA-256. GLB and Blender
files use Git LFS. The high-detail Warden authoring build reads the following inputs.

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
Historical audit tools and detailed repair/gimbal reports use the same archive index.
Their original hashes and containing Git revisions are preserved; per-file revisions
override the top-level revision. Narrative reviews are indexed in
[Warden history](../history/warden/README.md). Historical
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
