import { expect, test } from 'bun:test';
import ECSpresso from 'ecspresso';
import { getWeapon } from '../src/arsenal';
import type { Contract, MissionMap } from '../src/campaign-types';
import { defaultReserves, loadedMounts } from '../src/combat-resources';
import { createCombatRuntime } from '../src/combat-runtime';
import { EMPLACEMENT_RADIUS, RIG_RADIUS } from '../src/combat-spatial';
import { getFrame, rigIntegrityDamage, type FrameId } from '../src/frames';
import { createStarterLoadout } from '../src/hardpoints';
import { createTouchFacing } from '../src/touch-controls';
import { artilleryAimStatus, artilleryStep, coolingStep, createMissionState, createState, deathsStep, enemiesStep, movementStep, projectilesStep, squadmatesStep, squadOrderDestinationClear, surveyed, targetMarked, weaponsStep, type CombatStateView, type Controls, type Point, type Shot, type PresetEnemyKind, type Unit } from '../src/simulation';

const dt = 1 / 60;
const terrain = { roads: [], obstacles: [{ kind: 'shed' as const, x: 1050, y: 800, width: 35, depth: 100, height: 120 }] };
const map: MissionMap = { seed: 0, biome: 'badlands', width: 3600, height: 2200, drop: { x: 800, y: 800 }, objective: { x: 1400, y: 800 }, extraction: { x: 600, y: 800 }, sites: [], landmarks: [] };
const contract: Contract = { id: 'frame-tactics', seed: 1, planetId: 'meridian', kind: 'demolition', tier: 2,
	employer: 'freeholds', opponent: 'combine', title: 'Field test', briefing: '', reward: 100, favor: 1, hostility: 1, requiredReputation: 0 };
const input = function (aim: Point, firing = true, targetId?: number): Controls {
	return { drive: 0, stop: false, turn: 0, coolant: false, aim, fire: [firing, false, false, false], ...(targetId === undefined ? {} : { targetId }) };
};
const hostile = function (id: number, point: Point, kind: PresetEnemyKind = 'scout', frameId?: FrameId): Unit {
	return { ...point, id, hp: 500, maxHp: 500, kind, heavy: false, angle: 0, hullAngle: 0, cooldown: 0, stationary: true, engaged: true,
		...(frameId ? { catalog: { frameId, speed: 0, throttle: 0, shotsFired: 0 }, loadout: loadedMounts(createStarterLoadout(frameId)) } : {}) };
};
const kit = function (frameId: FrameId) {
	const loadout = createStarterLoadout(frameId);
	return { frameId, loadout, reserves: defaultReserves(loadout), integrity: 100, pilotId: 'wing', callsign: 'Wing', specialty: 'marksman' as const };
};
const weapons = function (state: CombatStateView, controls: Controls, ticks: number) {
	for (let i = 0; i < ticks; i++) weaponsStep(state, controls, dt);
};

test('Harrow cannot spend ammo before bracing, inside minimum range, outside range or while moving', function () {
	const state = createMissionState(contract, { frame: 'harrow-b', map });
	state.enemies = [];
	const mount = state.loadout[0];
	if (!mount) throw new Error('Missing mortar');
	const initial = mount.rounds;
	const aim = { x: 2550, y: 800 };
	weapons(state, input(aim), 47);
	expect(mount.rounds).toBe(initial);
	expect(state.strikes).toHaveLength(0);
	weapons(state, input({ x: 999, y: 800 }), 1);
	expect(artilleryAimStatus(state, { x: 999, y: 800 })).toBe('MIN RANGE 200 M');
	weapons(state, input({ x: 2551, y: 800 }), 1);
	expect(artilleryAimStatus(state, { x: 2551, y: 800 })).toBe('MAX RANGE 1750 M');
	weapons(state, input({ x: 500, y: 800 }), 1);
	expect(mount.rounds).toBe(initial);
	state.player.speed = 4;
	weapons(state, input(aim), 1); expect(state.player.brace).toBe(0);
	state.player.speed = 0;
	weapons(state, input(aim), 47);
	expect(state.strikes).toHaveLength(0);
	weapons(state, input(aim), 1);
	expect(state.shots).toHaveLength(0);
	expect(mount.rounds).toBe(initial - 3);
	expect(state.player.heat).toBe(21);
	expect(state.effects.filter(function (effect) { return effect.feedback?.type === 'fire' && effect.feedback.family === 'artillery'; })).toHaveLength(3);
	expect(state.strikes.map(function (strike) { return [strike.x, strike.y, strike.friendly]; })).toEqual([[2550, 710, true], [2550, 800, true], [2550, 890, true]]);
	const [first, second, third] = state.strikes;
	if (!first || !second || !third) throw new Error('Missing barrage');
	expect(first.life).toBeLessThan(second.life); expect(second.life).toBeLessThan(third.life);
	weapons(state, input(aim), 1); expect(mount.rounds).toBe(initial - 3);
});

