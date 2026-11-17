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
	readonly readyIn: number;
	readonly overheated: boolean;
	readonly angle: number;
	readonly target: 'player' | 'relay';
	readonly at: Point;
	readonly squad?: SquadOrder;
	readonly tactics?: EnemyTactics;
}

const ADVANCE_SECONDS = 3;
const ENGAGE_SECONDS = 3;
const RECOVERY_SECONDS = 2;
const CAUTION_SECONDS = 6;
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

// Retreat to one nearby point, then stand and fight. Damage cannot keep extending
// the withdrawal, and a grace period prevents a close player from causing a chase.
const recovery = function (enemy: TacticalCandidate, state: EnemyTactics, withdraw: boolean, bounds: { width: number; height: number }): EnemyTactics {
	const bearing = distance(enemy, enemy.at) > 1 ? Math.atan2(enemy.y - enemy.at.y, enemy.x - enemy.at.x) : enemy.angle + Math.PI;
	const travel = withdraw ? Math.min(70, enemy.range * 0.2) : 0;
	const destination = clampPoint({ x: enemy.x + Math.cos(bearing) * travel, y: enemy.y + Math.sin(bearing) * travel }, bounds);
	return { ...state, phase: 'recover', remaining: RECOVERY_SECONDS, destination, pressure: 0, cautionIn: withdraw ? CAUTION_SECONDS : state.cautionIn };
};

// Plan before movement so allocation does not depend on collection/query order.
// Only an advance follows a position around the target, and that point is frozen
// for the whole maneuver. Engage/recover never chase a moving target.
export const planGroundTactics = function (candidates: readonly TacticalCandidate[], bounds: { width: number; height: number }, dt: number): ReadonlyMap<number, EnemyTactics> {
	const plans = new Map<number, EnemyTactics>();
	const waiting: TacticalCandidate[] = [];
	const advancing = new Set<number>();
	const sorted = [...candidates].sort(function (a, b) { return a.id - b.id; });
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
		const pressured = state.cautionIn <= 0 && (state.pressure >= enemy.maxHp * 0.08 || separation < enemy.range * 0.55);
		// Once inside the firing band, hold during a long reload. Distant
		// approaches continue so reinforcements do not stall outside the fight.
		const reloading = enemy.readyIn > 0.75 && separation <= enemy.range * 0.95;
		if (state.phase === 'recover') {
			plans.set(enemy.id, state.remaining > 0 ? state : { ...state, phase: 'engage', remaining: ENGAGE_SECONDS, destination: position(enemy) });
			continue;
		}
		if (pressured || enemy.overheated || state.phase === 'advance' && reloading) {
			plans.set(enemy.id, recovery(enemy, state, pressured, bounds));
			continue;
		}
		if (state.phase === 'advance') {
			const group = enemy.squad?.id ?? enemy.id;
			const near = separation <= enemy.range + 160 + enemy.speed * dt;
			if (state.remaining <= 0 || distance(enemy, state.destination) <= 12) {
				plans.set(enemy.id, { ...state, phase: 'engage', remaining: near ? ENGAGE_SECONDS : 0, destination: position(enemy) });
			} else if (near && advancing.has(group)) {
				plans.set(enemy.id, { ...state, phase: 'engage', remaining: 0, destination: position(enemy) });
			} else {
				plans.set(enemy.id, state); if (near) advancing.add(group);
			}
			continue;
		}
		if (state.remaining > 0) { plans.set(enemy.id, state); continue; }
		const destination = firingPosition(enemy, bounds);
		if (distance(enemy, destination) <= 35 || separation <= enemy.range && !enemy.squad) {
			plans.set(enemy.id, recovery(enemy, state, false, bounds));
			continue;
		}
		plans.set(enemy.id, state);
		if (!reloading) waiting.push(enemy);
	}
	for (const enemy of waiting) {
		const group = enemy.squad?.id ?? enemy.id;
		const state = plans.get(enemy.id);
		const near = distance(enemy, enemy.at) <= enemy.range + 160 + enemy.speed * dt;
		// Travel to the battle together; only the final advance is rationed.
		if (!state || near && advancing.has(group)) continue;
		const destination = firingPosition(enemy, bounds);
		plans.set(enemy.id, { ...state, phase: 'advance', remaining: ADVANCE_SECONDS, destination });
		if (near) advancing.add(group);
	}
	return plans;
};
