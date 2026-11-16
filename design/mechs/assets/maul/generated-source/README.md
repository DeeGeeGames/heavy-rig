# Maul generated source

The owner approved the exact source shape in `approval.json` as the basis for
local repair and rigging. Its softer armor edges are accepted at this source
stage. This approval does not cover repaired geometry, articulation, materials
or runtime appearance.

`source.glb` is the unchanged Tripo Studio P2.0 export, generated once from the
approved four-view turnaround for 100 Studio credits. Generation settings, input
hashes, job URL and spending evidence are in `generation.json`.

The raw file has 47,391 triangles. Six geometric duplicate triangles are removed
by Blender import, leaving 47,385 imported triangles. The raw source remains
unchanged. It contains one material, no textures, no animation and no rig.

`inventory.json` freezes all 256 disconnected components. The technical
`source-ownership.json` mapping assigns every component to an explicit owner;
it is a source-specific authoring decision, separate from owner visual approval.
The launcher arrays and a thin strip spanning between the feet have explicit
replacement/removal decisions in the repair recipe. Components are not silently
dropped or treated as proof of usable joints.

Derive repairs in ignored `design/mechs/generated/` using the Maul adapter.
Retain a repaired checkpoint only after its exact visual and articulation review.
