import type { WeaponId } from './arsenal';

export type ChassisId = 'warden' | 'kestrel' | 'maul' | 'longbow' | 'morrow' | 'rook';
// Original identifiers remain the A variants, preserving current campaign saves.
export type FrameId = ChassisId | `${ChassisId}-b` | `${ChassisId}-c`;
export type VariantLetter = 'A' | 'B' | 'C';
export interface FrameDefinition {
	id: FrameId; name: string; chassisId: ChassisId; chassisName: string; variant: VariantLetter; variantName: string;
	designation: string; role: string; description: string; tradeoff: string; price: number;
	starter: WeaponId; color: string; mass: number; recommendedMass: number;
	speed: number; reverseSpeed: number; acceleration: number; turnRate: number; turretRate: number;
	cooling: number; incomingDamage: number;
	size: number; stride: number; suspension: number; recoil: number;
}
// Integrity is a normalized percentage on every frame. Resistance changes the
// cost of a hit without changing repair, report, or persisted record formats.
type ChassisDefinition = Omit<FrameDefinition, 'id' | 'name' | 'chassisId' | 'chassisName' | 'variant' | 'variantName'>;
const CHASSIS: Readonly<Record<ChassisId, ChassisDefinition>> = {
	warden: { price: 5000, designation: '08', role: 'Line fighter', description: 'A balanced siege chassis. Accurate shells and steady handling hold the relay line.', tradeoff: 'Balanced armor and mobility; no specialized advantage.', starter: 'autocannon', color: '#d7ad61', mass: 80, recommendedMass: 92, speed: 90, reverseSpeed: 48, acceleration: 1.5, turnRate: 1.05, turretRate: 2.3, cooling: 12, incomingDamage: 1, size: 1, stride: 1, suspension: 1, recoil: 1 },
	kestrel: { price: 4000, designation: '21', role: 'Skirmisher', description: 'A compact pursuit frame. Rapid tracers and quick tracking reward flanking and constant movement.', tradeoff: '30% more incoming damage and a smaller cooling plant.', starter: 'machine-gun', color: '#8dddc8', mass: 40, recommendedMass: 44, speed: 125, reverseSpeed: 65, acceleration: 2.2, turnRate: 1.5, turretRate: 3.1, cooling: 10, incomingDamage: 1.3, size: 0.86, stride: 0.78, suspension: 0.7, recoil: 0.45 },
	maul: { price: 7500, designation: '34', role: 'Brawler', description: 'An armored breaching frame. Fire a staggered two-rocket Hailstorm volley from its armored pods.', tradeoff: '22% less incoming damage; slow hull and turret traverse.', starter: 'cluster-rockets', color: '#ed9c75', mass: 100, recommendedMass: 114, speed: 82, reverseSpeed: 40, acceleration: 2, turnRate: 0.82, turretRate: 1.9, cooling: 11, incomingDamage: 0.78, size: 1.12, stride: 1.08, suspension: 1.3, recoil: 1.25 },
	longbow: { price: 6000, designation: '16', role: 'Precision gunner', description: 'A tall particle-gun platform. Line up piercing shots and use the oversized cooling plant to sustain fire.', tradeoff: '25% faster cooling; 12% more incoming damage and slow tracking.', starter: 'ppc', color: '#b7a8ed', mass: 65, recommendedMass: 73, speed: 86, reverseSpeed: 42, acceleration: 1.5, turnRate: 0.95, turretRate: 1.8, cooling: 15, incomingDamage: 1.12, size: 1.04, stride: 1, suspension: 0.85, recoil: 1.4 },
	morrow: { price: 6500, designation: '52', role: 'Missile support', description: 'A mobile salvo carrier. Guided Trident warheads converge on targets and burst into nearby enemies.', tradeoff: 'Guided area fire and quick traverse; 10% more incoming damage.', starter: 'cluster-missiles', color: '#b7d98b', mass: 70, recommendedMass: 86, speed: 88, reverseSpeed: 48, acceleration: 1.7, turnRate: 1.15, turretRate: 2.5, cooling: 12, incomingDamage: 1.1, size: 0.98, stride: 0.95, suspension: 1.05, recoil: 0.8 },
	rook: { price: 5500, designation: '37', role: 'Medium raider', description: 'A compact three-mount raider. Two arm weapons and a dorsal launcher bridge the light and line chassis.', tradeoff: '20% more incoming damage; three mounts compete for a modest operating weight and cooling plant.', starter: 'autocannon', color: '#e2bf89', mass: 55, recommendedMass: 66, speed: 95, reverseSpeed: 52, acceleration: 1.9, turnRate: 1.2, turretRate: 2.6, cooling: 12, incomingDamage: 1.2, size: 0.94, stride: 0.92, suspension: 0.9, recoil: 0.85 },
};
interface VariantDefinition {
	readonly letter: VariantLetter;
	readonly name: string;
	readonly price?: number;
	readonly role?: string;
	readonly description?: string;
	readonly tradeoff?: string;
	readonly starter?: WeaponId;
	readonly structuralMass?: number;
}
const VARIANTS: Readonly<Record<ChassisId, readonly VariantDefinition[]>> = {
	warden: [
		{ letter: 'A', name: 'Line' },
		{ letter: 'B', name: 'Battery', price: 5600, role: 'Gun and energy battery', description: 'Twin side guns support two shoulder energy banks. Alternate sustained gun pressure with selected beam or particle attacks.', tradeoff: 'Four mounts share one reactor; simultaneous energy fire rapidly exhausts the cooling margin.' },
		{ letter: 'C', name: 'Combined', price: 5700, role: 'Three-family line fighter', description: 'Two ballistic guns, an energy shoulder and a launcher shoulder provide responses to different ranges and target formations.', tradeoff: 'Broad equipment coverage adds weight and divides its energy and ordnance banks.' },
	],
	kestrel: [
		{ letter: 'A', name: 'Skirmisher' },
		{ letter: 'B', name: 'Spark', price: 4500, role: 'Beam skirmisher', description: 'A light machine gun accompanies a compact laser. Use mobile beam attacks and gunfire between bursts.', tradeoff: '30% more incoming damage; the small cooling plant limits laser use.' },
		{ letter: 'C', name: 'Harrier', price: 4400, role: 'Ordnance skirmisher', description: 'A light machine gun and compact two-round launcher combine tracking fire with limited ordnance.', tradeoff: '30% more incoming damage; extra ammunition strongly affects the speed of this light chassis.' },
	],
	maul: [
		{ letter: 'A', name: 'Breacher' },
		{ letter: 'B', name: 'Breaker', price: 7600, role: 'Armored gun platform', starter: 'autocannon', description: 'Twin ballistic gauntlets carry cannons or machine-gun arrays behind heavy armor.', tradeoff: '22% less incoming damage; slow traverse, finite ammunition and no explosive area fire.' },
		{ letter: 'C', name: 'Furnace', price: 7900, role: 'Armored gun and beam fighter', starter: 'autocannon', description: 'A ballistic gauntlet and energy gauntlet combine direct impact with beam or particle fire.', tradeoff: '22% less incoming damage; the modest cooling plant demands selective energy fire.' },
	],
	longbow: [
		{ letter: 'A', name: 'Marksman' },
		{ letter: 'B', name: 'Rifleman', price: 6500, role: 'Cannon and beam marksman', starter: 'machine-gun', structuralMass: 3, description: 'A long ballistic main arm is supported by a compact offhand laser.', tradeoff: '12% more incoming damage; auxiliary mounting structure adds a fixed 3T even with its weapon removed.' },
		{ letter: 'C', name: 'Overwatch', price: 6700, role: 'Particle and ordnance marksman', starter: 'laser', structuralMass: 3, description: 'The energy main arm gains a compact offhand two-round launcher for guided or explosive support.', tradeoff: '12% more incoming damage; fixed 3T auxiliary structure and carried ordnance reduce mobility.' },
	],
	morrow: [
		{ letter: 'A', name: 'Salvo' },
		{ letter: 'B', name: 'Prism', price: 6900, role: 'Twin energy carrier', starter: 'laser', description: 'Large emitter and accelerator assemblies replace the twin silo launchers. Choose beams, particle bolts, or one of each.', tradeoff: '10% more incoming damage; two energy mounts still share a single cooling plant.' },
		{ letter: 'C', name: 'Convergence', price: 6800, role: 'Energy and ordnance carrier', starter: 'ppc', description: 'An energy pod and launcher pod combine precision fire with guided or explosive attacks.', tradeoff: '10% more incoming damage; manage both shared heat and finite ordnance.' },
	],
	rook: [
		{ letter: 'A', name: 'Raider' },
		{ letter: 'B', name: 'Flare', price: 6000, role: 'Energy raider', starter: 'laser', description: 'Two energy arms and a compact dorsal launcher deliver selected bursts while repositioning.', tradeoff: '20% more incoming damage; firing both energy arms rapidly overheats the shared reactor.' },
		{ letter: 'C', name: 'Ranger', price: 5900, role: 'Three-family raider', starter: 'machine-gun', description: 'One ballistic arm, one energy arm and a compact dorsal launcher provide a flexible medium loadout.', tradeoff: '20% more incoming damage; less concentrated armament than a four-mount line chassis.' },
	],
};
export const CHASSIS_IDS: readonly ChassisId[] = ['warden', 'kestrel', 'maul', 'longbow', 'morrow', 'rook'];
export const FRAMES: readonly FrameDefinition[] = CHASSIS_IDS.flatMap(function (chassisId): FrameDefinition[] {
	const chassis = CHASSIS[chassisId];
	return VARIANTS[chassisId].map(function (variant): FrameDefinition {
		const id: FrameId = variant.letter === 'A' ? chassisId : `${chassisId}-${variant.letter === 'B' ? 'b' : 'c'}`;
		const chassisName = chassisId.toUpperCase();
		return { ...chassis, id, chassisId, chassisName, variant: variant.letter, variantName: variant.name,
			name: `${chassisName} ${variant.letter} · ${variant.name.toUpperCase()}`, designation: `${chassis.designation}${variant.letter}`,
			price: variant.price ?? chassis.price, role: variant.role ?? chassis.role,
			description: variant.description ?? chassis.description, tradeoff: variant.tradeoff ?? chassis.tradeoff,
			starter: variant.starter ?? chassis.starter, mass: chassis.mass + (variant.structuralMass ?? 0) };
	});
});
export const getFrame = function (id: FrameId): FrameDefinition {
	const frame = FRAMES.find(function (candidate) { return candidate.id === id; });
	if (!frame) throw new RangeError(`Unknown Heavy Rig frame: ${id}`);
	return frame;
};
