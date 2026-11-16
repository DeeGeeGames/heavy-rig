# Maul A game asset

The owner approved the material finish, scale and demonstrated runtime motion
after the upright-torso and knee-direction repairs. [Approval](approval.json)
pins the exact export and reviewed runtime files; [manifest](manifest.json)
records costs and contracts. The approval covers the presented Maul A visuals.
Physical keyboard/controller/touch feel, audio and representative hardware or
crowd performance remain separate from visual approval and software checks.

The retained `maul.glb` and shipped
`public/assets/mechs/maul/game-ready.glb` have the same SHA-256:
`79809952e7c1e86c05b813722986abdaf6a4a104ff8ce5ed7a72cd410ce653d1`.
The export contains 50,718 triangles, ten rigid sections, one shared material,
two embedded 8×1 palette textures, 32 physical launcher exits and two logical
weapon slots. Its payload is 1,783,372 bytes and needs no geometry decoder.

Two forearm pod assemblies are interchangeable torso children. Empty slots hide
their pod geometry while retaining torso-owned connectors. Six gameplay tubes
per pod map to six real bores in each visual 4×4 cartridge; the sixteen visible
bores do not change salvo size or ammunition capacity. Maul B/C retain their
procedural models. Normal startup uses `src/game-assets.ts` to preload Kestrel
and Maul independently, with five-second deadlines and procedural fallbacks.
Late loading results are disposed. The per-chassis preview entries remain
available. Existing simulation collision proxies stay authoritative.

The approved runtime height, 153.65404829172167 game units, matches the posed
procedural Maul. The runtime measures this source's pivots and soles and uses
fixed-step contacts/IK. Torso motion keeps its up axis vertical while independent
aim rotates around that axis. Walk timing and foot paths retain their accepted
revision. Run uses a farther forward landing prediction and a longer flight
interval. A Maul-only neutral knee bend pole prevents knee-direction reversals
in run and reverse; Warden and Kestrel retain their existing behavior.

The embedded diagnostic/walk/run/backward clips are authoring and inspection
data. Runtime leg movement uses its separate numeric gait, whose visual approval
is recorded in [runtime-review.json](runtime-review.json). Software checks cover
the real exported graph, finite motion, foot floor/contact behavior and numeric
versus rendered firing origins. They do not prove exhaustive joint collisions,
actuator stroke or target-hardware performance.

## Retained lineage and reproduction

Approved concepts and directional references are in `chassis/maul/`. The raw
provider export, frozen 256-component inventory and reviewed ownership are in
`assets/maul/generated-source/`. The approved neutral repair is in
`assets/maul/articulation-base/`. One P2.0 generation cost 100 Studio credits;
repair, animation, material authoring and packaging thereafter were local.

`locomotion.glb` is a required input to the hash-pinned material recipe. It
preserves the accepted neutral geometry and hierarchy while adding upright
authoring curves. No rejected material or gait candidates are retained here.
The compact motion report omits per-frame diagnostic samples; those can be
regenerated from the pinned scripts and accepted neutral input.

From the repository root, install Bun dependencies and retrieve LFS assets,
then use fresh ignored output paths:

```sh
git lfs install --local
git lfs pull
bun install --frozen-lockfile
python3 scripts/mech-design/verify-assets.py
flatpak run org.blender.Blender --background --factory-startup --python-exit-code 1 --python "$PWD/scripts/mech-design/blender/build_maul_repair.py" -- --repo "$PWD" --recipe design/mechs/assets/maul/articulation-base/recipe.json --output design/mechs/generated/maul-neutral-reproduction
flatpak run org.blender.Blender --background --factory-startup --python-exit-code 1 --python "$PWD/scripts/mech-design/add-maul-motions.py" -- --repo "$PWD" --input design/mechs/assets/maul/articulation-base/maul.glb --output design/mechs/generated/maul-locomotion-reproduction
python3 scripts/mech-design/materialize-maul.py --repo "$PWD" --recipe design/mechs/assets/maul/game-ready/material-recipe.json --output design/mechs/generated/maul-material-reproduction
python3 scripts/mech-design/package-optimized-glb.py --repo "$PWD" --input design/mechs/generated/maul-material-reproduction/maul.glb --output design/mechs/generated/maul-material-reproduction/game-ready.glb
python3 scripts/mech-design/verify-kestrel-package.py design/mechs/generated/maul-material-reproduction/maul.glb design/mechs/generated/maul-material-reproduction/game-ready.glb --report design/mechs/generated/maul-material-reproduction/packaging-report.json
sha256sum design/mechs/generated/maul-locomotion-reproduction/maul.glb design/mechs/assets/maul/game-ready/locomotion.glb
sha256sum design/mechs/generated/maul-neutral-reproduction/maul.glb design/mechs/assets/maul/articulation-base/maul.glb
sha256sum design/mechs/generated/maul-material-reproduction/game-ready.glb design/mechs/assets/maul/game-ready/maul.glb
```

Use native `blender` instead of the Flatpak command if appropriate. Material
reproduction deliberately reads the retained locomotion input; its hash must
match the independently rebuilt locomotion output shown by the first comparison.
The existing package verifier's historical Kestrel filename does not supply
anatomical assumptions: it compares ordered triangle positions, normals and UVs,
named graph bindings, animation values, images and material sampling definitions.
Packaging uses pinned glTF Transform 4.5.1 dedup/prune/validate commands.

The raw-source neutral repair, locomotion, material authoring and packaged
exports reproduced byte for byte from these accepted inputs.
[reproduction.json](reproduction.json) records exact
output hashes and tool versions. This is stronger than checkpoint retrieval;
fresh-clone LFS restoration remains a separate delivery check.
