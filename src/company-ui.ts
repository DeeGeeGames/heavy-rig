import { rigFrameId, rigName, type RigId } from './rigs';
import { getFrameOffer } from './market';
import { companyRank, reputationProgress, unlockedMissionTier } from './reputation';
import { html } from 'lit-html';
import { inspectWorkspacePane, renderWorkspace, revealWorkspaceElement, selectWorkspacePane, textItems, workspaceBackTarget, type WorkspacePane } from './workspace';
import { getWeapon, getWeaponTier, tierLabel, weaponIdForTier, WEAPONS, WEAPON_FAMILY_LABELS, WEAPON_SIZE_LABELS, type WeaponId, type WeaponModelId } from './arsenal';
import { canEquipWeapon, getHardpoints } from './hardpoints';
import { FACTIONS, getFaction, getPlanet, type Campaign, type PlannedOperation } from './campaign';
import type { FactionId } from './campaign-types';
import { getAuthoredStep } from './contract-chains';
import { availableWeapons, canRefit, getOwnedMech, refitDays, repairDays, WEAPON_PRICES, workOrderFor } from './company';
import { PLAYABLE_FRAMES, getFrame, type FrameDefinition, type FrameId } from './frames';
import { hardpointSummary, loadSummary, massLabel, sustainedHeat, supplySummary, weaponClassLabel } from './loadout-ui';
import { frameWeight, loadedMounts, usableMount } from './combat-resources';
import { factionLiveryPreset, getLiveryPreset, liveryPresetsForFaction, SKIN_PALETTES, supportsMechSkin, type LiveryPresetId } from './mech-skin';
import { getPilot, type PilotId } from './pilots';
import type { ChoicePicker } from './choice-picker';
import { deploymentPanes, pilotPanes, type AssignmentPicker } from './pilot-ui';

export type CompanyScreen = 'mechbay' | 'market' | 'engineering' | 'pilots' | 'deploy';
export type ShipScreen = 'starmap' | 'bridge' | CompanyScreen;
export interface CompanyEditor {
	loadout: readonly (WeaponId | null)[];
	reserves: readonly number[];
	slot: number | null;
	notice: string;
}
export interface CompanyActions {
	picker: ChoicePicker;
	skin: LiveryPresetId;
	operation?: PlannedOperation | undefined;
	openOperations: () => void;
	removeOperation: () => void;
	selectSkin: (skin: LiveryPresetId, focusFaction?: FactionId) => void;
	navigate: (screen: ShipScreen) => void;
	selectFrame: (frameId: RigId) => void;
	editSlot: (slot: number) => void;
	setWeapon: (weapon: WeaponId | null) => void;
	setReserve: (slot: number, rounds: number) => void;
	discardRefit: () => void;
	closePicker: () => void;
	queueRefit: () => void;
	buyFrame: (frameId: FrameId) => void;
	buyWeapon: (weapon: WeaponId) => void;
	repair: (frameId: RigId) => void;
	cancelWork: (frameId: RigId) => void;
	advanceDays: (days: number) => void;
	hire: (id: PilotId) => void;
	dismiss: (id: PilotId) => void;
	assignPilot: (slot: number, id: PilotId | null) => void;
	assignRig: (slot: number, id: RigId | null) => void;
	assignLead: (id: PilotId) => void;
	deploy: () => void;
	settings: () => void;
	handbook: () => void;
}

