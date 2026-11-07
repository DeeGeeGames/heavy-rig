export const MOUNTS = [
	{ action: 'mount-0', mouse: 'LEFT', pad: 'RT / R2', key: '1', button: 0 },
	{ action: 'mount-1', mouse: 'RIGHT', pad: 'LT / L2', key: '2', button: 2 },
	{ action: 'mount-2', mouse: 'MIDDLE', pad: 'RB / R1', key: '3', button: 1 },
	{ action: 'mount-3', mouse: 'THUMB', pad: 'LB / L1', key: '4', button: 3 },
] as const;
export const rankLabel = function (level: number) { return ['I', 'II', 'III'][level - 1] ?? 'I'; };
