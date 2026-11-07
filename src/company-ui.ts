import { html, render } from 'lit-html';
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

const renderMechBay = function (campaign: Campaign, editor: CompanyEditor, actions: CompanyActions) {
	const mech = getOwnedMech(campaign);
	if (!mech) return html`<p class="company-empty">No frame is selected.</p>`;
	const frame = getFrame(mech.frameId);
	const order = workOrderFor(campaign, mech.frameId);
	const changed = refitDays(mech.loadout, editor.loadout);
	const draftValid = canRefit(campaign, mech.frameId, editor.loadout);
	const chosenSlot = editor.slot;
	const ready = canDeploy(campaign);
	return html`
		<div class="company-page-heading"><div><span class="eyebrow">02 / FRAME OPERATIONS</span><h2>YOUR MACHINES.</h2><p>Choose a frame, plan its four mounts, and send fitting work to Engineering.</p></div><span class="company-count">${campaign.fleet.length} / ${FRAMES.length} FRAMES OWNED</span></div>
		<div class="mechbay-layout">
			<aside class="fleet-roster" aria-label="Owned frames"><h3>ACTIVE HANGAR</h3>${campaign.fleet.map(function (owned) {
				const definition = getFrame(owned.frameId); const job = workOrderFor(campaign, owned.frameId);
				return html`<button class="fleet-frame" data-owned-frame=${owned.frameId} aria-pressed=${owned.frameId === campaign.selectedFrame} @click=${function () { actions.selectFrame(owned.frameId); }} style="--frame-color:${definition.color}"><span>${definition.mass}T / ${definition.role}</span><b>${definition.name}</b><small>${integrityLabel(owned.integrity)} INTEGRITY · ${job ? `READY DAY ${job.readyDay}` : owned.integrity <= 0 ? 'REPAIR REQUIRED' : 'AVAILABLE'}</small></button>`;
			})}<button class="secondary fleet-market" @click=${function () { actions.navigate('market'); }}>ACQUIRE ANOTHER FRAME →</button><p class="company-note">Each chassis is purchased once and includes its signature weapon. Equipment stays with its frame between sorties.</p></aside>
			<section class="frame-inspection" style="--frame-color:${frame.color}" aria-label="Selected frame condition">
				<div class="bridge-section-title"><span class="eyebrow">${frame.role.toUpperCase()}</span><span>FRAME ${frame.designation}</span></div><h2>${frame.name}</h2>
				${frameSchematic(frame)}
				<div class="company-integrity"><span>FRAME INTEGRITY</span><b class=${mech.integrity < 35 ? 'negative' : ''}>${integrityLabel(mech.integrity)}</b><div class="track"><i style="width:${mech.integrity}%"></i></div></div>
				<dl class="frame-specifications"><dt>CRUISE</dt><dd>${frame.speed} m/s</dd><dt>COOLING</dt><dd>${frame.cooling} heat/s</dd><dt>MASS</dt><dd>${frame.mass} tonnes</dd></dl><p class="company-note">${frame.tradeoff}</p>
				${mech.integrity < 100 ? html`<button class="secondary" @click=${function () { actions.navigate('engineering'); }}>${mech.integrity <= 0 ? 'RECOVER THIS FRAME' : 'SCHEDULE REPAIRS'} →</button>` : ''}
			</section>
			<section class="loadout-workbench" aria-labelledby="company-loadout-title">
				<div class="bridge-section-title"><span class="eyebrow">WEAPON MOUNTS</span><span>${order ? 'FRAME IN SERVICE' : changed > 0 ? 'UNSCHEDULED CHANGES' : 'INSTALLED LOADOUT'}</span></div><h2 id="company-loadout-title">FIT FOR THE JOB.</h2>
				<div class="company-mounts">${MOUNTS.map(function (binding, index) {
					const weaponId = editor.loadout[index]; const weapon = weaponId ? getWeapon(weaponId) : undefined;
					const different = weaponId !== mech.loadout[index];
					return html`<button class="company-mount ${different ? 'changed' : ''}" data-loadout-slot=${index} aria-pressed=${chosenSlot === index} aria-label=${`Mount ${index + 1}: ${weapon?.name ?? 'empty'}. Change weapon.`} ?disabled=${Boolean(order)} @click=${function () { actions.editSlot(index); }}><span class="mount-number">0${index + 1}</span><span><small>${binding.mouse} / ${binding.pad} / ${binding.key}</small><b>${weapon?.name ?? 'EMPTY MOUNT'}</b><em>${different ? 'REFIT PENDING' : weapon?.type ?? 'Select to equip a purchased weapon'}</em></span><span class="mount-change" aria-hidden="true">${order ? '—' : '↗'}</span></button>`;
				})}</div>
				${chosenSlot !== null && !order ? html`<section class="equipment-picker" aria-label=${`Choose equipment for mount ${chosenSlot + 1}`}><div class="bridge-section-title"><span class="eyebrow">MOUNT ${chosenSlot + 1} / COMPANY ARMORY</span></div><div class="equipment-choices"><button data-equip-weapon="empty" aria-pressed=${editor.loadout[chosenSlot] === null} @click=${function () { actions.setWeapon(null); }}><b>EMPTY</b><small>Unmount weapon</small></button>${WEAPONS.filter(function (weapon) { return campaign.inventory[weapon.id] > 0; }).map(function (weapon) {
					const used = editor.loadout.filter(function (id, index) { return index !== chosenSlot && id === weapon.id; }).length;
					const usable = availableWeapons(campaign, weapon.id, mech.frameId) - used;
					return html`<button data-equip-weapon=${weapon.id} aria-pressed=${editor.loadout[chosenSlot] === weapon.id} ?disabled=${usable <= 0} @click=${function () { actions.setWeapon(weapon.id); }}><b>${weapon.name}</b><small>${usable > 0 ? `${usable} available to fit` : 'Allocated elsewhere'}</small></button>`;
				})}</div><button class="text-button" @click=${function () { actions.navigate('market'); }}>BROWSE WEAPON MARKET →</button></section>` : ''}
				${order ? html`<div class="service-note"><b>${order.kind === 'repair' ? 'REPAIRS UNDERWAY' : 'REFIT UNDERWAY'}</b><p>Ready on day ${order.readyDay} · ${daysLabel(order.readyDay - campaign.day)} remaining. The frame cannot deploy while work is in progress.</p><button class="secondary" @click=${function () { actions.navigate('engineering'); }}>VIEW WORK ORDER →</button></div>` : changed > 0 ? html`<div class="refit-estimate"><div><span class="eyebrow">FITTING ESTIMATE</span><strong>${daysLabel(changed)}</strong><p>Ready day ${campaign.day + changed}. Parts are reserved when you queue the order. Installed weapons stay in place until work finishes.</p>${!editor.loadout.some(function (weapon) { return weapon !== null; }) ? html`<p class="negative">An unarmed frame cannot deploy. Removed equipment returns to stores when the refit finishes.</p>` : ''}</div><button id="queue-refit" class="primary" ?disabled=${!draftValid} @click=${actions.queueRefit}>QUEUE REFIT <span>→</span></button><button class="text-button" @click=${actions.discardRefit}>DISCARD CHANGES</button></div>` : html`<p class="company-note">Select a mount to change its weapon. Each changed mount requires one calendar day of fitting work. Weapons must be purchased first.</p>`}
				<div class="company-deploy"><span class="eyebrow">${campaign.active ? `ACCEPTED / ${campaign.active.title}` : 'NO CONTRACT ACCEPTED'}</span><p>${changed > 0 ? 'Queue or discard your loadout changes before deployment.' : order ? `Your frame will be ready on day ${order.readyDay}.` : mech.integrity <= 0 ? 'This frame needs repairs before it can deploy.' : !mech.loadout.some(function (weapon) { return weapon !== null; }) ? 'This frame is unarmed. Fit at least one weapon and complete the refit before deployment.' : campaign.active ? `${frame.name} will deploy at ${integrityLabel(mech.integrity)} integrity with its installed weapons.` : 'Choose and accept a contract from the command bridge.'}</p><button id="company-deploy" class="primary" ?disabled=${!ready || changed > 0} @click=${actions.deploy}>DEPLOY ${frame.name} <span>↘</span></button>${!campaign.active ? html`<button class="secondary" @click=${function () { actions.navigate('bridge'); }}>FIND A CONTRACT →</button>` : ''}</div>
			</section>
		</div>
	`;
};

