# Heavy Rig · Frontier Company

A browser-only isometric mech-combat game with a persistent mercenary company.
Command the HRV Wayfarer, purchase frames and weapons, schedule repairs and
refits, accept faction contracts, and extract from surface missions. Persistent
throttle and independent turret tracking remain the combat core.

A new company starts on **day 1 at Meridian with zero credits and one Kestrel**,
its Rattler machine gun fitted in mount 1. Its second machine-gun hardpoint is empty.
Campaign missions and a separate Frame Training simulator are the playable modes.

New companies begin with a black-screen prologue, a choice of Kestrel or Longbow,
and a short escape from the northwest Rig Bay to a southeast evacuation point.
Each narrative line types at ten characters per second with terminal chirps, holds
for two seconds, and fades over one second. A first-input prompt enables browser
audio before typing begins. The selection cards preview each actual rig model.
Controls appear during live play; alarms sound through the escape, whose map now
covers three times the original area with six guards along the route. Hold the
green evacuation zone for three seconds to finish.
The borrowed rig, combat damage, and kills do not carry into the company.
Completion is saved per company; completed v4 companies bypass the prologue. REPLAY ESCAPE
on the title menu repeats the full sequence without changing company progress.

Completing the escape boards the Wayfarer directly at the company bridge and
contract board. On later launches, the game opens on a console-style title menu
with a rendered Wayfarer hangar. Choose **Continue Company** to board the ship
with existing progress. Frame Training, Settings, and the Pilot Handbook
are also available here. Up/down or Tab selects a menu item; Enter confirms.
Controller and touch prompts follow the active input device. Escape or the
controller's east face button opens a confirmation to return to the title from
any company department without resetting company progress. Training entered
from the title can return directly to it.

## Company operations

The ship has four departments, with company funds and the calendar visible
throughout:

| Screen | Purpose |
| --- | --- |
| Contracts | Plot travel, review faction standings, accept work, and inspect the mission briefing. |
| Mech Bay | Select an owned frame, inspect its condition, plan chassis-specific weapon hardpoints, and deploy. |
| Market | Spend contract earnings on weapon copies or additional frames with their signature weapons included. |
| Engineering | Schedule repairs, inspect or cancel work orders, and advance calendar days. |

**LB/RB** switches departments; **LT/RT** switches pages within a department.
Keyboard equivalents are **Q/E** and **Z/C**. The button key along the bottom
shows the focused action, Back, button guide (**Y / triangle / H**), and Discard
Draft (**X / square / X**) when a refit is staged. D-pad, left stick, or arrow
keys move focus; longer content uses visible Previous/Next page buttons.
Pages remember their focus and refit drafts survive department changes.
Purchases, work orders, calendar advances, travel, contract acceptance, and
deployment show a confirmation with their cost or consequences first.

Each variant can be purchased once; multiple variants of a chassis can be owned together. Purchases arrive immediately; installing or
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

The Mech Bay keeps a color-coded hull gauge visible on every page, including
phones: green for intact, amber for damaged, and red for critical or disabled
frames. Use **Repair** beside the gauge to queue work directly; its button shows
the required days and zero-credit cost before the usual confirmation.

A frame can have one repair or refit order at a time and cannot deploy while
that work is underway. Different frames have separate crews and work in
parallel. A damaged frame above 0% can deploy if it has at least one installed
usable weapon with ammunition, or an energy weapon. A destroyed, unarmed, or completely dry frame cannot deploy. The Mech Bay requires staged
loadout edits to be applied, queued, or discarded before launch.

Engineering can advance one day or wait until the next scheduled completion.
Travel and mission settlement also advance work by one day. Waiting does not
charge credits or refresh contract postings. Calendar time does not advance
while the browser is idle. An accepted but undeployed contract can remain open
while the crew finishes work; company changes and calendar advancement are
locked during a deployment.

Ammunition reserves are selected per mount in the Mech Bay. Ammunition-only
changes take **zero credits and zero days**; changes to fitted hardware retain
the refit timing above. Pending refits keep their own desired reserves until
completion. Every new sortie loads the selected quantities for free, including
after failure, abort, or interrupted deployment. Remaining battlefield rounds
are runtime state and never replace the ship's desired load. No ordinary sortie
replenishes ammunition in combat.

