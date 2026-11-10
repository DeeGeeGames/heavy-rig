import { consumeFire, coolReactor, frameWeight, loadedMounts, usableMount, weightMetrics, type ReactorState } from './combat-resources';
import { createMount, getWeapon, weaponDamage, type FireInputs, type WeaponDefinition, type WeaponId, type WeaponMount } from './arsenal';
import { FRAMES, getFrame, type FrameId } from './frames';
import { canEquipWeapon, getEnemyHardpoints, getHardpoints, isFrameLoadout } from './hardpoints';
import { getDifficultyDefinition, getWaveDefinition, WAVES, type Difficulty } from './operation';
import type { Contract, MissionRuntime } from './campaign-types';
import { EXTRACTION_RADIUS, EXTRACTION_SECONDS, FACILITY_RADIUS, FACILITY_TARGET_ID, generateMissionMap, missionHostileCount, missionSpawn } from './missions';
import { planSquads, squadApproach, type SquadOrder } from './enemy-squads';

export interface Point { x: number; y: number }
export type MechEnemyKind = 'scout' | 'striker' | 'siege';
export type EnemyKind = MechEnemyKind | 'helicopter' | 'vtol' | 'tank';
export type CombatEvent = 'artillery' | 'machine-gun' | 'ppc' | 'rocket' | 'cannon' | 'missile' | 'impact' | 'player-hit' | 'relay-hit' | 'explosion' | 'wave' | 'objective-complete' | 'coolant' | 'overheat' | 'defeat' | 'victory';
export interface AttackCycle { phase: 'committed' | 'recovery'; remaining: number; cycle: number }
export interface Unit extends Point { reactor?: ReactorState; id: number; hp: number; maxHp: number; angle: number; hullAngle?: number; cooldown: number; heavy: boolean; kind: EnemyKind; commander?: boolean; attack?: AttackCycle; engaged?: boolean; loadout?: WeaponMount[]; attackSlot?: number; squad?: SquadOrder }
export interface Shot extends Point { vx: number; vy: number; life: number; kind: 'cannon' | 'missile' | 'enemy' | 'bullet' | 'ppc' | 'rocket'; target: number | undefined; damage: number; splash?: number; hitIds?: number[]; weapon?: WeaponId; slot?: number; owner?: number; enemyTarget?: 'player' | 'relay' }
export interface Effect extends Point { life: number; size: number; color: string; elevation?: number; source?: 'muzzle'; slot?: number }
export interface Warning extends Point { kind: EnemyKind; life: number; commander?: boolean }
export interface ArtilleryStrike extends Point { id: number; life: number; duration: number; radius: number; damage: number; weapon?: WeaponId; slot?: number; owner?: number }
export interface CombatStats { damageDealt: number; damageTaken: number; relayDamage: number; shotsFired: number; shotsHit: number; overheats: number; killScore: number; commanderDestroyed: boolean }
export interface Wreck extends Point { kind: EnemyKind; angle: number }
export interface Controls { heading?: number; throttleTarget?: number; turretTurn?: number; drive: number; stop: boolean; turn: number; aim: Point; fire: FireInputs; coolant: boolean }
export interface CombatCollection<T> extends ReadonlyArray<T> {
	push(...items: T[]): number;
}
export interface CombatStateView {
	mission?: MissionRuntime;
	frame: FrameId; difficulty: Difficulty; phase: 'combat'; loadout: WeaponMount[]; seed: number; stats: CombatStats; strikes: CombatCollection<ArtilleryStrike>;
	player: Point & { angle: number; turret: number; throttle: number; speed: number; hp: number; heat: number; overheated: boolean };
	relay: number; enemies: CombatCollection<Unit>; shots: CombatCollection<Shot>; effects: CombatCollection<Effect>; wave: number; spawned: number; spawnIn: number;
	intermission: number; cannonIn: number; time: number; kills: number; shake: number;
	beam: (Point & { elevation?: number }) | undefined; outcome: 'playing' | 'won' | 'lost'; nextId: number;
	coolantCharges: number; coolantHeld: boolean; warnings: CombatCollection<Warning>; wrecks: CombatCollection<Wreck>; events: CombatEvent[];
}
// Plain domain callers retain ordinary mutable arrays. The live runtime exposes
// ordered query views with explicit append and whole-collection replacement.
export interface State extends CombatStateView {
	strikes: ArtilleryStrike[]; enemies: Unit[]; shots: Shot[];
	effects: Effect[]; warnings: Warning[]; wrecks: Wreck[];
}

