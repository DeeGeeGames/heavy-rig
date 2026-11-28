import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { getWeapon, weaponIdForTier, type WeaponId } from '../src/arsenal';
import type { Contract } from '../src/campaign-types';
import { createCombatRuntime } from '../src/combat-runtime';
import type { FrameId } from '../src/frames';
import { createStarterLoadout } from '../src/hardpoints';
import { missionHostileCount } from '../src/missions';
import { getMissionTier, type MissionTier } from '../src/reputation';
import { createMissionState, distance, spawningStep, type Controls, type PresetEnemyKind } from '../src/simulation';

// Broad engagement budgets protect against instant kills, unusable stock builds,
// and tier/volley regressions. They are not exact tuning values or owner acceptance.
const engage = async function (frame: FrameId, kind: Exclude<PresetEnemyKind, 'artillery'>, tier: MissionTier, options: { loadout?: readonly (WeaponId | null)[]; defense?: 'front' | 'rear' | 'exposed' } = {}) {
	const contract: Contract = { id: 'combat-balance', seed: 123, planetId: 'meridian', kind: 'defend', employer: 'freeholds', opponent: 'combine', title: 'Combat balance', briefing: '', reward: 1000, favor: 8, hostility: 5, tier, requiredReputation: -100 };
	const quality = getMissionTier(tier).weaponTier;
	const loadout = options.loadout ?? createStarterLoadout(frame).map(function (id) { return weaponIdForTier(getWeapon(id).modelId, quality); });
	const initial = createMissionState(contract, { frame, loadout });
	Object.assign(initial.player, { x: 900, y: 780, angle: -Math.PI / 2, turret: -Math.PI / 2 });
	initial.spawned = missionHostileCount(contract);
	initial.spawnIn = 3600;
	initial.warnings = [{ kind, x: 900, y: 380, life: .001 }];
	spawningStep(initial, 1 / 60);
	const enemy = initial.enemies[0];
	if (!enemy) throw new Error('Missing balance target');
	enemy.cooldown = 3600;
	if (options.defense) {
		enemy.angle = options.defense === 'rear' ? -Math.PI / 2 : Math.PI / 2;
		enemy.attack = { phase: options.defense === 'exposed' ? 'recovery' : 'committed', remaining: 3600, cycle: 0 };
	}
	const rounds = initial.loadout.map(function (mount) { return mount.rounds; });
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	try {
		await world.initialize();
		const state = combat.attach(initial);
		const target = state.enemies.find(function (unit) { return unit.id === enemy.id; });
		if (!target) throw new Error('Missing live balance target');
		let previous = { x: target.x, y: target.y };
		combat.setControls(function (): Controls {
			// Unguided rounds need lead on circling aircraft, even with a target lock.
			const speed = getWeapon(loadout[0] ?? 'machine-gun').speed;
			const lead = kind === 'helicopter' && speed > 0 ? distance(state.player, target) / speed : 0;
			const aim = { x: target.x + (target.x - previous.x) * 60 * lead, y: target.y + (target.y - previous.y) * 60 * lead };
			previous = { x: target.x, y: target.y };
			return { aim, targetId: target.id, drive: 0, turn: 0, stop: false, fire: [true, true, true, true], coolant: false };
		});
		combat.setEnabled(true);
		while (state.kills === 0 && state.time < 120) world.update(1 / 60);
		expect(state.kills).toBe(1);
		expect(state.stats.damageDealt).toBeCloseTo(enemy.maxHp);
		expect(state.player.hp).toBe(100);
		return { seconds: state.time, overheats: state.stats.overheats, used: state.loadout.map(function (mount, index) { return (rounds[index] ?? 0) - mount.rounds; }) };
	} finally {
		await world.dispose();
	}
};

test('the starting twin-gun Kestrel needs sustained tracking on a Frontier scout and retains sortie ammunition', async function () {
	const scout = await engage('kestrel', 'scout', 3, { loadout: createStarterLoadout('kestrel') });
	const aircraft = await engage('kestrel', 'helicopter', 1);
	expect(scout.seconds).toBeGreaterThan(6);
	expect(scout.seconds).toBeLessThan(18);
	expect(aircraft.seconds).toBeLessThan(5);
	expect(aircraft.seconds).toBeLessThan(scout.seconds / 2);
	// One scout cannot consume the supply needed for the rest of the sortie.
	expect(scout.used.every(function (rounds) { return rounds < 150; })).toBe(true);
});

test('stock line, brawler, precision and support packages sustain useful mech kill times across progression', async function () {
	for (const tier of [5, 10] as const) for (const frame of ['warden', 'maul', 'longbow', 'morrow'] as const) {
		const result = await engage(frame, 'striker', tier);
		expect(result.seconds).toBeGreaterThan(8);
		expect(result.seconds).toBeLessThan(35);
		// Every stock package must leave enough ordnance for several more contacts.
		expect(result.used.every(function (rounds) { return rounds < 120; })).toBe(true);
	}
});

test('exceptional six-round pods cannot erase heavy armor in one opening burst and reward flanking or exposure', async function () {
	const loadout = ['cluster-rockets-6:t5', 'cluster-rockets-6:t5', null, null] as const;
	const front = await engage('maul', 'siege', 10, { loadout, defense: 'front' });
	const rear = await engage('maul', 'siege', 10, { loadout, defense: 'rear' });
	const exposed = await engage('maul', 'siege', 10, { loadout, defense: 'exposed' });
	expect(front.seconds).toBeGreaterThan(12);
	expect(front.seconds).toBeLessThan(90);
	expect(front.overheats).toBeGreaterThan(0);
	expect(rear.seconds).toBeLessThan(front.seconds * .85);
	expect(exposed.seconds).toBeLessThan(rear.seconds);
});
