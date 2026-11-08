import { expect, test } from 'bun:test';
import { createRuntimeInput } from '../src/runtime-input';
import type { Controls } from '../src/simulation';

const neutral: Controls = { drive: 0, stop: false, turn: 0, aim: { x: 900, y: 450 }, fire: [false, false, false, false], coolant: false };

test('a frame-only trigger survives until a fixed step and is consumed once', function () {
	const input = createRuntimeInput();
	input.sample({ ...neutral, fire: [true, false, true, false], coolant: true, stop: true });
	input.sample(neutral);
	const first = input.consume(neutral);
	expect(first.fire).toEqual([true, false, true, false]);
	expect(first.coolant).toBe(true);
	expect(first.stop).toBe(true);
	expect(input.consume(neutral)).toEqual(neutral);
});

test('held controls remain available to multiple fixed steps and transitions discard stale presses', function () {
	const input = createRuntimeInput();
	const held: Controls = { ...neutral, drive: 1, fire: [false, true, false, true], coolant: true };
	input.sample(held);
	expect(input.consume(held)).toEqual(held);
	expect(input.consume(held)).toEqual(held);
	input.sample(held);
	input.clear();
	expect(input.consume(neutral)).toEqual(neutral);
});
