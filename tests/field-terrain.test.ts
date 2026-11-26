import { expect, test } from 'bun:test';
import type { Contract } from '../src/campaign-types';
import { EMPLACEMENT_RADIUS, enemyRadius, RIG_RADIUS } from '../src/combat-spatial';
import { defaultReserves } from '../src/combat-resources';
import { createOpeningProgress, getChainStatus } from '../src/contract-chains';
import { createStarterLoadout } from '../src/hardpoints';
import { MISSION_TIERS } from '../src/reputation';
import { createFieldTrial } from '../src/field-trial';
import { moveOnTerrain, terrainPathClear, terrainShotFraction, terrainWaypoint, type FieldTerrain, type TerrainObstacle } from '../src/field-terrain';
import { groundHeight } from '../src/terrain-elevation';
import { DROPSHIP_DECK, DROPSHIP_WIDTH } from '../src/launch-berths';
import { landingFootprint } from '../src/landing-site';
import { dropRigPose, rigReleaseTime } from '../src/enemy-deployment';
import { createSituationMission } from '../src/situation-sim';
import { CAPTURE_RADIUS, EXTRACTION_RADIUS, generateMissionField, missionArtilleryCount, missionHostileCount } from '../src/missions';
import { createMissionState, distance, spawningStep, type Point, type SquadmateOptions } from '../src/simulation';

test('generated approaches remain wide enough for rigs and every actor deploys on accessible ground', function () {
	const first = createFieldTrial(283191706);
	expect(createFieldTrial(283191706).mission?.map).toEqual(first.mission?.map);
	const layouts = new Set<string>();
	for (let index = 0; index < 96; index++) {
		const state = createFieldTrial(Math.imul(index, 0x9e3779b1) >>> 0); const map = state.mission?.map;
		if (!map?.terrain) throw new Error('Missing trial terrain');
		const terrain = map.terrain;
		layouts.add(JSON.stringify(terrain.obstacles));
		for (const [i, a] of terrain.obstacles.entries()) for (const b of terrain.obstacles.slice(i + 1)) {
			expect(Math.abs(a.x - b.x) > (a.width + b.width) / 2 || Math.abs(a.y - b.y) > (a.depth + b.depth) / 2).toBe(true);
		}
		for (const start of [state.player, ...state.squadmates, ...state.enemies]) expect(terrainPathClear(terrain, start, start, 30)).toBe(true);
		expect(terrainPathClear(terrain, map.objective, map.objective, CAPTURE_RADIUS)).toBe(true);
		expect(terrainPathClear(terrain, map.extraction, map.extraction, EXTRACTION_RADIUS)).toBe(true);
		expect(terrain.roads.length).toBeGreaterThanOrEqual(2);
		for (const road of terrain.roads) {
			expect(road[0]).toEqual(map.drop); expect(road.at(-1)).toEqual(map.objective);
			for (const [i, point] of road.entries()) {
				const previous = road[i - 1];
				if (previous) expect(terrainPathClear(terrain, previous, point, 35)).toBe(true);
			}
		}
		let at = map.objective;
		for (let tick = 0; tick < 250 && distance(at, map.extraction) > 1; tick++) {
			const next = terrainWaypoint(terrain, at, map.extraction, 27);
			const scale = Math.min(1, 20 / Math.max(.001, distance(at, next)));
			at = moveOnTerrain(terrain, at, { x: at.x + (next.x - at.x) * scale, y: at.y + (next.y - at.y) * scale }, 27);
			if (at.x < 35 || at.x > map.width - 35 || at.y < 35 || at.y > map.height - 35) throw new Error('Routed outside the mission boundary');
		}
		expect(distance(at, map.extraction)).toBeLessThan(1);
	}
	expect(layouts.size).toBe(96);
});

test('a rig slides along a fissure and stops against a second bank without tunnelling', function () {
	const terrain: FieldTerrain = { roads: [], obstacles: [
		{ kind: 'fissure', x: 100, y: 100, width: 30, depth: 180, height: 0 },
		{ kind: 'fissure', x: 40, y: 155, width: 120, depth: 20, height: 0 },
	] };
	const slide = moveOnTerrain(terrain, { x: 0, y: 30 }, { x: 300, y: 100 }, 10);
	expect(slide.x).toBeCloseTo(75, 2); expect(slide.y).toBeCloseTo(100);
	const corner = moveOnTerrain(terrain, { x: 0, y: 30 }, { x: 300, y: 260 }, 10);
	expect(corner.x).toBeCloseTo(75, 2); expect(corner.y).toBeCloseTo(135, 2);
	expect(terrainShotFraction(terrain, { x: 0, y: 30, elevation: 10 }, { x: 300, y: 100, elevation: 1 })).toBeUndefined();
});