export const SHIP_SECTIONS: readonly { id: ShipScreen; label: string }[] = [
	{ id: 'starmap', label: 'Starmap' },
	{ id: 'bridge', label: 'Contracts' },
	{ id: 'mechbay', label: 'Mech Bay' },
	{ id: 'market', label: 'Market' },
	{ id: 'engineering', label: 'Engineering' },
	{ id: 'pilots', label: 'Pilots' },
	{ id: 'deploy', label: 'Deploy' },
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
export const renderShipHeader = function (campaign: Campaign, screen: ShipScreen, actions: Pick<CompanyActions, 'navigate' | 'picker'>, locked = false) {
	const departments = SHIP_SECTIONS.map(function ({ id, label }) {
		return { value: id, label, ...(id === 'engineering' && campaign.workOrders.length ? { detail: `${campaign.workOrders.length} active work orders` } : {}) };
	});
	return html`
		<header class="bridge-header">
			<div class="bridge-brand"><span class="insignia" aria-hidden="true">HR</span><div><span class="eyebrow" title=${reputationProgress(campaign)}>RANK ${companyRank(campaign)} · ${campaign.companyReputation.toLocaleString()} REP</span><h1>HRV WAYFARER<small class="company-rank">R${companyRank(campaign)}</small></h1></div></div>
			<nav class="ship-navigation" aria-label="Company departments">
				<div class="ship-department-picker">
					<button class="nav-step" ?disabled=${locked} aria-label="Previous department" @click=${function () { actions.navigate(adjacentShipScreen(screen, -1)); }}><span data-menu-glyph="previousDepartment"></span></button>
					${actions.picker.field(`department-${screen}`, 'Department', screen, departments, actions.navigate, 'Wayfarer departments', locked)}
					<button class="nav-step" ?disabled=${locked} aria-label="Next department" @click=${function () { actions.navigate(adjacentShipScreen(screen, 1)); }}><span data-menu-glyph="nextDepartment"></span></button>
				</div>
				<div class="ship-department-tabs" data-menu-row>
					${departments.map(function ({ value, label, detail }) {
						return html`<button type="button" class="ship-department-tab" aria-current=${screen === value ? 'page' : 'false'}
							?disabled=${locked} @click=${function () { if (value !== screen) actions.navigate(value); }}>${label}${detail ? html`<b title=${detail} aria-label=${detail}>${campaign.workOrders.length}</b>` : ''}</button>`;
					})}
				</div>
			</nav>
			<div class="career-stats"><div><small>IN ORBIT</small><b>${getPlanet(campaign.planetId).name}</b></div><div><small>COMPANY FUNDS</small><b>${campaign.credits.toLocaleString()} <em>CR</em></b></div><div><small>SHIP CALENDAR</small><b>DAY ${String(campaign.day).padStart(2, '0')}</b></div></div>
		</header>
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

interface CompanyView { kind: 'weapons' | 'frames'; weapon: WeaponModelId; frame: FrameId; slot: number | null; assignment?: AssignmentPicker }
const views = new WeakMap<HTMLElement, CompanyView>();
const assignedPilot = function (campaign: Campaign, frame: RigId) {
	const lineup = campaign.operations?.length ? campaign.operations.flatMap(function (operation) { return operation.lineup; }) : campaign.preferredLineup ?? campaign.lineup;
	const pilotId = lineup.find(function (entry) { return entry.frameId === frame; })?.pilotId;
	return pilotId ? getPilot(pilotId).callsign : undefined;
};

const liveryItems = function (actions: CompanyActions, deployed: boolean) {
	const selected = getLiveryPreset(actions.skin);
	const faction = selected.faction;
	const factionChoices = html`<div class="mech-livery">
		<header><span class="eyebrow">FACTION</span><small>FREE REPAINT · NO WORKSHOP TIME</small></header>
		<div role="group" aria-label="Livery faction">
			<button data-mech-skin="original" aria-label="Original finish" aria-pressed=${actions.skin === 'original'} ?disabled=${deployed} @click=${function () { actions.selectSkin('original'); }}>Original</button>
			${FACTIONS.map(function (definition) {
				const id = definition.id;
				return html`<button data-livery-faction=${id} aria-label=${definition.name} aria-pressed=${faction === id} ?disabled=${deployed}
					@click=${function () { actions.selectSkin(factionLiveryPreset(id, selected.layout).id, id); }}>${definition.shortName}</button>`;
			})}
		</div>
	</div>`;
	if (!faction) return [factionChoices];
	return [factionChoices, html`<div class="mech-livery">
		<span class="eyebrow">${getFaction(faction).shortName} PAINT LAYOUT</span>
		<div class="livery-layouts" role="group" aria-label="Paint layout">${liveryPresetsForFaction(faction).map(function (preset) {
			const paint = preset.finish;
			const swatches = typeof paint === 'object' ? paint : paint === 'original' ? undefined
				: { primary: SKIN_PALETTES[paint].primary[1], secondary: SKIN_PALETTES[paint].secondary[1] };
			return html`<button data-mech-skin=${preset.id} aria-pressed=${actions.skin === preset.id} ?disabled=${deployed} @click=${function () { actions.selectSkin(preset.id); }}>
				${swatches ? html`<i class="livery-swatch" data-pattern=${preset.layout} style="--paint-main:${swatches.primary};--paint-accent:${swatches.secondary}"></i>` : ''}${preset.label}
			</button>`;
		})}</div>
	</div>`];
};

const mechBayPanes = function (campaign: Campaign, editor: CompanyEditor, actions: CompanyActions): WorkspacePane[] {
	const mech = getOwnedMech(campaign);
	if (!mech) return [{ id: 'fleet', label: 'Rigs', items: textItems('No frame is selected.') }];
	const frame = getFrame(rigFrameId(mech.frameId));
	const order = workOrderFor(campaign, mech.frameId);
	const changed = refitDays(mech.loadout, editor.loadout);
	const ammoChanged = editor.reserves.some(function (rounds, index) { return rounds !== mech.reserves[index]; });
	const draft = changed > 0 || ammoChanged;
	const hardpoints = getHardpoints(frame.id);
	const slot = editor.slot;
	const selectedHardpoint = slot === null ? undefined : hardpoints[slot];
	const equipment = slot !== null && selectedHardpoint !== undefined && !order;
	const story = campaign.active && getAuthoredStep(campaign.story, campaign.active);
	const status = draft ? 'Apply or discard your loadout changes before deployment.' : order ? `This frame will be ready on day ${order.readyDay}. It cannot deploy while work is in progress.` : mech.integrity <= 0 ? 'Schedule a free repair and advance the Engineering calendar to deploy this frame.' : !loadedMounts(mech.loadout, mech.reserves).some(usableMount) ? 'This frame has no usable weapons. Load ammunition or fit an energy weapon before deployment.' : 'Assign this rig to a pilot on the Deploy screen.';
	const mounts = hardpoints.map(function (hardpoint, index) {
		const weaponId = editor.loadout[index]; const weapon = weaponId ? getWeapon(weaponId) : undefined;
		const different = weaponId !== mech.loadout[index] || editor.reserves[index] !== mech.reserves[index];
		const mountClass = weaponClassLabel(hardpoint.family, hardpoint.maxSize);
		return html`<button class="company-mount ${different ? 'changed' : ''}" data-loadout-slot=${index} data-hardpoint-type=${hardpoint.family} aria-pressed=${slot === index} aria-label=${`Mount ${index + 1}, ${hardpoint.name}, ${mountClass}: ${weapon?.name ?? 'empty'}. Change weapon.`} ?disabled=${Boolean(order)} @click=${function () { actions.editSlot(index); }}><span class="mount-number">0${index + 1}</span><span><small class="hardpoint-location">${hardpoint.name} · ${mountClass}</small><b>${weapon?.name ?? 'EMPTY MOUNT'}</b><em>${different ? 'DRAFT · ' : ''}${weapon ? `${WEAPON_SIZE_LABELS[weapon.size]} · ${weapon.type}` : (hardpoint.family === 'launcher' ? 'Fits missiles / rockets' : `Fits ${hardpoint.weapons.map(function (id) { return getWeapon(id).type; }).join(' / ')}`)}</em></span><span class="mount-change" aria-hidden="true">${order ? '—' : '↗'}</span></button>`;
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
		...textItems(`${selectedHardpoint.name}. Fits one ${WEAPON_FAMILY_LABELS[selectedHardpoint.family].toLowerCase()} weapon up to ${WEAPON_SIZE_LABELS[selectedHardpoint.maxSize]}.`),
		html`<button class="equipment-choice" data-equip-weapon="empty" aria-pressed=${editor.loadout[slot] === null} @click=${function () { actions.setWeapon(null); }}><b>EMPTY</b><small>Unmount weapon</small></button>`,
		...compatibleOwned.map(function (weapon) {
			const used = editor.loadout.filter(function (id, index) { return index !== slot && id === weapon.id; }).length;
			const usable = availableWeapons(campaign, weapon.id, mech.frameId) - used;
			return html`<button class="equipment-choice" data-equip-weapon=${weapon.id} data-weapon-family=${weapon.family} data-weapon-tier=${weapon.tier} aria-pressed=${editor.loadout[slot] === weapon.id} ?disabled=${usable <= 0} @click=${function () { actions.setWeapon(weapon.id); }}><span><b>${weapon.name}</b><small>${tierLabel(weapon.tier)} · ${WEAPON_SIZE_LABELS[weapon.size]} · ${weapon.type}</small></span><small>${usable > 0 ? `${usable} available to fit` : 'Allocated elsewhere'}</small></button>`;
		}),
		...(compatibleOwned.length === 0 ? textItems('No compatible weapons owned. Buy equipment for this hardpoint at the Market.') : []),
		...textItems('Only compatible owned copies are listed. Every tier fits the same hardpoint; each tier is separate inventory.'),
	];
	return [
		{ id: 'fleet', label: 'Rigs', items: [
			html`<span class="eyebrow">${campaign.fleet.length} RIGS OWNED</span>`,
			...campaign.fleet.map(function (owned) { const definition = getFrame(rigFrameId(owned.frameId)); const job = workOrderFor(campaign, owned.frameId); const pilot = assignedPilot(campaign, owned.frameId); return html`<button class="fleet-frame" data-owned-frame=${owned.frameId} aria-pressed=${owned.frameId === campaign.selectedFrame} @click=${function () { actions.selectFrame(owned.frameId); }} style="--frame-color:${definition.color}"><span>${definition.mass}T / ${definition.role}</span><b>${rigName(owned.frameId)}</b><small>${definition.variantName}${pilot ? ` · ${pilot}` : ''}</small>${renderHullIntegrity(owned.integrity)}<small>${job ? `READY DAY ${job.readyDay}` : owned.integrity <= 0 ? 'REPAIR REQUIRED' : 'AVAILABLE'}</small></button>`; }),
			...textItems('Each rig has its own equipment, condition, ammunition settings, and workshop crew. Market frames arrive with complete compatible weapon packages scaled to company reputation and standard ammunition.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('market'); }}>ACQUIRE FRAME →</button><button class="secondary" @click=${function () { actions.navigate('deploy'); }}>SQUAD LINEUP →</button>` },
		{ id: 'condition', label: 'Condition', items: [
			html`<div style="--frame-color:${frame.color}"><span class="eyebrow">${frame.role.toUpperCase()} / FRAME ${frame.designation}</span><h2>${rigName(mech.frameId)}</h2><p class="workspace-copy">${frame.variantName} · ${assignedPilot(campaign, mech.frameId) ?? 'Unassigned'}</p></div>`,
			renderHullIntegrity(mech.integrity),
			html`<dl class="frame-specifications"><dt>CRUISE</dt><dd>${frame.speed} m/s</dd><dt>COOLING</dt><dd>${frame.cooling} heat/s</dd><dt>BASE MASS</dt><dd>${massLabel(frame.mass)} incl. fixed equipment</dd><dt>RECOMMENDED</dt><dd>${massLabel(frame.recommendedMass)}</dd></dl>`,
			...textItems(`INSTALLED: ${loadSummary(frame.id, mech.loadout, mech.reserves)}`),
			...textItems(hardpointSummary(frame.id)), ...textItems(frame.tradeoff),
		] },
		...(supportsMechSkin(frame.id) ? [{ id: 'livery', label: 'Company livery', items: liveryItems(actions, Boolean(campaign.deployed)), scrollable: true }] : []),
		{ id: 'loadout', label: equipment && slot !== null ? `Mount ${slot + 1}` : 'Loadout', items: equipment ? choices : [
			...mounts,
			...(story ? [html`<span class="eyebrow">CAMPAIGN / ${story.contract.title}</span>`, ...textItems(story.contract.briefing), ...textItems(status)] : []),
			...textItems(`INSTALLED: ${loadSummary(frame.id, mech.loadout, mech.reserves)}`),
			...(draft ? textItems(`DRAFT: ${loadSummary(frame.id, editor.loadout, editor.reserves)}`) : []),
			...(order?.kind === 'refit' ? textItems(`PENDING DAY ${order.readyDay}: ${loadSummary(frame.id, order.loadout, order.reserves)}`) : []),
			...reserves,
			...textItems('Ammunition refills free before each sortie. Reserve changes alone cost 0 CR and no workshop time. Extra rounds add weight; firing sheds it.'),
			...textItems(order ? `${order.kind === 'repair' ? 'Repairs' : 'Refit'} underway. Ready day ${order.readyDay} · ${daysLabel(order.readyDay - campaign.day)} remaining.` : changed > 0 ? `Fitting estimate: ${daysLabel(changed)}. Ready day ${campaign.day + changed}. Parts are reserved when queued. Installed weapons stay in place until work finishes.` : `${hardpointSummary(frame.id)} Select a mount to fit a compatible owned weapon. Each changed mount takes one calendar day.`),
			...(changed > 0 && !editor.loadout.some(function (weapon) { return weapon !== null; }) ? textItems('An unarmed frame cannot deploy. Removed equipment returns to stores when the refit finishes.') : []),
			...(story ? [] : [html`<span class="eyebrow">${campaign.active ? `ACCEPTED / ${campaign.active.title}` : 'NO CONTRACT ACCEPTED'}</span>`, ...textItems(status)]),
		], actions: equipment ? html`<button class="secondary" @click=${actions.closePicker}>BACK TO MOUNTS</button><button class="text-button" @click=${function () { actions.closePicker(); actions.navigate('market'); }}>MARKET →</button>` : draft ? html`<button id="queue-refit" class="primary" ?disabled=${!canRefit(campaign, mech.frameId, editor.loadout, editor.reserves)} @click=${actions.queueRefit}>${changed > 0 ? `QUEUE ${daysLabel(changed)} REFIT →` : 'APPLY AMMUNITION · FREE'}</button><button class="text-button" data-discard-refit @click=${actions.discardRefit}>DISCARD DRAFT</button>` : order ? html`<button class="secondary" @click=${function () { actions.navigate('engineering'); }}>VIEW ENGINEERING →</button>` : html`<button class="secondary" @click=${function () { actions.navigate('deploy'); }}>SQUAD LINEUP →</button>` },
	];
};

