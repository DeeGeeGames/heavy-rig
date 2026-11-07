import { html } from 'lit-html';
import { renderWorkspace, selectWorkspacePane, textItems, type WorkspacePane } from './workspace';
import { getWeapon, WEAPONS, type WeaponId } from './arsenal';
import { getPlanet, type Campaign } from './campaign';
import { availableWeapons, canDeploy, canRefit, FRAME_PRICES, getOwnedMech, refitDays, repairDays, WEAPON_PRICES, workOrderFor } from './company';
import { FRAMES, getFrame, type FrameDefinition, type FrameId } from './frames';
import { MOUNTS } from './loadout-ui';

export type CompanyScreen = 'mechbay' | 'market' | 'engineering';
export type ShipScreen = 'bridge' | CompanyScreen;
export interface CompanyEditor {
	loadout: readonly (WeaponId | null)[];
	slot: number | null;
	notice: string;
}
export interface CompanyActions {
	navigate: (screen: ShipScreen) => void;
	selectFrame: (frameId: FrameId) => void;
	editSlot: (slot: number) => void;
	setWeapon: (weapon: WeaponId | null) => void;
	discardRefit: () => void;
	closePicker: () => void;
	queueRefit: () => void;
	buyFrame: (frameId: FrameId) => void;
	buyWeapon: (weapon: WeaponId) => void;
	repair: (frameId: FrameId) => void;
	cancelWork: (frameId: FrameId) => void;
	advanceDays: (days: number) => void;
	deploy: () => void;
	settings: () => void;
	handbook: () => void;
}

const SECTIONS: readonly { id: ShipScreen; label: string; number: string }[] = [
	{ id: 'bridge', label: 'Contracts', number: '01' },
	{ id: 'mechbay', label: 'Mech Bay', number: '02' },
	{ id: 'market', label: 'Market', number: '03' },
	{ id: 'engineering', label: 'Engineering', number: '04' },
];
const daysLabel = function (days: number) { return `${days} ${days === 1 ? 'DAY' : 'DAYS'}`; };
const creditsLabel = function (credits: number) { return `${credits.toLocaleString()} CR`; };
const integrityLabel = function (integrity: number) { return `${Math.ceil(integrity)}%`; };

export const renderShipHeader = function (campaign: Campaign, screen: ShipScreen, navigate: (screen: ShipScreen) => void) {
	return html`
		<header class="bridge-header">
			<div class="bridge-brand"><span class="insignia" aria-hidden="true">HR</span><div><span class="eyebrow">HEAVY RIG / FRONTIER COMPANY</span><h1>WAYFARER<span>COMPANY OPERATIONS</span></h1></div></div>
			<div class="career-stats"><div><small>IN ORBIT</small><b>${getPlanet(campaign.planetId).name}</b></div><div><small>COMPANY FUNDS</small><b>${campaign.credits.toLocaleString()} <em>CR</em></b></div><div><small>SHIP CALENDAR</small><b>DAY ${String(campaign.day).padStart(2, '0')}</b></div></div>
		</header>
		<nav class="ship-navigation" aria-label="Company departments">
			${SECTIONS.map(function (section) { return html`<button data-ship-screen=${section.id} aria-current=${screen === section.id ? 'page' : 'false'} @click=${function () { navigate(section.id); }}><small>${section.number}</small><span>${section.label}</span>${section.id === 'engineering' && campaign.workOrders.length > 0 ? html`<b aria-label=${`${campaign.workOrders.length} active work orders`}>${campaign.workOrders.length}</b>` : ''}</button>`; })}
		</nav>
	`;
};

