import { expect, test } from 'bun:test';
import { Box3, Matrix4, Scene, Vector3 } from 'three';
import { createBiomeScenery } from '../src/biome-scenery';
import { terrainPathClear } from '../src/field-terrain';
import { createSurfaceLanding, planLaunchLanding } from '../src/launch-surface';
import { cloudEntry, cloudExit, LAUNCH_DURATION, LAUNCH_TIMING, launchCues, launchSceneTime } from '../src/launch-timing';
import { DROPSHIP_DECK, DROPSHIP_WIDTH } from '../src/launch-ships';
import { combatTargets, type Point } from '../src/simulation';
import { createSituationMission } from '../src/situation-sim';

const { touchdown, lift } = LAUNCH_TIMING;

test('the ship keeps moving through the extra beats and meets the landing and liftoff cues', function () {
	const extra = 2 * 60 / 120;
	expect(LAUNCH_DURATION).toBe(LAUNCH_TIMING.end + extra);
	expect(launchSceneTime(cloudEntry)).toBe(cloudEntry);
	let previous = cloudEntry;
	for (let frame = 1; cloudEntry + frame / 60 < cloudExit + extra; frame++) {
		const scene = launchSceneTime(cloudEntry + frame / 60);
		expect(scene).toBeGreaterThan(previous);
		previous = scene;
	}
	expect(launchSceneTime(cloudExit + extra)).toBeCloseTo(cloudExit);
	const effects = Object.fromEntries(launchCues.map(function (cue) { return [cue.kind, launchSceneTime(cue.at)] as const; }));
	expect(effects).toMatchObject({ release: LAUNCH_TIMING.release, land: touchdown + .5, lift });
	expect(launchSceneTime(LAUNCH_DURATION)).toBe(LAUNCH_TIMING.end);
});

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
			const unloading = landing.update(touchdown + 2, 900, 600);
			expect(unloading.poses.some(function (pose) { return pose.elevation > 0; })).toBe(true);
			if (!skip) {
				const handoff = landing.update(LAUNCH_TIMING.end, 900, 600);
				expect(handoff.zoom).toBe(1);
				expect(handoff.poses.length).toBe(actors.length);
				handoff.poses.forEach(function (pose, index) {
					const actor = actors[index];
					if (!actor) throw new Error('Unexpected rig on the landing field');
					expect(pose.elevation).toBeCloseTo(0);
					expect(pose.position.x).toBeCloseTo(actor.x);
					expect(pose.position.y).toBeCloseTo(actor.y);
				});
			}
		} finally { landing.dispose(); }
		expect(state).toEqual(original);
		expect(scene.children).toHaveLength(0);
	}
});

test('the visible dropship flies into touchdown and unloading travels between held pose exposures', function () {
	const state = createSituationMission({ kind: 'recovery', planetId: 'cinder', tier: 1, frame: 'warden', wing: [] }, 283191706, 'story');
	const map = state.mission?.map;
	if (!map) throw new Error('Missing deployment map');
	const scene = new Scene(), plan = planLaunchLanding(state, map), landing = createSurfaceLanding(scene, state, map, plan);
	try {
		const ship = scene.getObjectByName('company-dropship-vehicle');
		if (!ship) throw new Error('Missing landing ship');
		landing.update(LAUNCH_TIMING.approach, 900, 600);
		expect(ship.visible).toBe(true);
		const initialHeight = ship.position.y;
		const landingSite = plan.site.at(0, 0);
		const distanceToSite = function () { return Math.hypot(ship.position.x - landingSite.x, ship.position.z - landingSite.y); };
		const initialDistance = distanceToSite();
		landing.update(LAUNCH_TIMING.approach + 1 / 60, 900, 600);
		expect(distanceToSite()).toBeLessThan(initialDistance);
		landing.update(touchdown - 1 / 60, 900, 600);
		const arriving = ship.position.clone();
		landing.update(touchdown, 900, 600);
		expect(distanceToSite()).toBeCloseTo(0);
		expect(ship.position.distanceTo(arriving)).toBeLessThan(1);
		expect(ship.position.y).toBeLessThan(initialHeight);

		landing.update(touchdown + .25, 900, 600);
		const height = ship.position.y;
		landing.update(touchdown + .25 + 1 / 60, 900, 600);
		expect(ship.position.y).toBeLessThan(height);

		const first = landing.update(touchdown + 2.25, 900, 600);
		const next = landing.update(touchdown + 2.25 + 1 / 60, 900, 600);
		const exposed = landing.update(touchdown + 2.375, 900, 600);
		const [a] = first.poses, [b] = next.poses, [c] = exposed.poses;
		if (!a || !b || !c) throw new Error('Missing disembarking rig');
		expect(plan.site.aftAt(b.position)).toBeGreaterThan(plan.site.aftAt(a.position));
		expect(b.elevation).toBeLessThan(a.elevation);
		expect(next.focus).not.toEqual(first.focus);
		expect(next.zoom).toBeLessThan(first.zoom);
		expect(b.gait).toEqual(a.gait);
		expect(c.gait.feet).not.toEqual(b.gait.feet);
	} finally { landing.dispose(); }
});