const renderMarket = function (campaign: Campaign, actions: CompanyActions) {
	return html`
		<div class="company-page-heading"><div><span class="eyebrow">03 / PROCUREMENT EXCHANGE</span><h2>BUILD YOUR COMPANY.</h2><p>Buy armaments for your inventory or acquire a complete frame. Purchases are available immediately; fitting takes time.</p></div><span class="company-count">${creditsLabel(campaign.credits)} AVAILABLE</span></div>
		<section aria-labelledby="weapon-market-title"><div class="market-section-heading"><h3 id="weapon-market-title">ARMAMENTS</h3><button class="text-button" @click=${function () { actions.navigate('mechbay'); }}>EQUIP PURCHASED WEAPONS →</button></div><div class="weapon-market-grid">${WEAPONS.map(function (weapon) {
			const price = WEAPON_PRICES[weapon.id]; const affordable = campaign.credits >= price;
			return html`<article class="market-weapon" style="--weapon-color:${weapon.color}"><div class="market-weapon-title"><span aria-hidden="true">${weapon.icon}</span><div><small>${weapon.type.toUpperCase()}</small><h3>${weapon.name}</h3></div></div><p>${weapon.description}</p><div class="weapon-market-spec"><span>${weapon.range}m RANGE</span><span>${weapon.kind === 'laser' ? `${weapon.heat} HEAT / S` : `${weapon.heat} HEAT / SHOT`}</span></div><div class="stock-count"><span>${campaign.inventory[weapon.id]} OWNED</span><span>${availableWeapons(campaign, weapon.id)} IN STORES</span></div><button class="secondary purchase-button" data-buy-weapon=${weapon.id} ?disabled=${!affordable || Boolean(campaign.deployed)} @click=${function () { actions.buyWeapon(weapon.id); }}><b>BUY · ${creditsLabel(price)}</b><span>${affordable ? '+' : `NEED ${creditsLabel(price - campaign.credits)}`}</span></button></article>`;
		})}</div></section>
		<section aria-labelledby="frame-market-title"><div class="market-section-heading"><h3 id="frame-market-title">COMPLETE FRAMES</h3><span class="company-note">SIGNATURE WEAPON INCLUDED / ONE OF EACH CHASSIS</span></div><div class="frame-market-grid">${FRAMES.map(function (frame) {
			const owned = Boolean(getOwnedMech(campaign, frame.id)); const price = FRAME_PRICES[frame.id]; const affordable = campaign.credits >= price;
			return html`<article class="market-frame" style="--frame-color:${frame.color}"><div class="market-frame-art">${frameSchematic(frame)}</div><div class="market-frame-body"><span class="eyebrow">${frame.mass}T / ${frame.role.toUpperCase()}</span><h3>${frame.name}</h3><p>${frame.description}</p><p class="company-note">${frame.tradeoff}</p><span class="included-weapon">INCLUDES ${getWeapon(frame.starter).name}</span><button class="secondary purchase-button" data-buy-frame=${frame.id} ?disabled=${owned || !affordable || Boolean(campaign.deployed)} @click=${function () { actions.buyFrame(frame.id); }}><b>${owned ? 'IN YOUR HANGAR' : `BUY · ${creditsLabel(price)}`}</b><span>${owned ? '✓' : affordable ? '+' : `NEED ${creditsLabel(price - campaign.credits)}`}</span></button></div></article>`;
		})}</div></section>
	`;
};

