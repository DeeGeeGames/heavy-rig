import { html, nothing, render } from 'lit-html';
import { styleMap } from 'lit-html/directives/style-map.js';
import { terrainMapColors } from './terrain-map-colors';
import type { SquadOrderChange } from './combat-runtime';
import { directionalControl, focusMenuControl, type MenuDirection } from './menu-focus';
import { EXTRACTION_RADIUS, CAPTURE_RADIUS, isPriorityTarget } from './missions';
import { ARENA, combatTargets, distance, squadMoveDestinations, type CombatStateView, type FireDiscipline, type Point, type Squadmate, type SquadOrder } from './simulation';

type OrderKind = SquadOrder['kind'];
type Contact = ReturnType<typeof combatTargets>[number];
type Bounds = Readonly<{ width: number; height: number }>;
interface Projection {
	origin: Point;
	size: Bounds;
	scale: number;
}

const commands = [
	{ kind: 'form', label: 'Form on Me', icon: '⌃' },
	{ kind: 'hold', label: 'Hold Position', icon: '□' },
	{ kind: 'move', label: 'Move to Position', icon: '↗' },
	{ kind: 'attack', label: 'Attack Target', icon: '⊕' },
] as const;

const fireModes = [
	{ mode: 'free', label: 'Weapons Free' },
	{ mode: 'hold', label: 'Hold Fire' },
] as const;

