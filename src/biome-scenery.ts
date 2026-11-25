import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DodecahedronGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, Object3D } from 'three';
import type { SurfaceBiome } from './biome-ground';
import type { FieldTerrain, TerrainObstacle } from './field-terrain';
import { randomSource } from './universe';

type Shape = 'box' | 'drum' | 'taper' | 'boulder' | 'leaves' | 'quartz' | 'reeds';
type Part = (shape: Shape, x: number, y: number, z: number, width: number, height: number, depth: number, color: number, yaw?: number, roll?: number, pitch?: number) => void;

const quartzGeometry = function () {
	const xyz: number[] = [], colors: number[] = [];
	const color = new Color();
	const surface = function (positions: readonly number[], shade: number) {
		xyz.push(...positions); color.setHex(shade);
		for (let i = 0; i < positions.length; i += 3) colors.push(color.r, color.g, color.b);
	};
	for (let i = 0; i < 6; i++) {
		const a = i * Math.PI / 3, b = (i + 1) * Math.PI / 3;
		const ax = .5 * Math.cos(a), az = .5 * Math.sin(a), bx = .5 * Math.cos(b), bz = .5 * Math.sin(b);
		const ah = .18 + Math.sin(a + 1.2) * .065, bh = .18 + Math.sin(b + 1.2) * .065;
		const l = [ax, -.5, az], r = [bx, -.5, bz];
		const topL = [ax + .04, ah, az], topR = [bx + .04, bh, bz];
		surface([...l, ...topL, ...r, ...topL, ...topR, ...r], i % 3 === 0 ? 0x8f80aa : i % 3 === 1 ? 0xac9dc4 : 0xd2c6e2);
		surface([...topL, .11, .5, -.045, ...topR], i % 2 ? 0xf0e5fc : 0xffffff);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(xyz, 3)); geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
	geometry.computeVertexNormals(); return geometry;
};

const reedGeometry = function () {
	const positions: number[] = [];
	// A tuft is one instance. The broad, leaning tips remain legible from the overhead camera.
	for (let i = 0; i < 7; i++) {
		const a = i * 2.4, x = Math.cos(a) * .28, z = Math.sin(a) * .28;
		const h = .64 + (i % 3) * .15;
		positions.push(x - .055, -.5, z, x + .055, -.5, z + .035, x * 1.8 + .1, h - .5, z * 1.8);
	}
	const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	geometry.computeVertexNormals(); return geometry;
};

const geometryFor = function (shape: Shape): BufferGeometry {
	switch (shape) {
		case 'box': return new BoxGeometry(1, 1, 1);
		case 'drum': return new CylinderGeometry(.5, .5, 1, 12);
		case 'taper': return new CylinderGeometry(.36, .5, 1, 9);
		case 'boulder': return new DodecahedronGeometry(.55);
		case 'leaves': {
			const geometry = new IcosahedronGeometry(.53, 1);
			const vertices = geometry.getAttribute('position');
			for (let i = 0; i < vertices.count; i++) {
				const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
				const scale = 1 + .14 * Math.sin(x * 13 + 2) * Math.cos(z * 14 - y * 5);
				vertices.setXYZ(i, x * scale, y * scale + x * .08, z * scale);
			}
			geometry.computeVertexNormals(); return geometry;
		}
		case 'quartz': return quartzGeometry();
		case 'reeds': return reedGeometry();
	}
};

const wetlandPlants = function (pool: TerrainObstacle, draw: Part, random: () => number) {
	const alongX = pool.width >= pool.depth;
	const length = Math.max(pool.width, pool.depth), breadth = Math.min(pool.width, pool.depth);
	for (const side of [-1, 1]) {
		for (let p = 16 + random() * 30; p < length - 12; p += 24 + random() * 65) {
			const count = 5 + Math.floor(random() * 8);
			for (let i = 0; i < count; i++) {
				const u = p - length / 2 + (random() - .5) * 54, v = side * (breadth / 2 + 12 - random() * 34);
				const x = pool.x + (alongX ? u : v), z = pool.y + (alongX ? v : u);
				const h = 12 + random() * 17;
				draw('reeds', x, h / 2, z, 16 + random() * 6, h, 18, i % 3 ? 0x9aab61 : 0xbba75f, random() * 3);
			}
		}
	}
};

