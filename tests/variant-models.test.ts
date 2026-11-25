import { expect, test } from 'bun:test';
import { Box3, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { FRAMES, type FrameId } from '../src/frames';
import { FRAME_RIGS } from '../src/frame-rig';
import { createGait } from '../src/gait';
import { getHardpoints } from '../src/hardpoints';
import { createMech } from '../src/mech-3d';
import { getPlayerMuzzle, type SpatialPoint } from '../src/weapon-rig';

const indexedExitCounts: Partial<Record<FrameId, readonly number[]>> = {
	'harrow-b': [3, 0],
	'bastion-b': [0, 4],
	morrow: [4, 4],
	'morrow-saturation': [6, 6],
	'morrow-pursuer': [2, 2],
};

for (const frame of FRAMES) test(`${frame.name} preserves physical slot identity through aiming, recoil, and disposal`, function () {
	const model = createMech(undefined, false, frame.id);
	const gait = createGait({ x: 0, y: 0, angle: 0 }, frame.size, FRAME_RIGS[frame.id]);
	const hardpoints = getHardpoints(frame.id);
	const assets = new Set<BufferGeometry | Material>();
	const disposals = new Map<BufferGeometry | Material, number>();
	model.root.traverse(function (object) {
		if (!(object instanceof Mesh)) return;
		assets.add(object.geometry);
		for (const surface of Array.isArray(object.material) ? object.material : [object.material]) assets.add(surface);
	});
	for (const asset of assets) asset.addEventListener('dispose', function () { disposals.set(asset, (disposals.get(asset) ?? 0) + 1); });
	try {
		model.pose(gait, 0);
		expect(model.muzzles).toHaveLength(hardpoints.length);
		expect(model.rocketMuzzles).toHaveLength(hardpoints.length);
		const rest = model.muzzles.map(function (point) { return point.clone(); });
		const bounds = new Box3().setFromObject(model.root).expandByScalar(2);
		for (const [slot, hardpoint] of hardpoints.entries()) {
			const point = rest[slot]; const tubes = model.rocketMuzzles[slot];
			if (!point || !tubes) throw new Error('Missing physical slot');
			expect(point.toArray().every(Number.isFinite)).toBe(true);
			expect(bounds.containsPoint(point)).toBe(true);
			const exits = indexedExitCounts[frame.id]?.[slot];
			if (exits !== undefined || hardpoint.family === 'launcher') {
				if (exits !== undefined) {
					expect(tubes).toHaveLength(exits);
					expect(new Set(tubes.map(function (tube) { return tube.toArray().join(','); })).size).toBe(exits);
				} else expect(tubes.length).toBeGreaterThanOrEqual(2);
				for (const tube of tubes) expect(bounds.containsPoint(tube)).toBe(true);
			} else expect(tubes).toHaveLength(0);
		}
		// Harrow has a centerline mortar and right guard gun, not two side guns.
		if (frame.chassisId === 'harrow') expect(rest[0]?.z).toBeCloseTo(0, 8);
		else expect(rest[0]?.z).toBeLessThan(0);
		if (hardpoints.length > 1) expect(rest[1]?.z).toBeGreaterThan(0);
		if (frame.chassisId === 'rook') expect(rest[2]?.z).toBeCloseTo(0, 8);
		const aim: SpatialPoint = { x: 400, y: 360, elevation: 130 }; const heading = Math.PI / 4;
		model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: 0, target: aim });
		for (const [slot, tubes] of model.rocketMuzzles.entries()) for (const [index, tube] of tubes.entries()) {
			const origin = getPlayerMuzzle(frame.id, slot, gait.body, heading, index, aim);
			expect(tube.distanceTo(new Vector3(origin.x, origin.elevation, origin.y))).toBeLessThan(1e-6);
		}
		model.pose(gait, Math.PI / 2, { recoil: 0.8, hit: 0, heat: 70, time: 2 });
		const firing = model.muzzles.map(function (point) { return point.clone(); });
		expect(firing.some(function (point, slot) { return point.distanceTo(rest[slot] ?? new Vector3()) > 1; })).toBe(true);
		model.pose(gait, Math.PI / 2, { recoil: 0.8, hit: 0, heat: 70, time: 2 });
		expect(model.muzzles).toEqual(firing);
		model.pose(gait, 0);
		expect(model.muzzles).toEqual(rest);
	} finally { model.dispose(); model.dispose(); }
	expect(model.root.children).toHaveLength(0);
	for (const asset of assets) expect(disposals.get(asset)).toBe(1);
});
