# Mech Prompt Generator — Handoff Specification (V3.1)

This document specifies the interactive **Mech Prompt Builder V3.1** developed to produce consistent, original, BattleTech-inspired (but non-copying) combat-mech reference images across image generators. It is intended to let another developer reproduce the prompt-generation behavior without access to the original conversation.

The output is **one plain-text image-generation prompt**. It can be pasted into different image models for comparison or used to obtain a reference image for subsequent image-to-3D conversion. The builder itself does not generate 3D geometry.

## 1. Design objective

The target aesthetic is **a giant military combat robot engineered with the rugged design language of armored vehicles and industrial machinery**. It occupies a middle ground between two undesirable extremes:

- A sleek or athletic humanoid robot wearing elaborate armor.
- A conventional tank or artillery hull merely placed on mechanical legs.

Prefer distinctive, articulated robotic anatomy; large, purposeful armor masses; integrated heavy weaponry; clearly defined mechanical joints; and sufficient visual weight to suggest a multi-ton combat machine.

The generator separates a **fixed shared style**, **per-model specifications**, **per-chassis proportions**, and **fixed reference-image presentation**. This preserves recognizable family resemblance while allowing significantly different mech models.

## 2. Parameters and defaults

The builder exposes the following inputs. All selectable values are literal strings inserted into the prompt; no normalization or additional inference is performed.

| Parameter / key | Input type | Default | Purpose |
| --- | --- | --- | --- |
| Weight class (`weight`) | Select | `Heavy (60–75 tons)` | Broad mass/size class |
| Combat role (`role`) | Select | `Frontline brawler` | Battlefield specialization |
| Chassis architecture (`chassis`) | Select | `Upright, forward-jointed biped` | Locomotion/body architecture |
| Torso architecture (`torso`) | Select | `Broad angular wedge` | Dominant upper-body shape |
| Cockpit design (`cockpit`) | Select | `Small recessed armored canopy` | Pilot accommodation |
| Weapons configuration (`weapons`) | Select | `Heavy autocannon + energy weapon and manipulator` | Principal armament |
| Proportional calibration (`proportions`) | Radio group | `Balanced heavy` | Injects a predefined proportions paragraph |
| Distinctive silhouette (`silhouette`) | Free-text textarea | `Broad armored chest, reinforced shoulder assemblies, asymmetric weapon arms, and substantial mechanical legs` | Main distinguishing shape |
| Additional design instructions (`details`) | Free-text textarea | Empty | Optional model-specific text |
| Background (`background`) | Toggle | `Transparent` | Last paragraph of generated prompt |

### Weight class options

- `Light (20–35 tons)`
- `Medium (40–55 tons)`
- `Heavy (60–75 tons)`
- `Assault (80–100 tons)`

### Combat role options

- `Frontline brawler`
- `Long-range sniper`
- `Missile fire support`
- `Mobile skirmisher`
- `Reconnaissance scout`
- `Siege assault`

### Chassis architecture options

- `Upright, forward-jointed biped`
- `Reverse-jointed biped`
- `Compact wide-stance biped`
- `Tall narrow-profile biped`
- `Armless weapons platform`

### Torso architecture options

- `Broad angular wedge`
- `Rectangular armored block`
- `Rounded armored shell`
- `Forward-projecting torso`
- `Narrow central torso`
- `Offset asymmetric torso`

### Cockpit design options

- `Small recessed armored canopy`
- `Compact armored head`
- `Narrow horizontal visor`
- `Offset protected cockpit`
- `Nearly invisible cockpit`

### Weapons configuration options

- `Heavy autocannon + energy weapon and manipulator`
- `Twin arm-mounted autocannons`
- `Large shoulder missile launchers`
- `Dorsal artillery + secondary arm weapons`
- `Twin energy cannon weapon pods`
- `Heavy melee manipulator + ranged weapon`
- `Small integrated weapons, no arms`

### Proportional calibration options

- `Balanced heavy`
- `Compact and stocky`
- `Tall and imposing`
- `Low-profile support`

### Background options

- `Transparent`
- `White`

## 3. How the final prompt is assembled