test('the built-up objectives keep distinct combat approaches through both survey orientations', function () {
	for (const [planetId, kind] of [['meridian', 'defend'], ['cinder', 'demolition']] as const) {
		const orientations = new Set<string>();
		for (const seed of [42, 473602713, 1431004281, 2060775208]) {
			const contract: Contract = { planetId, kind, seed, tier: 6, id: 'site-survey', title: '', briefing: '',
				employer: 'freeholds', opponent: 'combine', requiredReputation: 0, reward: 0, favor: 0, hostility: 0 };
			const { map, garrison } = generateMissionField(contract);
			const terrain = map.terrain;
			const front = terrain?.roads[0]?.at(-2), service = terrain?.roads[1];
			if (!terrain?.site || !front || !service) throw new Error('Expected a developed site and two approaches');
			const vertical = front.x === map.objective.x;
			orientations.add(vertical ? 'vertical' : 'horizontal');
			const site = terrain.site;
			expect([vertical ? site.depth : site.width, vertical ? site.width : site.depth])
				.toEqual(kind === 'defend' ? [1832, 1104] : [1398, 1076]);
			expect(Math.min(site.x - site.width / 2, map.width - site.x - site.width / 2,
				site.y - site.depth / 2, map.height - site.y - site.depth / 2)).toBeGreaterThan(35);
			// Every outer quarter contains architecture within the site boundary.
			for (const side of [-1, 1]) for (const end of [-1, 1]) {
				expect(terrain.obstacles.some(function (o) {
					if (o.kind !== 'housing' && o.kind !== 'shed' && o.kind !== 'hangar' && o.kind !== 'tank-bank') return false;
					const x = side * (o.x - site.x), y = end * (o.y - site.y);
					return x >= site.width / 4 && y >= site.depth / 4
						&& x + o.width / 2 <= site.width / 2 && y + o.depth / 2 <= site.depth / 2;
				})).toBe(true);
			}
			const muzzle = function (p: Point) { return { ...p, elevation: groundHeight(terrain, p) + 48 }; };
			const target = muzzle(map.objective);
			expect(terrainShotFraction(terrain, muzzle(front), target)).toBeUndefined();
			if (kind === 'defend') {
				expect(terrain.site.kind).toBe('city');
				const turn = service.at(-2);
				if (!turn) throw new Error('Missing cross street');
				expect(front.x === map.objective.x).toBe(turn.y === map.objective.y);
				expect(terrainShotFraction(terrain, muzzle(turn), target)).toBeUndefined();
				expect(terrain.obstacles.filter(function (o) { return o.kind === 'housing' && distance(o, target) < 300; }).length).toBeGreaterThan(1);
			} else {
				expect(terrain.site.kind).toBe('garrison');
				const flank = service.at(-4), gate = service.at(-2);
				if (!flank || !gate) throw new Error('Missing service road around the hangar');
				expect(terrainShotFraction(terrain, muzzle(flank), target)).toBeDefined();
				expect(terrainShotFraction(terrain, muzzle(gate), target)).toBeUndefined();
				const guns = garrison.filter(function (p) { return p.kind === 'artillery'; });
				expect(guns.length).toBe(missionArtilleryCount(contract));
				const field = { obstacles: [...terrain.obstacles, ...guns.map(function (p) { return landingFootprint(p, EMPLACEMENT_RADIUS); })] };
				for (const guard of garrison) if (guard.kind !== 'artillery') {
					expect(terrainPathClear(field, guard, guard, RIG_RADIUS)).toBe(true);
					expect(terrainWaypoint(field, guard, target, RIG_RADIUS)).not.toEqual(guard);
				}
			}
		}
		expect(orientations.size).toBe(2);
	}
});