test('Siegebreaker hits facilities at double damage, excludes aircraft and ignores friendly rigs', function () {
	const state = createMissionState(contract, { frame: 'harrow-c', map: { ...map, terrain }, squadmates: [kit('warden')] });
	const facility = state.mission?.structure; const wing = state.squadmates[0];
	if (!facility || !wing) throw new Error('Missing facility or wing');
	const ground = hostile(90, facility); const aircraft = hostile(91, facility, 'vtol');
	state.enemies = [ground, aircraft];
	wing.x = facility.x; wing.y = facility.y;
	const previous = facility.hp;
	weapons(state, input(facility), 48);
	const strike = state.strikes[0];
	if (!strike) throw new Error('Missing siege strike');
	expect(strike.radius).toBe(45);
	artilleryStep(state, strike.life - dt);
	expect(ground.hp).toBe(500);
	artilleryStep(state, 2 * dt);
	expect(500 - ground.hp).toBe(strike.damage);
	expect(previous - facility.hp).toBe(strike.damage * 2);
	expect(aircraft.hp).toBe(500); expect(wing.hp).toBe(100);
	expect(state.stats.shotsHit).toBe(1);
});

test('friendly Harrow allies stop to lob at range, and catalog Harrows commit hostile strikes that survive their shooter', function () {
	const state = createMissionState({ ...contract, kind: 'clearance' }, { frame: 'warden', map, squadmates: [kit('harrow')] });
	const wing = state.squadmates[0];
	if (!wing) throw new Error('Missing wing');
	Object.assign(wing, { x: 1000, y: 900, angle: 0, turret: 0, throttle: 0, speed: 0 });
	const victim = hostile(90, { x: wing.x + 1100, y: wing.y });
	state.enemies = [victim];
	for (let tick = 0; tick < 48; tick++) squadmatesStep(state, dt);
	expect(wing.x).toBe(1000);
	const allied = state.strikes[0];
	expect(allied).toMatchObject({ x: victim.x, y: victim.y, friendly: true, squadmateId: 'wing' });
	const enemy = hostile(91, { x: 400, y: state.player.y }, 'striker', 'harrow');
	state.enemies = [enemy]; state.strikes = [];
	for (let tick = 0; tick < 48; tick++) enemiesStep(state, dt);
	const strike = state.strikes[0];
	expect(strike).toMatchObject({ owner: enemy.id, x: state.player.x, y: state.player.y });
	if (!strike) throw new Error('Missing catalog strike');
	state.enemies = [];
	artilleryStep(state, strike.life + dt);
	expect(state.player.hp).toBeCloseTo(100 - rigIntegrityDamage(state.frame, strike.damage) * getFrame(state.frame).incomingDamage);
});

test('an emplacement can fire at close range and its marked circle damages ground units on both sides', function () {
	const state = createMissionState(contract, { frame: 'warden', map, squadmates: [kit('warden')] });
	const wing = state.squadmates[0];
	if (!wing) throw new Error('Missing wing');
	const gun = hostile(90, { x: state.player.x + 1, y: state.player.y }, 'artillery');
	state.enemies = [gun];
	for (let tick = 0; tick <= 120; tick++) enemiesStep(state, dt);
	const shot = state.strikes[0];
	if (!shot?.emplacement) throw new Error('Missing emplacement round');
	expect(shot.owner).toBe(gun.id);
	const inside = { x: shot.x + shot.radius - .25, y: shot.y };
	const outside = { x: shot.x + shot.radius + .25, y: shot.y };
	const ground = hostile(91, inside), clear = hostile(92, outside), aircraft = hostile(93, shot, 'vtol');
	state.enemies = [gun, ground, clear, aircraft];
	Object.assign(wing, inside); Object.assign(state.player, outside);
	artilleryStep(state, 2);
	expect(wing.hp).toBeLessThan(100); expect(state.player.hp).toBe(100);
	expect(ground.hp).toBe(ground.maxHp - shot.damage);
	expect(clear.hp).toBe(clear.maxHp); expect(aircraft.hp).toBe(aircraft.maxHp);
	expect(state.stats.damageDealt).toBe(0); expect(state.stats.shotsHit).toBe(0);
});