## Contracts and surface missions

The Starmap charts **75 seeded systems** across the Wayfarer Reach. The Frontier
Freeholds, Ferric Combine, and Signal Accord hold contiguous territories with
irregular borders; outer systems can remain unclaimed. Select a star to inspect
its controller, biome, and conflict status. Orange dashed rings mark conflict
zones. Zoom with the controls or wheel, drag to pan, and use Intel's conflict
buttons to cycle active fronts. Keyboard/controller focus reveals offscreen
systems when zoomed. Phone layouts open system Intel as a separate page.

Borders evolve with calendar days, including Engineering waits. A successful
sortie adds six local influence to its employer and removes six from the opponent;
a failure or abort applies three in the opposite direction. Influence is bounded
to ±18 per faction per system, spreads to nearby space, and persists across reloads.
Calendar pressure is bounded and does not erase mission influence. Repeated wins
can change system control or quiet a front; new conflicts can open elsewhere.
These are initial campaign rules, with balance still requiring playtesting.

Only conflict zones post new missions. The two factions with competing local
influence supply employers and opponents; briefings describe their settlement,
industrial, or relay interests. Quiet interiors and unclaimed systems away from
a contested front have no military work. Accepted contracts keep their factions,
objective, and payment even as time moves the border. Unaccepted listings follow
the current front. A jump takes one day, costs no fuel, and refreshes the board;
remote listings preview postings after arrival. An accepted contract must be
completed or aborted before traveling.

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

Hostile forces combine Scout, Striker, and Siege mechs with helicopters, missile
VTOLs, and tanks. Helicopters circle at gun range; VTOLs strafe at standoff range
and fire guided missiles. Tanks advance slowly and track targets with a separate
cannon turret. Their frontal hull armor rewards flanking, even while the turret
turns. Aircraft remain targetable with every weapon family; aim at their visible
bodies or lead their movement. Air contacts use hollow cyan radar markers. The
priority command target remains a Siege mech. Seeded mission layouts and hostile
counts are unchanged; each roster now includes ground and air vehicles.

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

## Frames and variants

The fleet contains six chassis with three separately purchasable variants each.
Existing rigs are A variants and retain their saved IDs, equipment, reserves,
condition, and workshop orders in campaign v4. Each variant has its own crew and
condition; shared weapon inventory still prevents double allocation. Purchases
include one signature weapon, not a fully fitted example loadout.

| Chassis | A | B | C |
| --- | --- | --- | --- |
| Kestrel | Skirmisher: 2 light B | Spark: light B + compact E | Harrier: light B + compact L |
| Warden | Line: 2B + 2L | Battery: 2B + 2E | Combined: 2B + E + L |
| Maul | Breacher: 2L | Breaker: 2B | Furnace: B + E |
| Longbow | Marksman: E | Rifleman: B + compact E | Overwatch: E + compact L |
| Morrow | Salvo: 2L | Prism: 2E | Convergence: E + L |
| Rook | Raider: 2B + compact L | Flare: 2E + compact L | Ranger: B + E + compact L |

B means ballistic, E energy, and L launcher. Light ballistic mounts accept only
Rattler; compact energy mounts accept only ARC; compact launchers accept only
two-round rocket/missile weapons. Full mounts retain their family weapon choices.
Longbow B/C include 3T of permanent auxiliary structure, even with an empty
secondary mount. They ship with a Rattler and ARC respectively to keep their
starter loads mobile; fitting a cannon or particle gun adds its full weight.
Rook is a medium three-mount chassis with two underslung arms
and a central dorsal pod: 55T base, 66T recommended operating weight, 95/52 m/s
forward/reverse baseline, 12 heat/s cooling, and 20% increased incoming damage.
These are initial tuning values; weapon mass, reserves, and shared heat determine
the effective mobility and endurance of each fitted variant.

Original A-variant specifications:

