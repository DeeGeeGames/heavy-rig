import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Path, Shape, ShapeGeometry } from 'three';
import type { Biome, MissionMap } from './campaign-types';
import type { FieldTerrain, TerrainObstacle } from './field-terrain';
import { hasBiomeGround, type SurfaceBiome } from './biome-ground';
import { createBiomeScenery } from './biome-scenery';
import { fissureBand } from './mission-elevation';
import { addSiteBuilding, hangarRoofGeometry, type BuildingPart, type BuildingParts } from './site-scenery';
import { groundHeight, type TerrainElevation } from './terrain-elevation';

export const FIELD_ROAD_MARKINGS = { haul: '#e7ac67', service: '#8dc7c9' } as const;

export const paintFieldRoads = function (ctx: CanvasRenderingContext2D, terrain: FieldTerrain) {
	ctx.save();
	ctx.globalAlpha = 1; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
	const cut = terrain.obstacles.find(function (obstacle) { return obstacle.kind === 'fissure'; });
	for (const [index, road] of terrain.roads.entries()) {
		const haul = index === 0;
		ctx.beginPath();
		for (const [i, p] of road.entries()) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
		ctx.setLineDash([]);
		ctx.lineWidth = haul ? 112 : 90; ctx.strokeStyle = haul ? '#826c54' : '#53696c'; ctx.stroke();
		ctx.lineWidth = haul ? 101 : 80; ctx.strokeStyle = haul ? '#554d46' : '#40494c'; ctx.stroke();
		ctx.lineWidth = haul ? 6 : 5; ctx.strokeStyle = haul ? FIELD_ROAD_MARKINGS.haul : FIELD_ROAD_MARKINGS.service;
		ctx.setLineDash(haul ? [26, 55] : [9, 12, 9, 52]); ctx.stroke();
		// Painted shoulder stripes mark both banks of the level crossing.
		if (!cut) continue;
		const across = cut.depth >= cut.width ? 'x' : 'y';
		const bankWidth = Math.min(cut.width, cut.depth);
		for (const [i, p] of road.entries()) {
			const from = road[i - 1];
			if (!from || p[across] === from[across]) continue;
			const fraction = (cut[across] - from[across]) / (p[across] - from[across]);
			if (fraction < 0 || fraction > 1) continue;
			const dx = p.x - from.x; const dy = p.y - from.y;
			ctx.save(); ctx.translate(from.x + fraction * dx, from.y + fraction * dy); ctx.rotate(Math.atan2(dy, dx));
			ctx.fillStyle = haul ? FIELD_ROAD_MARKINGS.haul : FIELD_ROAD_MARKINGS.service;
			for (const bank of [-1, 1]) for (const shoulder of [-1, 1]) {
				for (const stripe of [-11, 0, 11]) ctx.fillRect(bank * bankWidth / 2 + stripe - 3, shoulder * (haul ? 42 : 32) - 10, 6, 20);
			}
			ctx.restore(); break;
		}
	}
	ctx.restore();
};

// Both render meshes share vertices at the bank and the same diagonal as the
// ballistic height sampler. Fissure walls use their own rock strata material.
const surveyCells = function (grid: TerrainElevation, cuts: readonly TerrainObstacle[], visit: (a: number, b: number, c: number, d: number, cut: TerrainObstacle | undefined, x: number, y: number) => void) {
	const nx = grid.xs.length;
	for (let row = 0; row < grid.ys.length - 1; row++) for (let col = 0; col < nx - 1; col++) {
		const x = ((grid.xs[col] ?? 0) + (grid.xs[col + 1] ?? 0)) / 2;
		const y = ((grid.ys[row] ?? 0) + (grid.ys[row + 1] ?? 0)) / 2;
		const cut = cuts.find(function (o) { return Math.abs(x - o.x) < o.width / 2 && Math.abs(y - o.y) < o.depth / 2; });
		const a = row * nx + col;
		visit(a, a + 1, a + nx, a + nx + 1, cut, x, y);
	}
};

