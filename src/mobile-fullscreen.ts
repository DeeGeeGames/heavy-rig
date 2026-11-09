export const mountMobileFullscreen = function (container: HTMLElement, button: HTMLButtonElement, status: HTMLElement, signal: AbortSignal) {
	let touch = false; let controller = false; let busy = false; let initialized = false;
	const standalone = window.matchMedia('(display-mode: standalone)');
	const update = function () {
		const active = Boolean(document.fullscreenElement);
		button.hidden = !active && (!touch || controller || standalone.matches || !document.fullscreenEnabled || typeof container.requestFullscreen !== 'function');
		container.classList.toggle('has-mobile-fullscreen', !button.hidden);
		button.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
		button.title = active ? 'Exit full screen' : 'Full screen';
		button.textContent = active ? 'EXIT ⛶' : 'FULL ⛶';
		if (button.hidden) status.textContent = '';
	};
	button.addEventListener('click', async function () {
		if (busy) return;
		busy = true; button.disabled = true; status.textContent = '';
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await container.requestFullscreen({ navigationUI: 'hide' });
		} catch {
			status.textContent = 'Full screen was unavailable. Tap FULL to try again.';
		} finally { busy = false; button.disabled = false; update(); }
	}, { signal });
	document.addEventListener('fullscreenchange', function () { status.textContent = ''; update(); }, { signal });
	standalone.addEventListener('change', update, { signal });
	return { update: function (hasTouch: boolean, hasController: boolean) {
		if (initialized && touch === hasTouch && controller === hasController) return;
		initialized = true; touch = hasTouch; controller = hasController; update();
	} };
};
