import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import type { Biome, MissionMap } from './campaign-types';
import type { TerrainObstacle } from './field-terrain';
import { randomSource } from './universe';

const surfaces = {
	wetlands: { soil: [0x434c39, 0x777a49, 0xa0a56d], track: ['#655f41', '#a29568', '#746848'] },
	forest: { soil: [0x324436, 0x596743, 0x879358], track: ['#514d37', '#8f7855', '#66543d'] },
	steppe: { soil: [0x776540, 0xbc9e54, 0xd5bc76], track: ['#988453', '#b39d72', '#8c784e'] },
	crystal: { soil: [0x494556, 0x716878, 0x9c899a], track: ['#716571', '#968797', '#776a79'] },
} as const;

export type SurfaceBiome = keyof typeof surfaces;
export const hasBiomeGround = function (biome: Biome): biome is SurfaceBiome {
	return Object.hasOwn(surfaces, biome);
};

// Lay broad, irregular bands of vegetation/mineral deposits under the finer painted details.
// The low-resolution pigment field only has to resolve metre-scale changes in ground colour.
const paintSoil = function (ctx: CanvasRenderingContext2D, map: MissionMap, biome: SurfaceBiome, noise: SimplexNoise) {
	const patch = document.createElement('canvas');
	patch.width = Math.ceil(map.width / 10); patch.height = Math.ceil(map.height / 10);
	const pigment = patch.getContext('2d');
	if (!pigment) return;
	const image = pigment.createImageData(patch.width, patch.height);
	const [shadow, middle, light] = surfaces[biome].soil;
	for (let y = 0; y < patch.height; y++) for (let x = 0; x < patch.width; x++) {
		const u = x * 10, v = y * 10;
		const broad = noise.noise(u / 560, v / 560);
		const grain = biome === 'steppe'
			? noise.noise((u + v * .52) / 410, (v - u * .52) / 52)
			: noise.noise(u / 130, v / 130);
		const fine = noise.noise(u / 35, v / 35);
		const level = broad * .66 + grain * .43 + fine * .13;
		const tint = biome === 'crystal' && Math.abs(grain + broad * .52) < .055 ? .17 : 0;
		const mix = Math.min(1, Math.abs(level) + tint);
		const end = level + tint >= 0 ? light : shadow;
		const at = (y * patch.width + x) * 4;
		for (let channel = 0; channel < 3; channel++) {
			const shift = 16 - 8 * channel;
			const base = middle >> shift & 255;
			image.data[at + channel] = base + ((end >> shift & 255) - base) * mix;
		}
		image.data[at + 3] = 255;
	}
	pigment.putImageData(image, 0, 0);
	ctx.drawImage(patch, 0, 0, map.width, map.height);
};

const paintGroundCover = function (ctx: CanvasRenderingContext2D, map: MissionMap, biome: SurfaceBiome, random: () => number) {
	ctx.save();
	const steppe = biome === 'steppe';
	const colors = {
		wetlands: ['#afab65', '#605e39'], forest: ['#92985b', '#2d4436'],
		steppe: ['#e4cb82', '#8a7045'], crystal: ['#c5acc8', '#574c64'],
	};
	for (let i = 0; i < 1700; i++) {
		const x = random() * map.width, y = random() * map.height;
		const count = 4 + Math.floor(random() * 6);
		ctx.globalAlpha = .25 + random() * .29; ctx.fillStyle = colors[biome][i % 2] ?? '#888';
		ctx.beginPath();
		for (let j = 0; j < count; j++) {
			const a = x + (random() - .5) * 58, b = y + (random() - .5) * 28;
			const angle = steppe ? .28 + random() * .38 : random() * Math.PI * 2;
			const length = steppe ? 14 + random() * 36 : 5 + random() * 15;
			const width = 3.5 + random() * 6;
			ctx.moveTo(a, b);
			ctx.lineTo(a + Math.cos(angle) * length, b + Math.sin(angle) * length);
			ctx.lineTo(a + Math.cos(angle + 1.57) * width, b + Math.sin(angle + 1.57) * width); ctx.closePath();
		}
		ctx.fill();
	}
	ctx.restore();
};

