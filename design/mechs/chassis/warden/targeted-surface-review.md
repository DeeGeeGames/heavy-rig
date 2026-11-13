# Targeted surface replacement restart

The owner superseded the whole-model reduction/baking approach. Restart from the approved unreduced interface master, retain original geometry, and replace selected shallow relief with deliberately built surfaces. Earlier whole-body optimization and bake candidates are not the new baseline.

## Current isolated trial

Output: `design/mechs/generated/warden-targeted-v10/`. Recipe: `scripts/mech-design/blender/targeted_panels.py`; review renderer: `render_targeted_surface.py`. The source is hash-verified against `approved-interfaces.json`. No game asset replacement or new appearance approval is implied.

Only the own-left energy face is targeted. Remove original triangles fully contained in the two grille rectangles; preserve boundary-crossing triangles and all other source-face triangles verbatim. Add a six-triangle planar insert inside the original rim, behind the original optic and vent-frame geometry. Normal texture detail is masked to the grille areas; the rest of the original face is not re-UV'd or normal-mapped. The insert uses a working 1024-square normal map; atlas packing and resolution budgeting remain later work.

The face changes from 3,180 to 2,836 triangles including the insert: 344 fewer, approximately 10.8%. Its separate optic is unchanged. All other 124 original meshes pass unchanged geometry and transform fingerprints. The broader mech remains at original detail; this is not a new under-20k model.

## Review and lessons

Compare source and candidate in matched front and oblique material-aware renders. A normal map restores lighting detail, not physical louver depth, self-occlusion or parallax. The flatter insert can therefore change the apparent recess and shadow at angled views; this requires owner review before applying it elsewhere.

Historical iterations are superseded: flattening/dissolving existing relief left folded surfaces; splitting tiny patches and closing their edges consumed the expected savings; an oversized backing panel changed the silhouette. The current insert fits inside the existing rim. Do not use `targeted_surface.py`, the earlier failed flattening experiment, as the production recipe.

Next after review: apply the accepted technique to one larger armor slab, retaining its bevels and silhouette. Track removed relief, replacement triangles, texture footprint and visible differences per surface. Do not force the whole-model budget through another broad decimation pass.

Current validation is authoring-scene geometry/transform fingerprints and matched renders. Export topology, tangent data, runtime shading and motion should be checked when this surface treatment is accepted and packaged. It has not yet been exported or integrated into production.

## Paused checkpoint

Owner stopped this line of work for reassessment. V10 failed review because its backing plane occluded the optic. V11 attempted a center opening but the turn was interrupted and its result is unreviewed. Neither is approved. This document's earlier trial description is historical, not an acceptance record.
