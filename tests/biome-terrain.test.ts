import { expect, test } from 'bun:test';
import { MISSION_KINDS } from '../src/campaign';
import type { Contract } from '../src/campaign-types';
import { EMPLACEMENT_RADIUS, ENEMY_RADIUS, isFixedEmplacement, playerVolume, RIG_RADIUS } from '../src/combat-spatial';
import { terrainPathClear, terrainPointClear, terrainShotFraction, terrainWaypoint } from '../src/field-terrain';
import { groundHeight } from '../src/terrain-elevation';
import { CAPTURE_RADIUS, EXTRACTION_RADIUS, generateMissionField, generateMissionMap, missionArtilleryCount, missionDeploymentSlot, missionHostileCount, missionSpawn } from '../src/missions';
import { SQUAD_SIZE } from '../src/pilots';
import type { Point } from '../src/simulation';
import { getPlayerMuzzle } from '../src/weapon-rig';

const worlds = ['brackwater', 'elderholt', 'galeward', 'iolith'] as const;
const contract = function (planetId: typeof worlds[number], kind: Contract['kind'], seed: number): Contract {
	return { id: 'biome-survey', planetId, kind, seed, tier: 6, employer: 'freeholds', opponent: 'combine', title: '',
		briefing: '', reward: 0, favor: 0, hostility: 0, requiredReputation: 0 };
};

test('squads can deploy and reach every objective and pickup in the four new biomes', function () {
	for (const world of worlds) for (const kind of MISSION_KINDS) for (const seed of [1740197091, 1500846699, 2563011894]) {
		const job = contract(world, kind, seed);
		const { map, garrison } = generateMissionField(job), terrain = map.terrain;
		if (!terrain) throw new Error('Missing mission terrain');
		const reachable = function (from: Point, goal: Point) {
			let at = from;
			for (let leg = 0; leg <= terrain.obstacles.length * 4; leg++) {
				if (terrainPathClear(terrain, at, goal, RIG_RADIUS)) return true;
				const next = terrainWaypoint(terrain, at, goal, RIG_RADIUS);
				if (next === at || !terrainPathClear(terrain, at, next, RIG_RADIUS)
					|| next.x < 35 || next.x > map.width - 35 || next.y < 35 || next.y > map.height - 35) return false;
				at = next;
			}
			return false;
		};
		for (const road of terrain.roads) expect(road.every(function (point, i) {
			const prev = road[i - 1]; return !prev || terrainPathClear(terrain, prev, point, 45);
		})).toBe(true);
		if (kind === 'defend' && (world === 'brackwater' || world === 'elderholt')) {
			expect(terrain.obstacles.some(function (o) {
				return o.kind === 'shed' && Math.hypot(o.x - map.objective.x, o.y - map.objective.y) < 350;
			})).toBe(true);
			expect(terrain.roads.filter(function (road) {
				const end = road.at(-1); return end?.x === map.objective.x && end.y === map.objective.y;
			}).length).toBeGreaterThanOrEqual(3);
		}
		if (world === 'iolith') {
			const outcrops = terrain.obstacles.filter(function (o) { return o.kind === 'crystal'; });
			expect(outcrops.some(function (o) { return Math.max(o.width, o.depth) < 1.5 * Math.min(o.width, o.depth); })).toBe(true);
			const fieldSpan = Math.min(map.width, map.height);
			expect(outcrops.every(function (o) { return Math.max(o.width, o.depth) < fieldSpan / 10; })).toBe(true);
		}
		if (world === 'galeward') {
			const heavyCover = terrain.obstacles.some(function (base) {
				if (base.kind !== 'turbine') return false;
				const shooter = { x: base.x - base.width / 2 - 220, y: base.y, angle: 0 };
				const target = playerVolume({ x: base.x + base.width / 2 + RIG_RADIUS, y: base.y }, 'maul');
				const muzzle = getPlayerMuzzle('maul', 0, shooter, 0, 0, target);
				return terrainShotFraction({ roads: [], obstacles: [base] }, muzzle, target) !== undefined;
			});
			expect(heavyCover).toBe(true);
		}
		for (const site of map.sites) {
			expect(terrainPointClear(terrain, site, CAPTURE_RADIUS + RIG_RADIUS)).toBe(true);
			expect(reachable(map.drop, site)).toBe(true);
		}
		expect(terrainPointClear(terrain, map.extraction, EXTRACTION_RADIUS + RIG_RADIUS)).toBe(true);
		expect(reachable(map.objective, map.extraction)).toBe(true);
		for (let i = 0; i < SQUAD_SIZE - 1; i++) {
			expect(terrainPathClear(terrain, missionDeploymentSlot(map, i), map.drop, RIG_RADIUS)).toBe(true);
		}
		// Defenders arrive in waves. Inspect the field's actual posted roster on offensive drops.
		const spawns = kind === 'defend' ? Array.from({ length: missionHostileCount(job) }, function (_, i) {
			return missionSpawn(job, map, i);
		}) : garrison;
		expect(spawns).toHaveLength(missionHostileCount(job));
		const guns = spawns.filter(function (spawn) { return isFixedEmplacement(spawn.kind); });
		expect(guns.filter(function (spawn) { return spawn.kind === 'artillery'; })).toHaveLength(missionArtilleryCount(job));
		for (const gun of guns) {
			const base = groundHeight(terrain, gun);
			for (const dx of [-EMPLACEMENT_RADIUS, EMPLACEMENT_RADIUS]) for (const dy of [-EMPLACEMENT_RADIUS, EMPLACEMENT_RADIUS]) {
				expect(groundHeight(terrain, { x: gun.x + dx, y: gun.y + dy })).toBeCloseTo(base, 3);
			}
		}
		for (const spawn of spawns) expect(terrainPointClear(terrain, spawn,
			isFixedEmplacement(spawn.kind) ? EMPLACEMENT_RADIUS : spawn.frameId ? RIG_RADIUS : ENEMY_RADIUS)).toBe(true);
	}
});

test('water blocks rigs while allowing shots across, and local cover shelters a rig in each biome', function () {
	for (const world of worlds) {
		const { terrain } = generateMissionMap(contract(world, 'recovery', 283191706));
		if (!terrain) throw new Error('Missing mission terrain');
		const cover = { brackwater: 'shed', elderholt: 'tree', galeward: 'turbine', iolith: 'crystal' } as const;
		const kinds = world === 'brackwater' ? ['channel', cover[world]] : [cover[world]];
		for (const kind of kinds) {
			const obstacle = terrain.obstacles.find(function (o) { return o.kind === kind && (o.kind !== 'tree' || o.height > 50); });
			if (!obstacle) throw new Error(`Missing ${kind} on ${world}`);
			const from = { x: obstacle.x - obstacle.width / 2 - 3, y: obstacle.y,
				elevation: groundHeight(terrain, obstacle) + (kind === 'channel' ? 0 : 32) };
			const to = { ...from, x: obstacle.x + obstacle.width / 2 + 3 };
			expect(terrainPathClear(terrain, from, to, RIG_RADIUS)).toBe(false);
			expect(terrainShotFraction(terrain, from, to) === undefined).toBe(kind === 'channel');
		}
	}
});