export const ARENA = { width: 1800, height: 1200, relayX: 900, relayY: 600 };
interface EnemyStats { mass: number; recommendedMass: number; cooling: number; hp: number; speed: number; range: number; reload: number; damage: number; aggro: number; elevation: number; score: number }
export const ENEMY_STATS: Readonly<Record<EnemyKind, EnemyStats>> = {
	scout: { mass: 35, recommendedMass: 42, cooling: 10, hp: 480, speed: 66, range: 170, reload: 2, damage: 5, aggro: 650, elevation: 42, score: 200 },
	striker: { mass: 70, recommendedMass: 112, cooling: 12, hp: 760, speed: 44, range: 240, reload: 2.5, damage: 7, aggro: 440, elevation: 42, score: 300 },
	siege: { mass: 105, recommendedMass: 158, cooling: 11, hp: 500, speed: 28, range: 550, reload: 1.8, damage: 10, aggro: 650, elevation: 42, score: 500 },
	helicopter: { mass: 18, recommendedMass: 22, cooling: 9, hp: 220, speed: 105, range: 310, reload: 0.75, damage: 3, aggro: 800, elevation: 112, score: 250 },
	vtol: { mass: 30, recommendedMass: 62, cooling: 10, hp: 360, speed: 82, range: 440, reload: 2.8, damage: 9, aggro: 850, elevation: 147, score: 400 },
	tank: { mass: 60, recommendedMass: 72, cooling: 11, hp: 900, speed: 32, range: 390, reload: 3.4, damage: 14, aggro: 600, elevation: 30, score: 450 },
};
export interface MissionDeployment {
	difficulty?: Difficulty;
	frame?: FrameId;
	loadout?: readonly (WeaponId | null)[];
	reserves?: readonly number[];
	integrity?: number;
	coolantCharges?: number;
}
export const createMissionState = function (contract: Contract, options: MissionDeployment = {}): State {
	const state = createState({ ...options, frame: options.frame ?? 'kestrel', seed: contract.seed });
	if (options.loadout !== undefined) {
		if (!isFrameLoadout(state.frame, options.loadout)) throw new RangeError(`Invalid loadout for ${state.frame}`);
		state.loadout = loadedMounts(options.loadout, options.reserves);
	} else if (options.reserves !== undefined) {
		const loadout = getHardpoints(state.frame).map(function (_hardpoint, slot) { return state.loadout.find(function (mount) { return mount.slot === slot; })?.weapon ?? null; });
		state.loadout = loadedMounts(loadout, options.reserves);
	}
	state.player.hp = options.integrity === undefined ? 100 : Number.isFinite(options.integrity) ? Math.max(0, Math.min(100, options.integrity)) : 0;
	if (state.player.hp === 0) state.outcome = 'lost';
	state.coolantCharges = options.coolantCharges === undefined ? 2 : Number.isFinite(options.coolantCharges) ? Math.max(0, Math.min(3, Math.floor(options.coolantCharges))) : 0;
	const map = generateMissionMap(contract);
	const hostileCount = missionHostileCount(contract);
	const structureHp = (350 + Math.max(1, Math.min(3, contract.tier)) * 100) * getDifficultyDefinition(state.difficulty).enemyArmor;
	state.mission = {
		contract, map, stage: 'active',
		structure: contract.kind === 'demolition' ? { ...map.objective, hp: structureHp, maxHp: structureHp } : undefined,
		targetId: undefined, progress: 0, required: contract.kind === 'defend' || contract.kind === 'clearance' ? hostileCount : 1, extractTime: 0,
	};
	const heading = Math.atan2(map.objective.y - map.drop.y, map.objective.x - map.drop.x);
	state.player.x = map.drop.x; state.player.y = map.drop.y; state.player.angle = heading; state.player.turret = heading;
	state.spawnIn = 9;
	if (contract.kind !== 'defend') {
		for (let index = 0; index < hostileCount; index++) {
			const spawn = missionSpawn(contract, map, index);
			const enemy = createEnemy(state, spawn);
			state.enemies.push(enemy);
			if (spawn.commander) state.mission.targetId = enemy.id;
		}
		state.spawned = hostileCount;
	}
	return state;
};
const relayPosition = function (state: CombatStateView): Point | undefined {
	return state.mission ? state.mission.contract.kind === 'defend' ? state.mission.map.objective : undefined : { x: ARENA.relayX, y: ARENA.relayY };
};
const createEnemy = function (state: CombatStateView, spawn: Point & { kind: EnemyKind; commander?: boolean }): Unit {
	const hp = Math.round((spawn.commander ? 1680 : ENEMY_STATS[spawn.kind].hp) * getDifficultyDefinition(state.difficulty).enemyArmor);
	const target = relayPosition(state) ?? state.player;
	return { id: state.nextId++, x: spawn.x, y: spawn.y, hp, maxHp: hp, angle: Math.atan2(target.y - spawn.y, target.x - spawn.x), cooldown: 1.2, heavy: spawn.kind === 'siege' || spawn.kind === 'tank', kind: spawn.kind, reactor: { heat: 0, overheated: false }, loadout: createEnemyLoadout(spawn.kind, spawn.commander), ...(spawn.commander ? { commander: true } : {}) };
};
type CombatTarget = { id: number; kind: 'enemy'; body: Unit; radius: number } | { id: number; kind: 'structure'; body: NonNullable<MissionRuntime['structure']>; radius: number };
const combatTargets = function (state: CombatStateView): CombatTarget[] {
	const enemies: CombatTarget[] = state.enemies.filter(function (enemy) { return enemy.hp > 0; }).map(function (enemy) { return { id: enemy.id, kind: 'enemy', body: enemy, radius: 25 }; });
	const structure = state.mission?.structure;
	return structure && structure.hp > 0 ? [...enemies, { id: FACILITY_TARGET_ID, kind: 'structure', body: structure, radius: FACILITY_RADIUS }] : enemies;
};
export const distance = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
export const angleDelta = function (from: number, to: number) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); };
const clamp = function (value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); };
export const createState = function (options: { difficulty?: Difficulty; frame?: FrameId; starter?: WeaponId; seed?: number } = {}): State {
	const inferred = options.starter ? FRAMES.find(function (candidate) { return canEquipWeapon(candidate.id, 0, options.starter ?? candidate.starter); })?.id : undefined;
	const frame = getFrame(options.frame ?? inferred ?? 'warden');
	const starter = options.starter ?? frame.starter;
	const slot = getHardpoints(frame.id).findIndex(function (_hardpoint, index) { return canEquipWeapon(frame.id, index, starter); });
	if (slot < 0) throw new RangeError(`${starter} cannot equip to ${frame.id}`);
	return {
		frame: frame.id, difficulty: options.difficulty ?? 'standard', phase: 'combat', loadout: [{ ...createMount(starter), slot }], seed: options.seed ?? 1, strikes: [],
		stats: { damageDealt: 0, damageTaken: 0, relayDamage: 0, shotsFired: 0, shotsHit: 0, overheats: 0, killScore: 0, commanderDestroyed: false },
		player: { x: 900, y: 780, angle: -Math.PI / 2, turret: -Math.PI / 2, throttle: 0, speed: 0, hp: 100, heat: 0, overheated: false },
		relay: 100, enemies: [], shots: [], effects: [], wave: 1, spawned: 0, spawnIn: 4, intermission: 0,
		cannonIn: 0, time: 0, kills: 0, shake: 0, beam: undefined, outcome: 'playing', nextId: 1,
		coolantCharges: 2, coolantHeld: false, warnings: [], wrecks: [], events: [],
	};
};
const burst = function (state: CombatStateView, at: Point, size: number, color: string, source?: 'muzzle', slot?: number): Effect {
	const effect: Effect = { x: at.x, y: at.y, size, color, life: 0.5, ...(source ? { source } : {}), ...(slot !== undefined ? { slot } : {}) };
	state.effects.push(effect); return effect;
};
export const createEnemyLoadout = function (kind: EnemyKind, commander = false): WeaponMount[] {
	return getEnemyHardpoints(kind, commander).flatMap(function (hardpoint, slot) {
		const weapon = hardpoint.family === 'launcher' ? 'stream-missiles' : hardpoint.weapons.includes('autocannon') ? 'autocannon' : 'machine-gun';
		return hardpoint.weapons.includes(weapon) ? [{ ...createMount(weapon), slot }] : [];
	});
};
const enemyMounts = function (enemy: Unit): WeaponMount[] {
	const hardpoints = getEnemyHardpoints(enemy.kind, enemy.commander);
	const seen = new Set<number>();
	return (enemy.loadout ??= createEnemyLoadout(enemy.kind, enemy.commander)).filter(function (mount, index) {
		const slot = mount.slot ?? index; const hardpoint = hardpoints[slot];
		if (seen.has(slot) || hardpoint?.family !== getWeapon(mount.weapon).family || !hardpoint.weapons.includes(mount.weapon)) return false;
		seen.add(slot); mount.slot = slot; return true;
	});
};
export const enemyReactor = function (enemy: Unit): ReactorState { return enemy.reactor ??= { heat: 0, overheated: false }; };
export const enemyWeight = function (enemy: Unit) {
	const stats = ENEMY_STATS[enemy.kind];
	return weightMetrics(stats.mass, stats.recommendedMass, enemyMounts(enemy));
};
const launchEnemy = function (state: CombatStateView, enemy: Unit, mount: WeaponMount, target: Point, damage: number): boolean {
	if (!consumeFire(mount, enemyReactor(enemy))) return false;
	const angle = enemy.angle;
	const speed = enemy.kind === 'tank' ? 330 : 230;
	state.shots.push({ x: enemy.x + Math.cos(angle) * 30, y: enemy.y + Math.sin(angle) * 30, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 2.5, kind: 'enemy', target: undefined, damage: damage / getWeapon(mount.weapon).projectiles,
		weapon: mount.weapon, slot: mount.slot ?? 0, owner: enemy.id, ...(getWeapon(mount.weapon).kind === 'missile' ? { enemyTarget: target === state.player ? 'player' as const : 'relay' as const } : {}) });
	mount.firing = true;
	return true;
};
const fireEnemyMount = function (state: CombatStateView, enemy: Unit, mount: WeaponMount, target: Point, damage: number) {
	const weapon = getWeapon(mount.weapon);
	const delayed = weapon.kind === 'rocket' || weapon.stream;
	let emitted = 0;
	for (let round = 0; round < (delayed ? 1 : weapon.projectiles); round++) {
		if (!launchEnemy(state, enemy, mount, target, damage)) break;
		emitted++;
	}
	if (emitted === 0) return;
	mount.cooldown = weapon.interval;
	if (delayed && weapon.projectiles > 1 && usableMount(mount) && !enemyReactor(enemy).overheated) mount.rocketVolley = { remaining: Math.min(weapon.projectiles - 1, mount.rounds), nextIn: 0.1 };
};
const launchWeapon = function (state: CombatStateView, weapon: WeaponDefinition, mount: WeaponMount, angle: number, slot: number, target?: number) {
	if (weapon.kind === 'laser') return;
	const p = state.player;
	state.stats.shotsFired++;
	state.shots.push({ x: p.x + Math.cos(angle) * 30, y: p.y + Math.sin(angle) * 30,
		vx: Math.cos(angle) * weapon.speed, vy: Math.sin(angle) * weapon.speed, life: weapon.range / weapon.speed,
		kind: weapon.kind, weapon: weapon.id, slot, target, damage: weaponDamage(weapon, mount.level),
		...(weapon.splash > 0 ? { splash: weapon.splash } : {}), ...(weapon.kind === 'ppc' ? { hitIds: [] } : {}) });
};
// Return the earliest entry into a circle along a finite movement segment.
const hitFraction = function (from: Point, to: Point, target: Point, radius: number): number | undefined {
	const dx = to.x - from.x; const dy = to.y - from.y;
	const ox = from.x - target.x; const oy = from.y - target.y;
	const c = ox * ox + oy * oy - radius * radius;
	if (c <= 0) return 0;
	const a = dx * dx + dy * dy;
	if (a === 0) return undefined;
	const b = ox * dx + oy * dy;
	const discriminant = b * b - a * c;
	if (discriminant < 0) return undefined;
	const entry = (-b - Math.sqrt(discriminant)) / a;
	return entry >= 0 && entry <= 1 ? entry : undefined;
};
export const getEnemyDefense = function (state: CombatStateView, enemy: Unit): { frontalMultiplier: number; exposed: boolean; enraged: boolean } {
	return {
		frontalMultiplier: enemy.kind === 'tank' ? state.difficulty === 'story' ? 0.85 : 0.45 : enemy.kind !== 'siege' ? 1 : state.difficulty === 'story' ? 0.8 : enemy.commander ? 0.24 : 0.35,
		exposed: enemy.kind === 'siege' && enemy.attack?.phase === 'recovery',
		enraged: Boolean(enemy.commander) && enemy.hp < enemy.maxHp * 0.5,
	};
};
const hurtEnemy = function (state: CombatStateView, enemy: Unit, damage: number, from: Point) {
	const defense = getEnemyDefense(state, enemy);
	const frontal = Math.abs(angleDelta(enemy.kind === 'tank' ? enemy.hullAngle ?? enemy.angle : enemy.angle, Math.atan2(from.y - enemy.y, from.x - enemy.x))) < Math.PI / 3;
	const applied = damage * (defense.exposed ? 1.35 : frontal ? defense.frontalMultiplier : 1);
	state.stats.damageDealt += Math.min(Math.max(0, enemy.hp), applied);
	enemy.hp -= applied;
	if (state.mission) enemy.engaged = true;
};
const hurtTarget = function (state: CombatStateView, target: CombatTarget, damage: number, from: Point) {
	if (target.kind === 'enemy') { hurtEnemy(state, target.body, damage, from); return; }
	const structure = target.body;
	if (structure.hp <= 0) return;
	state.stats.damageDealt += Math.min(structure.hp, damage);
	structure.hp = Math.max(0, structure.hp - damage);
	if (structure.hp === 0) { burst(state, structure, 180, '#ffab62'); state.events.push('explosion'); state.stats.killScore += 1000; }
};
const hurtPlayer = function (state: CombatStateView, damage: number) {
	const resisted = damage * getFrame(state.frame).incomingDamage;
	if (resisted > 0 && state.player.hp > 0) state.events.push('player-hit');
	state.stats.damageTaken += Math.min(state.player.hp, resisted);
	state.player.hp = Math.max(0, state.player.hp - resisted);
	state.shake = 4;
};
const hurtRelay = function (state: CombatStateView, damage: number) {
	if (damage > 0 && state.relay > 0) state.events.push('relay-hit');
	state.stats.relayDamage += Math.min(state.relay, damage);
	state.relay = Math.max(0, state.relay - damage);
};
const commitBarrage = function (state: CombatStateView, enemy: Unit, target: Point, mount: WeaponMount) {
	const commander = Boolean(enemy.commander);
	const enraged = getEnemyDefense(state, enemy).enraged;
	const permissive = state.difficulty === 'story';
	const duration = commander ? 3.2 : 2.8;
	const radius = commander ? 82 : 62;
	const damage = (commander ? 16 : 10) * getDifficultyDefinition(state.difficulty).enemyDamage;
	const addStrike = function (at: Point, delay: number, size = radius) {
		if (!consumeFire(mount, enemyReactor(enemy))) return;
		state.strikes.push({ id: state.nextId++, x: at.x, y: at.y, life: delay, duration: delay, radius: size, damage, owner: enemy.id, slot: mount.slot ?? 4, weapon: mount.weapon });
	};
	// Every marker commits now. Neither movement nor destruction of the firing
	// frame can move or erase incoming ordnance.
	const pulses = permissive ? 1 : commander ? 3 : 2;
	for (let pulse = 0; pulse < pulses; pulse++) addStrike(target, duration + pulse * 0.7);
	if (commander && !permissive) {
		const offsets = enraged ? [-Math.PI / 2, 0, Math.PI / 2, Math.PI] : [-Math.PI / 2, Math.PI / 2];
		for (const offset of offsets) {
			const heading = enemy.angle + offset;
			addStrike({ x: target.x + Math.cos(heading) * 175, y: target.y + Math.sin(heading) * 175 }, duration + 1.4, 58);
		}
	}
	mount.cooldown = getWeapon(mount.weapon).interval;
	enemy.attack = { phase: 'committed', remaining: duration + (pulses - 1) * 0.7, cycle: enraged ? 2 : 1 };
	mount.firing = true;
	state.events.push('artillery');
};
export interface OperationReport {
	score: number;
	rank: 'S' | 'A' | 'B' | 'C' | 'D';
	kills: number;
	time: number;
	relay: number;
	armor: number;
	accuracy: number;
	damageDealt: number;
	damageTaken: number;
	relayDamage: number;
	overheats: number;
	commanderDestroyed: boolean;
}
export const getOperationReport = function (state: CombatStateView): OperationReport {
	const won = state.outcome === 'won';
	const completion = won ? 2000 + state.relay * 30 + state.player.hp * 10 + Math.max(0, 600 - state.time) * 4 : 0;
	const score = Math.floor((state.stats.killScore + completion) * getDifficultyDefinition(state.difficulty).scoreMultiplier);
	const rank = !won ? 'D' : state.relay >= 80 && state.player.hp >= 60 && state.stats.overheats <= 3 ? 'S' : state.relay >= 60 && state.player.hp >= 35 ? 'A' : state.relay >= 40 ? 'B' : 'C';
	return { score, rank, kills: state.kills, time: state.time, relay: Math.ceil(state.relay), armor: Math.ceil(state.player.hp), accuracy: state.stats.shotsFired > 0 ? Math.round(state.stats.shotsHit / state.stats.shotsFired * 100) : 0, damageDealt: Math.round(state.stats.damageDealt), damageTaken: Math.round(state.stats.damageTaken), relayDamage: Math.round(state.stats.relayDamage), overheats: state.stats.overheats, commanderDestroyed: state.stats.commanderDestroyed };
};
export const coolingStep = function (state: CombatStateView, input: Controls, dt: number) {
	const p = state.player;
	const frame = getFrame(state.frame);
	state.time += dt;
	state.cannonIn = Math.max(0, state.cannonIn - dt);
	for (const mount of state.loadout) { mount.cooldown = Math.max(0, mount.cooldown - dt); mount.firing = false; }
	state.shake = Math.max(0, state.shake - dt * 15);
	coolReactor(p, frame.cooling, dt);
	if (input.coolant && !state.coolantHeld && state.coolantCharges > 0 && p.heat > 0) {
		state.coolantCharges--; p.heat = Math.max(0, p.heat - 55);
		state.events.push('coolant'); burst(state, p, 80, '#93e9e1');
	}
	state.coolantHeld = input.coolant;
	if (p.overheated && p.heat <= 35) p.overheated = false;

};

