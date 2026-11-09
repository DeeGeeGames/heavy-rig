import { definePlugin, type ScreenConfiguratorFn, type ScreenDefinition, type ScreenResource } from 'ecspresso';
import type { ShipScreen } from './company-ui';

export type RuntimeBaseScreen = ShipScreen | 'title' | 'intro' | 'rig-bay' | 'escape-result' | 'jump' | 'playing' | 'pause-panel' | 'result' | 'training-result';
export type RuntimeAuxiliary = 'settings' | 'handbook' | 'confirm' | 'save-conflict';
export type RuntimeScreen = RuntimeBaseScreen | RuntimeAuxiliary | 'training';
type RuntimeScreens = Record<RuntimeScreen, ScreenDefinition>;

interface NavigationWorld {
	getCurrentScreen: () => RuntimeScreen | null;
	getResource: (name: '$screen') => ScreenResource<RuntimeScreens>;
	setScreen: (name: RuntimeScreen, config: Record<string, never>) => Promise<void>;
	pushScreen: (name: RuntimeScreen, config: Record<string, never>) => Promise<void>;
	popScreen: () => Promise<void>;
}

const isAuxiliary = function (screen: RuntimeScreen | null): screen is RuntimeAuxiliary {
	return screen === 'settings' || screen === 'handbook' || screen === 'confirm' || screen === 'save-conflict';
};
const definition: Pick<ScreenDefinition, 'initialState'> = { initialState: function () { return {}; } };

// Screen definitions use the public application builder. The plugin supplies
// the typed controller; it does not reach into ECSpresso's registration internals.
const screens: ScreenConfiguratorFn<RuntimeScreens> = function (configurator) {
	return configurator
		.add('title', definition)
		.add('intro', definition)
		.add('rig-bay', definition)
		.add('escape-result', definition)
		.add('bridge', definition)
		.add('starmap', definition)
		.add('mechbay', definition)
		.add('market', definition)
		.add('engineering', definition)
		.add('jump', definition)
		.add('playing', definition)
		.add('training', definition)
		.add('pause-panel', definition)
		.add('result', definition)
		.add('training-result', definition)
		.add('settings', definition)
		.add('handbook', definition)
		.add('confirm', definition)
		.add('save-conflict', definition);
};

export const createRuntimeNavigation = function () {
	let world: NavigationWorld | undefined;
	let closed = false;
	let queued = 0;
	let tail = Promise.resolve();
	const listeners = new Set<() => void>();
	const requireWorld = function () {
		if (!world) throw new Error('Runtime navigation is not installed');
		return world;
	};
	const enqueue = function (operation: (owner: NavigationWorld) => Promise<void>): Promise<void> {
		if (closed) return Promise.resolve();
		queued++;
		const transition = tail.then(async function () {
			if (closed) return;
			try {
				const owner = requireWorld();
				// A stale company must reload. Focus/context loss cannot replace this overlay.
				if (owner.getCurrentScreen() !== 'save-conflict') await operation(owner);
			}
			catch (error: unknown) { if (!closed) throw error; }
		}).finally(function () {
			queued--;
			if (!closed) for (const listener of listeners) listener();
		});
		// A failed transition is reported to its caller, while later requests still
		// run. Serializing prevents a pop racing a push during rapid menu input.
		tail = transition.catch(function () {});
		return transition;
	};
	const baseScreen = function (): RuntimeBaseScreen {
		if (!world || !world.getCurrentScreen()) return 'title';
		const resource = world.getResource('$screen');
		const current = resource.current;
		const base = isAuxiliary(current)
			? [...resource.stack].reverse().find(function (entry) { return !isAuxiliary(entry.name); })?.name
			: current;
		return base === 'training' ? 'playing' : base && !isAuxiliary(base) ? base : 'title';
	};
	const popAuxiliary = async function (owner: NavigationWorld) {
		while (!closed && isAuxiliary(owner.getCurrentScreen())) await owner.popScreen();
	};
	const pause = function () {
		return enqueue(async function (owner) {
			await popAuxiliary(owner);
			const current = owner.getCurrentScreen();
			if (!closed && (current === 'playing' || current === 'training')) await owner.pushScreen('pause-panel', {});
		});
	};
	const resume = function () {
		return enqueue(async function (owner) {
			await popAuxiliary(owner);
			if (!closed && owner.getCurrentScreen() === 'pause-panel') await owner.popScreen();
		});
	};
	const plugin = definePlugin('heavy-rig-navigation')
		.withScreenTypes<RuntimeScreens>()
		.withResourceTypes<{ $screen: ScreenResource<RuntimeScreens> }>()
		.install(function (owner, onCleanup) {
			if (world || closed) throw new Error('Create a navigation controller for each application world');
			world = owner;
			onCleanup(async function () {
				closed = true;
				listeners.clear();
				await tail;
				world = undefined;
			});
		});
	return {
		plugin,
		screens,
		initialize: function () { return enqueue(function (owner) { return owner.setScreen('title', {}); }); },
		get screen() { return baseScreen(); },
		get auxiliary() {
			const current = world?.getCurrentScreen() ?? null;
			return isAuxiliary(current) ? current : undefined;
		},
		get training() {
			return world?.getCurrentScreen() === 'training' || Boolean(world?.getResource('$screen').stack.some(function (entry) { return entry.name === 'training'; }));
		},
		get transitioning() { return queued > 0; },
		setScreen: function (screen: RuntimeBaseScreen, training = false) {
			if (screen === 'pause-panel') return pause();
			return enqueue(function (owner) { return owner.setScreen(screen === 'playing' && training ? 'training' : screen, {}); });
		},
		showAuxiliary: function (screen: RuntimeAuxiliary) {
			return enqueue(async function (owner) {
				if (owner.getCurrentScreen() === screen) return;
				await popAuxiliary(owner);
				if (!closed) await owner.pushScreen(screen, {});
			});
		},
		closeAuxiliary: function () { return enqueue(popAuxiliary); },
		pause,
		resume,
		subscribe: function (listener: () => void) {
			listeners.add(listener);
			return function () { listeners.delete(listener); };
		},
	};
};
