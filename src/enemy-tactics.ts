import { squadApproach, type SquadOrder } from './enemy-squads';
import type { Point } from './simulation';

export interface EnemyTactics {
	readonly phase: 'advance' | 'engage' | 'recover';
	readonly remaining: number;
	readonly destination: Point;
	readonly target: 'player' | 'relay';
	readonly lastHp: number;
	readonly pressure: number;
	readonly cautionIn: number;
}
export interface TacticalCandidate extends Point {
	readonly id: number;
	readonly hp: number;
	readonly maxHp: number;
	readonly range: number;
	readonly speed: number;
	readonly overheated: boolean;
	readonly angle: number;
	readonly target: 'player' | 'relay';
	readonly at: Point;
	readonly squad?: SquadOrder;
	readonly tactics?: EnemyTactics;
}

interface GroundContact extends Point { readonly id: number }

const ADVANCE_SECONDS = 3;
const ENGAGE_SECONDS = 3;
const RECOVERY_SECONDS = 2;
const CAUTION_SECONDS = 6;
const FIRING_SPACING = 80;
export const ENEMY_FIRING_MARGIN = 50;
const distance = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
const position = function (at: Point): Point { return { x: at.x, y: at.y }; };
const clampPoint = function (at: Point, bounds: { width: number; height: number }): Point {
	return { x: Math.max(35, Math.min(bounds.width - 35, at.x)), y: Math.max(35, Math.min(bounds.height - 35, at.y)) };
};
const firingPosition = function (enemy: TacticalCandidate, bounds: { width: number; height: number }): Point {
	if (enemy.squad) return squadApproach(enemy, enemy.squad, enemy.at, enemy.range, bounds);
	const bearing = Math.atan2(enemy.y - enemy.at.y, enemy.x - enemy.at.x);
	return clampPoint({ x: enemy.at.x + Math.cos(bearing) * enemy.range * 0.85, y: enemy.at.y + Math.sin(bearing) * enemy.range * 0.85 }, bounds);
};

const recoveryPosition = function (enemy: TacticalCandidate, crowded: boolean, bounds: { width: number; height: number }, vacant: (at: Point) => boolean): Point | undefined {
	const separation = distance(enemy, enemy.at);
	const bearing = separation > 1 ? Math.atan2(enemy.y - enemy.at.y, enemy.x - enemy.at.x) : enemy.angle + Math.PI;
	const close = separation < enemy.range * 0.55;
	const limit = Math.max(separation, enemy.range + ENEMY_FIRING_MARGIN - 1);
	const travel = crowded ? 100 : Math.min(70, enemy.range * 0.2);
	const side = enemy.id % 2 === 0 ? 1 : -1;
	const offsets = close
		? [0, side * Math.PI / 4, -side * Math.PI / 4, side * Math.PI / 2, -side * Math.PI / 2]
		: [side * Math.PI / 2, -side * Math.PI / 2, side * Math.PI / 4, -side * Math.PI / 4];
	if (crowded) offsets.push(side * Math.PI * 0.75, -side * Math.PI * 0.75);
	return offsets.map(function (offset) {
		const heading = bearing + offset;
		const at = clampPoint({ x: enemy.x + Math.cos(heading) * travel, y: enemy.y + Math.sin(heading) * travel }, bounds);
		const radius = distance(at, enemy.at);
		if (radius <= limit) return at;
		return { x: enemy.at.x + (at.x - enemy.at.x) * limit / radius, y: enemy.at.y + (at.y - enemy.at.y) * limit / radius };
	}).find(function (at) { return distance(at, enemy) > 12 && vacant(at); });
};

