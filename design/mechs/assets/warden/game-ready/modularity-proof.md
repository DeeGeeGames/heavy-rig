# Selected P2 Warden modularity proof

The owner replied **"Approved" on 2026-11-15** to retention of the exact
presented configurations as a whole-weapon assembly proof, accepting rough
appearance only within the experiment. [modularity/approval.json](modularity/approval.json)
records the explicit prompt, statement, source/export hashes and remaining gates.
Parent technical review passed after the repairs below; delivery remains subject
to parent review. The selected public GLB and its earlier approval are unchanged.
This approval does not cover production appearance/replacement, runtime loadouts,
hardware performance, another chassis or PR merge. PR69 must remain draft.

## Boundary and legal equipment

The live `src/hardpoints.ts` Warden slot 0 is `left-gun`, permitting `autocannon`
and `machine-gun`; `src/arsenal.ts` defines the latter as one projectile per shot.
The proof replaces the complete left weapon assembly, including its outer armor.
The selected torso-owned structural neck and collars remain byte-identical.
There is no torso rebuild, new body master, copied gait implementation, material
change, runtime equipment API, new gameplay compatibility or production promotion.

The selected GLB already separates that weapon into one mesh node. Its outer
armor and barrel are not separately owned cartridges in this derivative. This
proof therefore uses that existing complete-module boundary rather than claiming
reuse of the original gun housing. The proof empty mount retains the selected
neck and adds a sealed bearing housing. Its rough appearance and this whole-assembly boundary are approved for the proof; a finer cartridge-only split remains possible future work.

`modularity-contract.json` freezes the socket, axes, envelope, live gameplay
identity, retained neck endpoint and bounded approval scope. The alternate is a local
three-barrel hollow machine-gun assembly using existing material 0. Three explicit
physical exits sit 0.002 native units ahead of the actual terminal rings. The
authoring mapping emits one projectile per shot, cycling barrels; it does not
change gameplay projectiles or implement a runtime equipment adapter. The empty
assembly has no live left weapon mesh or exit; its structural socket is separate.
Unused original weapon buffers remain in these review GLBs to preserve resource
IDs exactly. They are unreferenced by scene geometry and are not functional.
These are not optimized shipping variants or payload improvements.

## Reproduce and inspect

Restore from a fresh checkout (Bun 1.3.14, Python 3; Blender is optional for
rerendering). The exact source is already retained in `public`; it is not duplicated
under design assets. Existing Git LFS rules cover the two GLBs and review PNGs.

```sh
git lfs install --local
git lfs pull --include='public/assets/mechs/warden/game-ready.glb,design/mechs/assets/warden/game-ready/modularity/**' --exclude=''
bun install --frozen-lockfile
# Use a new ignored output directory; the builder refuses overwrites.
python scripts/mech-design/build-warden-modularity.py \
  --output design/mechs/generated/warden-modularity-restored
cmp design/mechs/generated/warden-modularity-restored/alternate.glb \
  design/mechs/assets/warden/game-ready/modularity/alternate.glb
cmp design/mechs/generated/warden-modularity-restored/empty.glb \
  design/mechs/assets/warden/game-ready/modularity/empty.glb
bun scripts/mech-design/verify-warden-modularity.mjs \
  design/mechs/generated/warden-modularity-restored
cp design/mechs/assets/warden/game-ready/modularity/review/*.png \
  design/mechs/generated/warden-modularity-restored/
bun scripts/mech-design/build-modularity-preview.mjs \
  design/mechs/generated/warden-modularity-restored
bun run check
# For the complete checkpoint manifest, restore all LFS assets first:
git lfs pull
python scripts/mech-design/verify-assets.py
```

To rerender instead of copying the exact matched stills:

```sh
flatpak run org.blender.Blender --background --factory-startup --threads 2 \
  --python-exit-code 1 --python "$PWD/scripts/mech-design/render-warden-modularity.py" \
  -- --input "$PWD/design/mechs/generated/warden-modularity-restored"
```

The retained `modularity/` directory holds only the two approved GLBs,
`approval.json`, `assembly-proof.json`, `motion-proof.json`, `evidence-manifest.json`
and nine matched `review/*.png` stills (original/alternate/empty × front/rear/socket-close).
The compact evidence manifest pins retained review bytes, source, contract and
scripts. No intentionally defective export is retained. HTML, bundled viewer,
bulky browser/check logs and rejected experiments remain ignored. The historical
ignored evidence directory is `design/mechs/generated/warden-modularity-proof/`;
none of the restoration commands depend on it.

The standalone `comparison.html` uses production-bundled Three.js/GLTFLoader and
embeds all three actual exports. It offers neutral rest, shared walk/run/backward
playback, phase, torso yaw and front/rear/socket-close cameras. Still renders use
the same imported first pose; they are not animation evidence. Motion evidence is
the actual-export Three.js sampling report and interactive playback.

## Results

Two clean builds reproduced both candidate GLBs byte-for-byte:

- Alternate: `e1ca2ac6c41883847fbe1fceb009ec5d62c9eae35500ce39e5bf286c5c2c8a28`
- Empty: `d58ae105305ee2191543bdd8676fb963fb9fe725aded966a6d1da99e307e5e0d`

All twelve unchanged mesh nodes match geometry/accessor bytes, primitive/material
bindings, neutral transforms and parent ownership. Materials resolve embedded
image bytes. All twelve rigid-group bindings and all animation sampler bytes
match. The shared hashes are:

