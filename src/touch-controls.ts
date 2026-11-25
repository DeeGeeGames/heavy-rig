import type { CombatStateView, Point } from './simulation';
import { combatTargets, distance } from './simulation';
import { isPriorityTarget } from './missions';
import { getFrame } from './frames';
import { targetElevation, type ScreenRect } from './overlay';
import { inFiringArc } from './torso-arc';

export interface TouchContact { id: number; point: Point; screen: Point; label: string }
export const isContactVisible = function ({ x, y }: Point, width: number, height: number, obstructions: readonly ScreenRect[]): boolean {
	return x >= 16 && x <= width - 16 && y >= 16 && y <= height - 16
		&& !obstructions.some(function (rect) { return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom; });
};
export const visibleTouchContacts = function (state: CombatStateView, project: (point: Point, elevation: number) => Point, width: number, height: number, obstructions: readonly ScreenRect[]): TouchContact[] {
	const contacts = combatTargets(state).map(function (target): TouchContact {
		if (target.kind === 'structure') return { id: target.id, point: target.body, screen: project(target.body, 45), label: state.mission?.contract.kind === 'raid' ? 'RAID SITE' : 'FACILITY' };
		const enemy = target.body;
		const frame = enemy.catalog ? getFrame(enemy.catalog.frameId) : undefined;
		const label = isPriorityTarget(state, enemy) ? 'PRIORITY TARGET' : frame ? `${frame.chassisName} ${frame.variant}` : enemy.kind.toUpperCase();
		return { id: enemy.id, point: enemy, screen: project(enemy, targetElevation(enemy)), label };
	});
	return contacts.filter(function (contact) { return isContactVisible(contact.screen, width, height, obstructions); })
		.sort(function (a, b) { return a.id - b.id; });
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
			const selected = nearest && distance(nearest.screen, point) <= 44 ? nearest : undefined;
			id = selected?.id;
			return selected;
		},
		nearest: function (contacts: readonly TouchContact[], origin: Point) { id = ordered(contacts, origin)[0]?.id; },
		cycle: function (contacts: readonly TouchContact[], origin: Point) {
			const sorted = ordered(contacts, origin);
			const index = sorted.findIndex(function (contact) { return contact.id === id; });
			id = sorted[(index + 1) % sorted.length]?.id;
		},
		resolve: function <T extends { id: number; point: Point & { hp?: number } }>(contacts: readonly T[], rig?: Point & { angle: number }) {
			if (id === undefined) return undefined;
			const contact = contacts.find(function (candidate) {
				return candidate.id === id && (!rig || (candidate.point.hp ?? 1) > 0 && inFiringArc(rig, rig.angle, candidate.point));
			});
			if (!contact) clear();
			return contact;
		},
	};
};

export const touchAimPoint = function (origin: Point, heading: number): Point {
	return { x: origin.x + Math.cos(heading) * 600, y: origin.y + Math.sin(heading) * 600 };
};

// Direct fire holds a heading. Artillery can keep an exact ground coordinate.
export const createTouchFacing = function () {
	let heading: number | undefined;
	let ground: Point | undefined;
	const clear = function () { heading = undefined; ground = undefined; };
	return {
		clear,
		active: function () { return heading !== undefined; },
		select: function (point: Point, origin: Point, fixedGround = false) {
			ground = fixedGround ? { ...point } : undefined;
			if (point.x === origin.x && point.y === origin.y) clear();
			else heading = Math.atan2(point.y - origin.y, point.x - origin.x);
		},
		resolve: function (origin: Point & { angle: number }): Point | undefined {
			if (heading === undefined) return undefined;
			const aim = ground ?? touchAimPoint(origin, heading);
			if (ground || inFiringArc(origin, origin.angle, aim)) return aim;
			clear();
			return undefined;
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
