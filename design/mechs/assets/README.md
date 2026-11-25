# Retained mech authoring inputs

All 27 playable variants use hand-faceted armor, blocks of chassis paint and a small emissive visor. Each family shares a body, articulated legs and firing mounts. The mounted weapons distinguish its variants. Compare the [full roster](field-roster.png), the [first nine production models in the Mech Bay](playable-variants.png) and the [three shared finish references in Practice and the Mech Bay](playable-a-lineup.png).

The [Practice contact sheet](field-roster-practice.png) shows unscaled crops of all 27 stock variants. The [Situation Sim sortie](field-roster-squad.png) shows Harrow Barrage deployed with Bastion Bulwark, Specter Designator and Morrow Pursuer. The [per-variant measurements](field-roster.json) record geometry, loaded weapons, firing and terrain clearance.

The six new families share the same source format. Each recipe owns the outline, plate colors, faction paint mask, joints, receivers and individual cartridges. The packer emits one base GLB and a second GLB containing only the additional fittings. It records which parts each variant reuses and the SHA-256 of the base it fits. Player, squad and opposition all use the fitted rig's measured firing exits.

```sh
python3 scripts/mech-design/build-roster-kits.py --check
python3 scripts/mech-design/build-roster-kits.py --family rook --out design/mechs/generated/rook-inspection
```

The three earlier families retain their source-specific rebuilds.

| Playable family | A-model triangles | Selected silhouette | High-detail source |
| --- | ---: | --- | --- |
| [Warden](warden/pixel/manifest.json) | 4,542 | Low wedge, extended nose and tapered gun arms | [39,748 triangles](warden/game-ready/README.md) |
| [Kestrel](kestrel/pixel/manifest.json) | 3,183 | Lean cockpit and forearm housings above reverse-jointed legs | [42,796 triangles](kestrel/game-ready/README.md) |
| [Maul](maul/pixel/manifest.json) | 4,854 | Upright four-mount body with short Ironclad forearms | [50,718 triangles](maul/game-ready/README.md) |

Warden B and C change the shoulder weapons. Kestrel B and C replace the right gun with a laser or a two-exit launcher. Maul retains the original torso, legs and two recessed inboard weapons. Its outer launcher, cannon and energy cartridges each retain 25% of the original Ironclad barrel projection beyond the elbow armor. Breacher carries twin launcher gauntlets and inset guns, Breaker carries twin cannons and inset lasers, and Furnace mixes a cannon and particle gauntlet with an inset laser and launcher. The earlier four-mount approval documents the underlying Maul chassis. [Four-mount design review](maul/pixel/four-mount-review.json)

To reproduce the game models from the retained high-detail inputs, run both builders from the repository root. Use fresh output directories. Each builder verifies the resulting SHA-256 hashes against the current selection. The variant tests exercise the shared rig, cartridge sockets and alignment of rendered exits with simulation firing origins.

```sh
git lfs install --local
git lfs pull
bun install --frozen-lockfile
python3 scripts/mech-design/verify-assets.py
python3 scripts/mech-design/build-pixel-mechs.py --out design/mechs/generated/approved-pixel-rebuild
python3 scripts/mech-design/build-pixel-variants.py --out design/mechs/generated/approved-variant-rebuild
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