test('the gun foundation blocks a driving rig and squad move orders, including after the carriage is destroyed', function () {
	const state = createMissionState(contract, { frame: 'warden', map });
	const gun = hostile(90, { x: 1100, y: 800 }, 'artillery');
	state.enemies = [gun];
	const drive = { ...input(gun, false), drive: 1 };
	for (const intact of [true, false]) {
		if (!intact) { gun.hp = 0; deathsStep(state); }
		Object.assign(state.player, { x: 850, y: gun.y, angle: 0, speed: 0, motorSpeed: 0, throttle: 0 });
		for (let tick = 0; tick < 600; tick++) movementStep(state, drive, dt);
		expect(state.player.x).toBeCloseTo(gun.x - EMPLACEMENT_RADIUS - RIG_RADIUS, 2);
		expect(state.player.y).toBe(gun.y);
		expect(squadOrderDestinationClear(state, gun)).toBe(false);
	}
});

test('Bastion plates follow the torso on player, ally and catalog damage, and ignore overhead impacts', function () {
	const hit = function (at: Point, direction: number, source: Pick<Shot, 'owner' | 'kind'>): Shot {
		return { x: at.x + direction * 80, y: at.y, elevation: 42, vx: -direction * 1000, vy: 0, damage: 10, life: 1, target: undefined, ...source };
	};
	const state = createMissionState(contract, { frame: 'bastion-b', map, squadmates: [kit('bastion-c')] });
	const wing = state.squadmates[0];
	if (!wing) throw new Error('Missing wing');
	state.enemies = [];
	state.player.angle = Math.PI / 2; state.player.turret = 0;
	Object.assign(wing, { x: 1100, y: 1100, angle: Math.PI / 2, turret: 0 });
	state.shots = [hit(state.player, 1, { kind: 'enemy' }), hit(wing, 1, { kind: 'bullet', owner: 88 })];
	projectilesStep(state, .1);
	expect(state.player.hp).toBeCloseTo(94.7); expect(wing.hp).toBeCloseTo(100 - rigIntegrityDamage(wing.frameId, 5.3));
	const enemy = hostile(90, { x: 1500, y: 1200 }, 'striker', 'bastion');
	enemy.hullAngle = Math.PI / 2;
	state.enemies = [enemy]; state.shots = [hit(enemy, 1, { kind: 'cannon' }), hit(enemy, -1, { kind: 'cannon' }), { ...hit(enemy, 1, { kind: 'cannon' }), x: enemy.x, vx: 0, elevation: 135, vElevation: -1000 }];
	projectilesStep(state, .15);
	expect(enemy.maxHp - enemy.hp).toBeCloseTo(rigIntegrityDamage('bastion', 5.3 + 20 * getFrame('bastion').incomingDamage));
	state.strikes = [{ ...state.player, life: dt, id: 92, duration: dt, radius: 85, damage: 10 }];
	artilleryStep(state, dt);
	expect(state.player.hp).toBeCloseTo(94.7 - 10 * getFrame('bastion-b').incomingDamage);
});

test('Disruptor slows normal and catalog timers without stacking or affecting its own side', function () {
	const state = createState({ frame: 'specter-b' });
	const p = state.player;
	const near = hostile(99, { x: p.x + 250, y: p.y });
	const far = hostile(98, { x: p.x - 310, y: p.y });
	const catalog = hostile(97, { x: p.x + 280, y: p.y }, 'scout', 'specter-b');
	state.enemies = [near, far, catalog];
	for (const enemy of state.enemies) enemy.cooldown = 1;
	for (const mount of state.loadout) mount.cooldown = 1;
	coolingStep(state, input(p), .1);
	enemiesStep(state, .1);
	expect(near.cooldown).toBeCloseTo(.935);
	expect(far.cooldown).toBeCloseTo(.9);
	expect(catalog.cooldown).toBeCloseTo(.935);
	expect(state.loadout[0]?.cooldown).toBeCloseTo(.935);
	catalog.hp = 0;
	coolingStep(state, input(p), .1);
	expect(state.loadout[0]?.cooldown).toBeCloseTo(.835);
});

test('Designator requires continuous selected observation and boosts allied shots only while the mark holds', function () {
	const state = createMissionState(contract, { frame: 'specter-c', map });
	const at = { x: state.player.x + 500, y: state.player.y };
	const threat = hostile(90, at); state.enemies = [threat];
	const observe = input(at, false, threat.id);
	weapons(state, observe, 35); expect(targetMarked(state, threat.id)).toBeFalse();
	weapons(state, input(at, false), 1);
	weapons(state, observe, 35); expect(targetMarked(state, threat.id)).toBeFalse();
	weapons(state, observe, 1); expect(targetMarked(state, threat.id)).toBeTrue();
	const fire = function () {
		state.shots.push({ x: at.x - 60, y: at.y, vx: 1000, vy: 0, elevation: 42, life: 1, kind: 'bullet', target: undefined, damage: 10, squadmateId: 'wing' });
		projectilesStep(state, .1);
	};
	fire(); expect(threat.hp).toBe(488);
	if (!state.mission) throw new Error('Missing field');
	state.mission.map = { ...map, terrain };
	expect(targetMarked(state, threat.id)).toBeFalse();
	weapons(state, observe, 36);
	expect(targetMarked(state, threat.id)).toBeFalse();
	state.mission.map = map;
	weapons(state, observe, 35); expect(targetMarked(state, threat.id)).toBeFalse();
	weapons(state, observe, 1); expect(targetMarked(state, threat.id)).toBeTrue();
	state.player.angle = Math.PI;
	expect(targetMarked(state, threat.id)).toBeFalse();
	fire(); expect(threat.hp).toBe(478);
});

