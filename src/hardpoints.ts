import { WEAPONS, WEAPON_MODELS, getWeapon, type WeaponFamily, type WeaponId, type WeaponModelId, type WeaponSize } from './arsenal';
import type { FrameId } from './frames';
import type { EnemyKind } from './simulation';

export interface Hardpoint {
	readonly id: string;
	readonly name: string;
	readonly family: WeaponFamily;
	readonly maxSize: WeaponSize;
	readonly weapons: readonly WeaponModelId[];
}

const SIZE_ORDER: Readonly<Record<WeaponSize, number>> = { small: 1, medium: 2, large: 3 };
// Seeded Market packages depend on the order of the compatible models.
const HARDPOINT_MODELS = [getWeapon('machine-gun'), ...WEAPON_MODELS.filter(function (weapon) { return weapon.modelId !== 'machine-gun'; })];
const hardpoint = function (id: string, name: string, family: WeaponFamily, maxSize: WeaponSize, fixedModel?: WeaponModelId): Hardpoint {
	const weapons = HARDPOINT_MODELS.filter(function (weapon) {
		return weapon.family === family && SIZE_ORDER[weapon.size] <= SIZE_ORDER[maxSize]
			&& (fixedModel === undefined || weapon.modelId === fixedModel);
	}).map(function (weapon) { return weapon.modelId; });
	return { id, name, family, maxSize, weapons };
};
const fixedHardpoint = function (id: string, name: string, model: WeaponModelId): Hardpoint {
	const weapon = getWeapon(model);
	return hardpoint(id, name, weapon.family, weapon.size, model);
};
const gun = function (side: 'left' | 'right', maxSize: WeaponSize = 'medium'): Hardpoint {
	return hardpoint(`${side}-gun`, `${side === 'left' ? 'Left' : 'Right'} gun`, 'ballistic', maxSize);
};
const launcher = function (side: 'left' | 'right', location: string, maxSize: WeaponSize = 'large'): Hardpoint {
	return hardpoint(`${side}-${location}`, `${side === 'left' ? 'Left' : 'Right'} ${location}`, 'launcher', maxSize);
};
const energy = function (side: 'left' | 'right', location: string, maxSize: WeaponSize = 'medium'): Hardpoint {
	return hardpoint(`${side}-${location}`, `${side === 'left' ? 'Left' : 'Right'} ${location}`, 'energy', maxSize);
};
const ACCELERATOR = hardpoint('left-accelerator', 'Left accelerator arm', 'energy', 'medium');
const DORSAL_LAUNCHER = hardpoint('dorsal-launcher', 'Compact dorsal launcher', 'launcher', 'small');
const LINE_HARDPOINTS: readonly Hardpoint[] = [gun('left'), gun('right'), launcher('left', 'shoulder pod'), launcher('right', 'shoulder pod')];
const FRAME_HARDPOINTS: Readonly<Record<FrameId, readonly Hardpoint[]>> = {
	warden: LINE_HARDPOINTS,
	'warden-b': [gun('left'), gun('right'), energy('left', 'shoulder bank'), energy('right', 'shoulder bank')],
	'warden-c': [gun('left'), gun('right'), energy('left', 'shoulder bank'), launcher('right', 'shoulder pod')],
	kestrel: [gun('left', 'small'), gun('right', 'small')],
	'kestrel-b': [gun('left', 'small'), energy('right', 'compact emitter', 'small')],
	'kestrel-c': [gun('left', 'small'), launcher('right', 'compact pod', 'small')],
	maul: [launcher('left', 'forearm pod'), launcher('right', 'forearm pod')],
	'maul-b': [gun('left'), gun('right')],
	'maul-c': [gun('left'), energy('right', 'gauntlet bank')],
	longbow: [ACCELERATOR],
	'longbow-b': [gun('left'), energy('right', 'compact offhand', 'small')],
	'longbow-c': [ACCELERATOR, launcher('right', 'compact offhand', 'small')],
	morrow: [launcher('left', 'silo'), launcher('right', 'silo')],
	'morrow-b': [energy('left', 'pod bank'), energy('right', 'pod bank')],
	'morrow-c': [energy('left', 'pod bank'), launcher('right', 'silo')],
	rook: [gun('left'), gun('right'), DORSAL_LAUNCHER],
	'rook-b': [energy('left', 'arm bank'), energy('right', 'arm bank'), DORSAL_LAUNCHER],
	'rook-c': [gun('left'), energy('right', 'arm bank'), DORSAL_LAUNCHER],
};
const SCOUT_HARDPOINTS: readonly Hardpoint[] = [gun('left', 'small'), gun('right', 'small')];
const SIEGE_HARDPOINTS: readonly Hardpoint[] = [...LINE_HARDPOINTS, fixedHardpoint('dorsal-artillery', 'Dorsal artillery', 'autocannon')];
const HELICOPTER_HARDPOINTS: readonly Hardpoint[] = [fixedHardpoint('chin-gun', 'Chin machine gun', 'machine-gun')];
const VTOL_HARDPOINTS: readonly Hardpoint[] = [launcher('left', 'wing pod'), launcher('right', 'wing pod')];
const TANK_HARDPOINTS: readonly Hardpoint[] = [fixedHardpoint('turret-cannon', 'Turret cannon', 'autocannon')];