const pumpStation = function ({ x, y: z, width: w, depth: d, height: h }: TerrainObstacle, draw: Part) {
	draw('box', x, h * .10, z, w, h * .20, d, 0x64716b);
	draw('box', x - .18 * w, h * .46, z, w * .57, h * .52, d * .91, 0xb75a47);
	draw('box', x - .18 * w, h * .74, z, w * .60, h * .07, d * .94, 0xe2cf9e);
	draw('box', x - .18 * w, h * .79, z, w * .57, h * .05, d * .91, 0xb36146);
	for (const side of [-1, 1]) {
		draw('box', x - .19 * w, h * .43, z + d * .46 * side, w * .29, h * .36, 2.5, 0x404b4d);
		draw('drum', x + w * .25, h * .45, z + side * d * .23, w * .38, h * .55, d * .42, 0xc37955);
		draw('drum', x + w * .25, h * .72, z + side * d * .23, w * .40, h * .055, d * .44, 0xe0b78c);
		draw('drum', x + w * .25, h * .49, z + side * d * .23, w * .395, h * .04, d * .43, 0x5c554d);
		draw('drum', x + w * .25, h * .83, z + side * d * .23, w * .09, h * .23, w * .09, 0x536565);
	}
	draw('drum', x + w * .25, h * .93, z, w * .095, d * .48, w * .095, 0x879795, 0, 0, Math.PI / 2);
	for (let i = -1; i <= 1; i++) draw('box', x - .18 * w, h * .823, z + d * i * .23, w * .56, .9, 1.8, 0xc17e5f);
};

const oldGrowth = function ({ x, y: z, width: w, depth: d, height: h }: TerrainObstacle, draw: Part, random: () => number) {
	const stump = h <= 50;
	const azimuth = random() * Math.PI;
	draw('taper', x, h * (stump ? .45 : .22), z, w * .84, h * (stump ? .9 : .44), d * .84, 0x826a4f, azimuth);
	for (let i = 0; i < 7; i++) {
		const a = azimuth + i * Math.PI * 2 / 7;
		const radius = stump ? .33 : .34, height = stump ? h * .65 : h * .28;
		draw('taper', x + Math.cos(a) * w * radius, height * .46, z + Math.sin(a) * d * radius,
			w * .22, height, d * .28, i % 2 ? 0x6c6047 : 0x98845d, -a, .27);
	}
	if (stump) {
		draw('drum', x, h * .91, z, w * .62, h * .12, d * .62, 0x988357, azimuth);
		draw('drum', x, h * .979, z, w * .50, h * .025, d * .50, 0xb9a075, azimuth);
		draw('drum', x + w * .025, h * .997, z, w * .22, h * .012, d * .22, 0x8f7856, azimuth);
		return;
	}
	// A lopsided fork opens low on each old trunk. Irregular leaf clusters sit at
	// different levels, leaving visible gaps around the outstretched branches.
	const lean = .12 + random() * .18, tiltX = Math.cos(azimuth) * w * lean, tiltZ = Math.sin(azimuth) * d * lean;
	draw('taper', x + tiltX / 2, h * .45, z + tiltZ / 2, w * .46, h * .37, d * .46, 0x978166, -azimuth, -.14);
	const n = 3 + Math.floor(random() * 2);
	const pigments = [
		[0x405b42, 0x627b48, 0x8f9d5c], [0x3d5c47, 0x5e825e, 0x81a071], [0x445d38, 0x79884c, 0xa4a565],
	] as const;
	const palette = pigments[Math.floor(random() * pigments.length)] ?? pigments[0];
	for (let i = 0; i < n; i++) {
		const a = azimuth + (i + (random() - .5) * .48) * Math.PI * 2 / n;
		const dx = Math.cos(a), dz = Math.sin(a);
		const reach = w * (i === 0 ? .94 : .52 + random() * .32);
		const level = i === 1 ? .56 + random() * .09 : .72 + random() * .14;
		const rise = h * (level - .33);
		const bx = x + tiltX * .5, bz = z + tiltZ * .5;
		draw('taper', bx + dx * reach * .50, h * .33 + rise * .50, bz + dz * reach * .50,
			w * .25, Math.hypot(rise, reach), d * .25, 0x8e785b, -a, -Math.atan2(reach, rise));
		const cx = bx + dx * reach, cz = bz + dz * reach;
		draw('leaves', cx, h * level, cz, w * .95, h * .19, d * .77, palette[0], -a);
		draw('leaves', cx - dx * w * .13, h * (level + .05), cz - dz * w * .13, w * .80, h * .17, d * .78, palette[1], a);
		for (const side of [-1, 1]) {
			draw('leaves', cx + (dx * .19 - dz * side * .24) * w, h * (level + random() * .05),
				cz + (dz * .19 + dx * side * .24) * d, w * (.41 + random() * .21), h * .13, d * .5, palette[1], a + side);
		}
		draw('leaves', cx - dx * w * .08, h * (level + .095), cz - dz * w * .08, w * .46, h * .1, d * .54, palette[2], a);
	}
	draw('leaves', x + tiltX, h * .82, z + tiltZ, w * 1.30, h * .26, d * 1.08, palette[1], azimuth);
	draw('leaves', x + tiltX - w * .12, h * .914, z + tiltZ, w * .84, h * .15, d * .83, palette[2], azimuth);
	// A patch of ferns follows the old root plate. Growth beyond the trunk stays below a rig's knees.
	for (let i = 0; i < 15; i++) {
		const t = random() * Math.PI * 2, r = w * (.35 + random() * .54);
		const cx = x + Math.cos(t) * r, cz = z + Math.sin(t) * r, size = 13 + random() * 17;
		draw('reeds', cx, size * .17, cz, size * 1.3, size * .40, size * 1.3, i % 2 ? 0x81944e : 0xa1a461, t);
	}

};