const frameSchematic = function (frame: FrameDefinition) {
	const width = frame.mass >= 80 ? 42 : frame.mass <= 40 ? 29 : 35;
	return html`<svg class="company-frame-art" viewBox="0 0 240 260" role="img" aria-label=${`${frame.name} frame schematic`} style="--frame-color:${frame.color}">
		<path d="M20 0V260M60 0V260M100 0V260M140 0V260M180 0V260M220 0V260M0 20H240M0 60H240M0 100H240M0 140H240M0 180H240M0 220H240M0 260H240" fill="none" stroke="currentColor" stroke-width=".4" opacity=".2"/>
		<g fill="none" stroke="currentColor" stroke-width="1"><path d="M20 55H220M20 208H220M120 15V243" opacity=".3" stroke-dasharray="3 5"/><circle cx="120" cy="126" r="91" opacity=".25"/></g>
		<g stroke="currentColor" stroke-width="2" stroke-linejoin="bevel">
			<path class="schematic-solid" d=${`M${120 - width} 65L107 50H133L${120 + width} 65V112L138 133H102L${120 - width} 112Z`}/>
			<path class="schematic-solid" d=${`M${111 - width} 73H${96 - width}L${91 - width} 105L${102 - width} 141H${116 - width}V116M${129 + width} 73H${144 + width}L${149 + width} 105L${138 + width} 141H${124 + width}V116`}/>
			<path class="schematic-solid" d="M103 130 91 154 95 177 82 214 102 224 119 179 112 155H128L121 179 138 224 158 214 145 177 149 154 137 130Z"/>
			<path class="schematic-solid" d="M80 213H103L107 235H67V225ZM137 213H160L173 225V235H133Z"/>
			<path d="M108 66H132V76H108Z" fill="currentColor" opacity=".8"/>
			<path d="M99 98H141M111 109H129M100 163 107 176M140 163 133 176" fill="none" opacity=".7"/>
		</g>
		<text x="16" y="24" fill="currentColor" font-size="9">HR / ${frame.designation}</text><text x="181" y="249" fill="currentColor" font-size="9">${frame.mass} TON</text>
	</svg>`;
};

interface CompanyView { kind: 'weapons' | 'frames'; weapon: WeaponId; frame: FrameId; slot: number | null }
const views = new WeakMap<HTMLElement, CompanyView>();