export const getHardpoints = function (frame: FrameId): readonly Hardpoint[] { return FRAME_HARDPOINTS[frame]; };
export const getEnemyHardpoints = function (kind: EnemyKind, commander = false): readonly Hardpoint[] {
	if (kind === 'helicopter') return HELICOPTER_HARDPOINTS;
	if (kind === 'vtol') return VTOL_HARDPOINTS;
	if (kind === 'tank') return TANK_HARDPOINTS;
	return kind === 'siege' || commander ? SIEGE_HARDPOINTS : kind === 'scout' ? SCOUT_HARDPOINTS : LINE_HARDPOINTS;
};
export const canEquipWeapon = function (frame: FrameId, slot: number, weapon: WeaponId): boolean {
	const hardpoint = getHardpoints(frame)[slot];
	return Boolean(hardpoint?.weapons.includes(getWeapon(weapon).modelId));
};
export const isFrameLoadout = function (frame: FrameId, value: unknown): value is readonly (WeaponId | null)[] {
	return Array.isArray(value) && value.length === getHardpoints(frame).length && Array.from(value).every(function (weapon: unknown, slot) {
		return weapon === null || typeof weapon === 'string' && WEAPONS.some(function (equipment) {
			return equipment.id === weapon && getHardpoints(frame)[slot]?.weapons.includes(equipment.modelId);
		});
	});
};
// Stock packages fill every physical mount. Tier zero equipment is included in
// the chassis price; refits may still deliberately leave individual mounts empty.
const STOCK_LOADOUTS: Readonly<Record<FrameId, readonly WeaponModelId[]>> = {
	warden: ['autocannon', 'machine-gun', 'stream-missiles', 'stream-rockets'],
	'warden-b': ['autocannon', 'machine-gun', 'laser', 'ppc'],
	'warden-c': ['autocannon', 'machine-gun', 'laser', 'stream-missiles'],
	kestrel: ['machine-gun', 'machine-gun'],
	'kestrel-b': ['machine-gun', 'laser'],
	'kestrel-c': ['machine-gun', 'stream-rockets'],
	maul: ['cluster-rockets', 'cluster-rockets'],
	'maul-b': ['autocannon', 'autocannon'],
	'maul-c': ['autocannon', 'laser'],
	longbow: ['ppc'],
	'longbow-b': ['machine-gun', 'laser'],
	'longbow-c': ['laser', 'stream-missiles'],
	morrow: ['cluster-missiles', 'cluster-missiles'],
	'morrow-b': ['laser', 'ppc'],
	'morrow-c': ['ppc', 'cluster-missiles'],
	rook: ['autocannon', 'machine-gun', 'stream-rockets'],
	'rook-b': ['laser', 'laser', 'stream-missiles'],
	'rook-c': ['machine-gun', 'laser', 'stream-rockets'],
};
export const createStarterLoadout = function (frame: FrameId): WeaponId[] { return [...STOCK_LOADOUTS[frame]]; };