test('Pathfinder extends contact details from a living squadmate without removing ordinary contacts', function () {
	const state = createMissionState(contract, { frame: 'warden', map, squadmates: [kit('specter')] });
	const wing = state.squadmates[0];
	if (!wing) throw new Error('Missing Pathfinder');
	const near = hostile(90, { x: wing.x + 1050, y: wing.y });
	const far = hostile(91, { x: wing.x + 1120, y: wing.y });
	state.enemies = [near, far];
	expect(surveyed(state, near)).toBeTrue(); expect(surveyed(state, far)).toBeFalse();
	wing.hp = 0; expect(surveyed(state, near)).toBeFalse();
	expect(state.enemies).toEqual([near, far]);
});

test('Pursuer accepts a short lock and recycles quickly, Saturation disperses successive rounds reproducibly', function () {
	const state = createState({ frame: 'morrow-pursuer' });
	const target = hostile(96, { x: state.player.x, y: state.player.y - 420 }); state.enemies = [target];
	const tracking = input(target, true, target.id);
	weapons(state, tracking, 47); expect(state.shots).toHaveLength(0);
	weapons(state, tracking, 1); expect(state.shots[0]?.target).toBe(target.id);
	expect(state.loadout[0]?.cooldown).toBeCloseTo(getWeapon('stream-missiles').interval * .65);
	const volley = function (left: boolean, right: boolean) {
		const rig = createState({ frame: 'morrow-saturation' });
		rig.loadout = loadedMounts(createStarterLoadout('morrow-saturation'));
		weapons(rig, { ...input({ x: rig.player.x, y: rig.player.y - 600 }), fire: [left, right, false, false] }, 40);
		return rig.shots;
	};
	const combined = volley(true, true);
	for (const slot of [0, 1]) {
		const solo = volley(slot === 0, slot === 1);
		const observed = combined.filter(function (shot) { return shot.slot === slot; });
		expect(observed.map(function (shot) { return shot.origin; })).toEqual(solo.map(function (shot) { return shot.origin; }));
		expect(new Set(observed.map(function (shot) { return JSON.stringify(shot.origin); })).size).toBe(6);
		const velocities = observed.map(function (shot) { return shot.vx; });
		expect(Math.max(...velocities) - Math.min(...velocities)).toBeGreaterThan(200);
	}
});

test('live ECS keeps brace progress and applies delayed mortar damage to its authoritative target', async function () {
	const scenario = createMissionState(contract, { frame: 'harrow', map });
	scenario.enemies = [];
	const combat = createCombatRuntime();
	const world = ECSpresso.create().withPlugin(combat.plugin).withFixedTimestep(dt).build();
	await world.initialize();
	try {
		const state = combat.attach(scenario);
		const at = state.mission?.structure;
		if (!at) throw new Error('Missing facility');
		const previous = at.hp;
		combat.setControls(function () { return input(at); }); combat.setEnabled(true);
		for (let tick = 0; tick < 47; tick++) world.update(dt);
		expect(state.strikes).toHaveLength(0);
		world.update(dt);
		expect(state.strikes[0]?.friendly).toBeTrue();
		for (let tick = 0; tick < 86; tick++) world.update(dt);
		expect(at.hp).toBe(previous - 96);
		expect(state.stats.shotsHit).toBe(1);
	} finally { await world.dispose(); }
});

test('Harrow touch aim retains the tapped coordinate and keeps the minimum-range gate', function () {
	const state = createMissionState(contract, { frame: 'harrow', map });
	const touch = createTouchFacing();
	const ground = { x: state.player.x + 180, y: state.player.y };
	touch.select(ground, state.player, true);
	const near = touch.resolve(state.player);
	if (!near) throw new Error('Touch aim was not retained');
	weapons(state, input(near), 48);
	expect(state.strikes).toHaveLength(0);
	state.player.x -= 70;
	const retained = touch.resolve(state.player);
	if (!retained) throw new Error('Touch aim moved with the hull');
	weapons(state, input(retained), 48);
	expect(state.strikes[0]).toMatchObject(ground);
});