Concatenate these blocks, in this exact order, with two newline characters between major blocks:

1. **Fixed design-language block** (`BASE_PROMPT`, §4).
2. **Dynamic model specification** (§5) with the selected enum strings and silhouette text.
3. **Dynamic proportions and structure** (§6): the paragraph selected by `proportions`, followed by a fixed articulation/cockpit paragraph.
4. **Optional additional requirements** (§7), only if `details.trim()` is nonempty.
5. **Fixed image-to-3D presentation** (`PRESENTATION_PROMPT`, §8).
6. **Dynamic background requirement** (§9).

Do not include UI labels, copy instructions, model logos, Markdown formatting, or code fences in the final prompt sent to an image generator. Headings within the prompt itself are plain-text, all-caps section markers.

## 4. Fixed design-language block (`BASE_PROMPT`)

This paragraph set is included **verbatim for every model**:

```text
Create an original, massive, heavily armored piloted combat mech in a grounded Western military science-fiction aesthetic.

DESIGN LANGUAGE

The machine is a giant military combat robot, engineered with the mechanical principles and industrial construction methods of tanks, heavy machinery, and armored military vehicles.

It has a powerful, distinctive robotic silhouette with clearly articulated mechanical anatomy. The torso, limbs, weapon systems, and locomotion mechanisms form a purpose-built combat machine rather than a humanoid figure wearing armor.

Emphasize immense mass, mechanical power, durability, battlefield practicality, and a distinctive silhouette. Preserve the recognizable robotic architecture while using the rugged design language of heavy industrial military equipment.

Armor consists of large, thick, angular plates with beveled edges and substantial protective coverage. Prioritize strong geometric forms and clear mechanical subassemblies over intricate surface decoration. Most armor surfaces remain relatively clean and uninterrupted.

Hydraulics, cooling vents, reinforced pivots, maintenance panels, and exposed mechanisms appear where functionally appropriate. Weapons are substantial military assemblies attached to reinforced hardpoints.

Avoid sleek anime aesthetics, athletic humanoid anatomy, decorative armor, excessive surface detailing, generic futuristic robot designs, and recognizable copies of existing fictional mechs.
```

Note: The phrase *BattleTech-inspired* describes the intended genre to the human implementing the tool; the generator's fixed prompt deliberately avoids asking for a named franchise's exact designs.

## 5. Dynamic model specification

Substitute the current selections directly into this text:

```text
MODEL SPECIFICATION

Weight class: {weight}
Chassis: {chassis}
Torso architecture: {torso}
Cockpit: {cockpit}
Weapons: {weapons}
Combat specialization: {role}
Distinctive silhouette: {silhouette}
```

No other prose is generated from these fields. For example, selecting `Missile fire support` does **not** automatically replace weapons with missile launchers; the user must choose a compatible weapons option.

## 6. Proportions and structure

Start this block with the heading:

```text
PROPORTIONS AND STRUCTURE
```

Then insert **exactly one** of the following descriptions, based on `proportions`:

**`Balanced heavy` (default):**

> The legs occupy approximately 50–55% of overall height. The torso is approximately 1.5 times the width of the pelvic assembly. The silhouette is moderately top-heavy, balancing substantial armor with powerful, clearly defined limbs. Arms reach approximately the upper thighs. Avoid both squat, excessively bulky proportions and sleek, athletic proportions.

**`Compact and stocky`:**

> A low center of gravity, exceptionally broad armored torso, shorter reinforced legs, and large load-bearing feet. Favor stability and concentrated armor mass, without reducing the legs to small supports beneath a vehicle hull.

**`Tall and imposing`:**

> Longer load-bearing legs, an elevated cockpit, and a broad but comparatively compact upper torso. Maintain substantial armor thickness and large industrial joints so the machine remains a heavy military platform rather than an athletic robot.

**`Low-profile support`:**

> A compact protected central torso, pronounced shoulder or dorsal weapon structures, and a stable mechanical leg arrangement. The silhouette emphasizes weapons and stability rather than humanoid anatomy.

Then append the following fixed paragraph after a blank line:

