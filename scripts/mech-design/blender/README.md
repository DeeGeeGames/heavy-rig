# Experimental Blender authoring recipes

These scripts document an in-flight asset workflow. They are not production asset generators or accepted optimization presets. Run only against the recorded source revision in a disposable task scene; generated outputs are ignored and must never overwrite approved inputs.

Approved visual/motion decisions are recorded separately under `design/mechs/chassis/warden/`. Later decimation, whole-body texture bakes, and targeted surface trials have NOT received appearance approval. `targeted_surface.py` is a failed historical experiment; `targeted_panels.py` is also unfinished and must not be promoted as a validated recipe.

Large source/intermediate `.blend` and `.glb` files remain local in `design/mechs/generated/`. Recorded hashes identify them but do not make them available from a fresh clone. Artifact storage and clean-checkout reproduction remain delivery gates.
