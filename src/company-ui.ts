import { html } from 'lit-html';
import { renderWorkspace, selectWorkspacePane, textItems, type WorkspacePane } from './workspace';
import { getWeapon, WEAPONS, WEAPON_FAMILY_LABELS, type WeaponId } from './arsenal';
import { canEquipWeapon, getHardpoints } from './hardpoints';
import { getPlanet, type Campaign } from './campaign';
import { availableWeapons, canDeploy, canRefit, getOwnedMech, refitDays, repairDays, WEAPON_PRICES, workOrderFor } from './company';
import { FRAMES, getFrame, type FrameDefinition, type FrameId } from './frames';
import { hardpointSummary, loadSummary, massLabel, sustainedHeat, supplySummary } from './loadout-ui';
import { frameWeight, loadedMounts, usableMount } from './combat-resources';

export type CompanyScreen = 'mechbay' | 'market' | 'engineering';
export type ShipScreen = 'starmap' | 'bridge' | CompanyScreen;
export interface CompanyEditor {
	loadout: readonly (WeaponId | null)[];
	reserves: readonly number[];
	slot: number | null;
	notice: string;
}
export interface CompanyActions {
	navigate: (screen: ShipScreen) => void;
	selectFrame: (frameId: FrameId) => void;
	editSlot: (slot: number) => void;
	setWeapon: (weapon: WeaponId | null) => void;
	setReserve: (slot: number, rounds: number) => void;
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

export const SHIP_SECTIONS: readonly { id: ShipScreen; label: string; number: string }[] = [
	{ id: 'starmap', label: 'Starmap', number: '01' },
	{ id: 'bridge', label: 'Contracts', number: '02' },
	{ id: 'mechbay', label: 'Mech Bay', number: '03' },
	{ id: 'market', label: 'Market', number: '04' },
	{ id: 'engineering', label: 'Engineering', number: '05' },
];
const daysLabel = function (days: number) { return `${days} ${days === 1 ? 'DAY' : 'DAYS'}`; };
const creditsLabel = function (credits: number) { return `${credits.toLocaleString()} CR`; };
const integrityLabel = function (integrity: number) { return `${Math.ceil(integrity)}%`; };
const renderHullIntegrity = function (integrity: number) {
	const condition = integrity <= 0 ? 'disabled' : integrity < 35 ? 'critical' : integrity < 100 ? 'damaged' : 'intact';
	return html`<span class="hull-integrity" data-hull-condition=${condition}>
		<span class="hull-integrity-heading"><span>HULL INTEGRITY</span><strong>${integrityLabel(integrity)}</strong></span>
		<span class="hull-integrity-track"><i style="width:${integrity}%"></i></span>
		<span class="hull-condition">${condition === 'disabled' ? 'DISABLED · REPAIRS REQUIRED' : condition === 'critical' ? 'CRITICAL DAMAGE' : condition === 'damaged' ? 'HULL DAMAGED' : 'HULL INTACT'}</span>
	</span>`;
};

export const isShipScreen = function (value: string): value is ShipScreen { return SHIP_SECTIONS.some(function (section) { return section.id === value; }); };
export const adjacentShipScreen = function (screen: ShipScreen, delta: number): ShipScreen {
	const index = SHIP_SECTIONS.findIndex(function (section) { return section.id === screen; });
	return SHIP_SECTIONS[(index + delta + SHIP_SECTIONS.length) % SHIP_SECTIONS.length]?.id ?? screen;
};
export const renderShipHeader = function (campaign: Campaign, screen: ShipScreen, navigate: (screen: ShipScreen) => void, locked = false) {
	return html`
		<header class="bridge-header">
			<div class="bridge-brand"><span class="insignia" aria-hidden="true">HR</span><div><span class="eyebrow">HEAVY RIG / FRONTIER COMPANY</span><h1>WAYFARER<span>COMPANY OPERATIONS</span></h1></div></div>
			<div class="career-stats"><div><small>IN ORBIT</small><b>${getPlanet(campaign.planetId).name}</b></div><div><small>COMPANY FUNDS</small><b>${campaign.credits.toLocaleString()} <em>CR</em></b></div><div><small>SHIP CALENDAR</small><b>DAY ${String(campaign.day).padStart(2, '0')}</b></div></div>
		</header>
		<nav class="ship-navigation" aria-label="Company departments">
			<button class="nav-step" ?disabled=${locked} aria-label="Previous department" @click=${function () { navigate(adjacentShipScreen(screen, -1)); }}><span data-menu-glyph="previousDepartment"></span></button>
			${SHIP_SECTIONS.map(function (section) { return html`<button ?disabled=${locked} data-ship-screen=${section.id} aria-current=${screen === section.id ? 'page' : 'false'} @click=${function () { navigate(section.id); }}><small>${section.number}</small><span>${section.label}</span>${section.id === 'engineering' && campaign.workOrders.length > 0 ? html`<b aria-label=${`${campaign.workOrders.length} active work orders`}>${campaign.workOrders.length}</b>` : ''}</button>`; })}
			<button class="nav-step" ?disabled=${locked} aria-label="Next department" @click=${function () { navigate(adjacentShipScreen(screen, 1)); }}><span data-menu-glyph="nextDepartment"></span></button>
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
	const ammoChanged = editor.reserves.some(function (rounds, index) { return rounds !== mech.reserves[index]; });
	const draft = changed > 0 || ammoChanged;
	const hardpoints = getHardpoints(frame.id);
	const slot = editor.slot;
	const selectedHardpoint = slot === null ? undefined : hardpoints[slot];
	const equipment = slot !== null && selectedHardpoint !== undefined && !order;
	const ready = canDeploy(campaign);
	const status = draft ? 'Apply or discard your loadout changes before deployment.' : order ? `Your frame will be ready on day ${order.readyDay}. It cannot deploy while work is in progress.` : mech.integrity <= 0 ? 'This frame needs repairs before it can deploy.' : !loadedMounts(mech.loadout, mech.reserves).some(usableMount) ? 'This frame has no usable weapons. Load ammunition or fit an energy weapon before deployment.' : campaign.active ? `${frame.name} will deploy at ${integrityLabel(mech.integrity)} integrity with its installed weapons.` : 'Choose and accept a contract from the command bridge.';
	const mounts = hardpoints.map(function (hardpoint, index) {
		const weaponId = editor.loadout[index]; const weapon = weaponId ? getWeapon(weaponId) : undefined;
		const different = weaponId !== mech.loadout[index] || editor.reserves[index] !== mech.reserves[index];
		const family = WEAPON_FAMILY_LABELS[hardpoint.family];
		return html`<button class="company-mount ${different ? 'changed' : ''}" data-loadout-slot=${index} data-hardpoint-type=${hardpoint.family} aria-pressed=${slot === index} aria-label=${`Mount ${index + 1}, ${hardpoint.name}, ${family}: ${weapon?.name ?? 'empty'}. Change weapon.`} ?disabled=${Boolean(order)} @click=${function () { actions.editSlot(index); }}><span class="mount-number">0${index + 1}</span><span><small class="hardpoint-location">${hardpoint.name} · ${family}</small><b>${weapon?.name ?? 'EMPTY MOUNT'}</b><em>${different ? 'DRAFT · ' : ''}${weapon?.type ?? (hardpoint.family === 'launcher' ? 'Fits missiles / rockets' : `Fits ${hardpoint.weapons.map(function (id) { return getWeapon(id).type; }).join(' / ')}`)}</em></span><span class="mount-change" aria-hidden="true">${order ? '—' : '↗'}</span></button>`;
	});
	const reserves = hardpoints.flatMap(function (hardpoint, index) {
		const id = editor.loadout[index]; if (!id) return [];
		const weapon = getWeapon(id); const ammunition = weapon.ammunition;
		if (!ammunition) return textItems(`${hardpoint.name}: ${massLabel(weapon.mass)} hardware · no ammunition · ${sustainedHeat(weapon).toFixed(1)} heat/s sustained.`);
		const rounds = editor.reserves[index] ?? 0; const step = Math.max(1, Math.round(ammunition.capacity / 20));
		return [html`<div class="ammunition-control" data-ammunition-slot=${index}><div><b>${hardpoint.name} / ${weapon.name}</b><span>${rounds} / ${ammunition.capacity} ROUNDS · ${massLabel(rounds * ammunition.mass)} AMMO</span></div><div class="ammunition-buttons">${[{ label: 'ZERO', value: 0 }, { label: '−', value: Math.max(0, rounds - step) }, { label: '+', value: Math.min(ammunition.capacity, rounds + step) }, { label: 'STD', value: ammunition.defaultLoad }, { label: 'MAX', value: ammunition.capacity }].map(function (choice) { return html`<button data-ammo-choice=${`${index}-${choice.label}`} aria-label=${`${hardpoint.name}, ${choice.label === '−' ? 'decrease ammunition' : choice.label === '+' ? 'increase ammunition' : choice.label === 'STD' ? 'standard ammunition' : choice.label === 'MAX' ? 'maximum ammunition' : 'unload ammunition'}, ${choice.value} rounds`} ?disabled=${Boolean(order) || Boolean(campaign.deployed) || rounds === choice.value} @click=${function () { actions.setReserve(index, choice.value); }}>${choice.label}</button>`; })}</div><small>${massLabel(weapon.mass)} HARDWARE · ${sustainedHeat(weapon).toFixed(1)} HEAT/S SUSTAINED</small></div>`];
	});
	const compatibleOwned = slot === null ? [] : WEAPONS.filter(function (weapon) { return campaign.inventory[weapon.id] > 0 && canEquipWeapon(frame.id, slot, weapon.id); });
	const choices = !equipment || slot === null || !selectedHardpoint ? [] : [
		...textItems(`${selectedHardpoint.name} · ${WEAPON_FAMILY_LABELS[selectedHardpoint.family]} hardpoint. Fits: ${selectedHardpoint.weapons.map(function (id) { return `${getWeapon(id).name} (${getWeapon(id).type})`; }).join(', ')}.`),
		html`<button class="equipment-choice" data-equip-weapon="empty" aria-pressed=${editor.loadout[slot] === null} @click=${function () { actions.setWeapon(null); }}><b>EMPTY</b><small>Unmount weapon</small></button>`,
		...compatibleOwned.map(function (weapon) {
			const used = editor.loadout.filter(function (id, index) { return index !== slot && id === weapon.id; }).length;
			const usable = availableWeapons(campaign, weapon.id, mech.frameId) - used;
			return html`<button class="equipment-choice" data-equip-weapon=${weapon.id} data-weapon-family=${weapon.family} aria-pressed=${editor.loadout[slot] === weapon.id} ?disabled=${usable <= 0} @click=${function () { actions.setWeapon(weapon.id); }}><span><b>${weapon.name}</b><small>${WEAPON_FAMILY_LABELS[weapon.family]} · ${weapon.type}</small></span><small>${usable > 0 ? `${usable} available to fit` : 'Allocated elsewhere'}</small></button>`;
		}),
		...(compatibleOwned.length === 0 ? textItems('No compatible weapons owned. Buy equipment for this hardpoint at the Market.') : []),
		...textItems('Only compatible owned weapons are listed. Other weapon families cannot be fitted here.'),
	];
	return [
		{ id: 'fleet', label: 'Fleet', items: [
			html`<span class="eyebrow">${campaign.fleet.length} / ${FRAMES.length} VARIANTS OWNED</span>`,
			...campaign.fleet.map(function (owned) { const definition = getFrame(owned.frameId); const job = workOrderFor(campaign, owned.frameId); return html`<button class="fleet-frame" data-owned-frame=${owned.frameId} aria-pressed=${owned.frameId === campaign.selectedFrame} @click=${function () { actions.selectFrame(owned.frameId); }} style="--frame-color:${definition.color}"><span>${definition.mass}T / ${definition.role}</span><b>${definition.chassisName} ${definition.variant}</b><small>${definition.variantName}</small>${renderHullIntegrity(owned.integrity)}<small>${job ? `READY DAY ${job.readyDay}` : owned.integrity <= 0 ? 'REPAIR REQUIRED' : 'AVAILABLE'}</small></button>`; }),
			...textItems('Each variant is a separate purchase with its own equipment, condition, ammunition settings, and workshop crew. Includes one signature weapon.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('market'); }}>ACQUIRE FRAME →</button>` },
		{ id: 'condition', label: 'Condition', items: [
			html`<div style="--frame-color:${frame.color}"><span class="eyebrow">${frame.role.toUpperCase()} / FRAME ${frame.designation}</span><h2>${frame.chassisName} ${frame.variant}</h2><p class="workspace-copy">${frame.variantName}</p></div>`,
			renderHullIntegrity(mech.integrity),
			html`<dl class="frame-specifications"><dt>CRUISE</dt><dd>${frame.speed} m/s</dd><dt>COOLING</dt><dd>${frame.cooling} heat/s</dd><dt>BASE MASS</dt><dd>${massLabel(frame.mass)} incl. fixed equipment</dd><dt>RECOMMENDED</dt><dd>${massLabel(frame.recommendedMass)}</dd></dl>`,
			...textItems(`INSTALLED: ${loadSummary(frame.id, mech.loadout, mech.reserves)}`),
			...textItems(hardpointSummary(frame.id)), ...textItems(frame.tradeoff),
		] },
		{ id: 'loadout', label: equipment && slot !== null ? `Mount ${slot + 1}` : 'Loadout', items: equipment ? choices : [
			...textItems(`INSTALLED: ${loadSummary(frame.id, mech.loadout, mech.reserves)}`),
			...(draft ? textItems(`DRAFT: ${loadSummary(frame.id, editor.loadout, editor.reserves)}`) : []),
			...(order?.kind === 'refit' ? textItems(`PENDING DAY ${order.readyDay}: ${loadSummary(frame.id, order.loadout, order.reserves)}`) : []),
			...mounts, ...reserves,
			...textItems('Ammunition refills free before each sortie. Reserve changes alone cost 0 CR and no workshop time. Extra rounds add weight; firing sheds it.'),
			...textItems(order ? `${order.kind === 'repair' ? 'Repairs' : 'Refit'} underway. Ready day ${order.readyDay} · ${daysLabel(order.readyDay - campaign.day)} remaining.` : changed > 0 ? `Fitting estimate: ${daysLabel(changed)}. Ready day ${campaign.day + changed}. Parts are reserved when queued. Installed weapons stay in place until work finishes.` : `${hardpointSummary(frame.id)} Select a mount to fit a compatible owned weapon. Each changed mount takes one calendar day.`),
			...(changed > 0 && !editor.loadout.some(function (weapon) { return weapon !== null; }) ? textItems('An unarmed frame cannot deploy. Removed equipment returns to stores when the refit finishes.') : []),
			html`<span class="eyebrow">${campaign.active ? `ACCEPTED / ${campaign.active.title}` : 'NO CONTRACT ACCEPTED'}</span>`, ...textItems(status),
		], actions: equipment ? html`<button class="secondary" @click=${actions.closePicker}>BACK TO MOUNTS</button><button class="text-button" @click=${function () { actions.navigate('market'); }}>MARKET →</button>` : draft ? html`<button id="queue-refit" class="primary" ?disabled=${!canRefit(campaign, mech.frameId, editor.loadout, editor.reserves)} @click=${actions.queueRefit}>${changed > 0 ? `QUEUE ${daysLabel(changed)} REFIT →` : 'APPLY AMMUNITION · FREE'}</button><button class="text-button" data-discard-refit @click=${actions.discardRefit}>DISCARD DRAFT</button>` : order ? html`<button class="secondary" @click=${function () { actions.navigate('engineering'); }}>VIEW ENGINEERING →</button>` : !campaign.active ? html`<button class="primary" @click=${function () { actions.navigate('bridge'); }}>FIND A CONTRACT →</button>` : html`<button id="company-deploy" class="primary" ?disabled=${!ready} @click=${actions.deploy}>DEPLOY ${frame.name} ↘</button>` },
	];
};

