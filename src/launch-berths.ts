export const cabinBeam = 1.47;
export const rampFrameHalfWidth = 106;
export const DROPSHIP_DECK = { height: 30, hinge: 205, toe: 350, halfWidth: rampFrameHalfWidth * cabinBeam } as const;
export const podCenter = 219;
export const DROPSHIP_WIDTH = 2 * (podCenter + 33);

export interface LaunchBerth {
	readonly x: number;
	readonly z: number;
	readonly exitOrder: number;
}

// Goals are in ship space: +Z points out of the ramp, and X runs across it.
// Keep the result in roster order so both shots show the same pilot in each berth.
export const boardingLayouts = function (goals: readonly { x: number; z: number }[]): LaunchBerth[][] {
	if (goals.length < 1 || goals.length > 4) throw new RangeError('The dropship carries one to four rigs');
	if (goals.length === 1) return [[{ x: 27, z: 110, exitOrder: 0 }]];
	const across = goals.map(function (point, index) { return { ...point, index }; })
		.sort(function (a, b) { return a.x - b.x; });
	const wingmates = across.filter(function (rig) { return rig.index !== 0; })
		.sort(function (a, b) { return b.z - a.z || a.index - b.index; });
	// Try the farthest destination first, then alternatives if a nearer rig
	// would block its path. The commander always takes the last turn.
	const orders: number[][] = [];
	const arrange = function (queue: number[], remaining: readonly number[]) {
		if (remaining.length === 0) { orders.push([...queue, 0]); return; }
		for (const id of remaining) arrange([...queue, id], remaining.filter(function (other) { return other !== id; }));
	};
	arrange([], wingmates.map(function (rig) { return rig.index; }));
	const layouts: LaunchBerth[][] = [];
	// Each lane holds two rigs, so a pair can board on the same side.
	for (let leftCount = Math.max(0, goals.length - 2); leftCount <= Math.min(2, goals.length); leftCount++) {
		const left = across.slice(0, leftCount).map(function (rig) { return rig.index; });
		for (const exits of orders) {
			const berths = goals.map(function (_, index) {
				const port = left.includes(index), exitOrder = exits.indexOf(index);
				const ahead = exits.slice(0, exitOrder).some(function (other) { return left.includes(other) === port; });
				return { x: port ? -82 : 82, z: index === 0 || ahead ? -25 : 132, exitOrder };
			});
			layouts.push(berths);
		}
	}
	return layouts;
};
