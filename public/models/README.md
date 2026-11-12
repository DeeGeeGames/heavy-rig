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
