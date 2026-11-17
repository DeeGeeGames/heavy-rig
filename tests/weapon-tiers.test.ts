import { addMissileTarget } from './missile-fixture';
import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createMount, getWeapon, WEAPON_MODELS, WEAPON_TIERS, weaponIdForTier, type WeaponModelId, type WeaponTier } from '../src/arsenal';
import { createCombatRuntime } from '../src/combat-runtime';
import { coolingStep, createState, weaponsStep, type Controls } from '../src/simulation';

test('quality improves every weapon without changing mount identity, mass or ammunition', function () {
	for (const model of WEAPON_MODELS) {
		let previous = model;
		for (const quality of WEAPON_TIERS) {
			const weapon = getWeapon(weaponIdForTier(model.modelId, quality.tier));
			expect(weapon.modelId).toBe(model.modelId);
			expect(weapon.family).toBe(model.family);
			expect(weapon.mass).toBe(model.mass);
			expect(weapon.ammunition).toEqual(model.ammunition);
			expect(weapon.projectiles).toBe(model.projectiles);
			if (quality.tier > 0) {
				expect(weapon.damage).toBeGreaterThan(previous.damage);
				expect(weapon.range).toBeGreaterThan(previous.range);
				expect(weapon.heat).toBeLessThan(previous.heat);
				if (weapon.interval > 0) expect(weapon.interval).toBeLessThan(previous.interval);
				if (weapon.speed > 0) expect(weapon.speed).toBeGreaterThan(previous.speed);
				if (weapon.spread > 0) expect(weapon.spread).toBeLessThan(previous.spread);
			}
			previous = weapon;
		}
	}
});

const fire: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 600 }, targetId: 1, fire: [true, false, false, false], coolant: false };
const exercise = async function (model: WeaponModelId, tier: WeaponTier) {
	const weapon = getWeapon(weaponIdForTier(model, tier));
	const initial = createState({ starter: weapon.id });
	initial.spawnIn = 3600;
	initial.loadout = [createMount(weapon.id)];
	initial.enemies = [{ id: 1, x: 900, y: 600, hp: 10000, maxHp: 10000, kind: 'striker', heavy: false, angle: 0, cooldown: 3600 }];
	initial.nextId = 2;
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize();
		const state = combat.attach(initial);
		combat.setControls(function () { return fire; });
		combat.setEnabled(true);
		world.update(1 / 60);
		const mount = state.loadout[0];
		if (!mount) throw new Error('Missing equipped tiered weapon');
		expect(mount.weapon).toBe(weapon.id);
		expect(mount.cooldown).toBeCloseTo(weapon.interval);
		expect(mount.rounds).toBe((weapon.ammunition?.defaultLoad ?? 0) - (weapon.ammunition ? 1 : 0));
		if (weapon.kind !== 'laser') {
			const shot = state.shots[0];
			if (!shot) throw new Error('Tiered projectile was not emitted through ECS');
			expect(shot.weapon).toBe(weapon.id);
			expect(shot.damage).toBe(weapon.damage);
			expect(Math.hypot(shot.vx, shot.vy, shot.vElevation ?? 0)).toBeCloseTo(weapon.speed);
		}
		const heat = state.player.heat;
		combat.setControls(function () { return { ...fire, fire: [false, false, false, false] }; });
		for (let tick = 0; tick < 30; tick++) world.update(1 / 60);
		expect(state.stats.damageDealt).toBeGreaterThan(0);
		return { damage: state.stats.damageDealt, heat };
	} finally {
		await world.dispose();
	}
};

test('tiered shells and beams deliver increased damage and reduced heat through the live ECS runtime', async function () {
	for (const model of ['autocannon', 'laser'] as const) {
		const baseline = await exercise(model, 0);
		const upgraded = await exercise(model, 5);
		expect(upgraded.damage).toBeGreaterThan(baseline.damage);
		expect(upgraded.heat).toBeLessThan(baseline.heat);
	}
});

test('upgraded six-round volleys can sustain their advertised cycle at the fixed simulation rate', function () {
	const dt = 1 / 60;
	for (const model of ['stream-missiles-6', 'stream-rockets-6', 'cluster-rockets-6'] as const) {
		const weapon = getWeapon(weaponIdForTier(model, 5));
		const state = createState({ starter: weapon.id }); const contact = addMissileTarget(state);
		weaponsStep(state, { ...fire, targetId: contact.id }, dt);
		let elapsed = 0;
		while (state.stats.shotsFired <= weapon.projectiles && elapsed < weapon.interval + 1) {
			coolingStep(state, fire, dt);
			weaponsStep(state, { ...fire, targetId: contact.id }, dt);
			elapsed += dt;
		}
		expect(state.stats.shotsFired).toBe(weapon.projectiles + 1);
		expect(elapsed).toBeLessThanOrEqual(weapon.interval + dt + 1e-9);
	}
});
