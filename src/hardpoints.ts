import { WEAPONS, getWeapon, type WeaponFamily, type WeaponId } from './arsenal';
import { getFrame, type FrameId } from './frames';
import type { EnemyKind } from './simulation';

export interface Hardpoint {
	readonly id: string;
	readonly name: string;
	readonly family: WeaponFamily;
	readonly weapons: readonly WeaponId[];
}

const BALLISTIC: readonly WeaponId[] = ['machine-gun', 'autocannon'];
const LAUNCHERS: readonly WeaponId[] = WEAPONS.filter(function (weapon) { return weapon.family === 'launcher'; }).map(function (weapon) { return weapon.id; });
const gun = function (side: 'left' | 'right', light = false): Hardpoint {
	return { id: `${side}-gun`, name: `${side === 'left' ? 'Left' : 'Right'} gun`, family: 'ballistic', weapons: light ? ['machine-gun'] : BALLISTIC };
};
const launcher = function (side: 'left' | 'right', location: string): Hardpoint {
	return { id: `${side}-${location}`, name: `${side === 'left' ? 'Left' : 'Right'} ${location}`, family: 'launcher', weapons: LAUNCHERS };
};
const LINE_HARDPOINTS: readonly Hardpoint[] = [gun('left'), gun('right'), launcher('left', 'shoulder pod'), launcher('right', 'shoulder pod')];
const FRAME_HARDPOINTS: Readonly<Record<FrameId, readonly Hardpoint[]>> = {
	warden: LINE_HARDPOINTS,
	kestrel: [gun('left', true), gun('right', true)],
	maul: [launcher('left', 'forearm pod'), launcher('right', 'forearm pod')],
	longbow: [{ id: 'left-accelerator', name: 'Left accelerator arm', family: 'energy', weapons: ['laser', 'ppc'] }],
	morrow: [launcher('left', 'silo'), launcher('right', 'silo')],
};
const SCOUT_HARDPOINTS: readonly Hardpoint[] = [gun('left', true), gun('right', true)];
const SIEGE_HARDPOINTS: readonly Hardpoint[] = [...LINE_HARDPOINTS,
	{ id: 'dorsal-artillery', name: 'Dorsal artillery', family: 'ballistic', weapons: ['autocannon'] },
];
const HELICOPTER_HARDPOINTS: readonly Hardpoint[] = [{ id: 'chin-gun', name: 'Chin machine gun', family: 'ballistic', weapons: ['machine-gun'] }];
const VTOL_HARDPOINTS: readonly Hardpoint[] = [launcher('left', 'wing pod'), launcher('right', 'wing pod')];
const TANK_HARDPOINTS: readonly Hardpoint[] = [{ id: 'turret-cannon', name: 'Turret cannon', family: 'ballistic', weapons: ['autocannon'] }];

export const getHardpoints = function (frame: FrameId): readonly Hardpoint[] { return FRAME_HARDPOINTS[frame]; };
export const getEnemyHardpoints = function (kind: EnemyKind, commander = false): readonly Hardpoint[] {
	if (kind === 'helicopter') return HELICOPTER_HARDPOINTS;
	if (kind === 'vtol') return VTOL_HARDPOINTS;
	if (kind === 'tank') return TANK_HARDPOINTS;
	return kind === 'siege' || commander ? SIEGE_HARDPOINTS : kind === 'scout' ? SCOUT_HARDPOINTS : LINE_HARDPOINTS;
};
export const canEquipWeapon = function (frame: FrameId, slot: number, weapon: WeaponId): boolean {
	const hardpoint = getHardpoints(frame)[slot];
	return Boolean(hardpoint && hardpoint.family === getWeapon(weapon).family && hardpoint.weapons.includes(weapon));
};
export const isFrameLoadout = function (frame: FrameId, value: unknown): value is readonly (WeaponId | null)[] {
	return Array.isArray(value) && value.length === getHardpoints(frame).length && value.every(function (weapon: unknown, slot) {
		return weapon === null || typeof weapon === 'string' && getHardpoints(frame)[slot]?.weapons.some(function (allowed) { return allowed === weapon; });
	});
};
export const createStarterLoadout = function (frame: FrameId): (WeaponId | null)[] {
	const starter = getFrame(frame).starter;
	return getHardpoints(frame).map(function (_hardpoint, slot) { return slot === 0 ? starter : null; });
};
