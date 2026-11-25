import { Box3, Mesh, Vector3 } from 'three';
import type { WeaponMount } from './arsenal';
import { FRAME_RIGS } from './frame-rig';
import { getFrame, type FrameId } from './frames';
import { createGait } from './gait';
import { createMech } from './mech-3d';
import { snapMechHeading } from './torso-arc';
import { getPlayerWeaponRig, type WeaponRig } from './weapon-rig';

// Local dimensions of the visible, equipped chassis and its outboard parts.
interface Outboard { forward: number; side: number; halfLength: number; halfWidth: number; low: number; high: number }
interface Orientation { cos: number; sin: number; x: number; y: number; gear: (Outboard & { x: number; y: number })[] }
interface Footprint { equipment: Outboard[]; orientations: Map<number, Orientation>; radius: number; forward: number; side: number; halfLength: number; halfWidth: number }
// Cache dimensions by the bound asset and its occupied mounts.
const measured = new WeakMap<readonly WeaponRig[], Map<number, Footprint>>();
export const launchFootprint = function (frame: FrameId, loadout: readonly WeaponMount[]): Footprint {
	const binding = getPlayerWeaponRig(frame);
	const slots = loadout.map(function (mount, index) { return mount.slot ?? index; });
	const mask = slots.reduce(function (bits, slot) { return bits | (1 << slot); }, 0);
	const variants = measured.get(binding) ?? new Map<number, Footprint>();
	const cached = variants.get(mask);
	if (cached) return cached;
	const model = createMech(undefined, false, frame);
	try {
		const gait = createGait({ x: 0, y: 0, angle: 0 }, getFrame(frame).size, FRAME_RIGS[frame]);
		model.pose(gait, 0, { time: 0, hit: 0, heat: 0, recoil: 0, equippedSlots: slots });
		const box = new Box3(), vertex = new Vector3(), parts: Box3[] = [];
		model.root.updateMatrixWorld(true);
		model.root.traverseVisible(function (part) {
			if (!(part instanceof Mesh)) return;
			const points = part.geometry.getAttribute('position'), bounds = new Box3();
			for (let i = 0; i < points.count; i++) bounds.expandByPoint(vertex.fromBufferAttribute(points, i).applyMatrix4(part.matrixWorld));
			parts.push(bounds); box.union(bounds);
		});
		const equipment = parts.flatMap(function (bounds) {
			const c = bounds.getCenter(vertex);
			if (Math.abs(c.z) <= (box.max.z - box.min.z) * .25 || c.y <= box.min.y + (box.max.y - box.min.y) * .4) return [];
			return [{ forward: c.x, side: c.z, halfLength: (bounds.max.x - bounds.min.x) / 2 + 1.5, halfWidth: (bounds.max.z - bounds.min.z) / 2 + 1.5, low: bounds.min.y, high: bounds.max.y }];
		});
		const footprint = { equipment, orientations: new Map<number, Orientation>(), forward: (box.min.x + box.max.x) / 2, side: (box.min.z + box.max.z) / 2,
			halfLength: (box.max.x - box.min.x) / 2 + 1.5, halfWidth: (box.max.z - box.min.z) / 2 + 1.5,
			radius: Math.hypot(Math.max(-box.min.x, box.max.x), Math.max(-box.min.z, box.max.z)) };
		variants.set(mask, footprint); measured.set(binding, variants);
		return footprint;
	} finally { model.dispose(); }
};

export const posedFootprint = function (body: { x: number; y: number; angle: number }, shape: Footprint) {
	const heading = snapMechHeading(body.angle);
	let orientation = shape.orientations.get(heading);
	if (!orientation) {
		const cos = Math.cos(heading), sin = Math.sin(heading);
		const gear = shape.equipment.map(function (p) {
			return { ...p, x: p.forward * cos - p.side * sin, y: p.forward * sin + p.side * cos };
		});
		orientation = { cos, sin, x: shape.forward * cos - shape.side * sin, y: shape.forward * sin + shape.side * cos, gear };
		shape.orientations.set(heading, orientation);
	}
	return { x: body.x, y: body.y, orientation, shape };
};

// Use the chassis footprint and the actual heights and corners of the visible
// outboard parts. A ground shadow cannot distinguish a passing pod from a gun.
export const footprintOverlap = function (first: ReturnType<typeof posedFootprint>, second: ReturnType<typeof posedFootprint>) {
	const a = first.orientation, b = second.orientation;
	const x = second.x - first.x, y = second.y - first.y;
	const broad = first.shape.radius + second.shape.radius + 3;
	if (x * x + y * y > broad * broad) return 0;
	const dx = x + b.x - a.x, dy = y + b.y - a.y;
	const distance = Math.sqrt(dx * dx + dy * dy);
	if (distance === 0) return first.shape.halfWidth + second.shape.halfWidth;
	const reach = function (p: typeof first) {
		const along = (dx * p.orientation.cos + dy * p.orientation.sin) * p.shape.halfLength;
		const across = (dy * p.orientation.cos - dx * p.orientation.sin) * p.shape.halfWidth;
		return Math.sqrt(along * along + across * across) / distance;
	};
	let depth = Math.max(0, reach(first) + reach(second) - distance);
	const c = Math.abs(a.cos * b.cos + a.sin * b.sin), s = Math.abs(a.sin * b.cos - a.cos * b.sin);
	for (const p of a.gear) for (const q of b.gear) {
		if (p.high < q.low || q.high < p.low) continue;
		const partX = x + q.x - p.x, partY = y + q.y - p.y;
		depth = Math.max(depth, Math.min(p.high - q.low, q.high - p.low,
			p.halfLength + c * q.halfLength + s * q.halfWidth - Math.abs(partX * a.cos + partY * a.sin),
			p.halfWidth + s * q.halfLength + c * q.halfWidth - Math.abs(partY * a.cos - partX * a.sin),
			q.halfLength + c * p.halfLength + s * p.halfWidth - Math.abs(partX * b.cos + partY * b.sin),
			q.halfWidth + s * p.halfLength + c * p.halfWidth - Math.abs(partY * b.cos - partX * b.sin),
		));
	}
	return depth;
};