const marketPanes = function (root: HTMLElement, campaign: Campaign, view: CompanyView, actions: CompanyActions, refresh: () => void): WorkspacePane[] {
	const weapon = getWeapon(view.weapon); const frame = getFrame(view.frame);
	const weaponMarket = view.kind === 'weapons';
	const price = weaponMarket ? WEAPON_PRICES[weapon.id] : frame.price;
	const owned = !weaponMarket && Boolean(getOwnedMech(campaign, frame.id));
	const affordable = campaign.credits >= price;
	const select = function () { refresh(); selectWorkspacePane(root, 'details', true); };
	return [
		{ id: 'catalogue', label: 'Catalogue', items: [
			...(weaponMarket ? WEAPONS.map(function (item) { return html`<button class="catalogue-item" data-market-weapon=${item.id} style="--item-color:${item.color}" aria-pressed=${item.id === weapon.id} @click=${function () { view.weapon = item.id; select(); }}><span><b>${item.name}</b><small>${WEAPON_FAMILY_LABELS[item.family]} · ${campaign.inventory[item.id]} owned</small></span><span>${creditsLabel(WEAPON_PRICES[item.id])}</span></button>`; }) : FRAMES.map(function (item) { return html`<button class="catalogue-item" data-market-frame=${item.id} style="--item-color:${item.color}" aria-pressed=${item.id === frame.id} @click=${function () { view.frame = item.id; select(); }}><span><b>${item.chassisName} ${item.variant}</b><small>${item.variantName} · ${item.mass}T</small></span><span>${getOwnedMech(campaign, item.id) ? 'OWNED' : creditsLabel(item.price)}</span></button>`; })),
			...textItems('Purchases arrive immediately. Installing weapons requires a refit in the Mech Bay. Each variant can be purchased once and includes one signature weapon. Different variants of the same chassis can be owned together.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('mechbay'); }}>EQUIP PURCHASES →</button>` },
		{ id: 'details', label: 'Item details', items: weaponMarket ? [
			html`<span class="eyebrow">${weapon.type.toUpperCase()}</span><h2 style="color:${weapon.color}">${weapon.name}</h2>`,
			...textItems(`${WEAPON_FAMILY_LABELS[weapon.family]} weapon. ${weapon.description}`),
			...FRAMES.filter(function (definition) { return definition.variant === 'A'; }).flatMap(function (chassis) {
				const compatible = FRAMES.filter(function (definition) { return definition.chassisId === chassis.chassisId && getHardpoints(definition.id).some(function (_hardpoint, slot) { return canEquipWeapon(definition.id, slot, weapon.id); }); });
				return compatible.length ? textItems(`Compatible: ${chassis.chassisName} ${compatible.map(function (definition) { return definition.variant; }).join(' / ')}.`) : [];
			}),
			html`<dl class="frame-specifications"><dt>RANGE</dt><dd>${weapon.range} m</dd><dt>HEAT / SUSTAINED</dt><dd>${sustainedHeat(weapon).toFixed(1)} / second</dd><dt>HARDWARE</dt><dd>${massLabel(weapon.mass)}</dd></dl>`,
			...textItems(weapon.ammunition ? `AMMUNITION: ${weapon.ammunition.defaultLoad} standard / ${weapon.ammunition.capacity} maximum rounds per mount. ${massLabel(weapon.ammunition.mass)} per round; ${massLabel(weapon.ammunition.defaultLoad * weapon.ammunition.mass)} standard reserve. Free replenishment between sorties.` : 'AMMUNITION INDEPENDENT: no rounds required. Higher sustained reactor demand; weapons lock at 100 heat and recover at 35.'),
			html`<dl class="frame-specifications"><dt>OWNED</dt><dd>${campaign.inventory[weapon.id]}</dd><dt>IN STORES</dt><dd>${availableWeapons(campaign, weapon.id)}</dd></dl>`,
			...textItems(affordable ? `${creditsLabel(price)}. Buy another copy to equip the same weapon on another mount or frame.` : `Price ${creditsLabel(price)}. Need ${creditsLabel(price - campaign.credits)} more.`),
		] : [
			html`<div style="--frame-color:${frame.color}"><span class="eyebrow">${frame.mass}T / ${frame.role.toUpperCase()}</span><h2>${frame.chassisName} ${frame.variant}</h2><p class="workspace-copy">${frame.variantName}</p></div>`, frameSchematic(frame),
			...textItems(frame.description), ...textItems(`BASE MASS: ${massLabel(frame.mass)} including fixed equipment. RECOMMENDED OPERATING WEIGHT: ${massLabel(frame.recommendedMass)}. Weapons and ammunition add to base mass.`), ...textItems(hardpointSummary(frame.id)), ...textItems(frame.tradeoff),
			...getHardpoints(frame.id).flatMap(function (hardpoint, index) { return textItems(`${index + 1}. ${hardpoint.name} · ${WEAPON_FAMILY_LABELS[hardpoint.family]}: ${hardpoint.weapons.map(function (id) { return getWeapon(id).type; }).join(' / ')}.`); }),
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
			...textItems('Ammunition reserve changes take no workshop time. Selected loads replenish free at deployment; no ammunition is bought or stocked.'),
			...textItems('Each frame has its own crew. Repairs and refits progress in parallel, completing on the ship calendar.'),
			...textItems('Each jump or sortie also advances work by one day. Waiting does not charge credits or refresh contract postings.'),
		], actions: html`<button id="advance-day" class="secondary" ?disabled=${Boolean(campaign.deployed)} @click=${function () { actions.advanceDays(1); }}>ADVANCE 1 DAY</button><button id="advance-work" class="primary" ?disabled=${!next || Boolean(campaign.deployed)} @click=${function () { if (next) actions.advanceDays(next.readyDay - campaign.day); }}>${next ? `WAIT ${daysLabel(next.readyDay - campaign.day)}` : 'NO WORK PENDING'}</button>` },
		{ id: 'orders', label: 'Work orders', items: ordered.length === 0 ? [html`<div class="company-empty"><b>ALL BAYS CLEAR</b><p>Schedule repairs in Condition or plan a refit in the Mech Bay.</p></div>`] : ordered.flatMap(function (order) {
			const frame = getFrame(order.frameId); const total = order.readyDay - order.startedDay;
			return [html`<article class="work-order" data-work-order=${order.frameId}><div class="work-order-heading"><div><span class="eyebrow">${order.kind === 'repair' ? 'RESTORATION' : 'WEAPON REFIT'}</span><h3>${frame.name}</h3></div><strong>${daysLabel(order.readyDay - campaign.day)}</strong></div><div class="work-order-dates"><span>STARTED ${order.startedDay}</span><b>READY DAY ${order.readyDay}</b></div><div class="track"><i style="width:${total > 0 ? (campaign.day - order.startedDay) / total * 100 : 100}%"></i></div></article>`, html`<button class="secondary" data-cancel-work=${order.frameId} @click=${function () { actions.cancelWork(order.frameId); }}>CANCEL ${frame.name} ORDER</button>`, ...textItems(order.kind === 'repair' ? `${frame.name}: restore integrity to 100%. Weapons stay installed.` : `${frame.name} refit: ${order.loadout.map(function (weapon, index) { const hardpoint = getHardpoints(frame.id)[index]; return `${index + 1}. ${hardpoint?.name ?? 'Mount'} (${hardpoint ? WEAPON_FAMILY_LABELS[hardpoint.family] : ''}): ${weapon ? getWeapon(weapon).name : 'Empty'}`; }).join(' · ')}`), ...(order.kind === 'refit' ? textItems(`PENDING: ${loadSummary(frame.id, order.loadout, order.reserves)} ${supplySummary(order.loadout, order.reserves)}`) : [])];
		}).concat(textItems('Cancellation keeps the original condition and installed loadout. Elapsed days are not refunded.')) },
		{ id: 'condition', label: 'Condition', items: [
			...campaign.fleet.flatMap(function (mech) {
				const frame = getFrame(mech.frameId); const order = workOrderFor(campaign, mech.frameId); const days = repairDays(mech.integrity);
				return [html`<article class="maintenance-frame" data-maintenance-frame=${mech.frameId}><div><b>${frame.name}</b></div>${renderHullIntegrity(mech.integrity)}<p>${order ? `${order.kind === 'repair' ? 'Repair' : 'Refit'} underway · ready day ${order.readyDay}` : mech.integrity >= 100 ? 'Fully serviced.' : `${daysLabel(days)} to restore · ready day ${campaign.day + days}`}</p></article>`, html`<button class="secondary" data-repair-frame=${mech.frameId} ?disabled=${Boolean(order) || mech.integrity >= 100 || Boolean(campaign.deployed)} @click=${function () { actions.repair(mech.frameId); }}>${frame.name} · ${order ? 'WORK IN PROGRESS' : mech.integrity >= 100 ? 'FRAME INTACT' : `REPAIR · ${daysLabel(days)}`}</button>`];
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
	const locked = screen === 'mechbay' && editor.slot !== null;
	root.dataset['picker'] = String(locked);
	const footer = html`<footer class="bridge-footer"><div><button @click=${actions.handbook}>HANDBOOK</button><button @click=${actions.settings}>SETTINGS</button></div><span class="company-notice" role="status">${editor.notice}</span><span class="ship-controller-status" hidden></span><span class=${saved ? 'save-notice' : 'save-notice storage-warning'}>${saved ? 'COMPANY SAVED' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span></footer>`;
	const mech = getOwnedMech(campaign); const frame = mech ? getFrame(mech.frameId) : undefined;
	const order = mech ? workOrderFor(campaign, mech.frameId) : undefined;
	const installedWeight = mech && frame ? frameWeight(frame.id, loadedMounts(mech.loadout, mech.reserves)) : undefined;
	const hero = screen === 'mechbay' && mech && frame ? html`
		<div class="hangar-heading"><div><span class="eyebrow">${frame.mass}T / ${frame.variantName}</span><h2>${frame.chassisName} ${frame.variant} <small>/ ${frame.designation}</small></h2></div><span class="eyebrow">ACTIVE FRAME</span></div>
		<div class="hangar-model"><canvas data-hangar-frame=${frame.id} aria-label=${`${frame.name} frame preview`}></canvas><span class="hangar-fallback">${frame.name} / ${frame.role}</span></div>
		<div class="hangar-service">
			${renderHullIntegrity(mech.integrity)}
			${order ? html`<button class="secondary hull-repair" ?disabled=${locked} @click=${function () { actions.navigate('engineering'); }}>VIEW ${order.kind === 'repair' ? 'REPAIRS' : 'REFIT'}<small>READY DAY ${order.readyDay}</small></button>` : mech.integrity < 100 ? html`<button class="secondary hull-repair" data-quick-repair=${mech.frameId} ?disabled=${locked || Boolean(campaign.deployed)} @click=${function () { actions.repair(mech.frameId); }}>REPAIR · ${daysLabel(repairDays(mech.integrity))}<small>0 CR</small></button>` : html``}
		</div>
		<div class="hangar-specs"><div><small>LOADED CRUISE</small><b>${installedWeight?.speed.toFixed(1)}<em>m/s</em></b></div><div><small>COOLING</small><b>${frame.cooling}<em>heat/s</em></b></div></div>
	` : undefined;
	const departmentViews = screen === 'market' ? [
		{ id: 'weapons', label: 'Weapons', panes: ['catalogue', 'details'], select: function () { view.kind = 'weapons'; refresh(); } },
		{ id: 'frames', label: 'Frames', panes: ['catalogue', 'details'], select: function () { view.kind = 'frames'; refresh(); } },
	] : screen === 'mechbay' ? [
		{ id: 'fleet', label: 'Fleet', panes: ['fleet'] }, { id: 'loadout', label: 'Loadout', panes: ['loadout'] }, { id: 'condition', label: 'Condition', panes: ['condition'] },
	] : [
		{ id: 'orders', label: 'Work orders', panes: ['orders'] }, { id: 'condition', label: 'Condition', panes: ['condition'] }, { id: 'calendar', label: 'Calendar', panes: ['calendar'] },
	];
	renderWorkspace(root, renderShipHeader(campaign, screen, actions.navigate, locked), panes, footer, screen === 'mechbay' ? 'loadout' : screen === 'market' ? 'weapons' : 'orders', departmentViews, hero);
	if (screen === 'mechbay' && (editor.slot !== previousSlot || editor.slot !== null)) selectWorkspacePane(root, 'loadout');
};