const marketPanes = function (root: HTMLElement, campaign: Campaign, view: CompanyView, actions: CompanyActions, refresh: () => void): WorkspacePane[] {
	const tier = unlockedMissionTier(campaign).weaponTier;
	const weapon = getWeapon(weaponIdForTier(view.weapon, tier)); const frame = getFrame(view.frame);
	const quality = getWeaponTier(tier);
	const offer = getFrameOffer(campaign, frame.id);
	const stock = offer.loadout; const stockReserves = offer.reserves;
	const weaponMarket = view.kind === 'weapons';
	const price = weaponMarket ? WEAPON_PRICES[weapon.id] : offer.price;
	const owned = campaign.fleet.filter(function (mech) { return rigFrameId(mech.frameId) === frame.id; }).length;
	const affordable = campaign.credits >= price;
	const select = function (event: Event) { refresh(); inspectWorkspacePane(root, 'details', event.currentTarget); };
	const returnToCatalogue = function () {
		const back = workspaceBackTarget(root);
		if (back) { back(); return; }
		selectWorkspacePane(root, view.kind);
		const selected = root.querySelector<HTMLElement>('.catalogue-item[aria-pressed="true"]');
		if (selected) { revealWorkspaceElement(selected); selected.focus({ preventScroll: true }); }
	};
	return [
		{ id: 'catalogue', label: 'Catalogue', items: [
			...(weaponMarket ? WEAPONS.filter(function (item) { return item.tier === tier; }).map(function (item) { return html`<button class="catalogue-item" data-market-weapon=${item.id} data-weapon-tier=${item.tier} style="--item-color:${quality.color}" aria-pressed=${item.id === weapon.id} @click=${function (event: Event) { view.weapon = item.modelId; select(event); }}><span><b>${item.name}</b><small>${weaponClassLabel(item.family, item.size)} · ${campaign.inventory[item.id]} owned</small></span><span>${creditsLabel(WEAPON_PRICES[item.id])}</span></button>`; }) : PLAYABLE_FRAMES.map(function (item) { return html`<button class="catalogue-item" data-market-frame=${item.id} style="--item-color:${item.color}" aria-pressed=${item.id === frame.id} @click=${function (event: Event) { view.frame = item.id; select(event); }}><span><b>${item.chassisName} ${item.variant}</b><small>${item.variantName} · ${item.mass}T</small></span><span>${creditsLabel(getFrameOffer(campaign, item.id).price)}</span></button>`; })),
			...textItems(weaponMarket ? 'Weapon purchases arrive in stores. Install them through a Mech Bay refit.' : 'Frames include the displayed weapons and standard ammunition. Packages refresh after a jump or contract. You can buy multiple copies of any variant.'),
		] },
		{ id: 'details', label: 'Item details', items: weaponMarket ? [
			html`<span class="eyebrow">${weapon.type.toUpperCase()}</span><h2 style="color:${weapon.color}">${weapon.name}</h2>`,
			...textItems(`${weaponClassLabel(weapon.family, weapon.size)} weapon. ${weapon.description}`),
			html`<dl class="frame-specifications"><dt>${weapon.kind === 'laser' ? 'DAMAGE / SECOND' : 'DAMAGE / ROUND'}</dt><dd>${weapon.damage.toFixed(1)}</dd><dt>FIRING CYCLE</dt><dd>${weapon.kind === 'laser' ? 'Continuous beam' : `${weapon.interval.toFixed(3)} s / ${weapon.projectiles} round${weapon.projectiles === 1 ? '' : 's'}`}</dd><dt>RANGE</dt><dd>${weapon.range.toFixed(0)} m</dd></dl>`,
			html`<dl class="frame-specifications"><dt>HEAT / SUSTAINED</dt><dd>${sustainedHeat(weapon).toFixed(1)} / second</dd><dt>HARDWARE</dt><dd>${massLabel(weapon.mass)}</dd><dt>${weapon.kind === 'laser' ? 'BEAM' : 'PROJECTILE SPEED'}</dt><dd>${weapon.kind === 'laser' ? 'Instant' : `${weapon.speed.toFixed(0)} m/s`}</dd><dt>SPREAD</dt><dd>${weapon.spread > 0 ? `${(weapon.spread * 180 / Math.PI).toFixed(2)}°` : 'Precise'}</dd></dl>`,
			...textItems(weapon.ammunition ? `AMMUNITION: ${weapon.ammunition.defaultLoad} standard / ${weapon.ammunition.capacity} maximum rounds per mount. ${massLabel(weapon.ammunition.mass)} per round; ${massLabel(weapon.ammunition.defaultLoad * weapon.ammunition.mass)} standard reserve. Free replenishment between sorties.` : 'AMMUNITION INDEPENDENT: no rounds required. Weapons lock at 100 heat and recover at 35.'),
			...PLAYABLE_FRAMES.filter(function (definition) { return definition.variant === 'A'; }).flatMap(function (chassis) {
				const compatible = PLAYABLE_FRAMES.filter(function (definition) { return definition.chassisId === chassis.chassisId && getHardpoints(definition.id).some(function (_hardpoint, slot) { return canEquipWeapon(definition.id, slot, weapon.id); }); });
				return compatible.length ? textItems(`Compatible: ${chassis.chassisName} ${compatible.map(function (definition) { return definition.variant; }).join(' / ')}.`) : [];
			}),
			html`<dl class="frame-specifications"><dt>OWNED</dt><dd>${campaign.inventory[weapon.id]}</dd><dt>IN STORES</dt><dd>${availableWeapons(campaign, weapon.id)}</dd></dl>`,
			...(!affordable ? textItems(`Need ${creditsLabel(price - campaign.credits)} more.`) : []),
		] : [
			html`<div style="--frame-color:${frame.color}"><span class="eyebrow">${frame.mass}T / ${frame.role.toUpperCase()}</span><h2>${frame.chassisName} ${frame.variant}</h2><p class="workspace-copy">${frame.variantName}</p></div>`, frameSchematic(frame),
			...textItems(frame.description), ...textItems(`BASE MASS: ${massLabel(frame.mass)} including fixed equipment. RECOMMENDED OPERATING WEIGHT: ${massLabel(frame.recommendedMass)}. Weapons and ammunition add to base mass.`), ...textItems(hardpointSummary(frame.id)), ...textItems(frame.tradeoff),
			html`<span class="eyebrow">INCLUDED LOADOUT</span>`,
			...getHardpoints(frame.id).flatMap(function (hardpoint, index) { const id = stock[index]; const item = id ? getWeapon(id) : undefined; return textItems(`${index + 1}. ${hardpoint.name}: ${item?.name ?? 'Empty'}${item?.ammunition ? ` / ${stockReserves[index] ?? 0} rounds` : ' / energy'}.`); }),
			...textItems(`STOCK: ${loadSummary(frame.id, stock, stockReserves)}`),
			html`<p class="workspace-copy">All stock weapons and ammunition are included. ${creditsLabel(price)}${owned ? ` · ${owned} owned` : ''}</p>`,
		], actions: html`<button class="secondary" @click=${returnToCatalogue}>CATALOGUE</button><button class="primary purchase-button" data-buy-weapon=${weaponMarket ? weapon.id : ''} data-buy-frame=${weaponMarket ? '' : frame.id} ?disabled=${!affordable || Boolean(campaign.deployed)} @click=${function () { if (weaponMarket) actions.buyWeapon(weapon.id); else actions.buyFrame(frame.id); }}>BUY · ${creditsLabel(price)}</button>` },
	];
};

