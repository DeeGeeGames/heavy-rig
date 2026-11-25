import type { OrthographicCamera } from 'three';
import { inFiringArc } from './torso-arc';
import { getWeapon, withinWeaponRange } from './arsenal';
import { mechScale, type Gaits } from './gait';
import { toScreen } from './projection-3d';
import { ARENA, missileTracking, distance, ENEMY_STATS, getEnemyDefense, type Point, type CombatStateView, type Unit } from './simulation';
import { isPriorityTarget, missionStructures, EXTRACTION_RADIUS, EXTRACTION_SECONDS, RECOVERY_SECONDS, BEACON_SECONDS } from './missions';
import { FIELD_ROAD_MARKINGS } from './field-terrain-3d';

const RADAR_CUT_COLORS = {
	volcanic: ['#35282a', '#9c6a54'], badlands: ['#3d2922', '#bd9164'], tundra: ['#294657', '#abd2df'],
} as const;

export interface ScreenRect { left: number; right: number; top: number; bottom: number }
export const targetElevation = function (target: Point): number {
	if (!('kind' in target)) return 45;
	const kind = target.kind;
	return kind === 'helicopter' || kind === 'vtol' || kind === 'tank' ? ENEMY_STATS[kind].elevation : 45;
};
export interface OverlayOptions {
	enemyLabelHeights?: ReadonlyMap<number, number>;
	squadmateLabelHeights?: ReadonlyMap<string, number>;
	obstructions?: readonly ScreenRect[];
	showRadar: boolean;
	gaits: Gaits;
	camera: OrthographicCamera;
	couchMode?: boolean;
	armorHit?: number;
	armorHitHeight?: number;
	relayHit?: number;
}

export const edgeMarker = function (point: Point, width: number, height: number, obstructions: readonly ScreenRect[] = []): { point: Point; angle: number } | undefined {
	const left = Math.min(45, width / 2); const right = width - left;
	const top = Math.min(80, height / 2); const bottom = Math.max(top, height - 130);
	const padded = obstructions.map(function (rect) { return { left: rect.left - 18, right: rect.right + 18, top: rect.top - 32, bottom: rect.bottom + 18 }; });
	if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom && !padded.some(function (rect) { return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom; })) return undefined;
	const preferred = { x: width / 2, y: Math.max(top, Math.min(bottom, height * 0.52)) };
	const blocked = function (candidate: Point) { return padded.some(function (rect) { return candidate.x >= rect.left && candidate.x <= rect.right && candidate.y >= rect.top && candidate.y <= rect.bottom; }); };
	const origins = [preferred, ...padded.map(function (rect) { return { x: preferred.x, y: Math.max(top, Math.min(bottom, rect.top - 1)) }; }), { x: preferred.x, y: top }];
	const origin = origins.find(function (candidate) { return !blocked(candidate); });
	if (!origin) return undefined;
	const dx = point.x - origin.x; const dy = point.y - origin.y;
	if (dx === 0 && dy === 0) return undefined;
	const horizontal = dx > 0 ? (right - origin.x) / dx : dx < 0 ? (left - origin.x) / dx : Infinity;
	const vertical = dy > 0 ? (bottom - origin.y) / dy : dy < 0 ? (top - origin.y) / dy : Infinity;
	let factor = Math.max(0, Math.min(horizontal, vertical));
	for (const rect of padded) {
		if ((dx === 0 && (origin.x < rect.left || origin.x > rect.right)) || (dy === 0 && (origin.y < rect.top || origin.y > rect.bottom))) continue;
		const tx = dx === 0 ? [-Infinity, Infinity] : [(rect.left - origin.x) / dx, (rect.right - origin.x) / dx];
		const ty = dy === 0 ? [-Infinity, Infinity] : [(rect.top - origin.y) / dy, (rect.bottom - origin.y) / dy];
		const entry = Math.max(Math.min(...tx), Math.min(...ty));
		const exit = Math.min(Math.max(...tx), Math.max(...ty));
		if (entry > 0 && entry <= exit) factor = Math.min(factor, entry);
	}
	return { point: { x: origin.x + dx * factor, y: origin.y + dy * factor }, angle: Math.atan2(dy, dx) };
};

