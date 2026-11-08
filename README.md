# Heavy Rig · Frontier Company

A browser-only isometric mech-combat game with a persistent mercenary company.
Command the HRV Wayfarer, purchase frames and weapons, schedule repairs and
refits, accept faction contracts, and extract from surface missions. Persistent
throttle and independent turret tracking remain the combat core.

A new company starts on **day 1 at Meridian with zero credits and one Kestrel**,
its Rattler machine gun fitted in mount 1. Its second machine-gun hardpoint is empty.
Campaign missions and a separate Frame Training simulator are the playable modes.

The game opens on a console-style title menu with a rendered Wayfarer hangar.
Choose **Start Company** on a fresh device or **Continue Company** to board the
ship with existing progress. Frame Training, Settings, and the Pilot Handbook
are also available here. Up/down or Tab selects a menu item; Enter confirms.
Controller and touch prompts follow the active input device. The bridge's
**Title Screen** button (or Escape on the bridge) returns without resetting
company progress. Training entered from the title can return directly to it.

## Company operations

The ship has four departments, with company funds and the calendar visible
throughout:

| Screen | Purpose |
| --- | --- |
| Contracts | Plot travel, review faction standings, accept work, and inspect the mission briefing. |
| Mech Bay | Select an owned frame, inspect its condition, plan chassis-specific weapon hardpoints, and deploy. |
| Market | Spend contract earnings on weapon copies or additional frames with their signature weapons included. |
| Engineering | Schedule repairs, inspect or cancel work orders, and advance calendar days. |

Each chassis can be purchased once. Purchases arrive immediately; installing or
moving weapons requires a refit. Weapons are physical inventory copies shared
across the fleet: a fitted or reserved copy cannot also be installed on another
frame. Buying a second copy permits fitting the same weapon family twice.
Weapons and their mount positions persist between sorties. Empty mounts do not
shift another weapon's keyboard, mouse, touch, or controller binding.

Choose a mount in the Mech Bay, select an owned weapon or empty slot, then queue
the refit. Staged changes show their duration and completion date before they
are scheduled. Each changed mount takes **one calendar day**: moving a gun from
mount 1 to empty mount 2 changes two mounts and takes two days. The installed
loadout stays unchanged until the work finishes. Both outgoing and incoming
hardware remain reserved during the job. Canceling restores availability of the
incoming parts and keeps the original loadout; elapsed days are not refunded.

Damage also persists. Engineering crews restore a frame to full integrity in
**one day per 20 missing integrity, rounded up**. A frame at 65% needs two days;
a destroyed frame needs five. Repairs have no credit fee, so a damaged starting
Kestrel can recover even when the company has no money. Repair completion is
applied on the due day, rather than healing a little each real-time second.

A frame can have one repair or refit order at a time and cannot deploy while
that work is underway. Different frames have separate crews and work in
parallel. A damaged frame above 0% can deploy if it has at least one installed
weapon. A destroyed or unarmed frame cannot deploy. The Mech Bay requires staged
loadout edits to be queued or discarded before launch.

Engineering can advance one day or wait until the next scheduled completion.
Travel and mission settlement also advance work by one day. Waiting does not
charge credits or refresh contract postings. Calendar time does not advance
while the browser is idle. An accepted but undeployed contract can remain open
while the crew finishes work; company changes and calendar advancement are
locked during a deployment.

## Contracts and surface missions

The star map connects Meridian's dusty badlands, Cinder's volcanic flats, and
Borealis's frozen basins. A jump takes one day, costs no fuel, and refreshes the
contract board. Remote listings preview the postings available after arrival.
An accepted contract must be completed or aborted before traveling.

The Frontier Freeholds, Ferric Combine, and Signal Accord post work against
one another. The briefing shows both sides, payment, and reputation changes
before acceptance. Acceptance immediately costs 6–10 opposition reputation.
Successful extraction earns 8–12 employer favor and the posted payment. Failure
or abort earns neither and retains the original opposition penalty. Reputation
is bounded to −100…100, modifies offered payment, and gates higher-tier work
after the first two wins. Entry-tier contracts remain available even with
hostile factions. Credits are spendable company funds.