const MOVE_VECTORS: Readonly<Record<MenuDirection, Point>> = {
	up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

const targetLabel = function (contact: Contact): string {
	if (contact.kind === 'structure') return contact.id === -1 ? 'Facility' : `Facility ${-contact.id - 1}`;
	if (contact.body.commander) return 'Commander';
	const kind = contact.body.kind;
	return kind === 'vtol' ? 'VTOL' : kind.charAt(0).toUpperCase() + kind.slice(1);
};

const project = function (projection: Projection, point: Point): Point {
	return { x: projection.origin.x + point.x * projection.scale, y: projection.origin.y + point.y * projection.scale };
};

const markerStyle = function (at: Point) { return styleMap({ left: `${at.x}px`, top: `${at.y}px` }); };

// Keep deployed squad labels legible when several rigs share a few map pixels.
const placePilotMarker = function (anchor: Point, occupied: readonly Point[], size: Bounds): Point {
	const offsets = [
		[0, 0], [0, -36], [-44, 0], [44, 0], [0, 36],
		[-44, -36], [44, -36], [-44, 36], [44, 36], [0, -72], [0, 72],
	] as const;
	return offsets.map(function ([x, y]) { return { x: anchor.x + x, y: anchor.y + y }; }).find(function (at) {
		return at.x >= 23 && at.x <= size.width - 23 && at.y >= 17 && at.y <= size.height - 17
			&& occupied.every(function (other) { return Math.abs(at.x - other.x) >= 41 || Math.abs(at.y - other.y) >= 33; });
	}) ?? anchor;
};

const paintGround = function (ctx: CanvasRenderingContext2D, state: CombatStateView, projection: Projection, bounds: Bounds) {
	const map = state.mission?.map;
	const from = projection.origin;
	const w = bounds.width * projection.scale;
	const h = bounds.height * projection.scale;
	ctx.fillStyle = '#182923';
	ctx.fillRect(from.x, from.y, w, h);
	ctx.strokeStyle = '#344940';
	ctx.lineWidth = 1;
	ctx.strokeRect(from.x, from.y, w, h);
	ctx.save();
	ctx.beginPath(); ctx.rect(from.x, from.y, w, h); ctx.clip();
	ctx.beginPath();
	for (let x = 0; x < bounds.width; x += 240) {
		const at = project(projection, { x, y: 0 });
		ctx.moveTo(at.x, at.y); ctx.lineTo(at.x, at.y + h);
	}
	for (let y = 0; y < bounds.height; y += 240) {
		const at = project(projection, { x: 0, y });
		ctx.moveTo(at.x, at.y); ctx.lineTo(at.x + w, at.y);
	}
	ctx.strokeStyle = '#90b4a021'; ctx.stroke();
	for (const [index, road] of (map?.terrain?.roads ?? []).entries()) {
		ctx.beginPath();
		road.forEach(function (point, i) {
			const at = project(projection, point);
			if (i === 0) ctx.moveTo(at.x, at.y);
			else ctx.lineTo(at.x, at.y);
		});
		ctx.lineWidth = Math.max(2, 40 * projection.scale);
		ctx.strokeStyle = index === 0 ? '#9e88536b' : '#6a999776';
		ctx.setLineDash(index === 0 ? [] : [4, 3]);
		ctx.stroke();
	}
	ctx.setLineDash([]);
	ctx.lineWidth = 1;
	for (const obstacle of map?.terrain?.obstacles ?? []) {
		const at = project(projection, { x: obstacle.x - obstacle.width / 2, y: obstacle.y - obstacle.depth / 2 });
		const width = obstacle.width * projection.scale;
		const depth = obstacle.depth * projection.scale;
		const [fill, edge] = terrainMapColors(obstacle.kind, map?.biome);
		ctx.fillStyle = fill; ctx.strokeStyle = edge;
		ctx.fillRect(at.x, at.y, width, depth);
		ctx.strokeRect(at.x, at.y, width, depth);
	}
	const ring = function (point: Point, radius: number, color: string) {
		const at = project(projection, point);
		ctx.beginPath();
		ctx.arc(at.x, at.y, Math.max(3, radius * projection.scale), 0, Math.PI * 2);
		ctx.strokeStyle = color;
		ctx.stroke();
	};
	if (map) {
		ring(map.extraction, EXTRACTION_RADIUS, '#92d6c5');
		for (const site of state.mission?.captureSites ?? []) ring(site, CAPTURE_RADIUS, site.complete ? '#90b79c' : '#e6c38b');
	}
	for (const strike of state.strikes) ring(strike, strike.radius, '#ff896e');
	ctx.restore();
};

export const mountSquadOrders = function (
	root: HTMLElement,
	callbacks: { apply(current: CombatStateView, changes: readonly SquadOrderChange[]): void; back(): void },
	signal: AbortSignal,
) {
	let state: CombatStateView | undefined;
	let bounds: Bounds = ARENA;
	let contacts: readonly Contact[] = [];
	let living: readonly Squadmate[] = [];
	let pick: 'move' | 'attack' | undefined;
	let projection: Projection = { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 }, scale: 1 };
	let cursor: Point = { x: 0, y: 0 };
	let contactIndex = 0;
	let message = '';
	const selected = new Set<string>();
	const draft = new Map<string, SquadOrderChange>();

	const contactFor = function (id: number) { return contacts.find(function (contact) { return contact.id === id; }); };
	const orderFor = function (mate: Squadmate) { return draft.get(mate.pilotId)?.order ?? mate.order; };
	const fireFor = function (mate: Squadmate) { return draft.get(mate.pilotId)?.fireDiscipline ?? mate.fireDiscipline ?? 'free'; };
	const orderLabel = function (order: SquadOrder | undefined): string {
		if (!order) return 'Autonomous';
		if (order.kind === 'attack') {
			const target = contactFor(order.targetId);
			return target ? `Attack ${targetLabel(target)}` : 'Target gone';
		}
		return commands.find(function (command) { return command.kind === order.kind; })?.label ?? 'Autonomous';
	};

	const updateChange = function (mate: Squadmate, order: SquadOrder | undefined, fireDiscipline: FireDiscipline | undefined) {
		if (order?.kind === 'form' && mate.order?.kind === 'form') order = undefined;
		if (fireDiscipline === (mate.fireDiscipline ?? 'free')) fireDiscipline = undefined;
		if (!order && !fireDiscipline) { draft.delete(mate.pilotId); return; }
		draft.set(mate.pilotId, { pilotId: mate.pilotId, ...(order && { order }), ...(fireDiscipline && { fireDiscipline }) });
	};

	const draw = function () {
		const canvas = root.querySelector<HTMLCanvasElement>('.squad-map canvas');
		const ctx = canvas?.getContext('2d');
		if (!state || !canvas || !ctx || projection.size.width <= 0 || projection.size.height <= 0) return;
		const { width, height } = projection.size;
		const ratio = Math.min(2, window.devicePixelRatio || 1);
		canvas.width = Math.round(width * ratio);
		canvas.height = Math.round(height * ratio);
		ctx.scale(ratio, ratio);
		paintGround(ctx, state, projection, bounds);
		for (const mate of living) {
			const order = orderFor(mate);
			const point = order?.kind === 'attack' ? contactFor(order.targetId)?.body
				: order?.kind === 'move' || order?.kind === 'hold' ? order.point
					: order?.kind === 'form' ? state.player : undefined;
			if (!point || !order) continue;
			const from = project(projection, mate);
			const to = project(projection, point);
			const staged = Boolean(draft.get(mate.pilotId)?.order);
			ctx.strokeStyle = order.kind === 'attack' ? '#ff9d89' : '#93d6c6';
			ctx.globalAlpha = selected.has(mate.pilotId) || staged ? 0.95 : 0.48;
			ctx.lineWidth = 1.5;
			ctx.setLineDash(staged ? [4, 3] : []);
			ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
			if (order.kind === 'move' || order.kind === 'hold') {
				ctx.setLineDash([]);
				ctx.strokeRect(to.x - 3, to.y - 3, 6, 6);
			}
		}
	};

	const update = function () {
		if (!state) return;
		const current = state;
		const mission = current.mission;
		const selectedFire = new Set(living.filter(function (mate) { return selected.has(mate.pilotId); }).map(fireFor));
		const candidate = contacts[contactIndex];
		const pickLabel = pick === 'move' ? 'Mark position' : 'Confirm target';
		const applyLabel = draft.size ? 'Apply & Resume' : 'Resume';
		const status = !draft.size ? 'No staged orders' : `${draft.size} squadmate${draft.size === 1 ? '' : 's'} with staged orders`;
		const caption = pick === 'move' ? 'Choose a clear destination.' : 'Choose a hostile contact.';
		render(html`
			<header class="squad-orders-head">
				<div><p class="eyebrow">${mission?.contract.title ?? 'OPERATION'}</p><h2>Squad Orders</h2></div>
				<span class="squad-orders-paused">Ⅱ PAUSED</span>
			</header>
			<div class="squad-orders-body">
				<div class="squad-console" ?inert=${Boolean(pick)}>
					<div class="squad-selection">
						<span>${selected.size} of ${living.length} selected</span>
						<button type="button" data-squad-select-all @click=${selectAll} ?disabled=${living.length === 0}>${selected.size === living.length && living.length > 0 ? 'Clear selection' : 'Select all'}</button>
					</div>
					<div class="squad-roster">
						${current.squadmates.map(function (mate, index) {
							const change = draft.get(mate.pilotId);
							const order = orderFor(mate);
							const mode = fireFor(mate);
							const disabled = mate.hp <= 0;
							return html`<button type="button" class="squad-pilot" data-squad-pilot=${mate.pilotId}
								aria-pressed=${selected.has(mate.pilotId)} ?disabled=${disabled} @click=${function () { toggle(mate.pilotId); }}>
								<strong><span>${index + 1}</span>${mate.callsign}</strong>
								<small ?data-staged=${Boolean(change?.order)}>${disabled ? 'Disabled' : orderLabel(order)}</small>
								${disabled ? nothing : html`<small data-fire-state=${mode} ?data-staged=${Boolean(change?.fireDiscipline)}>${mode === 'hold' ? 'Hold Fire' : 'Weapons Free'}${mode === 'hold' && order?.kind === 'attack' ? ' · ordered target only' : ''}</small>`}
							</button>`;
						})}
					</div>
					<div class="squad-commands">
						${commands.map(function (command) { return html`<button type="button" data-squad-command=${command.kind} aria-label=${command.label} aria-pressed=${command.kind === pick}
							?disabled=${selected.size === 0 || command.kind === 'attack' && contacts.length === 0}
							@click=${function () { commandSelected(command.kind); }}><span aria-hidden="true">${command.icon}</span>${command.label}</button>`; })}
					</div>
					<div class="squad-fire">
						<div class="squad-fire-label">Fire discipline ${selectedFire.size > 1 ? html`<span>Mixed</span>` : nothing}</div>
						<div class="squad-fire-options">${fireModes.map(function ({ mode, label }) {
							return html`<button type="button" data-squad-fire=${mode} aria-pressed=${selectedFire.size === 1 && selectedFire.has(mode)}
								?disabled=${selected.size === 0} @click=${function () { changeFire(mode); }}>${label}</button>`;
						})}</div>
					</div>
				</div>
				<div class="squad-field">
					<div class="squad-map" data-pick=${pick ?? 'none'}>
						<canvas aria-hidden="true"></canvas>
						<button type="button" class="squad-map-confirm" aria-label=${pickLabel} ?hidden=${!pick} @click=${choose}></button>
						${projection.size.width ? mapMarkers(current, candidate) : nothing}
						<span class="squad-map-compass">↑ N</span>
					</div>
					<div class="squad-map-caption">
						${pick ? html`<span class="squad-map-prompt">${message || caption}</span>` : html`
							<span><i class="map-key-friendly"></i> Squad</span><span><i class="map-key-hostile"></i> Hostile</span>
							${mission ? html`<span><i class="map-key-objective"></i> Objective</span><span><i class="map-key-pickup"></i> Pickup</span>` : nothing}`}
						${pick === 'attack' && candidate ? html`<div class="squad-contact-picker">
							<button type="button" aria-label="Previous contact" ?disabled=${contacts.length < 2} @click=${function () { stepContact(-1); }}><span data-menu-glyph="previousDepartment"></span></button>
							<button type="button" @click=${function (event: MouseEvent) { markTarget(candidate.id, event.detail > 0); }}>${targetLabel(candidate)} <small>${contactIndex + 1}/${contacts.length}</small></button>
							<button type="button" aria-label="Next contact" ?disabled=${contacts.length < 2} @click=${function () { stepContact(1); }}><span data-menu-glyph="nextDepartment"></span></button>
						</div>` : nothing}
					</div>
				</div>
			</div>
			<footer class="squad-orders-footer">
				<button type="button" data-squad-back @click=${function () { if (!cancelPick()) callbacks.back(); }}>${pick ? 'Cancel pick' : draft.size ? 'Discard & Back' : 'Back'}</button>
				<span class="squad-orders-status">${status}</span>
				<button type="button" ?disabled=${draft.size === 0 || Boolean(pick)} @click=${discard}>Discard</button>
				<button type="button" class="squad-apply" ?disabled=${Boolean(pick)} @click=${apply}>${applyLabel}</button>
			</footer>
		`, root);
		draw();
	};

	const mapMarkers = function (current: CombatStateView, candidate: Contact | undefined) {
		const mission = current.mission;
		const sites = mission?.captureSites ?? (mission ? [mission.map.objective] : []);
		const player = project(projection, current.player);
		const occupied = [player];
		return html`
			${sites.filter(function (site) { return !contacts.some(function (contact) { return contact.kind === 'structure' && distance(contact.body, site) < 12; }); }).map(function (site) {
				return html`<span class="squad-mark map-objective" style=${markerStyle(project(projection, site))} aria-hidden="true">◈</span>`;
			})}
			${mission ? html`<span class="squad-mark map-pickup" style=${markerStyle(project(projection, mission.map.extraction))} aria-hidden="true">△</span>` : nothing}
			${contacts.map(function (contact) {
				const targeted = pick === 'attack' && contact.id === candidate?.id;
				const priority = contact.kind === 'structure' || isPriorityTarget(current, contact.body);
				return html`<span class="squad-mark map-hostile" data-squad-contact=${contact.id} ?data-targeted=${targeted} ?data-priority=${priority} style=${markerStyle(project(projection, contact.body))} aria-hidden="true"><i></i></span>`;
			})}
			<span class="squad-mark map-player" style=${markerStyle(player)} aria-hidden="true"><b>▲</b><small>YOU</small></span>
			${current.squadmates.map(function (mate, index) {
				const anchor = project(projection, mate);
				const label = placePilotMarker(anchor, occupied, projection.size);
				occupied.push(label);
				const at = markerStyle(label);
				const leadLength = distance(label, anchor);
				const lead = leadLength > 0 ? html`
					<span class="squad-map-leader" style=${styleMap({
						left: `${anchor.x}px`, top: `${anchor.y}px`, width: `${leadLength}px`,
						transform: `rotate(${Math.atan2(label.y - anchor.y, label.x - anchor.x)}rad)`,
					})} aria-hidden="true"></span>` : nothing;
				return html`${lead}${pick || mate.hp <= 0
					? html`<span class="squad-mark map-pilot" ?data-selected=${selected.has(mate.pilotId)} ?data-disabled=${mate.hp <= 0} style=${at} aria-hidden="true"><b>${index + 1}</b><small>${mate.callsign}</small></span>`
					: html`<button type="button" class="squad-mark map-pilot" ?data-selected=${selected.has(mate.pilotId)} style=${at} aria-label=${`Select ${mate.callsign}`}
						aria-pressed=${selected.has(mate.pilotId)} @click=${function () { toggle(mate.pilotId); }}><b>${index + 1}</b><small>${mate.callsign}</small></button>`}`;
			})}
			${pick === 'move' ? html`<span class="squad-mark map-cursor" style=${markerStyle(project(projection, cursor))} aria-hidden="true">＋</span>` : nothing}
		`;
	};

	const syncMap = function () {
		const map = root.querySelector<HTMLElement>('.squad-map');
		if (!map || !map.clientWidth || !map.clientHeight) return;
		const size = { width: map.clientWidth, height: map.clientHeight };
		const scale = Math.min(Math.max(1, size.width - 34) / bounds.width, Math.max(1, size.height - 38) / bounds.height);
		projection = { size, scale, origin: { x: (size.width - scale * bounds.width) / 2, y: (size.height - scale * bounds.height) / 2 } };
		update();
	};

	const resize = new ResizeObserver(syncMap);
	const focus = function (selector: string, preventScroll = false) {
		const target = root.querySelector<HTMLElement>(selector);
		if (!target) return;
		if (preventScroll) target.focus({ preventScroll: true });
		else focusMenuControl(target);
	};
	const setSelectedOrder = function (order: (mate: Squadmate) => SquadOrder | undefined) {
		for (const mate of living) {
			if (!selected.has(mate.pilotId)) continue;
			updateChange(mate, order(mate), draft.get(mate.pilotId)?.fireDiscipline);
		}
	};

	const selectAll = function () {
		if (selected.size === living.length) selected.clear();
		else for (const mate of living) selected.add(mate.pilotId);
		if (selected.size === 0) pick = undefined;
		message = '';
		update();
	};

	const toggle = function (id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		if (selected.size === 0) pick = undefined;
		message = '';
		update();
	};

	const changeFire = function (mode: FireDiscipline) {
		for (const mate of living) {
			if (selected.has(mate.pilotId)) updateChange(mate, draft.get(mate.pilotId)?.order, mode);
		}
		update();
	};

	const stepContact = function (step: number): boolean {
		if (pick !== 'attack' || contacts.length < 2 || !step) return false;
		contactIndex = (contactIndex + Math.sign(step) + contacts.length) % contacts.length;
		message = '';
		update();
		return true;
	};

	const cancelPick = function (preventScroll = false): boolean {
		if (!pick) return false;
		const from = pick;
		pick = undefined;
		message = '';
		update();
		focus(`[data-squad-command="${from}"]`, preventScroll);
		return true;
	};

	const commandSelected = function (kind: OrderKind) {
		if (!state || !selected.size) return;
		if (kind === 'move' || kind === 'attack') {
			pick = kind;
			cursor = { x: state.player.x, y: state.player.y };
			if (kind === 'attack') {
				const origin = state.player;
				contactIndex = contacts.reduce(function (best, contact, index) {
					const previous = contacts[best];
					return previous && distance(contact.body, origin) >= distance(previous.body, origin) ? best : index;
				}, 0);
			}
			message = '';
			update();
			focus('.squad-map-confirm');
			return;
		}
		pick = undefined;
		message = '';
		setSelectedOrder(function (mate) {
			return kind === 'form' ? { kind } : { kind, point: { x: mate.x, y: mate.y } };
		});
		update();
	};

	const markTarget = function (id: number, fromPointer: boolean) {
		setSelectedOrder(function () { return { kind: 'attack', targetId: id }; });
		cancelPick(fromPointer);
	};

	const choose = function (event: MouseEvent) {
		if (!state || !pick) return;
		let point = cursor;
		const pointer = event.detail > 0;
		if (pointer && event.currentTarget instanceof HTMLElement) {
			const rect = event.currentTarget.getBoundingClientRect();
			point = {
				x: (event.clientX - rect.left - projection.origin.x) / projection.scale,
				y: (event.clientY - rect.top - projection.origin.y) / projection.scale,
			};
		}
		if (pick === 'attack') {
			const target = pointer ? contacts.filter(function (contact) {
				return distance(contact.body, point) * projection.scale <= 24;
			}).sort(function (a, b) { return distance(a.body, point) - distance(b.body, point); })[0] : contacts[contactIndex];
			if (target) { markTarget(target.id, pointer); return; }
			message = 'No contact there. Pick a marked hostile.';
		} else {
			const destinations = squadMoveDestinations(state, [...selected], point);
			if (destinations) {
				setSelectedOrder(function (mate) {
					const at = destinations.get(mate.pilotId);
					return at ? { kind: 'move', point: at } : undefined;
				});
				cancelPick(pointer);
				return;
			}
			message = 'Destination blocked. Pick clear ground.';
		}
		update();
	};

	const discard = function () {
		draft.clear();
		message = '';
		update();
		focus('[data-squad-back]');
	};

	const apply = function () {
		if (state && !pick) callbacks.apply(state, [...draft.values()]);
	};

	const close = function () {
		resize.disconnect();
		state = undefined;
		living = [];
		contacts = [];
		selected.clear();
		draft.clear();
		pick = undefined;
		message = '';
		projection = { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 }, scale: 1 };
		render(nothing, root);
	};

	signal.addEventListener('abort', close, { once: true });
	return {
		open: function (current: CombatStateView) {
			state = current;
			bounds = current.mission?.map ?? ARENA;
			contacts = combatTargets(current);
			living = current.squadmates.filter(function (mate) { return mate.hp > 0; });
			selected.clear();
			for (const mate of living) selected.add(mate.pilotId);
			draft.clear();
			pick = undefined;
			message = '';
			update();
			const map = root.querySelector<HTMLElement>('.squad-map');
			if (map) resize.observe(map);
			syncMap();
		},
		close,
		cancelPick,
		stepContact,
		moveCursor: function (direction: MenuDirection) {
			if (!pick || document.activeElement !== root.querySelector('.squad-map-confirm')) return false;
			if (pick === 'attack') {
				const markers = [...root.querySelectorAll<HTMLElement>('[data-squad-contact]')];
				const current = markers[contactIndex];
				const next = current && directionalControl(markers, current, direction);
				if (next) { contactIndex = markers.indexOf(next); message = ''; update(); }
			}
			else {
				const step = Math.max(20, 4 / projection.scale);
				const vector = MOVE_VECTORS[direction];
				cursor = {
					x: Math.max(0, Math.min(bounds.width, cursor.x + vector.x * step)),
					y: Math.max(0, Math.min(bounds.height, cursor.y + vector.y * step)),
				};
				message = '';
				update();
			}
			return true;
		},
	};
};