// Flooded agricultural channels share a low, marshy bed even where a raised levee
// crosses them. Olive silt and sedge mark the traversable shallows; blue marks deep water.
const paintFloodplain = function (ctx: CanvasRenderingContext2D, pools: readonly TerrainObstacle[], random: () => number) {
	const longest = pools.reduce<TerrainObstacle | undefined>(function (max, p) {
		return !max || Math.max(p.width, p.depth) > Math.max(max.width, max.depth) ? p : max;
	}, undefined);
	if (!longest) return;
	const alongX = longest.width > longest.depth;
	const center = function (p: TerrainObstacle) { return alongX ? p.y : p.x; };
	const length = function (p: TerrainObstacle) { return alongX ? p.width : p.depth; };
	const breadth = function (p: TerrainObstacle) { return alongX ? p.depth : p.width; };
	const lanes: TerrainObstacle[][] = [];
	for (const p of pools) {
		const lane = lanes.find(function (group) { const first = group[0]; return first && Math.abs(center(first) - center(p)) < 85; });
		if (lane) lane.push(p); else lanes.push([p]);
	}
	for (const lane of lanes) {
		const across = lane.reduce(function (sum, p) { return sum + center(p); }, 0) / lane.length;
		const start = Math.min(...lane.map(function (p) { return (alongX ? p.x : p.y) - length(p) / 2; })) - 50;
		const end = Math.max(...lane.map(function (p) { return (alongX ? p.x : p.y) + length(p) / 2; })) + 50;
		const half = Math.max(...lane.map(breadth)) / 2;
		const phase = random() * 8;
		ctx.save();
		if (alongX) ctx.translate(start, across);
		else { ctx.translate(across, start); ctx.rotate(Math.PI / 2); }
		const span = end - start;
		const steps = Math.max(9, Math.ceil(span / 26));
		for (const [apron, shade] of [[110, '#788162'], [78, '#798f74'], [46, '#789887'], [20, '#75988a']] as const) {
			ctx.beginPath();
			for (const side of [-1, 1]) for (let i = 0; i <= steps; i++) {
				const u = (side < 0 ? i : steps - i) / steps * span;
				const swell = Math.sin(u / 92 + side * phase) * .41 + Math.sin(u / 38 + phase) * .12;
				const taper = Math.min(1, .59 + Math.min(u, span - u) / 105);
				const v = side * (half + apron * (1 + swell)) * taper;
				if (!i && side < 0) ctx.moveTo(u, v); else ctx.lineTo(u, v);
			}
			ctx.closePath(); ctx.fillStyle = shade; ctx.fill();
		}
		// Sediment tongues and sedge hummocks give the wet margin a broken edge and a sense of flow.
		for (let i = 0; i < span / 2; i++) {
			const u = random() * span, v = (random() - .5) * (half * 2 + 205);
			ctx.beginPath(); ctx.ellipse(u, v, 6 + random() ** 2 * 62, 2 + random() * 6, (random() - .5) * .55, 0, Math.PI * 2);
			ctx.fillStyle = i % 4 === 0 ? '#a1a879' : i % 3 === 0 ? '#627e66' : '#838d67'; ctx.fill();
		}
		ctx.restore();
	}
};

const paintChannel = function (ctx: CanvasRenderingContext2D, pool: TerrainObstacle, random: () => number) {
	ctx.save();
	ctx.translate(pool.x, pool.y);
	const long = Math.max(pool.width, pool.depth), short = Math.min(pool.width, pool.depth);
	if (pool.depth > pool.width) ctx.rotate(Math.PI / 2);
	const phase = random() * Math.PI * 2;
	const steps = Math.max(5, Math.round(long / 31));
	const bank = function (sign: number, index: number) {
		const t = index / steps;
		const ripple = Math.sin(t * long / 92 + phase * sign) * 12 + Math.sin(t * long / 39 - phase) * 5;
		const round = (1 - Math.min(1, Math.min(t, 1 - t) * long / 45)) * Math.min(33, short * .18);
		return sign * (short / 2 - round - 2) + ripple;
	};
	ctx.beginPath();
	for (let i = 0; i <= steps; i++) {
		const x = (i / steps - .5) * long + Math.sin(phase) * (i === 0 || i === steps ? 15 : 0);
		if (i === 0) ctx.moveTo(x, bank(-1, i)); else ctx.lineTo(x, bank(-1, i));
	}
	for (let i = steps; i >= 0; i--) ctx.lineTo((i / steps - .5) * long - Math.sin(phase) * (i === 0 || i === steps ? 15 : 0), bank(1, i));
	ctx.closePath(); ctx.lineJoin = 'round';
	ctx.strokeStyle = '#789582'; ctx.lineWidth = 23; ctx.stroke();
	ctx.strokeStyle = '#527e6b'; ctx.lineWidth = 9; ctx.stroke();
	ctx.fillStyle = '#438982'; ctx.fill(); ctx.clip();
	const water = ctx.createLinearGradient(0, -short / 2, 0, short / 2);
	water.addColorStop(0, '#76a790'); water.addColorStop(.12, '#478b83');
	water.addColorStop(.39, '#316b71'); water.addColorStop(.65, '#387b80');
	water.addColorStop(.92, '#54938a'); water.addColorStop(1, '#95b297');
	ctx.fillStyle = water; ctx.fillRect(-long / 2 - 19, -short, long + 38, short * 2);
	ctx.lineCap = 'round';
	for (let i = 0; i < long * short / 1700; i++) {
		const x = (random() - .5) * long, y = (random() - .5) * short;
		const length = 9 + random() ** 2 * 58;
		ctx.beginPath(); ctx.moveTo(x, y);
		ctx.quadraticCurveTo(x + length * .48, y + 3, x + length, y - 1);
		ctx.globalAlpha = .2 + random() * .36; ctx.lineWidth = 1.8 + random() * 2.4;
		ctx.strokeStyle = i % 3 ? '#9dbfb0' : '#2e666b'; ctx.stroke();
	}
	ctx.restore();
};