export const movementStep = function (state: CombatStateView, input: Controls, dt: number) {
	const p = state.player;
	const frame = getFrame(state.frame);
	const bounds = state.mission?.map ?? ARENA;
	p.angle += input.heading === undefined ? input.turn * dt * frame.turnRate : clamp(angleDelta(p.angle, input.heading), -dt * frame.turnRate, dt * frame.turnRate);
	// Simulation holds its engine setting; arcade approaches stick demand, including neutral.
	const throttleChange = dt * 0.75;
	p.throttle = input.stop ? 0 : input.throttleTarget === undefined
		? clamp(p.throttle + input.drive * throttleChange, -1, 1)
		: p.throttle + clamp(clamp(input.throttleTarget, 0, 1) - p.throttle, -throttleChange, throttleChange);
	const modifier = frameWeight(state.frame, state.loadout).modifier;
	p.speed += (p.throttle * (p.throttle < 0 ? frame.reverseSpeed : frame.speed) * modifier - p.speed) * Math.min(1, dt * frame.acceleration);
	p.x = clamp(p.x + Math.cos(p.angle) * p.speed * dt, 35, bounds.width - 35);
	p.y = clamp(p.y + Math.sin(p.angle) * p.speed * dt, 35, bounds.height - 35);
	const aimAngle = Math.atan2(input.aim.y - p.y, input.aim.x - p.x);
	p.turret += input.turretTurn === undefined ? clamp(angleDelta(p.turret, aimAngle), -dt * frame.turretRate, dt * frame.turretRate) : clamp(input.turretTurn, -1, 1) * dt * frame.turretRate;

};