```text
The cockpit is compact and heavily protected. Visible cockpit glazing occupies less than 10% of the frontal torso surface. Major components have sufficient mechanical articulation to operate realistically. The upper torso has a recognizable connection to the hip structure, with a rotating waist where appropriate. Legs have substantial armored segments, heavy actuators, clearly defined joints, and broad weight-bearing feet.
```

These percentages are **art-direction targets**, not measured engineering specifications. Image models may approximate them inconsistently.

## 7. Additional requirements (conditional)

If `details.trim()` is nonempty, append:

```text
ADDITIONAL REQUIREMENTS

{details.trim()}
```

If empty or whitespace-only, omit both heading and paragraph entirely. The `silhouette` field is different: it is always included, even when the user clears the text.

## 8. Fixed presentation block (`PRESENTATION_PROMPT`)

This is included verbatim for every generated prompt:

```text
PRESENTATION FOR IMAGE-TO-3D GENERATION

Exactly one complete mech, full-body front three-quarter view, rotated approximately 35–45 degrees from the camera. Neutral standing pose, orthographic or minimal-perspective projection, camera approximately at torso height.

Both legs and feet are completely visible. Arms, weapons, and mechanical connections have clear silhouettes and sufficient separation to identify their geometry.

Clean hard-surface 3D asset reference with neutral desaturated military-gray materials and subtle material differences between armor and exposed mechanisms.

Soft uniform ambient illumination sufficient to reveal geometry. No cinematic lighting, dramatic shadows, glowing weapons, or atmospheric effects.

Center the complete machine, occupying approximately 85% of the image height. No cropped extremities, no other machines, no text, diagrams, technical specification panels, logos, or multiple views.
```

The requested uniform illumination is intentional: completely unlit geometry would not be readable. The goal is to avoid scene-specific lighting, shadows, and visual effects that make image-to-3D reconstruction harder.

## 9. Background block

Append `BACKGROUND`, followed by exactly one of:

**If `background === "Transparent"`:**

```text
BACKGROUND

Completely transparent background, with no checkerboard pattern baked into the image. No floor or ground plane.
```

**If `background === "White"`:**

```text
BACKGROUND

Plain uniform white background with no visible floor, horizon, or cast shadow.
```

Actual alpha transparency depends on the image generator; a model may draw a checkerboard pattern even if told not to. For image-to-3D input, inspect the produced image rather than assuming the background request succeeded.

## 10. Reference implementation (TypeScript)

This sample reproduces the prompt assembly and defaults. The complete `BASE_PROMPT`, `PRESENTATION_PROMPT`, and `PROPORTION_DESCRIPTIONS` values are the text provided above; copy those exact values into constants in the implementation.

```ts
type Weight =
  | "Light (20–35 tons)"
  | "Medium (40–55 tons)"
  | "Heavy (60–75 tons)"
  | "Assault (80–100 tons)";

type Proportions =
  | "Balanced heavy"
  | "Compact and stocky"
  | "Tall and imposing"
  | "Low-profile support";

type Background = "Transparent" | "White";

interface MechPromptParameters {
  weight: Weight;
  role: string;
  chassis: string;
  torso: string;
  cockpit: string;
  weapons: string;
  proportions: Proportions;
  silhouette: string;
  details: string;
  background: Background;
}

const DEFAULTS: MechPromptParameters = {
  weight: "Heavy (60–75 tons)",
  role: "Frontline brawler",
  chassis: "Upright, forward-jointed biped",
  torso: "Broad angular wedge",
  cockpit: "Small recessed armored canopy",
  weapons: "Heavy autocannon + energy weapon and manipulator",
  proportions: "Balanced heavy",
  silhouette:
    "Broad armored chest, reinforced shoulder assemblies, " +
    "asymmetric weapon arms, and substantial mechanical legs",
  details: "",
  background: "Transparent",
};

// Constants below are taken verbatim from §§4, 6, and 8.
declare const BASE_PROMPT: string;
declare const PRESENTATION_PROMPT: string;
declare const PROPORTION_DESCRIPTIONS: Record<Proportions, string>;

const STRUCTURE_SUFFIX =
  "The cockpit is compact and heavily protected. Visible cockpit " +
  "glazing occupies less than 10% of the frontal torso surface. " +
  "Major components have sufficient mechanical articulation to operate " +
  "realistically. The upper torso has a recognizable connection to " +
  "the hip structure, with a rotating waist where appropriate. " +
  "Legs have substantial armored segments, heavy actuators, clearly " +
  "defined joints, and broad weight-bearing feet.";

function buildMechPrompt(p: MechPromptParameters): string {
  const model = `MODEL SPECIFICATION

