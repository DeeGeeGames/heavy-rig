# Retained production checkpoints

These files are the inputs and accepted steps needed to continue the Warden
production pipeline or branch from a prior step. Blender and GLB binaries use
Git LFS. JSON records and selected acceptance evidence stay in ordinary Git.

```sh
git lfs install
git lfs pull
python3 scripts/mech-design/verify-assets.py
```

`manifest.json` pins every retained checkpoint file by repository-relative path,
byte count and SHA-256. Approval records live in `../chassis/warden/`.

- `generated-source/body`: original Tripo B body input.
- `generated-source/launcher-donor`: original Tripo A input supplying launchers.
- `modular-assembly`: shared body and extracted module assembly checkpoint.
- `repaired-chassis`: approved repaired shared master.
- `articulation-base`: Blender source dependency for the guard recipe only;
  its superseded walk previews, exports and reports are excluded.
- `guards`: final approved shin-owned guards and original axles.
- `interfaces`: shared sockets, cartridges and approved empty covers.
- `motions/walk`, `motions/run`, `motions/backward`: selected current motions.
- `components/walk`, `components/run`, `components/backward`: current validated
  unoptimized shared chassis and socket-local module packages, each supporting
  A/B/C and empty shoulders with measured physical exit anchors.
- `components/physical-origins.json`: frozen measured anchor definitions; its
  historical measurement status is superseded by `approved-stage6.json`.
- `components/review`: retained firing-origin overlays and owner-accepted
  clearance-contact evidence.
- `optimization/pod`: owner-approved own-left pod component proof, packed
  authoring checkpoint with required bake sources, original comparison GLB,
  reports and selected export renders. It is a worked stage 7 example, not the
  completed Warden derivative. See `approved-pod-optimization.json` and the
  [optimization procedure](../game-optimization.md).

Stable step paths hold one advancing result per step. Temporary candidates,
render sequences, rejected reductions and competing animation trials stay out
of the deliverable. Prior committed states remain accessible through Git.
Historical IDs and internal Blender scene names are preserved to avoid modifying
approved binary assets merely for naming consistency.

Preserving the older articulation base is necessary: the accepted guard recipe
uses it as input. Current animation assets live only under `motions/`; see
`chassis/warden/approved-locomotion.json` for their acceptance. The original
launcher-donor model is likewise retained as a required source, not a separately
approved production chassis.

See the [authoring commands](../../../scripts/mech-design/blender/README.md)
for recipe invocation. Storage does not establish final optimization, runtime
acceptance or end-to-end regeneration from the original provider job.