export const weaponsStep = function (state: CombatStateView, input: Controls, dt: number) {
	const p = state.player;
	const wasOverheated = p.overheated;
	state.beam = undefined;
	const firingSlots = new Set<number>();
	state.loadout.forEach(function (mount, index) {
		const slot = mount.slot ?? index;
		if (!canEquipWeapon(state.frame, slot, mount.weapon) || firingSlots.has(slot)) return;
		firingSlots.add(slot);
		const weapon = getWeapon(mount.weapon);
		const volley = mount.rocketVolley;
		if (volley && (weapon.kind === 'rocket' || weapon.stream)) {
			volley.nextIn -= dt;
			while (volley.remaining > 0 && volley.nextIn <= 1e-9) {
				if (!consumeFire(mount, p)) { volley.remaining = 0; break; }
				const target = weapon.kind === 'missile' ? combatTargets(state).filter(function (candidate) { return distance(candidate.body, p) <= weapon.range; }).reduce<CombatTarget | undefined>(function (best, candidate) { return !best || distance(candidate.body, input.aim) < distance(best.body, input.aim) ? candidate : best; }, undefined) : undefined;
				launchWeapon(state, weapon, mount, p.turret, slot, target?.id);
				volley.remaining--; volley.nextIn += 0.1; mount.firing = true;
				state.events.push(weapon.kind === 'missile' ? 'missile' : 'rocket');
				burst(state, { x: p.x + Math.cos(p.turret) * 36, y: p.y + Math.sin(p.turret) * 36 }, 20, weapon.color, 'muzzle', slot);
			}
			if (volley.remaining === 0) delete mount.rocketVolley;
			return;
		}
		if (p.overheated || !usableMount(mount) || !input.fire[slot]) return;
		if (weapon.kind === 'laser') {
			if (!consumeFire(mount, p, dt)) return;
			const hit = combatTargets(state).map(function (target) {
				const dx = target.body.x - p.x; const dy = target.body.y - p.y;
				return { target, along: dx * Math.cos(p.turret) + dy * Math.sin(p.turret), across: Math.abs(dx * Math.sin(p.turret) - dy * Math.cos(p.turret)) };
			}).filter(function (candidate) { return candidate.along > 0 && candidate.along < weapon.range && candidate.across < (candidate.target.kind === 'enemy' ? 24 : candidate.target.radius); }).sort(function (a, b) { return a.along - b.along; })[0];
			const length = hit?.along ?? weapon.range;
			state.beam = { x: p.x + Math.cos(p.turret) * length, y: p.y + Math.sin(p.turret) * length };
			if (hit?.target.kind === 'enemy' && ENEMY_STATS[hit.target.body.kind].elevation > 42) state.beam.elevation = ENEMY_STATS[hit.target.body.kind].elevation;
			if (hit) hurtTarget(state, hit.target, weaponDamage(weapon, mount.level) * dt, p);
			mount.firing = true;
			return;
		}
		if (mount.cooldown > 0) return;
		const target = weapon.kind === 'missile' ? combatTargets(state).filter(function (candidate) { return distance(candidate.body, p) <= weapon.range; }).reduce<CombatTarget | undefined>(function (best, candidate) { return !best || distance(candidate.body, input.aim) < distance(best.body, input.aim) ? candidate : best; }, undefined) : undefined;
		for (let projectile = 0; projectile < (weapon.kind === 'rocket' || weapon.stream ? 1 : weapon.projectiles); projectile++) {
			if (!consumeFire(mount, p)) break;
			const spread = weapon.projectiles === 1 ? Math.sin(state.stats.shotsFired * 2.4) * weapon.spread : (projectile - (weapon.projectiles - 1) / 2) * weapon.spread;
			launchWeapon(state, weapon, mount, p.turret + spread, slot, target?.id);
		}
		if ((weapon.kind === 'rocket' || weapon.stream) && weapon.projectiles > 1 && usableMount(mount) && !p.overheated) mount.rocketVolley = { remaining: Math.min(weapon.projectiles - 1, mount.rounds), nextIn: 0.1 };
		mount.cooldown = weapon.interval; mount.firing = true;
		if (weapon.kind === 'cannon' || weapon.kind === 'ppc') { state.cannonIn = 0.65; state.shake = weapon.kind === 'ppc' ? 4 : 3; }
		state.events.push(weapon.kind === 'bullet' ? 'machine-gun' : weapon.kind);
		burst(state, { x: p.x + Math.cos(p.turret) * 36, y: p.y + Math.sin(p.turret) * 36 }, weapon.kind === 'bullet' ? 9 : 20, weapon.color, 'muzzle', slot);
	});
	if (!wasOverheated && p.overheated) { state.stats.overheats++; state.events.push('overheat'); }

};

