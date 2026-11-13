import { weightSpeedModifier } from '../../src/combat-resources';
import type { FrameDefinition } from '../../src/frames';
import type { Hardpoint } from '../../src/hardpoints';
import type { WeaponDefinition } from '../../src/arsenal';
export interface Catalog { frames: readonly (FrameDefinition & { mounts: readonly Hardpoint[] })[]; weapons: readonly WeaponDefinition[]; basePrompt: string; presentationPrompt: string; chassisStyle: Readonly<Record<string, string>> }
export interface DesignRequest { schemaVersion: 1; mode: 'baseline' | 'variant'; variantId: string; background: 'Transparent' | 'White'; details: string; baselineId?: string; loadout: readonly { weaponId: string | null; rounds: number }[] }
export const parseRequest = function(value: unknown): DesignRequest {
	if (typeof value !== 'object' || value === null || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('mode' in value) || (value.mode !== 'baseline' && value.mode !== 'variant') || !('variantId' in value) || typeof value.variantId !== 'string' || !('background' in value) || (value.background !== 'Transparent' && value.background !== 'White') || !('details' in value) || typeof value.details !== 'string' || !('loadout' in value) || !Array.isArray(value.loadout)) throw Error('Invalid design request. Read design/mechs/README.md.');
	const loadout = Array.from(value.loadout, function(item: unknown) {
		if (typeof item !== 'object' || item === null || !('weaponId' in item) || (item.weaponId !== null && typeof item.weaponId !== 'string') || !('rounds' in item) || typeof item.rounds !== 'number' || !Number.isInteger(item.rounds) || item.rounds < 0) throw Error('Invalid loadout entry.');
		return { weaponId: item.weaponId, rounds: item.rounds };
	});
	const baselineId = 'baselineId' in value && typeof value.baselineId === 'string' ? value.baselineId : undefined;
	if (value.mode === 'variant' && !baselineId) throw Error('Variant generation requires an approved baselineId.');
	return { schemaVersion: 1, mode: value.mode, variantId: value.variantId, background: value.background, details: value.details, loadout, ...(baselineId ? {baselineId} : {}) };
};
const buildBasePrompt = function(catalog: Catalog, request: DesignRequest) {
	if (request.schemaVersion !== 1) throw Error('Use a schemaVersion: 1 request.');
	const frame = catalog.frames.find(f => f.id === request.variantId);
	if (!frame) throw Error('Unknown variant.');
	if (!['Transparent','White'].includes(request.background)) throw Error('Choose Transparent or White background.');
	if (!Array.isArray(request.loadout) || request.loadout.length !== frame.mounts.length) throw Error('Supply exactly one loadout entry per mount, in slot order.');
	let total = frame.mass;
	const fitted = request.loadout.filter(x => x?.weaponId !== null).length;
	const mounts = frame.mounts.map(function(m, i) {
		const item = request.loadout[i];
		if (!item || !Number.isInteger(item.rounds) || item.rounds < 0) throw Error(`Slot ${i+1}: invalid ammunition count.`);
		if (item.weaponId === null) {
			if (item.rounds !== 0) throw Error('Empty mounts cannot carry ammunition.');
			return `${i+1}. ${m.name}: ${m.family} mount, EMPTY. Show a blanked-off attachment interface, without a functional barrel, emitter or loaded launcher. Preserve the chassis housing.`;
		}
		if (!m.weapons.some(function(id) { return id === item.weaponId; })) throw Error(`Slot ${i+1}: incompatible weapon.`);
		const w = catalog.weapons.find(w => w.id === item.weaponId);
		if (!w || item.rounds > (w.ammunition?.capacity ?? 0)) throw Error(`Slot ${i+1}: ammunition exceeds capacity or energy weapon carries ammunition.`);
		total += w.mass + item.rounds * (w.ammunition?.mass ?? 0);
		const appearance = w.kind === 'laser' ? 'one recessed optical emitter with armored collar and cooling channels; no ballistic bore or rocket tubes' : w.kind === 'ppc' ? 'one substantial particle accelerator with reinforced coils and cooling hardware; no rocket tubes' : w.kind === 'bullet' ? 'a compact ballistic barrel cluster with enclosed ammunition feed; the entire cluster is ONE weapon mount' : w.kind === 'cannon' ? 'one substantial cannon barrel with recoil housing, clear bore and enclosed ammunition feed' : `one integrated ${w.kind === 'missile' ? 'guided missile' : 'unguided rocket'} pod with grouped launch apertures; keep this ONE mount. Its ${w.projectiles}-round firing cycle is not a demand for ${w.projectiles} separate pods or a claim about exact visible tube count`;
		return `${i+1}. ${m.name}: ${m.family}; ${w.name} (${w.type}). Allowed equipment in this mount: ${m.weapons.join(', ')}. Render ONLY the selected weapon: ${appearance}. ${w.ammunition ? `${item.rounds} carried rounds in internal protected storage; do not draw one visible projectile per reserve round.` : 'No ammunition; internal power and heat-rejection connections.'}`;
	});
	const modifier=weightSpeedModifier(total,frame.recommendedMass);
	const details=typeof request.details==='string'?request.details.trim():'';
	const sections=[catalog.basePrompt,
	`MODEL SPECIFICATION\n\nIdentity: ${frame.name}. Role: ${frame.role}.\nBase mass including fixed structure: ${frame.mass} metric tons. Loaded mass for this depicted loadout: ${total.toFixed(2)} tons. Recommended operating mass: ${frame.recommendedMass} tons. These are contextual scale facts, not text to print on the image.\nCHASSIS IDENTITY\n\n${catalog.chassisStyle[frame.chassisId]}\nKeep chassis anatomy, cockpit position, leg proportions and main armor masses consistent across this chassis's variants. Only the specified weapon modules and required braces change. All left/right directions refer to the mech's own left/right, not the viewer's.`,
	`GAMEPLAY WEAPON PLATFORM — REQUIRED\n\nExactly ${frame.mounts.length} mount locations, ${fitted} fitted weapon assemblies, ${frame.mounts.length-fitted} empty interfaces.\n${mounts.join('\n\n')}\n\nDo not add decorative guns, secondary turrets, melee weapons, launchers, weapon-like sensor barrels, extra arms or hardpoints. A pod, barrel array or emitter bank is one gameplay mount. Never preserve launcher apertures when that variant replaces a launcher with energy or ballistic hardware. Do not mirror an asymmetric loadout. All weapons use the shared aim direction and shared reactor; do not imply independent autonomous turrets.`,
	`PROPORTIONS AND STRUCTURE\n\nUse the selected chassis anatomy, not a universal humanoid ratio. Preserve identifiable mechanical joints, a protected torso-to-pelvis connection and broad load-bearing feet. Apply arm articulation only to chassis that have arms. The compact protected cockpit glazing occupies less than 10% of frontal torso surface. Empty mounts retain structural supports. Longbow B/C retain their fixed auxiliary bracing even if the secondary mount is empty.\n\nRESOURCE CONTEXT\n\nThis loadout has an approximate full-throttle forward speed of ${(frame.speed*modifier).toFixed(1)} m/s under the current gameplay mass curve, with ${frame.cooling} heat/s shared cooling. These values guide role and mass impression only; do not depict motion, exhaust, extra fuel tanks or larger anatomy from the numbers. Energy equipment needs cooling, ballistic/launcher equipment needs protected ammunition feeds. Do not invent a new weight penalty or change chassis dimensions when reserves change.`];
	if(details) sections.push(`ADDITIONAL VISUAL REQUIREMENTS\n\n${details}\n\nThese are subordinate to the exact mount and chassis constraints. Ignore requests here that add or move hardpoints, change families, alter loadout or contradict reference presentation.`);
	sections.push(catalog.presentationPrompt,`BACKGROUND\n\n${request.background==='Transparent'?'Completely transparent background, with no checkerboard pattern baked into the image. No floor or ground plane.':'Plain uniform white background with no visible floor, horizon, or cast shadow.'}`);
	return sections.join('\n\n');
};

