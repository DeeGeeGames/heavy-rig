import { FIRST_RIG_TIER, firstHeavyRigTier, getContractTier, missionTierPressure, usesLegacyMissionTiers } from './reputation';
import { getPlanet, mixSeed, randomSource } from './universe';
import { WEAPON_MODELS, weaponIdForTier, type WeaponId } from './arsenal';
import { hasTerrainRoute, terrainPathClear, terrainPointClear, type MissionCompound, type ObstacleField, type TerrainObstacle } from './field-terrain';
import { EMPLACEMENT_RADIUS, ENEMY_RADIUS, isFixedEmplacement, RIG_RADIUS } from './combat-spatial';
import { SILO_TRIGGER_RADIUS } from './silo-turret';
import { SQUAD_SIZE } from './pilots';
import { isAuthoredContract } from './contract-chains';
import { PLAYABLE_FRAMES, type FrameId } from './frames';
import { createBiomeLayout, type TerrainMap } from './biome-layout';
import { defenseLandingFootings, extendDefenseField } from './defense-layout';
import { compoundFor } from './mission-compounds';
import { objectiveSitePlan, placeObjectiveSite } from './objective-sites';
import { generateElevation } from './mission-elevation';
import { landingFootprint } from './landing-site';
import { hasLevelFoundation, type TerrainElevation } from './terrain-elevation';
import type { Contract, Landmark, MissionMap, MissionRuntime, MissionStructure } from './campaign-types';
import type { EnemyKind, Point, CombatStateView, PresetEnemyKind } from './simulation';

export const EXTRACTION_RADIUS = 150;
export const EXTRACTION_SECONDS = 3;
export const FACILITY_RADIUS = 65;
export const FACILITY_TARGET_ID = -1;
export const CAPTURE_RADIUS = 100;
export const RECOVERY_SECONDS = 5;
export const BEACON_SECONDS = 3;
export const ACQUISITION_SECONDS = 240;

// Negative identities never collide with enemy IDs; demolition keeps its old ID.
export const missionStructures = function (mission: MissionRuntime | undefined): { id: number; body: MissionStructure }[] {
	return [
		...(mission?.structure ? [{ id: FACILITY_TARGET_ID, body: mission.structure }] : []),
		...(mission?.raidTargets ?? []).map(function (body, index) { return { id: -2 - index, body }; }),
	];
};

export const isPriorityTarget = function (state: CombatStateView, enemy: { id: number; commander?: boolean }): boolean {
	return Boolean(enemy.commander) || state.mission?.targetId === enemy.id;
};
export const commandTargetName = function (contract: Contract): 'command vehicle' | 'command rig' {
	return contract.tier < FIRST_RIG_TIER && !usesLegacyMissionTiers(contract) ? 'command vehicle' : 'command rig';
};

const separation = function (a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); };
const hasMultipleSites = function (kind: Contract['kind']) {
	return kind === 'clearance' || kind === 'raid' || kind === 'acquisition';
};

export const squadDestination = function (anchor: Point, heading: number, index: number, back: number, spread: number): Point {
	const side = index === 0 ? -spread : index === 1 ? spread : 0;
	const trail = index === 2 ? back + spread : back;
	return { x: anchor.x - Math.cos(heading) * trail - Math.sin(heading) * side, y: anchor.y - Math.sin(heading) * trail + Math.cos(heading) * side };
};
export const missionDeploymentSlot = function (map: MissionMap, index: number): Point {
	const heading = Math.atan2(map.objective.y - map.drop.y, map.objective.x - map.drop.x);
	return squadDestination(map.drop, heading, index, 80, 95);
};

