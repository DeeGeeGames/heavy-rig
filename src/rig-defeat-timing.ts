export const RIG_LEG_RELEASE_SECONDS = 0.5;
export const RIG_FOLD_SECONDS = 1.25;

// Keep the wreck in the detailed view until the last burst's smoke has cleared.
export const RIG_DEFEAT_SECONDS = 2.5;

export const RIG_ARMOR_BURSTS = [
	{ at: 0.10, part: 'chest', rate: 1.32, left: 0.74, right: 0.82 },
	{ at: 10 / 30, part: 'gun', rate: 1.58, left: 0.46, right: 0.52 },
	{ at: 0.60, part: 'shoulder', rate: 0.91, left: 1.07, right: 0.99 },
	{ at: 28 / 30, part: 'opposite-shoulder', rate: 1.18, left: 0.73, right: 0.63 },
	{ at: 1.40, part: 'hull', rate: 1.05, left: 0.68, right: 0.67 },
] as const;