test('campaign deployment keeps each contract role, full squad, and hostile roster on connected ground', function () {
	const loadout = createStarterLoadout('kestrel');
	const squadmates: SquadmateOptions[] = ['one', 'two', 'three'].map(function (id) {
		return { pilotId: id, callsign: id, specialty: 'skirmisher', frameId: 'kestrel', loadout, integrity: 100, reserves: defaultReserves(loadout) };
	});
	const kinds = ['defend', 'demolition', 'assassination', 'clearance', 'raid', 'recovery', 'acquisition'] as const;
	const cutDirections = new Set<string>();
	for (const planetId of ['meridian', 'cinder', 'borealis'] as const) for (const kind of kinds) {
		for (const { tier } of MISSION_TIERS) for (const salt of [0, 1, 2, 3]) {
			const seed = Math.imul(tier * 4 + salt, 0x9e3779b1) >>> 0;
			const contract: Contract = {
				id: 'campaign-terrain', seed, planetId, kind, tier, requiredReputation: 0, employer: 'accord',
				opponent: 'combine', title: '', briefing: '', reward: 0, favor: 0, hostility: 0,
			};
			const state = createMissionState(contract, { squadmates });
			const map = state.mission?.map; const terrain = map?.terrain;
			if (!map || !terrain) throw new Error('Missing campaign terrain');
			const assert = function (ok: boolean, context: string) {
				if (!ok) throw new Error(`${planetId}/${kind}/${tier}/${seed} · ${context}`);
			};
			const clearAt = function (at: Point, radius: number) {
				return at.x >= 35 + radius && at.x <= map.width - 35 - radius && at.y >= 35 + radius && at.y <= map.height - 35 - radius
					&& terrainPathClear(terrain, at, at, radius);
			};
			const reachable = function (from: Point, goal: Point, radius: number) {
				let at = from;
				for (let hop = 0; hop <= 4 * terrain.obstacles.length; hop++) {
					if (terrainPathClear(terrain, at, goal, radius)) return true;
					const next = terrainWaypoint(terrain, at, goal, radius);
					if (distance(at, next) < .01 || !clearAt(next, radius) || !terrainPathClear(terrain, at, next, radius)) return false;
					at = next;
				}
				return false;
			};
			if (kind === 'defend') {
				assert(distance(map.drop, map.objective) < 550 && state.enemies.length === 0, 'local defense deployment');
				for (let index = 0; index < missionHostileCount(contract); index++) spawningStep(state, 60);
			}
			assert(state.enemies.length === missionHostileCount(contract), 'hostile roster');
			assert(state.squadmates.length === squadmates.length, 'full squad deployed');
			assert(terrain.roads.length >= 2, 'main and alternate approaches');
			const spread = kind === 'clearance' || kind === 'raid' || kind === 'acquisition';
			assert(map.sites.length === (spread ? 3 : 1), 'site count');
			assert(map.sites.every(function (site, index) {
				return map.sites.slice(index + 1).every(function (other) { return distance(site, other) > 450; });
			}), 'distinct sites');
			for (const road of terrain.roads) {
				assert(road.every(function (at, index) {
					const prev = road[index - 1]; return !prev || terrainPathClear(terrain, prev, at, 45);
				}), 'advertised route');
			}
			for (const site of map.sites) {
				assert(clearAt(site, CAPTURE_RADIUS + RIG_RADIUS) && reachable(map.drop, site, RIG_RADIUS), 'objective access');
			}
			assert(clearAt(map.extraction, EXTRACTION_RADIUS + RIG_RADIUS) && reachable(map.objective, map.extraction, RIG_RADIUS), 'extraction access');
			for (const mate of state.squadmates) {
				assert(clearAt(mate, RIG_RADIUS) && terrainPathClear(terrain, mate, map.drop, RIG_RADIUS), 'squad deployment slot');
			}
			const guns = state.enemies.filter(function (enemy) { return enemy.kind === 'artillery'; });
			const fortified = kind === 'demolition' || kind === 'raid' || kind === 'clearance';
			assert(fortified ? guns.length >= tier && guns.length <= 2 * tier : guns.length === 0, 'artillery garrison size');
			const coverage = map.sites.map(function () { return 0; });
			for (const gun of guns) {
				const ranges = map.sites.map(function (site) { return distance(site, gun); });
				const closest = Math.min(...ranges), siteIndex = ranges.indexOf(closest);
				assert(closest < Math.min(map.width, map.height) / 4, 'gun guards a local objective');
				coverage[siteIndex] = (coverage[siteIndex] ?? 0) + 1;
				assert(state.enemies.every(function (other) { return other === gun || distance(other, gun) > enemyRadius(other) + EMPLACEMENT_RADIUS; })
					&& [state.player, ...state.squadmates].every(function (rig) { return distance(rig, gun) > RIG_RADIUS + EMPLACEMENT_RADIUS; }), 'gun clear of other contacts');
				assert(map.sites.every(function (site) { return distance(site, gun) > CAPTURE_RADIUS + EMPLACEMENT_RADIUS; })
					&& distance(map.extraction, gun) > EXTRACTION_RADIUS + EMPLACEMENT_RADIUS, 'gun clear of objective and pickup');
				assert(map.landmarks.every(function (landmark) { return distance(landmark, gun) >= landmark.radius + EMPLACEMENT_RADIUS; }), 'exposed gun foundation');
				const footprint = { obstacles: [landingFootprint(gun, EMPLACEMENT_RADIUS)] };
				assert(terrain.roads.every(function (road) { return road.every(function (at, i) {
					const prev = road[i - 1]; return !prev || terrainPathClear(footprint, prev, at, RIG_RADIUS);
				}); }), 'gun leaves the approach road clear');
				const base = groundHeight(terrain, gun);
				for (const dx of [-EMPLACEMENT_RADIUS, EMPLACEMENT_RADIUS]) for (const dy of [-EMPLACEMENT_RADIUS, EMPLACEMENT_RADIUS]) {
					assert(Math.abs(base - groundHeight(terrain, { x: gun.x + dx, y: gun.y + dy })) < .001, 'level gun foundation');
				}
			}
			assert(Math.max(...coverage) - Math.min(...coverage) <= 1, 'balanced coverage of the defended sites');
			for (const hostile of state.enemies) {
				const handoff = hostile.entry ?? hostile;
				assert(clearAt(handoff, enemyRadius(hostile)) && reachable(handoff, map.objective, RIG_RADIUS), 'hostile deployment and egress');
			}
			const cut = terrain.obstacles.find(function (obstacle) { return obstacle.kind === 'fissure'; });
			const cover = terrain.obstacles.find(function (obstacle) { return obstacle.kind === 'shed'; });
			if (!cut || !cover) throw new Error('Expected a ground barrier and combat cover');
			cutDirections.add(cut.width > cut.depth ? 'east-west' : 'north-south');
			const sightline = function (o: TerrainObstacle) {
				const dx = o.width <= o.depth ? o.width / 2 + 1 : 0, dy = dx ? 0 : o.depth / 2 + 1;
				const from = { x: o.x - dx, y: o.y - dy }, to = { x: o.x + dx, y: o.y + dy };
				return terrainShotFraction(terrain, { ...from, elevation: groundHeight(terrain, from) + 42 },
					{ ...to, elevation: groundHeight(terrain, to) + 42 });
			};
			assert(sightline(cut) === undefined && sightline(cover) !== undefined, 'line of fire across cuts and cover');
			if (planetId === 'borealis') assert(terrain.obstacles.some(function (o) { return o.kind === 'tree'; }), 'tundra conifers');
		}
	}
	expect(cutDirections).toEqual(new Set(['east-west', 'north-south']));
}, 30_000);

