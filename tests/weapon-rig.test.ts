import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { emplacementLaunch } from '../src/artillery-emplacement-rig';
import { sampleMechResponses } from '../src/mech-response';
import { createState } from '../src/simulation';
import { groundHeight, groundNormal } from '../src/terrain-elevation';
import { FRAMES } from '../src/frames';
import { createGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { getEnemyMuzzle, getEnemyWeaponRig, getFiringDirection, getPlayerFiringDirection, getPlayerMuzzle, getPlayerWeaponRig, weaponPivot, type SpatialPoint } from '../src/weapon-rig';
import { snapMechHeading } from '../src/torso-arc';

const assertPosition = function (actual: Vector3 | undefined, expected: SpatialPoint, body: { x: number; y: number }) {
	if (!actual) throw new Error('Missing physical weapon muzzle');
	expect(actual.distanceTo(new Vector3(expected.x - body.x, expected.elevation, expected.y - body.y))).toBeLessThan(0.000001);
};

test('every player mount and pod tube shares combat geometry through target elevation, suspension and recoil', function () {
	const body = { x: 700, y: 420, angle: -0.6 }; const heading = 0.7;
	const gait = createGait(body); gait.motion = { lift: 3, roll: 0.08, pitch: -0.04, impact: 0.5 };
	const targets: readonly (SpatialPoint | undefined)[] = [undefined, { x: body.x + Math.cos(heading) * 400, y: body.y + Math.sin(heading) * 400, elevation: 147 }, { x: body.x + Math.cos(heading) * 250, y: body.y + Math.sin(heading) * 250, elevation: 30 }];
	for (const frame of FRAMES) {
		const model = createMech(undefined, false, frame.id); model.root.position.set(body.x, 0, body.y);
		try {
			for (const target of targets) {
				model.pose(gait, heading, { recoil: 1, hit: 0, heat: 40, time: 2, ...(target ? { target } : {}) });
				for (const [slot, rig] of getPlayerWeaponRig(frame.id).entries()) {
					assertPosition(model.muzzles[slot], getPlayerMuzzle(frame.id, slot, body, heading, undefined, target), body);
					for (const index of rig.tubes.keys()) assertPosition(model.rocketMuzzles[slot]?.[index], getPlayerMuzzle(frame.id, slot, body, heading, index, target), body);
					const gimbal = model.root.getObjectByName(`weapon-gimbal-${slot}`); if (!gimbal) throw new Error('Missing weapon articulation');
					const actual = new Vector3(1, 0, 0).transformDirection(gimbal.matrixWorld);
					const pivot = weaponPivot(rig, body, heading);
					const barrel = getFiringDirection(pivot, snapMechHeading(heading), target);
					expect(actual.distanceTo(new Vector3(barrel.x, barrel.elevation, barrel.y))).toBeLessThan(0.000001);
					const aim = getPlayerFiringDirection(frame.id, slot, body, heading, getPlayerMuzzle(frame.id, slot, body, heading, undefined, target), target);
					expect(aim).toEqual(getFiringDirection(pivot, heading, target));
				}
			}
		} finally { model.dispose(); }
	}
});

test('enemy muzzle and tube positions match combat while aircraft pivots follow their hull', function () {
	const body = { x: 400, y: 300, angle: 1.1, hullAngle: 1.1 }; const heading = -0.4;
	const target: SpatialPoint = { x: 800, y: 200, elevation: 45 };
	for (const kind of ['scout', 'striker', 'siege', 'helicopter', 'vtol', 'tank'] as const) {
		const commander = kind === 'siege'; const model = createMech(kind, commander); const gait = createGait(body);
		model.root.position.set(body.x, 0, body.y);
		try {
			model.pose(gait, heading, { recoil: 1, hit: 0, heat: 0, time: 1, target });
			for (const [slot, rig] of getEnemyWeaponRig(kind, commander).entries()) {
				assertPosition(model.muzzles[slot], getEnemyMuzzle(kind, commander, slot, body, heading, undefined, target), body);
				for (const index of rig.tubes.keys()) assertPosition(model.rocketMuzzles[slot]?.[index], getEnemyMuzzle(kind, commander, slot, body, heading, index, target), body);
			}
		} finally { model.dispose(); }
	}
});

test('the emplacement stays planted on a slope as its barrel traverses, fires from the bore and recoils along it', function () {
	const model = createMech('artillery'); const state = createState();
	const terrain = { obstacles: [], roads: [], elevation: { xs: [0, 1000], ys: [0, 1000], heights: new Float32Array([0, 230, 150, 380]), minHeight: 0, maxHeight: 380 } };
	const body = { x: 620, y: 630, angle: .47 }; const gait = createGait(body);
	const elevation = groundHeight(terrain, body); model.root.position.set(body.x, elevation, body.y);
	const target = { x: 810, y: 850, elevation: -210 };
	const pose = function (heading: number) {
		const response = sampleMechResponses(state).get(9);
		model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: state.time, terrain, target, ...(response ? { response } : {}) });
		model.root.updateMatrixWorld(true);
	};
	try {
		const bore = model.root.getObjectByName('weapon-muzzle'), base = model.root.getObjectByName('emplacement-foundation');
		if (!bore || !base) throw new Error('Missing emplacement assemblies');
		pose(-1.3); const foundation = base.matrixWorld.clone();
		const up = new Vector3(0, 1, 0).transformDirection(foundation);
		const slope = groundNormal(terrain, body);
		expect(up.distanceTo(new Vector3(slope.x, slope.elevation, slope.y))).toBeLessThan(1e-7);
		for (const heading of [-1.3, .72, 2.14]) {
			pose(heading); const { origin, direction } = emplacementLaunch(body, heading, elevation);
			const exit = bore.getWorldPosition(new Vector3());
			expect(exit.distanceTo(new Vector3(origin.x, origin.elevation, origin.y))).toBeLessThan(1e-7);
			expect(new Vector3(1, 0, 0).transformDirection(bore.matrixWorld).distanceTo(new Vector3(direction.x, direction.elevation, direction.y))).toBeLessThan(1e-7);
			const combat = getEnemyMuzzle('artillery', false, 0, { ...body, groundElevation: elevation }, heading, undefined, target);
			expect(exit.distanceTo(new Vector3(combat.x, combat.elevation, combat.y))).toBeLessThan(1e-7);
			expect(base.matrixWorld).toEqual(foundation);
		}
		const heading = 2.14; const { direction } = emplacementLaunch(body, heading, elevation);
		const home = bore.getWorldPosition(new Vector3());
		state.effects = [{ x: body.x, y: body.y, life: .4, size: 10, color: '#fff', feedback: { type: 'fire', slot: 0, family: 'artillery', shooter: 9, heavy: true, time: 0, direction } }];
		state.time = 0; pose(heading); expect(bore.getWorldPosition(new Vector3())).toEqual(home);
		state.time = .035; pose(heading);
		const recoil = home.clone().sub(bore.getWorldPosition(new Vector3()));
		expect(recoil.length()).toBeGreaterThan(10);
		expect(recoil.normalize().dot(new Vector3(direction.x, direction.elevation, direction.y))).toBeCloseTo(1, 7);
		expect(base.matrixWorld).toEqual(foundation);
		state.time = .5; pose(heading); expect(bore.getWorldPosition(new Vector3())).toEqual(home);
	} finally { model.dispose(); }
});