type MobileEnemyKind = Exclude<PresetEnemyKind, 'artillery'>;
type UnassignedSpawn = { commander?: never; frameId?: never; formation?: never };
export type MissionSpawn = Point & (
	{ kind: MobileEnemyKind; commander?: boolean; frameId?: FrameId; formation?: number; siloWeapon?: never }
	| UnassignedSpawn & { kind: PresetEnemyKind; siloWeapon?: never }
	| UnassignedSpawn & { kind: 'silo-turret'; siloWeapon: WeaponId }
);
const mobileHostileCount = function (contract: Contract): number {
	const level = getContractTier(contract);
	const roster = contract.kind === 'defend' || contract.kind === 'clearance' ? level.assault : level.patrol;
	// Fortified garrisons already reserve one slot for fixed defenses, two
	// from Heavy tier up. The independent gun roll keeps their mobile strength.
	const reserved = artilleryPosting(contract) ? (contract.tier >= firstHeavyRigTier(contract) ? 2 : 1) : 0;
	return roster - reserved;
};
const legacyFormations: Readonly<Partial<Record<Contract['tier'], readonly MobileEnemyKind[]>>> = {
	1: ['scout', 'scout', 'helicopter'],
	2: ['scout', 'striker', 'helicopter'],
	3: ['striker', 'scout', 'tank', 'striker', 'scout', 'helicopter'],
	4: ['striker', 'siege', 'tank', 'scout', 'striker', 'vtol'],
	5: ['siege', 'striker', 'tank', 'striker', 'siege', 'vtol'],
	6: ['siege', 'striker', 'vtol', 'siege', 'scout', 'tank'],
};
// Sections deploy in groups of up to three. Start the roster with its new
// threat so even the smallest fortified garrison fields it.
const formations: Readonly<Record<Contract['tier'], readonly MobileEnemyKind[]>> = {
	1: ['helicopter'],
	2: ['tank', 'helicopter', 'helicopter'],
	3: ['scout', 'scout', 'helicopter', 'scout', 'helicopter', 'helicopter'],
	4: ['scout', 'tank', 'helicopter', 'scout', 'scout', 'tank'],
	5: ['striker', 'scout', 'tank', 'scout', 'striker', 'helicopter'],
	6: ['striker', 'striker', 'tank', 'striker', 'scout', 'tank'],
	7: ['siege', 'striker', 'tank', 'scout', 'striker', 'vtol'],
	8: ['siege', 'striker', 'vtol', 'siege', 'scout', 'tank'],
	9: ['siege', 'striker', 'tank', 'siege', 'striker', 'vtol'],
	10: ['siege', 'striker', 'vtol', 'siege', 'scout', 'tank'],
};
const mobileRosterKind = function (contract: Contract, index: number): MobileEnemyKind {
	const roster = (usesLegacyMissionTiers(contract) ? legacyFormations[contract.tier] : undefined) ?? formations[contract.tier];
	return roster[index % roster.length] ?? 'helicopter';
};
export const defenseFieldsTanks = function (contract: Contract): boolean {
	if (contract.kind !== 'defend') return false;
	const count = mobileHostileCount(contract);
	for (let index = 0; index < count; index++) {
		if (mobileRosterKind(contract, index) === 'tank') return true;
	}
	return false;
};
const catalogFrame = function (contract: Contract, role: EnemyKind, random: () => number): FrameId | undefined {
	if (role !== 'scout' && role !== 'striker' && role !== 'siege') return undefined;
	const firstVariant = usesLegacyMissionTiers(contract) ? 2 : 4;
	const firstHeavy = firstHeavyRigTier(contract);
	const eligible = PLAYABLE_FRAMES.filter(function (frame) {
		return (contract.tier >= firstVariant || frame.variant === 'A') && (contract.tier >= firstHeavy || frame.mass < 95);
	});
	const preferred = eligible.filter(function (frame) {
		return role === (frame.mass < 50 ? 'scout' : frame.mass >= 95 ? 'siege' : 'striker');
	});
	const pool = preferred.length ? preferred : eligible;
	return pool[Math.floor(random() * pool.length)]?.id;
};
const hasBuiltGarrison = function (map: MissionMap) {
	return map.terrain?.site?.kind === 'garrison' || Boolean(map.terrain?.compounds?.length);
};
const mobileSpawn = function (contract: Contract, map: MissionMap, index: number, navigation: ObstacleField | undefined = map.terrain): MissionSpawn {
	const random = randomSource((contract.seed + Math.imul(index + 1, 104729)) >>> 0);
	const commander = contract.kind === 'assassination' && index === 0;
	const authored = isAuthoredContract(contract);
	const legacy = usesLegacyMissionTiers(contract);
	const formation = Math.floor(index / 3);
	const siteIndex = authored ? index : formation + (index % 3 === 1 ? 1 : 0);
	const site = hasMultipleSites(contract.kind) ? map.sites[siteIndex % map.sites.length] ?? map.objective : map.objective;
	const wingOffsets = [0, 0.65, -0.26];
	const angle = (authored ? index * 2.399963 : formation * 2.399963 + (wingOffsets[index % 3] ?? 0)) + random() * (authored ? .6 : .16);
	const radius = commander ? 0 : contract.kind === 'defend' ? 760 + random() * 160 + (!authored && index % 3 === 2 ? 90 : 0) : 180 + random() * 250;
	const commandKind = commandTargetName(contract) === 'command vehicle' ? (contract.tier === 1 ? 'helicopter' : 'tank')
		: contract.tier >= firstHeavyRigTier(contract) ? 'siege' : contract.tier <= (legacy ? 1 : 4) ? 'scout' : 'striker';
	const kind = commander ? commandKind : mobileRosterKind(contract, index);
	const frameId = authored ? undefined : catalogFrame(contract, kind, random);
	const staging = contract.kind === 'defend' ? map.defenseApproach?.staging : undefined;
	if (staging) {
		const pad = staging[formation % 2 === 0 ? 0 : 1];
		if (frameId) return { ...pad, kind, frameId, formation };
		const entryBearing = Math.atan2(pad.y - site.y, pad.x - site.x) + (wingOffsets[index % 3] ?? 0) * .48;
		const range = separation(site, pad);
		return { x: site.x + Math.cos(entryBearing) * range, y: site.y + Math.sin(entryBearing) * range, kind, formation };
	}
	const atBearing = function (bearing: number): Point {
		return { x: Math.max(100, Math.min(map.width - 100, site.x + Math.cos(bearing) * radius)),
			y: Math.max(100, Math.min(map.height - 100, site.y + Math.sin(bearing) * radius)) };
	};
	let at = atBearing(angle);
	// Everyone posted in a built-up site needs room to reach the rig lanes.
	const clearance = frameId || map.terrain?.site || map.terrain?.compounds?.length ? RIG_RADIUS : ENEMY_RADIUS;
	const clear = function (candidate: Point) {
		return !navigation || terrainPointClear(navigation, candidate, clearance)
			&& (!hasBuiltGarrison(map) || hasTerrainRoute(navigation, candidate, site, RIG_RADIUS));
	};
	if (!commander && !clear(at)) {
		// Try nearby points on the spawn ring, then both axes. Every site
		// has an open bearing leading away from the cut on its own bank.
		for (const bearing of [angle + .5, angle - .5, angle + 1, angle - 1, angle + 1.5, angle - 1.5, 0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
			const candidate = atBearing(bearing);
			if (clear(candidate)) { at = candidate; break; }
		}
	}
	return { ...at, kind, ...(commander ? { commander: true } : {}), ...(frameId ? { frameId } : {}), ...(!authored ? { formation } : {}) };
};

const artilleryPosting = function (contract: Contract) {
	if (isAuthoredContract(contract)) return undefined;
	switch (contract.kind) {
		case 'demolition': return 'on the facility perimeter';
		case 'raid': return 'at the supply installations';
		case 'clearance': return 'on the approaches to the occupied sites';
		default: return undefined;
	}
};
const hasSiloPosting = function (contract: Contract) {
	return (contract.kind === 'demolition' || contract.kind === 'raid')
		&& !isAuthoredContract(contract) && !usesLegacyMissionTiers(contract);
};
export const missionArtilleryCount = function (contract: Contract, map?: MissionMap): number {
	if (!artilleryPosting(contract)) return 0;
	const roll = randomSource(mixSeed(contract.seed, 0x47554e53));
	const minimum = 1 + Math.floor(missionTierPressure(contract));
	const count = minimum + Math.floor(roll() * (minimum + 1));
	return map ? placeArtillery(contract, map, mobileSpawns(contract, map), count).length : count;
};
export const missionHostileCount = function (contract: Contract, map?: MissionMap) {
	// Indexed deployment needs the actual final slot, even on a generated field too crowded for a silo.
	if (hasSiloPosting(contract)) return generateMissionField(contract, map).garrison.length;
	return mobileHostileCount(contract) + missionArtilleryCount(contract, map);
};
export const missionOpposition = function (contract: Contract, map?: MissionMap) {
	const mobile = getContractTier(contract).opposition;
	const posting = artilleryPosting(contract);
	const siloPosting = hasSiloPosting(contract);
	const surveyed = siloPosting && map ? missionGarrison(contract, map) : undefined;
	const guns = surveyed ? surveyed.filter(function (spawn) { return spawn.kind === 'artillery'; }).length : missionArtilleryCount(contract, map);
	const silo = surveyed ? surveyed.some(function (spawn) { return spawn.kind === 'silo-turret'; }) : siloPosting;
	const garrison = posting ? ` ${guns} fixed artillery ${guns === 1 ? 'gun' : 'guns'} ${posting}.` : '';
	const siloBriefing = silo ? ` A concealed silo turret ${map ? 'guards' : 'may guard'} the objective.` : '';
	return `${silo && !map ? 'Up to ' : ''}${mobileHostileCount(contract) + guns + Number(silo)} hostiles. ${mobile}${garrison}${siloBriefing}`;
};
const roadsClear = function (footprint: ObstacleField, roads: readonly (readonly Point[])[]) {
	return roads.every(function (road) {
		return road.every(function (point, i) { const prev = road[i - 1]; return !prev || terrainPathClear(footprint, prev, point, 45); });
	});
};
const mobileSpawns = function (contract: Contract, map: MissionMap, navigation: ObstacleField | undefined = map.terrain) {
	return Array.from({ length: mobileHostileCount(contract) }, function (_, i) { return mobileSpawn(contract, map, i, navigation); });
};
const defendedSites = function (contract: Contract, map: MissionMap) {
	return contract.kind === 'demolition' || !map.sites.length ? [map.objective] : map.sites;
};
const emplacementSearch = function (map: MissionMap, sites: readonly Point[], guards: readonly MissionSpawn[], guns: readonly Point[],
	accepts?: (at: Point) => boolean) {
	const clear = function (at: Point, site: Point, allowDetour: boolean) {
		if (at.x < 100 || at.y < 100 || at.x > map.width - 100 || at.y > map.height - 100
			|| separation(at, map.drop) <= 300 || separation(at, map.extraction) <= EXTRACTION_RADIUS + EMPLACEMENT_RADIUS) return false;
		const range = separation(at, site);
		if (sites.some(function (other) { return other !== site && separation(at, other) < range; })
			|| map.landmarks.some(function (p) { return separation(at, p) < p.radius + EMPLACEMENT_RADIUS; })) return false;
		const pad = { obstacles: [landingFootprint(at, EMPLACEMENT_RADIUS)] };
		if (!terrainPointClear(pad, site, CAPTURE_RADIUS)
			|| guns.some(function (gun) { return !terrainPointClear(pad, gun, EMPLACEMENT_RADIUS + 2 * RIG_RADIUS); })
			|| guards.some(function (guard) { return !terrainPointClear(pad, guard, guard.frameId || hasBuiltGarrison(map) ? RIG_RADIUS : ENEMY_RADIUS); })) return false;
		const terrain = map.terrain;
		if (!terrain) return true;
		if (!terrainPointClear(terrain, at, EMPLACEMENT_RADIUS) || !roadsClear(pad, terrain.roads)
			|| !hasLevelFoundation(terrain, at, EMPLACEMENT_RADIUS)) return false;
		if (terrainPathClear(terrain, site, at, RIG_RADIUS)) return true;
		// A local service route can bend around cover. Both legs stay inside
		// the field, including on supplied maps with a barrier spanning an edge.
		if (!allowDetour) return false;
		if ([{ x: site.x, y: at.y }, { x: at.x, y: site.y }].some(function (bend) {
			return terrainPathClear(terrain, site, bend, RIG_RADIUS) && terrainPathClear(terrain, bend, at, RIG_RADIUS);
		})) return true;
		// The service gate may take several turns behind the hangar.
		return hasBuiltGarrison(map) && hasTerrainRoute(terrain, at, site, RIG_RADIUS);
	};
	return function (site: Point, bearing: number, radius: number) {
		// Try the assigned shoulder first. Search nearby bearings on both sides
		// when a road, another foundation, or terrain occupies the intended post.
		const nearby = [radius, radius + 90, radius - 55, radius + 180];
		const outer = [...nearby, radius + 270, radius + 360];
		for (const allowDetour of [false, true]) for (let i = 0; i < 32; i++) {
			const angle = bearing + Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 16;
			for (const r of allowDetour ? outer : nearby) {
				const at = { x: site.x + r * Math.cos(angle), y: site.y + r * Math.sin(angle) };
				if ((!accepts || accepts(at)) && clear(at, site, allowDetour)) return at;
			}
		}
		return undefined;
	};
};
const placeArtillery = function (contract: Contract, map: MissionMap, guards: readonly MissionSpawn[], count: number): Point[] {
	if (!count) return [];
	const random = randomSource(mixSeed(contract.seed, 0x41525459));
	const sites = defendedSites(contract, map);
	const first = Math.floor(random() * sites.length);
	const guns: Point[] = [];
	const findPost = emplacementSearch(map, sites, guards, guns);
	for (const [index, site] of [...sites.slice(first), ...sites.slice(0, first)].entries()) {
		const quota = Math.floor(count / sites.length) + Number(index < count % sites.length);
		const road = map.terrain?.roads.find(function (lane) { const end = lane.at(-1); return end && separation(end, site) < 1; });
		const from = road?.at(-2) ?? map.drop;
		const approach = Math.atan2(from.y - site.y, from.x - site.x);
		const phase = (random() - .5) * .28, shoulder = random() < .5 ? -1 : 1;
		for (let slot = 0; slot < quota; slot++) {
			const radius = 210 + random() * 48 + (contract.kind === 'demolition' ? 55 : 95 * Math.floor(slot / 2));
			const flank = (slot % 2 ? -shoulder : shoulder) * (.76 + .14 * Math.floor(slot / 2));
			const offset = contract.kind === 'demolition' ? Math.PI / 4 + slot * 2 * Math.PI / quota
				: contract.kind === 'raid' ? Math.PI + flank : flank;
			const gun = findPost(site, approach + phase + offset, radius);
			if (gun) guns.push(gun);
		}
	}
	return guns;
};
const placeSilo = function (contract: Contract, map: MissionMap, guards: readonly MissionSpawn[], guns: readonly Point[]): MissionSpawn | undefined {
	if (!hasSiloPosting(contract)) return undefined;
	const random = randomSource(mixSeed(contract.seed, 0x53494c4f));
	const model = WEAPON_MODELS[Math.floor(random() * WEAPON_MODELS.length)];
	if (!model) throw new RangeError('Missing silo weapon model');
	const sites = defendedSites(contract, map);
	const first = Math.floor(random() * sites.length);
	const squad = [map.drop, ...Array.from({ length: SQUAD_SIZE - 1 }, function (_, index) { return missionDeploymentSlot(map, index); })];
	const approaches = [...sites, ...map.terrain?.roads.flat() ?? []];
	const findPost = emplacementSearch(map, sites, guards, guns, function (at) {
		// Keep the squad clear through touchdown and leave a rig-wide passage around the new foundation.
		return approaches.some(function (point) { return separation(at, point) < SILO_TRIGGER_RADIUS; })
			&& squad.every(function (rig) { return separation(at, rig) > SILO_TRIGGER_RADIUS; })
			&& (!map.terrain || terrainPointClear(map.terrain, at, EMPLACEMENT_RADIUS + 2 * RIG_RADIUS));
	});
	for (const site of [...sites.slice(first), ...sites.slice(0, first)]) {
		const approach = Math.atan2(map.drop.y - site.y, map.drop.x - site.x);
		const at = findPost(site, approach + (random() < .5 ? -.8 : .8), 190 + random() * 65);
		if (at) return { ...at, kind: 'silo-turret', siloWeapon: weaponIdForTier(model.modelId, getContractTier(contract).weaponTier) };
	}
	return undefined;
};
const missionGarrison = function (contract: Contract, map: MissionMap): MissionSpawn[] {
	if (contract.kind === 'defend') return [];
	const guards = mobileSpawns(contract, map);
	const guns = placeArtillery(contract, map, guards, missionArtilleryCount(contract));
	// A gun foundation can close a passage between otherwise reachable buildings.
	const posted = guns.length && map.terrain && hasBuiltGarrison(map) ? mobileSpawns(contract, map,
		{ obstacles: [...map.terrain.obstacles, ...guns.map(function (p) { return landingFootprint(p, EMPLACEMENT_RADIUS); })] }) : guards;
	const silo = placeSilo(contract, map, posted, guns);
	return [...posted, ...guns.map(function (at): MissionSpawn { return { ...at, kind: 'artillery' }; }), ...(silo ? [silo] : [])];
};
export const missionSpawn = function (contract: Contract, map: MissionMap, index: number): MissionSpawn {
	if ((contract.kind === 'defend' || !hasBuiltGarrison(map)) && Number.isInteger(index) && index >= 0 && index < mobileHostileCount(contract)) return mobileSpawn(contract, map, index);
	const spawn = missionGarrison(contract, map)[index];
	if (spawn) return spawn;
	throw new RangeError(`No hostile at deployment slot ${index} on this field`);
};

const placeCompounds = function (contract: Contract, map: TerrainMap, obstacles: TerrainObstacle[],
	fits: (candidate: TerrainObstacle, occupied: readonly TerrainObstacle[]) => boolean) {
	const compounds: MissionCompound[] = [];
	for (const [siteIndex, site] of map.sites.entries()) {
		const plan = compoundFor(contract, map.biome, siteIndex);
		if (!plan) continue;
		// Turn the complete yard first. Keep as much of its designed arrangement
		// as this road junction, extraction zone and garrison allow.
		let best: TerrainObstacle[] = [];
		for (let orientation = 0; orientation < 8 && best.length < plan.buildings.length; orientation++) {
			const swap = orientation >= 4, east = orientation % 4 < 2 ? 1 : -1, south = orientation % 2 === 0 ? 1 : -1;
			const buildings: TerrainObstacle[] = [];
			for (const blueprint of plan.buildings) {
				const x = site.x + east * (swap ? blueprint.y : blueprint.x), y = site.y + south * (swap ? blueprint.x : blueprint.y);
				const width = swap ? blueprint.depth : blueprint.width, depth = swap ? blueprint.width : blueprint.depth;
				const building = { ...blueprint, x, y, width, depth };
				if (Math.min(x - width / 2, map.width - x - width / 2,
					y - depth / 2, map.height - y - depth / 2) >= 60 && fits(building, [...obstacles, ...buildings])) buildings.push(building);
			}
			if (buildings.length > best.length) best = buildings;
		}
		if (best.length) {
			obstacles.push(...best);
			compounds.push({ name: plan.name, siteIndex, buildings: best });
		}
	}
	return compounds;
};

const missionCover = function (contract: Contract, map: TerrainMap, lanes = map.terrain.roads) {
	const obstacles = [...map.terrain.obstacles];
	const slots = Array.from({ length: SQUAD_SIZE - 1 }, function (_, index) { return missionDeploymentSlot(map, index); });
	const guards = mobileSpawns(contract, map);

	// Keep a rig-sized passage between pieces of cover; reserve deployment,
	// capture and extraction circles, patrols and the full width of each road.
	const fits = function (candidate: TerrainObstacle, occupied: readonly TerrainObstacle[]) {
		const footprint = { obstacles: [candidate] };
		const footing = occupied.every(function (other) {
			return Math.abs(other.x - candidate.x) > (other.width + candidate.width) / 2 + 60
				|| Math.abs(other.y - candidate.y) > (other.depth + candidate.depth) / 2 + 60;
		});
		return footing && terrainPointClear(footprint, map.drop, 138)
			&& terrainPointClear(footprint, map.extraction, EXTRACTION_RADIUS + RIG_RADIUS)
			&& map.sites.every(function (site) { return terrainPointClear(footprint, site, 140); })
			&& guards.every(function (guard) { return terrainPointClear(footprint, guard, guard.frameId ? RIG_RADIUS : ENEMY_RADIUS); })
			&& slots.every(function (slot) { return terrainPathClear(footprint, slot, map.drop, RIG_RADIUS); })
			&& roadsClear(footprint, lanes);
	};
	const addCover = function (candidate: TerrainObstacle) {
		if (fits(candidate, obstacles)) obstacles.push(candidate);
	};

	const compounds = placeCompounds(contract, map, obstacles, fits);
	return { obstacles, addCover, compounds };
};

const surveyElevation = function (contract: Contract, map: TerrainMap, garrison: readonly MissionSpawn[]) {
	const slots = Array.from({ length: SQUAD_SIZE - 1 }, function (_, i) { return missionDeploymentSlot(map, i); });
	const guards = [], emplacements = [];
	for (const spawn of garrison) {
		const fixed = isFixedEmplacement(spawn.kind);
		const footprint = landingFootprint(spawn, fixed ? EMPLACEMENT_RADIUS : spawn.frameId ? RIG_RADIUS : ENEMY_RADIUS);
		guards.push(footprint);
		if (fixed) emplacements.push(footprint);
	}
	const siteRadius = contract.kind === 'defend' ? 68 : contract.kind === 'demolition' || contract.kind === 'raid' ? FACILITY_RADIUS
		: contract.kind === 'acquisition' || contract.kind === 'recovery' ? 24 : 0;
	const sites = siteRadius ? map.sites.map(function (p) { return landingFootprint(p, siteRadius); }) : [];
	return generateElevation(map, map.terrain.obstacles, [map.drop, ...slots], [...guards, ...sites], [...emplacements, ...defenseLandingFootings(map)]);
};

const finishMissionField = function (contract: Contract, base: TerrainMap, obstacles: readonly TerrainObstacle[], random: () => number, compounds: readonly MissionCompound[]) {
	const built = { ...base, terrain: { ...base.terrain, obstacles, ...(compounds.length ? { compounds } : {}) } };
	const map = contract.kind === 'defend' && contract.fieldLayout === 'extended-defense' ? extendDefenseField(built) : built;
	const terrain = map.terrain;
	const landmarkField = terrain.site ? { obstacles: [...terrain.obstacles, terrain.site] } : terrain;
	const landmarks: Landmark[] = [];
	const garrison = missionGarrison(contract, { ...map, terrain });
	const guns = garrison.filter(function (spawn) { return isFixedEmplacement(spawn.kind); });
	const reserved = [map.drop, map.extraction, ...map.sites];
	const between = function (min: number, max: number) { return Math.round(min + random() * (max - min)); };
	for (let i = 0; i < 180 && landmarks.length < 56; i++) {
		const at = { x: between(160, map.width - 160), y: between(160, map.height - 160) };
		const radius = between(35, 135);
		if (reserved.some(function (site) { return separation(at, site) < radius + 155; })
			|| guns.some(function (gun) { return separation(at, gun) < radius + EMPLACEMENT_RADIUS; })
			|| !terrainPointClear(landmarkField, at, radius)) continue;
		landmarks.push({ ...at, radius, rotation: random() * Math.PI * 2, kind: i % 7 === 0 ? 'depot' : i % 3 === 0 ? 'crater' : 'rocks' });
	}
	// Board and survey callers can inspect the same map without constructing a
	// height mesh. Every consumer of a deployed field shares the first survey.
	const field = { ...map, landmarks, terrain };
	let elevation: TerrainElevation | undefined;
	return { map: { ...field, terrain: { ...terrain, get elevation() { return elevation ??= surveyElevation(contract, field, garrison); } } }, garrison };
};

export const generateMissionField = function (contract: Contract, suppliedMap?: MissionMap): { map: MissionMap; garrison: MissionSpawn[] } {
	if (suppliedMap) return { map: suppliedMap, garrison: missionGarrison(contract, suppliedMap) };
	const dimensions = randomSource(contract.seed);
	const width = 4200 + Math.floor(dimensions() * 3) * 300;
	const height = Math.round((3000 + Math.floor(dimensions() * 3) * 300) * 1.15);
	const biome = getPlanet(contract.planetId).biome;
	const random = randomSource(Math.imul(contract.seed, 0x9e3779b1) + 0x43494e44);
	const between = function (min: number, max: number) { return Math.round(min + random() * (max - min)); };
	if (biome !== 'badlands' && biome !== 'volcanic' && biome !== 'tundra') {
		const { map, cover } = createBiomeLayout(biome, contract, width, height, hasMultipleSites(contract.kind), between);
		const { obstacles, addCover, compounds } = missionCover(contract, map);
		for (const feature of cover) addCover(feature);
		return finishMissionField(contract, map, obstacles, random, compounds);
	}
	// Shared Cinder Recovery seeds retain the survey orientation from the trial.
	const eastWestCut = (contract.planetId !== 'cinder' || contract.kind !== 'recovery') && dimensions() < .5;
	const acrossSpan = eastWestCut ? height : width;
	const alongSpan = eastWestCut ? width : height;
	const across = random() < .5 ? -1 : 1;
	const along = random() < .5 ? -1 : 1;
	const surveyOrigin = acrossSpan / 2 + between(-220, 220);
	const back = between(alongSpan * .34, alongSpan * .40);
	const alongOrigin = along === 1 ? back : alongSpan - back;
	const approach = between(335, 410); const departure = between(940, 1190);
	const flank = between(455, 610);
	const approachOffset = between(-32, 24), siteOffset = between(-55, 45);
	const defense = contract.kind === 'defend';
	const plan = objectiveSitePlan(contract);
	// Start the district beyond the crossing, then reserve its full depth on
	// that bank even when the seed turns the cut across the shorter map axis.
	const frontage = 250 + (defense ? 0 : departure - 940);
	const bankDepth = plan ? frontage + plan.bounds.width + 160 : 0;
	const acrossOrigin = across === 1 ? Math.min(surveyOrigin, acrossSpan - bankDepth) : Math.max(surveyOrigin, bankDepth);
	const siteX = plan ? frontage - plan.bounds.west : defense ? 760 : departure;
	const siteY = defense ? 20 : siteOffset + (contract.kind === 'assassination' ? -245 : contract.kind === 'demolition' ? 195 : 0);
	const point = function (acrossCut: number, alongCut: number): Point {
		const acrossPosition = acrossOrigin + across * acrossCut;
		const alongPosition = alongOrigin + along * alongCut;
		return eastWestCut ? { x: alongPosition, y: acrossPosition } : { x: acrossPosition, y: alongPosition };
	};
	const footprintSize = function (acrossWidth: number, alongDepth: number) {
		return eastWestCut ? { width: alongDepth, depth: acrossWidth } : { width: acrossWidth, depth: alongDepth };
	};

	// Build both approaches in coordinates relative to their main crossing.
	// The flared entries and level crossings remain open as the cut moves.
	const approachStart = point(-approach, approachOffset);
	const sitePoint = function (east: number, south: number) { return point(siteX + east, siteY + south); };
	const objective = sitePoint(0, 0);
	const layout = plan && placeObjectiveSite(plan, sitePoint, footprintSize);
	const serviceEntry = point(-approach - 85, 285);
	const serviceFork = point(-approach - 30, flank);
	const cutWidth = biome === 'badlands' ? 230 : 204;
	const pickupClearance = cutWidth / 2 + 28 + EXTRACTION_RADIUS + RIG_RADIUS;
	const servicePickup = point(Math.min(-approach + 50, -pickupClearance), flank + between(215, 290));
	const serviceBend = point(departure - 310, flank + between(35, 65));
	const mainHalf = between(115, 150); const flankHalf = between(115, 145);
	const fissure = function (start: number, end: number): TerrainObstacle {
		return { ...point(between(-28, 28), (start + end) / 2), kind: 'fissure',
			...footprintSize(between(biome === 'badlands' ? 156 : 132, cutWidth), end - start), height: 0 };
	};
	const cuts = [fissure(-back + 210, -mainHalf), fissure(mainHalf, flank - flankHalf),
		fissure(flank + flankHalf, alongSpan - back - 210)];
	const shed = function (x: number, y: number, width: number): TerrainObstacle {
		return { ...point(x, y), kind: 'shed', ...footprintSize(width, between(90, 126)), height: between(92, 112) };
	};
	const buildings = [
		shed(between(-277, -252), between(232, 256), between(125, 153)),
		shed(between(260, 331), (random() < .72 ? 1 : -1) * between(150, 172), between(180, 226)),
		shed(departure - between(470, 525), flank - between(132, 148), between(148, 220)),
		...(random() < .45 ? [shed(between(445, 555), -between(390, 490), between(120, 155))] : []),
	];

	const drop = defense ? sitePoint(-235, -430) : approachStart;
	const extraction = defense ? sitePoint(-90, flank + 295) : servicePickup;
	const multiSite = hasMultipleSites(contract.kind);
	const nearSite = point(-approach - 245, flank + 155);
	const farSite = point(departure - 385, -480);
	const sites = multiSite ? [nearSite, farSite, objective] : [objective];
	const roadStart = defense ? point(-approach, 0) : approachStart;
	const roads = [
		[roadStart, point(0, 0), ...(layout ? [point(230, 0), ...layout.avenue] : [objective])],
		[roadStart, ...(defense ? [] : [serviceEntry]), serviceFork, point(0, flank),
			...(layout ? [point(230, flank), ...layout.service] : [defense ? point(430, flank) : serviceBend, objective])],
	];
	if (defense) roads.push([drop, ...(layout?.defenseStreet ?? [objective]), extraction]);
	if (layout) roads.push(...layout.streets);
	if (multiSite) roads.push([serviceFork, nearSite], [objective, farSite]);
	const lanes = defense ? roads : [...roads, [serviceFork, extraction]];
	const map: TerrainMap = { seed: contract.seed, biome, width, height, drop, objective, extraction, sites,
		landmarks: [], terrain: layout ? { obstacles: [...cuts, ...layout.buildings], roads, site: layout.site } : { obstacles: cuts, roads } };
	const { obstacles, addCover, compounds } = missionCover(contract, map, lanes);
	const beforeApproaches = obstacles.length;
	for (const building of buildings) addCover(building);
	// Keep cover on the approaches even when objective and spawn reservations
	// displace the original shed candidates.
	for (const [x, y] of [[-450, -255], [470, -265], [450, flank + 270], [-625, 205], [800, -255]] as const) {
		if (obstacles.length - beforeApproaches >= 3) break;
		addCover(shed(x, y, 135));
	}
	if (biome === 'tundra') {
		for (const [x, y] of [[-790, 310], [-690, 430], [330, -660], [460, -740], [790, flank + 500], [920, flank + 450]] as const) {
			addCover({ ...point(x + between(-30, 30), y + between(-30, 30)), kind: 'tree', width: 36, depth: 36, height: between(58, 74) });
		}
	}
	return finishMissionField(contract, map, obstacles, random, compounds);
};
export const generateMissionMap = function (contract: Contract): MissionMap { return generateMissionField(contract).map; };

export const missionObjective = function (state: CombatStateView): string {
	const mission = state.mission;
	if (!mission) return 'Protect Relay 09';
	if (mission.stage === 'extract') {
		const range = separation(state.player, mission.map.extraction);
		if (mission.extractTime >= EXTRACTION_SECONDS) return `Extraction ready · reach pickup ${Math.round(range)} m`;
		if (mission.extractTime > 0) return range <= EXTRACTION_RADIUS
			? `Extraction ${Math.ceil(EXTRACTION_SECONDS - mission.extractTime)}s · hold the landing zone`
			: `Squad holding pickup · ${Math.round(range)} m to extraction`;
		return `Return to extraction · ${Math.round(range)} m`;
	}
	if (mission.contract.kind === 'raid') return `Destroy supply sites · ${mission.progress}/3 destroyed`;
	if (mission.contract.kind === 'recovery' || mission.contract.kind === 'acquisition') {
		const holding = mission.captureSites?.find(function (site) { return !site.complete && site.holdTime > 0; });
		const duration = mission.contract.kind === 'recovery' ? RECOVERY_SECONDS : BEACON_SECONDS;
		const action = holding ? ` · ${separation(state.player, holding) <= CAPTURE_RADIUS ? 'hold' : 'squad holding'} ${(duration - holding.holdTime).toFixed(1)}s` : ' · enter a marked zone';
		return mission.contract.kind === 'recovery' ? `Recover the data${action}`
			: (mission.acquisitionTime ?? 0) <= 0 ? 'Target acquisition failed · deadline expired'
			: `Beacons ${mission.progress}/3 · ${Math.ceil(mission.acquisitionTime ?? 0)}s remaining${action}`;
	}
	if (mission.contract.kind === 'defend') {
		if (mission.defenseArrivalRadius !== undefined) return `Reach the relay · ${Math.round(separation(state.player, mission.map.objective))} m`;
		if (mission.map.defenseApproach && state.spawned === 0) {
			const firstWave = !usesLegacyMissionTiers(mission.contract) && mission.contract.tier < FIRST_RIG_TIER ? 'first hostiles' : 'first dropship';
			return `Protect the relay · ${firstWave} in ${Math.ceil(state.spawnIn)}s`;
		}
		return `Protect the relay · ${mission.progress}/${mission.required} hostiles eliminated`;
	}
	if (mission.contract.kind === 'demolition') return `Destroy the facility · ${Math.ceil(Math.max(0, mission.structure?.hp ?? 0) / (mission.structure?.maxHp ?? 1) * 100)}% integrity`;
	if (mission.contract.kind === 'assassination') return `Hunt the marked ${commandTargetName(mission.contract)}`;
	return `Clear the three hostile sites · ${mission.progress}/${mission.required} eliminated`;
};
