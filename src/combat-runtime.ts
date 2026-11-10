import { definePlugin, defineSystemRef } from 'ecspresso';
import { artilleryStep, coolingStep, createState, deathsStep, effectsStep, enemiesStep, movementStep, outcomeStep, projectilesStep, spawningStep, weaponsStep, type ArtilleryStrike, type CombatCollection, type CombatStateView, type CombatEvent, type CombatStats, type Controls, type Effect, type Point, type Shot, type State, type Unit, type Warning, type Wreck } from './simulation';
import { finishTraining, prepareTraining, type Training, type TrainingBefore } from './training';
import type { ReactorState } from './combat-resources';
import type { WeaponMount } from './arsenal';
import type { MissionRuntime } from './campaign-types';

type Player = State['player'];
interface Reactor { heat: number; overheated: boolean; coolantCharges: number; coolantHeld: boolean }
export interface CombatComponents {
	combatOwned: true;
	combatOrder: number;
	player: true;
	position: Point;
	heading: { angle: number };
	drive: Pick<Player, 'throttle' | 'speed'>;
	aim: { turret: number };
	health: { hp: number; maxHp: number };
	reactor: Reactor;
	weaponBank: { mounts: WeaponMount[] };
	enemy: Unit;
	enemyWeapons: { mounts: WeaponMount[] | undefined };
	enemyReactor: ReactorState;
	projectile: Shot;
	effect: Effect;
	warning: Warning;
	artillery: ArtilleryStrike;
	wreck: Wreck;
	structure: NonNullable<MissionRuntime['structure']>;
}
export interface CombatResources {
	combatOrdering: { next: number };
	combatConfig: Pick<State, 'frame' | 'difficulty' | 'phase' | 'seed'>;
	combatMission: { value: MissionRuntime | undefined };
	combatProgress: Pick<State, 'relay' | 'wave' | 'spawned' | 'spawnIn' | 'intermission' | 'time' | 'kills' | 'outcome' | 'nextId'>;
	combatFeedback: Pick<State, 'beams' | 'shake' | 'cannonIn' | 'events'>;
	combatStats: CombatStats;
	combatControls: { raw: Controls; current: Controls };
	combatSession: { enabled: boolean; active: boolean; training: Training | undefined; before: TrainingBefore | undefined };
}
interface CollectionAccess<T> { list: () => { id: number; value: T }[]; spawn: (value: T) => void; remove: (id: number) => void; setOrder: (id: number, order: number) => void }
// Domain adapters expose ordered query views. Membership always lives in ECS;
// push and replacement remain supported for scenario configuration and helpers.
const collection = function <T>(access: CollectionAccess<T>) {
	return {
		read: function (): CombatCollection<T> {
			const values = access.list().map(function (entry) { return entry.value; });
			Object.defineProperty(values, 'push', { value: function (...items: T[]) { items.forEach(access.spawn); return access.list().length; } });
			Object.freeze(values);
			return values;
		},
		replace: function (values: readonly T[]) {
			if (new Set(values).size !== values.length) throw new Error('A combat collection cannot contain the same object twice');
			const entries = access.list();
			for (const entry of entries) if (!values.includes(entry.value)) access.remove(entry.id);
			for (const value of values) if (!entries.some(function (entry) { return entry.value === value; })) access.spawn(value);
			const current = access.list();
			values.forEach(function (value, order) { const entry = current.find(function (candidate) { return candidate.value === value; }); if (entry) access.setOrder(entry.id, order); });
		},
	};
};
export interface CombatHooks { beforeStep?: () => void; afterStep?: () => void }
export const createCombatRuntime = function () {
	let state: CombatStateView | undefined;
	let attach: ((initial: CombatStateView, training?: Training) => CombatStateView) | undefined;
	let setEnabled: ((enabled: boolean) => void) | undefined;
	let playerId: (() => number | undefined) | undefined;
	let enemyId: ((id: number) => number | undefined) | undefined;
	let controls = function (): Controls { return { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 450 }, fire: [false, false, false, false], coolant: false }; };
	let hooks: CombatHooks = {};
	const refs = { begin: defineSystemRef('combat:begin'), cooling: defineSystemRef('combat:cooling'), movement: defineSystemRef('combat:movement'), weapons: defineSystemRef('combat:weapons'), spawning: defineSystemRef('combat:spawning'), enemies: defineSystemRef('combat:enemies'), artillery: defineSystemRef('combat:artillery'), projectiles: defineSystemRef('combat:projectiles'), deaths: defineSystemRef('combat:deaths'), effects: defineSystemRef('combat:effects'), outcome: defineSystemRef('combat:outcome') };
	const plugin = definePlugin('heavy-rig:combat')
		.withComponentTypes<CombatComponents>()
		.withResourceTypes<CombatResources>()
		.withEventTypes<{ combatEvent: { event: CombatEvent; time: number }; combatStepFinished: { events: readonly CombatEvent[]; time: number } }>()
		.withGroups<'combat'>()
		.install(function (world, onCleanup) {
			const empty = createState();
			world.addResource('combatOrdering', { next: 0 });
			const nextOrder = function () { const ordering = world.getResource('combatOrdering'); return ordering.next++; };
			const setOrder = function (id: number, order: number) { world.addComponent(id, 'combatOrder', order); const ordering = world.getResource('combatOrdering'); ordering.next = Math.max(ordering.next, order + 1); };
			world.addResource('combatConfig', { frame: empty.frame, difficulty: empty.difficulty, phase: empty.phase, seed: empty.seed });
			world.addResource('combatMission', { value: undefined });
			world.addResource('combatProgress', { relay: empty.relay, wave: empty.wave, spawned: empty.spawned, spawnIn: empty.spawnIn, intermission: empty.intermission, time: empty.time, kills: empty.kills, outcome: empty.outcome, nextId: empty.nextId });
			world.addResource('combatFeedback', { beams: [], shake: 0, cannonIn: 0, events: [] });
			world.addResource('combatStats', empty.stats);
			world.addResource('combatControls', { raw: controls(), current: controls() });
			world.addResource('combatSession', { enabled: false, active: false, training: undefined, before: undefined });
			setEnabled = function (enabled) { world.getResource('combatSession').enabled = enabled; };
			playerId = function () { return world.getEntitiesWithQuery(['player'])[0]?.id; };
			enemyId = function (id) { return world.getEntitiesWithQuery(['enemy']).find(function (entity) { return entity.components.enemy.id === id; })?.id; };
			const remove = function (id: number) { world.removeEntity(id); };
			const component = function <K extends keyof CombatComponents>(id: number, name: K): CombatComponents[K] {
				const value = world.getComponent(id, name);
				if (value === undefined) throw new Error(`Combat entity ${id} is missing ${name}`);
				return value;
			};
			const writeField = function <K extends keyof CombatComponents, F extends keyof CombatComponents[K]>(id: number, name: K, field: F, value: CombatComponents[K][F]) {
				const target = component(id, name);
				if (target[field] === value) return;
				target[field] = value; world.markChanged(id, name);
			};

			// Unit is the domain-facing enemy view. Rebind it whenever callers replace
			// the component so its capability fields continue to have one ECS owner.
			onCleanup(world.onComponentAdded('enemy', function ({ entity, value: enemy }) {
				const position = { x: enemy.x, y: enemy.y }; const heading = { angle: enemy.angle }; const health = { hp: enemy.hp, maxHp: enemy.maxHp }; const enemyWeapons = { mounts: enemy.loadout }; const enemyReactor = { ...(enemy.reactor ?? { heat: 0, overheated: false }) };
				world.addComponents(entity.id, { position, heading, health, enemyWeapons, enemyReactor });
				Object.defineProperties(enemy, {
					x: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'position').x; }, set: function (value: number) { writeField(entity.id, 'position', 'x', value); } },
					y: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'position').y; }, set: function (value: number) { writeField(entity.id, 'position', 'y', value); } },
					angle: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'heading').angle; }, set: function (value: number) { writeField(entity.id, 'heading', 'angle', value); } },
					hp: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'health').hp; }, set: function (value: number) { writeField(entity.id, 'health', 'hp', value); } },
					maxHp: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'health').maxHp; }, set: function (value: number) { writeField(entity.id, 'health', 'maxHp', value); } },
					loadout: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'enemyWeapons').mounts; }, set: function (value: WeaponMount[] | undefined) { writeField(entity.id, 'enemyWeapons', 'mounts', value); } },
					reactor: { configurable: true, enumerable: true, get: function () { return component(entity.id, 'enemyReactor'); }, set: function (value: ReactorState | undefined) { world.addComponent(entity.id, 'enemyReactor', value ?? { heat: 0, overheated: false }); } },
				});
			}));
			const enemyCollection = collection<Unit>({
				list: function () { return world.getEntitiesWithQuery(['enemy', 'combatOrder']).sort(function (a, b) { return a.components.combatOrder - b.components.combatOrder; }).map(function (entity) { return { id: entity.id, value: entity.components.enemy }; }); },
				remove, setOrder,
				spawn: function (enemy) { world.spawn({ combatOwned: true, combatOrder: nextOrder(), enemy }); },
			});
			const shots = collection<Shot>({ list: function () { return world.getEntitiesWithQuery(['projectile', 'combatOrder']).sort(function (a, b) { return a.components.combatOrder - b.components.combatOrder; }).map(function (entity) { return { id: entity.id, value: entity.components.projectile }; }); }, spawn: function (value) { world.spawn({ combatOwned: true, combatOrder: nextOrder(), projectile: value }); }, remove, setOrder });
			const effects = collection<Effect>({ list: function () { return world.getEntitiesWithQuery(['effect', 'combatOrder']).sort(function (a, b) { return a.components.combatOrder - b.components.combatOrder; }).map(function (entity) { return { id: entity.id, value: entity.components.effect }; }); }, spawn: function (value) { world.spawn({ combatOwned: true, combatOrder: nextOrder(), effect: value }); }, remove, setOrder });
			const warnings = collection<Warning>({ list: function () { return world.getEntitiesWithQuery(['warning', 'combatOrder']).sort(function (a, b) { return a.components.combatOrder - b.components.combatOrder; }).map(function (entity) { return { id: entity.id, value: entity.components.warning }; }); }, spawn: function (value) { world.spawn({ combatOwned: true, combatOrder: nextOrder(), warning: value }); }, remove, setOrder });
			const strikes = collection<ArtilleryStrike>({ list: function () { return world.getEntitiesWithQuery(['artillery', 'combatOrder']).sort(function (a, b) { return a.components.combatOrder - b.components.combatOrder; }).map(function (entity) { return { id: entity.id, value: entity.components.artillery }; }); }, spawn: function (value) { world.spawn({ combatOwned: true, combatOrder: nextOrder(), artillery: value }); }, remove, setOrder });
			const wrecks = collection<Wreck>({ list: function () { return world.getEntitiesWithQuery(['wreck', 'combatOrder']).sort(function (a, b) { return a.components.combatOrder - b.components.combatOrder; }).map(function (entity) { return { id: entity.id, value: entity.components.wreck }; }); }, spawn: function (value) { world.spawn({ combatOwned: true, combatOrder: nextOrder(), wreck: value }); }, remove, setOrder });
			const bindMission = function (mission: MissionRuntime | undefined) {
				const structure = mission?.structure;
				for (const entity of world.getEntitiesWithQuery(['structure'])) remove(entity.id);
				if (structure) world.spawn({ combatOwned: true, structure });
				if (mission) Object.defineProperty(mission, 'structure', {
					configurable: true, enumerable: true,
					get: function () { return world.getEntitiesWithQuery(['structure'])[0]?.components.structure; },
					set: function (value: MissionRuntime['structure']) { for (const entity of world.getEntitiesWithQuery(['structure'])) remove(entity.id); if (value) world.spawn({ combatOwned: true, structure: value }); },
				});
				world.getResource('combatMission').value = mission;
			};
			attach = function (initial, training) {
				const snapshot = { ...initial, mission: initial.mission ? { ...initial.mission } : undefined, player: { ...initial.player }, enemies: initial.enemies.map(function (enemy) { return { ...enemy }; }), shots: [...initial.shots], effects: [...initial.effects], warnings: [...initial.warnings], strikes: [...initial.strikes], wrecks: [...initial.wrecks] };
				for (const entity of world.getEntitiesWithQuery(['combatOwned'])) remove(entity.id);
				const config = { frame: snapshot.frame, difficulty: snapshot.difficulty, phase: snapshot.phase, seed: snapshot.seed };
				const progress = { relay: snapshot.relay, wave: snapshot.wave, spawned: snapshot.spawned, spawnIn: snapshot.spawnIn, intermission: snapshot.intermission, time: snapshot.time, kills: snapshot.kills, outcome: snapshot.outcome, nextId: snapshot.nextId };
				const feedback = { beams: snapshot.beams.map(function (beam) { return { ...beam }; }), shake: snapshot.shake, cannonIn: snapshot.cannonIn, events: snapshot.events };
				world.addResource('combatConfig', config); world.addResource('combatProgress', progress); world.addResource('combatFeedback', feedback); world.addResource('combatStats', snapshot.stats);
				bindMission(snapshot.mission);
				const position = { x: snapshot.player.x, y: snapshot.player.y }; const heading = { angle: snapshot.player.angle };
				const drive = { throttle: snapshot.player.throttle, speed: snapshot.player.speed }; const aim = { turret: snapshot.player.turret };
				const health = { hp: snapshot.player.hp, maxHp: 100 }; const reactor = { heat: snapshot.player.heat, overheated: snapshot.player.overheated, coolantCharges: snapshot.coolantCharges, coolantHeld: snapshot.coolantHeld };
				const weaponBank = { mounts: snapshot.loadout };
				const playerEntity = world.spawn({ combatOwned: true, player: true, position, heading, drive, aim, health, reactor, weaponBank });
				const player: Player = {
					get x() { return component(playerEntity.id, 'position').x; }, set x(value) { writeField(playerEntity.id, 'position', 'x', value); },
					get y() { return component(playerEntity.id, 'position').y; }, set y(value) { writeField(playerEntity.id, 'position', 'y', value); },
					get angle() { return component(playerEntity.id, 'heading').angle; }, set angle(value) { writeField(playerEntity.id, 'heading', 'angle', value); },
					get throttle() { return component(playerEntity.id, 'drive').throttle; }, set throttle(value) { writeField(playerEntity.id, 'drive', 'throttle', value); },
					get speed() { return component(playerEntity.id, 'drive').speed; }, set speed(value) { writeField(playerEntity.id, 'drive', 'speed', value); },
					get turret() { return component(playerEntity.id, 'aim').turret; }, set turret(value) { writeField(playerEntity.id, 'aim', 'turret', value); },
					get hp() { return component(playerEntity.id, 'health').hp; }, set hp(value) { writeField(playerEntity.id, 'health', 'hp', value); },
					get heat() { return component(playerEntity.id, 'reactor').heat; }, set heat(value) { writeField(playerEntity.id, 'reactor', 'heat', value); },
					get overheated() { return component(playerEntity.id, 'reactor').overheated; }, set overheated(value) { writeField(playerEntity.id, 'reactor', 'overheated', value); },
				};
				const facade: CombatStateView = {
					get player() { return player; }, set player(value) { Object.assign(player, value); },
					get frame() { return world.getResource('combatConfig').frame; }, set frame(value) { world.getResource('combatConfig').frame = value; },
					get difficulty() { return world.getResource('combatConfig').difficulty; }, set difficulty(value) { world.getResource('combatConfig').difficulty = value; },
					get phase() { return world.getResource('combatConfig').phase; }, set phase(value) { world.getResource('combatConfig').phase = value; },
					get seed() { return world.getResource('combatConfig').seed; }, set seed(value) { world.getResource('combatConfig').seed = value; },
					get relay() { return world.getResource('combatProgress').relay; }, set relay(value) { world.getResource('combatProgress').relay = value; },
					get wave() { return world.getResource('combatProgress').wave; }, set wave(value) { world.getResource('combatProgress').wave = value; },
					get spawned() { return world.getResource('combatProgress').spawned; }, set spawned(value) { world.getResource('combatProgress').spawned = value; },
					get spawnIn() { return world.getResource('combatProgress').spawnIn; }, set spawnIn(value) { world.getResource('combatProgress').spawnIn = value; },
					get intermission() { return world.getResource('combatProgress').intermission; }, set intermission(value) { world.getResource('combatProgress').intermission = value; },
					get time() { return world.getResource('combatProgress').time; }, set time(value) { world.getResource('combatProgress').time = value; },
					get kills() { return world.getResource('combatProgress').kills; }, set kills(value) { world.getResource('combatProgress').kills = value; },
					get outcome() { return world.getResource('combatProgress').outcome; }, set outcome(value) { world.getResource('combatProgress').outcome = value; },
					get nextId() { return world.getResource('combatProgress').nextId; }, set nextId(value) { world.getResource('combatProgress').nextId = value; },
					get beams() { return world.getResource('combatFeedback').beams; }, set beams(value) { world.getResource('combatFeedback').beams = value; },
					get beam() { return world.getResource('combatFeedback').beams[0]; },
					set beam(value) { world.getResource('combatFeedback').beams = value ? [{ ...value, slot: value.slot ?? 0 }] : []; },
					get shake() { return world.getResource('combatFeedback').shake; }, set shake(value) { world.getResource('combatFeedback').shake = value; },
					get cannonIn() { return world.getResource('combatFeedback').cannonIn; }, set cannonIn(value) { world.getResource('combatFeedback').cannonIn = value; },
					get events() { return world.getResource('combatFeedback').events; }, set events(value) { world.getResource('combatFeedback').events = value; },
					get coolantCharges() { return component(playerEntity.id, 'reactor').coolantCharges; }, set coolantCharges(value) { writeField(playerEntity.id, 'reactor', 'coolantCharges', value); },
					get coolantHeld() { return component(playerEntity.id, 'reactor').coolantHeld; }, set coolantHeld(value) { writeField(playerEntity.id, 'reactor', 'coolantHeld', value); },
					get stats() { return world.getResource('combatStats'); }, set stats(value) { world.addResource('combatStats', value); },
					get loadout() { return component(playerEntity.id, 'weaponBank').mounts; }, set loadout(value) { writeField(playerEntity.id, 'weaponBank', 'mounts', value); },
					get enemies() { return enemyCollection.read(); }, set enemies(value) { enemyCollection.replace(value); },
					get shots() { return shots.read(); }, set shots(value) { shots.replace(value); },
					get effects() { return effects.read(); }, set effects(value) { effects.replace(value); },
					get warnings() { return warnings.read(); }, set warnings(value) { warnings.replace(value); },
					get strikes() { return strikes.read(); }, set strikes(value) { strikes.replace(value); },
					get wrecks() { return wrecks.read(); }, set wrecks(value) { wrecks.replace(value); },
				};
				Object.defineProperty(facade, 'mission', { enumerable: true, get: function () { return world.getResource('combatMission').value; }, set: function (value: MissionRuntime | undefined) { bindMission(value); } });
				facade.enemies = snapshot.enemies; facade.shots = snapshot.shots; facade.effects = snapshot.effects; facade.warnings = snapshot.warnings; facade.strikes = snapshot.strikes; facade.wrecks = snapshot.wrecks;
				const session = world.getResource('combatSession'); session.training = training; session.active = false;
				if (training) training.state = facade;
				state = facade; return facade;
			};
			// Writer queries omit automatic mutates: scalar capability setters publish
			// precise owner writes. Nested weapon/attack
			// data and transient components are marked only inside an active phase;
			// automatic query marking would also stamp every paused fixed tick.
			const markAll = function <K extends keyof CombatComponents>(name: K) {
				for (const entity of world.getEntitiesWithQuery([name])) world.markChanged(entity.id, name);
			};
			const trackDamageTargets = function (process: () => void) {
				const structures = world.getEntitiesWithQuery(['structure']).map(function (entity) { return { id: entity.id, hp: entity.components.structure.hp }; });
				const enemies = world.getEntitiesWithQuery(['enemy']).map(function (entity) { return { id: entity.id, engaged: entity.components.enemy.engaged }; });
				process();
				for (const before of structures) { const structure = world.getComponent(before.id, 'structure'); if (structure && structure.hp !== before.hp) world.markChanged(before.id, 'structure'); }
				for (const before of enemies) { const enemy = world.getComponent(before.id, 'enemy'); if (enemy && enemy.engaged !== before.engaged) world.markChanged(before.id, 'enemy'); }
			};
			world.addSystem('combat:begin').withRef(refs.begin).inPhase('fixedUpdate').inGroup('combat').withResources(['combatSession', 'combatOrdering', 'combatControls', 'combatFeedback', 'combatConfig', 'combatProgress', 'combatStats', 'combatMission'])
				.setProcess(function ({ resources }) {
					const session = resources.combatSession;
					session.active = session.enabled && Boolean(state) && state?.outcome === 'playing' && session.training?.stage !== 'complete';
					if (!session.active || !state) return;
					hooks.beforeStep?.();
					if (!session.enabled) { session.active = false; return; }
					resources.combatFeedback.events = [];
					resources.combatControls.raw = controls();
					session.before = { x: state.player.x, y: state.player.y, angle: state.player.angle, hits: state.stats.shotsHit };
					resources.combatControls.current = session.training ? prepareTraining(session.training, resources.combatControls.raw) : resources.combatControls.raw;
				});
			world.addSystem('combat:cooling').withRef(refs.cooling).inPhase('fixedUpdate').inGroup('combat').after(refs.begin).withResources(['combatSession', 'combatOrdering', 'combatControls', 'combatConfig', 'combatProgress', 'combatFeedback', 'combatStats'])
				.addQuery('reactors', { with: ['player', 'reactor', 'weaponBank'] }).setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; coolingStep(state, resources.combatControls.current, dt); markAll('weaponBank'); });
			world.addSystem('combat:movement').withRef(refs.movement).inPhase('fixedUpdate').inGroup('combat').after(refs.cooling).withResources(['combatSession', 'combatOrdering', 'combatControls', 'combatConfig', 'combatMission'])
				.addQuery('pilots', { with: ['player', 'position', 'heading', 'drive', 'aim'] }).setProcess(function ({ resources, dt }) { if (resources.combatSession.active && state) movementStep(state, resources.combatControls.current, dt); });
			world.addSystem('combat:weapons').withRef(refs.weapons).inPhase('fixedUpdate').inGroup('combat').after(refs.movement).withResources(['combatSession', 'combatOrdering', 'combatControls', 'combatConfig', 'combatFeedback', 'combatStats', 'combatMission', 'combatProgress'])
				.addQuery('structures', { with: ['structure'] }).addQuery('targets', { with: ['enemy', 'health'] }).addQuery('weapons', { with: ['player', 'weaponBank', 'reactor'] }).setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; const current = state; trackDamageTargets(function () { weaponsStep(current, resources.combatControls.current, dt); }); markAll('weaponBank'); });
			world.addSystem('combat:spawning').withRef(refs.spawning).inPhase('fixedUpdate').inGroup('combat').after(refs.weapons).withResources(['combatSession', 'combatOrdering', 'combatProgress', 'combatMission', 'combatConfig', 'combatFeedback'])
				.setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; spawningStep(state, dt); markAll('warning'); });
			world.addSystem('combat:enemies').withRef(refs.enemies).inPhase('fixedUpdate').inGroup('combat').after(refs.spawning).withResources(['combatSession', 'combatOrdering', 'combatConfig', 'combatMission', 'combatFeedback', 'combatProgress'])
				.addQuery('enemies', { with: ['enemy', 'position', 'heading', 'health', 'enemyWeapons', 'enemyReactor'] }).runWhenEmpty().setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; enemiesStep(state, dt); markAll('enemy'); markAll('enemyWeapons'); markAll('enemyReactor'); });
			world.addSystem('combat:artillery').withRef(refs.artillery).inPhase('fixedUpdate').inGroup('combat').after(refs.enemies).withResources(['combatSession', 'combatOrdering', 'combatConfig', 'combatMission', 'combatStats', 'combatFeedback', 'combatProgress'])
				.addQuery('victims', { with: ['health'] }).addQuery('strikes', { with: ['artillery'] }).runWhenEmpty().setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; artilleryStep(state, dt); markAll('artillery'); });
			world.addSystem('combat:projectiles').withRef(refs.projectiles).inPhase('fixedUpdate').inGroup('combat').after(refs.artillery).withResources(['combatSession', 'combatOrdering', 'combatConfig', 'combatMission', 'combatStats', 'combatFeedback', 'combatProgress'])
				.addQuery('structures', { with: ['structure'] }).addQuery('targets', { with: ['enemy', 'health'] }).addQuery('projectiles', { with: ['projectile'] }).runWhenEmpty().setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; const current = state; trackDamageTargets(function () { projectilesStep(current, dt); }); markAll('projectile'); });
			world.addSystem('combat:deaths').withRef(refs.deaths).inPhase('fixedUpdate').inGroup('combat').after(refs.projectiles).withResources(['combatSession', 'combatOrdering', 'combatStats', 'combatProgress', 'combatFeedback'])
				.addQuery('damaged', { with: ['enemy', 'health'], mutates: [] }).runWhenEmpty().setProcess(function ({ resources }) { if (resources.combatSession.active && state) deathsStep(state); });
			world.addSystem('combat:effects').withRef(refs.effects).inPhase('fixedUpdate').inGroup('combat').after(refs.deaths).withResources(['combatSession'])
				.addQuery('effects', { with: ['effect'] }).runWhenEmpty().setProcess(function ({ resources, dt }) { if (!resources.combatSession.active || !state) return; effectsStep(state, dt); markAll('effect'); });
			world.addSystem('combat:outcome').withRef(refs.outcome).inPhase('fixedUpdate').inGroup('combat').after(refs.effects).withResources(['combatSession', 'combatOrdering', 'combatProgress', 'combatMission', 'combatFeedback'])
				.setProcess(function ({ resources, dt }) { if (resources.combatSession.active && state) outcomeStep(state, dt); });
			world.addSystem('combat:finish').inPhase('fixedUpdate').inGroup('combat').after(refs.outcome).withResources(['combatSession', 'combatOrdering', 'combatControls', 'combatFeedback', 'combatProgress', 'combatMission', 'combatConfig', 'combatStats'])
				.setProcess(function ({ resources, dt }) {
					const session = resources.combatSession; if (!session.active || !state) return;
					if (session.training && session.before) finishTraining(session.training, resources.combatControls.raw, dt, session.before);
					for (const event of resources.combatFeedback.events) world.eventBus.publish('combatEvent', { event, time: resources.combatProgress.time });
					world.eventBus.publish('combatStepFinished', { events: [...resources.combatFeedback.events], time: resources.combatProgress.time });
					hooks.afterStep?.();
				});
			onCleanup(function () { state = undefined; attach = undefined; setEnabled = undefined; playerId = undefined; enemyId = undefined; hooks = {}; });
		});
	return {
		plugin,
		attach: function (initial: CombatStateView, training?: Training): CombatStateView { if (!attach) throw new Error('Combat plugin is not installed'); return attach(initial, training); },
		setControls: function (provider: () => Controls) { controls = provider; },
		setEnabled: function (enabled: boolean) { setEnabled?.(enabled); },
		setHooks: function (next: CombatHooks) { hooks = next; },
		entityForPlayer: function () { return playerId?.(); },
		entityForEnemy: function (id: number) { return enemyId?.(id); },
	};
};
