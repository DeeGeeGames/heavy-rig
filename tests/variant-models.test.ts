import { expect, test } from 'bun:test';
import { Box3, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { FRAMES } from '../src/frames';
import { FRAME_RIGS } from '../src/frame-rig';
import { createGait } from '../src/gait';
import { getHardpoints } from '../src/hardpoints';
import { createMech } from '../src/mech-3d';

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
			if (hardpoint.family === 'launcher') {
				expect(tubes.length).toBeGreaterThanOrEqual(2);
				for (const tube of tubes) expect(bounds.containsPoint(tube)).toBe(true);
			} else expect(tubes).toHaveLength(0);
		}
		// The first two locations retain left/right identity, even on Warden
		// where traversal encounters shoulder hardware before the side guns.
		expect(rest[0]?.z).toBeLessThan(0);
		if (hardpoints.length > 1) expect(rest[1]?.z).toBeGreaterThan(0);
		if (frame.chassisId === 'rook') expect(rest[2]?.z).toBeCloseTo(0, 8);
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