test('wingmates board on their formation side and walk directly off the ramp on clear approaches', function () {
	// The recorded landing needs the Maul out first on the left. On the second
	// approach both wingmates use the right lane, with the Kestrel out first.
	for (const [seed, firstWing] of [[99283, 2], [317, 1]] as const) {
		const state = createSituationMission({
			planetId: 'cinder', kind: 'recovery', tier: 1, frame: 'warden',
			wing: [{ pilotId: 'flint', frame: 'kestrel' }, { pilotId: 'kite', frame: 'maul' }],
		}, seed, 'story');
		const map = state.mission?.map;
		if (!map) throw new Error('Missing deployment map');
		const { site, paths } = planLaunchLanding(state, map);
		const at = site.at(0, DROPSHIP_DECK.toe);
		const side = function (p: Point) { return (p.x - at.x) * Math.sin(site.heading) - (p.y - at.y) * Math.cos(site.heading); };
		const actors = [state.player, ...state.squadmates];
		const times = Array.from({ length: 57 }, function (_, i) { return touchdown + i / 8; });
		const exits = paths.map(function (path, index) {
			const actor = actors[index];
			if (!actor) throw new Error('Unexpected passenger');
			const start = path(touchdown);
			if (index > 0) expect(Math.sign(side(start))).toBe(Math.sign(side(actor)));
			let previous = side(start), travel = 0;
			for (const time of times) {
				const x = side(path(time));
				travel += Math.abs(x - previous); previous = x;
			}
			expect(previous).toBeCloseTo(side(actor));
			expect(travel).toBeCloseTo(Math.abs(side(actor) - side(start)));
			const clear = times.find(function (t) { return site.aftAt(path(t)) >= DROPSHIP_DECK.toe; });
			if (clear === undefined) throw new Error('Passenger stayed aboard');
			return { index, clear };
		}).sort(function (a, b) { return a.clear - b.clear; });
		expect(exits.map(function (rig) { return rig.index; })).toEqual([firstWing, 3 - firstWing, 0]);
	}
});

test('two rigs with port-side stations can share a lane and unload in order', function () {
	const state = createSituationMission({
		planetId: 'cinder', kind: 'recovery', tier: 1, frame: 'warden', wing: [{ pilotId: 'flint', frame: 'maul' }],
	}, 283191706, 'story');
	const map = state.mission?.map;
	if (!map) throw new Error('Missing deployment map');
	const { berths, paths, site } = planLaunchLanding(state, map);
	const [commander, wingmate] = berths;
	if (!commander || !wingmate) throw new Error('Missing deployment berth');
	expect(wingmate.x).toBeLessThan(0);
	expect(wingmate.x).toBe(commander.x);
	expect(wingmate.z).toBeGreaterThan(commander.z);
	expect(wingmate.exitOrder).toBeLessThan(commander.exitOrder);
	const clear = paths.map(function (path) {
		for (let t = touchdown + 2; t < LAUNCH_TIMING.end - 1; t += .125) if (site.aftAt(path(t)) >= DROPSHIP_DECK.toe) return t;
		throw new Error('Rig stayed aboard');
	});
	const [last, first] = clear;
	if (first === undefined || last === undefined) throw new Error('Missing ramp crossing');
	expect(last - first).toBeGreaterThanOrEqual(.875);
});

