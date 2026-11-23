import { getMissionTier } from './reputation';
import type { AuthoredPoseContext } from './authored-pose';
import { getMechAssetBinding } from './mech-asset-registry';
import { consumeFire, coolReactor, frameWeight, loadedMounts, usableMount, weightMetrics, type ReactorState } from './combat-resources';
import { createMount, getWeapon, getWeaponTier, weaponIdForTier, type WeaponTier, type FireInputs, type WeaponDefinition, type WeaponId, type WeaponMount } from './arsenal';
import { FRAMES, getFrame, type FrameId } from './frames';
import { canEquipWeapon, createStarterLoadout, getEnemyHardpoints, getHardpoints, isFrameLoadout } from './hardpoints';
import { getDifficultyDefinition, getWaveDefinition, WAVES, type Difficulty } from './operation';
import type { Contract, MissionMap, MissionRuntime } from './campaign-types';
import { EXTRACTION_RADIUS, EXTRACTION_SECONDS, FACILITY_RADIUS, missionStructures, CAPTURE_RADIUS, RECOVERY_SECONDS, BEACON_SECONDS, ACQUISITION_SECONDS, generateMissionMap, missionHostileCount, missionSpawn, missionDeploymentSlot, squadDestination } from './missions';
import { getPlayerMuzzle, getPlayerFiringDirection, getEnemyMuzzle, getFiringDirection, getPlayerWeaponRig, getEnemyWeaponRig, weaponDirection, type SpatialPoint } from './weapon-rig';
import { ENEMY_RADIUS, RIG_RADIUS, enemyVolume, playerVolume, facilityVolume, spatialDistance, hitVolumeFraction, pointAlong, projectAim, type HitVolume } from './combat-spatial';
import { moveOnTerrain, terrainPointClear, terrainShotFraction, terrainWaypoint, type FieldTerrain } from './field-terrain';
import { inFiringArc, turnTorso } from './torso-arc';
import { planSquads, type SquadOrder as EnemySquadOrder } from './enemy-squads';
import { ENEMY_FIRING_MARGIN, planGroundTactics, type EnemyTactics } from './enemy-tactics';
import { SQUAD_SIZE, type Pilot } from './pilots';

export interface Point { x: number; y: number }
export interface Beam extends Point { slot: number; elevation?: number; origin?: SpatialPoint; squadmateId?: string }
export type MechEnemyKind = 'scout' | 'striker' | 'siege';
export type EnemyKind = MechEnemyKind | 'helicopter' | 'vtol' | 'tank';
export type CombatEvent = 'artillery' | 'machine-gun' | 'ppc' | 'rocket' | 'cannon' | 'missile' | 'impact' | 'player-hit' | 'relay-hit' | 'explosion' | 'wave' | 'objective-complete' | 'coolant' | 'overheat' | 'defeat' | 'victory';
export interface AttackCycle { phase: 'committed' | 'recovery'; remaining: number; cycle: number }
export interface Unit extends Point { reactor?: ReactorState; id: number; hp: number; maxHp: number; angle: number; hullAngle?: number; cooldown: number; heavy: boolean; kind: EnemyKind; commander?: boolean; attack?: AttackCycle; engaged?: boolean; loadout?: WeaponMount[]; attackSlot?: number; squad?: EnemySquadOrder; tactics?: EnemyTactics; stationary?: true }
type EnemyTarget = 'player' | 'relay' | { squadmateId: string };
export interface Shot extends Point { elevation?: number; vElevation?: number; origin?: SpatialPoint; age?: number; vx: number; vy: number; life: number; kind: 'cannon' | 'missile' | 'enemy' | 'bullet' | 'ppc' | 'rocket'; target: number | undefined; damage: number; splash?: number; hitIds?: number[]; weapon?: WeaponId; slot?: number; owner?: number; enemyTarget?: EnemyTarget; squadmateId?: string }
export interface Effect extends Point { life: number; size: number; color: string; elevation?: number; source?: 'muzzle'; slot?: number; squadmateId?: string }
export interface Warning extends Point { kind: EnemyKind; life: number; commander?: boolean }
export interface ArtilleryStrike extends Point { id: number; life: number; duration: number; radius: number; damage: number; weapon?: WeaponId; slot?: number; owner?: number }
export interface CombatStats { damageDealt: number; damageTaken: number; relayDamage: number; shotsFired: number; shotsHit: number; overheats: number; killScore: number; commanderDestroyed: boolean }
export interface Wreck extends Point { kind: EnemyKind; angle: number }
export interface Controls { heading?: number; throttleTarget?: number; turretTurn?: number; drive: number; stop: boolean; turn: number; aim: Point; targetId?: number; fire: FireInputs; coolant: boolean }
export interface CombatCollection<T> extends ReadonlyArray<T> {
	push(...items: T[]): number;
}
export const MISSILE_LOCK_SECONDS = 1.5;
export const MISSILE_LOCK_GRACE = 0.3;
export interface MissileLock { targetId: number; progress: number; interrupted: number }
export type FireDiscipline = 'free' | 'hold';
export type SquadOrder = { kind: 'form' } | { kind: 'hold' | 'move'; point: Point } | { kind: 'attack'; targetId: number };
interface RigBody extends Point, ReactorState {
	angle: number;
	turret: number;
	missileLock?: MissileLock | undefined;
	targetId?: number | undefined;
	throttle: number;
	speed: number;
	motorSpeed?: number | undefined;
	hp: number;
}
export interface SquadmateOptions {
	pilotId: string;
	callsign: string;
	specialty: Exclude<Pilot['specialty'], 'commander'>;
	frameId: FrameId;
	loadout: readonly (WeaponId | null)[];
	reserves: readonly number[];
	integrity: number;
}
export interface Squadmate extends RigBody, Pick<SquadmateOptions, 'pilotId' | 'callsign' | 'specialty' | 'frameId'> {
	loadout: WeaponMount[];
	shotsFired: number;
	coolantCharges: number;
	order?: SquadOrder | undefined;
	fireDiscipline?: FireDiscipline | undefined;
	authoredPose?: AuthoredPoseContext | undefined;
}
export interface CombatStateView {
	authoredPose?: AuthoredPoseContext | undefined;
	mission?: MissionRuntime;
	frame: FrameId; difficulty: Difficulty; phase: 'combat'; loadout: WeaponMount[]; seed: number; stats: CombatStats; strikes: CombatCollection<ArtilleryStrike>;
	player: RigBody;
	squadmates: readonly Squadmate[];
	relay: number; enemies: CombatCollection<Unit>; shots: CombatCollection<Shot>; effects: CombatCollection<Effect>; wave: number; spawned: number; spawnIn: number;
	intermission: number; cannonIn: number; time: number; kills: number; shake: number;
	beams: Beam[]; beam: (Point & { slot?: number; elevation?: number }) | undefined; outcome: 'playing' | 'won' | 'lost'; nextId: number;
	coolantCharges: number; coolantHeld: boolean; warnings: CombatCollection<Warning>; wrecks: CombatCollection<Wreck>; events: CombatEvent[];
}
// Plain domain callers retain ordinary mutable arrays. The live runtime exposes
// ordered query views with explicit append and whole-collection replacement.
export interface State extends CombatStateView {
	strikes: ArtilleryStrike[]; enemies: Unit[]; shots: Shot[];
	effects: Effect[]; warnings: Warning[]; wrecks: Wreck[];
}

