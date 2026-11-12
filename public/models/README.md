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

`heavy-prototype-reduced.glb` is a separate review candidate: **18,974 triangles**
(89.2% fewer), retaining the same eight mesh sections, nine materials, 34 material
primitives, and original animation. The approved master above is unchanged.

Rebuild with `bun run reduce:prototype`. The offline generator uses glTF Transform
4.5.1 and meshoptimizer 1.2.0. It welds duplicate vertices, then simplifies each
material primitive using position and normal attributes, normal weights 0.1,
relative error limit 0.02, and permissive seam handling. Primitives below 200
triangles remain at their original target; larger primitives target 10% with a
60-triangle floor. It validates rigid skinning before reduction, compacts vertex
streams, deduplicates resources, and prunes unused data. No animation resampling,
material replacement, quantization, or geometry compression is used.

This pass reduces geometry, not draw calls. Launcher vents/panel divisions and
small armor details lose definition at close range. Normal-map baking, further
LOD levels, and representative battlefield GPU profiling are not included.
The candidate remains separate from production pending visual review.