const sawmill = function ({ x, y: z, width: w, depth: d, height: h }: TerrainObstacle, draw: Part) {
	draw('box', x, h * .08, z, w, h * .16, d, 0x675b46);
	draw('box', x - w * .14, h * .42, z, w * .65, h * .55, d * .91, 0x876841);
	for (const side of [-1, 1]) {
		draw('box', x - w * .14 + side * w * .17, h * .77, z, w * .365, h * .065, d * .98, side > 0 ? 0x667263 : 0x838778, 0, -.28 * side);
		draw('box', x - w * .12, h * .40, z + d * .455 * side, w * .37, h * .48, 3, 0x484b3c);
	}
	draw('drum', x - w * .31, h * .82, z - d * .26, 7, h * .34, 7, 0x725f4e);
	for (let j = 0; j < 3; j++) for (let i = 0; i < 3 - j; i++) {
		const r = Math.min(w * .05, d * .12);
		const px = x + w * .23 + (i + j / 2) * 2 * r, py = h * .16 + r + j * r * 1.67;
		draw('drum', px, py, z, r * 2, d * .77, r * 2, 0x584736, 0, 0, Math.PI / 2);
		draw('drum', px, py, z + d * .39, r * 1.65, d * .014, r * 1.65, 0xc39863, 0, 0, Math.PI / 2);
	}
};

interface Rotor { x: number; y: number; z: number; yaw: number; radius: number; phase: number }
const turbineHubHeight = function (o: TerrainObstacle) { return o.height + (o.width + o.depth) * .80; };
const rotorRadius = function (hubHeight: number) { return hubHeight * .46; };

// Ground units can walk under branches and blades. Aircraft need the whole crown
// or swept rotor disk, including its offset from the concrete foundation.
export const sceneryFlightBounds = function (o: TerrainObstacle): TerrainObstacle {
	if (o.kind === 'tree' && o.height > 50) {
		const crown = Math.max(o.width, o.depth) * 3.5;
		return { ...o, width: crown, depth: crown, height: o.height * 1.06 };
	}
	if (o.kind === 'turbine') {
		const hub = turbineHubHeight(o), radius = rotorRadius(hub);
		const span = 2 * (radius + o.width * .41);
		return { ...o, width: span, depth: span, height: hub + radius };
	}
	return o;
};

