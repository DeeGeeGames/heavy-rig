# Game optimization procedure

Stage 7 builds a game derivative from the selected source. Measure its actual
geometry, sections, textures and expected scene use before choosing the work.
Keep acceptable geometry near budget and repair expensive or visibly defective
features selectively. Rebuild structural meshes and bake detail when that work
has a demonstrated benefit. Use this procedure with
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

## Reused Warden pod modules

The approved left/right pod packages retain editable bake sources, selected GLBs,
source comparisons and complete matched review views. They are reusable inputs
to the current derivative; their isolated reduction percentages and original
texture sizes are not whole-mech targets. See the
[component approvals](chassis/warden/approved-pod-optimization.json),
[right-side approval](chassis/warden/approved-right-pod-optimization.json) and
[authoring commands](../../scripts/mech-design/blender/README.md).

The useful repairs from those proofs are retained below.

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

## P2.0 source with retained optimized modules

The selected Warden A route starts from an original-reference
P2.0 50K source rather than globally reducing the accepted dense master. The
selected source returned 44,793 triangles. It is frozen under
`assets/warden/game-ready/source.glb`; the explicit recipe and runtime candidate
are documented in [the game-ready package](assets/warden/game-ready/README.md).
The current exact revision has owner visual approval and remains opt-in until
in-game acceptance. Its budget and feature rules are specific to Warden.

Reuse the approved pod geometry and bakes as modules when fitting permits.
Small bounded fitting adjustments, a shared atlas and scoped collar reduction
reach the requested 30K–40K range without a whole-model collapse pass. Retarget
the existing gait recipe to measured new pivots and actual sole geometry.
Derive visual and combat firing origins from the same graph; eight visible
launcher cells still map to six gameplay slots.

Observed integration repairs are part of this recipe:

- Joining UV-mapped pods to untextured supports initially lost the active render
  UV selection and exported `texCoord: -1`. Name/select the UV layer explicitly
  and validate the actual export. A successful file write is insufficient.
- Raw captured vent relief produced visible depth speckling in WebGL despite
  acceptable Cycles renders. The unquantized control confirmed source overlap.
  Rebuild explicit separated louvres and backing planes while retaining frames;
  do not conceal geometry problems with camera clipping or shading settings.
- Normalize the horizontal runtime origin to the waist pivot before extracting
  weapon rigs. Otherwise torso swivel and combat-origin rotation use different
  centers, visibly separating mounts from the body.
- The authored Warden arms and pods must remain rigidly fixed to the torso.
  Verify constant torso-relative mount transforms through gait bob/tilt, torso
  swivel and target changes. Structural attachment necks remain fixed too; adding
  flexible couplings does not correct unwanted world-space stabilization. Check
  actual skin coverage separately from firing-origin alignment.
- Retained physical anchors can lie behind a new flat baked launcher face.
  Reproject exits just outside that face and keep it out of projectile collision.
- Resolve mount ownership before designing aim math. The Warden ports are rigid
  torso children; derive origins from a shared simulation-owned torso pose.
  Do not add per-weapon gimbals or stabilization to compensate for moving origins.
  Rendering must not become authoritative for projectile spawn positions.

Standard integer attribute quantization and MikkTSpace tangents retain native
GLTFLoader support without an extra decoder. Verify sampled/all-vertex error,
rig matrices, clips, UVs and normals after packing. Preserve empty anchor nodes.
The full recipe has reproduced a selected candidate byte-for-byte; binary
repeatability on this toolchain does not establish cross-chassis repeatability,
owner visual acceptance or hardware frame-time performance.

## Continue from the selected result

1. Restore retained inputs, verify hashes, and use the selected game-ready recipe.
2. Rebuild in a fresh ignored directory and validate the actual exported asset.
   Compare its hash and compact validation results with the selected revision.
3. Generate the standalone study/game preview with the tracked preview builder.
   Record visual approval against the exact export; source, component and whole-
   model approvals have separate scopes.
4. Integrate the selected Warden A for game-camera/lighting, firing, gait and
   representative crowd measurements. Owner appearance/feel and hardware results
   remain separate from automation. Review other module configurations when built.
5. Apply the procedure to a second chassis. Supply its own source-specific recipe
   and feature decisions, then revise the process using the observed work.

## Lessons from superseded routes

The detailed-source and simplified-source experiments did not justify treating
triangle reduction as the sole definition of game readiness. Compare geometry
memory, material sections, texture storage and hands-on repair time. A smaller
GLB alone does not prove lower runtime cost. For this Warden, a near-budget source
plus selected module reuse/repair produced the accepted result with less broad
reconstruction. This remains a chassis-specific observation.

World-space weapon stabilization and flexible connectors were discarded. Resolve
rigid ownership first: torso carries arms/pods; shin carries ankle guards; foot
carries toe/sole/bearing. Verify those relationships through motion before adding
aim corrections. Use shared simulation-owned pose data for firing origins.

The old dense-master component sequence is historical. Its derivative exports
and full traces are recoverable from [the archive index](assets/warden/archived-outputs.json).
Do not resume that sequence as the default next task. Retained editable masters,
approved pod bake inputs and the gait implementation preserve the useful work.
