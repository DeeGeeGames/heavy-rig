import type { Biome, MissionMap } from './campaign-types';
import { terrainPathClear, type ObstacleField, type TerrainObstacle } from './field-terrain';
import { surveyLandingPads } from './landing-site';
import type { Point } from './simulation';
import type { TerrainElevation } from './terrain-elevation';
import { randomSource } from './universe';

// The extra survey lines resolve the steep exposed walls and narrow floor of
// each fissure. The same strips provide material boundaries for the renderer.
export const FISSURE_BANDS = [0, .025, .09, .17, .23, .34, .46, .5, .54, .68, .82, .88, .966, 1];
const bandDepth = [0, .035, .23, .48, .46, .86, .96, 1, .97, .87, .51, .5, .11, 0];
export const fissureBand = function (u: number): number {
	return FISSURE_BANDS.findIndex(function (edge, i) { return i > 0 && u <= edge; }) - 1;
};
const smooth = function (v: number) {
	const t = Math.max(0, Math.min(1, v));
	return t * t * (3 - 2 * t);
};
const surveySpacing = 96;
const reliefScale: Readonly<Record<Biome, number>> = {
	badlands: 1.08, volcanic: 1.16, tundra: .87, wetlands: .72, forest: .92, steppe: .81, crystal: 1.05,
};
const boxDistanceSquared = function (dx: number, dy: number, halfWidth: number, halfDepth: number) {
	const x = Math.max(0, Math.abs(dx) - halfWidth), y = Math.max(0, Math.abs(dy) - halfDepth);
	return x * x + y * y;
};

// Limit each axis to a 40% grade. The steepest walkable triangle is then under
// 30 degrees even on a diagonal. Only move samples toward the datum, keeping
// level deployment, pickup, crossing and foundation areas continuous.
const gradeSlopes = function (heights: Float32Array, xs: readonly number[], ys: readonly number[]) {
	const nx = xs.length;
	const limit = function (i: number, neighbour: number, rise: number) {
		const h = heights[i] ?? 0, other = heights[neighbour] ?? 0;
		heights[i] = h > 0 ? Math.min(h, Math.max(0, other) + rise) : Math.max(h, Math.min(0, other) - rise);
	};
	const grade = function (start: number, stride: number, axis: readonly number[]) {
		for (let k = 1; k < axis.length; k++) {
			const i = start + k * stride, h = heights[i] ?? 0, other = heights[i - stride] ?? 0;
			const rise = .40 * ((axis[k] ?? 0) - (axis[k - 1] ?? 0));
			// If the datum falls inside this interval, split its allowed rise
			// proportionally on each side of the zero crossing.
			if (h * other < 0 && Math.abs(h - other) > rise) {
				const factor = rise / Math.abs(h - other);
				heights[i] = h * factor; heights[i - stride] = other * factor;
			}
			limit(i, i - stride, rise);
		}
		for (let k = axis.length - 2; k >= 0; k--) {
			const i = start + k * stride;
			limit(i, i + stride, .40 * ((axis[k + 1] ?? 0) - (axis[k] ?? 0)));
		}
	};
	for (let row = 0; row < ys.length; row++) grade(row * nx, 1, xs);
	for (let col = 0; col < nx; col++) grade(col, nx, ys);
};

// A foundation constrains every triangle touching its footprint, including the
// four corners. Lower a hill's footing or fill a valley's footing toward the
// datum; grade any newly exposed steps into the neighbouring ground. Nearby
// footings can share a vertex, so propagate the lower level between them.
const levelFoundations = function (heights: Float32Array, xs: readonly number[], ys: readonly number[], foundations: ObstacleField['obstacles']) {
	const footings = foundations.map(function (o) {
		const vertices: number[] = [];
		for (let row = 0; row < ys.length; row++) {
			if ((ys[row + 1] ?? Infinity) <= o.y - o.depth / 2 || (ys[row - 1] ?? -Infinity) >= o.y + o.depth / 2) continue;
			for (let col = 0; col < xs.length; col++) {
				if ((xs[col + 1] ?? Infinity) > o.x - o.width / 2 && (xs[col - 1] ?? -Infinity) < o.x + o.width / 2) vertices.push(row * xs.length + col);
			}
		}
		return vertices;
	});
	gradeSlopes(heights, xs, ys);
	for (let pass = 0; pass <= footings.length; pass++) {
		let changed = false;
		for (const vertices of footings) {
			let lo = Infinity, hi = -Infinity;
			for (const i of vertices) { const h = heights[i] ?? 0; lo = Math.min(lo, h); hi = Math.max(hi, h); }
			if (hi - lo < 1e-5) continue;
			const level = Math.max(lo, Math.min(0, hi));
			for (const i of vertices) heights[i] = level;
			changed = true;
		}
		if (!changed) break;
		gradeSlopes(heights, xs, ys);
	}
};