| Contract | Surface objective |
| --- | --- |
| Garrison defense | Keep the contracted relay alive through a finite assault. |
| Facility demolition | Destroy the marked installation; surviving guards are optional. |
| Priority target | Destroy the designated command frame; surviving escorts are optional. |
| Area clearance | Eliminate every hostile across three deployment sites. |

Completing the objective opens extraction. Reach the marked landing zone and
remain within 150 meters for three uninterrupted seconds. Combat and incoming
ordnance continue; frame destruction or loss of a defended relay still fails the
contract. Every weapon family can damage facilities.

Contract seeds generate bounded fields 4,200–4,800 by 3,000–3,600 meters. Drop
side, objective and patrol sites, extraction point, and low terrain landmarks
vary. Scenery is traversable; it provides no collision cover. Radar and edge
markers show actual map bounds, the active objective, and extraction.

A sortie uses the selected frame's saved integrity and installed weapons. There
are **no random weapon drafts, combat repair/coolant pickups, or field-service
upgrades**. Every deployment carries two coolant charges. Cooling and venting
manage reactor heat; neither repairs frame damage. Difficulty settings affect
the next deployment's hostile armor and damage.

Damage and spent coolant are checkpointed during combat. Aborting retains the
frame and equipment at their current condition and takes one recovery day.
Reloading during a deployment recovers the frame, aborts the contract, preserves
saved damage, and advances that same recovery day once. Reload does not resume
the battlefield or grant a fresh frame. Accepted contracts that have not yet
deployed survive reload without a second acceptance penalty. Success pays once;
subsequent reloads do not duplicate rewards.

## Frames

| Frame | Ownership / price | Role / included weapon | Cruise / reverse | Cooling | Tradeoff |
| --- | --- | --- | --- | --- | --- |
| Kestrel 21 · 40T | Starting frame | Skirmisher / Rattler | 125 / 65 m/s | 10 heat/s | Fast tracking and acceleration; takes 30% more damage |
| Warden 08 · 80T | 5,000 CR | Line fighter / AC/38 | 90 / 48 m/s | 12 heat/s | Balanced armor and handling |
| Longbow 16 · 65T | 6,000 CR | Precision gunner / Tempest | 86 / 42 m/s | 15 heat/s | Strong cooling; slow tracking and 12% more damage |
| Morrow 52 · 70T | 6,500 CR | Missile support / Trident | 88 / 48 m/s | 12 heat/s | Guided area fire; takes 10% more damage |
| Maul 34 · 100T | 7,500 CR | Brawler / Hailstorm | 82 / 40 m/s | 11 heat/s | Takes 22% less damage; slow hull and turret traverse |

Hardpoints follow the current model hardware:

| Frame | Hardpoints | Accepted weapons |
| --- | --- | --- |
| Kestrel | Two light ballistic side guns | Rattler machine guns |
| Warden | Two ballistic side guns, two shoulder launchers | Rattler / AC/38 in guns; missiles / rockets in pods |
| Maul | Two forearm launchers | Missiles / rockets |
| Longbow | One energy accelerator arm | ARC laser / Tempest PPC |
| Morrow | Two outboard silos | Missiles / rockets |

The Mech Bay names each location and its allowed weapons. The market shows weapon
families and compatible chassis before purchase. Empty and nonexistent slots cannot
fire; equipment positions retain their matching controls. One pod is one hardpoint,
regardless of its launch-tube count. Geometry and mount-origin rendering are unchanged
in this equipment-foundation pass.

All frames share the same driving and aiming controls. Integrity is a
percentage; each frame's protection changes the damage received. Kestrel uses
an open reverse-jointed silhouette, Maul a broad humanoid stance, Longbow a tall
asymmetric cannon arm, and Morrow an armless twin-silo carrier. Authored hip
heights, knee directions, and planted-foot animation distinguish their motion.
These presentation differences do not change collision shapes.