export const ARENA = { width: 1800, height: 1200, relayX: 900, relayY: 600 };
const EDGE_CLEARANCE = 35;
const SQUAD_ARRIVAL_RADIUS = 16;
interface EnemyStats { mass: number; recommendedMass: number; cooling: number; hp: number; speed: number; range: number; reload: number; damage: number; aggro: number; elevation: number; score: number }
export const ENEMY_STATS: Readonly<Record<EnemyKind, EnemyStats>> = {
	scout: { mass: 35, recommendedMass: 42, cooling: 10, hp: 600, speed: 66, range: 310, reload: 2, damage: 3.5, aggro: 650, elevation: 42, score: 200 },
	striker: { mass: 70, recommendedMass: 112, cooling: 12, hp: 1600, speed: 44, range: 420, reload: 2.5, damage: 4, aggro: 440, elevation: 42, score: 300 },
	siege: { mass: 105, recommendedMass: 158, cooling: 11, hp: 2600, speed: 28, range: 550, reload: 1.8, damage: 5, aggro: 650, elevation: 42, score: 500 },
	helicopter: { mass: 18, recommendedMass: 22, cooling: 9, hp: 140, speed: 105, range: 310, reload: 0.75, damage: 2, aggro: 800, elevation: 112, score: 250 },
	vtol: { mass: 30, recommendedMass: 62, cooling: 10, hp: 260, speed: 82, range: 440, reload: 2.8, damage: 4, aggro: 850, elevation: 147, score: 400 },
	tank: { mass: 60, recommendedMass: 72, cooling: 11, hp: 480, speed: 32, range: 390, reload: 3.4, damage: 9, aggro: 600, elevation: 30, score: 450 },
};
export interface MissionDeployment {
	map?: MissionMap;
	difficulty?: Difficulty;
	frame?: FrameId;
	loadout?: readonly (WeaponId | null)[];
	reserves?: readonly number[];
	integrity?: number;
	coolantCharges?: number;
	squadmates?: readonly SquadmateOptions[];
}
export const createMissionState = function (contract: Contract, options: MissionDeployment = {}): State {
	const squadmates = options.squadmates ?? [];
	if (squadmates.length >= SQUAD_SIZE || new Set(squadmates.map(function (mate) { return mate.pilotId; })).size !== squadmates.length) throw new RangeError('Invalid squad deployment');
	const state = createState({ ...options, frame: options.frame ?? 'kestrel', seed: contract.seed });
	if (options.loadout === undefined) state.loadout = loadedMounts(createStarterLoadout(state.frame), options.reserves);
	if (options.loadout !== undefined) {
		if (!isFrameLoadout(state.frame, options.loadout)) throw new RangeError(`Invalid loadout for ${state.frame}`);
		state.loadout = loadedMounts(options.loadout, options.reserves);
	}
	state.player.hp = options.integrity === undefined ? 100 : Number.isFinite(options.integrity) ? Math.max(0, Math.min(100, options.integrity)) : 0;
	if (state.player.hp === 0) state.outcome = 'lost';
	state.coolantCharges = options.coolantCharges === undefined ? 2 : Number.isFinite(options.coolantCharges) ? Math.max(0, Math.min(3, Math.floor(options.coolantCharges))) : 0;
	const map = options.map ?? generateMissionMap(contract);
	const hostileCount = missionHostileCount(contract);
	const structureHp = getMissionTier(contract.tier).objectiveHp * getDifficultyDefinition(state.difficulty).enemyArmor;
	state.mission = {
		contract, map, stage: 'active',
		structure: contract.kind === 'demolition' ? { ...map.objective, hp: structureHp, maxHp: structureHp } : undefined,
		...(contract.kind === 'raid' ? { raidTargets: map.sites.map(function (site) { return { ...site, hp: structureHp * .6, maxHp: structureHp * .6 }; }) } : {}),
		...(contract.kind === 'recovery' || contract.kind === 'acquisition' ? { captureSites: (contract.kind === 'recovery' ? [map.objective] : map.sites).map(function (site) { return { ...site, holdTime: 0, complete: false }; }) } : {}),
		...(contract.kind === 'acquisition' ? { acquisitionTime: ACQUISITION_SECONDS } : {}),
		targetId: undefined, progress: 0, required: contract.kind === 'defend' || contract.kind === 'clearance' ? hostileCount : contract.kind === 'raid' || contract.kind === 'acquisition' ? 3 : 1, extractTime: 0,
	};
	const heading = Math.atan2(map.objective.y - map.drop.y, map.objective.x - map.drop.x);
	state.player.x = map.drop.x; state.player.y = map.drop.y; state.player.angle = heading; state.player.turret = heading;
	state.squadmates = squadmates.map(function ({ pilotId, callsign, specialty, frameId, loadout, reserves, integrity }, index) {
		if (!isFrameLoadout(frameId, loadout)) throw new RangeError(`Invalid loadout for ${frameId}`);
		const at = missionDeploymentSlot(map, index);
		return {
			pilotId, callsign, specialty, frameId, loadout: loadedMounts(loadout, reserves),
			x: clamp(at.x, EDGE_CLEARANCE, map.width - EDGE_CLEARANCE), y: clamp(at.y, EDGE_CLEARANCE, map.height - EDGE_CLEARANCE), angle: heading, turret: heading,
			hp: Number.isFinite(integrity) ? clamp(integrity, 0, 100) : 0, heat: 0, overheated: false, throttle: 0, speed: 0, shotsFired: 0, coolantCharges: 2,
		};
	});
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
	const level = state.mission ? getMissionTier(state.mission.contract.tier) : undefined;
	const commander = Boolean(spawn.commander && (!level || level.tier >= 4));
	const hp = Math.round((spawn.commander ? level?.commanderHp ?? 4200 : ENEMY_STATS[spawn.kind].hp * (level?.armor ?? 1)) * getDifficultyDefinition(state.difficulty).enemyArmor);
	const target = relayPosition(state) ?? state.player;
	return { id: state.nextId++, x: spawn.x, y: spawn.y, hp, maxHp: hp, angle: Math.atan2(target.y - spawn.y, target.x - spawn.x), cooldown: 1.2, heavy: spawn.kind === 'siege' || spawn.kind === 'tank', kind: spawn.kind, reactor: { heat: 0, overheated: false }, loadout: createEnemyLoadout(spawn.kind, commander, level?.weaponTier ?? 0), ...(commander ? { commander: true } : {}) };
};
export type CombatTarget = { id: number; kind: 'enemy'; body: Unit; radius: number } | { id: number; kind: 'structure'; body: NonNullable<MissionRuntime['structure']>; radius: number };
export const combatTargets = function (state: CombatStateView): CombatTarget[] {
	const enemies: CombatTarget[] = state.enemies.filter(function (enemy) { return enemy.hp > 0; }).map(function (enemy) { return { id: enemy.id, kind: 'enemy', body: enemy, radius: ENEMY_RADIUS }; });
	return [...enemies, ...missionStructures(state.mission).filter(function (target) { return target.body.hp > 0; }).map(function ({ id, body }): CombatTarget { return { id, kind: 'structure', body, radius: FACILITY_RADIUS }; })];
};
export const distance = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
export const angleDelta = function (from: number, to: number) { return Math.atan2(Math.sin(to - from), Math.cos(to - from)); };
const clamp = function (value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); };
export const squadOrderDestinationClear = function (state: CombatStateView, point: Point): boolean {
	const bounds = state.mission?.map ?? ARENA;
	const terrain = state.mission?.map.terrain;
	return point.x >= EDGE_CLEARANCE && point.x <= bounds.width - EDGE_CLEARANCE
		&& point.y >= EDGE_CLEARANCE && point.y <= bounds.height - EDGE_CLEARANCE
		&& (!terrain || terrainPointClear(terrain, point, RIG_RADIUS));
};

export const squadMoveDestinations = function (state: CombatStateView, pilotIds: readonly string[], point: Point): ReadonlyMap<string, Point> | undefined {
	const pilots = new Set(pilotIds);
	const squad = state.squadmates.filter(function (mate) { return mate.hp > 0 && pilots.has(mate.pilotId); });
	if (squad.length === 0 || squad.length !== pilots.size || !squadOrderDestinationClear(state, point)) return undefined;
	const separation = 2 * (RIG_RADIUS + SQUAD_ARRIVAL_RADIUS) + 4;
	const candidates = [{ ...point }, ...[separation, separation * 2].flatMap(function (radius) {
		return Array.from({ length: 8 }, function (_, index) {
			const angle = Math.PI / 4 * index;
			return { x: point.x + radius * Math.cos(angle), y: point.y + radius * Math.sin(angle) };
		});
	})];
	const destinations = new Map<string, Point>();
	for (const mate of squad) {
		const at = candidates.find(function (candidate) {
			return squadOrderDestinationClear(state, candidate)
				&& [...destinations.values()].every(function (used) { return distance(candidate, used) >= separation - .001; });
		});
		if (!at) return undefined;
		destinations.set(mate.pilotId, at);
	}
	return destinations;
};

