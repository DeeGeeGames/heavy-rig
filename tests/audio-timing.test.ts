import { expect, test } from 'bun:test';
import { firingReportTime, reserveImpactOnsets, type FireReport } from '../src/audio-timing';

test('every warhead gets a distinct onset across dual launches and fixed steps sharing an audio frame', function () {
	for (const batches of [[8], [12], [2, 2, 2]]) {
		const now = 0.15;
		const onsets: number[] = []; let next = 0;
		for (const contacts of batches) {
			const { first, count, spacing } = reserveImpactOnsets(now, next, contacts);
			for (let i = 0; i < count; i++) onsets.push(first + i * spacing);
			next = first + count * spacing;
		}
		expect(onsets).toHaveLength(batches.reduce(function (sum, value) { return sum + value; }, 0));
		expect(onsets.every(function (at, i) { return at > (onsets[i - 1] ?? 0); })).toBe(true);
		expect(next).toBeLessThan(now + 0.35);
	}
});

test('a six-round pod keeps its five-tick launch spacing across 30 Hz audio updates', function () {
	let previous: FireReport | undefined;
	for (let i = 0; i < 6; i++) {
		const time = i * 5 / 60;
		const now = Math.floor(time * 30) / 30;
		const onset = firingReportTime(now, time, previous);
		expect(onset).toBeCloseTo(time, 6);
		previous = { time, onset };
	}
});