| Frame | Ownership / price | Role / included weapon | Cruise / reverse | Cooling | Tradeoff |
| --- | --- | --- | --- | --- | --- |
| Kestrel 21 · 40T | Starting frame | Skirmisher / Rattler | 125 / 65 m/s | 10 heat/s | Fast tracking and acceleration; takes 30% more damage |
| Warden 08 · 80T | 5,000 CR | Line fighter / AC/38 | 90 / 48 m/s | 12 heat/s | Balanced armor and handling |
| Longbow 16 · 65T | 6,000 CR | Precision gunner / Tempest | 86 / 42 m/s | 15 heat/s | Strong cooling; slow tracking and 12% more damage |
| Morrow 52 · 70T | 6,500 CR | Missile support / Trident | 88 / 48 m/s | 12 heat/s | Guided area fire; takes 10% more damage |
| Maul 34 · 100T | 7,500 CR | Brawler / Hailstorm | 82 / 40 m/s | 11 heat/s | Takes 22% less damage; slow hull and turret traverse |

Frame tonnage above is **base chassis mass**, including fixed equipment.
Recommended operating weights are Kestrel **44T**, Warden **92T**, Longbow **73T**,
Morrow **86T**, and Maul **114T**. Installed weapons and remaining ammunition add
to base mass. At the recommendation, cruise and reverse use the listed speed.
Underweight speed receives a modest bonus capped at 15%; overload is steeper:
150% of recommended weight gives 50% speed, with a 35% minimum. Overweight
deployment is allowed. Expending rounds reduces weight and updates both forward
and reverse top speed; player acceleration still smooths velocity changes.
These are first-version balance values. The default 240-shell AC reserve was
raised after an ideal-hit tier-one clearance check exhausted the initial
160-shell load; the 92T Warden recommendation keeps its starter load at baseline
speed. Real combat accuracy and owner balance playtesting remain separate checks.

Original A-variant hardpoints:

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

Select the closest visible hostile with **T / right-stick click**, or cycle visible
hostiles with **Tab / Y (Triangle)**. The fire-control buttons offer the same
actions. A selected target is tracked until it leaves view or is destroyed;
move the mouse or aim stick to resume manual aiming. Both bindings can be
changed in Settings. Touch retains its existing closest/next controls.

## Weapons and heat

| Weapon | Price | Base behavior |
| --- | --- | --- |
| Rattler | 500 CR | 8-damage machine-gun tracer every 0.105s; low heat, narrow spread |
| AC/38 | 750 CR | 38-damage cannon shell every 0.65s; precise impact |
| ARC | 800 CR | 56 damage/second laser; continuous first-target beam |
| Lance /2 | 850 CR | Two 31-damage unguided rockets, staggered, every 0.42s |
| Needle /2 | 1,000 CR | Two 25-damage guided missiles, staggered, every 0.48s |
| Hailstorm /2 | 1,200 CR | Two unguided 24-damage rockets every 1.8s; area burst |
| Trident /2 | 1,400 CR | Two guided 30-damage warheads every 2.1s; area burst |
| Tempest | 1,500 CR | 82-damage piercing particle bolt every 1.6s; high heat |

Launchers also have /4 and /6 variants. Each emitted bullet, shell, rocket, or
missile consumes one round. A partly loaded launcher fires only its remaining
rounds; staggered rounds obey heat lock at emission. Already launched ordnance
continues to resolve.

Initial ammunition and hardware tuning, in tonnes:

| Equipment | Hardware | Per round | Default / maximum rounds | Sustained heat before cooling |
| --- | --- | --- | --- | --- |
| Rattler | 2T | 0.001T | 1,200 / 2,400 | 6.7/s |
| AC/38 | 6T | 0.025T | 240 / 480 | 9.2/s |
| ARC | 5T | — | No ammunition | 40/s |
| Tempest | 8T | — | No ammunition | 37.5/s |
| Rocket launchers /2, /4, /6 | 5 / 8 / 11T | 0.018T | 360 / 720 | 1.2 per emitted rocket |
| Missile launchers /2, /4, /6 | 6 / 9 / 12T | 0.025T | 360 / 720 | 1.6 per emitted missile |

