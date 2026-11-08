import { expect, test } from 'bun:test';
import { Vector3, type Object3D } from 'three';
import { advanceGait, createGait } from '../src/gait';
import { createLowPolyWarden } from '../src/warden-low-poly';

const find = function (root: Object3D, name: string): Object3D {
	const object = root.getObjectByName(name);
	if (!object) throw new Error(`Missing articulated part: ${name}`);
	return object;
};

test('low-poly Warden keeps its feet on the shared gait contacts through movement, aim, and recoil', function () {
	const model = createLowPolyWarden();
	let body = { x: 0, y: 0, angle: 0 }; let gait = createGait(body);
	try {
		for (let tick = 0; tick < 720; tick++) {
			const speed = tick < 240 ? 90 : tick < 480 ? -48 : 0;
			const angle = body.angle + (tick >= 480 ? 0.01 : 0);
			body = { x: body.x + Math.cos(angle) * speed / 60, y: body.y + Math.sin(angle) * speed / 60, angle };
			gait = advanceGait(gait, body, 1 / 60);
			model.root.position.set(body.x, 0, body.y);
			model.pose(gait, angle + Math.sin(tick / 30) * Math.PI, { recoil: tick % 50 / 50, hit: 0, heat: 0, time: tick / 60 });
			for (const [index, name] of (['left-leg', 'right-leg'] as const).entries()) {
				const contact = gait.feet[index === 0 ? 0 : 1];
				const foot = find(find(model.root, name), 'planted-foot').getWorldPosition(new Vector3());
				expect(foot.distanceTo(new Vector3(contact.x, contact.lift, contact.y))).toBeLessThan(1e-8);
			}
			model.root.traverse(function (part) { expect(part.matrixWorld.elements.every(Number.isFinite)).toBe(true); });
		}
	} finally { model.dispose(); }
});

test('aim and recoil move the turret and gun slides without moving the lower chassis', function () {
	const model = createLowPolyWarden(); const gait = createGait({ x: 0, y: 0, angle: 0 });
	try {
		model.pose(gait, 0);
		const leftLeg = find(model.root, 'left-leg'); const before = leftLeg.children.map(function (part) { return part.matrixWorld.clone(); });
		model.pose(gait, Math.PI / 2, { recoil: 1, hit: 0, heat: 0, time: 0 });
		for (const [index, part] of leftLeg.children.entries()) {
			const original = before[index];
			if (!original) throw new Error('Lower chassis hierarchy changed during aiming');
			expect(part.matrixWorld.equals(original)).toBe(true);
		}
		expect(find(model.root, 'turret').rotation.y).toBeCloseTo(-Math.PI / 2);
		expect(find(model.root, 'left-gun-slide').position.x).toBeLessThan(0);
		expect(find(model.root, 'right-gun-slide').position.x).toBeLessThan(0);
		model.pose(gait, Math.PI / 2);
		expect(find(model.root, 'left-gun-slide').position.x).toBeCloseTo(0);
	} finally { model.dispose(); }
});
