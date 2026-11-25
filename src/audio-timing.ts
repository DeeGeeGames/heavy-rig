export interface FireReport { time: number; onset: number }

// Fixed updates can share one Web Audio clock reading after a slow frame.
// Preserve the simulation's cadence within the game's 100 ms catch-up window.
export const firingReportTime = function (now: number, time: number, previous?: FireReport): number {
	if (!previous || time <= previous.time) return now;
	return Math.max(now, Math.min(now + 0.1, previous.onset + Math.min(0.1, time - previous.time)));
};

export const reserveImpactOnsets = function (now: number, next: number, contacts: number) {
	const first = Math.max(now, next);
	const room = now + 0.35 - first;
	const count = Math.min(contacts, 24, Math.max(0, 1 + Math.floor(room / 0.008)));
	const spacing = Math.max(0.008, Math.min(0.022, Math.min(room, 0.22) / Math.max(1, count - 1)));
	return { first, count, spacing };
};