export const createCutGround = function (map: MissionMap, terrain: FieldTerrain) {
	const grid = terrain.elevation;
	if (grid) {
		const positions: number[] = [], uv: number[] = [], indices: number[] = [];
		for (const y of grid.ys) for (const x of grid.xs) {
			positions.push(x - map.width / 2, map.height / 2 - y, grid.heights[positions.length / 3] ?? 0);
			uv.push(x / map.width, 1 - y / map.height);
		}
		const cuts = terrain.obstacles.filter(function (o) { return o.kind === 'fissure'; });
		surveyCells(grid, cuts, function (a, b, c, d, cut) { if (!cut) indices.push(a, c, d, a, d, b); });
		const surface = new BufferGeometry();
		surface.setIndex(indices); surface.setAttribute('position', new Float32BufferAttribute(positions, 3));
		surface.setAttribute('uv', new Float32BufferAttribute(uv, 2)); surface.computeVertexNormals();
		return surface;
	}
	const shape = new Shape();
	const rectangle = function (path: Path, left: number, bottom: number, width: number, height: number) {
		path.moveTo(left, bottom); path.lineTo(left, bottom + height); path.lineTo(left + width, bottom + height);
		path.lineTo(left + width, bottom); path.closePath();
	};
	rectangle(shape, -map.width / 2, -map.height / 2, map.width, map.height);
	for (const cut of terrain.obstacles) {
		if (cut.kind !== 'fissure') continue;
		const hole = new Path();
		rectangle(hole, cut.x - (map.width + cut.width) / 2, (map.height - cut.depth) / 2 - cut.y, cut.width, cut.depth);
		shape.holes.push(hole);
	}
	const ground = new ShapeGeometry(shape);
	const positions = ground.getAttribute('position'); const uv = ground.getAttribute('uv');
	for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) / map.width + .5, positions.getY(i) / map.height + .5);
	return ground;
};