const windTower = function (o: TerrainObstacle, draw: Part, random: () => number): Rotor {
	const { x, y: z, width: w, height: h, depth: d } = o;
	const hubHeight = turbineHubHeight(o), yaw = .65 + random() * .15;
	draw('box', x, h * .15, z, w, h * .30, d, 0x6f685a);
	draw('box', x, h * .53, z, w * .92, h * .48, d * .92, 0xb7a785);
	draw('box', x, h * .82, z, w * .94, h * .10, d * .94, 0x5a6562);
	draw('drum', x, h * .90, z, w * .77, h * .20, d * .77, 0xb7b295);
	draw('taper', x, (h + hubHeight) / 2, z, w * .28, hubHeight - h, w * .28, 0xddd7bd);
	draw('drum', x, h + 8, z, w * .29, 12, w * .29, 0xb06b4c);
	draw('box', x, hubHeight, z, w * .23, w * .22, w * .58, 0xd8cfac, yaw);
	const offset = w * .32;
	const rx = x + Math.sin(yaw) * offset, rz = z + Math.cos(yaw) * offset;
	draw('drum', rx, hubHeight, rz, w * .18, w * .19, w * .18, 0x8a7462, yaw, 0, Math.PI / 2);
	return { x: rx + Math.sin(yaw) * w * .09, y: hubHeight, z: rz + Math.cos(yaw) * w * .09,
		yaw, radius: rotorRadius(hubHeight), phase: random() * Math.PI * 2 };
};

