import type { Point } from './simulation';

export interface SquadOrder {
	readonly id: number;
	readonly slot: 'center' | 'left' | 'right';
	readonly target: 'player' | 'relay';
	readonly reconsiderIn: number;
	readonly bearing: number;
}
export interface SquadCandidate extends Point {
	readonly id: number;
	readonly aggro: number;
	readonly order?: SquadOrder;
}

const JOIN_DISTANCE = 520;
const TARGET_COMMITMENT = 3;
const slots = ['center', 'left', 'right'] as const;
const distance = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };

// Plan from a snapshot before anybody moves. Orders live on the enemy component;
// there is no leader entity, global registry, or membership to clean up on death.
export const planSquads = function (candidates: readonly SquadCandidate[], player: Point, relay: Point | undefined, dt: number): ReadonlyMap<number, SquadOrder> {
	const orders = new Map<number, SquadOrder>();
	const assigned = new Set<number>();
	const sorted = [...candidates].sort(function (a, b) { return a.id - b.id; });
	const assign = function (members: readonly SquadCandidate[], previous?: SquadOrder) {
		const first = members[0];
		if (!first || members.length < 2) return;
		const reconsiderIn = Math.max(0, (previous?.reconsiderIn ?? 0) - dt);
		const preferredTarget = !relay || members.some(function (member) { return distance(member, player) < member.aggro; }) ? 'player' : 'relay';
		const target = previous && reconsiderIn > 0 && relay ? previous.target : preferredTarget;
		const at = target === 'relay' && relay ? relay : player;
		const center = members.reduce(function (sum, member) { return { x: sum.x + member.x / members.length, y: sum.y + member.y / members.length }; }, { x: 0, y: 0 });
		const bearing = previous?.target === target ? previous.bearing : Math.atan2(center.y - at.y, center.x - at.x);
		members.forEach(function (member, index) {
			const slot = previous ? member.order?.slot : slots[index];
			if (!slot) return;
			orders.set(member.id, { id: previous?.id ?? first.id, slot, target, bearing, reconsiderIn: reconsiderIn > 0 ? reconsiderIn : TARGET_COMMITMENT });
			assigned.add(member.id);
		});
	};
	// Keep surviving pairs and their original slots. A lone survivor immediately
	// falls back to individual AI; other nearby unassigned units can form a group.
	const existing = new Map<number, SquadCandidate[]>();
	for (const candidate of sorted) {
		if (!candidate.order) continue;
		const members = existing.get(candidate.order.id) ?? [];
		members.push(candidate); existing.set(candidate.order.id, members);
	}
	for (const members of existing.values()) assign(members, members[0]?.order);
	for (const candidate of sorted) {
		if (assigned.has(candidate.id)) continue;
		const nearby = sorted.filter(function (other) { return other.id !== candidate.id && !assigned.has(other.id) && distance(candidate, other) <= JOIN_DISTANCE; })
			.sort(function (a, b) { return distance(candidate, a) - distance(candidate, b) || a.id - b.id; });
		assign([candidate, ...nearby.slice(0, 2)]);
	}
	return orders;
};

export const squadApproach = function (enemy: Point, order: SquadOrder, target: Point, range: number, bounds: { width: number; height: number }): Point {
	// Rotate the whole approach inward when either flank would lose its standoff
	// at a wall. Use the same radius for both chassis so their slots stay distinct.
	const flankRadius = 240 * 0.85;
	const clampX = function (x: number) { return Math.max(35, Math.min(bounds.width - 35, x)); };
	const clampY = function (y: number) { return Math.max(35, Math.min(bounds.height - 35, y)); };
	const cramped = [-0.75, 0.75].some(function (offset) {
		const x = target.x + Math.cos(order.bearing + offset) * flankRadius;
		const y = target.y + Math.sin(order.bearing + offset) * flankRadius;
		return clampX(x) !== x || clampY(y) !== y;
	});
	const approachBearing = cramped ? Math.atan2(bounds.height / 2 - target.y, bounds.width / 2 - target.x) : order.bearing;
	const bearing = approachBearing + (order.slot === 'left' ? -0.75 : order.slot === 'right' ? 0.75 : 0);
	const radius = range * 0.85;
	const destination = {
		x: clampX(target.x + Math.cos(bearing) * radius),
		y: clampY(target.y + Math.sin(bearing) * radius),
	};
	// The center unit presses directly. Flankers spread even after entering range.
	return order.slot === 'center' ? distance(enemy, target) > range ? target : enemy : destination;
};
