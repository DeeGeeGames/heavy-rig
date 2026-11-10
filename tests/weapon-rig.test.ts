import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { FRAMES } from '../src/frames';
import { createGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { getEnemyMuzzle, getEnemyWeaponRig, getFiringDirection, getPlayerMuzzle, getPlayerWeaponRig, weaponPivot, type SpatialPoint } from '../src/weapon-rig';

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
					const direction = getFiringDirection(weaponPivot(rig, body, heading), heading, target);
					expect(actual.distanceTo(new Vector3(direction.x, direction.elevation, direction.y))).toBeLessThan(0.000001);
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