const renderEngineering = function (campaign: Campaign, actions: CompanyActions) {
	const ordered = [...campaign.workOrders].sort(function (a, b) { return a.readyDay - b.readyDay; });
	const next = ordered[0];
	return html`
		<div class="company-page-heading"><div><span class="eyebrow">04 / ENGINEERING DECK</span><h2>TIME TO REBUILD.</h2><p>Repairs and refits complete on the ship calendar. Each frame has its own crew; work progresses in parallel.</p></div><span class="company-count">${ordered.length} ACTIVE ${ordered.length === 1 ? 'ORDER' : 'ORDERS'}</span></div>
		<div class="engineering-layout"><section class="engineering-schedule" aria-labelledby="schedule-title"><div class="calendar-console"><div><span class="eyebrow">SHIP CALENDAR</span><h2 id="schedule-title">DAY ${String(campaign.day).padStart(2, '0')}</h2><p>${next ? `Next completion: ${getFrame(next.frameId).name} on day ${next.readyDay}.` : 'No scheduled work. Your crews are standing by.'}</p></div><div class="calendar-actions"><button id="advance-day" class="secondary" ?disabled=${Boolean(campaign.deployed)} @click=${function () { actions.advanceDays(1); }}>ADVANCE 1 DAY</button><button id="advance-work" class="primary" ?disabled=${!next || Boolean(campaign.deployed)} @click=${function () { if (next) actions.advanceDays(next.readyDay - campaign.day); }}>${next ? `WAIT ${daysLabel(next.readyDay - campaign.day)}` : 'NO WORK PENDING'} <span>→</span></button></div></div>
			<div class="work-order-list" aria-label="Scheduled work">${ordered.length === 0 ? html`<div class="company-empty"><span aria-hidden="true">◇</span><b>ALL BAYS CLEAR</b><p>Schedule repairs below or plan a refit in the Mech Bay.</p></div>` : ordered.map(function (order) {
				const frame = getFrame(order.frameId); const elapsed = campaign.day - order.startedDay; const total = order.readyDay - order.startedDay;
				return html`<article class="work-order" data-work-order=${order.frameId}><div class="work-order-heading"><div><span class="eyebrow">${order.kind === 'repair' ? 'FRAME RESTORATION' : 'WEAPON REFIT'}</span><h3>${frame.name}</h3></div><strong>${daysLabel(order.readyDay - campaign.day)}<small>REMAINING</small></strong></div><div class="work-order-dates"><span>STARTED DAY ${order.startedDay}</span><b>READY DAY ${order.readyDay}</b></div><div class="track"><i style="width:${total > 0 ? elapsed / total * 100 : 100}%"></i></div><p>${order.kind === 'repair' ? 'Restore frame integrity to 100%. Weapons stay installed.' : order.loadout.map(function (weapon, index) { return `${index + 1}: ${weapon ? getWeapon(weapon).name : 'Empty'}`; }).join(' · ')}</p><button class="text-button" data-cancel-work=${order.frameId} @click=${function () { actions.cancelWork(order.frameId); }}>CANCEL ORDER</button><small class="company-note">Cancellation keeps the original condition and loadout.</small></article>`;
			})}</div><p class="company-note">Each jump or sortie also advances work by one day. Waiting does not charge credits or refresh contract postings.</p></section>
			<section class="maintenance-roster" aria-labelledby="maintenance-title"><h3 id="maintenance-title">FRAME CONDITION</h3><p class="company-note">Your own crews perform repairs without a credit fee. Every 20 missing integrity takes one day; a wrecked frame needs five days.</p>${campaign.fleet.map(function (mech) {
				const frame = getFrame(mech.frameId); const order = workOrderFor(campaign, mech.frameId); const days = repairDays(mech.integrity);
				return html`<article class="maintenance-frame" data-maintenance-frame=${mech.frameId}><div><b>${frame.name}</b><strong class=${mech.integrity < 35 ? 'negative' : ''}>${integrityLabel(mech.integrity)}</strong></div><div class="track"><i style="width:${mech.integrity}%"></i></div><p>${order ? `${order.kind === 'repair' ? 'Repair' : 'Refit'} underway · ready day ${order.readyDay}` : mech.integrity >= 100 ? 'Fully serviced. No repairs required.' : `${daysLabel(days)} to restore · ready day ${campaign.day + days}`}</p><button class="secondary" data-repair-frame=${mech.frameId} ?disabled=${Boolean(order) || mech.integrity >= 100 || Boolean(campaign.deployed)} @click=${function () { actions.repair(mech.frameId); }}>${order ? 'WORK ALREADY IN PROGRESS' : mech.integrity >= 100 ? 'FRAME INTACT' : `QUEUE REPAIRS · ${daysLabel(days)}`}</button></article>`;
			})}<button class="secondary" @click=${function () { actions.navigate('mechbay'); }}>RETURN TO MECH BAY →</button></section>
		</div>
	`;
};

export const renderCompany = function (root: HTMLElement, campaign: Campaign, screen: CompanyScreen, editor: CompanyEditor, saved: boolean, actions: CompanyActions) {
	render(html`
		${renderShipHeader(campaign, screen, actions.navigate)}
		<p class="company-notice" role="status" aria-live="polite">${editor.notice}</p>
		${screen === 'mechbay' ? renderMechBay(campaign, editor, actions) : screen === 'market' ? renderMarket(campaign, actions) : renderEngineering(campaign, actions)}
		<footer class="bridge-footer"><div><button @click=${actions.handbook}>HANDBOOK</button><button @click=${actions.settings}>SETTINGS</button></div><span class=${saved ? 'save-notice' : 'save-notice storage-warning'} role="status">${saved ? 'COMPANY SAVED ON THIS DEVICE' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span><a href="https://deegeegames.com/">← DEEGEE GAMES</a></footer>
	`, root);
};
