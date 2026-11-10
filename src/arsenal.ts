export type LauncherId = 'stream-missiles' | 'cluster-missiles' | 'stream-rockets' | 'cluster-rockets';
export type WeaponId = `${LauncherId}-${4 | 6}` | 'laser' | 'machine-gun' | 'autocannon' | 'ppc' | 'stream-missiles' | 'cluster-missiles' | 'stream-rockets' | 'cluster-rockets';
export type WeaponFamily = 'ballistic' | 'energy' | 'launcher';
export const WEAPON_FAMILY_LABELS: Readonly<Record<WeaponFamily, string>> = { ballistic: 'Ballistic', energy: 'Energy', launcher: 'Launcher' };
export type FireInputs = readonly [boolean, boolean, boolean, boolean];
export interface WeaponMount { weapon: WeaponId; rounds: number; level: number; cooldown: number; firing: boolean; rocketVolley?: { remaining: number; nextIn: number }; slot?: number }
export interface AmmunitionDefinition { mass: number; capacity: number; defaultLoad: number }
export interface WeaponDefinition {
	mass: number;
	ammunition: AmmunitionDefinition | null;
	id: WeaponId;
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
const BASE_WEAPONS: readonly Omit<WeaponDefinition, 'mass' | 'ammunition'>[] = [
	{ id: 'autocannon', family: 'ballistic', name: 'AC/38', type: 'Auto Cannon', role: 'Precise impact', description: 'Heavy, accurate shells. Reliable opening fire with modest reactor demand.', color: '#ffd28b', icon: '╋', kind: 'cannon', damage: 38, interval: 0.65, heat: 6, range: 845, speed: 650, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'laser', family: 'energy', name: 'ARC', type: 'Laser', role: 'Continuous beam', description: 'A continuous beam that stops at the first target. Track steadily; watch your heat.', color: '#8ff5e7', icon: 'ϟ', kind: 'laser', damage: 56, interval: 0, heat: 40, range: 620, speed: 0, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'machine-gun', family: 'ballistic', name: 'RATTLER', type: 'Machine Gun', role: 'Cool sustained fire', description: 'Rapid low-heat tracers with a narrow spread. Best against nearby light frames.', color: '#fff2ba', icon: '≋', kind: 'bullet', damage: 8, interval: 0.105, heat: 0.7, range: 700, speed: 1000, projectiles: 1, spread: 0.035, splash: 0 },
	{ id: 'ppc', family: 'energy', name: 'TEMPEST', type: 'Particle Projection Cannon', role: 'Piercing pulse', description: 'A charged particle bolt punches through a line of frames. Powerful, slow and hot.', color: '#b1a0ff', icon: '◉', kind: 'ppc', damage: 82, interval: 1.6, heat: 60, range: 1000, speed: 550, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'stream-missiles', family: 'launcher', name: 'NEEDLE', type: 'Stream Missiles', role: 'Guided pressure', description: 'A steady stream of guided missiles follows the target nearest your aim.', color: '#9be99e', icon: '↗', kind: 'missile', damage: 25, interval: 0.48, heat: 3.5, range: 1050, speed: 1200, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'cluster-missiles', family: 'launcher', name: 'TRIDENT', type: 'Cluster Missiles', role: 'Guided area salvo', description: 'Three guided warheads fan out, converge and burst against clustered enemies.', color: '#b7e876', icon: '⋀', kind: 'missile', damage: 30, interval: 2.1, heat: 13, range: 1080, speed: 1080, projectiles: 3, spread: 0.28, splash: 65 },
	{ id: 'stream-rockets', family: 'launcher', name: 'LANCE', type: 'Stream Rockets', role: 'Unguided pressure', description: 'Fast rockets fly straight along the turret bearing. Lead moving targets.', color: '#ffad6a', icon: '⇢', kind: 'rocket', damage: 31, interval: 0.42, heat: 3, range: 1000, speed: 2080, projectiles: 1, spread: 0, splash: 0 },
	{ id: 'cluster-rockets', family: 'launcher', name: 'HAILSTORM', type: 'Cluster Rockets', role: 'Unguided area volley', description: 'Five unguided rockets fire straight forward from random tubes in the pod. Lead moving targets.', color: '#ff837a', icon: '⋔', kind: 'rocket', damage: 24, interval: 1.8, heat: 12, range: 900, speed: 1880, projectiles: 5, spread: 0, splash: 80 },
];
// Existing IDs remain the two-round variants so saved equipment keeps its identity.
const hardware = function (weapon: Omit<WeaponDefinition, 'mass' | 'ammunition'>): WeaponDefinition {
	if (weapon.family === 'energy') return { ...weapon, mass: weapon.kind === 'ppc' ? 8 : 5, ammunition: null };
	if (weapon.kind === 'bullet') return { ...weapon, mass: 2, ammunition: { mass: 0.001, capacity: 2400, defaultLoad: 1200 } };
	if (weapon.kind === 'cannon') return { ...weapon, mass: 6, ammunition: { mass: 0.025, capacity: 480, defaultLoad: 240 } };
	return { ...weapon, mass: weapon.kind === 'missile' ? 6 : 5, ammunition: { mass: weapon.kind === 'missile' ? 0.025 : 0.018, capacity: 720, defaultLoad: 360 } };
};
export const WEAPONS: readonly WeaponDefinition[] = BASE_WEAPONS.map(hardware).flatMap(function (weapon): WeaponDefinition[] {
	if (weapon.id !== 'stream-missiles' && weapon.id !== 'cluster-missiles' && weapon.id !== 'stream-rockets' && weapon.id !== 'cluster-rockets') return [weapon];
	const launcherId = weapon.id;
	return ([2, 4, 6] as const).map(function (rounds): WeaponDefinition {
		const id: WeaponId = rounds === 2 ? weapon.id : `${launcherId}-${rounds}`;
		const stream = weapon.id.startsWith('stream-');
		return { ...weapon, id, name: `${weapon.name}/${rounds}`, type: `${weapon.type} ${rounds}`, projectiles: rounds, stream,
			description: `${rounds} ${weapon.kind === 'missile' ? 'guided missiles' : 'unguided rockets'} fire ${stream ? 'in sequence' : weapon.kind === 'rocket' ? 'in a staggered volley' : 'together in a fan'}. ${weapon.splash ? 'Explosions damage nearby enemies.' : 'Direct impact damage.'}`,
			mass: weapon.mass + (rounds - 2) * 1.5, interval: Math.max(weapon.interval, rounds * 0.1), heat: (weapon.kind === 'missile' ? 1.6 : 1.2) * rounds };
	});
});
export const getWeapon = function (id: WeaponId): WeaponDefinition {
	const weapon = WEAPONS.find(function (candidate) { return candidate.id === id; });
	if (!weapon) throw new RangeError(`Unknown Heavy Rig weapon: ${id}`);
	return weapon;
};
export const isReserve = function (weapon: WeaponId, rounds: unknown): rounds is number {
	return typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= 0 && rounds <= (getWeapon(weapon).ammunition?.capacity ?? 0);
};
export const createMount = function (weapon: WeaponId, rounds = getWeapon(weapon).ammunition?.defaultLoad ?? 0): WeaponMount {
	if (!isReserve(weapon, rounds)) throw new RangeError(`Invalid ammunition reserve for ${weapon}`);
	return { weapon, rounds, level: 1, cooldown: 0, firing: false };
};
export const weaponDamage = function (weapon: WeaponDefinition, level: number) { return weapon.damage * (1 + (level - 1) * 0.3); };