// Keep the existing presentation helper signature for callers. Guidance follows selection.
export const targetSolution = function (state: CombatStateView, target: Unit, _aim: Point): { guided: boolean; inRange: boolean } {
	void _aim;
	return solutionFor(state, target, target.id);
};
const solutionFor = function (state: CombatStateView, target: Point, id: number): { guided: boolean; inRange: boolean } {
	const weapons = state.loadout.map(function (mount) { return getWeapon(mount.weapon); });
	const separation = distance(target, state.player);
	const guided = missileTracking(state, id) === 'TRACKING' && state.player.targetId === id && state.player.missileLock?.targetId === id && state.player.missileLock.progress >= 1 - 1e-9;
	return { guided, inRange: weapons.some(function (weapon) { return withinWeaponRange(separation, weapon.range); }) };
};

const getWeaponFeedback = function (state: CombatStateView, target: Point, id: number): string {
	const tracking = missileTracking(state, id);
	if (tracking !== 'NO GUIDANCE') return tracking === 'TRACKING' ? solutionFor(state, target, id).guided ? 'LOCKED' : 'ACQUIRING' : tracking;
	if (!inFiringArc(state.player, state.player.angle, target)) return 'OUT OF ARC';
	return solutionFor(state, target, id).inRange ? 'IN RANGE' : 'OUT OF RANGE';
};

export const missionNavigation = function (state: CombatStateView): { point: Point; label: string; color: string } | undefined {
	const mission = state.mission; if (!mission) return undefined;
	if (mission.stage === 'extract') return { point: mission.map.extraction, label: 'EXTRACT', color: '#b9f5ca' };
	if (mission.contract.kind === 'raid' || mission.captureSites) {
		const sites = mission.contract.kind === 'raid' ? (mission.raidTargets ?? []).filter(function (site) { return site.hp > 0; })
			: (mission.captureSites ?? []).filter(function (site) { return !site.complete; });
		const point = sites.reduce<Point | undefined>(function (nearest, site) { return !nearest || distance(site, state.player) < distance(nearest, state.player) ? site : nearest; }, undefined);
		if (point) return { point, label: mission.contract.kind === 'raid' ? 'RAID' : mission.contract.kind === 'recovery' ? 'RECOVER' : 'BEACON', color: '#ffd199' };
	}
	const target = mission.contract.kind === 'assassination' ? state.enemies.find(function (enemy) { return enemy.id === mission.targetId; })
		: mission.contract.kind === 'clearance' ? state.enemies.reduce<Unit | undefined>(function (nearest, enemy) { return !nearest || distance(enemy, state.player) < distance(nearest, state.player) ? enemy : nearest; }, undefined) : undefined;
	return { point: target ?? mission.structure ?? mission.map.objective, label: mission.contract.kind === 'defend' ? 'DEFEND' : mission.contract.kind === 'demolition' ? 'FACILITY' : mission.contract.kind === 'assassination' ? 'PRIORITY' : 'HOSTILE', color: mission.contract.kind === 'defend' ? '#a3ddd0' : '#ffd199' };
};

const bracket = function (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, length: number) {
	ctx.beginPath();
	for (const horizontal of [-1, 1]) for (const vertical of [-1, 1]) {
		const px = x + horizontal * width / 2; const py = y + vertical * height / 2;
		ctx.moveTo(px - horizontal * length, py); ctx.lineTo(px, py); ctx.lineTo(px, py - vertical * length);
	}
	ctx.stroke();
};

