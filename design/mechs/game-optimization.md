# Game optimization procedure

Stage 7 builds a game derivative from the accepted structure. Its default method
for dense mechanical surfaces is to construct a small mesh around structural
features, then transfer suitable surface detail onto it. Use this procedure with
the [production stages](asset-production.md) and
[modular consistency rules](asset-production.md#modular-consistency-rules).

The Warden pod is the first owner-approved component example. Its geometry
choices and reduction percentage are evidence for that component, not defaults
for every body part or chassis. Whole-model runtime acceptance remains stage 8;
exercise the workflow on another chassis before calling it broadly validated.

## 1. Freeze the source and record the component contract

Verify approved input hashes before editing. Work in a new ignored directory
under `design/mechs/generated/`; preserve the accepted source. Identify the
component's parent assembly, local axes, units, transforms and shared/replaceable
ownership. Record the following in its candidate report or recipe configuration:

- Evaluated/exported triangles, mesh instances/sections, materials, texture
  dimensions and encoded payload. State the equipped configuration and LOD.
- Intended viewing conditions: camera, default and maximum zoom, and expected
  on-screen size. Label size estimates separately from actual runtime captures.
- Protected features: outer silhouette, meaningful thickness and raised forms,
  joints/pivots, attachment boundaries, functional openings, sockets and logical
  and physical firing origins. State tolerances and the source revision.
- A feature decision list using the categories below, with reasons for borderline
  cases. Keep the shared body and replaceable modules separate in this record.
- The geometry, material and texture budget being evaluated. Establish a budget
  from the intended scene; do not impose one reduction ratio on every component.

| Decision | Typical application | Required evidence |
| --- | --- | --- |
| Keep geometry | Silhouette, substantial protrusions, joints, mounting interfaces, cavity depth needed in reviewed views | Shape, interface and movement checks remain satisfied |
| Rebuild geometry | Broad armor surfaces, chamfers, rails, structural vent surrounds, unnecessarily sampled surfaces | Deliberate planes/corners/sections preserve the structural form |
| Bake detail | Fasteners, shallow seams, latch faces, individual slats, decorative openings that do not need real depth | Exported material retains the feature at the reviewed viewing sizes and angles |
| Remove hidden geometry | Surfaces proven unnecessary in all relevant configurations | Inspect motion, aiming, empty mounts, module changes and relevant camera views before removal |

An opening can be decorative in a render and still overlap a gameplay path.
Record that distinction explicitly. A flat render face must not become the
projectile collision surface merely because its visible holes were baked.

## 2. Build and inspect the structural mesh

Use a few meaningful cross-sections and explicit corner positions for mechanical
forms. Broad panels should not require dense grids simply to follow source noise.
Retain geometry where it changes the silhouette or an interface. Rebuild a vent
frame or armor band as a simple structure before deciding which local relief to
bake. Treat collapse decimation as a scoped experiment subject to these same
checks, not an acceptance method based on triangle count alone.

Inspect the mesh with baked color and normal detail disabled. Check front, rear,
own-left, own-right, underside and oblique views where they expose relevant
surfaces. The structural mesh must have the intended skin, openings, thickness,
rails and interfaces before the bake is judged.

When sampling an accepted source, distinguish its structural surface from small
fastener bumps. A missed sample is a diagnostic to resolve; it is not permission
to discard a surrounding face. Use explicit boundaries for protected apertures.
Use explicit corners for chamfered profiles rather than assuming a set of radial
samples includes them. Stop reducing geometry when further cuts compromise the
protected features or reviewed appearance.

## 3. Transfer surface detail without duplicating structural shading

Record the bake source for each target surface, including any deliberately
reconstructed source used for a cavity. Repair normals or other bake defects in
a working copy and preserve the original accepted source. Do not describe a
reconstructed-source bake as a direct transfer from the original mesh.

Check face orientation, target UVs, normals/tangents and projection cage/ray
coverage. Inspect both the textures and their appearance on the exported GLB.
Missed transfers, inverted recesses, black seams and projection onto neighboring
parts require diagnosis and repair. Geometry-only and baked views help separate
mesh defects from transfer defects.

An existing geometric bevel or frame does not always benefit from another
normal transfer. Keep its geometric shading where projecting the source bevel
creates doubled edges or discontinuities. Unchanged simple pieces can use neutral
atlas regions instead of a coincident-source bake. Record any cavity darkening
encoded in base color so its lighting assumptions remain visible to the next
worker.

Choose texture resolution from the intended screen use. Consolidate compatible
materials and atlases while preserving module replacement. Optimize shared
housing/body geometry once and reuse it across variants; avoid baking different
copies of the same chassis independently.

## 4. Verify the actual export

Export GLB, apply the documented packaging step, then validate that exact file.
Record its hash, tool versions and source hashes with the results. Check:

- Evaluated triangle counts, finite positions, valid normals/tangents and valid
  glTF data, with textures present and usable in the target loader.
- Expected node identities, parent-local transforms, pivots, sockets and firing
  anchors. Normalize scale/orientation consistently across connected parts; an
  isolated proof that retains source units must say so.
- Protected opening boundaries and representative surface coverage around them.
  Define per-component tolerances and samples. Anchor equality and overall
  bounds alone do not establish that the surrounding skin survived.
- Applicable outgoing firing-clearance samples and attachment checks. Distinguish
  center rays from finite projectile volume and full weapon aim sweeps.
- Shared geometry/rig identity and interfaces across affected variants. When the
  component is reassembled, rerun the existing motion, aiming and equipped/empty
  module checks affected by the change.

Measure material sections and textures as well as triangles. Sections are not a
measurement of runtime draw calls, and lower counts do not prove a frame-time
gain. Report encoded size and texture-memory assumptions; compare actual runtime
performance with representative equipment and crowds at stage 8.

## 5. Produce the comparison and record acceptance

Compare the accepted source and candidate using matching camera, scale, lighting
and a stated material treatment. Review actual exported GLBs in Blender and
Three.js, with wireframe and baked-detail toggles or equivalent paired renders.
Include the views from the structural check, plus default and maximum gameplay
size. Inspect any part whose asymmetry or occlusion makes one side insufficient.

For a substantial reduction, obtain independent review of the export and visible
evidence. Fix concrete defects, rerun affected checks and regenerate comparisons
after repairs. Freeze the final hash before owner review; the report and pictures
must describe the same revision. Passing validation, an independent review or a
triangle budget does not substitute for the agreed owner visual acceptance.

Record the owner's decision with its scope. Approval of an isolated component
does not approve unseen full-model motion, other variants or production runtime
replacement. Retain only the selected advancing result, required source/bake
dependencies, recipe/configuration and selected acceptance evidence. Keep
rejected candidates and transient renders out of the deliverable. Refresh the
approval record and asset manifest together when promoting the result.

Automate inventories, invariant checks, packaging, validation and matched
comparison generation. Keep component-specific feature decisions explicit. The
code for one mechanical shape is not a universal automatic reconstruction tool.

## Warden pod example and observed repairs

The approved own-left pod contains the shared housing/collar and launcher
cartridge; mounting struts and the rest of the mech are outside this proof.
See the [approval record](chassis/warden/approved-pod-optimization.json),
[retained assets](assets/warden/optimization/pod/) and
[authoring commands](../../scripts/mech-design/blender/README.md).

The selected export has 922 triangles: 836 for the housing/collar and 86 for the
cartridge. It uses two mesh sections, two materials and four maps: housing normal
and base color at 1024², cartridge normal and base color at 512². The isolated
source has 16,622 triangles. These are component measurements, not a budget or
expected reduction for the whole Warden.

The proof preserves nine anchors, the source mounting-opening boundary and the
skin around it. Its checks include 40 clear outgoing samples and 90 underside
coverage samples matching the source. Those sample counts belong to the pod's
contract. The selected revision passed export checks and independent review;
owner acceptance is recorded separately in the approval file.

| Observed failure | Repair to carry into future work |
| --- | --- |
| Missing coarse samples caused whole underside faces to disappear | Preserve the actual aperture boundary and build the surrounding skin; verify coverage as well as anchors |
| Radial rear-frame samples missed the true chamfer corners | Use explicit profile corners and connect them to the casing |
| A source fastener bump pinched the broad rear roof | Keep the roof section structural and transfer the small bump into the bake |
| A coincident collar bake blackened an unchanged part | Give the simple unchanged collar neutral shading in the shared atlas |
| Cavity normals made baked circles read as raised discs | Correct the working bake-source normals and check recess cues from oblique/underside views |
| Reprojected bevel detail produced black wedges and doubled edges | Preserve geometric frame shading and bake the slats/relief onto the appropriate surfaces |

Accepted visual tradeoffs include harder vent-frame edges, flatter small
protrusions and the earlier proof's smaller, sharper launcher circles compared
with the source. Baked circles and slats have no physical depth/parallax. The
launcher render face must not be used as a projectile collision mesh. The pod
retains source units and socket-local coordinates; gameplay-size images are
camera-scale estimates, and hardware frame time has not been measured.

## Resume the remaining Warden work

1. Restore LFS assets and run the asset verifier using the authoring commands.
   Read `approved-stage6.json` and `approved-pod-optimization.json`. Reproduce or
   inspect the approved pod with the retained inputs and documented tools before
   using its method on another component.
2. Inventory the remaining stage 6 shared chassis and modules under
   `assets/warden/components/`. Record feature decisions, protected interfaces
   and expected camera sizes. Choose the next component from that measured
   inventory; do not assign every part the pod's reduction ratio. The current
   [Warden inventory and component sequence](chassis/warden/optimization-plan.md)
   records the retained source costs and next component priorities.
3. Produce isolated component candidates using this procedure. Preserve the
   exact shared-body/module ownership and approved motion envelope. Use the pod
   as an approved reference while keeping its source dependencies available.
4. Assemble the optimized parts with the retained variants and motions. Verify
   shared identity, placement, empty mounts, articulation, aiming and firing
   contracts. Carry forward the accepted stage 6 contacts and limitations; report
   new or worsened interference. Establish the whole-model material/texture
   budget and consistent scale/orientation before presenting the complete stage
   7 derivative.
5. Complete stage 8 in the real runtime, then exercise the process on another
   chassis for stage 9. Preserve logical bank anchors separately from physical
   exits. Warden's eight physical launcher exits still require mapping to the
   production six-tube rig without silently changing salvo size.

PR 67 remains draft and open for the unfinished process. The approved pod closes
its component proof only; it does not complete stage 7 for the full Warden or
authorize production replacement.