Weight class: ${p.weight}
Chassis: ${p.chassis}
Torso architecture: ${p.torso}
Cockpit: ${p.cockpit}
Weapons: ${p.weapons}
Combat specialization: ${p.role}
Distinctive silhouette: ${p.silhouette}`;

  const structure = `PROPORTIONS AND STRUCTURE

${PROPORTION_DESCRIPTIONS[p.proportions]}

${STRUCTURE_SUFFIX}`;

  const sections = [BASE_PROMPT, model, structure];

  if (p.details.trim()) {
    sections.push(`ADDITIONAL REQUIREMENTS\n\n${p.details.trim()}`);
  }

  sections.push(PRESENTATION_PROMPT);
  sections.push(
    `BACKGROUND\n\n${p.background === "Transparent"
      ? "Completely transparent background, with no checkerboard pattern baked into the image. No floor or ground plane."
      : "Plain uniform white background with no visible floor, horizon, or cast shadow."}`,
  );

  return sections.join("\n\n");
}
```

To make the example executable, declare the three constants using the exact prose in §§4, 6, and 8 (the `declare` lines above document them but do not provide runtime values). Bind each UI control to the corresponding parameter and regenerate the output on change.

## 11. UI behavior

- Display the fields in §2, with the specified defaults.
- Recompute the final prompt whenever an input changes.
- Display the entire generated prompt in a scrollable, read-only area.
- **Copy** copies the generated prompt text verbatim.
- **Generate mech image** submits the generated prompt to an image-generation conversation or endpoint. In the original ChatGPT implementation this action issued a new user turn prefixed with `Generate a mech reference image using this complete specification:` and then two newline characters followed by the full prompt.
- `Transparent` is the default background; the user can select `White` for generators or 3D pipelines that do not handle alpha transparency well.

## 12. Reproduction and testing protocol

To compare two image generators fairly:

1. Use **identical parameter values and identical composed text** in both.
2. Do not supply additional reference images for the initial text-only comparison.
3. Use the same subject framing (one mech, three-quarter view) and comparable image dimensions where possible.
4. Compare silhouette, leg-to-torso ratio, armor density, cockpit scale, weapon arrangement, and background cleanliness.
5. If differences persist, select an approved original design as a **visual style reference** for future generations. Image conditioning is expected to improve consistency more than endlessly expanding the text prompt, though results will still vary by model.
6. For multi-view image-to-3D work, approve the primary view first and derive secondary views from that approved image rather than generating each view independently from text.

### Known limitations of V3.1

- The generator permits **incompatible combinations** (e.g., an armless chassis with arm-mounted weapons). The original UI does not validate or reconcile them; a production implementation should warn or conditionally suppress conflicting clauses.
- The **Balanced heavy** proportional preset describes arms reaching the thighs, even if the chosen chassis has no arms. This is a candidate for per-chassis refinement.
- Fixed proportions should **not** be forced onto all weight classes and architectures in a larger catalog. Prefer proportional presets appropriate to each chassis family.
- Prompt wording alone cannot guarantee identical interpretations across OpenAI, Grok Imagine, or other models; they have different visual priors.
- A single 3/4 image leaves hidden surfaces ambiguous for 3D reconstruction. Reference-guided additional views can improve geometry consistency.

## 13. Summary for the implementer

The generator is a deterministic text composer with ten inputs. The base style and presentation instructions do not change; the model specification and one of four proportion paragraphs change according to user selections. Optional custom text and one of two background clauses complete the prompt. It makes no external calls until the user chooses to submit the text to an image generator.