// World labels use the same projection as ground picking and the 3D scene.
// Tactical diagrams remain screen-space, so they stay legible while moving.
export const drawOverlay = function (ctx: CanvasRenderingContext2D, width: number, height: number, state: CombatStateView, aim: Point, options: OverlayOptions) {
	ctx.clearRect(0, 0, width, height);
	if (width <= 0 || height <= 0) return;
	ctx.save();
	const at = function (point: Point, elevation = 0) { return toScreen(point, options.camera, width, height, elevation); };
	const ground = at(state.player); const above = at(state.player, 1);
	const scale = Math.hypot(above.x - ground.x, above.y - ground.y);
	const minimumText = options.couchMode ? 16 : width > 700 ? 13 : 11;
	const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, Math.max(width, height) * 0.7);
	vignette.addColorStop(0, '#07141900'); vignette.addColorStop(1, '#0714198c'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, width, height);
	if ((options.armorHit ?? 0) > 0) {
		ctx.save(); ctx.globalAlpha = Math.min(0.55, options.armorHit ?? 0);
		ctx.strokeStyle = '#ff9b7a'; ctx.lineWidth = 7;
		ctx.strokeRect(2, 2, width - 4, height - 4); ctx.restore();
	}
	const text = function (content: string, point: Point, elevation: number, color: string, size = 10, offsetY = 0) {
		const anchor = at(point, elevation);
		const fontSize = Math.max(minimumText, size * scale); const y = anchor.y + offsetY * scale;
		ctx.font = `600 ${fontSize}px monospace`; ctx.textAlign = 'center';
		const length = ctx.measureText(content).width;
		ctx.fillStyle = '#0b171cdb'; ctx.fillRect(anchor.x - length / 2 - 4, y - fontSize, length + 8, fontSize + 5);
		ctx.fillStyle = color; ctx.fillText(content, anchor.x, y);
	};
	const mission = state.mission; const navigation = missionNavigation(state);
	const relay = mission?.map.objective ?? { x: ARENA.relayX, y: ARENA.relayY };
	const showRelay = !mission || mission.contract.kind === 'defend';
	if (showRelay) text((options.relayHit ?? 0) > 0 ? 'UPLINK UNDER FIRE' : mission ? 'DEFEND UPLINK' : 'UPLINK / 09', relay, 206, (options.relayHit ?? 0) > 0 || state.relay < 30 ? '#ffac83' : '#aee2d5', 10);
	if ((options.armorHit ?? 0) > 0) {
		const elevation = options.armorHitHeight ?? 124;
		// Taller frames can fill the view when zoomed in. Keep the entire
		// feedback label on screen even when its model-relative anchor cannot.
		const inset = Math.max(minimumText, 12 * scale) + 6;
		const offset = options.armorHitHeight === undefined ? 0 : Math.max(0, inset - at(state.player, elevation).y) / scale;
		text('ARMOR HIT', state.player, elevation, '#ffb697', 12, offset);
	}
	if (showRelay) {
		const relayLabel = at(relay, 196);
		ctx.fillStyle = '#112329dd'; ctx.fillRect(relayLabel.x - 31, relayLabel.y, 62, 3);
		ctx.fillStyle = state.relay < 30 ? '#f49769' : '#9bccbc'; ctx.fillRect(relayLabel.x - 31, relayLabel.y, 62 * state.relay / 100, 3);
	}
	const drawTargetReticle = function (target: Point, id: number, elevation: number, targetWidth: number, targetHeight: number) {
		const anchor = at(target, elevation);
		const tracking = missileTracking(state, id);
		const guided = tracking !== 'NO GUIDANCE';
		const lock = state.player.missileLock;
		const progress = lock?.targetId === id ? Math.max(0, Math.min(1, lock.progress)) : 0;
		const locked = guided && tracking === 'TRACKING' && progress >= 1 - 1e-9;
		ctx.strokeStyle = guided ? '#91ada480' : '#f3c37d'; ctx.lineWidth = 1.5;
		bracket(ctx, anchor.x, anchor.y, targetWidth, targetHeight, 10);
		if (!guided) return { locked, guided, labelOffset: targetHeight / 2 + 11 * scale };
		const radius = Math.max(targetWidth, targetHeight) * 0.85 * (1.35 - 0.35 * progress);
		ctx.strokeStyle = locked ? '#ff6863' : '#f3c37d'; ctx.lineWidth = options.couchMode ? 2.5 : 2;
		ctx.beginPath();
		if (locked) {
			ctx.moveTo(anchor.x, anchor.y - radius); ctx.lineTo(anchor.x + radius, anchor.y);
			ctx.lineTo(anchor.x, anchor.y + radius); ctx.lineTo(anchor.x - radius, anchor.y); ctx.closePath();
			ctx.moveTo(anchor.x + radius + 5, anchor.y); ctx.lineTo(anchor.x + radius + 13, anchor.y);
			ctx.moveTo(anchor.x - radius - 5, anchor.y); ctx.lineTo(anchor.x - radius - 13, anchor.y);
		} else {
			// Invalid tracking must open the diamond immediately, including during grace.
			const closure = 0.15 + 0.85 * (tracking === 'TRACKING' ? progress : Math.min(progress, 0.88));
			for (let corner = 0; corner < 4; corner++) {
				const angle = corner * Math.PI / 2 - Math.PI / 2;
				const tip = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
				const previous = { x: Math.cos(angle - Math.PI / 2) * radius, y: Math.sin(angle - Math.PI / 2) * radius };
				const next = { x: Math.cos(angle + Math.PI / 2) * radius, y: Math.sin(angle + Math.PI / 2) * radius };
				ctx.moveTo(anchor.x + tip.x + (previous.x - tip.x) * closure / 2, anchor.y + tip.y + (previous.y - tip.y) * closure / 2);
				ctx.lineTo(anchor.x + tip.x, anchor.y + tip.y);
				ctx.lineTo(anchor.x + tip.x + (next.x - tip.x) * closure / 2, anchor.y + tip.y + (next.y - tip.y) * closure / 2);
			}
		}
		ctx.stroke();
		return { locked, guided, labelOffset: radius + minimumText + 6 };
	};
	const structures = missionStructures(mission);
	const selectedStructure = structures.find(function (target) { return target.body.hp > 0 && target.id === state.player.targetId; });
	const selectedFacility = selectedStructure?.body;
	const selected = state.enemies.find(function (enemy) { return enemy.hp > 0 && enemy.id === state.player.targetId; });
	const selectedSize = (selected?.commander ? 90 : 74) * scale;
	const selectedReticle = selected ? drawTargetReticle(selected, selected.id, ENEMY_STATS[selected.kind].elevation, selectedSize, selectedSize) : undefined;
	const facilityReticle = selectedFacility && selectedStructure ? drawTargetReticle(selectedFacility, selectedStructure.id, 45, 130 * scale, 110 * scale) : undefined;
	for (const [index, { id, body: facility }] of structures.entries()) {
		const labelHeight = id === selectedStructure?.id && facilityReticle?.guided ? Math.max(124, 45 + facilityReticle.labelOffset / scale) : 124;
		text(facility.hp > 0 ? `${mission?.contract.kind === 'raid' ? `RAID SITE ${index + 1}` : 'TARGET FACILITY'} / ${Math.ceil(facility.hp / facility.maxHp * 100)}%` : 'FACILITY DESTROYED', facility, labelHeight, facility.hp > 0 ? '#ffd199' : '#a5b6ac', 11);
		const label = at(facility, labelHeight - 10);
		ctx.fillStyle = '#112329dd'; ctx.fillRect(label.x - 42, label.y, 84, 4);
		ctx.fillStyle = '#e5a778'; ctx.fillRect(label.x - 42, label.y, 84 * Math.max(0, facility.hp / facility.maxHp), 4);
	}
	for (const [index, site] of (mission?.captureSites ?? []).entries()) {
		const duration = mission?.contract.kind === 'recovery' ? RECOVERY_SECONDS : BEACON_SECONDS;
		const label = mission?.contract.kind === 'recovery' ? 'DATA CACHE' : `BEACON ${index + 1}`;
		text(site.complete ? `${label} / ${mission?.contract.kind === 'recovery' ? 'RECOVERED' : 'ACTIVE'}` : `${label} / ${site.holdTime > 0 ? `HOLD ${(duration - site.holdTime).toFixed(1)}s` : 'ENTER ZONE'}`, site, 90, site.complete ? '#b9f5ca' : '#ffd199', 11);
	}
	if (mission?.stage === 'extract') {
		const remaining = Math.max(0, EXTRACTION_SECONDS - mission.extractTime);
		const outside = distance(state.player, mission.map.extraction) > EXTRACTION_RADIUS;
		const label = mission.extractTime === 0 ? 'EXTRACTION / ENTER THE GREEN ZONE'
			: outside ? remaining === 0 ? 'PICKUP READY / ENTER THE ZONE' : `SQUAD HOLDING ${remaining.toFixed(1)}s / ENTER THE ZONE`
				: `LIFT IN ${remaining.toFixed(1)}s · HOLD POSITION`;
		text(label, mission.map.extraction, 40, '#b9f5ca', 12);
	}
	for (const warning of state.warnings) text(warning.commander ? 'COMMAND SIGNAL' : `INBOUND ${warning.kind.toUpperCase()}`, warning, 10, '#f3bd80', 10, -20);
	for (const [index, strike] of state.strikes.entries()) {
		if (state.strikes.some(function (other, otherIndex) { return otherIndex !== index && distance(other, strike) < 12 && (other.life < strike.life || other.life === strike.life && otherIndex < index); })) continue;
		text(`IMPACT ${strike.life.toFixed(1)}`, strike, 8, '#ffd2a6', 11, -14);
	}
	for (const enemy of state.enemies) {
		const defense = getEnemyDefense(state, enemy);
		if (enemy.hp >= enemy.maxHp && enemy !== selected && !isPriorityTarget(state, enemy) && !defense.exposed) continue;
		const vehicle = enemy.kind === 'tank' || enemy.kind === 'helicopter' || enemy.kind === 'vtol';
		const modelLabelHeight = options.enemyLabelHeights?.get(enemy.id) ?? (vehicle ? ENEMY_STATS[enemy.kind].elevation + 38 : (enemy.commander ? 152 : enemy.kind === 'siege' ? 126 : 112) * mechScale(enemy.kind));
		const labelHeight = enemy === selected && selectedReticle?.guided ? Math.max(modelLabelHeight, ENEMY_STATS[enemy.kind].elevation + selectedReticle.labelOffset / scale) : modelLabelHeight;
		const anchor = at(enemy, labelHeight);
		const barWidth = isPriorityTarget(state, enemy) ? options.couchMode ? 100 : 76 : options.couchMode ? 56 : 42;
		ctx.fillStyle = '#0a151be6'; ctx.fillRect(anchor.x - barWidth / 2 - 1, anchor.y - 1, barWidth + 2, 5);
		ctx.fillStyle = isPriorityTarget(state, enemy) ? '#f3ad7e' : '#dfaa82'; ctx.fillRect(anchor.x - barWidth / 2, anchor.y, barWidth * Math.max(0, enemy.hp) / enemy.maxHp, 3);
		if (isPriorityTarget(state, enemy)) text(mission ? defense.enraged ? 'PRIORITY / OVERDRIVE' : 'PRIORITY TARGET' : defense.enraged ? 'IRON CROWN / OVERDRIVE' : 'IRON CROWN', enemy, labelHeight, '#ffd5a5', 11, -(minimumText + 6) / scale);
		if (enemy.attack) {
			const label = defense.exposed ? `EXPOSED ${enemy.attack.remaining.toFixed(1)}s` : 'BARRAGE COMMITTED';
			text(label, enemy, labelHeight, defense.exposed ? '#adf7d7' : '#ffd5a5', 11, -(enemy.commander ? minimumText * 2 + 15 : minimumText + 6) / scale);
		}
	}
	for (const mate of state.squadmates) {
		const heightAboveRig = options.squadmateLabelHeights?.get(mate.pilotId);
		if (heightAboveRig === undefined) continue;
		const anchor = at(mate, heightAboveRig);
		if (anchor.x < 0 || anchor.x > width || anchor.y < 0 || anchor.y > height) continue;
		if (options.obstructions?.some(function (rect) { return anchor.x >= rect.left && anchor.x <= rect.right && anchor.y >= rect.top && anchor.y <= rect.bottom; })) continue;
		const active = mate.hp > 0;
		text(`${mate.callsign.toUpperCase()}${active ? '' : ' / OFFLINE'}`, mate, heightAboveRig, active ? '#84e3eb' : '#a8bcc0', 9);
	}
	if (selected && selectedReticle) {
		const elevation = ENEMY_STATS[selected.kind].elevation;
		const reticle = selectedReticle;
		const solution = targetSolution(state, selected, aim);
		const defense = getEnemyDefense(state, selected);
		const role = isPriorityTarget(state, selected) ? 'PRIORITY TARGET' : selected.kind === 'tank' ? 'TANK / FLANK ARMOR' : selected.kind === 'siege' ? defense.exposed ? 'SIEGE / EXPOSED' : 'SIEGE / FLANK ARMOR' : selected.kind.toUpperCase();
		text(role, selected, elevation, '#ffe1aa', 10, reticle.labelOffset / scale);
		text(`${Math.round(distance(selected, state.player))} M / ${getWeaponFeedback(state, selected, selected.id)}`, selected, elevation, reticle.locked ? '#ff6863' : solution.inRange ? '#ebc184' : '#98a8a7', 8, (reticle.labelOffset + minimumText + 7) / scale);
	}
	if (selectedFacility && selectedStructure && facilityReticle) {
		const reticle = facilityReticle;
		text(`${Math.round(distance(selectedFacility, state.player))} M / ${getWeaponFeedback(state, selectedFacility, selectedStructure.id)}`, selectedFacility, 45, reticle.locked ? '#ff6863' : '#ebc184', 10, reticle.labelOffset / scale);
	}
	// A precise sight remains useful when aiming ahead of a moving contact.
	const cursor = at(aim, 0);
	if (!selected && !selectedFacility && !inFiringArc(state.player, state.player.angle, aim)) text('OUT OF ARC', aim, 0, '#ffd199', 10, 24);
	ctx.strokeStyle = selected || selectedFacility ? '#f6c77c' : '#d9e5d1'; ctx.lineWidth = 1;
	bracket(ctx, cursor.x, cursor.y, 15, 15, 4);
	ctx.fillStyle = '#f1e9c7'; ctx.fillRect(cursor.x - 1, cursor.y - 1, 2, 2);
	const marker = function (point: Point, color: string, label?: string) {
		const edge = edgeMarker(at(point, 40), width, height, options.obstructions); if (!edge) return;
		ctx.save(); ctx.translate(edge.point.x, edge.point.y); ctx.rotate(edge.angle);
		ctx.fillStyle = '#0b1c23dd'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -4); ctx.lineTo(-2, 0); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.restore();
		if (label) {
			ctx.font = `${minimumText}px monospace`; ctx.textAlign = 'center'; const half = ctx.measureText(label).width / 2;
			const labelY = edge.point.y + 26;
			const candidates = [edge.point.x, ...(options.obstructions ?? []).flatMap(function (rect) { return [rect.left - half - 8, rect.right + half + 8]; })];
			const labelX = candidates.map(function (x) { return Math.max(half + 8, Math.min(width - half - 8, x)); }).find(function (x) {
				return !(options.obstructions ?? []).some(function (rect) { return x + half + 3 > rect.left && x - half - 3 < rect.right && labelY + 5 > rect.top && labelY - minimumText < rect.bottom; });
			});
			if (labelX === undefined) return;
			ctx.fillStyle = '#0b1c23ed'; ctx.fillRect(labelX - half - 3, edge.point.y + 13, half * 2 + 6, minimumText + 5);
			ctx.fillStyle = color; ctx.fillText(label, labelX, edge.point.y + 26);
		}
	};
	for (const enemy of state.enemies) marker(enemy, isPriorityTarget(state, enemy) ? '#ffd3a3' : '#eead7c');
	for (const warning of state.warnings) marker(warning, '#d29b66');
	if (navigation) marker(navigation.point, navigation.color, `${navigation.label} ${Math.round(distance(navigation.point, state.player))} M`);
	else marker(relay, '#a3ddd0', 'UPLINK');
	if (options.showRadar) {
		const w = options.couchMode ? 208 : 174; const h = options.couchMode ? 136 : 116; const x = width - w - 26; const y = 112;
		ctx.fillStyle = '#0c1c22e6'; ctx.fillRect(x - 1, y - 24, w + 2, h + 49);
		ctx.strokeStyle = '#91ada445'; ctx.lineWidth = 1; ctx.strokeRect(x - 1, y - 24, w + 2, h + 49);
		ctx.strokeStyle = '#8fa39c30'; ctx.strokeRect(x + 6, y + 4, w - 12, h - 8);
		ctx.font = `600 ${options.couchMode ? 14 : 11}px monospace`; ctx.textAlign = 'left'; ctx.fillStyle = '#c5d0bc'; ctx.fillText('TACTICAL', x + 9, y - 8);
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
			const cut = RADAR_CUT_COLORS[mission.map.biome];
			for (const obstacle of mission.map.terrain.obstacles) {
				const corner = point({ x: obstacle.x - obstacle.width / 2, y: obstacle.y - obstacle.depth / 2 });
				const dw = obstacle.width * w / bounds.width, dh = obstacle.depth * h / bounds.height;
				ctx.fillStyle = obstacle.kind === 'fissure' ? cut[0] : obstacle.kind === 'tree' ? '#496b62' : '#899190';
				ctx.strokeStyle = obstacle.kind === 'fissure' ? cut[1] : obstacle.kind === 'tree' ? '#83ac96' : '#b3bfbb';
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
		if (showRelay) dot(relay, '#91c5b8', 4, true);
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
		for (const enemy of state.enemies) dot(enemy, isPriorityTarget(state, enemy) ? '#ffd6a7' : ENEMY_STATS[enemy.kind].elevation > 42 ? '#8fd6da' : '#f2a571', isPriorityTarget(state, enemy) ? 4 : enemy.heavy ? 3 : 2, ENEMY_STATS[enemy.kind].elevation > 42);
		for (const warning of state.warnings) dot(warning, '#e5a46f', 4, true);
		for (const strike of state.strikes) dot(strike, '#ff8154', strike.radius / bounds.width * w, true);
		ctx.restore();
		ctx.font = `${options.couchMode ? 14 : 11}px monospace`; ctx.textAlign = 'left'; ctx.fillStyle = '#91a9a3'; ctx.fillText(`${state.enemies.length.toString().padStart(2, '0')} CONTACTS`, x + 9, y + h + 15);
	}
	ctx.restore();
};