const engineeringPanes = function (campaign: Campaign, actions: CompanyActions): WorkspacePane[] {
	const ordered = [...campaign.workOrders].sort(function (a, b) { return a.readyDay - b.readyDay; });
	const next = ordered[0];
	return [
		{ id: 'calendar', label: 'Calendar', items: [
			html`<span class="eyebrow">SHIP CALENDAR</span><h2>DAY ${String(campaign.day).padStart(2, '0')}</h2>`,
			...textItems(next ? `Next completion: ${rigName(next.frameId)} on day ${next.readyDay}. ${ordered.length} active work orders.` : 'No scheduled work. Your crews are standing by.'),
			...textItems('Ammunition reserve changes take no workshop time. Selected loads replenish free at deployment; no ammunition is bought or stocked.'),
			...textItems('Each frame has its own crew. Repairs and refits progress in parallel, completing on the ship calendar.'),
			...textItems('Each jump or sortie also advances work by one day. Waiting does not charge credits or refresh contract postings.'),
		], actions: html`<button id="advance-day" class="secondary" ?disabled=${Boolean(campaign.deployed)} @click=${function () { actions.advanceDays(1); }}>ADVANCE 1 DAY</button><button id="advance-work" class="primary" ?disabled=${!next || Boolean(campaign.deployed)} @click=${function () { if (next) actions.advanceDays(next.readyDay - campaign.day); }}>${next ? `WAIT ${daysLabel(next.readyDay - campaign.day)}` : 'NO WORK PENDING'}</button>` },
		{ id: 'orders', label: 'Work orders', items: ordered.length === 0 ? [html`<div class="company-empty"><b>ALL BAYS CLEAR</b><p>Schedule repairs in Condition or plan a refit in the Mech Bay.</p></div>`] : ordered.flatMap(function (order) {
			const frame = getFrame(rigFrameId(order.frameId)); const total = order.readyDay - order.startedDay;
			return [html`<article class="work-order" data-work-order=${order.frameId}><div class="work-order-heading"><div><span class="eyebrow">${order.kind === 'repair' ? 'RESTORATION' : 'WEAPON REFIT'}</span><h3>${rigName(order.frameId)}</h3></div><strong>${daysLabel(order.readyDay - campaign.day)}</strong></div><div class="work-order-dates"><span>STARTED ${order.startedDay}</span><b>READY DAY ${order.readyDay}</b></div><div class="track"><i style="width:${total > 0 ? (campaign.day - order.startedDay) / total * 100 : 100}%"></i></div></article>`, html`<button class="secondary" data-cancel-work=${order.frameId} @click=${function () { actions.cancelWork(order.frameId); }}>CANCEL ${rigName(order.frameId)} ORDER</button>`, ...textItems(order.kind === 'repair' ? `${frame.name}: restore integrity to 100%. Weapons stay installed.` : `${frame.name} refit: ${order.loadout.map(function (weapon, index) { const hardpoint = getHardpoints(frame.id)[index]; return `${index + 1}. ${hardpoint?.name ?? 'Mount'}${hardpoint ? ` (${weaponClassLabel(hardpoint.family, hardpoint.maxSize)})` : ''}: ${weapon ? getWeapon(weapon).name : 'Empty'}`; }).join(' · ')}`), ...(order.kind === 'refit' ? textItems(`PENDING: ${loadSummary(frame.id, order.loadout, order.reserves)} ${supplySummary(order.loadout, order.reserves)}`) : [])];
		}).concat(textItems('Cancellation keeps the original condition and installed loadout. Elapsed days are not refunded.')) },
		{ id: 'condition', label: 'Condition', scrollable: true, items: [
			...campaign.fleet.map(function (mech) {
				const order = workOrderFor(campaign, mech.frameId); const days = repairDays(mech.integrity);
				return html`<div class="maintenance-entry"><article class="maintenance-frame" data-maintenance-frame=${mech.frameId}><div><b>${rigName(mech.frameId)}</b></div>${renderHullIntegrity(mech.integrity)}<p>${order ? `${order.kind === 'repair' ? 'Repair' : 'Refit'} underway · ready day ${order.readyDay}` : mech.integrity >= 100 ? 'Fully serviced.' : `${daysLabel(days)} to restore · ready day ${campaign.day + days}`}</p></article><button class="secondary" data-repair-frame=${mech.frameId} ?disabled=${Boolean(order) || mech.integrity >= 100 || Boolean(campaign.deployed)} @click=${function () { actions.repair(mech.frameId); }}>${rigName(mech.frameId)} · ${order ? 'WORK IN PROGRESS' : mech.integrity >= 100 ? 'FRAME INTACT' : `REPAIR · ${daysLabel(days)}`}</button></div>`;
			}), ...textItems('Your own crews repair without a credit fee. Every 20 missing integrity takes one day; a wrecked frame needs five days.'),
		], actions: html`<button class="secondary" @click=${function () { actions.navigate('mechbay'); }}>MECH BAY →</button>` },
	];
};

