import { BoxGeometry, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Path, Shape, ShapeGeometry } from 'three';
import type { MissionMap } from './campaign-types';
import type { FieldTerrain, TerrainObstacle } from './field-terrain';

export const FIELD_ROAD_MARKINGS = { haul: '#e7ac67', service: '#8dc7c9' } as const;

export const paintFieldRoads = function (ctx: CanvasRenderingContext2D, terrain: FieldTerrain) {
	ctx.save();
	ctx.globalAlpha = 1; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
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
		const cut = terrain.obstacles.find(function (obstacle) { return obstacle.kind === 'fissure'; });
		if (!cut) continue;
		for (const [i, p] of road.entries()) {
			const from = road[i - 1];
			if (!from || p.x === from.x || (p.x - cut.x) * (from.x - cut.x) > 0) continue;
			const y = from.y + (p.y - from.y) * (cut.x - from.x) / (p.x - from.x);
			ctx.save(); ctx.translate(cut.x, y); ctx.rotate(Math.atan2(p.y - from.y, p.x - from.x));
			ctx.fillStyle = haul ? FIELD_ROAD_MARKINGS.haul : FIELD_ROAD_MARKINGS.service;
			for (const bank of [-1, 1]) for (const shoulder of [-1, 1]) {
				for (const stripe of [-11, 0, 11]) ctx.fillRect(bank * cut.width / 2 + stripe - 3, shoulder * (haul ? 42 : 32) - 10, 6, 20);
			}
			ctx.restore(); break;
		}
	}
	ctx.restore();
};

// Preserve the mission texture's world coordinates while opening the actual
// ground mesh, allowing the rock faces and lava floor to sit below elevation 0.
export const createCutGround = function (map: MissionMap, terrain: FieldTerrain) {
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
const createFissures = function (cuts: readonly TerrainObstacle[], seed: number) {
	const vertices: number[] = []; const pigments: number[] = [];
	const tone = new Color();
	const face = function (a: Vertex, b: Vertex, c: Vertex, d: Vertex, color: number) {
		tone.setHex(color);
		for (const corner of [a, b, c, a, c, d]) { vertices.push(...corner); pigments.push(tone.r, tone.g, tone.b); }
	};
	let sample = seed >>> 0;
	const random = function () { sample = (Math.imul(sample, 1664525) + 1013904223) >>> 0; return sample / 4294967296; };
	for (const cut of cuts) {
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
				face(a, b, [b[0], -.03, b[2]], [a[0], -.03, a[2]], i % 3 === 0 ? 0x4a3938 : 0x352c32);
			}
		};
		let previous = row(0); cap(previous);
		for (let i = 1; i <= steps; i++) {
			const next = row(i);
			const bands = [0xa5694d, 0x635152, 0x443e49, 0x685550, 0x3b3642, 0x422e32,
				i % 5 === 1 ? 0x925036 : 0xc95b37, i % 5 === 1 ? 0x68423a : 0xffa25b,
				0x552f30, 0x35313b, 0x5f4c49, 0x4c4349, 0x945a45];
			for (const [j, a] of previous.entries()) {
				const b = previous[j + 1]; const c = next[j + 1]; const d = next[j]; const color = bands[j];
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
	mesh.name = 'basalt-fissures'; return mesh;
};

interface ShedPart { x: number; y: number; z: number; width: number; height: number; depth: number; color: number }
const addShed = function (parts: ShedPart[], shed: TerrainObstacle) {
	const { width: w, depth: d, height: h } = shed;
	const add = function (x: number, y: number, z: number, width: number, height: number, depth: number, color: number) {
		parts.push({ x: shed.x + x, y: y + height / 2, z: shed.y + z, width, height, depth, color });
	};
	// The main mass, eaves and roof equipment stay inside the combat volume.
	add(0, 0, 0, w, h * .12, d, 0x585459);
	add(0, h * .12, 0, w - 5, h * .74, d - 5, 0x858f91);
	add(0, h * .86, 0, w, h * .08, d, 0x414b50);
	add(0, h * .94, 0, w, h * .05, d, 0xa7b0ad);
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

export const createFieldStructures = function (terrain: FieldTerrain, seed: number) {
	const root = new Group();
	const fissures = createFissures(terrain.obstacles.filter(function (obstacle) { return obstacle.kind === 'fissure'; }), seed);
	root.add(fissures);
	const parts: ShedPart[] = [];
	for (const obstacle of terrain.obstacles) if (obstacle.kind === 'shed') addShed(parts, obstacle);
	const sheds = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ roughness: .84, metalness: .18 }), parts.length);
	const pose = new Object3D(); const color = new Color();
	for (const [i, part] of parts.entries()) {
		pose.position.set(part.x, part.y, part.z); pose.scale.set(part.width, part.height, part.depth); pose.updateMatrix();
		sheds.setMatrixAt(i, pose.matrix); sheds.setColorAt(i, color.setHex(part.color));
	}
	sheds.name = 'ore-sheds'; sheds.castShadow = true; sheds.receiveShadow = true; root.add(sheds);
	return { root, dispose: function () {
		fissures.geometry.dispose(); fissures.material.dispose();
		sheds.geometry.dispose(); sheds.material.dispose(); sheds.dispose(); root.removeFromParent();
	} };
};