## Weapons and heat

| Weapon | Price | Base behavior |
| --- | --- | --- |
| Rattler | 500 CR | 8-damage machine-gun tracer every 0.105s; low heat, narrow spread |
| AC/38 | 750 CR | 38-damage cannon shell every 0.65s; precise impact |
| ARC | 800 CR | 56 damage/second laser; continuous first-target beam |
| Lance | 850 CR | 31-damage unguided rocket every 0.42s |
| Needle | 1,000 CR | 25-damage guided missile every 0.48s |
| Hailstorm | 1,200 CR | Five unguided 24-damage rockets every 1.8s; area burst |
| Trident | 1,400 CR | Three guided 30-damage warheads every 2.1s; area burst |
| Tempest | 1,500 CR | 82-damage piercing particle bolt every 1.6s; high heat |

Each mount has its own cooldown. All installed weapons track the same turret
and share reactor heat. Missiles acquire the live target nearest the aim point
within range; a missile whose target is lost continues straight. Rockets keep
their launch heading. Cluster warheads deal 60% of direct damage to nearby
frames; particle bolts hit each pierced frame once.

At 100 heat, weapons lock until heat falls to 35. Frame cooling removes 10–15
heat per second. One coolant charge purges 55 heat; holding the control spends
only one charge, and a cold reactor consumes none. There is no combat resupply.

Enemy equipment follows the same weapon-family rules: scouts carry light ballistic
guns, strikers add shoulder launchers, and siege / command frames retain their
dorsal artillery and existing barrage cadence.

Siege enemies protect their front with a 120-degree armor arc. Flank them or
attack the green **EXPOSED** recovery window for 135% damage. Artillery commits
to fixed orange ground markers; it does not follow the player after firing,
and destroying the shooter does not cancel the incoming rounds. Command frames
use larger barrages that expand below half integrity. Radar, target brackets,
range labels, impact flashes, recoil, and distinct silhouettes communicate the
fight.

## Frame Training

Training uses legal Warden equipment for the gun, missile, and combined-fire drills,
then switches to a Longbow laser for heat and coolant in a separate, unscored simulator. Nine drills cover cruise, neutral, turning, cannon aim,
guided missiles, combined fire, heat, coolant, and artillery evasion. It uses
the same controls and simulation as missions, supports safe retries, and does
not change company equipment, damage, credits, reputation, or calendar days.
Pause can restart or leave training. Completion returns to the ship or the
accepted contract's loadout review.

## Controls

Press A / cross or Menu to claim a connected standard controller. The claiming
press is consumed; confirm again to act. Ownership stays with that controller
when another connects. Losing it pauses combat; a replacement must be claimed
and the mission explicitly resumed. Release sticks and triggers after menu
transitions to arm combat controls.

| Action | Keyboard / mouse | Standard gamepad | Touch |
| --- | --- | --- | --- |
| Raise/lower persistent throttle | W/S or up/down | Left stick up/down | Hold +/− |
| Neutral; momentum decays | X | X / square | STOP |
| Turn hull | A/D or left/right | Left stick left/right | Turn arrows |
| Aim independent turret | Mouse | Right stick left/right rotates torso | Tap battlefield |
| Camera zoom | Mouse wheel | — | — |
| Fire mount 1 | Left mouse / hold 1 or Space | RT / R2 | Hold mount 1 |
| Fire mount 2 | Right mouse / hold 2 or E | LT / L2 | Hold mount 2 |
| Fire mount 3 | Middle mouse / hold 3 or Q | RB / R1 | Hold mount 3 |
| Fire mount 4 | Back/thumb mouse / hold 4 or F | LB / L1 | Hold mount 4 |
| Coolant purge | V | B / circle | Vent coolant |
| Pause / resume | Escape | Menu | Pause |
| Menus | Tab / Shift+Tab / Enter | D-pad or stick, A/cross confirm, B/circle back | Tap |

