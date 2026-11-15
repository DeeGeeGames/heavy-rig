# Warden A game derivative

Selected runtime file: `public/assets/mechs/warden/game-ready.glb` (SHA-256
`9cb234b3b1c7d852b835f7a6ef89ca99d35ef302925338ad64656a52cdcb1464`).
This is the completed opt-in integration candidate. The normal game and older
approved checkpoints are unchanged; final owner visual acceptance is separate.

The file contains 38,628 triangles, 15 mesh sections, three materials, two shared
128×128 images, twelve rigid motion groups, twenty named anchors and three
in-place animation clips (`walk`, `run`, `backward`). It is 1,013,312 bytes.
Quantized vertex attributes use standard `KHR_mesh_quantization`, supported by
Three.js GLTFLoader without an additional decoder. MikkTSpace tangents are included.

## Use in Heavy Rig

`src/authored-game.ts` is an optional startup replacement for `src/main.ts`:
it preloads the public GLB, installs its model factory and physical weapon rigs
atomically, then imports the normal game. Existing save/gameplay contracts and
six logical launcher tubes per bank are preserved. Ordinary startup stays procedural.

For another entry point:

```ts
import { loadAuthoredWarden } from './authored-mech';
const asset = await loadAuthoredWarden('./assets/mechs/warden/game-ready.glb');
const uninstall = asset.install();
// Create the existing game presentation after installation.
// Dispose presentation instances, then uninstall() and asset.dispose().
```

Instances share immutable geometry/textures and own their transforms, mixers
and material clones. `loadAuthoredWarden` owns loaded resources; the separate
`prepareAuthoredWarden` helper preserves caller-owned resources. Removing a
binding is deferred while its authored instances remain alive, so combat and
visual origins cannot change independently during teardown.

The GLB is native glTF Y-up/+Z-forward/+X-own-left at approximately one unit tall.
The adapter rotates it into game +X-forward, scales height to 101.75 game units,
and derives aiming/firing origins from its anchors. Six of the eight visible
cells are mapped explicitly by `WARDEN_LOGICAL_TUBE_MAPPING`; salvo size does not
change. Baked launcher faces are visual surfaces, not projectile colliders.
The existing analytic gameplay collision shapes remain authoritative.

Build standalone production previews with the exact asset embedded:

```sh
bun scripts/mech-design/build-authored-preview.ts \
  public/assets/mechs/warden/game-ready.glb \
  design/mechs/generated/warden-preview
```

This emits `study.html` and `game.html`, using the real camera/model factory,
combat rig definitions and existing game startup. The inspector offers motion,
view, independent aim and physical-exit checks. It does not promote the asset.

## Reproduce

The retained `source.glb` is the unchanged P2.0 50K source. `generation.json`
records its original approved image inputs, settings, Studio job and credit cost.
The build reuses the separately approved left/right pod geometry and bakes,
fitting each to the new pod envelope and repacking their maps. The remaining
body retains its outline; only four round collars receive scoped reduction,
near-coplanar internal tessellation is dissolved, and two gun-roof slivers are
removed. Six overlapping vent inserts are replaced with clean geometric louvres
and recessed backs. The old gait recipe is retargeted to the new measured pivots and soles.

Use Python with Pillow 13, Blender 5.2 and Bun 1.3.14:

```sh
python scripts/mech-design/build-warden-game-ready.py --repo . \
  --output design/mechs/generated/warden-rebuild \
  --blender-command 'flatpak run org.blender.Blender'
```

Use `--blender-command blender` for a native installation. The command requires a
new ignored output directory, checks source hashes, rebuilds geometry/atlases/rig,
deduplicates/welds, generates tangents, quantizes, preserves empty anchors, and
runs format plus Three.js rig validation. glTF Transform is pinned to 4.5.1.
The complete pipeline reproduced the selected GLB byte-for-byte on this machine.
An independent report covers every exported vertex, all three clips and anchors.
The anatomy classifier and repair rules are specific to this Warden source;
a second chassis is still required before calling the process general.

## Validation limits

All 285 sampled clip poses clear the floor. Rig matrices and animation samples
survive packaging unchanged; quantization moves vertices by less than 0.00081
game units. Three.js playback and actual game-camera/aim paths are checked
separately from the source Blender scene. Physical-exit center rays are clear
in 243 sampled motion/heading/target configurations (4,374 center rays); this is not a swept-volume
or exhaustive joint-limit proof. Small knee/ankle/guard contacts remain around
mechanical hinges. In-place playback provides usable locomotion; turns/transitions
and foot sliding under abrupt direction changes still warrant owner playtesting.
The authored model supports hit flashes; bespoke recoil, thermal and exhaust
animations are deferred. Hardware GPU performance and owner visual/feel acceptance
remain separate from automated correctness checks.

Geometry arrays total 969,848 bytes. Two RGBA8 images with full mip chains add an
estimated 174,763 bytes, for approximately 1.09 MiB combined. This excludes scene
objects, animation arrays, decoder temporaries and driver allocations. It is a
modest improvement over the raw source's 1.15 MiB geometry, not a large RAM claim.


The 1/8/24-mech probe submits 15/120/360 model draws while shared geometry and
the two asset maps remain constant. Per-instance transforms, mixers and material
clones still add CPU cost. The workflow fetches only shipped public mech LFS
objects in build/Pages jobs; the build rejects unresolved GLB pointer files.
