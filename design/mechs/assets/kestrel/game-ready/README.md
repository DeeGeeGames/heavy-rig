# Kestrel A game asset

The owner approved this exact material export, scale and demonstrated runtime
motion on 2026-11-16. [Approval](approval.json) pins the asset and the reviewed
runtime files. [Manifest](manifest.json) records the shipped dimensions, resource
costs and contracts. Physical controls, audio and target-hardware performance
remain separate from this visual approval and software validation.

`public/assets/mechs/kestrel/game-ready.glb` is the single shipped export:
1,584,884 bytes, 42,796 triangles, ten rigid sections, one shared material, two
8×1 palette textures, fourteen physical barrel exits and three embedded draft
clips. No runtime geometry decoder is needed. Normal startup loads this approved
Kestrel before creating game models; asset-load failure or a five-second startup
deadline falls back to the procedural model and disposes any late result.
Warden's preview and the procedural Kestrel B/C remain available.

The two guns are interchangeable rigid torso children. Empty slots hide their
gun assembly while retaining torso-owned supports. Each seven-barrel array is
one gameplay weapon; the central barrel supplies its logical firing origin.
The runtime shares fixed-step contact/IK helpers with Warden but measures this
source's own asymmetric pivots and soles and supplies Kestrel-specific strides.
It does not directly play the embedded leg tracks. Its accepted height, 74.82
game units, matches the posed procedural Kestrel. Existing simulation collision
proxies remain authoritative; visual triangles do not become physics colliders.

## Retained lineage and reproduction

The approved concept and four views are in `chassis/kestrel/`; the unchanged
provider export, inventory, ownership and measurements are in
`assets/kestrel/generated-source/`. The approved neutral repair is in
`assets/kestrel/articulation-base/`. One private P2.0 generation cost 100 Studio
credits. All repair, motion, material and packaging work thereafter was local.

From the repository root, after `git lfs pull` and
`bun install --frozen-lockfile`, choose fresh ignored output paths:

```sh
python3 scripts/mech-design/materialize-kestrel.py --repo "$PWD" --recipe design/mechs/assets/kestrel/game-ready/material-recipe.json --output design/mechs/generated/kestrel-material-reproduction
python3 scripts/mech-design/package-optimized-glb.py --repo "$PWD" --input design/mechs/generated/kestrel-material-reproduction/kestrel.glb --output design/mechs/generated/kestrel-material-reproduction/game-ready.glb
python3 scripts/mech-design/verify-kestrel-package.py design/mechs/generated/kestrel-material-reproduction/kestrel.glb design/mechs/generated/kestrel-material-reproduction/game-ready.glb --report design/mechs/generated/kestrel-material-reproduction/packaging-report.json
python3 scripts/mech-design/verify-assets.py
```

The material authoring build reproduced byte for byte. Its exact triangle
position/normal fingerprints, named graph, anchors and animation samples remain
unchanged from the approved articulation checkpoint. Packaging uses the existing
pinned glTF Transform 4.5.1 dedup/prune/validate route. The verifier resolves actual
resources after index changes and rejects changes to triangle positions, normals,
UVs, graph/anchors, animation samples, palette images and material sampling.
Historical candidate labels in retained authoring recipes/reports describe their
creation time; `approval.json` defines the accepted revision and scope.

For the neutral Blender repair command, see
[the authoring guide](../../../../../scripts/mech-design/blender/README.md#kestrel-source-specific-repair-and-materials).
Source-specific cuts, feature replacements, component material roles and cockpit
face overrides are explicit recipe data. Shared inventory and rig packaging were
used on a second chassis; those anatomical decisions and this asset's budget are
not roster-wide defaults.

Build a portable runtime review with:

```sh
bun scripts/mech-design/build-authored-preview.ts public/assets/mechs/kestrel/game-ready.glb design/mechs/generated/kestrel-runtime-review kestrel
```

`kestrel-study.html` also provides equipment, motion and camera controls in the
production build. `kestrel-preview.html` enters the full game with the same
approved factory. Bulk screenshots and browser evidence stay ignored under
`generated/`; compact validation and exact hashes are retained here.