export const spawningStep = function (state: CombatStateView, dt: number) {
	const mission = state.mission;
	const wave = getWaveDefinition(state.wave);
	const quota = mission ? missionHostileCount(mission.contract) : wave.enemies.length;
	state.spawnIn -= dt;
	if (state.spawned < quota && state.spawnIn <= 0 && (!mission || mission.contract.kind === 'defend' && mission.stage === 'active')) {
		if (mission) {
			state.warnings.push({ ...missionSpawn(mission.contract, mission.map, state.spawned), life: 3 });
			state.spawned++; state.spawnIn = state.spawned % 3 === 0 ? 14 : 5;
		} else {
			const spawn = wave.enemies[state.spawned];
			if (!spawn) throw new Error('Missing wave spawn');
			const theta = state.spawned * 2.4 + wave.bearing;
			state.warnings.push({ x: 900 + Math.cos(theta) * 840, y: 600 + Math.sin(theta) * 530, ...spawn, life: spawn.commander ? 3 : 2 });
			if (state.spawned === 0 && state.wave === 1) state.events.push('wave');
			state.spawned++; state.spawnIn = state.wave === 1 ? wave.interval : state.spawned % 3 === 0 ? wave.interval * 2.4 : 1.8;
		}
	}
	for (const warning of state.warnings) {
		warning.life -= dt;
		if (warning.life <= 0) state.enemies.push(createEnemy(state, warning));
	}
	state.warnings = state.warnings.filter(function (warning) { return warning.life > 0; });

};