const moveBody = function (body: Point, dx: number, dy: number, bounds: { width: number; height: number }, terrain: FieldTerrain | undefined, radius: number) {
	const x = clamp(body.x + dx, EDGE_CLEARANCE, bounds.width - EDGE_CLEARANCE);
	const y = clamp(body.y + dy, EDGE_CLEARANCE, bounds.height - EDGE_CLEARANCE);
	if (terrain) {
		const at = moveOnTerrain(terrain, body, { x, y }, radius);
		body.x = at.x; body.y = at.y;
	} else {
		body.x = x; body.y = y;
	}
};
const advanceDrive = function (body: RigBody, targetSpeed: number, acceleration: number, dt: number, bounds: { width: number; height: number }, terrain: FieldTerrain | undefined) {
	const previous = terrain ? body.motorSpeed ?? body.speed : body.speed;
	const motorSpeed = previous + (targetSpeed - previous) * Math.min(1, dt * acceleration);
	const x = body.x; const y = body.y;
	moveBody(body, Math.cos(body.angle) * motorSpeed * dt, Math.sin(body.angle) * motorSpeed * dt, bounds, terrain, RIG_RADIUS);
	if (!terrain) {
		body.speed = motorSpeed;
		return;
	}
	// Keep the engine running at its latched setting while a wall absorbs the
	// normal component of motion. Instruments and footsteps use ground speed.
	body.motorSpeed = motorSpeed;
	if (dt > 0) body.speed = Math.sign(motorSpeed) * Math.hypot(body.x - x, body.y - y) / dt;
};
const travelHeading = function (terrain: FieldTerrain | undefined, from: Point, to: Point, radius: number) {
	const next = terrain ? terrainWaypoint(terrain, from, to, radius) : to;
	return Math.atan2(next.y - from.y, next.x - from.x);
};
const flightTerrainCache = new WeakMap<FieldTerrain, Map<number, FieldTerrain>>();
const travelTerrain = function (terrain: FieldTerrain | undefined, enemy: Unit): FieldTerrain | undefined {
	if (!terrain || (enemy.kind !== 'helicopter' && enemy.kind !== 'vtol')) return terrain;
	const body = enemyVolume(enemy);
	const clearance = body.elevation - body.halfHeight;
	const levels = flightTerrainCache.get(terrain) ?? new Map<number, FieldTerrain>();
	let level = levels.get(clearance);
	if (!level) {
		level = { ...terrain, obstacles: terrain.obstacles.filter(function (obstacle) { return obstacle.height >= clearance; }) };
		levels.set(clearance, level); flightTerrainCache.set(terrain, levels);
	}
	return level.obstacles.length ? level : undefined;
};
export const createState = function (options: { difficulty?: Difficulty; frame?: FrameId; starter?: WeaponId; seed?: number } = {}): State {
	const inferred = options.starter ? FRAMES.find(function (candidate) { return canEquipWeapon(candidate.id, 0, options.starter ?? candidate.starter); })?.id : undefined;
	const frame = getFrame(options.frame ?? inferred ?? 'warden');
	const starter = options.starter ?? frame.starter;
	const slot = getHardpoints(frame.id).findIndex(function (_hardpoint, index) { return canEquipWeapon(frame.id, index, starter); });
	if (slot < 0) throw new RangeError(`${starter} cannot equip to ${frame.id}`);
	return {
		frame: frame.id, difficulty: options.difficulty ?? 'standard', phase: 'combat', loadout: [{ ...createMount(starter), slot }], seed: options.seed ?? 1, strikes: [],
		stats: { damageDealt: 0, damageTaken: 0, relayDamage: 0, shotsFired: 0, shotsHit: 0, overheats: 0, killScore: 0, commanderDestroyed: false },
		player: { x: 900, y: 780, angle: -Math.PI / 2, turret: -Math.PI / 2, throttle: 0, speed: 0, hp: 100, heat: 0, overheated: false }, squadmates: [],
		relay: 100, enemies: [], shots: [], effects: [], wave: 1, spawned: 0, spawnIn: 4, intermission: 0,
		cannonIn: 0, time: 0, kills: 0, shake: 0, beams: [],
		// The legacy single-beam view is derived from the authoritative slot list.
		get beam() { return this.beams.find(function (beam) { return beam.squadmateId === undefined; }); },
		set beam(value) { this.beams = value ? [{ ...value, slot: value.slot ?? 0 }] : []; },
		outcome: 'playing', nextId: 1,
		coolantCharges: 2, coolantHeld: false, warnings: [], wrecks: [], events: [],
	};
};
const burst = function (state: CombatStateView, at: Point & { elevation?: number }, size: number, color: string, source?: 'muzzle', slot?: number, squadmateId?: string): Effect {
	const effect: Effect = { x: at.x, y: at.y, ...(at.elevation === undefined ? {} : { elevation: at.elevation }), size, color, life: 0.5, ...(source ? { source } : {}), ...(slot !== undefined ? { slot } : {}), ...(squadmateId === undefined ? {} : { squadmateId }) };
	state.effects.push(effect); return effect;
};
export const createEnemyLoadout = function (kind: EnemyKind, commander = false, tier: WeaponTier = 0): WeaponMount[] {
	return getEnemyHardpoints(kind, commander).flatMap(function (hardpoint, slot) {
		const weapon = hardpoint.family === 'launcher' ? 'stream-missiles' : hardpoint.weapons.includes('autocannon') ? 'autocannon' : 'machine-gun';
		return hardpoint.weapons.includes(weapon) ? [{ ...createMount(weaponIdForTier(weapon, tier)), slot }] : [];
	});
};
const enemyMounts = function (enemy: Unit): WeaponMount[] {
	const hardpoints = getEnemyHardpoints(enemy.kind, enemy.commander);
	const seen = new Set<number>();
	return (enemy.loadout ??= createEnemyLoadout(enemy.kind, enemy.commander)).filter(function (mount, index) {
		const slot = mount.slot ?? index; const hardpoint = hardpoints[slot];
		if (seen.has(slot) || hardpoint?.family !== getWeapon(mount.weapon).family || !hardpoint.weapons.includes(getWeapon(mount.weapon).modelId)) return false;
		seen.add(slot); mount.slot = slot; return true;
	});
};
export const enemyReactor = function (enemy: Unit): ReactorState { return enemy.reactor ??= { heat: 0, overheated: false }; };
export const enemyWeight = function (enemy: Unit) {
	const stats = ENEMY_STATS[enemy.kind];
	return weightMetrics(stats.mass, stats.recommendedMass, enemyMounts(enemy));
};
const targetVolume = function (target: CombatTarget): HitVolume { return target.kind === 'enemy' ? enemyVolume(target.body) : facilityVolume(target.body, target.radius); };
const contactObstructs = function (origin: SpatialPoint, at: SpatialPoint, id: number, contacts: readonly CombatTarget[]) {
	return contacts.some(function (other) {
		return other.id !== id && other.body.hp > 0 && hitVolumeFraction(origin, at, targetVolume(other)) !== undefined;
	});
};
const rigMissileTracking = function (rig: RigBody, frame: FrameId, loadout: readonly WeaponMount[], targets: readonly CombatTarget[], id: number, terrain: FieldTerrain | undefined): 'NO GUIDANCE' | 'OUT OF RANGE' | 'OUT OF ARC' | 'BLOCKED' | 'TRACKING' {
	const target = targets.find(function (candidate) { return candidate.id === id; });
	const weapons = loadout.filter(function (mount, index) { return canEquipWeapon(frame, mount.slot ?? index, mount.weapon); }).map(function (mount) { return getWeapon(mount.weapon); }).filter(function (weapon) { return weapon.kind === 'missile'; });
	if (!target || weapons.length === 0) return 'NO GUIDANCE';
	if (!weapons.some(function (weapon) { return distance(rig, target.body) <= weapon.range; })) return 'OUT OF RANGE';
	if (!inFiringArc(rig, rig.angle, target.body)) return 'OUT OF ARC';
	const origin = playerVolume(rig, frame);
	const at = targetVolume(target);
	if (terrain && terrainShotFraction(terrain, origin, at) !== undefined) return 'BLOCKED';
	if (contactObstructs(origin, at, id, targets)) return 'BLOCKED';
	return 'TRACKING';
};
export const missileTracking = function (state: CombatStateView, id: number) { return rigMissileTracking(state.player, state.frame, state.loadout, combatTargets(state), id, state.mission?.map.terrain); };
export const missileLockLabel = function (state: CombatStateView, id: number): string {
	const status = missileTracking(state, id);
	const value = state.player.missileLock?.targetId === id ? state.player.missileLock.progress : 0;
	const progress = value >= 1 - 1e-9 ? 1 : value;
	return `${status === 'TRACKING' ? progress >= 1 ? 'LOCKED' : 'ACQUIRING' : status} ${Math.floor(progress * 100)}%`;
};
const rigAimPoint = function (rig: RigBody, target: CombatTarget | undefined): SpatialPoint | undefined {
	return target && target.body.hp > 0 ? projectAim(rig, rig.turret, targetVolume(target)) : undefined;
};
export const playerAimPoint = function (state: CombatStateView): SpatialPoint | undefined {
	return rigAimPoint(state.player, combatTargets(state).find(function (candidate) { return candidate.id === state.player.targetId; }));
};
export const squadmateAimPoint = function (state: CombatStateView, mate: Squadmate): SpatialPoint | undefined {
	return rigAimPoint(mate, combatTargets(state).find(function (candidate) { return candidate.id === mate.targetId; }));
};
const closestRig = function (player: RigBody, squadmates: readonly Squadmate[], point: Point): RigBody | Squadmate {
	return squadmates.reduce<RigBody | Squadmate>(function (closest, mate) { return mate.hp > 0 && distance(point, mate) < distance(point, closest) ? mate : closest; }, player);
};
const enemyTargetVolume = function (state: CombatStateView, target: Point): HitVolume {
	if (target === state.player) return playerVolume(target, state.frame);
	const mate = state.squadmates.find(function (candidate) { return candidate === target; });
	return mate ? playerVolume(mate, mate.frameId) : facilityVolume(target, 42);
};
export const enemyAimPoint = function (state: CombatStateView, enemy: Unit): SpatialPoint {
	const relay = relayPosition(state);
	const rig = closestRig(state.player, state.squadmates, enemy);
	const target = enemy.squad ? enemy.squad.target === 'relay' && relay ? relay : rig : !relay || enemy.commander || distance(enemy, rig) < ENEMY_STATS[enemy.kind].aggro ? rig : relay;
	return projectAim(enemy, enemy.angle, enemyTargetVolume(state, target));
};
const isEnemyMech = function (enemy: Unit): boolean { return enemy.kind === 'scout' || enemy.kind === 'striker' || enemy.kind === 'siege'; };
const enemyCanFire = function (enemy: Unit, target: Point): boolean { return !isEnemyMech(enemy) || inFiringArc(enemy, enemy.hullAngle ?? enemy.angle, target); };
const volleySpacing = function (weapon: WeaponDefinition): number { return 0.1 * getWeaponTier(weapon.tier).interval; };
const tubeIndex = function (count: number, sequence: number): number { return count > 0 ? sequence % count : 0; };
// Long barrels can extend through a thin wall while the hull is still outside.
const exposedMuzzle = function (terrain: FieldTerrain | undefined, body: Point, muzzle: SpatialPoint): SpatialPoint {
	if (!terrain) return muzzle;
	const base = { x: body.x, y: body.y, elevation: muzzle.elevation };
	const entry = terrainShotFraction(terrain, base, muzzle);
	return entry === undefined ? muzzle : pointAlong(base, muzzle, entry);
};
const muzzleBlocked = function (terrain: FieldTerrain, body: Point, muzzle: SpatialPoint, target: SpatialPoint) {
	return exposedMuzzle(terrain, body, muzzle) !== muzzle || terrainShotFraction(terrain, muzzle, target) !== undefined;
};
const launchEnemy = function (state: CombatStateView, enemy: Unit, mount: WeaponMount, target: Point, damage: number): boolean {
	if (!enemyCanFire(enemy, target)) return false;
	const angle = enemy.angle;
	const slot = mount.slot ?? 0; const weapon = getWeapon(mount.weapon);
	const quality = getWeaponTier(weapon.tier);
	const speed = (enemy.kind === 'tank' ? 330 : 230) * quality.speed;
	const at = enemyTargetVolume(state, target);
	const aim = projectAim(enemy, angle, at);
	const rig = getEnemyWeaponRig(enemy.kind, Boolean(enemy.commander))[slot];
	if (!rig) throw new RangeError(`Missing weapon rig ${enemy.kind}/${slot}`);
	const remaining = weapon.ammunition ? Math.max(0, mount.rounds - 1) : mount.rounds;
	const origin = getEnemyMuzzle(enemy.kind, Boolean(enemy.commander), slot, enemy, angle, tubeIndex(rig.tubes.length, remaining), aim);
	const terrain = state.mission?.map.terrain;
	if (terrain && muzzleBlocked(terrain, enemy, origin, at)) return false;
	if (!consumeFire(mount, enemyReactor(enemy))) return false;
	const direction = weaponDirection(rig, enemy, angle, aim);
	const mate = state.squadmates.find(function (candidate) { return candidate === target; });
	const enemyTarget: EnemyTarget = mate ? { squadmateId: mate.pilotId } : target === state.player ? 'player' : 'relay';
	state.shots.push({ ...origin, origin, age: 0, vx: direction.x * speed, vy: direction.y * speed, vElevation: direction.elevation * speed, life: 2.5, kind: 'enemy', target: undefined, damage: damage * quality.damage / weapon.projectiles,
		weapon: mount.weapon, slot, owner: enemy.id, ...(weapon.kind === 'missile' ? { enemyTarget } : {}) });
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
	if (delayed && weapon.projectiles > 1 && usableMount(mount) && !enemyReactor(enemy).overheated) mount.rocketVolley = { remaining: Math.min(weapon.projectiles - 1, mount.rounds), nextIn: volleySpacing(weapon) };
};
const launchWeapon = function (state: CombatStateView, weapon: WeaponDefinition, angle: number, slot: number, selected: CombatTarget | undefined, mate?: Squadmate) {
	if (weapon.kind === 'laser') return;
	const p = mate ?? state.player;
	const frame = mate?.frameId ?? state.frame;
	const sequence = mate ? ++mate.shotsFired : ++state.stats.shotsFired;
	const aim = rigAimPoint(p, selected);
	const muzzle = getPlayerMuzzle(frame, slot, p, p.turret, tubeIndex(getPlayerWeaponRig(frame)[slot]?.tubes.length ?? 0, sequence), aim, mate ? mate.authoredPose : state.authoredPose);
	const origin = exposedMuzzle(state.mission?.map.terrain, p, muzzle);
	const direction = getPlayerFiringDirection(frame, slot, p, p.turret, origin, aim);
	const spread = angle - p.turret; const cosine = Math.cos(spread); const sine = Math.sin(spread);
	state.shots.push({ ...origin, origin, age: 0, vx: (direction.x * cosine - direction.y * sine) * weapon.speed, vy: (direction.x * sine + direction.y * cosine) * weapon.speed, vElevation: direction.elevation * weapon.speed, life: weapon.range / weapon.speed,
		kind: weapon.kind, weapon: weapon.id, slot, target: weapon.kind === 'missile' ? selected?.id : undefined, damage: weapon.damage, ...(mate ? { squadmateId: mate.pilotId } : {}),
		...(weapon.splash > 0 ? { splash: weapon.splash } : {}), ...(weapon.kind === 'ppc' ? { hitIds: [] } : {}) });
	burst(state, origin, 20, weapon.color, 'muzzle', slot, mate?.pilotId);
};
export const getEnemyDefense = function (state: CombatStateView, enemy: Unit): { frontalMultiplier: number; exposed: boolean; enraged: boolean } {
	return {
		frontalMultiplier: enemy.kind === 'tank' ? state.difficulty === 'story' ? 0.85 : 0.65 : enemy.kind !== 'siege' ? 1 : state.difficulty === 'story' ? 0.8 : enemy.commander ? 0.5 : 0.6,
		exposed: enemy.kind === 'siege' && enemy.attack?.phase === 'recovery',
		enraged: Boolean(enemy.commander) && enemy.hp < enemy.maxHp * 0.5,
	};
};
const hurtEnemy = function (state: CombatStateView, enemy: Unit, damage: number, from: Point, playerFire: boolean) {
	const defense = getEnemyDefense(state, enemy);
	const frontal = Math.abs(angleDelta(enemy.kind === 'tank' ? enemy.hullAngle ?? enemy.angle : enemy.angle, Math.atan2(from.y - enemy.y, from.x - enemy.x))) < Math.PI / 3;
	const applied = damage * (defense.exposed ? 1.35 : frontal ? defense.frontalMultiplier : 1);
	if (playerFire) state.stats.damageDealt += Math.min(Math.max(0, enemy.hp), applied);
	enemy.hp -= applied;
	if (state.mission) enemy.engaged = true;
};
const hurtTarget = function (state: CombatStateView, target: CombatTarget, damage: number, from: Point, playerFire = true) {
	if (target.kind === 'enemy') { hurtEnemy(state, target.body, damage, from, playerFire); return; }
	const structure = target.body;
	if (structure.hp <= 0) return;
	if (playerFire) state.stats.damageDealt += Math.min(structure.hp, damage);
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
const hurtSquadmate = function (state: CombatStateView, mate: Squadmate, damage: number) {
	if (mate.hp <= 0) return;
	mate.hp = Math.max(0, mate.hp - damage * getFrame(mate.frameId).incomingDamage);
	if (mate.hp > 0) return;
	mate.speed = 0;
	for (const mount of mate.loadout) { mount.firing = false; delete mount.rocketVolley; }
	burst(state, mate, 65, '#ffab62'); state.events.push('explosion');
};
const hurtRelay = function (state: CombatStateView, damage: number) {
	if (damage > 0 && state.relay > 0) state.events.push('relay-hit');
	state.stats.relayDamage += Math.min(state.relay, damage);
	state.relay = Math.max(0, state.relay - damage);
};
const commitBarrage = function (state: CombatStateView, enemy: Unit, target: Point, mount: WeaponMount) {
	if (!enemyCanFire(enemy, target)) return;
	const commander = Boolean(enemy.commander);
	const enraged = getEnemyDefense(state, enemy).enraged;
	const permissive = state.difficulty === 'story';
	const duration = commander ? 3.2 : 2.8;
	const radius = commander ? 82 : 62;
	const damage = (commander ? 12 : 6) * getDifficultyDefinition(state.difficulty).enemyDamage * getWeaponTier(getWeapon(mount.weapon).tier).damage;
	const addStrike = function (at: Point, delay: number, size = radius) {
		if (!enemyCanFire(enemy, at) || !consumeFire(mount, enemyReactor(enemy))) return;
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
	const advancePose = getMechAssetBinding(state.frame)?.advancePose;
	const before = state.authoredPose ?? advancePose?.(undefined, p, state.time - dt);
	const frame = getFrame(state.frame);
	const bounds = state.mission?.map ?? ARENA;
	p.angle += input.heading === undefined ? input.turn * dt * frame.turnRate : clamp(angleDelta(p.angle, input.heading), -dt * frame.turnRate, dt * frame.turnRate);
	// Simulation holds its engine setting; arcade approaches stick demand, including neutral.
	const throttleChange = dt * 0.75;
	p.throttle = input.stop ? 0 : input.throttleTarget === undefined
		? clamp(p.throttle + input.drive * throttleChange, -1, 1)
		: p.throttle + clamp(clamp(input.throttleTarget, 0, 1) - p.throttle, -throttleChange, throttleChange);
	const modifier = frameWeight(state.frame, state.loadout).modifier;
	advanceDrive(p, p.throttle * (p.throttle < 0 ? frame.reverseSpeed : frame.speed) * modifier, frame.acceleration, dt, bounds, state.mission?.map.terrain);
	const aimAngle = Math.atan2(input.aim.y - p.y, input.aim.x - p.x);
	p.turret = turnTorso(p.angle, p.turret, aimAngle, dt * frame.turretRate, input.turretTurn);
	if (advancePose) state.authoredPose = advancePose(before, p, state.time);

};

const fireRigWeapons = function (state: CombatStateView, input: Pick<Controls, 'aim' | 'fire' | 'targetId' | 'turretTurn'>, dt: number, mate?: Squadmate) {
	const p = mate ?? state.player;
	const frame = mate?.frameId ?? state.frame;
	const loadout = mate?.loadout ?? state.loadout;
	const targets = combatTargets(state);
	const selected = targets.find(function (target) { return target.id === input.targetId; });
	p.targetId = selected?.id;
	const terrain = state.mission?.map.terrain;
	const tracking = selected ? rigMissileTracking(p, frame, loadout, targets, selected.id, terrain) : 'NO GUIDANCE';
	const previous = p.missileLock;
	if (!selected || tracking === 'NO GUIDANCE') p.missileLock = undefined;
	else {
		const lock = previous?.targetId === selected.id ? previous : { targetId: selected.id, progress: 0, interrupted: 0 };
		const interrupted = tracking === 'TRACKING' ? 0 : lock.interrupted + dt;
		const decayTime = Math.max(0, interrupted - MISSILE_LOCK_GRACE) - Math.max(0, lock.interrupted - MISSILE_LOCK_GRACE);
		p.missileLock = { targetId: selected.id, interrupted, progress: clamp(lock.progress + (tracking === 'TRACKING' ? dt : -decayTime) / MISSILE_LOCK_SECONDS, 0, 1) };
	}
	const canFire = inFiringArc(p, p.angle, selected?.body ?? (input.turretTurn === undefined ? input.aim : { x: p.x + Math.cos(p.turret), y: p.y + Math.sin(p.turret) }));
	const targetRange = selected ? distance(p, selected.body) : Infinity;
	const locked = tracking === 'TRACKING' && (p.missileLock?.progress ?? 0) >= 1 - 1e-9;
	const wasOverheated = p.overheated;
	const firingSlots = new Set<number>();
	loadout.forEach(function (mount, index) {
		const slot = mount.slot ?? index;
		if (!canEquipWeapon(frame, slot, mount.weapon) || firingSlots.has(slot)) return;
		firingSlots.add(slot);
		const weapon = getWeapon(mount.weapon);
		const withinRange = targetRange <= weapon.range;
		if (!canFire || weapon.kind === 'missile' && (!locked || !withinRange) || mate && (!withinRange || !input.fire[slot])) { delete mount.rocketVolley; return; }
		if (mate && selected && terrain) {
			const muzzle = getPlayerMuzzle(frame, slot, mate, mate.turret, tubeIndex(getPlayerWeaponRig(frame)[slot]?.tubes.length ?? 0, mate.shotsFired + 1), rigAimPoint(mate, selected), mate.authoredPose);
			if (muzzleBlocked(terrain, mate, muzzle, targetVolume(selected))) { delete mount.rocketVolley; return; }
		}
		const volley = mount.rocketVolley;
		if (volley && (weapon.kind === 'rocket' || weapon.stream)) {
			volley.nextIn -= dt;
			while (volley.remaining > 0 && volley.nextIn <= 1e-9) {
				if (!consumeFire(mount, p)) { volley.remaining = 0; break; }
				launchWeapon(state, weapon, p.turret, slot, selected, mate);
				volley.remaining--; volley.nextIn += volleySpacing(weapon); mount.firing = true;
				if (!mate) state.events.push(weapon.kind === 'missile' ? 'missile' : 'rocket');
			}
			if (volley.remaining === 0) delete mount.rocketVolley;
			return;
		}
		if (p.overheated || !usableMount(mount) || !input.fire[slot]) return;
		if (weapon.kind === 'laser') {
			if (!consumeFire(mount, p, dt)) return;
			const aim = rigAimPoint(p, selected);
			const muzzle = getPlayerMuzzle(frame, slot, p, p.turret, undefined, aim, mate ? mate.authoredPose : state.authoredPose);
			const origin = exposedMuzzle(terrain, p, muzzle);
			const direction = getPlayerFiringDirection(frame, slot, p, p.turret, origin, aim);
			const length = direction.elevation < 0 ? Math.min(weapon.range, -origin.elevation / direction.elevation) : weapon.range;
			const end = { x: origin.x + direction.x * length, y: origin.y + direction.y * length, elevation: Math.max(0, origin.elevation + direction.elevation * length) };
			const hits = combatTargets(state).map(function (target) { return { target, entry: hitVolumeFraction(origin, end, targetVolume(target)) }; }).filter(function (hit): hit is { target: CombatTarget; entry: number } { return hit.entry !== undefined; }).sort(function (a, b) { return a.entry - b.entry; });
			const cover = terrain ? terrainShotFraction(terrain, origin, end) : undefined;
			const first = hits[0];
			const hit = first && first.entry < (cover ?? Infinity) ? first : undefined;
			const endpoint = pointAlong(origin, end, hit?.entry ?? cover ?? 1);
			state.beams.push({ ...endpoint, slot, origin, ...(mate ? { squadmateId: mate.pilotId } : {}) });
			if (hit) hurtTarget(state, hit.target, weapon.damage * dt, origin, !mate);
			mount.firing = true;
			return;
		}
		if (mount.cooldown > 0) return;
		for (let projectile = 0; projectile < (weapon.kind === 'rocket' || weapon.stream ? 1 : weapon.projectiles); projectile++) {
			if (!consumeFire(mount, p)) break;
			const sequence = mate?.shotsFired ?? state.stats.shotsFired;
			const spread = weapon.projectiles === 1 ? Math.sin(sequence * 2.4) * weapon.spread : (projectile - (weapon.projectiles - 1) / 2) * weapon.spread;
			launchWeapon(state, weapon, p.turret + spread * (mate?.specialty === 'marksman' ? 0.5 : 1), slot, selected, mate);
		}
		if ((weapon.kind === 'rocket' || weapon.stream) && weapon.projectiles > 1 && usableMount(mount) && !p.overheated) mount.rocketVolley = { remaining: Math.min(weapon.projectiles - 1, mount.rounds), nextIn: volleySpacing(weapon) };
		mount.cooldown = weapon.interval; mount.firing = true;
		if (!mate) {
			if (weapon.kind === 'cannon' || weapon.kind === 'ppc') { state.cannonIn = 0.65; state.shake = weapon.kind === 'ppc' ? 4 : 3; }
			state.events.push(weapon.kind === 'bullet' ? 'machine-gun' : weapon.kind);
		}
	});
	if (!mate && !wasOverheated && p.overheated) { state.stats.overheats++; state.events.push('overheat'); }
};
export const weaponsStep = function (state: CombatStateView, input: Controls, dt: number) {
	state.beams = [];
	fireRigWeapons(state, input, dt);
};

const squadmateTarget = function (state: CombatStateView, mate: Squadmate, targets: readonly CombatTarget[], range: number): CombatTarget | undefined {
	if (mate.fireDiscipline === 'hold') return undefined;
	const terrain = state.mission?.map.terrain;
	const origin = terrain ? playerVolume(mate, mate.frameId) : undefined;
	const reachable = function (target: CombatTarget) {
		return target.body.hp > 0 && distance(mate, target.body) <= range
			&& (!terrain || !origin || terrainShotFraction(terrain, origin, targetVolume(target)) === undefined);
	};
	const priority = function (target: CombatTarget) { return target.kind === 'structure' || target.id === state.mission?.targetId ? 0 : 1; };
	return targets.filter(reachable).sort(function (a, b) { return priority(a) - priority(b) || distance(mate, a.body) - distance(mate, b.body) || a.id - b.id; })[0];
};
// Evaluate the firing lane with the rig facing the target. The actual aim,
// lock, heat and muzzle checks still run before each shot.
const squadmateShotClear = function (mate: Squadmate, point: Point, target: CombatTarget, contacts: readonly CombatTarget[], terrain: FieldTerrain | undefined) {
	const separation = distance(point, target.body);
	const at = targetVolume(target);
	const bearing = Math.atan2(at.y - point.y, at.x - point.x);
	const facing = { x: point.x, y: point.y, angle: bearing };
	const origin = playerVolume(point, mate.frameId);
	return mate.loadout.some(function (mount, index) {
		const weapon = getWeapon(mount.weapon);
		const slot = mount.slot ?? index;
		if (separation > weapon.range || !usableMount(mount) || !canEquipWeapon(mate.frameId, slot, mount.weapon)) return false;
		if (weapon.kind === 'missile' && (contactObstructs(origin, at, target.id, contacts)
			|| terrain && terrainShotFraction(terrain, origin, at) !== undefined)) return false;
		if (!terrain) return true;
		const tube = tubeIndex(getPlayerWeaponRig(mate.frameId)[slot]?.tubes.length ?? 0, mate.shotsFired + 1);
		const muzzle = getPlayerMuzzle(mate.frameId, slot, facing, bearing, tube, at);
		return !muzzleBlocked(terrain, facing, muzzle, at);
	});
};
const squadmateAttackDestination = function (state: CombatStateView, mate: Squadmate, target: CombatTarget, contacts: readonly CombatTarget[], range: number): Point {
	if (range === 0) return mate;
	const separation = distance(mate, target.body);
	if (separation > range) return target.body;
	const bearing = Math.atan2(mate.y - target.body.y, mate.x - target.body.x);
	const radius = Math.min(separation, range * 0.8);
	const terrain = state.mission?.map.terrain;
	for (const offset of [Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3]) {
		const at = { x: target.body.x + Math.cos(bearing + offset) * radius, y: target.body.y + Math.sin(bearing + offset) * radius };
		if (squadOrderDestinationClear(state, at) && squadmateShotClear(mate, at, target, contacts, terrain)) return at;
	}
	return target.body;
};
const squadmateDestination = function (state: CombatStateView, active: readonly Squadmate[], mate: Squadmate, index: number): Point {
	if (mate.order?.kind === 'hold' || mate.order?.kind === 'move') return mate.order.point;
	const player = state.player;
	const mission = state.mission;
	if (!mate.order) {
		if (mission?.stage === 'extract') {
			const { objective, extraction } = mission.map;
			return squadDestination(extraction, Math.atan2(extraction.y - objective.y, extraction.x - objective.x), index, 48, 58);
		}
		const nearestSite = mission?.captureSites?.filter(function (site) { return !site.complete && distance(player, site) < CAPTURE_RADIUS + 210; })
			.sort(function (a, b) { return distance(player, a) - distance(player, b); })[0];
		if (nearestSite && active.every(function (other) {
			return other === mate || distance(other, nearestSite) >= (other.order ? CAPTURE_RADIUS : distance(mate, nearestSite));
		})) return nearestSite;
	}
	return mate.specialty === 'skirmisher' ? squadDestination(player, player.angle, index, 54, 115) : squadDestination(player, player.angle, index, 120, 85);
};

export const squadmatesStep = function (state: CombatStateView, dt: number) {
	if (state.squadmates.length === 0) return;
	const bounds = state.mission?.map ?? ARENA;
	const terrain = state.mission?.map.terrain;
	const active = state.squadmates.filter(function (mate) { return mate.hp > 0; });
	const targets = combatTargets(state);
	for (const [index, mate] of state.squadmates.entries()) {
		if (mate.hp <= 0) continue;
		const frame = getFrame(mate.frameId);
		const advancePose = getMechAssetBinding(mate.frameId)?.advancePose;
		const previousPose = mate.authoredPose ?? advancePose?.(undefined, mate, state.time - dt);
		for (const mount of mate.loadout) { mount.cooldown = Math.max(0, mount.cooldown - dt); mount.firing = false; }
		coolReactor(mate, frame.cooling, dt);
		if (mate.heat >= 85 && mate.coolantCharges > 0) {
			mate.coolantCharges--; mate.heat -= 55;
			if (mate.heat <= 35) mate.overheated = false;
			burst(state, mate, 80, '#93e9e1');
		}
		const order = mate.order;
		const ordered = order?.kind === 'attack' ? targets.find(function (candidate) { return candidate.id === order.targetId && candidate.body.hp > 0; }) : undefined;
		if (order?.kind === 'attack' && !ordered) delete mate.order;
		const range = Math.max(0, ...mate.loadout.filter(usableMount).map(function (mount) { return getWeapon(mount.weapon).range; }));
		const target = ordered ? (squadmateShotClear(mate, mate, ordered, targets, terrain) ? ordered : undefined) : squadmateTarget(state, mate, targets, range);
		const destination = ordered ? (target ? mate : squadmateAttackDestination(state, mate, ordered, targets, range)) : squadmateDestination(state, active, mate, index);
		const at = { x: clamp(destination.x, EDGE_CLEARANCE, bounds.width - EDGE_CLEARANCE), y: clamp(destination.y, EDGE_CLEARANCE, bounds.height - EDGE_CLEARANCE) };
		const separation = distance(mate, at);
		const moving = separation > SQUAD_ARRIVAL_RADIUS;
		const heading = travelHeading(terrain, mate, at, RIG_RADIUS);
		const bearing = target ? Math.atan2(target.body.y - mate.y, target.body.x - mate.x) : state.player.angle;
		// Brake along the approach before turning to face a contact. Turning while
		// coasting into a waypoint can carry the rig out of its own arrival radius.
		const holdingPoint = mate.order?.kind === 'hold' || mate.order?.kind === 'move';
		const desiredHeading = moving ? heading : holdingPoint && Math.abs(mate.motorSpeed ?? mate.speed) > .5 ? mate.angle : bearing;
		mate.angle += clamp(angleDelta(mate.angle, desiredHeading), -dt * frame.turnRate, dt * frame.turnRate);
		const demand = moving ? Math.min(1, separation / 110) * Math.max(0, Math.cos(angleDelta(mate.angle, heading))) : 0;
		mate.throttle = demand;
		const speed = frameWeight(mate.frameId, mate.loadout).speed * demand;
		advanceDrive(mate, speed, frame.acceleration, dt, bounds, terrain);
		const aim = target?.body ?? { x: mate.x + Math.cos(mate.angle), y: mate.y + Math.sin(mate.angle) };
		const aimAngle = Math.atan2(aim.y - mate.y, aim.x - mate.x);
		mate.turret = turnTorso(mate.angle, mate.turret, aimAngle, dt * frame.turretRate);
		if (advancePose) mate.authoredPose = advancePose(previousPose, mate, state.time);
		const fire = target !== undefined && Math.abs(angleDelta(mate.turret, aimAngle)) <= (mate.specialty === 'marksman' ? 0.035 : 0.075);
		fireRigWeapons(state, { aim, fire: [fire, fire, fire, fire], ...(target ? { targetId: target.id } : {}) }, dt, mate);
	}
};

export const spawningStep = function (state: CombatStateView, dt: number) {
	const mission = state.mission;
	const wave = getWaveDefinition(state.wave);
	const quota = mission ? missionHostileCount(mission.contract) : wave.enemies.length;
	state.spawnIn -= dt;
	if (state.spawned < quota && state.spawnIn <= 0 && (!mission || mission.contract.kind === 'defend' && mission.stage === 'active')) {
		if (mission) {
			const spawn = missionSpawn(mission.contract, mission.map, state.spawned);
			state.warnings.push({ ...spawn, life: 3 });
			// Heavy contacts need room for an armor/exposure cycle before the next arrival.
			const interval = spawn.kind === 'siege' ? 28 : spawn.kind === 'striker' ? 16 : 8;
			state.spawned++; state.spawnIn = interval * (state.spawned % 3 === 0 ? 1.5 : 1);
		} else {
			const spawn = wave.enemies[state.spawned];
			if (!spawn) throw new Error('Missing wave spawn');
			const theta = state.spawned * 2.4 + wave.bearing;
			state.warnings.push({ x: 900 + Math.cos(theta) * 840, y: 600 + Math.sin(theta) * 530, ...spawn, life: spawn.commander ? 3 : 2 });
			if (state.spawned === 0 && state.wave === 1) state.events.push('wave');
			state.spawned++; state.spawnIn = state.wave === 1 ? wave.interval : state.spawned % 3 === 0 ? wave.interval * 2.4 : 4;
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
	const terrain = mission?.map.terrain;
	const difficulty = getDifficultyDefinition(state.difficulty);
	const enemies = state.enemies;
	const squadmates = state.squadmates;
	const nearestRig = squadmates.length > 0 ? new Map(enemies.map(function (enemy) { return [enemy.id, closestRig(p, squadmates, enemy)]; })) : undefined;
	// Wake units before planning so idle garrisons cannot be recruited remotely.
	if (mission && !relay) for (const enemy of enemies) {
		if (enemy.hp > 0 && (distance(enemy, nearestRig?.get(enemy.id) ?? p) < Math.max(850, ENEMY_STATS[enemy.kind].aggro) || enemy.hp < enemy.maxHp)) enemy.engaged = true;
	}
	const ground = enemies.filter(function (enemy) { return enemy.hp > 0 && enemy.kind !== 'helicopter' && enemy.kind !== 'vtol'; });
	const skirmishers = ground.filter(function (enemy) {
		return !enemy.stationary && !enemy.commander && (enemy.kind === 'scout' || enemy.kind === 'striker') && enemyMounts(enemy).some(usableMount) && (!mission || relay !== undefined || enemy.engaged);
	});
	const orders = planSquads(skirmishers.map(function (enemy) { return { id: enemy.id, x: enemy.x, y: enemy.y, aggro: ENEMY_STATS[enemy.kind].aggro, ...(enemy.squad ? { order: enemy.squad } : {}) }; }), p, relay, dt);
	const tactics = planGroundTactics(skirmishers.map(function (enemy) {
		const stats = ENEMY_STATS[enemy.kind]; const order = orders.get(enemy.id);
		const rig = nearestRig?.get(enemy.id) ?? p;
		const target = order?.target ?? (!relay || distance(enemy, rig) < stats.aggro ? 'player' : 'relay');
		return { id: enemy.id, x: enemy.x, y: enemy.y, hp: enemy.hp, maxHp: enemy.maxHp, angle: enemy.hullAngle ?? enemy.angle,
			range: stats.range, speed: stats.speed * enemyWeight(enemy).modifier, overheated: enemyReactor(enemy).overheated,
			target, at: target === 'relay' && relay ? relay : rig, ...(order ? { squad: order } : {}), ...(enemy.tactics ? { tactics: enemy.tactics } : {}) };
	}), ground, bounds, dt);
	for (const enemy of enemies) {
		const order = orders.get(enemy.id);
		if (order) enemy.squad = order;
		else delete enemy.squad;
		const tactic = tactics.get(enemy.id);
		if (tactic) enemy.tactics = tactic;
		else delete enemy.tactics;
		if (enemy.hp <= 0) continue;
		const mech = isEnemyMech(enemy);
		if (mech) {
			enemy.hullAngle ??= enemy.angle;
			enemy.angle = turnTorso(enemy.hullAngle, enemy.angle, enemy.angle, 0);
		}
		const stats = ENEMY_STATS[enemy.kind];
		const mounts = enemyMounts(enemy);
		const reactor = enemyReactor(enemy);
		coolReactor(reactor, stats.cooling, dt);
		const speed = stats.speed * enemyWeight(enemy).modifier;
		for (const mount of enemy.loadout ?? []) { mount.firing = false; mount.cooldown = Math.max(0, mount.cooldown - dt); }
		if (mission && !relay && !enemy.engaged) continue;
		const rig = nearestRig?.get(enemy.id) ?? p;
		const individualTarget = !relay || enemy.commander || distance(enemy, rig) < stats.aggro ? rig : relay;
		const target = order ? order.target === 'relay' && relay ? relay : rig : individualTarget;
		if (enemy.attack) {
			enemy.attack.remaining -= dt;
			if (enemy.attack.remaining <= 0) {
				if (enemy.attack.phase === 'committed') { enemy.attack.phase = 'recovery'; enemy.attack.remaining = enemy.commander ? 4.2 : 3.2; }
				else { delete enemy.attack; enemy.cooldown = enemy.commander ? getEnemyDefense(state, enemy).enraged ? 1.2 : 2.2 : stats.reload; }
			}
			continue;
		}
		const navigable = travelTerrain(terrain, enemy);
		if (!enemy.stationary && !mounts.some(usableMount)) {
			// Local disengagement keeps dry units inside the map and targetable.
			const bearing = Math.atan2(enemy.y - target.y, enemy.x - target.x);
			const away = navigable ? travelHeading(navigable, enemy, {
				x: clamp(enemy.x + Math.cos(bearing) * stats.range, 35, bounds.width - 35),
				y: clamp(enemy.y + Math.sin(bearing) * stats.range, 35, bounds.height - 35),
			}, ENEMY_RADIUS) : bearing;
			const heading = enemy.hullAngle ?? enemy.angle;
			const turnRate = enemy.kind === 'tank' ? 0.5 : enemy.kind === 'siege' ? 0.65 : 2;
			enemy.hullAngle = heading + clamp(angleDelta(heading, away), -dt * turnRate, dt * turnRate);
			moveBody(enemy, Math.cos(enemy.hullAngle) * speed * dt, Math.sin(enemy.hullAngle) * speed * dt, bounds, navigable, ENEMY_RADIUS);
			if (mech) enemy.angle = turnTorso(enemy.hullAngle, enemy.angle, enemy.angle, 0);
			continue;
		}
		const targetAngle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
		const turnRate = enemy.kind === 'tank' ? 0.9 : enemy.kind === 'siege' ? 0.65 : undefined;
		if (!mech) enemy.angle = turnRate === undefined ? targetAngle : enemy.angle + clamp(angleDelta(enemy.angle, targetAngle), -dt * turnRate, dt * turnRate);
		if (enemy.kind === 'tank') enemy.hullAngle ??= enemy.angle;
		const range = enemy.commander ? 690 : stats.range;
		const separation = distance(enemy, target);
		const seekSight = Boolean(terrain && !enemy.stationary && !reactor.overheated && terrainShotFraction(terrain, enemyVolume(enemy), enemyTargetVolume(state, target)) !== undefined);
		if (enemy.kind === 'helicopter' || enemy.kind === 'vtol') {
			// Aircraft retain a standoff distance while moving across the firing
			// line. Their gun/pods track independently of the flight heading.
			const radial = clamp((separation - range) / 160, -1, 1);
			const lateral = enemy.kind === 'helicopter' ? (enemy.id % 2 === 0 ? 0.7 : -0.7) : Math.sin(state.time * 0.65 + enemy.id) * 0.85;
			const vx = Math.cos(targetAngle) * radial - Math.sin(targetAngle) * lateral;
			const vy = Math.sin(targetAngle) * radial + Math.cos(targetAngle) * lateral;
			const magnitude = Math.max(1, Math.hypot(vx, vy));
			let dx = vx / magnitude * dt * speed;
			let dy = vy / magnitude * dt * speed;
			if (navigable && (dx || dy)) {
				const bearing = travelHeading(navigable, enemy, { x: enemy.x + vx * 220, y: enemy.y + vy * 220 }, ENEMY_RADIUS);
				const travel = Math.hypot(dx, dy);
				dx = Math.cos(bearing) * travel; dy = Math.sin(bearing) * travel;
			}
			moveBody(enemy, dx, dy, bounds, navigable, ENEMY_RADIUS);
			if (Math.hypot(vx, vy) > 0.05) {
				const heading = enemy.hullAngle ?? enemy.angle;
				const bearing = navigable && dt > 0 ? Math.atan2(dy, dx) : Math.atan2(vy, vx);
				enemy.hullAngle = heading + clamp(angleDelta(heading, bearing), -dt * 2, dt * 2);
			}
		} else if (tactic) {
			// An in-range firing position behind a wall must keep advancing until
			// the unit can see its target. It can then resume the squad's tactics.
			const destination = seekSight ? target : tactic.destination;
			const at = navigable ? terrainWaypoint(navigable, enemy, destination, ENEMY_RADIUS) : destination;
			const travel = distance(enemy, at);
			const heading = enemy.hullAngle ?? enemy.angle;
			const moving = (seekSight || tactic.phase !== 'engage') && travel > 0 && distance(enemy, destination) > 12;
			const bearing = moving && (seekSight || tactic.phase === 'advance') ? Math.atan2(at.y - enemy.y, at.x - enemy.x) : targetAngle;
			enemy.hullAngle = heading + clamp(angleDelta(heading, bearing), -dt * 2, dt * 2);
			if (moving) {
				const amount = Math.min(dt * speed, travel) / travel;
				moveBody(enemy, (at.x - enemy.x) * amount, (at.y - enemy.y) * amount, bounds, navigable, ENEMY_RADIUS);
			}
		} else if ((enemy.kind === 'tank' || !enemy.stationary) && (separation > range || seekSight)) {
			const heading = enemy.hullAngle ?? enemy.angle;
			const bearing = navigable ? travelHeading(navigable, enemy, target, ENEMY_RADIUS) : targetAngle;
			const maxTurn = dt * (enemy.kind === 'tank' ? 0.5 : turnRate ?? 2);
			enemy.hullAngle = heading + clamp(angleDelta(heading, bearing), -maxTurn, maxTurn);
			moveBody(enemy, Math.cos(enemy.hullAngle) * dt * speed, Math.sin(enemy.hullAngle) * dt * speed, bounds, navigable, ENEMY_RADIUS);
		}
		if (mech) {
			const torsoRate = enemy.kind === 'scout' ? getFrame('kestrel').turretRate : enemy.kind === 'siege' ? 0.65 : getFrame('warden').turretRate;
			enemy.angle = turnTorso(enemy.hullAngle ?? enemy.angle, enemy.angle, Math.atan2(target.y - enemy.y, target.x - enemy.x), dt * torsoRate);
		}
		for (const mount of mounts) {
			const volley = mount.rocketVolley;
			if (!volley) continue;
			if (!enemyCanFire(enemy, target)) { delete mount.rocketVolley; continue; }
			volley.nextIn -= dt;
			while (volley.remaining > 0 && volley.nextIn <= 1e-9) {
				if (!launchEnemy(state, enemy, mount, target, stats.damage * difficulty.enemyDamage)) { volley.remaining = 0; break; }
				volley.remaining--; volley.nextIn += volleySpacing(getWeapon(mount.weapon));
			}
			if (volley.remaining === 0) delete mount.rocketVolley;
		}
		enemy.cooldown -= dt;
		if (enemyCanFire(enemy, target) && !reactor.overheated && enemy.cooldown <= 0 && distance(enemy, target) < range + ENEMY_FIRING_MARGIN && Math.abs(angleDelta(enemy.angle, Math.atan2(target.y - enemy.y, target.x - enemy.x))) < 0.3) {
			const ready = mounts.filter(function (mount) { return usableMount(mount) && mount.cooldown <= 0 && !mount.rocketVolley; });
			const artillery = enemy.kind === 'siege' || enemy.commander ? ready.find(function (mount) { return getEnemyHardpoints(enemy.kind, enemy.commander)[mount.slot ?? 0]?.id === 'dorsal-artillery'; }) : undefined;
			let fired = artillery;
			if (artillery) commitBarrage(state, enemy, target, artillery);
			else {
				const next = enemy.attackSlot ?? 0;
				const mount = Array.from({ length: mounts.length }, function (_unused, offset) { return mounts[(next + offset) % mounts.length]; }).find(function (candidate) { return candidate !== undefined && ready.includes(candidate); });
				if (mount) { fired = mount; fireEnemyMount(state, enemy, mount, target, stats.damage * difficulty.enemyDamage); enemy.attackSlot = mounts.indexOf(mount) + 1; }
			}
			enemy.cooldown = stats.reload * (fired ? getWeaponTier(getWeapon(fired.weapon).tier).interval : 1);
		}
	}

};

export const artilleryStep = function (state: CombatStateView, dt: number) {
	const p = state.player;
	const relay = relayPosition(state);
	const squadmates = state.squadmates;
	for (const strike of state.strikes) {
		strike.life -= dt;
		if (strike.life > 0) continue;
		if (distance(strike, p) < strike.radius + 20) hurtPlayer(state, strike.damage);
		for (const mate of squadmates) if (distance(strike, mate) < strike.radius + 20) hurtSquadmate(state, mate, strike.damage);
		if (relay && distance(strike, relay) < strike.radius + 30) hurtRelay(state, strike.damage * 0.6);
		burst(state, strike, strike.radius * 1.7, '#ff874d'); state.events.push('explosion');
	}
	state.strikes = state.strikes.filter(function (strike) { return strike.life > 0; });

};

const steerShot = function (shot: Shot, target: SpatialPoint, travel: number) {
	const speed = Math.hypot(shot.vx, shot.vy, shot.vElevation ?? 0);
	if (speed === 0) return;
	const current = { x: shot.vx / speed, y: shot.vy / speed, elevation: (shot.vElevation ?? 0) / speed };
	const desired = getFiringDirection({ ...shot, elevation: shot.elevation ?? 42 }, Math.atan2(shot.vy, shot.vx), target);
	const dot = clamp(current.x * desired.x + current.y * desired.y + current.elevation * desired.elevation, -1, 1);
	const angle = Math.acos(dot); const step = Math.min(angle, travel * 3);
	let tangent = { x: desired.x - dot * current.x, y: desired.y - dot * current.y, elevation: desired.elevation - dot * current.elevation };
	let length = Math.hypot(tangent.x, tangent.y, tangent.elevation);
	if (length < 0.000001) {
		// Opposite headings need a deterministic turn plane rather than a zero blend.
		tangent = Math.hypot(current.x, current.y) > 0.000001 ? { x: -current.y, y: current.x, elevation: 0 } : { x: 1, y: 0, elevation: 0 };
		length = Math.hypot(tangent.x, tangent.y, tangent.elevation);
	}
	const forwardWeight = Math.cos(step); const turnWeight = Math.sin(step) / length;
	shot.vx = (current.x * forwardWeight + tangent.x * turnWeight) * speed;
	shot.vy = (current.y * forwardWeight + tangent.y * turnWeight) * speed;
	shot.vElevation = (current.elevation * forwardWeight + tangent.elevation * turnWeight) * speed;
};
export const projectilesStep = function (state: CombatStateView, dt: number) {
	const p = state.player; const relay = relayPosition(state);
	const terrain = state.mission?.map.terrain;
	const playerBody = playerVolume(p, state.frame);
	const relayBody = relay ? facilityVolume(relay, 42) : undefined;
	const squadmates = state.squadmates.map(function (mate) { return { mate, body: playerVolume(mate, mate.frameId) }; });
	for (const shot of state.shots) {
		const travel = Math.min(dt, Math.max(0, shot.life)); shot.life -= dt; shot.age = (shot.age ?? 0) + travel;
		if (shot.kind === 'enemy' && shot.enemyTarget) {
			const aim = shot.enemyTarget;
			const target = typeof aim === 'string' ? aim === 'player' ? playerBody : relayBody
				: squadmates.find(function ({ mate }) { return mate.pilotId === aim.squadmateId && mate.hp > 0; })?.body;
			if (target) steerShot(shot, target, travel);
		}
		if (shot.kind === 'missile') {
			const target = combatTargets(state).find(function (candidate) { return candidate.id === shot.target; });
			if (target) steerShot(shot, targetVolume(target), travel);
		}
		const origin = { x: shot.x, y: shot.y, elevation: shot.elevation ?? 42 };
		shot.x += shot.vx * travel; shot.y += shot.vy * travel; shot.elevation = origin.elevation + (shot.vElevation ?? 0) * travel;
		const end = { x: shot.x, y: shot.y, elevation: shot.elevation };
		let intercepted = false;
		const groundHit = end.elevation < 0 ? origin.elevation / (origin.elevation - end.elevation) : Infinity;
		const coverHit = terrain ? terrainShotFraction(terrain, origin, end) ?? Infinity : Infinity;
		if (shot.kind === 'enemy') {
			const playerHit = hitVolumeFraction(origin, end, playerBody); const relayHit = relayBody ? hitVolumeFraction(origin, end, relayBody) : undefined;
			let entry = playerHit !== undefined && (relayHit === undefined || playerHit <= relayHit) ? playerHit : relayHit;
			let allyHit: Squadmate | undefined;
			for (const { mate, body } of squadmates) {
				if (mate.hp <= 0) continue;
				const hit = hitVolumeFraction(origin, end, body);
				if (hit !== undefined && (entry === undefined || hit < entry)) { entry = hit; allyHit = mate; }
			}
			if (entry !== undefined && entry <= groundHit && entry < coverHit) {
				if (allyHit) hurtSquadmate(state, allyHit, shot.damage);
				else if (playerHit === entry) hurtPlayer(state, shot.damage);
				else hurtRelay(state, shot.damage * 0.65);
				shot.life = 0; intercepted = true; burst(state, pointAlong(origin, end, entry), 30, '#ff985d'); state.events.push('impact');
			}
		} else {
			const playerFire = shot.squadmateId === undefined;
			const hits = combatTargets(state).filter(function (target) { return !shot.hitIds?.includes(target.id); }).map(function (target) { return { target, entry: hitVolumeFraction(origin, end, targetVolume(target)) }; }).filter(function (candidate): candidate is { target: CombatTarget; entry: number } { return candidate.entry !== undefined && candidate.entry <= groundHit && candidate.entry < coverHit; }).sort(function (a, b) { return a.entry - b.entry || a.target.id - b.target.id; });
			for (const hit of hits) {
				hurtTarget(state, hit.target, shot.damage, origin, playerFire);
				if (playerFire && (!shot.hitIds || shot.hitIds.length === 0)) state.stats.shotsHit++;
				if (shot.hitIds) shot.hitIds.push(hit.target.id); else { shot.life = 0; intercepted = true; }
				const impact = pointAlong(origin, end, hit.entry);
				if (shot.splash) splashDamage(state, impact, shot, hit.target.id);
				burst(state, impact, shot.splash ?? (shot.kind === 'ppc' ? 55 : shot.kind === 'cannon' ? 45 : 20), shot.kind === 'ppc' ? '#b1a0ff' : '#ffd28b');
				if (playerFire && shot.kind !== 'bullet') state.shake = Math.max(state.shake, 2);
				state.events.push('impact'); if (!shot.hitIds) break;
			}
		}
		const surfaceHit = Math.min(groundHit, coverHit);
		if (Number.isFinite(surfaceHit) && !intercepted) {
			const impact = pointAlong(origin, end, surfaceHit); shot.life = 0;
			if (shot.splash && shot.kind !== 'enemy') splashDamage(state, impact, shot);
			burst(state, impact, shot.splash ?? 18, '#ffb477'); state.events.push('impact');
		}
	}
	state.shots = state.shots.filter(function (shot) { return shot.life > 0; });
};
const splashDamage = function (state: CombatStateView, impact: SpatialPoint, shot: Shot, directId?: number) {
	const terrain = state.mission?.map.terrain;
	for (const nearby of combatTargets(state)) {
		const volume = targetVolume(nearby);
		if (nearby.id === directId || spatialDistance(volume, impact) >= (shot.splash ?? 0) + (nearby.kind === 'structure' ? nearby.radius : 0)) continue;
		// Trace toward the blast so its own wall face is the permitted endpoint.
		if (terrain && (terrainShotFraction(terrain, volume, impact) ?? 1) < 1 - 1e-8) continue;
		hurtTarget(state, nearby, shot.damage * 0.6, impact, shot.squadmateId === undefined);
	}
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
		const squadmates = state.squadmates;
		const alliesInZone = function (site: Point, radius: number) {
			return squadmates.some(function (mate) { return mate.hp > 0 && distance(mate, site) <= radius; });
		};
		if (mission.stage === 'active' && mission.captureSites) {
			const duration = mission.contract.kind === 'recovery' ? RECOVERY_SECONDS : BEACON_SECONDS;
			for (const site of mission.captureSites) {
				if (site.complete) continue;
				const occupied = distance(p, site) <= CAPTURE_RADIUS || alliesInZone(site, CAPTURE_RADIUS);
				site.holdTime = occupied ? Math.min(duration, site.holdTime + dt) : 0;
				if (site.holdTime >= duration - 1e-9) { site.complete = true; site.holdTime = duration; burst(state, site, 130, '#93e9e1'); }
			}
		}
		mission.progress = mission.contract.kind === 'raid' ? mission.raidTargets?.filter(function (site) { return site.hp <= 0; }).length ?? 0
			: mission.captureSites ? mission.captureSites.filter(function (site) { return site.complete; }).length
			: mission.contract.kind === 'demolition' ? Number(mission.structure?.hp === 0)
			: mission.contract.kind === 'assassination' ? Number(mission.targetId !== undefined && !state.enemies.some(function (enemy) { return enemy.id === mission.targetId; })) : state.kills;
		if (mission.stage === 'active' && mission.acquisitionTime !== undefined) {
			mission.acquisitionTime = Math.max(0, mission.acquisitionTime - dt);
			if (mission.acquisitionTime === 0) { state.outcome = 'lost'; state.events.push('defeat'); return; }
		}
		if (mission.stage === 'active' && mission.progress >= mission.required && (mission.contract.kind !== 'defend' || state.spawned === quota && state.warnings.length === 0)) {
			mission.stage = 'extract'; mission.extractTime = 0;
			burst(state, mission.map.extraction, 180, '#93e9e1'); state.events.push('objective-complete');
		}
		if (mission.stage === 'extract') {
			const playerAtPickup = distance(p, mission.map.extraction) <= EXTRACTION_RADIUS;
			const occupied = playerAtPickup || alliesInZone(mission.map.extraction, EXTRACTION_RADIUS);
			mission.extractTime = occupied ? Math.min(EXTRACTION_SECONDS, mission.extractTime + dt) : 0;
			if (mission.extractTime >= EXTRACTION_SECONDS - 1e-9) {
				mission.extractTime = EXTRACTION_SECONDS;
				if (playerAtPickup) { state.outcome = 'won'; state.events.push('victory'); }
			}
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
	squadmatesStep(state, dt);
	spawningStep(state, dt);
	enemiesStep(state, dt);
	artilleryStep(state, dt);
	projectilesStep(state, dt);
	deathsStep(state);
	effectsStep(state, dt);
	outcomeStep(state, dt);
};