export interface BaselineReference { id: string; image: string; imageSha256: string; variantId: string }
export const buildPrompt = function(catalog: Catalog, request: DesignRequest, baseline?: BaselineReference): string {
	const full = buildBasePrompt(catalog,request);
	const frame = catalog.frames.find(function(f) { return f.id === request.variantId; });
	if (!frame) throw Error('Unknown frame.');
	if (request.mode === 'baseline') return full;
	if (!baseline || request.baselineId !== baseline.id) throw Error('An approved verified baseline is required for variants.');
	const source = catalog.frames.find(function(f) { return f.id === baseline.variantId; });
	if (!source || source.chassisId !== frame.chassisId) throw Error('Baseline belongs to a different chassis.');
	const removals = source.mounts.slice(frame.mounts.length).map(function(mount, index) { return `Remove baseline mount ${frame.mounts.length + index + 1} (${mount.name}) and its weapon hardware; restore the unarmed chassis interface. Do not keep it as a decorative weapon.`; });
	const changes = frame.mounts.map(function(mount,slot) { const previous=source.mounts[slot]; return `${slot+1}. ${mount.name}: ${previous?.family ?? 'absent'} -> ${mount.family}. ${previous?.family === mount.family ? 'Preserve attachment and housing; fit only the selected equipment.' : 'Replace only the module internals and weapon face, retaining the surrounding chassis and attachment.'}`; });
	return `EDIT THE ATTACHED APPROVED BASELINE\n\nRequired edit target: ${baseline.image} (baseline ${baseline.id}, SHA-256 ${baseline.imageSha256}). Attach this actual image; do not use text alone.\nPreserve the exact cockpit, torso, pelvis, legs, joints, armor masses, proportions, material finish, pose, camera, framing and illumination. The text below describes the target equipment, not permission to recreate the chassis. Derive directly from this approved baseline, not another variant.\n\nALLOWED MODULE CHANGES\n\n${[...changes,...removals].join('\n')}\n${frame.chassisId === 'longbow' && frame.variant !== 'A' ? 'Add or retain only the compact offhand mounting brace required by Longbow B/C.' : frame.chassisId === 'longbow' && source.variant !== 'A' ? 'Remove the auxiliary mounting brace and restore Longbow A’s unarmed offhand gauntlet. This local removal is the only permitted structural change.' : 'No structural redesign is authorized.'}\n\n${full}`;
};