// Fit a walkable draw near the mission roads. Survey a route from one bank,
// along the bottom and up the opposite bank using the actual rig clearance.
const surveyGully = function (map: MissionMap, obstacles: readonly TerrainObstacle[], clearance: (x: number, y: number) => number, random: () => number) {
	const field = { obstacles }, halfLength = 660 + random() * 140, bank = 315 + random() * 65;
	const floor = -70 - random() * 28, bend = (random() - .5) * 85;
	const curve = function (along: number) { return bend * Math.sin(along / 260); };
	const middle = { x: (map.drop.x + map.objective.x) / 2, y: (map.drop.y + map.objective.y) / 2 };
	let best: { x: number; y: number; c: number; s: number; cost: number } | undefined;
	for (let attempt = 0; attempt < 96; attempt++) {
		const heading = random() * Math.PI * 2, c = Math.cos(heading), s = Math.sin(heading);
		const x = 500 + random() * (map.width - 1000), y = 500 + random() * (map.height - 1000);
		const point = function (along: number, across: number) {
			const v = across + curve(along);
			return { x: x + c * along - s * v, y: y + s * along + c * v };
		};
		const route = [point(-230, bank), point(-230, 0), { x, y }, point(230, 0), point(230, -bank)];
		if (route.some(function (p, i) {
			const before = route[i - 1];
			return clearance(p.x, p.y) < (i === 0 || i === 4 ? 120 : 290)
				|| Boolean(before && !terrainPathClear(field, before, p, 32));
		})) continue;
		const cost = Math.hypot(x - middle.x, y - middle.y);
		if (!best || cost < best.cost) best = { x, y, c, s, cost };
	}
	if (!best) return undefined;
	const { x: cx, y: cy, c, s } = best;
	return function (x: number, y: number, original: number) {
		const along = (x - cx) * c + (y - cy) * s;
		if (Math.abs(along) >= halfLength) return original;
		const across = Math.abs((y - cy) * c - (x - cx) * s - curve(along));
		if (across >= bank + 210) return original;
		const blend = (1 - smooth((Math.abs(along) - halfLength * .55) / (halfLength * .45)))
			* (1 - smooth((across - bank) / 210));
		const profile = floor + 12 * Math.sin(along / 510) + (36 - floor) * smooth((across - 55) / (bank - 55));
		return original + (profile - original) * blend;
	};
};
export const generateElevation = function (map: MissionMap, obstacles: readonly TerrainObstacle[], formation: readonly Point[], reserves: ObstacleField['obstacles'], emplacements: ObstacleField['obstacles'] = []): TerrainElevation {
	const random = randomSource(map.seed ^ 0x5ed174e3);
	const approach = map.terrain?.roads[0]?.[0] ?? map.drop;
	const heading = Math.atan2(map.objective.y - approach.y, map.objective.x - approach.x) + (random() - .5) * 1.35;
	const c = Math.cos(heading), s = Math.sin(heading);
	const period = 1330 + random() * 390, phase = random() * Math.PI * 2, meander = random() * Math.PI * 2;
	const amplitude = reliefScale[map.biome];
	const ridges = function (x: number, y: number) {
		const along = x * c + y * s, across = y * c - x * s;
		return amplitude * (92 * Math.sin(along * 2 * Math.PI / period + .9 * Math.sin(across / 510 + meander) + phase)
			+ 34 * Math.cos(across / 300 + meander) + 22 * Math.sin((along - across) / 430 + phase));
	};
	const cuts = obstacles.filter(function (o) { return o.kind === 'fissure'; });
	const water = obstacles.filter(function (o) { return o.kind === 'channel'; });
	const strips = surveyLandingPads(map, obstacles, formation, reserves);
	const pads = [{ ...map.drop, radius: 215 }, { ...map.extraction, radius: 166 }, ...map.sites.map(function (p) { return { ...p, radius: 125 }; })];
	const clearingDistance = function (x: number, y: number) {
		let distance = Math.min(420, Math.min(x, y, map.width - x, map.height - y) + surveySpacing);
		for (const p of pads) {
			const dx = x - p.x, dy = y - p.y;
			if (Math.abs(dx) < p.radius + distance && Math.abs(dy) < p.radius + distance) distance = Math.min(distance, Math.sqrt(dx * dx + dy * dy) - p.radius);
		}
		if (distance <= 0) return distance;
		let squared = distance * distance;
		for (const p of strips) {
			const dx = x - p.x, dy = y - p.y;
			squared = Math.min(squared, boxDistanceSquared(dx * p.c + dy * p.s, dx * p.s - dy * p.c, p.halfLength, p.halfWidth));
		}
		for (const pool of water) squared = Math.min(squared, boxDistanceSquared(x - pool.x, y - pool.y, pool.width / 2, pool.depth / 2));
		return Math.sqrt(squared);
	};
	const gully = surveyGully(map, obstacles, clearingDistance, random);
	const natural = function (x: number, y: number) {
		const height = ridges(x, y);
		return gully ? gully(x, y, height) : height;
	};
	const axis = function (size: number, horizontal: boolean) {
		const intervals = Math.ceil(size / surveySpacing);
		const lines = new Set(Array.from({ length: intervals + 1 }, function (_, i) { return i * size / intervals; }));
		for (const cut of cuts) {
			const span = horizontal ? cut.width : cut.depth, origin = (horizontal ? cut.x : cut.y) - span / 2;
			const short = (cut.width < cut.depth) === horizontal;
			const offsets = short ? FISSURE_BANDS.map(function (u) { return u * span; }) : [0, 24, span - 24, span];
			for (const offset of offsets) if (origin + offset > 0 && origin + offset < size) lines.add(origin + offset);
		}
		return [...lines].sort(function (a, b) { return a - b; });
	};
	const xs = axis(map.width, true), ys = axis(map.height, false);
	const heights = new Float32Array(xs.length * ys.length);
	const depths = cuts.length ? new Float32Array(heights.length) : undefined;
	let i = 0;
	for (const y of ys) for (const x of xs) {
		let height = natural(x, y);
		// Protect the entire triangle under a pad or body of water, including
		// corners whose nearest grid vertex lies outside the requested area.
		height *= smooth((clearingDistance(x, y) - Math.SQRT2 * surveySpacing) / 280);
		for (const cut of cuts) {
			const vertical = cut.depth > cut.width, short = Math.min(cut.width, cut.depth), long = Math.max(cut.width, cut.depth);
			const along = vertical ? y - cut.y : x - cut.x, u = (vertical ? x - cut.x : y - cut.y) / short + .5;
			if (u <= 0 || u >= 1 || Math.abs(along) >= long / 2) continue;
			const band = fissureBand(u), low = FISSURE_BANDS[band] ?? 0, high = FISSURE_BANDS[band + 1] ?? 1;
			const a = bandDepth[band] ?? 0, b = bandDepth[band + 1] ?? 0;
			const depth = Math.min(96, short * .56) * (.93 + .07 * Math.sin(along / 108 + phase));
			if (depths) depths[i] = depth * (a + (b - a) * (u - low) / (high - low)) * Math.min(1, (long / 2 - Math.abs(along)) / 24);
		}
		heights[i++] = height;
	}
	const buildings = obstacles.filter(function (o) { return o.kind === 'shed' || o.kind === 'turbine'; });
	levelFoundations(heights, xs, ys, [...buildings, ...emplacements]);
	let minHeight = 0, maxHeight = 0;
	for (const [index, surface] of heights.entries()) {
		const h = surface - (depths?.[index] ?? 0); heights[index] = h;
		minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h);
	}
	return { xs, ys, heights, minHeight: Math.floor(minHeight), maxHeight: Math.ceil(maxHeight) };
};