const mechBayPanes = function (campaign: Campaign, editor: CompanyEditor, actions: CompanyActions): WorkspacePane[] {
	const mech = getOwnedMech(campaign);
	if (!mech) return [{ id: 'fleet', label: 'Fleet', items: textItems('No frame is selected.') }];
	const frame = getFrame(mech.frameId);
	const order = workOrderFor(campaign, mech.frameId);
	const changed = refitDays(mech.loadout, editor.loadout);
	const slot = editor.slot;
	const equipment = slot !== null && !order;
	const ready = canDeploy(campaign);
	const status = changed > 0 ? 'Queue or discard your loadout changes before deployment.' : order ? `Your frame will be ready on day ${order.readyDay}. It cannot deploy while work is in progress.` : mech.integrity <= 0 ? 'This frame needs repairs before it can deploy.' : !mech.loadout.some(function (weapon) { return weapon !== null; }) ? 'This frame is unarmed. Fit at least one weapon and complete the refit before deployment.' : campaign.active ? `${frame.name} will deploy at ${integrityLabel(mech.integrity)} integrity with its installed weapons.` : 'Choose and accept a contract from the command bridge.';
	const mounts = MOUNTS.map(function (binding, index) {
		const weaponId = editor.loadout[index]; const weapon = weaponId ? getWeapon(weaponId) : undefined;
		const different = weaponId !== mech.loadout[index];
		return html`<button class="company-mount ${different ? 'changed' : ''}" data-loadout-slot=${index} aria-pressed=${slot === index} aria-label=${`Mount ${index + 1}: ${weapon?.name ?? 'empty'}. Change weapon.`} ?disabled=${Boolean(order)} @click=${function () { actions.editSlot(index); }}><span class="mount-number">0${index + 1}</span><span><small>${binding.mouse} / ${binding.pad} / ${binding.key}</small><b>${weapon?.name ?? 'EMPTY MOUNT'}</b><em>${different ? 'REFIT PENDING' : weapon?.type ?? 'Select to equip a purchased weapon'}</em></span><span class="mount-change" aria-hidden="true">${order ? '—' : '↗'}</span></button>`;
	});
	const choices = slot === null ? [] : [html`<button class="equipment-choice" data-equip-weapon="empty" aria-pressed=${editor.loadout[slot] === null} @click=${function () { actions.setWeapon(null); }}><b>EMPTY</b><small>Unmount weapon</small></button>`, ...WEAPONS.filter(function (weapon) { return campaign.inventory[weapon.id] > 0; }).map(function (weapon) {
		const used = editor.loadout.filter(function (id, index) { return index !== slot && id === weapon.id; }).length;
		const usable = availableWeapons(campaign, weapon.id, mech.frameId) - used;
		return html`<button class="equipment-choice" data-equip-weapon=${weapon.id} aria-pressed=${editor.loadout[slot] === weapon.id} ?disabled=${usable <= 0} @click=${function () { actions.setWeapon(weapon.id); }}><b>${weapon.name}</b><small>${usable > 0 ? `${usable} available to fit` : 'Allocated elsewhere'}</small></button>`;
	})];
	return [
		{ id: 'fleet', label: 'Fleet', items: [
			html`<span class="eyebrow">${campaign.fleet.length} / ${FRAMES.length} FRAMES OWNED</span>`,
			...campaign.fleet.map(function (owned) { const definition = getFrame(owned.frameId); const job = workOrderFor(campaign, owned.frameId); return html`<button class="fleet-frame" data-owned-frame=${owned.frameId} aria-pressed=${owned.frameId === campaign.selectedFrame} @click=${function () { actions.selectFrame(owned.frameId); }} style="--frame-color:${definition.color}"><span>${definition.mass}T / ${definition.role}</span><b>${definition.name}</b><small>${integrityLabel(owned.integrity)} INTEGRITY · ${job ? `READY DAY ${job.readyDay}` : owned.integrity <= 0 ? 'REPAIR REQUIRED' : 'AVAILABLE'}</small></button>`; }),
			...textItems('Each chassis is purchased once and includes its signature weapon. Equipment stays with its frame between sorties.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('market'); }}>ACQUIRE FRAME →</button>` },
		{ id: 'condition', label: 'Condition', items: [
			html`<div style="--frame-color:${frame.color}"><span class="eyebrow">${frame.role.toUpperCase()} / FRAME ${frame.designation}</span><h2>${frame.name}</h2></div>`, frameSchematic(frame),
			html`<div class="company-integrity"><span>FRAME INTEGRITY</span><b class=${mech.integrity < 35 ? 'negative' : ''}>${integrityLabel(mech.integrity)}</b><div class="track"><i style="width:${mech.integrity}%"></i></div></div>`,
			html`<dl class="frame-specifications"><dt>CRUISE</dt><dd>${frame.speed} m/s</dd><dt>COOLING</dt><dd>${frame.cooling} heat/s</dd><dt>MASS</dt><dd>${frame.mass} tonnes</dd></dl>`,
			...textItems(frame.tradeoff),
		], ...(mech.integrity < 100 ? { actions: html`<button class="secondary" @click=${function () { actions.navigate('engineering'); }}>${mech.integrity <= 0 ? 'RECOVER FRAME' : 'SCHEDULE REPAIRS'} →</button>` } : {}) },
		{ id: 'loadout', label: equipment ? `Mount ${slot + 1}` : 'Loadout', items: equipment ? choices : [
			...mounts,
			...textItems(order ? `${order.kind === 'repair' ? 'Repairs' : 'Refit'} underway. Ready day ${order.readyDay} · ${daysLabel(order.readyDay - campaign.day)} remaining.` : changed > 0 ? `Fitting estimate: ${daysLabel(changed)}. Ready day ${campaign.day + changed}. Parts are reserved when queued. Installed weapons stay in place until work finishes.` : 'Select a mount to change its weapon. Each changed mount requires one calendar day of fitting work. Weapons must be purchased first.'),
			...(changed > 0 && !editor.loadout.some(function (weapon) { return weapon !== null; }) ? textItems('An unarmed frame cannot deploy. Removed equipment returns to stores when the refit finishes.') : []),
			html`<span class="eyebrow">${campaign.active ? `ACCEPTED / ${campaign.active.title}` : 'NO CONTRACT ACCEPTED'}</span>`, ...textItems(status),
		], actions: equipment ? html`<button class="secondary" @click=${actions.closePicker}>BACK TO MOUNTS</button><button class="text-button" @click=${function () { actions.navigate('market'); }}>MARKET →</button>` : changed > 0 ? html`<button id="queue-refit" class="primary" ?disabled=${!canRefit(campaign, mech.frameId, editor.loadout)} @click=${actions.queueRefit}>QUEUE ${daysLabel(changed)} REFIT →</button><button class="text-button" @click=${actions.discardRefit}>DISCARD</button>` : order ? html`<button class="secondary" @click=${function () { actions.navigate('engineering'); }}>VIEW ENGINEERING →</button>` : !campaign.active ? html`<button class="primary" @click=${function () { actions.navigate('bridge'); }}>FIND A CONTRACT →</button>` : html`<button id="company-deploy" class="primary" ?disabled=${!ready} @click=${actions.deploy}>DEPLOY ${frame.name} ↘</button>` },
	];
};

const marketPanes = function (root: HTMLElement, campaign: Campaign, view: CompanyView, actions: CompanyActions, refresh: () => void): WorkspacePane[] {
	const weapon = getWeapon(view.weapon); const frame = getFrame(view.frame);
	const weaponMarket = view.kind === 'weapons';
	const price = weaponMarket ? WEAPON_PRICES[weapon.id] : FRAME_PRICES[frame.id];
	const owned = !weaponMarket && Boolean(getOwnedMech(campaign, frame.id));
	const affordable = campaign.credits >= price;
	const select = function () { refresh(); selectWorkspacePane(root, 'details', true); };
	return [
		{ id: 'catalogue', label: 'Catalogue', items: [
			html`<div class="market-kind"><button aria-pressed=${weaponMarket} @click=${function () { view.kind = 'weapons'; refresh(); }}>WEAPONS</button><button aria-pressed=${!weaponMarket} @click=${function () { view.kind = 'frames'; refresh(); }}>FRAMES</button></div>`,
			...(weaponMarket ? WEAPONS.map(function (item) { return html`<button class="catalogue-item" data-market-weapon=${item.id} style="--item-color:${item.color}" aria-pressed=${item.id === weapon.id} @click=${function () { view.weapon = item.id; select(); }}><span><b>${item.name}</b><small>${item.type} · ${campaign.inventory[item.id]} owned</small></span><span>${creditsLabel(WEAPON_PRICES[item.id])}</span></button>`; }) : FRAMES.map(function (item) { return html`<button class="catalogue-item" data-market-frame=${item.id} style="--item-color:${item.color}" aria-pressed=${item.id === frame.id} @click=${function () { view.frame = item.id; select(); }}><span><b>${item.name}</b><small>${item.mass}T / ${item.role}</small></span><span>${getOwnedMech(campaign, item.id) ? 'OWNED' : creditsLabel(FRAME_PRICES[item.id])}</span></button>`; })),
			...textItems('Purchases arrive immediately. Installing weapons requires a refit in the Mech Bay. Each chassis can be purchased once and includes its signature weapon.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('mechbay'); }}>EQUIP PURCHASES →</button>` },
		{ id: 'details', label: 'Item details', items: weaponMarket ? [
			html`<span class="eyebrow">${weapon.type.toUpperCase()}</span><h2 style="color:${weapon.color}">${weapon.name}</h2>`,
			...textItems(weapon.description),
			html`<dl class="frame-specifications"><dt>RANGE</dt><dd>${weapon.range} m</dd><dt>HEAT</dt><dd>${weapon.heat} / ${weapon.kind === 'laser' ? 'second' : 'shot'}</dd><dt>OWNED</dt><dd>${campaign.inventory[weapon.id]}</dd><dt>IN STORES</dt><dd>${availableWeapons(campaign, weapon.id)}</dd></dl>`,
			...textItems(affordable ? `${creditsLabel(price)}. Buy another copy to equip the same weapon on another mount or frame.` : `Price ${creditsLabel(price)}. Need ${creditsLabel(price - campaign.credits)} more.`),
		] : [
			html`<div style="--frame-color:${frame.color}"><span class="eyebrow">${frame.mass}T / ${frame.role.toUpperCase()}</span><h2>${frame.name}</h2></div>`, frameSchematic(frame),
			...textItems(frame.description), ...textItems(frame.tradeoff),
			html`<p class="workspace-copy">INCLUDES ${getWeapon(frame.starter).name} · ${owned ? 'ALREADY IN YOUR HANGAR' : creditsLabel(price)}</p>`,
		], actions: html`<button class="secondary" @click=${function () { selectWorkspacePane(root, 'catalogue'); }}>CATALOGUE</button><button class="primary purchase-button" data-buy-weapon=${weaponMarket ? weapon.id : ''} data-buy-frame=${weaponMarket ? '' : frame.id} ?disabled=${owned || !affordable || Boolean(campaign.deployed)} @click=${function () { if (weaponMarket) actions.buyWeapon(weapon.id); else actions.buyFrame(frame.id); }}>${owned ? 'OWNED' : `BUY · ${creditsLabel(price)}`}</button>` },
	];
};

const engineeringPanes = function (campaign: Campaign, actions: CompanyActions): WorkspacePane[] {
	const ordered = [...campaign.workOrders].sort(function (a, b) { return a.readyDay - b.readyDay; });
	const next = ordered[0];
	return [
		{ id: 'calendar', label: 'Calendar', items: [
			html`<span class="eyebrow">SHIP CALENDAR</span><h2>DAY ${String(campaign.day).padStart(2, '0')}</h2>`,
			...textItems(next ? `Next completion: ${getFrame(next.frameId).name} on day ${next.readyDay}. ${ordered.length} active work orders.` : 'No scheduled work. Your crews are standing by.'),
			...textItems('Each frame has its own crew. Repairs and refits progress in parallel, completing on the ship calendar.'),
			...textItems('Each jump or sortie also advances work by one day. Waiting does not charge credits or refresh contract postings.'),
		], actions: html`<button id="advance-day" class="secondary" ?disabled=${Boolean(campaign.deployed)} @click=${function () { actions.advanceDays(1); }}>ADVANCE 1 DAY</button><button id="advance-work" class="primary" ?disabled=${!next || Boolean(campaign.deployed)} @click=${function () { if (next) actions.advanceDays(next.readyDay - campaign.day); }}>${next ? `WAIT ${daysLabel(next.readyDay - campaign.day)}` : 'NO WORK PENDING'}</button>` },
		{ id: 'orders', label: 'Work orders', items: ordered.length === 0 ? [html`<div class="company-empty"><b>ALL BAYS CLEAR</b><p>Schedule repairs in Condition or plan a refit in the Mech Bay.</p></div>`] : ordered.flatMap(function (order) {
			const frame = getFrame(order.frameId); const total = order.readyDay - order.startedDay;
			return [html`<article class="work-order" data-work-order=${order.frameId}><div class="work-order-heading"><div><span class="eyebrow">${order.kind === 'repair' ? 'RESTORATION' : 'WEAPON REFIT'}</span><h3>${frame.name}</h3></div><strong>${daysLabel(order.readyDay - campaign.day)}</strong></div><div class="work-order-dates"><span>STARTED ${order.startedDay}</span><b>READY DAY ${order.readyDay}</b></div><div class="track"><i style="width:${total > 0 ? (campaign.day - order.startedDay) / total * 100 : 100}%"></i></div></article>`, html`<button class="secondary" data-cancel-work=${order.frameId} @click=${function () { actions.cancelWork(order.frameId); }}>CANCEL ${frame.name} ORDER</button>`, ...textItems(order.kind === 'repair' ? `${frame.name}: restore integrity to 100%. Weapons stay installed.` : `${frame.name} refit: ${order.loadout.map(function (weapon, index) { return `${index + 1}: ${weapon ? getWeapon(weapon).name : 'Empty'}`; }).join(' · ')}`)];
		}).concat(textItems('Cancellation keeps the original condition and installed loadout. Elapsed days are not refunded.')) },
		{ id: 'condition', label: 'Condition', items: [
			...campaign.fleet.flatMap(function (mech) {
				const frame = getFrame(mech.frameId); const order = workOrderFor(campaign, mech.frameId); const days = repairDays(mech.integrity);
				return [html`<article class="maintenance-frame" data-maintenance-frame=${mech.frameId}><div><b>${frame.name}</b><strong class=${mech.integrity < 35 ? 'negative' : ''}>${integrityLabel(mech.integrity)}</strong></div><div class="track"><i style="width:${mech.integrity}%"></i></div><p>${order ? `${order.kind === 'repair' ? 'Repair' : 'Refit'} underway · ready day ${order.readyDay}` : mech.integrity >= 100 ? 'Fully serviced.' : `${daysLabel(days)} to restore · ready day ${campaign.day + days}`}</p></article>`, html`<button class="secondary" data-repair-frame=${mech.frameId} ?disabled=${Boolean(order) || mech.integrity >= 100 || Boolean(campaign.deployed)} @click=${function () { actions.repair(mech.frameId); }}>${frame.name} · ${order ? 'WORK IN PROGRESS' : mech.integrity >= 100 ? 'FRAME INTACT' : `REPAIR · ${daysLabel(days)}`}</button>`];
			}), ...textItems('Your own crews repair without a credit fee. Every 20 missing integrity takes one day; a wrecked frame needs five days.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('mechbay'); }}>MECH BAY →</button>` },
	];
};

export const renderCompany = function (root: HTMLElement, campaign: Campaign, screen: CompanyScreen, editor: CompanyEditor, saved: boolean, actions: CompanyActions) {
	let view = views.get(root);
	if (!view) { view = { kind: 'weapons', weapon: 'autocannon', frame: 'warden', slot: null }; views.set(root, view); }
	const previousSlot = view.slot;
	view.slot = editor.slot;
	const refresh = function () { renderCompany(root, campaign, screen, editor, saved, actions); };
	const panes = screen === 'mechbay' ? mechBayPanes(campaign, editor, actions) : screen === 'market' ? marketPanes(root, campaign, view, actions, refresh) : engineeringPanes(campaign, actions);
	const footer = html`<footer class="bridge-footer"><div><button @click=${function () { actions.navigate('bridge'); }}>CONTRACTS</button><button @click=${actions.handbook}>HANDBOOK</button><button @click=${actions.settings}>SETTINGS</button></div><span class=${saved ? 'save-notice' : 'save-notice storage-warning'} role="status">${saved ? 'COMPANY SAVED' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span><a href="https://deegeegames.com/">← DEEGEE GAMES</a></footer>`;
	const announcedPanes = editor.notice ? panes.map(function (pane) { return { ...pane, items: [...textItems(editor.notice), ...pane.items] }; }) : panes;
	renderWorkspace(root, renderShipHeader(campaign, screen, actions.navigate), announcedPanes, footer, screen === 'mechbay' ? 'loadout' : screen === 'market' ? 'catalogue' : 'calendar');
	if (screen === 'mechbay' && (editor.slot !== previousSlot || editor.slot !== null)) selectWorkspacePane(root, 'loadout');
};
