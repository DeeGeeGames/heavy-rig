import { Color, DataTexture, NearestFilter, SRGBColorSpace } from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import type { Biome } from './campaign-types';
import { randomSource } from './universe';

// One indexed-color orbital plate. The faint daylight bands describe the curved
// limb even when a narrow viewport crops most of the planet.
const planetColors = {
	badlands: [0x353448, 0x574650, 0x795956, 0xa07863, 0xc3a17b, 0xe1c697],
	volcanic: [0x23283b, 0x363448, 0x50404d, 0x755355, 0xa37266, 0xc69076],
	tundra: [0x293747, 0x385266, 0x507785, 0x78979d, 0xa6bebc, 0xd2dcd0],
	wetlands: [0x193641, 0x22545c, 0x437978, 0x739888, 0xa1b394, 0xd6d9a8],
	forest: [0x212e35, 0x304b42, 0x456746, 0x6f8a5c, 0x9da87a, 0xcbd1a3],
	steppe: [0x3b3440, 0x60504a, 0x8c7652, 0xb59a5d, 0xd3bd77, 0xe8d9a0],
	crystal: [0x2c253e, 0x493852, 0x65547b, 0x8f7a9d, 0xb7a9c5, 0xdcd0e0],
} as const;
// The sustained broadside sees a longer stretch of the limb. Sample terrain
// and cloud bands in spherical coordinates so they foreshorten at the horizon.
const createOrbitalRelief = function (biome: Biome, seed: number) {
	const noise = new SimplexNoise({ random: randomSource(seed) });
	const colors = biome === 'volcanic' ? [0x251e2b, 0x4d3138, 0x79413e, 0xaf5b41, 0xdf8855, 0xf6bf78]
		: biome === 'tundra' ? [0x273751, 0x405575, 0x6691ae, 0x9dbdd1, 0xc9dde3, 0xf0f1e3] : planetColors[biome];
	const ramp = Array.from({ length: 49 }, function (_, index) {
		const at = index * (colors.length - 1) / 48, band = Math.floor(at);
		return new Color(colors[band]).lerp(new Color(colors[Math.min(band + 1, colors.length - 1)]), at - band).getHex();
	});
	return function (lon: number, lat: number, light: number, depth: number) {
		const x = lon * 5, y = lat * 5;
		const land = noise.noise(x, y), rock = noise.noise(3.5 * x + land, 3.5 * y);
		const grain = noise.noise(14 * x + rock, 14 * y), ridge = rock + .24 * grain;
		const clouds = noise.noise(1.5 * x + land, 8 * y + 1.9 * land) + .30*grain;
		const shade = .04 + .57 * light + .18 * land + .13 * rock + .075 * grain + .14 * (1 - depth);
		const front = biome === 'volcanic' ? .11 : .29;
		if (biome === 'volcanic' && Math.abs(ridge) < .035 && land > -.22) return land > .44 ? 0xffc67c : 0xd97246;
		const value = shade + front * Math.max(0, clouds) + (biome === 'tundra' ? .16 : 0);
		return ramp[Math.round(48 * Math.min(1, Math.max(0, value)))] ?? colors[0] ?? 0;
	};
};

export const createOrbitPlate = function (biome: Biome, seed: number, view: 'descent' | 'broadside' = 'descent') {
	// The carrier shots see the upper half. The descent follows the horizon
	// down the plate until the planet covers the frame.
	const scale = view === 'broadside' ? 1.5 : 1;
	const width = 448 * scale, height = 512 * scale;
	const relief = view === 'broadside' ? createOrbitalRelief(biome, seed) : undefined;
	const globeRadius = (relief ? 820 : 390) * scale;
	const centerX = width * (relief ? .07 : .33), centerY = 178 * scale + globeRadius;
	const pixels = new Uint8Array(width * height * 4);
	const surface = planetColors[biome];
	const phase = (seed >>> 0) % 127 / 17;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const nx = (x - centerX) / globeRadius, ny = (y - centerY) / globeRadius;
			const radius = Math.hypot(nx, ny);
			let color = 0x101827;
			if (radius < 1) {
				const depth = Math.sqrt(1 - radius * radius);
				const longitude = Math.atan2(nx, depth), latitude = Math.asin(ny);
				const sunlight = Math.max(0, Math.min(1, .68 - nx * .72 - depth * .2));
				if (relief) {
					color = radius > .998 ? surface[5] : relief(longitude, latitude, sunlight, depth);
				} else {
					const coast = Math.sin(8 * longitude + phase + 2 * Math.sin(13 * latitude))
						+ Math.cos(16 * latitude - phase) + .45 * Math.sin(24 * longitude + 19 * latitude)
						+ .17 * Math.cos(58 * longitude - 31 * latitude);
					const front = 40 * latitude + 2.7 * Math.sin(4 * longitude + phase) + .5 * Math.cos(16 * longitude - 7 * latitude);
					const cloud = Math.sin(front) > .86 && Math.sin(6 * longitude - 3 * latitude - phase) > -.14;
					const shade = Math.min(5, Math.floor(sunlight * 4 + (coast > .4 ? 1 : 0) + (cloud || coast > 1.4 ? 1 : 0) + (cloud ? 1 : 0)));
					color = radius > .991 ? surface[5] : radius > .977 ? surface[4] : surface[shade] ?? surface[0];
				}
			} else if (radius < (relief ? 1.003 : 1.012)) color = relief ? surface[3] : 0x667f8b;
			else {
				const star = Math.imul(Math.imul(x + 163, 73856093) ^ Math.imul(y + 17, 19349663) ^ seed, 1597334677) >>> 0;
				if (star % 1049 < 2) color = star & 8 ? 0xa7b5b6 : 0x637887;
			}
			const offset = ((height - 1 - y) * width + x) * 4;
			pixels[offset] = color >> 16; pixels[offset + 1] = color >> 8; pixels[offset + 2] = color; pixels[offset + 3] = 255;
		}
	}
	const texture = new DataTexture(pixels, width, height);
	texture.repeat.y = .5; texture.offset.y = .5;
	texture.colorSpace = SRGBColorSpace; texture.minFilter = texture.magFilter = NearestFilter; texture.needsUpdate = true;
	return texture;
};