type Vertex = readonly [number, number, number];
type FissureBiome = Exclude<Biome, SurfaceBiome>;
const CUT_BANDS: Readonly<Record<FissureBiome, readonly number[]>> = {
	volcanic: [0xa5694d, 0x635152, 0x443e49, 0x685550, 0x3b3642, 0x422e32, 0xc95b37, 0xffa25b, 0x552f30, 0x35313b, 0x5f4c49, 0x4c4349, 0x945a45],
	badlands: [0xc39268, 0x926346, 0x81553e, 0xb78054, 0x875741, 0x704936, 0x684b3d, 0x87684c, 0x704c37, 0x80543d, 0xae7752, 0x966443, 0xc5966d],
	tundra: [0xaad1d9, 0x719eaf, 0x557c9e, 0x74aabd, 0x486c89, 0x417990, 0x32617e, 0x2a526e, 0x396f90, 0x4f81a4, 0x6aa5b8, 0x83b7c2, 0xc6e2df],
};
const createFissures = function (terrain: FieldTerrain, seed: number, biome: FissureBiome) {
	const cuts = terrain.obstacles.filter(function (o) { return o.kind === 'fissure'; });
	const vertices: number[] = []; const pigments: number[] = [];
	const tone = new Color();
	const face = function (a: Vertex, b: Vertex, c: Vertex, d: Vertex, color: number) {
		tone.setHex(color);
		for (const corner of [a, b, c, a, c, d]) { vertices.push(...corner); pigments.push(tone.r, tone.g, tone.b); }
	};
	const bands = CUT_BANDS[biome];
	let sample = seed >>> 0;
	const random = function () { sample = (Math.imul(sample, 1664525) + 1013904223) >>> 0; return sample / 4294967296; };
	const grid = terrain.elevation;
	if (grid) {
		const vertex = function (i: number): Vertex {
			return [grid.xs[i % grid.xs.length] ?? 0, (grid.heights[i] ?? 0) - .03, grid.ys[Math.floor(i / grid.xs.length)] ?? 0];
		};
		surveyCells(grid, cuts, function (a, b, c, d, cut, x, y) {
			if (!cut) return;
			const vertical = cut.width < cut.depth;
			const u = .5 + (vertical ? (x - cut.x) / cut.width : (y - cut.y) / cut.depth);
			const along = vertical ? y - cut.y : x - cut.x, end = Math.max(cut.width, cut.depth) / 2 - Math.abs(along);
			const band = fissureBand(u);
			const color = end < 24 ? bands[3] : biome === 'volcanic' && band === 7 && Math.sin(along / 95 + seed) > .61 ? 0xc46243 : bands[band];
			face(vertex(a), vertex(c), vertex(d), vertex(b), color ?? bands[0] ?? 0x665449);
		});
	} else for (const cut of cuts) {
		const vertical = cut.depth >= cut.width;
		const length = Math.max(cut.width, cut.depth); const width = Math.min(cut.width, cut.depth);
		const steps = Math.max(3, Math.ceil(length / 77));
		const row = function (index: number) {
			const along = (index / steps - .5) * length;
			const shift = (random() - .5) * .17; const ledge = random() * .06;
			const depth = Math.min(96, width * .56) * (.85 + random() * .15);
			const vertex = function (across: number, level: number): Vertex {
				const v = (across - .5) * width;
				return [cut.x + (vertical ? v : along), -.03 - level * depth, cut.y + (vertical ? along : v)];
			};
			return [
				vertex(0, 0), vertex(.025, .035), vertex(.08 + ledge, .23), vertex(.16 + ledge, .48),
				vertex(.22 + ledge, .46), vertex(.33 + ledge, .86), vertex(.475 + shift, .96),
				vertex(.5 + shift, .99), vertex(.525 + shift, .97), vertex(.68 - ledge, .87),
				vertex(.82 - ledge, .51), vertex(.88 - ledge, .5), vertex(.966, .11), vertex(1, 0),
			];
		};
		const cap = function (section: readonly Vertex[]) {
			for (const [i, a] of section.entries()) {
				const b = section[i + 1]; if (!b) continue;
				face(a, b, [b[0], -.03, b[2]], [a[0], -.03, a[2]], biome === 'volcanic' ? i % 3 === 0 ? 0x4a3938 : 0x352c32 : bands[i] ?? 0x352c32);
			}
		};
		let previous = row(0); cap(previous);
		for (let i = 1; i <= steps; i++) {
			const next = row(i);
			for (const [j, a] of previous.entries()) {
				const b = previous[j + 1]; const c = next[j + 1]; const d = next[j]; const color = biome === 'volcanic' && i % 5 === 1 && j === 6 ? 0x925036
					: biome === 'volcanic' && i % 5 === 1 && j === 7 ? 0x68423a : bands[j];
				if (b && c && d && color !== undefined) face(a, b, c, d, color);
			}
			previous = next;
		}
		cap(previous);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
	geometry.setAttribute('color', new Float32BufferAttribute(pigments, 3));
	geometry.computeVertexNormals();
	const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
	mesh.name = { volcanic: 'basalt-fissures', badlands: 'sandstone-canyons', tundra: 'ice-crevasses' }[biome]; return mesh;
};

const SHED_COLORS: Readonly<Record<Biome, { base: number; wall: number; trim: number; roof: number }>> = {
	volcanic: { base: 0x585459, wall: 0x858f91, trim: 0x414b50, roof: 0xa7b0ad },
	badlands: { base: 0x675344, wall: 0xb59976, trim: 0x674637, roof: 0x87604d },
	tundra: { base: 0x425764, wall: 0x879da7, trim: 0x3c5463, roof: 0xd0dedb },
	wetlands: { base: 0x4c6260, wall: 0x9b7663, trim: 0x495c59, roof: 0xb3a98b },
	forest: { base: 0x52594a, wall: 0x9a8963, trim: 0x4e5a4c, roof: 0x8d9a88 },
	steppe: { base: 0x746c58, wall: 0xb8a687, trim: 0x6a6351, roof: 0xb7b5a5 },
	crystal: { base: 0x544e5f, wall: 0x8e899e, trim: 0x4c495c, roof: 0xb1afbe },
};
const addShed = function (parts: BuildingPart[], shed: TerrainObstacle, biome: Biome, base: number) {
	const { width: w, depth: d, height: h } = shed;
	const colors = SHED_COLORS[biome];
	const add = function (x: number, y: number, z: number, width: number, height: number, depth: number, color: number) {
		parts.push({ x: shed.x + x, y: base + y + height / 2, z: shed.y + z, width, height, depth, color });
	};
	// The main mass, eaves and roof equipment stay inside the combat volume.
	add(0, 0, 0, w, h * .12, d, colors.base);
	add(0, h * .12, 0, w - 5, h * .74, d - 5, colors.wall);
	add(0, h * .86, 0, w, h * .08, d, colors.trim);
	add(0, h * .94, 0, w, h * .05, d, colors.roof);
	for (const end of [-1, 1]) {
		// Roll-up freight doors with recessed panels on the end walls.
		add(w * .12, h * .12, end * (d / 2 - 1.4), w * .38, h * .51, 2, 0x3b454a);
		for (let rail = 0; rail < 4; rail++) add(w * .12, h * (.18 + rail * .1), end * (d / 2 - .7), w * .32, 1.8, 1, 0x657275);
		add(w * .12, h * .65, end * (d / 2 - 1), w * .38, 3.5, 1.8, 0xd39a60);
		for (const bay of [-.32, 0, .32]) add(end * (w / 2 - 1.3), h * .14, d * bay, 2.5, h * .68, 4, 0x4b595e);
	}
	// Paired roof ventilators and standing seams keep the top readable at game zoom.
	for (const x of [-.22, .22]) {
		add(w * x, h * .99, -d * .12, w * .21, h * .01, d * .26, 0x414d53);
		add(w * x, h * .99, d * .17, w * .23, h * .01, d * .07, 0x718085);
	}
};

export const createFieldStructures = function (terrain: FieldTerrain, seed: number, biome: Biome) {
	const compoundBuildings = biome === 'steppe' || biome === 'crystal'
		? new Set(terrain.compounds?.flatMap(function (compound) { return compound.buildings; })) : undefined;
	const surface = hasBiomeGround(biome) ? createBiomeScenery(terrain, seed, biome, compoundBuildings) : undefined;
	const fissures = hasBiomeGround(biome) ? undefined : createFissures(terrain, seed, biome);
	const root = new Group();
	if (surface) root.add(surface.root);
	if (fissures) root.add(fissures);
	const parts: BuildingParts = { box: [], drum: [], vault: [] };
	for (const o of terrain.obstacles) {
		if (o.kind === 'shed' && (!surface || compoundBuildings?.has(o))) addShed(parts.box, o, biome, groundHeight(terrain, o));
		else if (o.kind === 'housing' || o.kind === 'hangar' || o.kind === 'tank-bank' || o.kind === 'wall') addSiteBuilding(parts, o, groundHeight(terrain, o));
	}
	const pose = new Object3D(); const color = new Color();
	const buildingSurface = new MeshStandardMaterial({ roughness: .84, metalness: .18 });
	const batch = function (name: string, geometry: BufferGeometry, list: readonly BuildingPart[]) {
		const mesh = new InstancedMesh(geometry, buildingSurface, list.length);
		for (const [i, part] of list.entries()) {
			pose.position.set(part.x, part.y, part.z); pose.scale.set(part.width, part.height, part.depth);
			pose.rotation.set(0, part.yaw ?? 0, 0); pose.updateMatrix();
			mesh.setMatrixAt(i, pose.matrix); mesh.setColorAt(i, color.setHex(part.color));
		}
		mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh;
	};
	const names = { volcanic: 'ore-sheds', badlands: 'frontier-outbuildings', tundra: 'winter-shelters' };
	const buildingBatches = parts.box.length ? [batch(hasBiomeGround(biome) ? 'compound-buildings' : names[biome], new BoxGeometry(1, 1, 1), parts.box)] : [];
	if (parts.drum.length) buildingBatches.push(batch('storage-tanks', new CylinderGeometry(.5, .5, 1, 16), parts.drum));
	if (parts.vault.length) buildingBatches.push(batch('hangar-roofs', hangarRoofGeometry(), parts.vault));
	const trees = surface ? [] : terrain.obstacles.filter(function (obstacle) { return obstacle.kind === 'tree'; });
	const conifers = trees.length ? new InstancedMesh(new CylinderGeometry(.02, .5, 1, 6), new MeshStandardMaterial({ roughness: .95 }), trees.length * 4) : undefined;
	if (conifers) {
		pose.rotation.set(0, 0, 0);
		for (const [i, tree] of trees.entries()) {
			const base = groundHeight(terrain, tree);
			for (const [j, [bottom, height, scale, pigment]] of ([
				[0, .42, .32, 0x49524c], [.17, .46, 1, 0x324b49], [.34, .44, .82, 0x4a6660], [.55, .45, .58, 0x879e95],
			] as const).entries()) {
				pose.position.set(tree.x, base + tree.height * (bottom + height / 2), tree.y);
				pose.scale.set(tree.width * scale, tree.height * height, tree.depth * scale);
				pose.updateMatrix();
				conifers.setMatrixAt(i * 4 + j, pose.matrix); conifers.setColorAt(i * 4 + j, color.setHex(pigment));
			}
		}
		conifers.name = 'tundra-conifers'; conifers.castShadow = true; conifers.receiveShadow = true; root.add(conifers);
	}
	return { root, rotors: surface?.rotors, dispose: function () {
		surface?.dispose(); fissures?.geometry.dispose(); fissures?.material.dispose();
		for (const mesh of buildingBatches) { mesh.geometry.dispose(); mesh.dispose(); }
		buildingSurface.dispose();
		conifers?.geometry.dispose(); conifers?.material.dispose(); conifers?.dispose(); root.removeFromParent();
	} };
};
