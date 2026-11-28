import { expect, test } from 'bun:test';
import { WEAPON_MODELS, createMount, getWeapon, weaponIdForTier } from '../src/arsenal';
import { createState, enemiesStep, projectilesStep, MISSILE_LOCK_SECONDS, type Unit } from '../src/simulation';
import { SILO_DEPLOY_SECONDS } from '../src/silo-turret';

test('every mech weapon fires its own beam or ammunition from a deployed silo', function () {
	const dt = 1 / 60;
	for (const model of WEAPON_MODELS) {
		const state = createState();
		const weapon = getWeapon(weaponIdForTier(model.modelId, 2));
		const mount = createMount(weapon.id);
		const rounds = mount.rounds;
		// An unobstructed broadside tests traverse as well as the physical firing origin.
		const at = { x: state.player.x - 350, y: state.player.y };
		const gun: Unit = { ...at, id: 9, kind: 'silo-turret', angle: Math.PI / 2, hullAngle: 0, hp: 300, maxHp: 300, cooldown: 0,
			heavy: true, stationary: true, silo: { deployment: 0, shotsFired: 0 }, loadout: [mount] };
		state.enemies = [gun];
		for (let tick = 0; tick < Math.round(SILO_DEPLOY_SECONDS / dt); tick++) enemiesStep(state, dt);
		expect(state.shots).toHaveLength(0); expect(state.beams).toHaveLength(0);
		for (let tick = 0; tick < 300 && !state.beams.length && state.shots.length < weapon.projectiles; tick++) {
			enemiesStep(state, dt);
			if (weapon.kind === 'missile' && tick + 1 < MISSILE_LOCK_SECONDS / dt) expect(state.shots).toHaveLength(0);
		}
		expect({ x: gun.x, y: gun.y }).toEqual(at);
		if (weapon.kind === 'laser') {
			expect(state.beams[0]).toMatchObject({ owner: gun.id, contact: true });
		} else {
			expect(state.shots).toHaveLength(weapon.projectiles);
			const origins = new Set<string>();
			for (const shot of state.shots) {
				expect(shot).toMatchObject({ kind: weapon.kind, weapon: weapon.id, owner: gun.id, damage: weapon.damage, target: weapon.kind === 'missile' ? 0 : undefined });
				origins.add(JSON.stringify(shot.origin));
			}
			expect(rounds - mount.rounds).toBe(weapon.ammunition ? weapon.projectiles : 0);
			expect(origins.size).toBe(weapon.projectiles);
			for (let tick = 0; tick < 60 && state.shots.length; tick++) projectilesStep(state, dt);
		}
		expect(state.player.hp).toBeLessThan(100);
		expect(state.stats.shotsFired).toBe(0);
	}
});
