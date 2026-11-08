import { expect, test } from 'bun:test';
import { createCleanupOwner } from '../src/shared/lifecycle';

test('partial initialization releases every owned resource once despite a failed disposer', async function () {
	const owner = createCleanupOwner();
	const released: string[] = [];
	owner.add(function () { released.push('renderer'); });
	owner.add(async function () { await Promise.resolve(); released.push('world'); throw new Error('world failed'); });
	owner.add(function () { released.push('listeners'); });
	const first = owner.dispose();
	expect(owner.dispose()).toBe(first);
	await expect(first).rejects.toBeInstanceOf(AggregateError);
	expect(released).toEqual(['listeners', 'world', 'renderer']);
	await expect(owner.dispose()).rejects.toBeInstanceOf(AggregateError);
	expect(released).toHaveLength(3);
});
