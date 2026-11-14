# Remaining Warden stage 7 work

This inventory starts from PR 67 head
`e2831f809101a234c2cf8b83077f62a5319689e5`. The live PR and remote branch
matched that handoff on resumption. All 107 retained files verified after LFS
restoration. The approved own-left pod passed its retained-export verifier:
922 triangles, nine unchanged anchors, 40 clear outgoing samples, exact mounting
boundary and matching underside coverage. That proof remains isolated.

## Measured source cost

Run from the checkout root:

```sh
python3 scripts/mech-design/inventory-warden-components.py \
  --repo "$PWD" --output design/mechs/generated/stage7-inventory.json
```

The command verifies all 21 retained GLBs against the asset manifest. Its ignored
JSON contains per-node geometry fingerprints, parent ownership, source hashes,
sections, vertex/index bytes and encoded payload. All three chassis exports have
identical geometry fingerprints and parent ownership. Motion transforms and
animation payload remain specific to each package. These counts describe the
sole exported LOD and default scene; they are not runtime draw calls.

| Chassis assembly | Triangles | Mesh instances / sections |
| --- | ---: | ---: |
| Torso and cockpit | 44,657 | 19 |
| Own-left gun | 15,726 | 8 |
| Own-right gun | 16,034 | 8 |
| Own-left shoulder housing, collar and supports | 15,397 | 5 |
| Own-right shoulder housing, collar and supports | 14,624 | 5 |
| Pelvis | 9,125 | 7 |
| Own-left thigh | 11,190 | 8 |
| Own-right thigh | 11,103 | 9 |
| Own-left shin and shin-owned guard/axle | 8,572 | 10 |
| Own-right shin and shin-owned guard/axle | 10,535 | 11 |
| Own-left foot | 12,048 | 10 |
| Own-right foot | 12,361 | 9 |
| Eight independently driven piston barrels/rods | 736 | 8 |
| **Shared chassis total** | **182,108** | **117** |

| Socket-local module | Triangles | Sections | Encoded GLB bytes |
| --- | ---: | ---: | ---: |
| Own-left launcher | 5,400 | 1 | 99,500 |
| Own-right launcher | 5,374 | 1 | 99,048 |
| Own-left energy | 4,021 | 2 | 75,592 |
| Own-right energy | 4,110 | 2 | 77,200 |
| Own-left empty cover | 220 | 1 | 12,608 |
| Own-right empty cover | 220 | 1 | 12,612 |

| Equipped configuration | Triangles | Sections | Sum of walk GLB bytes |
| --- | ---: | ---: | ---: |
| A: two launchers | 192,882 | 119 | 4,886,416 |
| B: two energy cartridges | 190,239 | 121 | 4,840,660 |
| C: left energy / right launcher | 191,503 | 120 | 4,862,508 |
| Empty shoulders, ballistic guns retained | 182,548 | 119 | 4,713,088 |

The walk chassis alone is 4,687,868 bytes, including animation and metadata;
4,576,704 bytes are vertex/index data counted per mesh instance. The retained
stage 6 source has one compatible material treatment and no texture images.
Standalone module files instantiate materials separately; final consolidation
is still required. Empty covers have no assigned glTF material and use loader
defaults. The approved left pod instead uses two materials and four images,
1,298,608 encoded bytes and approximately 13.33 MiB for RGBA8 maps with mipmaps.
Those costs must be counted when assembling the derivative.

## Prioritized component sequence

1. **Own-right pod housing/collar and launcher — component proof approved.** Its isolated source is 16,500
   triangles: 11,062 housing, 64 collar and 5,374 cartridge. Use its actual source
   and mounting boundary rather than mirroring the approved left export. Keep
   housing ownership on the shared chassis and the cartridge socket-local.
   Mounting supports remain outside the isolated proof. The selected 914-triangle
   export is retained in `assets/warden/optimization/right-pod/`, with approval in
   `approved-right-pod-optimization.json`. Complete reassembly remains outstanding.
2. **Ballistic guns, one side at a time.** Together they cost 31,760 triangles
   and 16 sections. Keep real barrel bore depth, lip boundaries, firing exits,
   trunnions, attachment joints and significant protrusions. Rebuild broad
   housing panels and barrel sections; bake shallow seams, fasteners and
   individual decorative cooling fins only where reviewed angles permit it.
   Preserve the accepted gun/leg and gun/support contact limitations.
