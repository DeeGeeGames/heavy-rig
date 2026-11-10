import { expect, test } from 'bun:test';
import { Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { createMount, WEAPONS } from '../src/arsenal';
import type { Contract } from '../src/campaign-types';
import { enemyVolume } from '../src/combat-spatial';
import { createGait } from '../src/gait';
import { createMech } from '../src/mech-3d';
import { missionHostileCount } from '../src/missions';
import { getDifficultyDefinition, WAVES } from '../src/operation';
import { coolingStep, createMissionState, createState, distance, ENEMY_STATS, projectilesStep, step, weaponsStep, type Controls, type State, type Unit } from '../src/simulation';

const kinds = ['helicopter', 'vtol', 'tank'] as const;
const idle: Controls = { drive: 0, turn: 0, stop: false, aim: { x: 900, y: 600 }, fire: [false, false, false, false], coolant: false };
const vehicle = function (state: State, kind: typeof kinds[number], separation = ENEMY_STATS[kind].range): Unit {
	const hp = ENEMY_STATS[kind].hp;
	const enemy: Unit = { id: state.nextId++, x: state.player.x - separation, y: state.player.y, kind, angle: 0, cooldown: 0, hp, maxHp: hp, heavy: kind === 'tank' };
	state.enemies.push(enemy); state.spawnIn = 3600;
	return enemy;
};

test('campaign rosters deploy mixed forces at every difficulty and keep the assassination target a command mech', function () {
	for (const kind of ['clearance', 'assassination', 'demolition', 'defend'] as const) {
		for (const difficulty of ['story', 'standard', 'veteran'] as const) {
			const contract: Contract = { id: 'vehicle-mix', seed: 123, planetId: 'meridian', kind, tier: 1, employer: 'freeholds', opponent: 'combine', title: 'Test', briefing: 'Test', reward: 1000, favor: 8, hostility: 5, requiredReputation: 0 };
			const state = createMissionState(contract, { difficulty });
			const repeated = createMissionState(contract, { difficulty });
			expect(state.enemies).toEqual(repeated.enemies);
			if (kind === 'defend') {
				const deployed = new Set<string>();
				for (let tick = 0; tick < 60 * 150 && state.kills < missionHostileCount(contract); tick++) {
					for (const enemy of state.enemies) { deployed.add(enemy.kind); enemy.hp = 0; }
					step(state, idle, 1 / 60);
				}
				expect(state.kills).toBe(missionHostileCount(contract));
				for (const vehicleKind of kinds) expect(deployed.has(vehicleKind)).toBe(true);
				continue;
			}
			expect(state.enemies).toHaveLength(missionHostileCount(contract));
			for (const vehicleKind of kinds) {
				const enemy = state.enemies.find(function (candidate) { return candidate.kind === vehicleKind; });
				expect(enemy?.hp).toBe(Math.round(ENEMY_STATS[vehicleKind].hp * getDifficultyDefinition(difficulty).enemyArmor));
				expect(enemy?.loadout?.length).toBe(vehicleKind === 'vtol' ? 2 : 1);
			}
			if (kind === 'assassination') {
				const commander = state.enemies.find(function (enemy) { return enemy.id === state.mission?.targetId; });
				expect(commander?.commander).toBe(true); expect(commander?.kind).toBe('siege');
			}
		}
	}
});

test('relay waves introduce every vehicle through the warning and equipment path without changing quotas', function () {
	expect(WAVES.map(function (wave) { return wave.enemies.length; })).toEqual([5, 7, 8, 9, 10]);
	for (const kind of kinds) {
		const wave = WAVES.find(function (candidate) { return candidate.enemies.some(function (enemy) { return enemy.kind === kind; }); });
		if (!wave) throw new Error(`Missing ${kind} wave`);
		const state = createState(); state.wave = wave.number; state.spawned = wave.enemies.findIndex(function (enemy) { return enemy.kind === kind; }); state.spawnIn = 0;
		step(state, idle, 1 / 60); expect(state.warnings[0]?.kind).toBe(kind); expect(state.enemies).toHaveLength(0);
		state.spawnIn = 3600;
		for (let tick = 0; tick < 121; tick++) step(state, idle, 1 / 60);
		expect(state.enemies[0]?.kind).toBe(kind); expect(state.enemies[0]?.loadout?.length).toBe(kind === 'vtol' ? 2 : 1);
	}
});

test('gunships circle and VTOLs strafe while firing; tanks stop and aim independently at cannon range', function () {
	for (const kind of kinds) {
		const state = createState(); const enemy = vehicle(state, kind); const original = { x: enemy.x, y: enemy.y };
		enemy.hullAngle = Math.PI / 2;
		step(state, idle, 1 / 60);
		expect(state.shots[0]?.weapon).toBe(kind === 'helicopter' ? 'machine-gun' : kind === 'vtol' ? 'stream-missiles' : 'autocannon');
		expect(state.shots[0]?.enemyTarget).toBe(kind === 'vtol' ? 'player' : undefined);
		for (let tick = 0; tick < 180; tick++) step(state, idle, 1 / 60);
		if (kind === 'tank') {
			expect(enemy.x).toBe(original.x); expect(enemy.y).toBe(original.y);
			expect(enemy.hullAngle).toBe(Math.PI / 2); expect(enemy.angle).toBe(0);
		} else {
			expect(distance(enemy, original)).toBeGreaterThan(30);
			expect(distance(enemy, state.player)).toBeGreaterThan(ENEMY_STATS[kind].range - 80);
			expect(distance(enemy, state.player)).toBeLessThan(ENEMY_STATS[kind].range + 80);
		}
		expect(state.stats.damageTaken).toBeGreaterThan(0);
	}
});

test('tank frontal protection follows the hull even when the cannon faces the rear', function () {
	for (const [origin, damage] of [[100, 45], [-100, 100]] as const) {
		const state = createState(); const enemy = vehicle(state, 'tank', 300); enemy.hullAngle = 0; enemy.angle = Math.PI;
		state.shots.push({ x: enemy.x + origin, y: enemy.y, vx: -Math.sign(origin) * 10000, vy: 0, life: 1, kind: 'cannon', target: undefined, damage: 100 });
		projectilesStep(state, 0.02);
		expect(enemy.hp).toBe(ENEMY_STATS.tank.hp - damage);
	}
});

test('every player weapon can damage ground and air vehicles with guidance and elevated impact feedback intact', function () {
	for (const kind of kinds) for (const weapon of WEAPONS) {
		const state = createState({ starter: weapon.id }); const enemy = vehicle(state, kind, 150);
		state.loadout = [createMount(weapon.id)]; state.player.turret = Math.PI; enemy.angle = Math.PI / 2; enemy.hullAngle = Math.PI / 2;
		const controls: Controls = { ...idle, aim: enemy, targetId: enemy.id, fire: [true, false, false, false] };
		for (let tick = 0; tick < 120 && enemy.hp === enemy.maxHp; tick++) {
			coolingStep(state, controls, 1 / 60); weaponsStep(state, controls, 1 / 60);
			if (weapon.kind === 'missile') expect(state.shots.every(function (shot) { return shot.target === enemy.id; })).toBe(true);
			projectilesStep(state, 1 / 60);
		}
		expect(enemy.hp).toBeLessThan(enemy.maxHp);
		const volume = enemyVolume(enemy);
		const impacts = weapon.kind === 'laser' ? state.beams : state.effects.filter(function (effect) { return effect.source !== 'muzzle'; });
		expect(impacts.length).toBeGreaterThan(0);
		for (const impact of impacts) {
			if (impact.elevation === undefined) throw new Error('An impact must retain its simulated height');
			const normalizedDistance = ((impact.x - volume.x) / volume.radius) ** 2 + ((impact.y - volume.y) / volume.radius) ** 2 + ((impact.elevation - volume.elevation) / volume.halfHeight) ** 2;
			expect(normalizedDistance).toBeLessThanOrEqual(1.000001);
		}
	}
});

test('vehicle animations freeze with combat time, retain local muzzle anchors, and dispose GPU assets once', function () {
	for (const kind of kinds) {
		const model = createMech(kind); const body = { x: 100, y: 250, angle: Math.PI / 2 }; const gait = createGait(body);
		const assets = new Set<BufferGeometry | Material>(); const releases = new Map<BufferGeometry | Material, number>();
		model.root.traverse(function (object) {
			if (!(object instanceof Mesh)) return;
			assets.add(object.geometry); for (const surface of Array.isArray(object.material) ? object.material : [object.material]) assets.add(surface);
		});
		for (const asset of assets) asset.addEventListener('dispose', function () { releases.set(asset, (releases.get(asset) ?? 0) + 1); });
		try {
			model.root.position.set(body.x, 0, body.y); model.pose(gait, 0, { recoil: 0, hit: 0, heat: 0, time: 1 });
			const moving = model.root.getObjectByName(kind === 'helicopter' ? 'main-rotor' : kind === 'vtol' ? 'lift-fan' : 'road-wheel');
			if (!moving) throw new Error(`Missing ${kind} animation`);
			const initial = moving.quaternion.clone();
			model.pose({ ...gait, body: { ...body, x: 110 } }, 0, { recoil: 0, hit: 0, heat: 0, time: 2 });
			expect(moving.quaternion.equals(initial)).toBe(false);
			const frozen = moving.quaternion.clone(); const muzzles = model.muzzles.map(function (point) { return point.clone(); });
			model.root.position.add(new Vector3(300, 0, 500));
			model.pose({ ...gait, body: { ...body, x: 110 } }, 0, { recoil: 0, hit: 0, heat: 0, time: 2 });
			expect(moving.quaternion.equals(frozen)).toBe(true);
			expect(model.muzzles).toHaveLength(kind === 'vtol' ? 2 : 1);
			for (const [slot, muzzle] of model.muzzles.entries()) {
				expect(muzzle.distanceTo(muzzles[slot] ?? new Vector3(Infinity, Infinity, Infinity))).toBeLessThan(0.000001);
				expect(muzzle.y).toBeGreaterThan(kind === 'tank' ? 25 : 70);
			}
		} finally { model.dispose(); model.dispose(); }
		for (const asset of assets) expect(releases.get(asset)).toBe(1);
		expect(model.root.children).toHaveLength(0);
	}
});

test('VTOL tracking pods stay attached to their hull wings as the aircraft strafes across its aim', function () {
	const model = createMech('vtol');
	try {
		for (const hull of [0, Math.PI / 2, Math.PI]) for (const aim of [0, -Math.PI / 2]) {
			model.pose(createGait({ x: 0, y: 0, angle: hull }), aim);
			for (const [name, side] of [['left-missile-pod', -1], ['right-missile-pod', 1]] as const) {
				const pod = model.root.getObjectByName(name); if (!pod) throw new Error('Missing VTOL pod');
				const expected = new Vector3(3, -8, side * 19).applyAxisAngle(new Vector3(0, 1, 0), -hull); expected.y += 135;
				expect(pod.getWorldPosition(new Vector3()).distanceTo(expected)).toBeLessThan(0.000001);
			}
		}
	} finally { model.dispose(); }
});