// Plan before movement so allocation does not depend on collection/query order.
export const planGroundTactics = function (candidates: readonly TacticalCandidate[], ground: readonly GroundContact[], bounds: { width: number; height: number }, dt: number): ReadonlyMap<number, EnemyTactics> {
	const plans = new Map<number, EnemyTactics>();
	const waiting: TacticalCandidate[] = [];
	const advancing = new Set<number>();
	const sorted = [...candidates].sort(function (a, b) { return a.id - b.id; });
	const destinations = new Map<number, Point>();
	const repositioning = new Set<number>();
	for (const enemy of sorted) {
		const tactic = enemy.tactics;
		if (!tactic || tactic.target !== enemy.target || tactic.phase === 'engage' || tactic.remaining <= dt || distance(enemy, tactic.destination) <= 12) continue;
		destinations.set(enemy.id, tactic.destination);
		if (tactic.phase === 'recover') repositioning.add(enemy.id);
	}
	const vacant = function (enemy: TacticalCandidate, at: Point) {
		// Leave room for the last 12 m of travel, where the mover comes to a stop.
		const clearance = FIRING_SPACING + 12;
		if (ground.some(function (other) { return other.id !== enemy.id && distance(at, other) < clearance; })) return false;
		for (const [id, destination] of destinations) if (id !== enemy.id && distance(at, destination) < clearance) return false;
		return true;
	};
	for (const enemy of sorted) {
		const previous = enemy.tactics?.target === enemy.target ? enemy.tactics : undefined;
		const separation = distance(enemy, enemy.at);
		const state: EnemyTactics = {
			phase: previous?.phase ?? 'engage',
			remaining: Math.max(0, (previous?.remaining ?? (separation <= enemy.range ? ENGAGE_SECONDS : 0)) - dt),
			destination: previous?.destination ?? position(enemy), target: enemy.target, lastHp: enemy.hp,
			pressure: Math.max(0, (previous?.pressure ?? 0) - enemy.maxHp * 0.035 * dt) + Math.max(0, (previous?.lastHp ?? enemy.hp) - enemy.hp),
			cautionIn: Math.max(0, (previous?.cautionIn ?? 0) - dt),
		};
		if (state.phase === 'recover') {
			plans.set(enemy.id, state.remaining > 0 ? state : { ...state, phase: 'engage', remaining: ENGAGE_SECONDS, destination: position(enemy) });
			continue;
		}
		const pressured = state.cautionIn <= 0 && (state.pressure >= enemy.maxHp * 0.08 || separation < enemy.range * 0.55);
		const neighbors = pressured || state.phase === 'engage' && separation <= enemy.range + ENEMY_FIRING_MARGIN
			? ground.filter(function (other) { return other.id !== enemy.id && distance(enemy, other) < FIRING_SPACING; })
			: [];
		const crowded = neighbors.length > 0;
		const neighborMoving = neighbors.some(function (other) { return repositioning.has(other.id); });
		const step = !neighborMoving && (pressured || crowded && state.phase === 'engage')
			? recoveryPosition(enemy, crowded, bounds, function (at) {
				return vacant(enemy, at) && neighbors.every(function (other) {
					// Leave the cluster without walking through the neighbor.
					return (at.x - enemy.x) * (enemy.x - other.x) + (at.y - enemy.y) * (enemy.y - other.y) >= 0;
				});
			})
			: undefined;
		if (step || enemy.overheated || pressured && state.phase === 'advance' && !neighborMoving) {
			destinations.delete(enemy.id);
			if (step) {
				destinations.set(enemy.id, step);
				repositioning.add(enemy.id);
			}
			plans.set(enemy.id, {
				...state, phase: 'recover', remaining: RECOVERY_SECONDS, destination: step ?? position(enemy),
				pressure: 0, cautionIn: pressured ? CAUTION_SECONDS : state.cautionIn,
			});
			continue;
		}
		if (state.phase === 'advance') {
			const group = enemy.squad?.id ?? enemy.id;
			const near = separation <= enemy.range + 160 + enemy.speed * dt;
			if (state.remaining <= 0 || distance(enemy, state.destination) <= 12) {
				destinations.delete(enemy.id);
				plans.set(enemy.id, { ...state, phase: 'engage', remaining: near ? ENGAGE_SECONDS : 0, destination: position(enemy) });
			} else if (near && advancing.has(group)) {
				destinations.delete(enemy.id);
				plans.set(enemy.id, { ...state, phase: 'engage', remaining: 0, destination: position(enemy) });
			} else {
				plans.set(enemy.id, state); if (near) advancing.add(group);
			}
			continue;
		}
		plans.set(enemy.id, state);
		if (state.remaining <= 0 && (enemy.squad || separation > enemy.range)) waiting.push(enemy);
	}
	for (const enemy of waiting) {
		const group = enemy.squad?.id ?? enemy.id;
		const state = plans.get(enemy.id);
		const near = distance(enemy, enemy.at) <= enemy.range + 160 + enemy.speed * dt;
		// Travel to the battle together; only the final advance is rationed.
		if (!state || near && advancing.has(group)) continue;
		const primary = firingPosition(enemy, bounds);
		if (distance(enemy, primary) <= 35) continue;
		let destination: Point | undefined = primary;
		if (!vacant(enemy, primary)) {
			const bearing = Math.atan2(primary.y - enemy.at.y, primary.x - enemy.at.x);
			const radius = enemy.range * 0.85;
			destination = [-0.4, 0.4, -0.8, 0.8].map(function (offset) {
				return clampPoint({ x: enemy.at.x + Math.cos(bearing + offset) * radius, y: enemy.at.y + Math.sin(bearing + offset) * radius }, bounds);
			}).find(function (at) { return vacant(enemy, at); });
		}
		if (!destination || distance(enemy, destination) <= 35) continue;
		plans.set(enemy.id, { ...state, phase: 'advance', remaining: ADVANCE_SECONDS, destination });
		destinations.set(enemy.id, destination);
		if (near) advancing.add(group);
	}
	return plans;
};