const paintRoads = function (ctx: CanvasRenderingContext2D, map: MissionMap, biome: SurfaceBiome, random: () => number) {
	const roads = map.terrain?.roads ?? [];
	const [shoulder, top, rut] = surfaces[biome].track;
	const trails = roads.map(function (road, index) {
		const path = new Path2D();
		for (const [i, p] of road.entries()) { if (!i) path.moveTo(p.x, p.y); else path.lineTo(p.x, p.y); }
		return { path, road, width: (index ? 66 : 89) * (biome === 'steppe' ? .52 : 1) };
	});
	ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
	// Paint all junction shoulders before surfacing the road network so a fork has one shared bed.
	for (const [scale, color, opacity] of [[1.12, shoulder, .34], [.99, shoulder, .56], [.93, top, .66], [.78, top, .47]] as const) {
		ctx.strokeStyle = color; ctx.globalAlpha = opacity;
		for (const { path, width } of trails) { ctx.lineWidth = width * scale; ctx.stroke(path); }
	}
	for (const { road, width } of trails) for (const [i, p] of road.entries()) {
		const from = road[i - 1]; if (!from) continue;
		const dx = p.x - from.x, dy = p.y - from.y, length = Math.hypot(dx, dy);
		ctx.save(); ctx.translate(from.x, from.y); ctx.rotate(Math.atan2(dy, dx));
		for (let u = 1; u < length; u += 4 + random() * 6) {
			const offset = (random() - .5) * width * 1.12;
			ctx.globalAlpha = .20 + random() * .39;
			ctx.fillStyle = random() < .48 ? shoulder : top;
			ctx.beginPath(); ctx.ellipse(u, offset, 4 + random() * 11, 2 + random() * 4, random() - .5, 0, Math.PI * 2); ctx.fill();
		}
		for (const side of [-1, 1]) {
			for (let u = random() * 25; u < length - 10; u += 35 + random() * 40) {
				const end = Math.min(length, u + 15 + random() * 55), v = side * width * (.19 + random() * .05);
				ctx.beginPath(); ctx.moveTo(u, v); ctx.quadraticCurveTo((u + end) / 2, v + 1.8, end, v);
				ctx.globalAlpha = .22 + random() * .26; ctx.strokeStyle = rut; ctx.lineWidth = 2.5 + random() * 3.5; ctx.stroke();
			}
		}
		ctx.restore();
	}
	ctx.restore();
};

export const paintBiomeGround = function (ctx: CanvasRenderingContext2D, map: MissionMap, biome: SurfaceBiome) {
	const random = randomSource(map.seed ^ 0x71dc496);
	paintSoil(ctx, map, biome, new SimplexNoise({ random }));
	const water = map.terrain?.obstacles.filter(function (o) { return o.kind === 'channel'; }) ?? [];
	if (water.length) paintFloodplain(ctx, water, random);
	paintGroundCover(ctx, map, biome, random);
	for (const pool of water) paintChannel(ctx, pool, random);
	paintRoads(ctx, map, biome, random);
};
