import { expect, test } from 'bun:test';
import { parseCandidateBudget, verifyCandidateBudget, type CandidateCosts } from '../scripts/mech-design/candidate-budget';

const selected: CandidateCosts = { triangles: 39748, meshSections: 16, materials: 3, geometryBufferBytes: 986040, bytes: 1036424 };
const budget = parseCandidateBudget({ schemaVersion: 1, chassis: 'warden', rationale: 'Do not increase selected costs during this experiment.', maximum: selected });

test('candidate optimization may reduce all costs without matching the selected checkpoint', function () {
	expect(function () { verifyCandidateBudget({ triangles: 32000, meshSections: 12, materials: 2, geometryBufferBytes: 800000, bytes: 900000 }, budget, 'warden'); }).not.toThrow();
	expect(function () { verifyCandidateBudget(selected, budget, 'warden'); }).not.toThrow();
});

test('candidate budget rejects expensive, empty, malformed and wrong-chassis assets', function () {
	for (const key of ['triangles', 'meshSections', 'materials', 'geometryBufferBytes', 'bytes'] as const) {
		expect(function () { verifyCandidateBudget({ ...selected, [key]: selected[key] + 1 }, budget, 'warden'); }).toThrow(`exceeds budget ${selected[key]}`);
		expect(function () { verifyCandidateBudget({ ...selected, [key]: 0 }, budget, 'warden'); }).toThrow(`Invalid candidate ${key}`);
	}
	expect(function () { verifyCandidateBudget(selected, budget, 'maul'); }).toThrow('expected maul');
	expect(function () { parseCandidateBudget({ ...budget, maximum: { ...selected, triangles: '40000' } }); }).toThrow('positive integer');
	expect(function () { parseCandidateBudget({ ...budget, maximum: { triangles: 40000 } }); }).toThrow('maximum.meshSections');
	expect(function () { parseCandidateBudget({ ...budget, rationale: '' }); }).toThrow('rationale');
});
