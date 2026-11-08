import { expect, test } from 'bun:test';
import { Mesh, Vector3, type Object3D } from 'three';
import { FRAME_RIGS, STANDARD_LEG_RIG } from '../src/frame-rig';
import { FRAMES } from '../src/frames';
import { advanceGait, createGait, mechScale } from '../src/gait';
import { createMech } from '../src/mech-3d';
import type { EnemyKind } from '../src/simulation';

const find = function (root: Object3D, name: string): Object3D {
	const part = root.getObjectByName(name);
	if (!part) throw new Error(`Missing articulated part: ${name}`);
	return part;
};
const configurations = [
	...FRAMES.map(function (frame) {
		return { name: frame.id, size: frame.size, stride: frame.stride, rig: FRAME_RIGS[frame.id], create: function () { return createMech(undefined, false, frame.id); } };
	}),
	...(['scout', 'striker', 'siege', 'commander'] as const).map(function (name) {
		const kind: EnemyKind = name === 'commander' ? 'siege' : name;
		return { name, size: mechScale(kind), stride: 1, rig: STANDARD_LEG_RIG, create: function () { return createMech(kind, name === 'commander'); } };
	}),
];

for (const config of configurations) test(`${config.name} rolls its feet without floor penetration or detached shins, then settles and freezes`, function () {
	const model = config.create();
	const humanoid = config.rig.kneeDirection === 1;
	let body = { x: 400, y: 300, angle: 0.6 }; let gait = createGait(body, config.size, config.rig);
	let lowestPitch = 0; let highestPitch = 0; let toeFlex = 0; let speed = 0;
	const vertex = new Vector3();
	try {
		for (let tick = 0; tick < 840; tick++) {
			const targetSpeed = (tick < 240 ? 110 : tick < 480 ? -65 : 0) * config.size;
			speed += (targetSpeed - speed) * (1 - Math.exp(-3.5 / 60));
			const angle = body.angle + (tick >= 480 && tick < 660 ? 0.012 : 0);
			body = { x: body.x + Math.cos(angle) * speed / 60, y: body.y + Math.sin(angle) * speed / 60, angle };
			gait = advanceGait(gait, body, 1 / 60, config.size, config.stride, config.rig);
			model.root.position.set(body.x, 0, body.y); model.pose(gait, angle + 0.8);
			for (const [index, name] of ['left-leg', 'right-leg'].entries()) {
				const leg = find(model.root, name); const shoe = find(leg, 'ankle-roll'); const toes = humanoid ? shoe : find(leg, 'toe-hinge');
				lowestPitch = Math.min(lowestPitch, shoe.rotation.z); highestPitch = Math.max(highestPitch, shoe.rotation.z); toeFlex = Math.max(toeFlex, Math.abs(toes.rotation.z));
				const contact = gait.feet[index === 0 ? 0 : 1];
				if (gait.swing?.index !== index && contact.lift === 0) {
					// The loaded toe (forward) or heel (reverse) must remain over
					// the same ground point while the ankle rolls above it.
					const toeLoaded = shoe.rotation.z < 0; const heel = config.name === 'kestrel' ? -27 : -16;
					const forward = toeLoaded ? humanoid ? 26 : 21 : heel; const height = toeLoaded && !humanoid ? 0.1 : 0;
					const pinned = toeLoaded && !humanoid ? toes.localToWorld(new Vector3(13, -2.9, 0)) : shoe.localToWorld(new Vector3(forward, 0, 0));
					expect(pinned.distanceTo(new Vector3(contact.x + Math.cos(contact.angle) * forward * config.size, height * config.size, contact.y + Math.sin(contact.angle) * forward * config.size))).toBeLessThan(1e-7);
				}
				const ankle = find(leg, 'ankle').getWorldPosition(new Vector3());
				expect(shoe.localToWorld(new Vector3(-5, 10, 0)).distanceTo(ankle)).toBeLessThan(1e-7);
				const hip = find(leg, 'hip').getWorldPosition(new Vector3()); const knee = find(leg, 'knee').getWorldPosition(new Vector3());
				expect(hip.distanceTo(knee)).toBeCloseTo(config.rig.upper * config.size, 6);
				expect(knee.distanceTo(ankle)).toBeCloseTo(config.rig.lower * config.size, 6);
				if (humanoid) {
					const bend = Math.PI - hip.clone().sub(knee).angleTo(ankle.clone().sub(knee));
					expect(bend * 180 / Math.PI).toBeGreaterThanOrEqual(29.999);
				}
				let lowest = Infinity;
				shoe.traverse(function (part) {
					if (!(part instanceof Mesh)) return;
					const positions = part.geometry.getAttribute('position');
					for (let index = 0; index < positions.count; index++) lowest = Math.min(lowest, vertex.fromBufferAttribute(positions, index).applyMatrix4(part.matrixWorld).y);
				});
				expect(lowest).toBeGreaterThanOrEqual(-1e-6);
			}
		}
		expect(lowestPitch).toBeLessThan(-0.15); expect(highestPitch).toBeGreaterThan(humanoid ? 0.1 : 0.15);
		if (!humanoid) expect(toeFlex).toBeGreaterThan(0.1);
		for (const name of ['left-leg', 'right-leg']) {
			expect(find(find(model.root, name), 'ankle-roll').rotation.z).toBeCloseTo(0, 6);
			if (!humanoid) expect(find(find(model.root, name), 'toe-hinge').rotation.z).toBeCloseTo(0, 6);
		}
		const before: number[][] = []; model.root.traverse(function (part) { before.push(part.matrixWorld.toArray()); });
		model.pose(advanceGait(gait, body, 0, config.size, config.stride, config.rig), body.angle + 0.8);
		const paused: number[][] = []; model.root.traverse(function (part) { paused.push(part.matrixWorld.toArray()); });
		expect(paused).toEqual(before);
	} finally { model.dispose(); }
});
