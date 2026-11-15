# Warden A game derivative

Selected runtime file: `public/assets/mechs/warden/game-ready.glb` (SHA-256
`734620011cfa6f846cc4bf6819a6f140695815a35311581984b148be881c71de`).
The owner approved this exact visual revision and demonstrated motion; see
[approval.json](approval.json). Next is in-game integration and acceptance.
Normal game startup remains procedural. Historical approvals retain their own scopes.

The file contains 39,748 triangles, 16 mesh sections, three materials, two shared
128×128 images, twelve rigid motion groups, twenty firing/logical anchors plus eight attachment anchors and three
in-place animation clips (`walk`, `run`, `backward`). It is 1,036,424 bytes.
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

Both front ankle guard plates and their fasteners belong to the shin, so they
follow shin rotation independently of the foot. Toe, sole and ankle-bearing
geometry retains foot ownership. The guard shapes and resting positions are
preserved; existing gait tracks are unchanged.

The arms and missile pods are rigidly fixed to the torso. Their local attachment
transforms stay constant while the entire torso bobs, tilts and swivels. Structural
necks bridge the neutral attachment surfaces; they do not telescope or stabilize
the weapons in world space. Tests check this rigid parent-child invariant directly.

The fixed-step simulation owns the authored animation clock. A shared numeric
sampler reads immutable source curves and supplies the same torso pose to the
renderer and physical muzzle calculations. Gameplay does not read back render
nodes or a render-populated cache. Mounts do not independently yaw, pitch or
translate toward targets; existing projectile targeting remains gameplay logic.

Instances share immutable geometry/textures and own their transforms, mixers
and material clones. `loadAuthoredWarden` owns loaded resources; the separate
`prepareAuthoredWarden` helper preserves caller-owned resources. Removing a
binding is deferred while its authored instances remain alive, so combat and
visual origins cannot change independently during teardown.

The GLB is native glTF Y-up/+Z-forward/+X-own-left at approximately one unit tall.
The adapter rotates it into game +X-forward, scales height to 101.75 game units,
and derives firing origins from its anchors and the shared torso pose. Six of the eight visible
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

## Validate and preview

After restoring inputs and installing Bun dependencies:

```sh
bun scripts/mech-design/verify-game-ready.mjs
bun scripts/mech-design/build-authored-preview.ts \
  public/assets/mechs/warden/game-ready.glb \
  design/mechs/generated/warden-preview
```

The headless verifier loads the selected export directly; it does not require
Blender or ignored experiment reports. It checks guard ownership, gait, rigid
torso binding and simulation/render firing-origin agreement. The retained
`validation.json` pins the exact asset and validation source fingerprints.
CI runs the same command. Texture appearance remains a browser check.
The preview command emits self-contained `study.html` and opt-in `game.html`.

## Reproduce

The retained `source.glb` is the unchanged P2.0 50K source. `generation.json`
records its original approved image inputs, settings, Studio job and credit cost.
The build reuses the separately approved left/right pod geometry and bakes,
fitting each to the new pod envelope and repacking their maps. The remaining
body retains its outline; only four round collars receive scoped reduction,
near-coplanar internal tessellation is dissolved, and two gun-roof slivers are
removed. Six overlapping vent inserts are replaced with clean geometric louvres
and recessed backs. The old gait recipe is retargeted to the new measured pivots and soles.

Use Python 3.14.7 with Pillow 12.3.0, Blender 5.2 and Bun 1.3.14:

```sh
python scripts/mech-design/build-warden-game-ready.py --repo . \
  --output design/mechs/generated/warden-rebuild \
  --blender-command 'flatpak run org.blender.Blender'
```

Use `--blender-command blender` for a native installation. The command requires a
new ignored output directory, checks source hashes, rebuilds geometry/atlases/rig,
deduplicates/welds, generates tangents, quantizes, preserves empty anchors, and
runs format plus Three.js rig validation. glTF Transform is pinned to 4.5.1.
`recipe.json` holds frozen inputs/hashes, ownership overrides and probes,
measured pivots, module fits, atlas choices and feature-specific repair rules.
`source-ownership.json` freezes all 680 source component assignments extracted
from the approved result. Shared inventory verifies every mesh and that complete
mapping; coordinate-threshold guessing is no longer part of reproduction.
Neutral rig packaging is shared; Warden's feature repairs and gait remain its
own adapters. See the [new-source workflow](../../../../../scripts/mech-design/blender/README.md#inventory-and-package-a-new-source).
`reproduction.json` records the exact output hash, actual tool versions and
recipe/shared-library fingerprints. The complete pipeline reproduced the
selected GLB byte-for-byte on this machine.
The retained validation summary identifies its exact asset hash and checks.
Earlier 1,448/181-pose runtime audits cover the torso-binding revision `a0194813…`;
the shin-guard revision preserves those animation tracks and changes only guard
ownership, with a separate export/gait comparison.
The ownership mapping and repair rules are specific to this Warden source;
a second chassis is still required before calling the process general.

## Validation limits

All 285 sampled clip poses clear the floor. Rig matrices and animation samples
survive packaging unchanged; quantization moves vertices by less than 0.00081
game units. Earlier Three.js playback and actual game-camera/aim paths were
checked separately from Blender at `a0194813…`: 1,448 runtime poses plus an
independent 181-pose review confirmed torso binding and physical firing origins.
These historical counts are not a rerun claim for the final shin-guard revision. The four static
necks intersect both attachment skins; rigid torso parenting preserves that
contact through animation. Small knee/ankle/guard contacts remain around
mechanical hinges. In-place playback provides usable locomotion; turns/transitions
and foot sliding under abrupt direction changes still warrant owner playtesting.
The authored model supports hit flashes; bespoke recoil, thermal and exhaust
animations are deferred. Hardware GPU performance and owner visual/feel acceptance
remain separate from automated correctness checks.

Geometry arrays total 986,040 bytes. Two RGBA8 images with full mip chains add an
estimated 174,763 bytes, for approximately 1.11 MiB combined. This excludes scene
objects, animation arrays, decoder temporaries and driver allocations. It is a
modest improvement over the raw source's 1.15 MiB geometry, not a large RAM claim.


With all sections visible, 1/8/24 mechs require 16/128/384 model draws while shared geometry and
the two asset maps remain constant. Per-instance transforms, mixers and material
clones still add CPU cost. The workflow fetches only shipped public mech LFS
objects in build/Pages jobs; the build rejects unresolved GLB pointer files.

Before adopting these choices across the roster, measure actual draw calls,
CPU/GPU frame times and memory in representative real game crowds, equipment,
zoom and lighting on intended hardware, with the procedural model as a baseline.
The section counts above are an estimate, not a hardware frame-time result.
Agree scene budgets from that evidence; owner appearance and control feel remain
separate. These measurements have not been performed by this workflow refactor.

The [selected-export modularity proof](modularity-proof.md) now has bounded owner
approval for the exact alternate left weapon and sealed empty socket. Retained
proof assets are in `modularity/`; production appearance and runtime equipment
switching remain separate gates.