const createRotors = function (hubs: readonly Rotor[]) {
	const xyz: number[] = [], pigments: number[] = []; const color = new Color();
	// Root cuff, broad chord, swept tip. All three blades share a single rotating instance per mast.
	const sections = [[.045, -.018, .022], [.23, -.075, .073], [.42, -.045, .070], [.81, -.015, .047], [.91, .003, .041], [1, .018, .029]] as const;
	for (let blade = 0; blade < 3; blade++) {
		const a = blade * Math.PI * 2 / 3, c = Math.cos(a), s = Math.sin(a);
		for (const [i, [y, left, right]] of sections.entries()) {
			const next = sections[i + 1]; if (!next) continue;
			const [ny, nl, nr] = next;
			color.setHex(i === 3 ? 0xc76747 : 0xe9e3cf);
			for (const [x, p] of [[left, y], [right, y], [nr, ny], [left, y], [nr, ny], [nl, ny]] as const) {
				xyz.push(x * c - p * s, x * s + p * c, 0); pigments.push(color.r, color.g, color.b);
			}
		}
	}
	const shape = new BufferGeometry(); shape.setAttribute('position', new Float32BufferAttribute(xyz, 3));
	shape.setAttribute('color', new Float32BufferAttribute(pigments, 3)); shape.computeVertexNormals();
	const mesh = new InstancedMesh(shape, new MeshStandardMaterial({ side: DoubleSide, vertexColors: true, roughness: .82 }), hubs.length);
	mesh.name = 'wind-turbine-rotors';
	const pose = new Object3D();
	const update = function (time: number) {
		for (const [i, hub] of hubs.entries()) {
			pose.position.set(hub.x, hub.y, hub.z); pose.scale.setScalar(hub.radius);
			pose.rotation.set(0, hub.yaw, hub.phase + time * .47, 'YXZ');
			pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	};
	update(0);
	return { mesh, update };
};

const outcrop = function ({ x, y: z, width: w, depth: d, height: h }: TerrainObstacle, draw: Part, random: () => number) {
	const yaw = (random() - .5) * .25;
	draw('boulder', x, h * .28, z, w, h * .72, d, 0x525049, yaw);
	draw('boulder', x - w * .08, h * .50, z, w * .81, h * .39, d * .92, 0x797064, yaw);
	draw('boulder', x - w * .13, h * .68, z - d * .07, w * .74, h * .64, d * .73, 0x4e4d49, yaw + .16);
	draw('boulder', x + w * .26, h * .33, z + d * .1, w * .40, h * .5, d * .65, 0x655f52, yaw - .34);
};

const crystalOutcrop = function ({ x, y: z, width: w, depth: d, height: h }: TerrainObstacle, draw: Part, random: () => number) {
	const alongX = w >= d, length = Math.max(w, d), breadth = Math.min(w, d);
	const knots = Math.max(1, Math.round(length / (breadth * 1.18)));
	const span = length / knots, phase = random() * 2 * Math.PI;
	const tallest = Math.floor(random() * knots);
	for (let i = 0; i < knots; i++) {
		const along = (i + .5 - knots / 2) * span;
		const across = (random() - .5) * breadth * .26;
		const cx = x + (alongX ? along : across), cz = z + (alongX ? across : along);
		const wKnot = alongX ? span : breadth, dKnot = alongX ? breadth : span;
		draw('boulder', cx, h * .065, cz, wKnot * 1.06, h * .24, dKnot * 1.06, 0x796981);
		const height = i === tallest ? h : h * (.51 + random() * .32);
		const width = Math.min(span, breadth) * (.35 + random() * .15);
		draw('quartz', cx, height * .48, cz, width, height, width * .88,
			random() < .32 ? 0xffeffe : 0xb393d9, phase + i, -.09 - random() * .26);
		// Smaller shards fan out from a shared root at different heights.
		const shards = 3 + Math.floor(random() * 4);
		for (let j = 0; j < shards; j++) {
			const angle = phase + i + (j + (random() - .5) * .92) * 2 * Math.PI / shards;
			const reach = .19 + random() * .15;
			const dx = Math.cos(angle) * wKnot * reach, dz = Math.sin(angle) * dKnot * reach;
			const shardHeight = height * (j === 0 ? .72 + random() * .20 : .42 + random() * .40);
			const shardWidth = width * (.53 + random() * .36);
			draw('quartz', cx + dx, shardHeight * .49, cz + dz, shardWidth, shardHeight, shardWidth * .83,
				random() < .33 ? 0xeadcf4 : 0xb598d8, -Math.atan2(dz, dx), -.29 - random() * .37);
		}
	}
};

export const createBiomeScenery = function (terrain: FieldTerrain, seed: number, biome: SurfaceBiome) {
	const root = new Group(); root.name = `${biome}-scenery`;
	const random = randomSource(seed ^ 0x7eb010);
	const instances = new Map<Shape, { matrix: Matrix4; color: number }[]>();
	const pose = new Object3D();
	const draw: Part = function (shape, x, y, z, w, h, d, color, yaw = 0, roll = 0, pitch = 0) {
		let list = instances.get(shape); if (!list) { list = []; instances.set(shape, list); }
		pose.position.set(x, y, z); pose.scale.set(w, h, d);
		pose.rotation.set(pitch, yaw, roll, 'YXZ'); pose.updateMatrix();
		list.push({ matrix: pose.matrix.clone(), color });
	};
	const hubs: Rotor[] = [];
	for (const o of terrain.obstacles) {
		switch (o.kind) {
			case 'channel': wetlandPlants(o, draw, random); break;
			case 'shed': if (biome === 'wetlands') pumpStation(o, draw); else sawmill(o, draw); break;
			case 'tree': oldGrowth(o, draw, random); break;
			case 'turbine': hubs.push(windTower(o, draw, random)); break;
			case 'outcrop': outcrop(o, draw, random); break;
			case 'crystal': crystalOutcrop(o, draw, random); break;
		}
	}
	const batches = [...instances].map(function ([shape, list]) {
		const material = shape === 'quartz'
			? new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false })
			: new MeshStandardMaterial({ roughness: .95, flatShading: true,
			side: shape === 'reeds' ? DoubleSide : FrontSide, emissive: shape === 'leaves' ? 0x142517 : 0x0e0c09 });
		const batch = new InstancedMesh(geometryFor(shape), material, list.length);
		const tint = new Color();
		for (const [i, item] of list.entries()) { batch.setMatrixAt(i, item.matrix); batch.setColorAt(i, tint.setHex(item.color)); }
		batch.castShadow = shape !== 'reeds'; batch.receiveShadow = true; batch.name = `${biome}-${shape}`; root.add(batch); return batch;
	});
	const rotors = hubs.length ? createRotors(hubs) : undefined;
	return { root, rotors, dispose: function () {
		for (const mesh of batches) { mesh.geometry.dispose(); mesh.material.dispose(); mesh.dispose(); }
		if (rotors) { rotors.mesh.removeFromParent(); rotors.mesh.geometry.dispose(); rotors.mesh.material.dispose(); rotors.mesh.dispose(); }
		root.removeFromParent();
	} };
};
