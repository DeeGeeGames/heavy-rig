import { ExtrudeGeometry, Shape } from 'three';
import type { MissionMap } from './campaign-types';
import type { ObjectiveSite, TerrainObstacle } from './field-terrain';
import type { Point } from './simulation';

export interface BuildingPart {
	x: number; y: number; z: number;
	width: number; height: number; depth: number;
	color: number; yaw?: number;
}
export interface BuildingParts { box: BuildingPart[]; drum: BuildingPart[]; vault: BuildingPart[] }
type AddPart = (shape: keyof BuildingParts, along: number, bottom: number, across: number,
	length: number, height: number, breadth: number, color: number) => void;

// A long, shallow barrel roof with a flat crown and faceted shoulders.
// Its shared unit mesh runs along local X, centred on all three axes.
export const hangarRoofGeometry = function () {
	const profile = new Shape();
	profile.moveTo(-.5, -.5); profile.lineTo(.5, -.5); profile.lineTo(.5, -.27);
	profile.lineTo(.36, .24); profile.lineTo(.2, .5); profile.lineTo(-.2, .5);
	profile.lineTo(-.36, .24); profile.lineTo(-.5, -.27); profile.closePath();
	return new ExtrudeGeometry(profile, { depth: 1, bevelEnabled: false }).translate(0, 0, -.5).rotateY(Math.PI / 2);
};

const housing = function (add: AddPart, accent: number) {
	add('box', 0, 0, 0, 1, .09, 1, 0x766756);
	add('box', 0, .09, 0, .94, .70, .90, 0xd0b999);
	// Shaded, inset window banks and deep sill bands read as several storeys
	// even when the camera can only resolve a few pixels per floor.
	for (const side of [-1, 1]) {
		for (const floor of [.30, .56]) {
			for (const bay of [-.31, -.10, .11, .32]) {
				add('box', bay, floor, side * .454, .15, .11, .012, 0x3f5456);
			}
			add('box', 0, floor - .045, side * .456, .97, .04, .065, accent);
		}
		add('box', -.14, .09, side * .456, .12, .15, .015, 0x4c514d);
		add('box', -.14, .225, side * .465, .25, .04, .065, accent);
	}
	add('box', 0, .79, 0, 1, .065, .98, 0xe1d0ad);
	add('box', 0, .855, 0, .93, .05, .89, accent);
	add('box', .22, .905, -.09, .25, .09, .48, 0xb4a493);
	add('box', .22, .995, -.09, .26, .005, .50, 0xe0cdad);
	add('box', -.23, .905, .13, .21, .04, .24, 0x615d53);
};

const hangar = function (add: AddPart) {
	add('box', 0, 0, 0, 1, .11, 1, 0x48494b);
	add('box', 0, .11, 0, .975, .55, .95, 0x747d77);
	add('vault', 0, .64, 0, .98, .33, .97, 0x8b9995);
	for (const rib of [-.46, -.24, 0, .24, .46]) {
		add('vault', rib, .635, 0, .035, .365, 1, 0x586767);
	}
	for (const end of [-1, 1]) {
		add('box', end * .490, .10, 0, .010, .52, .78, 0x3b4749);
		add('box', end * .497, .11, 0, .005, .45, .65, 0x677575);
		add('box', end * .498, .11, 0, .004, .45, .018, 0x3e494b);
		add('box', end * .495, .57, 0, .010, .055, .78, 0xc2a262);
	}
};

const storageTanks = function (add: AddPart, length: number, breadth: number) {
	// The raised containment hall occupies the shared rectangular footing.
	// Tanks, lids and access hatches rise together above its dark parapet.
	add('box', 0, 0, 0, 1, .18, 1, 0x575a56);
	add('box', 0, .18, 0, .96, .37, .94, 0x71776f);
	add('box', 0, .55, 0, .99, .065, .97, 0x3d4b4c);
	const twin = length >= 1.38 * breadth;
	const diameter = Math.min(length * (twin ? .46 : .83), breadth * .86);
	const w = diameter / length, d = diameter / breadth;
	for (const tank of twin ? [-.24, .24] : [0]) {
		add('drum', tank, .60, 0, w, .32, d, 0xb08064);
		add('drum', tank, .71, 0, w * 1.035, .045, d * 1.035, 0x654f44);
		add('drum', tank, .90, 0, w * 1.025, .04, d * 1.025, 0xd2b088);
		add('drum', tank, .94, 0, w * .83, .028, d * .83, 0x998777);
		add('drum', tank + .06 * w, .968, -.10 * d, w * .23, .032, d * .23, 0x4e5957);
	}
};

