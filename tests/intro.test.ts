import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createCampaign, parseCampaign } from '../src/campaign';
import { createCombatRuntime } from '../src/combat-runtime';
import { createEscape, INTRO_FRAMES, INTRO_LINES, narrativeFrame } from '../src/intro';
import { distance } from '../src/simulation';

test('narrative finishes typing before its full hold and fade, then starts the next line empty', function () {
	const first = INTRO_LINES[0];
	const typedAt = first.length / 10;
	expect(narrativeFrame(INTRO_LINES, 0).text).toBe('');
	expect(narrativeFrame(INTRO_LINES, 1).text).toBe(first.slice(0, 10));
	expect(narrativeFrame(INTRO_LINES, typedAt + 1.99)).toMatchObject({ text: first, opacity: 1, done: false });
	expect(narrativeFrame(INTRO_LINES, typedAt + 2.5)).toMatchObject({ text: first, opacity: 0.5 });
	expect(narrativeFrame(INTRO_LINES, typedAt + 3)).toMatchObject({ index: 1, text: '', opacity: 1 });
	const duration = INTRO_LINES.reduce(function (sum, line) { return sum + line.length / 10 + 3; }, 0);
	expect(narrativeFrame(INTRO_LINES, duration + 0.01).done).toBe(true);
});

test('v4 companies preserve escape completion and earlier campaign versions are ignored', function () {
	const fresh = createCampaign(123);
	expect(fresh.introComplete).toBe(false);
	expect(parseCampaign(JSON.stringify(fresh)).introComplete).toBe(false);
	const completed = { ...fresh, introComplete: true };
	expect(parseCampaign(JSON.stringify(completed))).toEqual(completed);
	const oldCompany = parseCampaign(JSON.stringify({ ...completed, version: 3, credits: 9000 }));
	expect(oldCompany.version).toBe(4);
	expect(oldCompany.introComplete).toBe(false);
	expect(oldCompany.credits).toBe(0);
});

for (const frame of INTRO_FRAMES) test(`${frame} can escape through real ECS combat without killing the guards`, async function () {
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(1 / 60).build();
	await world.initialize();
	try {
		const state = combat.attach(createEscape(frame));
		const mission = state.mission;
		if (!mission) throw new Error('Escape must have an evacuation point');
		expect(mission.map.width * mission.map.height).toBeCloseTo(2600 * 2000 * 3, 5);
		expect(state.player.x).toBeLessThan(mission.map.width / 4);
		expect(state.player.y).toBeLessThan(mission.map.height / 4);
		expect(mission.map.extraction.x).toBeGreaterThan(mission.map.width * 0.75);
		expect(mission.map.extraction.y).toBeGreaterThan(mission.map.height * 0.75);
		combat.setEnabled(true);
		combat.setControls(function () {
			return { drive: 0, turn: 0, throttleTarget: Math.min(1, distance(state.player, mission.map.extraction) / 170), stop: distance(state.player, mission.map.extraction) < 70, aim: mission.map.extraction, fire: [false, false, false, false], coolant: false };
		});
		for (let tick = 0; tick < 60 * 70 && state.outcome === 'playing'; tick++) {
			world.update(1 / 60);
			if (state.time < 7) {
				expect(state.enemies.every(function (enemy) { return !enemy.engaged; })).toBe(true);
				expect(state.stats.damageTaken).toBe(0);
			}
		}
		expect(state.outcome).toBe('won');
		expect(state.kills).toBe(0);
		expect(state.spawned).toBe(0);
		expect(state.stats.shotsFired).toBe(0);
		expect(state.player.hp).toBeGreaterThan(0);
		const time = state.time;
		combat.setEnabled(false); world.update(1);
		expect(state.time).toBe(time);
	} finally { await world.dispose(); }
});