Launcher heat rate is heat per round × salvo size ÷ firing interval, with stream
intervals bounded below by 0.1s per round. Even the fastest /6 stream launcher
stays below 17 heat/s; energy weapons trade ammunition independence for much
higher sustained reactor demand. All reserve quantities must be whole rounds
within the displayed mount limit; energy and empty slots carry zero reserves.

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
dorsal artillery and existing barrage cadence. Mechs, aircraft, tanks, siege
units, and commanders obey the same weight curve and reactor thresholds.
Artillery pays for every committed shell. Enemies skip dry mounts, pause to cool,
and disengage locally when all mounts are dry. They stay on the map and remain
targetable; exhaustion never awards a kill or completes an objective.

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
The simulator alone reloads dry drill weapons once launched ordnance resolves,
clears heat, and places a fresh target so repeated misses cannot strand a drill.
Both borrowed escape rigs can reach evacuation without firing or killing guards;
Kestrel starts with finite machine-gun reserves, while Longbow uses energy heat.
Pause can restart or leave training. Completion returns to the ship or the
accepted contract's loadout review.

## Controls

Press the south face button (A / cross / Nintendo B) or Menu to claim a
connected standard controller. The claiming
press is consumed; confirm again to act. Ownership stays with that controller
when another connects. Losing it pauses combat; a replacement must be claimed
and the mission explicitly resumed. Release sticks and triggers after menu
transitions to arm combat controls.

| Action | Keyboard / mouse | Standard gamepad | Touch |
| --- | --- | --- | --- |
| Raise/lower persistent throttle | W/S or up/down | Left stick up/down | Drag left stick up/down |
| Neutral; momentum decays | X | X / square | STOP |
| Turn hull | A/D or left/right | Left stick left/right | Drag left stick left/right |
| Aim independent turret | Mouse | Right stick left/right rotates torso | Tap a hostile or NEXT to track; empty ground aims manually |
| Camera zoom | Mouse wheel | — | — |
| Fire mount 1 | Left mouse / hold 1 or Space | RT / R2 | Arm mount 1; hold FIRE |
| Fire mount 2 | Right mouse / hold 2 or E | LT / L2 | Arm mount 2; hold FIRE |
| Fire mount 3 | Middle mouse / hold 3 or Q | RB / R1 | Arm mount 3; hold FIRE |
| Fire mount 4 | Back/thumb mouse / hold 4 or F | LB / L1 | Arm mount 4; hold FIRE |
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

The active device changes prompts, using Xbox, PlayStation, Nintendo, or Steam
Deck glyphs when identified and physical-position labels for unknown pads.
Nintendo keeps standard physical positions: B confirms and A goes back.
Controller use enables the larger interface; Settings can enable it for keyboard
and mouse. D-pad/stick navigation reaches content and page buttons; bumpers
and triggers change departments and their pages. Left/right adjusts a focused
volume slider. Touch controls
activate on touch-first devices or through Settings. Optional recoil/damage
vibration depends on browser and controller support.

**Settings → Controls → Control Mode** selects **Simulation** (default) or
**Arcade**, saved on this device. The table above describes Simulation. In
Arcade, the left stick or WASD / mapped movement keys selects screen-relative
leg facing and forward throttle demand; release returns throttle gradually to
neutral. The right stick selects absolute torso facing, as before. Both modes
retain each chassis’s leg and torso rotation speeds. Mouse aiming works in
both modes, including while moving or firing with a controller. Touch controls
retain persistent throttle and a cruise/steer stick in either mode. Touch targeting is independent of the desktop/controller control-mode preference.

In Simulation, releasing throttle keeps the engine setting and releasing the
right stick holds the torso heading. Pause preserves throttle and
clears held inputs; deployment starts in neutral. Focus loss, hidden pages,
controller disconnection, and WebGL context loss pause and silence combat.
Recovery requires explicit resume.

Keyboard/mouse and controller share a direct-fire cockpit. Frame integrity, reactor
heat, throttle, and the mapped stop input sit at the lower left; hardpoints, fitted
weapons, live fire bindings, remaining ammunition, readiness/reload/heat lock, and coolant sit at the
lower right. Controller use enlarges the same layout and changes the prompts to
the detected controller family. Combined fire uses independent mapped inputs;
there is no mount arming step or touch target tracking in these modes. Simulation
and Arcade keep their existing movement and aiming behavior.

