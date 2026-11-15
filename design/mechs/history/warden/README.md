# Warden historical checkpoints

Current continuation: [selected P2 game-ready package](../../assets/warden/game-ready/README.md), [modularity proof](../../assets/warden/game-ready/modularity-proof.md), and [optimization procedure](../../game-optimization.md).

These narratives describe superseded dense-master stages; their approvals apply only to the recorded artifacts:

- [Assembly trial](modular-review.md): shared body and shoulder cartridges.
- [Mechanical repair](repair-review.md): accepted cut-boundary repairs, collars and actuator ownership; six interface planes closed, with no global watertightness claim.
- [Interfaces](interfaces-review.md): accepted empty shoulder cover and component export checks.
- [Locomotion](locomotion-review.md): accepted walk, run and backward prototypes.

Machine-readable approvals remain at stable paths under `chassis/warden/`.
Editable checkpoints, original inputs, approved pod modules/bakes and essential
review summaries/stills remain under `assets/warden/`. Current source contracts
and script entrypoints retain their paths.

[archived-outputs.json](../../assets/warden/archived-outputs.json) records exact
paths, bytes, hashes and recovery revisions. Earlier derivative exports use
`04127e5d3fcce414de4e460d2adef2248482d755`; the five historical tools and two detailed
reports archived during cleanup use `a95e8ffa070968be34852c8c03c8d347a6bf1122`.
Fetch `git fetch origin refs/pull/69/head`, then use `git show <revision>:<path>`
for reports/tools or a separate checkout plus `git lfs pull` for the matching
historical workflow. No shared Git/LFS storage is pruned.

The archived gimbal report found gun/shoulder-support contacts; stage 6 explicitly
accepted them as draft limitations, alongside sampled run gun/upper-leg contact.
[approved-stage6.json](../../chassis/warden/approved-stage6.json) preserves that
decision and the original report hash. The archived repair report's accepted
facts and hash remain in the repair narrative and
[shared-master.json](../../chassis/warden/shared-master.json).

The archived tools audited old component scale/rays, generated the superseded
gait trial, verified its verbose samples, rendered old variant packages, or
sampled dense-master aim clearance. They do not participate in the selected P2
build. Other authoring helpers remain where they support retained editable work;
`locomotion_trial.py` also supplies the selected rig packager's gait dependency.