Hold any combination of firing controls to combine weapons. Empty mounts do
nothing. The mouse thumb binding uses browser button 3; keys provide all four
slots on mice without extra buttons. Browser context menus, middle-click, and
back-button actions are suppressed over the battlefield.

Wheel zoom ranges from 0.5× to 2.5× and keeps the frame centered. It survives
pause and resizing; a new mission or training session restores the default.
Company screens and dialogs fill the available window without scrolling.
Tabs select content panes; Previous/Next buttons page longer content.
Ctrl/Command + wheel retains browser zoom.

The active device changes prompts. Controller use enables the larger interface;
Settings can enable it for keyboard and mouse. D-pad/stick navigation reaches
the tabs and page buttons; left/right adjusts a focused volume slider. Touch controls
activate on touch-first devices or through Settings. Optional recoil/damage
vibration depends on browser and controller support.

**Settings → Controls → Control Mode** selects **Simulation** (default) or
**Arcade**, saved on this device. The table above describes Simulation. In
Arcade, the left stick or WASD / mapped movement keys selects screen-relative
leg facing and forward throttle demand; release returns throttle gradually to
neutral. The right stick selects absolute torso facing, as before. Both modes
retain each chassis’s leg and torso rotation speeds. Mouse aiming works in
both modes, including while moving or firing with a controller. Touch controls
retain persistent throttle and turn arrows in either mode.

In Simulation, releasing throttle keeps the engine setting and releasing the
right stick holds the torso heading. Pause preserves throttle and
clears held inputs; deployment starts in neutral. Focus loss, hidden pages,
controller disconnection, and WebGL context loss pause and silence combat.
Recovery requires explicit resume.

## Presentation and audio

Gameplay uses a deterministic 2D ground simulation with a fixed 60 Hz step.
Three.js and ECSpresso's renderer3D plugin provide isometric presentation,
procedural terrain, layered frame geometry, lighting/shadows, planted-foot gait,
artillery warnings, weapon trails, and pooled effects. Ship departments use
DOM interfaces with responsive layouts and visible focus and selection states.

All five company frames and the scout, striker, siege, and Crown commander now
use shaped low-poly armor, octagonal hardware, and articulated legs in gameplay.
The title scene uses the same redesigned Warden. Existing frame proportions,
gait rigs, and combat handling are preserved. Rigid surfaces use vertex colors and are combined
per articulated assembly; weapon and cooling effects follow their posed anchors.