export const enemiesStep = function (state: CombatStateView, dt: number) {
	const p = state.player;
	const mission = state.mission;
	const relay = relayPosition(state);
	const bounds = mission?.map ?? ARENA;
	const difficulty = getDifficultyDefinition(state.difficulty);
	const enemies = state.enemies;
	// Wake units before planning so idle garrisons cannot be recruited remotely.
	if (mission && !relay) for (const enemy of enemies) {
		if (enemy.hp > 0 && (distance(enemy, p) < Math.max(850, ENEMY_STATS[enemy.kind].aggro) || enemy.hp < enemy.maxHp)) enemy.engaged = true;
	}
	const orders = planSquads(enemies.filter(function (enemy) {
		return enemy.hp > 0 && enemyMounts(enemy).some(usableMount) && !enemy.commander && (enemy.kind === 'scout' || enemy.kind === 'striker') && (!mission || relay !== undefined || enemy.engaged);
	}).map(function (enemy) { return { id: enemy.id, x: enemy.x, y: enemy.y, aggro: ENEMY_STATS[enemy.kind].aggro, ...(enemy.squad ? { order: enemy.squad } : {}) }; }), p, relay, dt);
	for (const enemy of enemies) {
		const order = orders.get(enemy.id);
		if (order) enemy.squad = order;
		else {
			if (enemy.squad && (enemy.kind === 'scout' || enemy.kind === 'striker')) delete enemy.hullAngle;
			delete enemy.squad;
		}
		if (enemy.hp <= 0) continue;
		const stats = ENEMY_STATS[enemy.kind];
		const mounts = enemyMounts(enemy);
		const reactor = enemyReactor(enemy);
		coolReactor(reactor, stats.cooling, dt);
		const speed = stats.speed * enemyWeight(enemy).modifier;
		for (const mount of enemy.loadout ?? []) { mount.firing = false; mount.cooldown = Math.max(0, mount.cooldown - dt); }
		if (mission && !relay && !enemy.engaged) continue;
		const individualTarget = !relay || enemy.commander || distance(enemy, p) < stats.aggro ? p : relay;
		const target = order ? order.target === 'relay' && relay ? relay : p : individualTarget;
		for (const mount of mounts) {
			const volley = mount.rocketVolley;
			if (!volley) continue;
			volley.nextIn -= dt;
			while (volley.remaining > 0 && volley.nextIn <= 1e-9) {
				if (!launchEnemy(state, enemy, mount, target, stats.damage * difficulty.enemyDamage)) { volley.remaining = 0; break; }
				volley.remaining--; volley.nextIn += 0.1;
			}
			if (volley.remaining === 0) delete mount.rocketVolley;
		}
		if (enemy.attack) {
			enemy.attack.remaining -= dt;
			if (enemy.attack.remaining <= 0) {
				if (enemy.attack.phase === 'committed') { enemy.attack.phase = 'recovery'; enemy.attack.remaining = enemy.commander ? 4.2 : 3.2; }
				else { delete enemy.attack; enemy.cooldown = enemy.commander ? getEnemyDefense(state, enemy).enraged ? 1.2 : 2.2 : stats.reload; }
			}
			continue;
		}
		if (!mounts.some(usableMount)) {
			// Local disengagement keeps dry units inside the map and targetable.
			const away = Math.atan2(enemy.y - target.y, enemy.x - target.x);
			const heading = enemy.hullAngle ?? enemy.angle;
			const turnRate = enemy.kind === 'tank' ? 0.5 : enemy.kind === 'siege' ? 0.65 : 2;
			enemy.hullAngle = heading + clamp(angleDelta(heading, away), -dt * turnRate, dt * turnRate);
			enemy.x = clamp(enemy.x + Math.cos(enemy.hullAngle) * speed * dt, 35, bounds.width - 35);
			enemy.y = clamp(enemy.y + Math.sin(enemy.hullAngle) * speed * dt, 35, bounds.height - 35);
			continue;
		}
		const targetAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
		const turnRate = enemy.kind === 'tank' ? 0.9 : enemy.kind === 'siege' ? 0.65 : undefined;
		enemy.angle = turnRate === undefined ? targetAngle : enemy.angle + clamp(angleDelta(enemy.angle, targetAngle), -dt * turnRate, dt * turnRate);
		const range = enemy.commander ? 690 : stats.range;
		const separation = distance(enemy, target);
		if (enemy.kind === 'helicopter' || enemy.kind === 'vtol') {
			// Aircraft retain a standoff distance while moving across the firing
			// line. Their gun/pods track independently of the flight heading.
			const radial = clamp((separation - range) / 160, -1, 1);
			const lateral = enemy.kind === 'helicopter' ? (enemy.id % 2 === 0 ? 0.7 : -0.7) : Math.sin(state.time * 0.65 + enemy.id) * 0.85;
			const vx = Math.cos(targetAngle) * radial - Math.sin(targetAngle) * lateral;
			const vy = Math.sin(targetAngle) * radial + Math.cos(targetAngle) * lateral;
			const magnitude = Math.max(1, Math.hypot(vx, vy));
			enemy.x = clamp(enemy.x + vx / magnitude * dt * speed, 35, bounds.width - 35);
			enemy.y = clamp(enemy.y + vy / magnitude * dt * speed, 35, bounds.height - 35);
			if (Math.hypot(vx, vy) > 0.05) {
				const heading = enemy.hullAngle ?? enemy.angle;
				enemy.hullAngle = heading + clamp(angleDelta(heading, Math.atan2(vy, vx)), -dt * 2, dt * 2);
			}
		} else if (enemy.kind === 'tank') {
			enemy.hullAngle ??= enemy.angle;
			if (separation > range) {
				enemy.hullAngle += clamp(angleDelta(enemy.hullAngle, targetAngle), -dt * 0.5, dt * 0.5);
				enemy.x = clamp(enemy.x + Math.cos(enemy.hullAngle) * dt * speed, 35, bounds.width - 35);
				enemy.y = clamp(enemy.y + Math.sin(enemy.hullAngle) * dt * speed, 35, bounds.height - 35);
			}
		} else if (order) {
			const destination = squadApproach(enemy, order, target, range, bounds);
			const travel = distance(enemy, destination);
			if (travel > 12) {
				const amount = Math.min(dt * speed, travel) / travel;
				const heading = enemy.hullAngle ?? enemy.angle;
				enemy.hullAngle = heading + clamp(angleDelta(heading, Math.atan2(destination.y - enemy.y, destination.x - enemy.x)), -dt * 2, dt * 2);
				enemy.x = clamp(enemy.x + (destination.x - enemy.x) * amount, 35, bounds.width - 35);
				enemy.y = clamp(enemy.y + (destination.y - enemy.y) * amount, 35, bounds.height - 35);
			}
		} else if (separation > range) { enemy.x = clamp(enemy.x + Math.cos(enemy.angle) * dt * speed, 35, bounds.width - 35); enemy.y = clamp(enemy.y + Math.sin(enemy.angle) * dt * speed, 35, bounds.height - 35); }
		enemy.cooldown -= dt;
		if (!reactor.overheated && enemy.cooldown <= 0 && distance(enemy, target) < range + 50 && Math.abs(angleDelta(enemy.angle, targetAngle)) < 0.3) {
			const ready = mounts.filter(function (mount) { return usableMount(mount) && mount.cooldown <= 0 && !mount.rocketVolley; });
			const artillery = enemy.kind === 'siege' || enemy.commander ? ready.find(function (mount) { return getEnemyHardpoints(enemy.kind, enemy.commander)[mount.slot ?? 0]?.id === 'dorsal-artillery'; }) : undefined;
			if (artillery) commitBarrage(state, enemy, target, artillery);
			else {
				const next = enemy.attackSlot ?? 0;
				const mount = Array.from({ length: mounts.length }, function (_unused, offset) { return mounts[(next + offset) % mounts.length]; }).find(function (candidate) { return candidate !== undefined && ready.includes(candidate); });
				if (mount) { fireEnemyMount(state, enemy, mount, target, stats.damage * difficulty.enemyDamage); enemy.attackSlot = mounts.indexOf(mount) + 1; }
			}
			enemy.cooldown = stats.reload;
		}
	}

};