The cockpit follows active input, including on touchscreen laptops: a key press
or mouse use restores the direct-fire layout; touch reveals the mobile controls.
The Show touch controls preference can keep the touch dock visible for mouse use,
and controller use hides it. Narrow windows alone do not enable touch controls.

Touch combat uses two thumbs: the left stick sets heading and speed;
the right FIRE trigger fires the armed mount chips. Releasing the drive stick
slows the rig to zero. CRUISE retains the stick position after release; adjust
the stick to change course or speed. Turning Cruise off restores release-to-slow;
STOP centers the stick while leaving Cruise enabled. Pause, focus loss, resize,
and input-mode changes clear Cruise. Releasing FIRE ceases new shots.
Tap a visible hostile (including aircraft or a facility) to track its position with the existing turret turn rate.
NEAREST selects the closest visible, unobscured contact to the rig. NEXT cycles
those contacts in increasing distance from the rig, wrapping to the nearest.
Destroyed, offscreen, or obscured contacts lose their lock. There is no automatic retargeting, shot leading, or
automatic firing. Tap empty ground to clear the lock and aim manually.
Portrait reserves a control dock below the battlefield; landscape puts controls
at the lower edges. Training and the escape use the same controls.

The FULL button is available on touch-capable devices without a detected
controller when the browser allows element fullscreen. It requests fullscreen
on a tap and becomes EXIT while active. Unsupported browsers and standalone
home-screen launches omit it; a rejected request leaves a retry message.

## Presentation and audio

Gameplay uses a deterministic 2D ground simulation with a fixed 60 Hz step.
Three.js and ECSpresso's renderer3D plugin provide isometric presentation,
procedural terrain, layered frame geometry, lighting/shadows, planted-foot gait,
artillery warnings, weapon trails, and pooled effects. Ship departments use
DOM interfaces with responsive layouts and visible focus and selection states.

`main.ts` composes one ECSpresso application world for combat, screens, input
handoff, and renderer integration. Its single frame driver calls `world.update`;
ECSpresso owns the 60 Hz accumulator. `combat-runtime.ts` owns live player
capabilities, enemies, ordnance, spawn warnings, facilities, effects, and wrecks.
Explicit system references preserve cooling → movement → weapons → spawning →
enemy attacks → artillery → projectiles → deaths → effects → mission outcome.
New ordnance is visible to later systems in the same tick, and fatal damage
still takes precedence over extraction. Training runs those same systems with
scenario preparation and completion hooks. The plain-data `step` entry point
remains available for deterministic domain callers and regression comparisons.
Live adapters use `CombatStateView`: collections are frozen, ordered query
snapshots with explicit append and whole-collection replacement operations.
The original plain-data `State` keeps ordinary mutable arrays. Component and
resource replacement stays visible through live capability accessors; runtime
entity IDs remain separate from mission target IDs and persistent company data.

`runtime-navigation.ts` derives navigation from ECSpresso screens and their
overlay stack. Pause and auxiliary dialogs retain the underlying combat entities;
simulation systems stop while browser input and permitted presentation continue.
Transitions clear pending input and require controller neutral before resuming.
Save conflicts remain locked to reload. Company transactions, save validation,
and serialization remain ordinary domain functions, using the fresh v4 company
and unchanged v1 preference formats. Mission replacement removes the previous entities;
their view components release models. The application cleanup owner stops
listeners and adapters, disposes the shared world, then releases its supplied
renderer, including after partial initialization failure.

Physical-key bindings and independent touch pointers remain DOM adapters, and
`gamepad.ts` retains controller claiming, reconnect and neutral policy. ECSpresso
0.24.1's published input plugin uses logical `KeyboardEvent.key` values and does
not provide those policies; replacing it would change existing remappings and
device behavior. `runtime-input.ts` bridges sampled actions into fixed steps:
short presses survive until consumed, held controls remain available across
steps, and transitions discard stale presses. Gait, camera projection, terrain
and effect pools, synthesized audio, haptics, and DOM rendering remain explicit
presentation adapters consuming the authoritative runtime view and feedback.
Rendering optimization remains separate work under issue #10.