- Geometry/bindings map aggregate: `64460141fa10f74f5d3bb95ae75d0a53d4ced4658fad2a9fde191bc7d75b4dff`
- Rig/rest bindings: `ce446e3d53db4f9d5c07bf9e236ced4981e41099830323f8c09cb8500cea203e`
- Motion: `f16a92c2619a9dd5abf380624a85926093bb8db2591d6e57526794a7b24fa36c`
- Materials/images: `31648421c0099eabd9051330ee511723b05cbde22efd70ecd0ef20b4b83272b8`

The aggregate hashes canonical sorted compact JSON of the per-node fingerprint
map. `modular-export.py` resolves actual accessor and image buffer views, not
merely resource indices. A regression test mutates real geometry bytes, a neutral
transform, mesh ownership, material and animation bytes; all five diverge.

Actual-export checks sample 61 phases of each of three clips at torso yaw
-90/-45/0/45/90 degrees: 915 comparative states, 2,745 assembly poses. Shared world
matrix error is zero. Maximum socket-relative error is `4.45e-16`; exit-relative
error is `3.23e-16` native units. The contracted bearing housing has indexed-triangle surface hits at 54 sampled
face points (nine per face, 1e-6 native-unit tolerance). The neck endpoint
and module binding remain aligned through the sampled motion states. This is
bounded housing coverage, not an exhaustive watertightness or volume proof. All three centerline rays clear 0.5 native units forward,
backward center rays enter the hollow bores, and offset rays hit the actual
exported terminal rings 0.002 units behind each exit. No inactive original gun
mesh or old muzzle remains attached in either candidate.

`bun run check`: 436 tests, typecheck, lint and production build pass.
`verify-assets.py` verifies the updated retained checkpoint manifest. The earlier
parent review verified all 113 predecessor files; delivery adds this proof package. Both candidate GLBs
pass glTF Transform 4.5.1 validation without errors or warnings. Informational
unused-resource/empty-tombstone messages and missing buffer-view target hints
remain in these append-only review exports. The selected public
GLB, retained source files, earlier approvals and ordinary game startup remain unchanged.

## Limits and next gate

This proves a bounded authoring interface on the selected derivative. It does not
prove exhaustive swept clearance, finite projectile-volume clearance, runtime
loadout behavior, all equipment, independent gimbals, other chassis or a universal
pipeline. Weapons remain torso-rigid. Browser software rendering and headless
sampling do not establish hardware performance, physical controls, audio,
balance or in-game owner acceptance.

Owner exact-hash approval is now recorded for this bounded proof. A later authorized
integration must map live equipment and active muzzle counts atomically into the
existing model/physical-origin factory and validate actual gameplay firing,
saves/loadout compatibility and empty mounts. This task does not implement that
API or authorize production replacement or PR merge.

## Parent review repairs

The earlier AABB attachment check was a false positive: deleting all 12 bearing
housing triangles left their unused positions in the accessor. The validator now
casts nine inside-to-outside rays per contracted housing face and requires an
intersection with an actually indexed triangle at that face's expected distance.
Intersections elsewhere do not satisfy coverage. Interior overlaps from the
receiver/cap are permitted. The module must be directly socket-owned, and its
neck-relative point is checked at every motion sample. Small holes between probe
points, arbitrary manifoldness and exhaustive collision remain outside this proof.

`housing-coverage.mjs` owns this bounded check. The regression builds actual exact
candidates, verifies both, then removes the first 36 housing indices separately
from each export while preserving positions. Each defective export must fail with
`Housing surface coverage missing`. It cleans its temporary generated directory.
The parent's existing defective exports now fail with the same error:

```sh
bun test tests/modular-export.test.ts
# Expected nonzero exit for the parent's deliberately broken exports:
bun scripts/mech-design/verify-warden-modularity.mjs \
  design/mechs/generated/modularity-parent-negative-review
```

The tests CI job now runs `git lfs install --local` and pulls only
`public/assets/mechs/warden/game-ready.glb` before testing. An isolated local
clone with smudging disabled confirmed the initial LFS pointer, then ran those
same commands and recovered the selected SHA. No shared asset was replaced;
remote GitHub credentials/network availability were not simulated. Explicit LFS
installation matters: a fresh local clone otherwise fetched the object but
reported that checkout was skipped because LFS was not installed.

The interactive page now embeds the existing actual-export front stills before
JavaScript runs, uses fixed 340px panel areas, reports loading/failure, loads GLBs
in parallel, and replaces each still after its first successful draw. It draws
immediately after loading and on control changes, including when background-tab
animation callbacks are throttled. The outer page is transparent without a banner
or padding; controls use theme variables and wrap on narrow displays. WebGL model
panels retain their scene background. The static front/close/rear comparison is
still available, and the stills change view even if a GLB fails to load.

Review browser evidence confirms actual GLB loading, different rendered images
and torso matrices at walk phases .15/.65 and 60-degree yaw, different close/rear
images, and run/backward clip selection. A displayed HTML preview also advanced
run playback. Background browser tabs can throttle animation; immediate control
redraws work there. Software WebGL fallback/ReadPixels warnings remain. No
hardware performance or physical input acceptance is claimed.

Review logs are `review-repair-check.log`, `review-repair-verifier.log`,
`review-repair-parent-negative.log`, `review-repair-retained.log`,
`review-repair-lfs.json`, and `review-repair-browser.json` in the existing ignored
proof directory. Both GLB hashes and all nine still renders are unchanged; only
the affected motion report and HTML views were regenerated. The owner subsequently approved retention of these exact proof configurations on
2026-11-15. Existing concept and selected production-asset approvals retain their
original scopes; this new approval is confined to the authoring experiment.
