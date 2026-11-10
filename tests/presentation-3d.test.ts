import { expect, test } from 'bun:test';
import { FrontSide, Mesh, Object3D, OrthographicCamera, Raycaster, Vector3 } from 'three';
import { FRAMES, type FrameId } from '../src/frames';
import { FRAME_RIGS } from '../src/frame-rig';
import { advanceGait, createGait, mechScale } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { alignCamera, toGround, viewScale } from '../src/projection-3d';
import { createState } from '../src/simulation';
import type { EnemyKind } from '../src/simulation';

test('orthographic camera matches Canvas positions and ground picking through resize and movement', function () {
	const state = createState(); const view = new OrthographicCamera(-1, 1, 1, -1, 0.1, 6000);
	for (const [width = 1, height = 1] of [[1440, 900], [390, 844], [844, 390]]) {
		for (const at of [{ x: 900, y: 780 }, { x: 70, y: 1100 }]) {
			state.player.x = at.x; state.player.y = at.y; alignCamera(view, width, height, state);
			for (const point of [at, { x: 40, y: 120 }, { x: 1700, y: 1150 }]) for (const elevation of [0, 45, 89]) {
				const projected = new Vector3(point.x, elevation, point.y).project(view);
				const actual = { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 };
				// Recorded Canvas framing, retained as a migration reference only.
				const scale = viewScale(width, height);
				const expected = { x: ((point.x - point.y) - (at.x - at.y)) * Math.sqrt(3) / 2 * scale + width / 2,
					y: ((point.x + point.y - at.x - at.y) * 0.5 - elevation) * scale + height * 0.52 };
				expect(actual.x).toBeCloseTo(expected.x, 8); expect(actual.y).toBeCloseTo(expected.y, 8);
				if (elevation === 0) {
					const picked = toGround(actual, view, width, height); if (!picked) throw new Error('Missing ground intersection');
					expect(picked.x).toBeCloseTo(point.x, 8); expect(picked.y).toBeCloseTo(point.y, 8);
				}
			}
		}
	}
});

interface Configuration { name: string; frame: FrameId; kind?: EnemyKind; commander?: boolean; size: number; stride: number }
const configurations: readonly Configuration[] = [
	...FRAMES.map(function (frame) { return { name: frame.id, frame: frame.id, size: frame.size, stride: frame.stride }; }),
	...(['scout', 'striker', 'siege'] as const).map(function (kind) { return { name: kind, frame: 'warden' as const, kind, size: mechScale(kind), stride: 1 }; }),
	{ name: 'commander', frame: 'warden', kind: 'siege', commander: true, size: mechScale('siege'), stride: 1 },
];
const requirePart = function (root: Object3D, name: string): Object3D {
	const part = root.getObjectByName(name);
	if (!part) throw new Error(`Missing articulated part: ${name}`);
	return part;
};
const renderedParts = function (root: Object3D): Mesh[] {
	const parts: Mesh[] = [];
	root.traverse(function (part) { if (part instanceof Mesh && part.visible) parts.push(part); });
	return parts;
};
const feet = function (root: Object3D) {
	return ['left-leg', 'right-leg'].map(function (name) { return requirePart(requirePart(root, name), 'planted-foot'); });
};

test('missile recesses face forward and their housings occlude them from behind throughout a rotation', function () {
	const model = createMech(); const gait = createGait({ x: 0, y: 0, angle: 0 }); const ray = new Raycaster();
	try {
		const anchors: Object3D[] = [];
		model.root.traverse(function (part) { if (part.name === 'launch-tube') anchors.push(part); });
		expect(anchors.length).toBeGreaterThan(0);
		for (let step = 0; step < 24; step++) {
			model.pose(gait, step * Math.PI / 12);
			for (const anchor of anchors) {
				const face = anchor.getWorldPosition(new Vector3()); const forward = new Vector3(1, 0, 0).transformDirection(anchor.matrixWorld);
				ray.set(face.clone().addScaledVector(forward, 200), forward.clone().negate());
				const front = ray.intersectObjects(renderedParts(model.root))[0];
				if (!front) throw new Error('Missing missile recess from the front');
				expect(front.point.distanceTo(face)).toBeLessThan(0.005);
				ray.set(face.clone().addScaledVector(forward, -200), forward);
				const back = ray.intersectObjects(renderedParts(model.root))[0];
				if (!back) throw new Error('Missing missile housing from the rear');
				expect(back.point.distanceTo(face)).toBeGreaterThan(1);
			}
		}
		for (const part of renderedParts(model.root)) for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
			expect(material.depthTest).toBe(true); expect(material.depthWrite).toBe(true); expect(material.side).toBe(FrontSide);
		}
	} finally { model.dispose(); }
});