export const artilleryStep = function (state: CombatStateView, dt: number) {
	const p = state.player;
	const relay = relayPosition(state);
	for (const strike of state.strikes) {
		strike.life -= dt;
		if (strike.life > 0) continue;
		if (distance(strike, p) < strike.radius + 20) hurtPlayer(state, strike.damage);
		if (relay && distance(strike, relay) < strike.radius + 30) hurtRelay(state, strike.damage * 0.6);
		burst(state, strike, strike.radius * 1.7, '#ff874d'); state.events.push('explosion');
	}
	state.strikes = state.strikes.filter(function (strike) { return strike.life > 0; });

};

export const projectilesStep = function (state: CombatStateView, dt: number) {
	const p = state.player;
	const relay = relayPosition(state);
	for (const shot of state.shots) {
		const travel = Math.min(dt, Math.max(0, shot.life));
		shot.life -= dt;
		if (shot.kind === 'enemy' && shot.enemyTarget) {
			const target = shot.enemyTarget === 'player' ? p : relay;
			if (target) {
				const heading = Math.atan2(shot.vy, shot.vx);
				const angle = heading + clamp(angleDelta(heading, Math.atan2(target.y - shot.y, target.x - shot.x)), -travel * 3, travel * 3);
				const speed = Math.hypot(shot.vx, shot.vy);
				shot.vx = Math.cos(angle) * speed; shot.vy = Math.sin(angle) * speed;
			}
		}
		if (shot.kind === 'missile') {
			const target = combatTargets(state).find(function (candidate) { return candidate.id === shot.target; })?.body;
			if (target) {
				const heading = Math.atan2(shot.vy, shot.vx);
				const angle = heading + clamp(angleDelta(heading, Math.atan2(target.y - shot.y, target.x - shot.x)), -travel * 3, travel * 3);
				const speed = Math.hypot(shot.vx, shot.vy);
				shot.vx = Math.cos(angle) * speed; shot.vy = Math.sin(angle) * speed;
			}
		}
		const origin = { x: shot.x, y: shot.y };
		shot.x += shot.vx * travel; shot.y += shot.vy * travel;
		if (shot.kind === 'enemy') {
			const playerHit = hitFraction(origin, shot, p, 27); const relayHit = relay ? hitFraction(origin, shot, relay, 42) : undefined;
			if (playerHit !== undefined && (relayHit === undefined || playerHit <= relayHit)) {
				hurtPlayer(state, shot.damage); shot.life = 0; state.shake = 4; burst(state, p, 30, '#ff985d'); state.events.push('impact');
			} else if (relay && relayHit !== undefined) {
				hurtRelay(state, shot.damage * 0.65); shot.life = 0; burst(state, relay, 30, '#ff985d'); state.events.push('impact');
			}
		} else {
			const hits = combatTargets(state).filter(function (target) { return !shot.hitIds?.includes(target.id); }).map(function (target) { return { target, entry: hitFraction(origin, shot, target.body, target.radius) }; }).filter(function (candidate): candidate is { target: CombatTarget; entry: number } { return candidate.entry !== undefined; }).sort(function (a, b) { return a.entry - b.entry || a.target.id - b.target.id; });
			for (const hit of hits) {
				hurtTarget(state, hit.target, shot.damage, origin);
				// Hit rate counts projectiles, not each victim of a penetrating bolt.
				if (!shot.hitIds || shot.hitIds.length === 0) state.stats.shotsHit++;
				if (shot.hitIds) shot.hitIds.push(hit.target.id); else shot.life = 0;
				const impact = { x: origin.x + (shot.x - origin.x) * hit.entry, y: origin.y + (shot.y - origin.y) * hit.entry };
				if (shot.splash) {
					for (const nearby of combatTargets(state)) {
						if (nearby.id !== hit.target.id && distance(nearby.body, impact) < shot.splash + (nearby.kind === 'structure' ? nearby.radius : 0)) hurtTarget(state, nearby, shot.damage * 0.6, impact);
					}
				}
				const effect = burst(state, impact, shot.splash ?? (shot.kind === 'ppc' ? 55 : shot.kind === 'cannon' ? 45 : 20), shot.kind === 'ppc' ? '#b1a0ff' : '#ffd28b');
				if (hit.target.kind === 'enemy' && ENEMY_STATS[hit.target.body.kind].elevation !== 42) effect.elevation = ENEMY_STATS[hit.target.body.kind].elevation;
				if (shot.kind !== 'bullet') state.shake = Math.max(state.shake, 2);
				state.events.push('impact');
				if (!shot.hitIds) break;
			}
		}
	}
	state.shots = state.shots.filter(function (shot) { return shot.life > 0; });

};

