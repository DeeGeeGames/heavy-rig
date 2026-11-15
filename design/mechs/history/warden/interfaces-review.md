> Historical dense-master checkpoint. Continue from the [selected P2 package](../../assets/warden/game-ready/README.md) and [modularity proof](../../assets/warden/game-ready/modularity-proof.md). See the [history index](README.md) for restoration. Statements below describe this checkpoint, not current pending work.

> Historical stage 6 acceptance is in [approved-stage6.json](../../chassis/warden/approved-stage6.json). Component exports are archived in Git history; editable interfaces and essential review evidence remain retained.

# Warden weapon interfaces v1

Status: empty shoulder cover approved by owner; frozen in `approved-interfaces.json`. No production asset replacement.

Source: `approved-front-guard.json` (approved v10 shin-owned lower front guard). Recipe: `scripts/mech-design/blender/weapon_interfaces.py`. Historical artifacts: `design/mechs/assets/warden/interfaces/` (`interfaces.blend`, `interfaces.json`, `motion-validation.json`, A/B/C/empty PNGs). Only `empty.png` remains retained from those views.

The same shoulder socket accepts a launcher cartridge, energy cartridge, or blank cover. Rear housings, supports, guns, and chassis remain shared. Coordinates are Blender Z-up, -Y forward, +X own-left; source scale is not yet normalized to game units. Socket origins are neutral source coordinates `(±0.251, 0.12, 0.89)` under shoulder pivots `(±0.22, 0.18, 0.76)`.

Checkpoint gameplay mapping, checked against `src/hardpoints.ts`:

| Assembly | Warden A | Warden B | Warden C |
| --- | --- | --- | --- |
| Own-left gun | ballistic / left-gun | ballistic / left-gun | ballistic / left-gun |
| Own-right gun | ballistic / right-gun | ballistic / right-gun | ballistic / right-gun |
| Own-left shoulder | launcher / left-shoulder pod | energy / left-shoulder bank | energy / left-shoulder bank |
| Own-right shoulder | launcher / right-shoulder pod | energy / right-shoulder bank | launcher / right-shoulder pod |

The blank cover is an empty-mount treatment, not a fourth purchasable variant. Its chamfered plate fits the common front envelope. It is the only new exterior geometry in this candidate.

Validation: all 123 original meshes retain their world transforms across 91 walk frames, maximum matrix-component difference 8.81e-8. Initial reparent drift is below 5.97e-8. Approved source files are unchanged. This verifies preserved placement/motion, not collision clearance.

Muzzle anchors are provisional: gun origins estimate terminal barrel-rim centers; shoulder origins represent a whole bank. Individual launcher tube exits, exact firing clearance, runtime axis conversion, physical dimensions, and exported component consistency remain unverified. Do not treat these anchors as production firing origins yet.

After the accepted cover and component export checks below, finalize muzzle placement and update the motion package, then optimize the shared body and each module once. Preserve the approved gait and guard ownership throughout.

## Component export validation

`package_components.py` exports one animated `chassis.glb` and six rigid, socket-local GLBs (left/right energy, launcher, and empty covers) to an ignored candidate directory; the validated exports are now archived, indexed by [archived-outputs.json](../../assets/warden/archived-outputs.json). The chassis keeps the common guns, housings, body, and walking rig. Shoulder muzzle anchors travel with their respective modules. Export helper names end in `__export`; consumers restore the names listed in `package.json` when attaching modules to named sockets.

In a separate checkout at the archive revision, run `bun scripts/mech-design/verify-components.ts design/mechs/assets/warden/components/walk`. The historical verifier loads the actual GLBs with Three.js, assembles A/B/C/empty states, checks the live gameplay mount IDs/families, and compares source world matrices over the package frame range. The historical 91-frame interface package passed all four states; maximum matrix-component error was 1.51e-6. It also rejects absent modules, missing sockets, leaked selected-module nodes, unexpected module animations, and incorrect clip duration/timing.

These are unoptimized authoring exports: the chassis is approximately 4.5 MiB and cartridges approximately 2–100 KiB each. No production game integration or performance claim is implied. The check establishes transform/animation fidelity and evaluated triangle counts, not exact topology identity, material appearance, muzzle clearance, physical scale, or optimized visual acceptance. The original cover approval and shin-owned guard remain unchanged.

At this historical checkpoint the next phase was exact firing origins, module clearance and game-scale conversion before optimization. Those stages are superseded by the selected P2 continuation; comparison exports are recoverable from the archive revision.

Independent review caught omitted bevel modifiers in the initial v1 export. Revision v2 applies modifiers and checks every expected mesh against its evaluated source triangle count, and rejects unexpected exported meshes. The approved empty cover retains its bevel. Revision v1 is superseded.