for (const config of configurations) {
	test(`${config.name} rendered feet retain world planting after ECS applies a translated root`, function () {
		const rig = FRAME_RIGS[config.frame]; const model = createMech(config.kind, config.commander, config.frame);
		model.root.matrixAutoUpdate = false; model.root.matrixWorldAutoUpdate = false;
		let gait = createGait({ x: 900, y: 780, angle: 0 }, config.size, rig);
		try {
			for (let tick = 0; tick < 120; tick++) {
				gait = advanceGait(gait, { x: 900 + Math.min(tick, 120 - tick) * config.size, y: 780, angle: tick / 60 }, 1 / 60, config.size, config.stride, rig);
				model.pose(gait, -tick / 60);
				// renderer3D applies the entity transform after the view's pose.
				model.root.matrixWorld.makeTranslation(gait.body.x, 0, gait.body.y); model.root.updateMatrixWorld(true);
				for (const [index, foot] of feet(model.root).entries()) {
					const contact = gait.feet[index === 0 ? 0 : 1]; const actual = foot.getWorldPosition(new Vector3());
					expect(actual.distanceTo(new Vector3(contact.x, contact.lift, contact.y))).toBeLessThan(1e-7);
					const surfaces = renderedParts(foot); expect(surfaces.length).toBeGreaterThan(0);
					for (const surface of surfaces) expect(surface.matrixWorld.elements.every(Number.isFinite)).toBe(true);
				}
				expect(requirePart(model.root, 'hull').rotation.y).toBeCloseTo(-gait.body.angle);
				expect(requirePart(model.root, 'turret').rotation.y).toBeCloseTo(tick / 60);
			}
		} finally { model.dispose(); }
	});

	test(`${config.name} cockpit glazing stays physically ahead of its shell while aiming`, function () {
		const model = createMech(config.kind, config.commander, config.frame); const rig = FRAME_RIGS[config.frame];
		const gait = createGait({ x: 0, y: 0, angle: 0 }, config.size, rig); const ray = new Raycaster();
		try {
			model.pose(gait, 0);
			const visor = requirePart(model.root, 'cockpit-visor');
			if (!(visor instanceof Mesh)) throw new Error('Missing rendered cockpit glazing');
			const positions = visor.geometry.getAttribute('position'); let frontX = -Infinity; const front = new Vector3(); let count = 0;
			for (let index = 0; index < positions.count; index++) frontX = Math.max(frontX, positions.getX(index));
			for (let index = 0; index < positions.count; index++) if (Math.abs(positions.getX(index) - frontX) < 0.001) { front.add(new Vector3().fromBufferAttribute(positions, index)); count++; }
			front.divideScalar(count);
			for (let step = 0; step < 24; step++) {
				model.pose(gait, step * Math.PI / 12);
				const point = front.clone().applyMatrix4(visor.matrixWorld); const forward = new Vector3(1, 0, 0).transformDirection(visor.matrixWorld);
				ray.set(point.clone().addScaledVector(forward, 200), forward.clone().negate());
				const hits = ray.intersectObjects(renderedParts(model.root)); const glazing = hits.find(function (hit) { return hit.object === visor; });
				const shell = hits.find(function (hit) { return hit.object !== visor; });
				if (!glazing || !shell) throw new Error('Missing glazing or underlying cockpit shell');
				expect(hits[0]?.object).toBe(visor);
				expect(shell.distance - glazing.distance).toBeGreaterThan(0.01 * config.size);
			}
		} finally { model.dispose(); }
	});

	test(`${config.name} recoil preserves walking torso motion, planted feet, and independent turret aim`, function () {
		const rig = FRAME_RIGS[config.frame]; const model = createMech(config.kind, config.commander, config.frame);
		let gait = createGait({ x: 0, y: 0, angle: 0 }, config.size, rig);
		for (let tick = 1; tick <= 40; tick++) gait = advanceGait(gait, { x: tick * config.size, y: 0, angle: 0 }, 1 / 60, config.size, config.stride, rig);
		try {
			const turret = requirePart(model.root, 'turret');
			model.pose(createGait(gait.body, config.size, rig), Math.PI / 2); const rest = turret.matrix.clone();
			model.pose(gait, Math.PI / 2); const walking = turret.matrix.clone(); const planted = feet(model.root); const footTransforms = planted.map(function (foot) { return foot.matrix.clone(); });
			expect(walking.equals(rest)).toBe(false); expect(turret.rotation.y).toBe(-Math.PI / 2);
			const hardware = model.root.children.filter(function (part) { return part.name.startsWith('weapon-gimbal-'); }).flatMap(renderedParts);
			expect(hardware.length).toBeGreaterThan(0);
			const before = hardware.map(function (part) { return part.matrixWorld.clone(); });
			const muzzles = model.muzzles.map(function (muzzle) { return muzzle.clone(); });
			model.pose(gait, Math.PI / 2, { recoil: 1, hit: 0, heat: 0, time: 0 });
			expect(turret.matrix.equals(walking)).toBe(true); expect(planted.map(function (foot) { return foot.matrix; })).toEqual(footTransforms);
			expect(model.muzzles).toEqual(muzzles);
			expect(hardware.some(function (part, index) { return !part.matrixWorld.equals(before[index] ?? part.matrixWorld); })).toBe(true);
			model.pose(gait, Math.PI / 2);
			expect(turret.matrix.equals(walking)).toBe(true); expect(hardware.map(function (part) { return part.matrixWorld; })).toEqual(before);
		} finally { model.dispose(); }
	});
}