test('edge and hillside reinforcements keep the whole dropship on the field and the unloading ramp on the ground', function () {
	for (const [planetId, seed, tier, index] of [['iolith', 3246141861, 6, 12], ['borealis', 1070406884, 1, 3], ['galeward', 831056492, 3, 3]] as const) {
		const state = createSituationMission({ kind: 'defend', planetId, tier, frame: 'warden', wing: [] }, seed, 'standard');
		state.spawnIn = 0; state.spawned = index;
		spawningStep(state, 1 / 60);
		const map = state.mission?.map, drop = state.warnings[0]?.drop;
		if (!map || !drop) throw new Error('Expected an incoming transport');
		const { origin, heading, padHeight } = drop.flight;
		const at = function (side: number, aft: number) {
			return { x: origin.x + Math.cos(heading) * aft + Math.sin(heading) * side, y: origin.y + Math.sin(heading) * aft - Math.cos(heading) * side };
		};
		for (const width of [-DROPSHIP_WIDTH / 2, DROPSHIP_WIDTH / 2]) for (const aft of [-233, DROPSHIP_DECK.hinge]) {
			const p = at(width, aft);
			expect(Math.min(p.x, p.y, map.width - p.x, map.height - p.y)).toBeGreaterThanOrEqual(0);
		}
		for (const passenger of state.warnings.flatMap(function (w) { return w.drop ?? []; })) {
			const ground = groundHeight(map.terrain, at(passenger.lane, DROPSHIP_DECK.toe));
			expect(Math.abs(padHeight - ground)).toBeLessThanOrEqual(5);
			const release = passenger.flight.startedAt + rigReleaseTime(passenger);
			for (let t = release - 1; t <= release; t += 1 / 60) {
				const rig = dropRigPose(passenger, t);
				expect(rig.elevation).toBeGreaterThanOrEqual(groundHeight(map.terrain, rig));
			}
		}
	}
});

test('the approved Cinder trial and opening campaign Recovery deploy the same terrain', function () {
	const trial = createFieldTrial(283191706).mission?.map;
	const recorder = getChainStatus(createOpeningProgress())?.offers[0]?.contract;
	if (!trial || !recorder) throw new Error('Missing approved Cinder deployment');
	const campaign = createMissionState(recorder).mission?.map;
	expect(campaign).toEqual(trial);
	expect(campaign?.drop).toEqual({ x: 2786, y: 2112 });
	expect(campaign?.terrain?.roads.map(function (route) { return route.find(function (p) { return p.x === 2426; }); }))
		.toEqual([{ x: 2426, y: 2092 }, { x: 2426, y: 1507 }]);
});
