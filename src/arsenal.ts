export type LauncherId = 'stream-missiles' | 'cluster-missiles' | 'stream-rockets' | 'cluster-rockets';
export type WeaponModelId = `${LauncherId}-${4 | 6}` | 'laser' | 'machine-gun' | 'autocannon' | 'ppc' | 'stream-missiles' | 'cluster-missiles' | 'stream-rockets' | 'cluster-rockets';
export type WeaponTier = 0 | 1 | 2 | 3 | 4 | 5;
export type WeaponId = WeaponModelId | `${WeaponModelId}:t${Exclude<WeaponTier, 0>}`;
export interface WeaponTierDefinition {
	readonly tier: WeaponTier;
	readonly name: string;
	readonly color: string;
	readonly damage: number;
	readonly interval: number;
	readonly heat: number;
	readonly range: number;
	readonly speed: number;
	readonly spread: number;
	readonly price: number;
}
// Quality changes performance, never mount size, ammunition capacity or mass.
// T0 preserves the baseline arsenal; higher tiers are separately owned hardware.
export const WEAPON_TIERS: readonly WeaponTierDefinition[] = [
	{ tier: 0, name: 'Standard', color: '#a4afb8', damage: 1, interval: 1, heat: 1, range: 1, speed: 1, spread: 1, price: 1 },
	{ tier: 1, name: 'Service', color: '#c6d6c2', damage: 1.05, interval: .97, heat: .96, range: 1.04, speed: 1.04, spread: .94, price: 1.4 },
	{ tier: 2, name: 'Refined', color: '#91cf9a', damage: 1.10, interval: .94, heat: .92, range: 1.08, speed: 1.08, spread: .88, price: 2 },
	{ tier: 3, name: 'Advanced', color: '#88bff0', damage: 1.15, interval: .91, heat: .88, range: 1.12, speed: 1.12, spread: .82, price: 3 },
	{ tier: 4, name: 'Elite', color: '#c6a3ed', damage: 1.20, interval: .88, heat: .84, range: 1.16, speed: 1.16, spread: .76, price: 4.5 },
	{ tier: 5, name: 'Exceptional', color: '#efc568', damage: 1.30, interval: .82, heat: .78, range: 1.25, speed: 1.25, spread: .65, price: 7 },
];
export const getWeaponTier = function (tier: WeaponTier): WeaponTierDefinition {
	const definition = WEAPON_TIERS.find(function (entry) { return entry.tier === tier; });
	if (!definition) throw new RangeError(`Unknown weapon tier: ${tier}`);
	return definition;
};
export const tierLabel = function (tier: WeaponTier): string { return `T${tier} · ${getWeaponTier(tier).name}`; };
export const weaponIdForTier = function (model: WeaponModelId, tier: WeaponTier): WeaponId {
	getWeaponTier(tier);
	return tier === 0 ? model : `${model}:t${tier}`;
};
export type WeaponFamily = 'ballistic' | 'energy' | 'launcher';
export const WEAPON_FAMILY_LABELS: Readonly<Record<WeaponFamily, string>> = { ballistic: 'Ballistic', energy: 'Energy', launcher: 'Launcher' };
export type FireInputs = readonly [boolean, boolean, boolean, boolean];
export interface WeaponMount { weapon: WeaponId; rounds: number; cooldown: number; firing: boolean; rocketVolley?: { remaining: number; nextIn: number }; slot?: number }
export interface AmmunitionDefinition { mass: number; capacity: number; defaultLoad: number }
export interface WeaponDefinition {
	mass: number;
	ammunition: AmmunitionDefinition | null;
	id: WeaponId;
	modelId: WeaponModelId;
	tier: WeaponTier;
	family: WeaponFamily;
	name: string;
	type: string;
	description: string;
	role: string;
	color: string;
	icon: string;
	kind: 'laser' | 'cannon' | 'bullet' | 'ppc' | 'missile' | 'rocket';
	damage: number;
	interval: number;
	heat: number;
	range: number;
	speed: number;
	projectiles: number;
	spread: number;
	splash: number;
	stream?: boolean;
}
type HardwareWeapon = Omit<WeaponDefinition, 'modelId' | 'tier' | 'id'> & { id: WeaponModelId };
type BaseWeapon = Omit<WeaponDefinition, 'mass' | 'ammunition' | 'modelId' | 'tier' | 'id'> & { id: WeaponModelId };
const BASE_WEAPONS: readonly BaseWeapon[] = [
	{ id: 'autocannon', family: 'ballistic', name: 'AC/38', type: 'Auto Cannon', role: 'Precise impact', description: 'Heavy, accurate shells. Reliable opening fire with modest reactor demand.', color: '#ffd28b', icon: '╋', kind: 'cannon', damage: 38, interval: 1, heat: 7, range: 845, speed: 650, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'laser', family: 'energy', name: 'ARC', type: 'Laser', role: 'Continuous beam', description: 'A continuous beam that stops at the first target. Track steadily; watch your heat.', color: '#8ff5e7', icon: 'ϟ', kind: 'laser', damage: 56, interval: 0, heat: 20, range: 620, speed: 0, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'machine-gun', family: 'ballistic', name: 'RATTLER', type: 'Machine Gun', role: 'Cool sustained fire', description: 'Rapid low-heat tracers with a narrow spread. Best against nearby light frames.', color: '#fff2ba', icon: '≋', kind: 'bullet', damage: 4, interval: 0.16, heat: 0.45, range: 700, speed: 1000, projectiles: 1, spread: 0.035, splash: 0 },
	{ id: 'ppc', family: 'energy', name: 'TEMPEST', type: 'Particle Projection Cannon', role: 'Piercing pulse', description: 'A fast charged particle bolt punches through a line of frames. Long recharge; heavy heat.', color: '#b1a0ff', icon: '◉', kind: 'ppc', damage: 160, interval: 2.4, heat: 36, range: 1000, speed: 2200, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'stream-missiles', family: 'launcher', name: 'NEEDLE', type: 'Stream Missiles', role: 'Guided pressure', description: 'A steady stream of guided missiles follows your selected target after acquisition.', color: '#9be99e', icon: '↗', kind: 'missile', damage: 25, interval: 1.8, heat: 2.5, range: 1050, speed: 1200, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'cluster-missiles', family: 'launcher', name: 'TRIDENT', type: 'Cluster Missiles', role: 'Guided area salvo', description: 'Guided warheads fan out, converge and burst against clustered enemies.', color: '#b7e876', icon: '⋀', kind: 'missile', damage: 30, interval: 1.4, heat: 5, range: 1080, speed: 1080, projectiles: 3, spread: 0.28, splash: 65 },
	{ id: 'stream-rockets', family: 'launcher', name: 'LANCE', type: 'Stream Rockets', role: 'Unguided pressure', description: 'Fast rockets fly straight along the turret bearing. Lead moving targets.', color: '#ffad6a', icon: '⇢', kind: 'rocket', damage: 31, interval: 1.7, heat: 2.5, range: 1000, speed: 2080, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'cluster-rockets', family: 'launcher', name: 'HAILSTORM', type: 'Cluster Rockets', role: 'Unguided area volley', description: 'Unguided rockets fire straight forward from random tubes in the pod. Lead moving targets.', color: '#ff837a', icon: '⋔', kind: 'rocket', damage: 32, interval: 1.3, heat: 4.5, range: 900, speed: 1880, projectiles: 5, spread: 0, splash: 80 },
];
// Bare launcher model IDs denote the compact two-round variants.
const hardware = function (weapon: BaseWeapon): HardwareWeapon {
	if (weapon.family === 'energy') return { ...weapon, mass: weapon.kind === 'ppc' ? 8 : 5, ammunition: null };
	if (weapon.kind === 'bullet') return { ...weapon, mass: 2, ammunition: { mass: 0.001, capacity: 2400, defaultLoad: 1200 } };
	if (weapon.kind === 'cannon') return { ...weapon, mass: 6, ammunition: { mass: 0.025, capacity: 480, defaultLoad: 240 } };
	return { ...weapon, mass: weapon.kind === 'missile' ? 6 : 5, ammunition: { mass: weapon.kind === 'missile' ? 0.025 : 0.018, capacity: 720, defaultLoad: 360 } };
};
const MODELS = BASE_WEAPONS.map(hardware).flatMap(function (weapon): HardwareWeapon[] {
	if (weapon.id !== 'stream-missiles' && weapon.id !== 'cluster-missiles' && weapon.id !== 'stream-rockets' && weapon.id !== 'cluster-rockets') return [weapon];
	const launcherId = weapon.id;
	return ([2, 4, 6] as const).map(function (rounds): HardwareWeapon {
		const id: WeaponModelId = rounds === 2 ? weapon.id : `${launcherId}-${rounds}`;
		const stream = weapon.id.startsWith('stream-');
		return { ...weapon, id, name: `${weapon.name}/${rounds}`, type: `${weapon.type} ${rounds}`, projectiles: rounds, stream,
			description: `${rounds} ${weapon.kind === 'missile' ? 'guided missiles' : 'unguided rockets'} fire ${stream ? 'in sequence' : weapon.kind === 'rocket' ? 'in a staggered volley' : 'together in a fan'}. ${weapon.splash ? 'Explosions damage nearby enemies.' : 'Direct impact damage.'}`,
			// Heat is specified per warhead; larger pods trade burst damage for reactor demand.
			mass: weapon.mass + (rounds - 2) * 1.5, interval: Math.max(weapon.interval, rounds * 0.1), heat: weapon.heat * rounds };
	});
});
export const WEAPONS: readonly WeaponDefinition[] = MODELS.flatMap(function (model) {
	return WEAPON_TIERS.map(function (quality): WeaponDefinition {
		return { ...model, id: weaponIdForTier(model.id, quality.tier), modelId: model.id, tier: quality.tier,
			name: `${model.name} · T${quality.tier}`, damage: model.damage * quality.damage,
			interval: model.interval * quality.interval, heat: model.heat * quality.heat,
			range: model.range * quality.range, speed: model.speed * quality.speed, spread: model.spread * quality.spread };
	});
});
export const WEAPON_MODELS: readonly WeaponDefinition[] = WEAPONS.filter(function (weapon) { return weapon.tier === 0; });
const isWeaponRecord = function (value: Record<string, number>): value is Record<WeaponId, number> {
	return WEAPONS.every(function (weapon) { return Number.isFinite(value[weapon.id]); });
};
export const createWeaponRecord = function (value: (weapon: WeaponDefinition) => number): Record<WeaponId, number> {
	const record = Object.fromEntries(WEAPONS.map(function (weapon) { return [weapon.id, value(weapon)]; }));
	if (!isWeaponRecord(record)) throw new RangeError('Incomplete weapon record');
	return record;
};
const WEAPON_BY_ID = new Map(WEAPONS.map(function (weapon) { return [weapon.id, weapon] as const; }));
export const getWeapon = function (id: WeaponId): WeaponDefinition {
	const weapon = WEAPON_BY_ID.get(id);
	if (!weapon) throw new RangeError(`Unknown Heavy Rig weapon: ${id}`);
	return weapon;
};
export const isReserve = function (weapon: WeaponId, rounds: unknown): rounds is number {
	return typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= 0 && rounds <= (getWeapon(weapon).ammunition?.capacity ?? 0);
};
export const createMount = function (weapon: WeaponId, rounds = getWeapon(weapon).ammunition?.defaultLoad ?? 0): WeaponMount {
	if (!isReserve(weapon, rounds)) throw new RangeError(`Invalid ammunition reserve for ${weapon}`);
	return { weapon, rounds, cooldown: 0, firing: false };
};
