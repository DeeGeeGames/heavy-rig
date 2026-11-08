export type StopGame = () => void | Promise<void>;
export type StartGame = (container: HTMLElement, onCleanup: (stop: StopGame) => void) => Promise<StopGame>;

export const createCleanupOwner = function () {
	const cleanups: StopGame[] = [];
	let shutdown: Promise<void> | undefined;
	return {
		add: function (stop: StopGame) {
			if (shutdown) throw new Error('Cannot register cleanup after shutdown');
			cleanups.push(stop);
		},
		dispose: function () {
			shutdown ??= Promise.resolve().then(async function () {
				const failures: unknown[] = [];
				for (const stop of cleanups.reverse()) {
					try { await stop(); } catch (error: unknown) { failures.push(error); }
				}
				cleanups.length = 0;
				if (failures.length) throw new AggregateError(failures, 'Game cleanup failed');
			});
			return shutdown;
		},
	};
};

// Each page owns one world. Cached pages keep that world for browser Back.
export const mountGame = async function (containerId: string, start: StartGame): Promise<StopGame> {
	const owner = createCleanupOwner();
	let shutdown: Promise<void> | undefined;
	const dispose = function (): Promise<void> {
		window.removeEventListener('pagehide', onPageHide);
		shutdown ??= owner.dispose();
		return shutdown;
	};
	const onPageHide = function (event: PageTransitionEvent) {
		if (!event.persisted) void dispose().catch(console.error);
	};
	try {
		const container = document.getElementById(containerId);
		if (!(container instanceof HTMLElement)) throw new Error(`Missing game container: ${containerId}`);
		owner.add(await start(container, owner.add));
		window.addEventListener('pagehide', onPageHide);
	} catch (error: unknown) {
		console.error(error);
		try { await dispose(); } catch (cleanupError: unknown) { console.error(cleanupError); }
		const message = document.getElementById('error');
		if (message) {
			message.hidden = false;
			message.textContent = 'Could not start the game. Reload to try again.';
		}
	}
	return dispose;
};