`models-preview.html` presents all nine production models with walk, reverse,
turn, independent aim, recoil, playback, and orbit controls. `bun run build` also
creates `dist/models-study.html`, a standalone review file that opens offline.
The original `warden-preview.html` and `dist/warden-study.html` remain available
as the approved design reference. Crowd profiling and shared model resources
remain tracked in [performance issue #10](https://github.com/DeeGeeGames/heavy-rig/issues/10).

An original locally synthesized 96-BPM score changes its layers with combat
intensity and uses quieter ship arrangements. Weapon, mechanical, damage,
coolant, artillery, and outcome effects have separate mix controls. Audio starts
after browser activation and reports when a click or key press is required.
Settings include master/music/effects levels, controller vibration, a larger
interface, and optional touch controls.

All gameplay geometry, surface graphics, and music are original to this demo.
The bundled [Barlow Condensed](https://github.com/google/fonts/tree/main/ofl/barlowcondensed)
typeface is by the Barlow Project Authors under the
[SIL Open Font License](./public/licenses/Barlow-OFL.txt). No licensed BattleTech
characters, names, graphics, music, or samples are included.

## Development and verification

Use **Bun 1.3.14**. From this repository:

```sh
bun install --frozen-lockfile
bun run dev
```

Bun's native HTML development server bundles TypeScript, CSS, and fonts with
hot reload. Production validation uses:

```sh
bun run check
bun run preview
```

`check` runs the regression suite, strict TypeScript, ESLint, and a clean
production build. `preview` serves that `dist/` build; use `bun run build` first
when building separately. Both servers default to port 3000; set `PORT` to choose
another. Runtime dependencies are ECSpresso, Three.js, and lit-html. The game has
no backend, desktop packaging, or Steam integration.

TypeScript enables strict checking, checked indexed access, exact optional
properties, explicit index-signature access, unused/dead code checks, checked
side-effect imports, and erasable syntax. Lint rejects `any`, non-null
assertions, and unchecked type assertions.

Regression coverage includes purchases and inventory reservations, repair/refit
completion and cancellation, persistent damage and interrupted deployment,
zero-credit recovery, calendar/contract separation, corrupted saves, seeded
missions and extraction, stable weapon-slot inputs, heat, projectile behavior,
artillery, movement, rendering disposal, and controller recovery. Training
coverage includes completion, safe retries, combined fire, and artillery escape.

The production-browser evidence in [`docs/company-validation.json`](./docs/company-validation.json)
covers purchases, refits, calendar completion, deployment, damage, abort/reload
recovery, zero-credit repairs, concurrent-tab conflicts, responsive screens,
and simulated keyboard/controller/touch input. The `docs/company-*.png` captures
show the new screens; older captures predate this progression. Funded and
destroyed-company scenarios use explicit domain fixtures, and real combat
damage was separately exercised through browser inputs. Automated inputs and passing
checks do not establish physical controller/touch feel, audio listening quality,
GPU performance, combat balance, or owner acceptance.

Title-menu and settings verification is recorded in
[`docs/title-validation.json`](./docs/title-validation.json), with production
captures in `docs/title-*.png` and `docs/settings-desktop.png`. It covers first
load and continue, focus restoration, training return, preserved preferences
and company progress, and simulated keyboard/controller/touch input.

Viewport validation is recorded in [`docs/viewport-validation.json`](./docs/viewport-validation.json).
It covers every department pane/page with a full fleet and work orders, large
interface mode, simulated controller loss, and long status messages. It also
covers purchase/refit/deploy/abort/travel journeys, focus restoration, all
Settings/Handbook pages, and dialog geometry. End-report and save-conflict layout
checks use fixtures. Screenshots: [`desktop`](./docs/viewport-desktop.png),
[`portrait`](./docs/viewport-portrait.png), and
[`landscape`](./docs/viewport-landscape.png).

## Hosting and save compatibility

Play at [heavyrig.deegeegames.com](https://heavyrig.deegeegames.com/).
Source: [DeeGeeGames/heavy-rig](https://github.com/DeeGeeGames/heavy-rig).

Bun's production HTML build emits relative, hashed assets and copies `public/`,
`CNAME`, and `.nojekyll` into `dist/`. CI runs tests, typecheck, lint, and build.
The Pages workflow deploys `master` after the complete check. Pull requests must
satisfy live branch protection; workflow definitions alone do not establish
merge readiness. The custom domain is configured in `CNAME`.

Company progression uses **`heavy-rig:campaign:v3`**. Version 3 deliberately
starts a fresh company with chassis-specific hardpoints. Earlier company saves
are left untouched and are not loaded; no loadout migration is provided. Preferences remain under `heavy-rig:profile:v1`; historical classic
records in that profile are retained but the classic operation is no longer a
playable mode.

Saves are browser-local and scoped to the origin. If another tab changes the
company save, the stale tab stops play and requires reloading before it can
write again. Opening another tab during deployment recovers that sortie as an
abort; use one active company tab. Invalid company transactions
reset the campaign as a unit. If storage is unavailable, play continues for the
current session with a visible warning. Saves from the earlier Iron Wake on
experiments.deegeegames.com are not transferred automatically.

Heavy Rig was extracted from DeeGeeGames/playground at commit
`7e255d2b0676c80a79206f0a55c492d4b83cc692`, where it was named Iron Wake.