test('the ship keeps the ramp down while the last rig still has a foot on it', function () {
	const state = createSituationMission({
		planetId: 'meridian', kind: 'defend', tier: 1, frame: 'maul',
		wing: [{ pilotId: 'flint', frame: 'kestrel' }, { pilotId: 'kite', frame: 'maul' }, { pilotId: 'glass', frame: 'warden-c' }],
	}, 92811, 'story');
	const map = state.mission?.map;
	if (!map) throw new Error('Missing deployment map');
	const scene = new Scene(), plan = planLaunchLanding(state, map), landing = createSurfaceLanding(scene, state, map, plan);
	try {
		landing.update(touchdown + 1.5, 900, 600);
		const ship = scene.getObjectByName('company-dropship-vehicle'), ramp = scene.getObjectByName('aft-ramp');
		if (!ship || !ramp) throw new Error('Missing landing ship');
		const down = ramp.rotation.x;
		let lastFoot = 0;
		for (let t = lift - .5; t < LAUNCH_TIMING.end; t += .125) {
			const { poses } = landing.update(t, 900, 600);
			if (poses.some(function (rig) { return rig.gait.feet.some(function (foot) { return plan.site.aftAt(foot) < DROPSHIP_DECK.toe + 8; }); })) {
				expect(ramp.rotation.x).toBeCloseTo(down);
				expect(ship.position.y).toBeCloseTo(0);
				lastFoot = t;
			}
		}
		expect(lastFoot).toBeGreaterThanOrEqual(lift - .125);
		expect(ramp.rotation.x).toBeLessThan(down);
		expect(ship.position.y).toBeGreaterThan(0);
	} finally { landing.dispose(); }
});

test('a loaded dropship lands clear of obstacles, guards and facilities already on the field', function () {
	for (const [planetId, kind, tier, seed] of [['meridian', 'acquisition', 6, 11139138], ['cinder', 'raid', 1, 11235680], ['brackwater', 'defend', 4, 42]] as const) {
		const state = createSituationMission({
			planetId, kind, tier, frame: 'warden',
			wing: [{ pilotId: 'flint', frame: 'kestrel' }, { pilotId: 'kite', frame: 'maul' }, { pilotId: 'glass', frame: 'warden-c' }],
		}, seed, 'story');
		const map = state.mission?.map;
		if (!map) throw new Error('Missing deployment map');
		const scene = new Scene(), plan = planLaunchLanding(state, map), landing = createSurfaceLanding(scene, state, map, plan);
		try {
			landing.update(touchdown + 1.125, 900, 600);
			const ship = scene.getObjectByName('company-dropship-vehicle');
			if (!ship) throw new Error('Missing landed dropship');
			if (map.terrain) expect(terrainPathClear(map.terrain, plan.site.at(0, DROPSHIP_DECK.hinge),
				plan.site.at(0, DROPSHIP_DECK.toe), DROPSHIP_DECK.halfWidth)).toBe(true);
			for (const { body, radius } of combatTargets(state)) {
				const p = ship.worldToLocal(new Vector3(body.x, 0, body.y));
				const insideHull = Math.abs(p.x) < DROPSHIP_WIDTH / 2 + radius && p.z > -190 - radius && p.z < DROPSHIP_DECK.hinge + radius;
				const onRamp = Math.abs(p.x) < DROPSHIP_DECK.halfWidth + radius && p.z >= DROPSHIP_DECK.hinge && p.z < DROPSHIP_DECK.toe + radius;
				expect(insideHull || onRamp).toBe(false);
			}
		} finally { landing.dispose(); }
	}
});

test('rotating blades stay outside the cargo hold as the dropship leaves Galeward', function () {
	const state = createSituationMission({ planetId: 'galeward', kind: 'defend', tier: 4, frame: 'warden',
		wing: [{ pilotId: 'flint', frame: 'maul' }, { pilotId: 'kite', frame: 'kestrel' }, { pilotId: 'glass', frame: 'warden-c' }] }, 42, 'story');
	const map = state.mission?.map;
	if (!map?.terrain) throw new Error('Missing deployment terrain');
	const scene = new Scene(), landing = createSurfaceLanding(scene, state, map);
	const scenery = createBiomeScenery(map.terrain, map.seed, 'steppe');
	try {
		const ship = scene.getObjectByName('company-dropship-vehicle'), rotors = scenery.rotors;
		if (!ship || !rotors) throw new Error('Missing dropship or rotors');
		const hold = new Box3(new Vector3(-145, 32, -125), new Vector3(145, 190, 175));
		const matrix = new Matrix4(), inverse = new Matrix4(), point = new Vector3();
		const vertices = rotors.mesh.geometry.getAttribute('position');
		for (let t = lift; t <= LAUNCH_TIMING.end; t += .125) {
			landing.update(t, 900, 600); ship.updateMatrixWorld(true);
			inverse.copy(ship.matrixWorld).invert();
			rotors.update(t - LAUNCH_TIMING.end);
			for (let i = 0; i < rotors.mesh.count; i++) {
				rotors.mesh.getMatrixAt(i, matrix); matrix.premultiply(inverse);
				for (let v = 0; v < vertices.count; v++) {
					if (hold.containsPoint(point.fromBufferAttribute(vertices, v).applyMatrix4(matrix))) throw new Error(`Rotor entered the cargo hold at ${t}s`);
				}
			}
		}
	} finally { landing.dispose(); scenery.dispose(); }
});