3. **Torso/cockpit, then shoulder supports.** This is the largest shared cost.
   Split review along existing rigid ownership rather than replacing the entire
   anatomy at once. Keep cockpit profile, waist bearing, shoulder roots, gun
   connections and structural vent surrounds. Rebuild armor planes and chamfers;
   bake small latches, rivets and shallow seams. Supports have 4,175 left and
   3,498 right triangles after excluding housing/collar. Their complete shape
   and attachment boundaries must survive.
4. **Pelvis and legs, one rigid assembly at a time.** Preserve unsplit exterior
   guards, original large ankle axles, shin-owned front guards, foot contacts,
   joint gaps, piston endpoints/stroke and reviewed motion envelope. Rebuild
   structural armor and joint sections; bake small surface relief. Existing
   92-triangle axles/actuator pieces are low priority and may remain unchanged.
5. **Energy cartridges and empty covers.** Keep emitter depth, optic silhouette,
   socket fits and physical/logical origins. Rebuild cartridge panels and bake
   shallow detail. Empty covers are already cheap; verify their treatment with
   the optimized shared housing before spending geometry effort on them.
6. **Assemble and validate the complete derivative.** Recheck A/B/C/empty across
   walk/run/backward, independent aiming, anchors, opening coverage and outgoing
   clearance. Compare new interference with accepted stage 6 contacts. Resolve
   shared atlases/materials and normalize scale/orientation consistently across
   body and modules before requesting whole-model stage 7 acceptance.

Nothing is classified as removable hidden geometry yet. Any removal requires
proof across motion, swivel/aim, module swaps, empty mounts and reviewed camera
angles. No blanket triangle-reduction percentage or whole-model triangle target
is assigned.

## Review conditions and budgets

Use the retained camera-scale contract for initial isolated comparisons. It
estimates 125.976 pixels per source unit at default zoom and 314.940 at maximum,
height-matched to a 1280×720 production camera. A complete 0.96248-source-unit
Warden would be approximately 121 / 303 pixels high before projection effects;
individual component extents and projected size vary. These are estimates, not
runtime captures or an accepted integration scale.

For context, projecting the retained walk chassis at its initial pose along the
declared camera direction gives the following approximate component rectangles.
These include each assembly's full mesh extents, ignoring occlusion; shoulder
rows include the supports and exclude the interchangeable cartridges.

| Assembly | Default estimate, pixels | Maximum estimate, pixels |
| --- | ---: | ---: |
| Torso | 68 × 58 | 169 × 144 |
| Guns, left / right | 65 × 48 / 59 × 48 | 161 × 119 / 149 × 120 |
| Shoulders, left / right | 43 × 46 / 42 × 48 | 106 × 116 / 105 × 120 |
| Pelvis | 39 × 31 | 98 × 77 |
| Thighs, left / right | 33 × 38 / 39 × 38 | 83 × 96 / 96 × 96 |
| Shins, left / right | 33 × 40 / 30 × 42 | 81 × 101 / 75 × 105 |
| Feet, left / right | 49 × 34 / 48 × 36 | 123 × 84 / 120 × 89 |

Every candidate needs its own explicit feature/attachment contract, structural
views with baked detail disabled, bake-source and projection diagnostics,
export validation, matched front/rear/both sides/underside/oblique views and
default/maximum size estimates. Preserve source hashes and exact owner-reviewed
exports. New candidates and evidence stay under ignored `generated/`; only
selected advancing results and necessary provenance may be retained.

For the next pod candidate, evaluate the existing 1024-square housing normal and
base-color maps plus 512-square cartridge maps as a comparison starting point,
not a whole-model allocation. Record sections, material count, texture dimensions,
RGBA8/mipmap assumptions and encoded bytes separately. Review atlas reuse and
lower resolution on the assembled model before settling the whole-model budget.
Representative crowds, hardware frame time and final texture formats belong to
stage 8 measurements; triangle counts do not prove performance improvement.

Baked launcher circles have no physical depth. The flat render face must never
become the projectile collision mesh. Preserve all eight physical exits and
logical bank anchors; mapping eight exits to the production six-tube rig remains
stage 8 and must not change salvo size silently. This work leaves production
runtime assets unchanged, PR 67 draft/open, and stages 7–9 incomplete.
