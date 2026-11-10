import type { CombatStateView, Point } from './simulation';
import { distance } from './simulation';
import { FACILITY_TARGET_ID } from './missions';
import { targetElevation, type ScreenRect } from './overlay';

export interface TouchContact { id: number; point: Point; screen: Point; label: string }
export const visibleTouchContacts = function (state: CombatStateView, project: (point: Point, elevation: number) => Point, width: number, height: number, obstructions: readonly ScreenRect[]): TouchContact[] {
	const contacts: TouchContact[] = state.enemies.filter(function (enemy) { return enemy.hp > 0; }).map(function (enemy) {
		return { id: enemy.id, point: enemy, screen: project(enemy, targetElevation(enemy)), label: enemy.commander ? 'PRIORITY TARGET' : enemy.kind.toUpperCase() };
	});
	const facility = state.mission?.structure;
	if (facility && facility.hp > 0) contacts.push({ id: FACILITY_TARGET_ID, point: facility, screen: project(facility, 45), label: 'FACILITY' });
	return contacts.filter(function (contact) {
		const { x, y } = contact.screen;
		return Number.isFinite(x) && Number.isFinite(y) && x >= 16 && x <= width - 16 && y >= 16 && y <= height - 16
			&& !obstructions.some(function (rect) { return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; });
	}).sort(function (a, b) { return a.id - b.id; });
};

// Keep identity, rather than a screen coordinate: movement and camera changes
// must not silently transfer a lock to another contact.
export const createTouchTargeting = function () {
	let id: number | undefined;
	const clear = function () { id = undefined; };
	const ordered = function (contacts: readonly TouchContact[], origin: Point) {
		return [...contacts].sort(function (a, b) { return distance(a.point, origin) - distance(b.point, origin) || a.id - b.id; });
	};
	return {
		clear,
		select: function (point: Point, contacts: readonly TouchContact[]) {
			const nearest = contacts.reduce<TouchContact | undefined>(function (best, contact) { return !best || distance(contact.screen, point) < distance(best.screen, point) ? contact : best; }, undefined);
			id = nearest && distance(nearest.screen, point) <= 44 ? nearest.id : undefined;
		},
		nearest: function (contacts: readonly TouchContact[], origin: Point) { id = ordered(contacts, origin)[0]?.id; },
		cycle: function (contacts: readonly TouchContact[], origin: Point) {
			const sorted = ordered(contacts, origin);
			const index = sorted.findIndex(function (contact) { return contact.id === id; });
			id = sorted[(index + 1) % sorted.length]?.id;
		},
		resolve: function (contacts: readonly TouchContact[]) {
			const contact = contacts.find(function (candidate) { return candidate.id === id; });
			if (!contact) clear();
			return contact;
		},
	};
};

export const createTouchDrive = function () {
	let owner: number | undefined;
	let drive = 0; let turn = 0; let cruise = false;
	const stop = function () { owner = undefined; drive = 0; turn = 0; };
	const reset = function () { stop(); cruise = false; };
	return {
		reset, stop,
		cancel: function (id: number) { if (id === owner) reset(); },
		isCruising: function () { return cruise; },
		toggleCruise: function () { cruise = !cruise; if (!cruise && owner === undefined) stop(); },
		start: function (id: number) { if (owner !== undefined) return false; owner = id; return true; },
		move: function (id: number, x: number, y: number) {
			if (id !== owner) return;
			const length = Math.hypot(x, y);
			const demand = Math.min(1, Math.max(0, (length - .18) / .82));
			turn = length > 0 ? x / length * demand : 0;
			drive = length > 0 ? -y / length * demand : 0;
		},
		release: function (id: number) { if (id !== owner) return; owner = undefined; if (!cruise) stop(); },
		read: function () { return { drive, turn }; },
	};
};

export const mountTouchDrive = function (button: HTMLElement, knob: HTMLElement, signal: AbortSignal, enabled: () => boolean, cruiseButton: HTMLElement, hint: HTMLElement) {
	const input = createTouchDrive();
	const refresh = function () {
		const value = input.read();
		knob.style.transform = `translate(${value.turn * 30}px, ${-value.drive * 30}px)`;
		cruiseButton.setAttribute('aria-pressed', String(input.isCruising()));
		const status = cruiseButton.querySelector('small');
		if (status) status.textContent = input.isCruising() ? 'ON' : 'OFF';
		hint.textContent = input.isCruising() ? 'CRUISE / STICK HELD' : 'RELEASE TO SLOW';
	};
	const reset = function () { input.reset(); refresh(); };
	const stop = function () { input.stop(); refresh(); };
	cruiseButton.addEventListener('click', function () { if (!enabled()) return; input.toggleCruise(); refresh(); }, { signal });
	const move = function (event: PointerEvent) {
		const rect = button.getBoundingClientRect(); const radius = rect.width / 2;
		const x = (event.clientX - rect.left - radius) / radius; const y = (event.clientY - rect.top - rect.height / 2) / radius;
		input.move(event.pointerId, x, y);
		refresh();
	};
	button.addEventListener('pointerdown', function (event) {
		if (!enabled() || event.button !== 0 || !input.start(event.pointerId)) return;
		event.preventDefault(); button.setPointerCapture(event.pointerId); move(event);
	}, { signal });
	button.addEventListener('pointermove', function (event) { if (button.hasPointerCapture(event.pointerId)) move(event); }, { signal });
	const release = function (event: PointerEvent) { input.release(event.pointerId); refresh(); };
	button.addEventListener('pointercancel', function (event) { input.cancel(event.pointerId); refresh(); }, { signal });
	for (const name of ['pointerup', 'lostpointercapture'] as const) button.addEventListener(name, release, { signal });
	window.addEventListener('resize', reset, { signal });
	signal.addEventListener('abort', reset, { once: true });
	return { read: input.read, reset, stop };
};
