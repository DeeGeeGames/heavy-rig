import { isFieldContact } from './enemy-perimeter';
import { FIELD_ROAD_MARKINGS } from './field-terrain-3d';
import { isPriorityTarget, type missionStructures } from './missions';
import { ARENA, ENEMY_STATS, type CombatStateView, type Point, type Unit } from './simulation';
import { drawTerrainContours } from './terrain-contours';
import { groundHeight } from './terrain-elevation';
import { terrainMapColors } from './terrain-map-colors';

export const fieldContacts = function (state: CombatStateView) {
	const bounds = state.mission?.map ?? ARENA;
	return state.enemies.filter(function (enemy) { return enemy.hp > 0 && isFieldContact(enemy, bounds); });
};

interface RadarScene {
	enemies: readonly Unit[];
	structures: ReturnType<typeof missionStructures>;
	navigation: { point: Point; color: string } | undefined;
	relay: Point | undefined;
}

export const drawTacticalRadar = function (ctx: CanvasRenderingContext2D, state: CombatStateView, aim: Point, couchMode: boolean, { enemies, structures, navigation, relay }: RadarScene) {
	const { canvas } = ctx;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (width <= 2 || height <= 49) return;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	const pixelWidth = Math.round(width * dpr);
	const pixelHeight = Math.round(height * dpr);
	if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
		canvas.width = pixelWidth;
		canvas.height = pixelHeight;
	}
	ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
	ctx.clearRect(0, 0, width, height);
	const w = width - 2, h = height - 49;
	const x = 1, y = 24;
	const mission = state.mission;
	ctx.fillStyle = '#0c1c22e6'; ctx.fillRect(x - 1, y - 24, w + 2, h + 49);
	ctx.strokeStyle = '#91ada445'; ctx.lineWidth = 1; ctx.strokeRect(x - 1, y - 24, w + 2, h + 49);
	ctx.strokeStyle = '#8fa39c30'; ctx.strokeRect(x + 6, y + 4, w - 12, h - 8);
	ctx.font = `600 ${couchMode ? 14 : 11}px monospace`; ctx.textAlign = 'left'; ctx.fillStyle = '#c5d0bc'; ctx.fillText('TACTICAL', x + 9, y - 8);
	ctx.textAlign = 'right'; ctx.fillStyle = '#829c99'; ctx.fillText('N ↑', x + w - 8, y - 8);
	ctx.strokeStyle = '#64847e22'; ctx.lineWidth = 7;
	ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
	ctx.strokeStyle = '#6c8b8433'; ctx.lineWidth = 1;
	ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 20, 0, Math.PI * 2); ctx.stroke();
	const bounds = mission?.map ?? ARENA;
	const point = function (value: Point) { return { x: x + value.x / bounds.width * w, y: y + value.y / bounds.height * h }; };
	const dot = function (value: Point, color: string, radius: number, outline = false) {
		const at = point(value); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 1;
		ctx.beginPath(); ctx.arc(at.x, at.y, radius, 0, Math.PI * 2); if (outline) ctx.stroke(); else ctx.fill();
	};
	ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
	if (mission?.map.terrain) {
		drawTerrainContours(ctx, mission.map, x, y, w, h);
		for (const obstacle of mission.map.terrain.obstacles) {
			const corner = point({ x: obstacle.x - obstacle.width / 2, y: obstacle.y - obstacle.depth / 2 });
			const dw = obstacle.width * w / bounds.width, dh = obstacle.depth * h / bounds.height;
			const [fill, edge] = terrainMapColors(obstacle.kind, mission.map.biome);
			ctx.fillStyle = fill; ctx.strokeStyle = edge;
			ctx.fillRect(corner.x, corner.y, dw, dh); ctx.strokeRect(corner.x, corner.y, dw, dh);
		}
		for (const [i, road] of mission.map.terrain.roads.entries()) {
			ctx.strokeStyle = i === 0 ? FIELD_ROAD_MARKINGS.haul : FIELD_ROAD_MARKINGS.service;
			ctx.setLineDash(i === 0 ? [] : [3, 2]); ctx.beginPath();
			for (const [j, node] of road.entries()) { const p = point(node); if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
			ctx.stroke();
		}
		ctx.setLineDash([]);
	}
	if (relay) dot(relay, '#91c5b8', 4, true);
	if (mission) {
		for (const { body } of structures) dot(body, body.hp > 0 ? '#ffd199' : '#829c99', 4, true);
		for (const site of mission.captureSites ?? []) dot(site, site.complete ? '#b9f5ca' : '#ffd199', 4, true);
		dot(mission.map.drop, '#a5b6ac', 3, true);
		if (navigation) dot(navigation.point, navigation.color, 6, true);
	}
	const p = point(state.player); const a = point(aim);
	ctx.strokeStyle = '#c9d9c04d'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(a.x, a.y); ctx.stroke();
	ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(state.player.angle);
	ctx.fillStyle = '#f1e4b9'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -3); ctx.lineTo(-1, 0); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill(); ctx.restore();
	for (const mate of state.squadmates) {
		const at = point(mate);
		if (mate.hp > 0) { ctx.fillStyle = '#84e3eb'; ctx.fillRect(at.x - 2, at.y - 2, 5, 5); }
		else { ctx.strokeStyle = '#a8bcc0'; ctx.lineWidth = 1; ctx.strokeRect(at.x - 2, at.y - 2, 5, 5); }
	}
	for (const enemy of enemies) dot(enemy, isPriorityTarget(state, enemy) ? '#ffd6a7' : ENEMY_STATS[enemy.kind].elevation > 42 ? '#8fd6da' : '#f2a571', isPriorityTarget(state, enemy) ? 4 : enemy.heavy ? 3 : 2, ENEMY_STATS[enemy.kind].elevation > 42);
	for (const warning of state.warnings) dot(warning, '#e5a46f', 4, true);
	for (const strike of state.strikes) dot(strike, strike.friendly ? '#94ebe4' : '#ff8154', strike.radius / bounds.width * w, true);
	ctx.restore();
	ctx.font = `${couchMode ? 14 : 11}px monospace`; ctx.textAlign = 'left'; ctx.fillStyle = '#91a9a3'; ctx.fillText(`${enemies.length.toString().padStart(2, '0')} CONTACTS`, x + 9, y + h + 15);
	if (mission?.map.terrain?.elevation) {
		ctx.textAlign = 'right'; ctx.fillText(`ALT ${Math.round(groundHeight(mission.map.terrain, state.player))} M`, x + w - 9, y + h + 15);
	}
};