All company chassis and the scout, striker, siege, and Crown commander now
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
intensity and uses quieter ship arrangements. The playable intro escape selects the
144-BPM Pursuit theme with a running bass pulse, tense brass-like phrases, and
industrial percussion, alongside the facility alarms. Set `AudioFrame.theme` to
`pursuit` to reuse it independently of facility alarms. Weapon, mechanical, damage,
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
hot reload. To inspect model animations without starting a campaign:

```sh
bun run dev:models
```

Open **http://localhost:3001/**. This local tool loads all twelve production
models with the game's shared pose and gait code. Select a model and motion,
adjust throttle or playback speed, and drag to orbit or scroll to zoom. Pause
freezes the pose; **Step 1/60 s** pauses and advances exactly one simulation
frame, independent of playback speed. **Restart motion** resets the pose and
clock while preserving the model, camera, throttle, playback speed, and pause
state. Changing the model or motion also starts its animation from zero.
The viewer uses no campaign saves. Set `PORT` to override its default port.

Production validation uses:

```sh
bun run check
bun run preview
```

`check` runs the regression suite, strict TypeScript, ESLint, and a clean
production build. `preview` serves that `dist/` build; use `bun run build` first
when building separately. The game dev server and production preview default
to port 3000; set `PORT` to choose another. Runtime dependencies are ECSpresso,
Three.js, lit-html, and d3-contour
(for interpolated territory outlines). The game has
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

Store generated screenshots, recordings, and browser-validation reports in the
local `docs/` directory. Git ignores this directory, so fresh clones do not
include it. Attach relevant evidence to pull requests instead of committing it.

Automated inputs and passing checks do not establish physical controller/touch
feel, audio listening quality, GPU performance, combat balance, or owner
acceptance.

## Hosting and save compatibility

Play at [heavyrig.deegeegames.com](https://heavyrig.deegeegames.com/).
Source: [DeeGeeGames/heavy-rig](https://github.com/DeeGeeGames/heavy-rig).

Bun's production HTML build emits relative, hashed assets and copies `public/`,
`CNAME`, and `.nojekyll` into `dist/`. CI runs tests, typecheck, lint, and build.
The Pages workflow deploys `master` after the complete check. Pull requests must
satisfy live branch protection; workflow definitions alone do not establish
merge readiness. The custom domain is configured in `CNAME`.

Company progression uses **`heavy-rig:campaign:v4`**. Version 4 starts a fresh
company with saved per-mount ammunition selections and strict loadout validation.
Earlier campaigns, including v3, are left untouched and are not loaded; no
migration is provided. Territory influence remains part of the company save.
Preferences remain under `heavy-rig:profile:v1`; historical classic records in
that profile are retained but the classic operation is no longer a playable mode.

Saves are browser-local and scoped to the origin. If another tab changes the
company save, the stale tab stops play and requires reloading before it can
write again. Opening another tab during deployment recovers that sortie as an
abort; use one active company tab. Invalid company transactions
reset the campaign as a unit. If storage is unavailable, play continues for the
current session with a visible warning. Saves from the earlier Iron Wake on
experiments.deegeegames.com are not transferred automatically.

Heavy Rig was extracted from DeeGeeGames/playground at commit
`7e255d2b0676c80a79206f0a55c492d4b83cc692`, where it was named Iron Wake.

## Heavy mech prototype

Run `bun run dev:models` for development, or build with `bun run build`,
then run `bun run preview` and open
`/prototype-preview.html` (also linked from the model study). The separate viewer
loads the approved GLB with walk playback, seeking, single-frame stepping, hull
orientation, torso aim, launcher guides, and side/rear/game-angle views. The
self-contained `dist/prototype-study.html` can also be opened from disk.

The walk plays once and holds its final pose. Hull orientation is an inspection
control, not a planted turning animation. Launcher guides do not fire weapons.
This study does not change production frames, combat, saves, or controls. Its
high-detail asset is not yet a performance budget for multiple on-screen mechs.