export const renderCompany = function (root: HTMLElement, campaign: Campaign, screen: CompanyScreen, editor: CompanyEditor, saved: boolean, actions: CompanyActions) {
	const compact = window.matchMedia('(max-width: 560px) and (max-height: 700px)').matches;
	let view = views.get(root);
	if (!view) { view = { kind: 'weapons', weapon: 'autocannon', frame: 'warden', slot: null }; views.set(root, view); }
	const previousSlot = view.slot;
	view.slot = editor.slot;
	const refresh = function () { renderCompany(root, campaign, screen, editor, saved, actions); };
	const selectAssignment = function (picker?: AssignmentPicker) {
		const previous = view.assignment;
		if (picker) view.assignment = picker; else delete view.assignment;
		refresh();
		selectWorkspacePane(root, picker ? 'assignment' : 'squad', true);
		const target = picker ? root.querySelector<HTMLElement>('[data-pane="assignment"] .equipment-choice[aria-pressed="true"]:not(:disabled)')
			?? root.querySelector<HTMLElement>('[data-pane="assignment"] button:not(:disabled)')
			: previous && root.querySelector<HTMLElement>(`[data-choose-${previous.kind}="${previous.slot}"]`);
		if (target) { revealWorkspaceElement(target); target.focus({ preventScroll: true }); }
	};
	const panes = screen === 'mechbay' ? mechBayPanes(campaign, editor, actions)
		: screen === 'market' ? marketPanes(root, campaign, view, actions, refresh)
		: screen === 'pilots' ? pilotPanes(campaign, actions)
		: screen === 'deploy' ? deploymentPanes(campaign, actions, view.assignment, selectAssignment, function () { selectAssignment(); })
		: engineeringPanes(campaign, actions);
	const locked = screen === 'mechbay' && editor.slot !== null || screen === 'deploy' && view.assignment !== undefined;
	root.dataset['picker'] = String(locked);
	const footer = html`<footer class="bridge-footer"><div><button ?disabled=${locked} @click=${actions.handbook}>HANDBOOK</button><button ?disabled=${locked} @click=${actions.settings}>SETTINGS</button></div><span class="company-notice" role="status">${editor.notice}</span><span class="ship-controller-status" hidden></span><span class=${saved ? 'save-notice' : 'save-notice storage-warning'}>${saved ? 'COMPANY SAVED' : 'STORAGE UNAVAILABLE · SESSION ONLY'}</span></footer>`;
	const mech = getOwnedMech(campaign); const frame = mech ? getFrame(rigFrameId(mech.frameId)) : undefined;
	const order = mech ? workOrderFor(campaign, mech.frameId) : undefined;
	const installedWeight = mech && frame ? frameWeight(frame.id, loadedMounts(mech.loadout, mech.reserves)) : undefined;
	const hero = screen === 'mechbay' && mech && frame ? html`
		<div class="hangar-heading"><div><span class="eyebrow">${frame.mass}T / ${frame.variantName}</span><h2>${rigName(mech.frameId)} <small>/ ${frame.designation}</small></h2></div>${supportsMechSkin(frame.id) ? html`<button class="hangar-livery" ?disabled=${locked || Boolean(campaign.deployed)} @click=${function () { selectWorkspacePane(root, 'livery'); const target = root.querySelector<HTMLElement>('[data-mech-skin][aria-pressed="true"]'); if (target) { revealWorkspaceElement(target); target.focus({ preventScroll: true }); } }}>LIVERY</button>` : html`<span class="eyebrow">${assignedPilot(campaign, mech.frameId) ?? 'UNASSIGNED'}</span>`}</div>
		<div class="hangar-model"><canvas data-hangar-frame=${frame.id} aria-label=${`${frame.name} frame preview`}></canvas><span class="hangar-fallback">${frame.name} / ${frame.role}</span><span class="mount-pin" aria-hidden="true" hidden></span></div>
		<div class="hangar-service">
			${renderHullIntegrity(mech.integrity)}
			${order ? html`<button class="secondary hull-repair" ?disabled=${locked} @click=${function () { actions.navigate('engineering'); }}>VIEW ${order.kind === 'repair' ? 'REPAIRS' : 'REFIT'}<small>READY DAY ${order.readyDay}</small></button>` : mech.integrity < 100 ? html`<button class="secondary hull-repair" data-quick-repair=${mech.frameId} ?disabled=${locked || Boolean(campaign.deployed)} @click=${function () { actions.repair(mech.frameId); }}>REPAIR · ${daysLabel(repairDays(mech.integrity))}<small>0 CR</small></button>` : html``}
		</div>
		<div class="hangar-specs"><div><small>LOADED CRUISE</small><b>${installedWeight?.speed.toFixed(1)}<em>m/s</em></b></div><div><small>COOLING</small><b>${frame.cooling}<em>heat/s</em></b></div></div>
	` : undefined;
	const departmentViews = screen === 'market' ? [
		{ id: 'weapons', label: 'Weapons', panes: compact ? ['catalogue'] : ['catalogue', 'details'], select: function () { view.kind = 'weapons'; refresh(); } },
		{ id: 'frames', label: 'Frames', panes: compact ? ['catalogue'] : ['catalogue', 'details'], select: function () { view.kind = 'frames'; refresh(); } },
		...(compact ? [{ id: 'details', label: 'Details', panes: ['details'] }] : []),
	] : screen === 'mechbay' ? [
		{ id: 'fleet', label: 'Rigs', panes: ['fleet'] }, { id: 'loadout', label: 'Loadout', panes: ['loadout'] }, { id: 'condition', label: 'Condition', panes: ['condition'] },
		...(frame && supportsMechSkin(frame.id) ? [{ id: 'livery', label: 'Livery', panes: ['livery'] }] : []),
	] : screen === 'engineering' ? [
		{ id: 'orders', label: 'Work orders', panes: ['orders'] }, { id: 'condition', label: 'Condition', panes: ['condition'] }, { id: 'calendar', label: 'Calendar', panes: ['calendar'] },
	] : panes.map(function (pane) { return { id: pane.id, label: pane.id === 'assignment' ? 'Assignment' : pane.label, panes: [pane.id] }; });
	renderWorkspace(root, renderShipHeader(campaign, screen, actions, locked), panes, footer, screen === 'mechbay' ? 'loadout' : screen === 'market' ? view.kind : departmentViews[0]?.id ?? '', departmentViews, hero);
	if (screen === 'mechbay' && (editor.slot !== previousSlot || editor.slot !== null)) selectWorkspacePane(root, 'loadout');
};
