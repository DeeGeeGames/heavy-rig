# Heavy prototype

`heavy-prototype.glb` is the approved AI-assisted surface and walking study,
provided for the separate prototype viewer. It is not assigned to a production
chassis and contains no combat or turning animations.

Source: user-supplied Tripo GLB, with Blender rigid articulation, approved walking
animation, armor cleanup, and materials created during the Heavy Rig asset study.
The original and editable Blender source remain preserved in the standalone
study artifacts. No third-party BattleTech model geometry was imported by this
finishing pipeline.

Export: eight mesh sections, nine materials, 175,788 triangles, one eight-second
walk. All materials are texture-free. glTF Transform CLI 4.5.1 `dedup` followed by
`prune --keep-leaves true --keep-attributes true --keep-indices true` removes
redundant data without geometry simplification, quantization, or animation
resampling. This prototype deliberately preserves the approved surface detail.

Runtime normalization uses a 160-unit standing height for inspection only.
Launcher guides are approximate face-center references, not combat muzzle data.

## Reduced candidate

`heavy-prototype-reduced.glb` is a separate review candidate: **27,134 triangles**
(84.6% fewer), retaining the same eight mesh sections, nine materials, 34 material
primitives, and original animation. The approved master above is unchanged.

Rebuild with `bun run reduce:prototype`. The offline generator uses glTF Transform
4.5.1 and meshoptimizer 1.2.0. It welds duplicate vertices, then simplifies each
material primitive using position and normal attributes, normal weights 0.1,
relative error limit 0.02, and permissive seam handling. Primitives below 200
triangles remain at their original target; larger primitives target 10% with a
60-triangle floor. It validates rigid skinning before reduction, compacts vertex
streams, deduplicates resources, and prunes unused data. Chest launcher faces and
rims are protected with vertex locks in source bind coordinates: absolute X
0.038–0.16, Y 0.60–0.80, and Z at least 0.12. The small upper racks
are also locked at absolute X 0.055–0.106, Y 0.753–0.813, and Z -0.030–0.066.
The triangle target adds a budget for protected faces to avoid forcing additional
reduction of unrelated surfaces that share their material. All 9,109 original triangles
fully inside this region are preserved exactly. No animation resampling,
material replacement, quantization, or geometry compression is used.

This pass reduces geometry, not draw calls. Shoulder-launcher vents/panel divisions and
small armor details lose definition at close range. Normal-map baking, further
LOD levels, and representative battlefield GPU profiling are not included.
The candidate remains separate from production pending visual review.