const wall = function (add: AddPart, length: number) {
	add('box', 0, 0, 0, 1, .28, 1, 0x635e55);
	add('box', 0, .28, 0, .995, .60, .76, 0xa5a08c);
	add('box', 0, .88, 0, 1, .085, .83, 0x525c59);
	const count = Math.max(2, Math.round(length / 55));
	for (let i = 0; i < count; i++) {
		const pier = -.46 + .92 * i / (count - 1);
		add('box', pier, .23, 0, Math.min(.08, 9 / length), .77, .96, 0x798478);
	}
	for (const end of [-.42, .42]) add('box', end, .965, 0, .10, .027, .55, 0xd7b06c);
};

export const addSiteBuilding = function (parts: BuildingParts, obstacle: TerrainObstacle, base: number) {
	const alongX = obstacle.width >= obstacle.depth;
	const length = Math.max(obstacle.width, obstacle.depth), breadth = Math.min(obstacle.width, obstacle.depth);
	const add: AddPart = function (shape, along, bottom, across, w, h, d, color) {
		parts[shape].push({
			x: obstacle.x + (alongX ? along * length : -across * breadth),
			y: base + (bottom + h / 2) * obstacle.height,
			z: obstacle.y + (alongX ? across * breadth : along * length),
			width: w * length, height: h * obstacle.height, depth: d * breadth, yaw: alongX ? 0 : -Math.PI / 2, color,
		});
	};
	switch (obstacle.kind) {
		case 'housing': {
			const accent = Math.floor(obstacle.x / 90 + obstacle.y / 193) % 2 ? 0x538281 : 0xa16b55;
			housing(add, accent); break;
		}
		case 'hangar': hangar(add); break;
		case 'tank-bank': storageTanks(add, length, breadth); break;
		case 'wall': wall(add, length); break;
	}
};

export const paintSitePavement = function (ctx: CanvasRenderingContext2D, site: ObjectiveSite, obstacles: readonly TerrainObstacle[]) {
	const city = site.kind === 'city';
	const left = site.x - site.width / 2, right = left + site.width;
	const top = site.y - site.depth / 2, bottom = top + site.depth;
	const bevel = 22;
	ctx.save();
	ctx.globalAlpha = 1;
	ctx.beginPath(); ctx.moveTo(left + bevel, top); ctx.lineTo(right - bevel, top);
	ctx.lineTo(right, top + bevel); ctx.lineTo(right, bottom - bevel); ctx.lineTo(right - bevel, bottom);
	ctx.lineTo(left + bevel, bottom); ctx.lineTo(left, bottom - bevel); ctx.lineTo(left, top + bevel); ctx.closePath();
	ctx.clip(); ctx.fillStyle = city ? '#68645b' : '#575d5c'; ctx.fill();
	// Expansion joints run across the slab beneath streets, sidewalks and bays.
	ctx.strokeStyle = city ? '#59574f' : '#484e4f'; ctx.lineWidth = 2.5; ctx.beginPath();
	const pitch = city ? 54 : 78;
	for (let x = left + pitch; x < right; x += pitch) { ctx.moveTo(x, top); ctx.lineTo(x, bottom); }
	for (let y = top + pitch; y < bottom; y += pitch) { ctx.moveTo(left, y); ctx.lineTo(right, y); }
	ctx.stroke();
	for (const o of obstacles) {
		if (o.x < left || o.x > right || o.y < top || o.y > bottom) continue;
		ctx.save(); ctx.translate(o.x, o.y);
		if (o.width < o.depth) ctx.rotate(Math.PI / 2);
		const span = Math.max(o.width, o.depth), width = Math.min(o.width, o.depth);
		if (city && (o.kind === 'housing' || o.kind === 'shed')) {
			const walk = 17;
			ctx.fillStyle = '#a49c87'; ctx.fillRect(-span / 2 - walk, -width / 2 - walk, span + 2 * walk, width + 2 * walk);
			ctx.strokeStyle = '#756f61'; ctx.lineWidth = 3;
			ctx.strokeRect(-span / 2 - walk, -width / 2 - walk, span + 2 * walk, width + 2 * walk);
			ctx.beginPath();
			for (let joint = -span / 2; joint <= span / 2; joint += 27) {
				for (const side of [-1, 1]) { ctx.moveTo(joint, side * width / 2); ctx.lineTo(joint, side * (width / 2 + walk)); }
			}
			ctx.stroke();
		} else if (o.kind === 'hangar') {
			ctx.fillStyle = '#424948'; ctx.strokeStyle = '#c0a276'; ctx.lineWidth = 3.5;
			for (const end of [-1, 1]) {
				ctx.save(); ctx.scale(end, 1); ctx.translate(span / 2, 0);
				ctx.fillRect(0, -width * .40, 38, width * .8);
				ctx.strokeRect(2, -width * .40, 36, width * .8);
				for (let y = -width * .33; y < width * .30; y += 15) {
					ctx.beginPath(); ctx.moveTo(7, y); ctx.lineTo(17, y + 8); ctx.stroke();
				}
				ctx.restore();
			}
		} else if (o.kind === 'tank-bank') {
			ctx.strokeStyle = '#b79664'; ctx.setLineDash([15, 9]); ctx.lineWidth = 5;
			ctx.strokeRect(-span / 2 - 10, -width / 2 - 10, span + 20, width + 20);
		}
		ctx.restore();
	}
	ctx.restore();
};