export const deathsStep = function (state: CombatStateView) {
	for (const enemy of state.enemies) if (enemy.hp <= 0) {
		state.kills++; state.stats.killScore += enemy.commander ? 1800 : ENEMY_STATS[enemy.kind].score;
		if (enemy.commander) state.stats.commanderDestroyed = true;
		const effect = burst(state, enemy, 65, '#ffab62');
		if (ENEMY_STATS[enemy.kind].elevation !== 42) effect.elevation = ENEMY_STATS[enemy.kind].elevation;
		state.events.push('explosion');
		state.wrecks.push({ x: enemy.x, y: enemy.y, angle: enemy.angle, kind: enemy.kind });
	}
	state.enemies = state.enemies.filter(function (enemy) { return enemy.hp > 0; });

};

export const effectsStep = function (state: CombatStateView, dt: number) {
	state.effects = state.effects.filter(function (effect) { effect.life -= dt; return effect.life > 0; });

};

export const outcomeStep = function (state: CombatStateView, dt: number) {
	const p = state.player;
	const relay = relayPosition(state);
	const mission = state.mission;
	const quota = mission ? missionHostileCount(mission.contract) : getWaveDefinition(state.wave).enemies.length;
	if (p.hp <= 0 || relay && state.relay <= 0) { state.outcome = 'lost'; state.events.push('defeat'); }
	else if (mission) {
		mission.progress = mission.contract.kind === 'demolition' ? Number(mission.structure?.hp === 0)
			: mission.contract.kind === 'assassination' ? Number(mission.targetId !== undefined && !state.enemies.some(function (enemy) { return enemy.id === mission.targetId; })) : state.kills;
		if (mission.stage === 'active' && mission.progress >= mission.required && (mission.contract.kind !== 'defend' || state.spawned === quota && state.warnings.length === 0)) {
			mission.stage = 'extract'; mission.extractTime = 0;
			burst(state, mission.map.extraction, 180, '#93e9e1'); state.events.push('objective-complete');
		}
		if (mission.stage === 'extract') {
			mission.extractTime = distance(p, mission.map.extraction) <= EXTRACTION_RADIUS ? mission.extractTime + dt : 0;
			if (mission.extractTime >= EXTRACTION_SECONDS) { state.outcome = 'won'; state.events.push('victory'); }
		}
	}
	else if (state.spawned === quota && state.enemies.length === 0 && state.warnings.length === 0 && state.strikes.length === 0 && !state.shots.some(function (shot) { return shot.kind === 'enemy'; })) {
		state.intermission += dt;
		if (state.intermission >= 4) {
			if (state.wave === WAVES.length) { state.outcome = 'won'; state.events.push('victory'); }
			else {
				state.wave++; state.spawned = 0; state.spawnIn = 4; state.intermission = 0;
				state.events.push('wave');
			}
		}
	}
};

// Compatibility entry point for deterministic domain callers. The browser runtime
// registers these same responsibilities as separately ordered ECS systems.
export const step = function (state: CombatStateView, input: Controls, dt: number) {
	state.events = [];
	if (state.outcome !== 'playing' || state.phase !== 'combat' || dt <= 0) return;
	dt = Math.min(dt, 0.04);
	coolingStep(state, input, dt);
	movementStep(state, input, dt);
	weaponsStep(state, input, dt);
	spawningStep(state, dt);
	enemiesStep(state, dt);
	artilleryStep(state, dt);
	projectilesStep(state, dt);
	deathsStep(state);
	effectsStep(state, dt);
	outcomeStep(state, dt);
};
