import { expect, test } from 'bun:test';
import { Scene, Vector3 } from 'three';
import { createSurfaceLanding } from '../src/launch-surface';
import { LAUNCH_TIMING } from '../src/launch-timing';
import { DROPSHIP_DECK, DROPSHIP_WIDTH } from '../src/launch-ships';
import { combatTargets } from '../src/simulation';
import { createSituationMission } from '../src/situation-sim';

test('skipping mid-ramp and completing the landing both hand off the original deployed formation', function () {
	const state = createSituationMission({
		kind: 'recovery', planetId: 'cinder', tier: 1, frame: 'warden',
		wing: [{ pilotId: 'flint', frame: 'maul' }, { pilotId: 'kite', frame: 'kestrel' }, { pilotId: 'glass', frame: 'warden-c' }],
	}, 283191706, 'story');
	const map = state.mission?.map;
	if (!map) throw new Error('Missing deployment map');
	const original = structuredClone(state);
	const actors = [state.player, ...state.squadmates];
	const scene = new Scene();
	for (const skip of [true, false]) {
		const landing = createSurfaceLanding(scene, state, map);
		try {
			const unloading = landing.update(9, 900, 600);
			expect(unloading.poses.some(function (pose) { return pose.elevation > 0; })).toBe(true);
			if (!skip) {
				const handoff = landing.update(LAUNCH_TIMING.end, 900, 600);
				expect(handoff.zoom).toBe(1);
				expect(handoff.poses.length).toBe(actors.length);
				handoff.poses.forEach(function (pose, index) {
					const actor = actors[index];
					if (!actor) throw new Error('Unexpected rig on the landing field');
					expect(pose.elevation).toBeCloseTo(0);
					expect(pose.gait.body.x).toBeCloseTo(actor.x);
					expect(pose.gait.body.y).toBeCloseTo(actor.y);
				});
			}
		} finally { landing.dispose(); }
		expect(state).toEqual(original);
		expect(scene.children).toHaveLength(0);
	}
});

test('a loaded dropship lands clear of the guards and facilities already on the field', function () {
	for (const [planetId, kind, tier, seed] of [['meridian', 'acquisition', 6, 11139138], ['cinder', 'raid', 1, 11235680]] as const) {
		const state = createSituationMission({
			planetId, kind, tier, frame: 'warden',
			wing: [{ pilotId: 'flint', frame: 'kestrel' }, { pilotId: 'kite', frame: 'maul' }, { pilotId: 'glass', frame: 'warden-c' }],
		}, seed, 'story');
		const map = state.mission?.map;
		if (!map) throw new Error('Missing deployment map');
		const scene = new Scene(), landing = createSurfaceLanding(scene, state, map);
		try {
			landing.update(8.125, 900, 600);
			const ship = scene.getObjectByName('company-dropship-vehicle');
			if (!ship) throw new Error('Missing landed dropship');
			for (const { body, radius } of combatTargets(state)) {
				const p = ship.worldToLocal(new Vector3(body.x, 0, body.y));
				const insideHull = Math.abs(p.x) < DROPSHIP_WIDTH / 2 + radius && p.z > -190 - radius && p.z < DROPSHIP_DECK.hinge + radius;
				const onRamp = Math.abs(p.x) < 145 + radius && p.z >= DROPSHIP_DECK.hinge && p.z < DROPSHIP_DECK.toe + radius;
				expect(insideHull || onRamp).toBe(false);
			}
		} finally { landing.dispose(); }
	}
});
