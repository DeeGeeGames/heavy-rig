/** Candidate limits are an explicit review envelope, not checkpoint equality or runtime acceptance. */
export const candidateCostKeys = ['triangles', 'meshSections', 'materials', 'geometryBufferBytes', 'bytes'] as const;
export type CandidateCosts = Readonly<Record<typeof candidateCostKeys[number], number>>;
export interface CandidateBudget {
	readonly schemaVersion: 1;
	readonly chassis: string;
	readonly rationale: string;
	readonly maximum: CandidateCosts;
}

const object = function (value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const parseCandidateBudget = function (value: unknown): CandidateBudget {
	if (!object(value) || value['schemaVersion'] !== 1 || typeof value['chassis'] !== 'string' || !value['chassis'].trim() || typeof value['rationale'] !== 'string' || !value['rationale'].trim() || !object(value['maximum'])) throw new Error('Invalid candidate budget: expected version, chassis, rationale and maximum costs');
	const maximum = value['maximum'];
	const limit = function (key: typeof candidateCostKeys[number]): number {
		const entry = maximum[key];
		if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry <= 0) throw new Error(`Invalid candidate budget maximum.${key}: expected a positive integer`);
		return entry;
	};
	return {
		schemaVersion: 1, chassis: value['chassis'], rationale: value['rationale'],
		maximum: { triangles: limit('triangles'), meshSections: limit('meshSections'), materials: limit('materials'), geometryBufferBytes: limit('geometryBufferBytes'), bytes: limit('bytes') },
	};
};

export const verifyCandidateBudget = function (costs: CandidateCosts, budget: CandidateBudget, chassis: string): void {
	if (budget.chassis !== chassis) throw new Error(`Candidate budget is for ${budget.chassis}, expected ${chassis}`);
	for (const key of candidateCostKeys) {
		const actual = costs[key];
		if (!Number.isSafeInteger(actual) || actual <= 0) throw new Error(`Invalid candidate ${key}: ${actual}`);
		if (actual > budget.maximum[key]) throw new Error(`Candidate ${key} ${actual} exceeds budget ${budget.maximum[key]}`);
	}
};
