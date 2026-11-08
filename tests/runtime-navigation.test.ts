import { describe, expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { createRuntimeNavigation } from '../src/runtime-navigation';

describe('authoritative runtime navigation', function () {
	test('pause and settings preserve training entities and resume the same screen', async function () {
		const navigation = createRuntimeNavigation();
		const world = ECSpresso.create()
			.withComponentTypes<{ lifetime: number }>()
			.withPlugin(navigation.plugin)
			.withScreens(navigation.screens)
			.build();
		await world.initialize();
		try {
			await navigation.initialize();
			await navigation.setScreen('playing', true);
			const entity = world.spawn({ lifetime: 17 }, { scope: 'training' });
			await navigation.pause();
			await navigation.showAuxiliary('settings');
			expect(world.getCurrentScreen()).toBe('settings');
			expect(navigation.screen).toBe('pause-panel');
			expect(navigation.training).toBe(true);
			expect(world.getResource('$screen').stack.map(function (entry) { return entry.name; })).toEqual(['training', 'pause-panel']);
			expect(world.getComponent(entity.id, 'lifetime')).toBe(17);
			await navigation.closeAuxiliary();
			expect(navigation.screen).toBe('pause-panel');
			await navigation.resume();
			expect(world.getCurrentScreen()).toBe('training');
			expect(navigation.screen).toBe('playing');
			expect(world.getComponent(entity.id, 'lifetime')).toBe(17);
			await navigation.setScreen('bridge');
			expect(world.getEntity(entity.id)).toBeUndefined();
		} finally { await world.dispose(); }
	});

	test('rapid overlay replacement and close requests serialize without stale routing', async function () {
		const navigation = createRuntimeNavigation();
		const world = ECSpresso.create().withPlugin(navigation.plugin).withScreens(navigation.screens).build();
		await world.initialize();
		try {
			await navigation.initialize();
			await navigation.setScreen('mechbay');
			const operations = [navigation.showAuxiliary('settings'), navigation.showAuxiliary('handbook'), navigation.closeAuxiliary()];
			expect(navigation.transitioning).toBe(true);
			await Promise.all(operations);
			expect(navigation.transitioning).toBe(false);
			expect(navigation.screen).toBe('mechbay');
			expect(navigation.auxiliary).toBeUndefined();
			expect(world.getScreenStackDepth()).toBe(0);
		} finally { await world.dispose(); }
	});

	test('shutdown cancels queued transitions and releases subscribers', async function () {
		const navigation = createRuntimeNavigation();
		const world = ECSpresso.create().withPlugin(navigation.plugin).withScreens(navigation.screens).build();
		await world.initialize();
		await navigation.initialize();
		let notifications = 0;
		navigation.subscribe(function () { notifications++; });
		const pending = navigation.showAuxiliary('settings');
		await world.dispose();
		await pending;
		await navigation.setScreen('bridge');
		expect(notifications).toBe(0);
		expect(navigation.transitioning).toBe(false);
		expect(world.entityCount).toBe(0);
	});

	test('save conflict remains mandatory across queued focus, pause and menu transitions', async function () {
		const navigation = createRuntimeNavigation();
		const world = ECSpresso.create().withPlugin(navigation.plugin).withScreens(navigation.screens).build();
		await world.initialize();
		try {
			await navigation.initialize();
			await navigation.setScreen('playing');
			await Promise.all([navigation.showAuxiliary('settings'), navigation.showAuxiliary('save-conflict'), navigation.pause(), navigation.resume(), navigation.closeAuxiliary(), navigation.setScreen('bridge')]);
			expect(world.getCurrentScreen()).toBe('save-conflict');
			expect(navigation.auxiliary).toBe('save-conflict');
			expect(navigation.screen).toBe('playing');
		} finally { await world.dispose(); }
	});
});