export const paintRelaySquare = function (ctx: CanvasRenderingContext2D, relay: Point) {
	ctx.save(); ctx.translate(relay.x, relay.y); ctx.globalAlpha = 1;
	ctx.fillStyle = '#77786b'; ctx.strokeStyle = '#a59f88'; ctx.lineWidth = 4;
	ctx.beginPath();
	for (let i = 0; i < 8; i++) {
		const a = (i + .5) * Math.PI / 4, x = Math.cos(a) * 93, y = Math.sin(a) * 93;
		if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
	}
	ctx.closePath(); ctx.fill(); ctx.stroke();
	// Four painted crossings meet the avenue and cross streets at the square.
	ctx.fillStyle = '#c3bba4';
	for (let street = 0; street < 4; street++) {
		for (let stripe = -3; stripe <= 3; stripe++) ctx.fillRect(103, stripe * 10 - 2, 16, 5);
		ctx.rotate(Math.PI / 2);
	}
	ctx.restore();
};

export const paintCompoundPavement = function (ctx: CanvasRenderingContext2D, map: MissionMap) {
	ctx.save();
	for (const compound of map.terrain?.compounds ?? []) {
		const site = map.sites[compound.siteIndex];
		if (!site) continue;
		// Separate apron slabs from building footings. Roads still surface the
		// open space between them and the biome shows through each yard.
		ctx.fillStyle = '#666966'; ctx.globalAlpha = .68;
		ctx.fillRect(site.x - 106, site.y - 85, 212, 170);
		ctx.strokeStyle = '#939389'; ctx.lineWidth = 4;
		ctx.strokeRect(site.x - 104, site.y - 83, 208, 166);
		for (const building of compound.buildings) {
			if (building.kind === 'wall') continue;
			const x = building.x - building.width / 2, y = building.y - building.depth / 2;
			ctx.fillRect(x - 12, y - 12, building.width + 24, building.depth + 24);
			ctx.strokeRect(x - 10, y - 10, building.width + 20, building.depth + 20);
		}
	}
	ctx.restore();
};

export const paintCompoundLabels = function (ctx: CanvasRenderingContext2D, map: MissionMap) {
	const terrain = map.terrain;
	if (!terrain?.compounds?.length) return;
	ctx.save();
	ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
	for (const compound of terrain.compounds) {
		const site = map.sites[compound.siteIndex];
		if (!site) continue;
		const title = compound.name.toUpperCase();
		const textWidth = Math.min(ctx.measureText(title).width, 356);
		const halfWidth = textWidth / 2 + 13, halfDepth = 20;
		const xOffset = 104 + halfWidth, yOffset = 85 + halfDepth;
		const offsets = [[0, yOffset], [0, -yOffset], [xOffset, 0], [-xOffset, 0]] as const;
		const at = offsets.map(function ([x, y]) { return { x: site.x + x, y: site.y + y }; }).find(function (p) {
			return p.x >= halfWidth && p.x <= map.width - halfWidth && p.y >= halfDepth && p.y <= map.height - halfDepth
				&& terrain.obstacles.every(function (o) { return Math.abs(o.x - p.x) >= o.width / 2 + halfWidth || Math.abs(o.y - p.y) >= o.depth / 2 + halfDepth; });
		});
		if (!at) continue;
		ctx.fillStyle = '#252e2bd9'; ctx.fillRect(at.x - halfWidth, at.y - halfDepth, halfWidth * 2, halfDepth * 2);
		ctx.fillStyle = '#eed19a'; ctx.fillText(title, at.x, at.y + 2, textWidth);
		for (const side of [-1, 1]) ctx.fillRect(at.x + side * (halfWidth - 5) - 1, at.y - 11, 2, 22);
	}
	ctx.restore();
};
