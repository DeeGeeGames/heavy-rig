import { DoubleSide, Group, IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Shape, ShapeGeometry, type OrthographicCamera, type Scene } from 'three';
import type { WeaponMount } from './arsenal';
import type { MissionMap } from './campaign-types';
import { terrainPathClear, terrainPointClear, type ObstacleField } from './field-terrain';
import { FRAME_RIGS } from './frame-rig';
import { getFrame, type FrameId } from './frames';
import { advanceGait, advanceGaitHeading, createGait, type Foot, type WalkerGait } from './gait';
import type { AuthoredPoseContext } from './authored-pose';
import { getMechAssetBinding } from './mech-asset-registry';
import { SURFACE_PALETTES } from './mission-environment';
import { boardingLayouts, type LaunchBerth } from './launch-berths';
import { footprintOverlap, launchFootprint, posedFootprint } from './launch-footprint';
import { createDropship, DROPSHIP_DECK, DROPSHIP_WIDTH } from './launch-ships';
import { LAUNCH_TIMING } from './launch-timing';
import { toScreen, viewScale } from './projection-3d';
import { angleDelta, combatTargets, type CombatStateView, type Point } from './simulation';

const unit = function (x: number) { return Math.max(0, Math.min(1, x)); };
const between = function (time: number, start: number, end: number) { return unit((time - start) / (end - start)); };
const ease = function (x: number) { return x * x * (3 - 2 * x); };
const mix = function (a: number, b: number, t: number) { return a + (b - a) * t; };
const mixPoint = function (a: Point, b: Point, t: number): Point { return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) }; };

const landingField = function (map: MissionMap, state: CombatStateView): ObstacleField {
	const footprint = function (point: Point, radius: number) { return { x: point.x, y: point.y, width: 2 * radius, depth: 2 * radius }; };
	const mission = state.mission;
	return { obstacles: [
		...(map.terrain?.obstacles ?? []),
		...combatTargets(state).map(function (target) { return footprint(target.body, target.radius); }),
		...(mission?.captureSites ?? []).map(function (site) { return footprint(site, 24); }),
		...(mission?.contract.kind === 'defend' ? [footprint(map.objective, 68)] : []),
	] };
};

const landingSites = function* (map: MissionMap, state: CombatStateView, terrain: ObstacleField): Generator<LandingSite> {
	const formation = [state.player, ...state.squadmates];
	// Keep the ramp facing the camera. Where terrain permits, point it toward
	// the trailing formation so early arrivals can walk straight to their stations.
	const away = state.player.angle + Math.PI;
	const preferred = [0, 90, 30, 60, -22.5, 112.5].map(function (degrees) { return degrees * Math.PI / 180; })
		.sort(function (a, b) { return Math.abs(angleDelta(a, away)) - Math.abs(angleDelta(b, away)); });
	const candidates = [...preferred, ...[15, 45, 75].map(function (degrees) { return degrees * Math.PI / 180; })];
	const placement = function (heading: number, shift: number, runout: number) {
		const dx = Math.cos(heading), dz = Math.sin(heading);
		const back = Math.min(...formation.map(function (actor) { return (actor.x - map.drop.x) * dx + (actor.y - map.drop.y) * dz; }));
		const offset = back - DROPSHIP_DECK.toe - runout;
		const at = function (side: number, aft: number): Point {
			return { x: map.drop.x + dx * (offset + aft) + dz * (side + shift), y: map.drop.y + dz * (offset + aft) - dx * (side + shift) };
		};
		const aftAt = function (p: Point) { return (p.x - map.drop.x) * dx + (p.y - map.drop.y) * dz - offset; };
		return { heading, at, aftAt };
	};
	let fallback = placement(0, 0, 106), best = Infinity;
	const inField = function (p: Point) { return p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height; };
	const offsets = [0, -120, 120, -240, 240, -350, 350, -490, 490, -630, 630];
	const score = function (site: ReturnType<typeof placement>) {
		const fits = [-1, 1].every(function (side) {
			return inField(site.at(side * DROPSHIP_WIDTH / 2, -233)) && inField(site.at(side * DROPSHIP_WIDTH / 2, DROPSHIP_DECK.hinge))
				&& inField(site.at(side * 160, DROPSHIP_DECK.toe));
		});
		// Overlapping strips cover the whole hull and its wide nacelles.
		const occupied = [-.4, -.2, 0, .2, .4].filter(function (fraction) {
			const side = DROPSHIP_WIDTH * fraction;
			return !terrainPathClear(terrain, site.at(side, -190), site.at(side, DROPSHIP_DECK.hinge), DROPSHIP_WIDTH * .105);
		}).length;
		const blocked = formation.filter(function (actor) { return !terrainPathClear(terrain, site.at(0, DROPSHIP_DECK.toe), actor, 30); }).length;
		const ramp = terrainPathClear(terrain, site.at(0, DROPSHIP_DECK.hinge), site.at(0, DROPSHIP_DECK.toe), 145);
		// Once the hull and ramp are clear, curved disembarkation paths can
		// route individual rigs around obstructions between the ramp and formation.
		return (occupied + (fits ? 0 : 1) + (ramp ? 0 : 1)) * (formation.length + 1) + blocked;
	};
	// Try a longer straight walk or a broadside before making everyone walk
	// several rig widths sideways from a distant landing site.
	const angles = function (degrees: number[]) { return degrees.map(function (angle) { return angle * Math.PI / 180; }); };
	const views = [candidates, angles([-45, 135, -60, 150]), angles([-75, 165, -90, 180])];
	for (const shifts of [offsets.slice(0, 3), offsets.slice(3)]) {
		for (const headings of views) {
			for (const runout of [106, 180, 250]) for (const shift of shifts) for (const heading of headings) {
				const site = placement(heading, shift, runout), cost = score(site);
				if (cost === 0) yield site;
				if (cost < best) { fallback = site; best = cost; }
			}
		}
	}
	if (best > 0) yield fallback;
};

interface LandingRig {
	gait: WalkerGait;
	authored: AuthoredPoseContext | undefined;
	elevation: number;
}

const altitude = function (time: number) {
	return 54 * (1 - ease(between(time, LAUNCH_TIMING.touchdown, 7.5)))
		+ 95 * ease(between(time, LAUNCH_TIMING.lift, 12.5)) + 400 * between(time, 12.5, LAUNCH_TIMING.end) ** 1.5;
};
const deckHeight = function (aft: number) { return DROPSHIP_DECK.height * unit((DROPSHIP_DECK.toe - aft) / (DROPSHIP_DECK.toe - DROPSHIP_DECK.hinge)); };

interface LandingSite { heading: number; at: (side: number, aft: number) => Point; aftAt: (p: Point) => number }
type Body = WalkerGait['body'];
type GroundPath = (time: number) => Body;

// The launch order sets an absolute time for each rig to clear the ramp. A rig
// in a forward berth can start walking early while still following the aft row.
const rampTrack = function (site: LandingSite, berth: LaunchBerth, clear: number) {
	const start = clear - (DROPSHIP_DECK.toe - berth.z) / 150;
	const toe = site.at(berth.x, DROPSHIP_DECK.toe);
	const at = function (t: number): Body {
		return { ...site.at(berth.x, mix(berth.z, DROPSHIP_DECK.toe, between(t, start, clear))), angle: site.heading };
	};
	return { start, clear, toe, at };
};

const groundTrack = function (site: LandingSite, ramp: ReturnType<typeof rampTrack>, goal: Body, bend: number, pace: number): GroundPath {
	const dx = goal.x - ramp.toe.x, dy = goal.y - ramp.toe.y;
	const span = Math.max(1, Math.hypot(dx, dy));
	const control = { x: (ramp.toe.x + goal.x) * .5 - dy * bend / span, y: (ramp.toe.y + goal.y) * .5 + dx * bend / span };
	// Walk off the ramp's lip before fanning out. A lateral slot must never
	// send a turning rig back through the passenger behind it.
	const forward = Math.max(0, DROPSHIP_DECK.toe + 50 - site.aftAt(control));
	control.x += forward * Math.cos(site.heading); control.y += forward * Math.sin(site.heading);
	const end = Math.min(13.0, ramp.clear + Math.hypot(span, bend) / (134 * pace));
	const finalCourse = site.heading + angleDelta(site.heading, Math.atan2(goal.y - control.y, goal.x - control.x));
	const facing = finalCourse + angleDelta(finalCourse, goal.angle);
	// Finish turning while there is still room between the formation slots.
	const settle = .35 + Math.abs(facing - finalCourse) * .7;
	return function (time) {
		if (time <= ramp.clear) return ramp.at(time);
		const t = 1 - (1 - between(time, ramp.clear, end)) ** 1.5;
		const a = mixPoint(ramp.toe, control, t), b = mixPoint(control, goal, t);
		const course = Math.atan2(b.y - a.y, b.x - a.x);
		const heading = site.heading + angleDelta(site.heading, course) * ease(between(time, ramp.clear, ramp.clear + .3));
		return { ...mixPoint(a, b, t), angle: mix(heading, facing, ease(between(time, Math.max(ramp.clear + .2, end - settle), end + .2))) };
	};
};

interface LandingRoute {
	route: GroundPath;
	footprints: ReturnType<typeof posedFootprint>[];
	parked: ReturnType<typeof posedFootprint>;
	conflicts: Map<LandingRoute, number>;
	cost: number;
}

// Formation headings vary by mission. Plan the whole squad together: a path
// that is individually clear may cross a wingmate or park in front of it.
const rigPaths = function (site: LandingSite, terrain: ObstacleField, actors: readonly (Body & { shape: ReturnType<typeof launchFootprint> })[], berths: readonly LaunchBerth[], cache: Map<string, LandingRoute>) {
	const times = Array.from({ length: 42 }, function (_, i) { return 8.75 + i / 8; });
	// Two walkers following one another need room for a planted rear foot and
	// the next rig's forward stride. Opposite lanes can unload more closely.
	const byLane = new Map<number, number>();
	const release: number[] = [];
	const firstExit = actors.length === 1 ? 10 : 9.45;
	let previous = firstExit - .63;
	for (const berth of [...berths].sort(function (a, b) { return a.exitOrder - b.exitOrder; })) {
		const last = byLane.get(berth.x) ?? -Infinity;
		previous = Math.max(previous + .63, last + .95);
		byLane.set(berth.x, previous); release.push(previous);
	}
	// A full squad can start up to two held poses earlier to keep the handoff on time.
	const advance = actors.length > 2 ? Math.max(0, Math.min(.25, previous - (9.45 + .63 * (actors.length - 1)))) : 0;
	const tracks = actors.map(function (actor, index) {
		const berth = berths[index];
		if (!berth) throw new Error('Missing deployment berth');
		const time = release[berth.exitOrder];
		if (time === undefined) throw new Error('Missing ramp release');
		const clear = time - advance;
		return { actor, ramp: rampTrack(site, berth, clear), key: [index, berth.x, berth.z, clear].join(',') };
	});
	const option = function ({ actor, ramp, key }: (typeof tracks)[number], bend: number, pace: number): LandingRoute {
		const id = [key, bend, pace].join(',');
		const cached = cache.get(id);
		if (cached) return cached;
		const route = groundTrack(site, ramp, actor, bend, pace), points = times.map(route);
		const blocked = points.filter(function (p, i) { return (times[i] ?? 0) >= ramp.clear && !terrainPointClear(terrain, p, 32); }).length;
		let angle = site.heading;
		const footprints = points.map(function (p) {
			angle = advanceGaitHeading(angle, p.angle, 1 / 8);
			return posedFootprint({ ...p, angle }, actor.shape);
		});
		const result = { route, footprints, parked: posedFootprint(actor, actor.shape), conflicts: new Map<LandingRoute, number>(),
			cost: 2 * Math.abs(bend) + Math.abs(pace - 1) * 14 + blocked * 32000 };
		cache.set(id, result);
		return result;
	};
	const clearance = function (a: LandingRoute, b: LandingRoute) {
		const cached = a.conflicts.get(b);
		if (cached !== undefined) return cached;
		const parked = footprintOverlap(a.parked, b.parked);
		const total = a.footprints.reduce(function (total, p, i) {
			const q = b.footprints[i];
			const depth = q ? Math.max(0, footprintOverlap(p, q) - parked) : 0;
			return total + depth * depth;
		}, 0);
		a.conflicts.set(b, total);
		return total;
	};
	const straight = tracks.map(function (track) { return option(track, 0, 1); });
	const directCost = straight.reduce(function (sum, route, i) {
		return sum + route.cost + straight.slice(0, i).reduce(function (cost, other) { return cost + clearance(route, other); }, 0);
	}, 0);
	const direct = { paths: straight.map(function (row) { return row.route; }), cost: directCost };
	const detour = function (limit: number) {
		let best = limit, bestPaths: GroundPath[] | undefined;
		const routes = tracks.map(function (track) {
			return [0, -16, 16, -35, 35, -70, 70, -150, 150, -240, 240, -345, 345].filter(function (bend) { return 2 * Math.abs(bend) < best; }).flatMap(function (bend) {
				return [1, 1.35, .78].map(function (pace) { return option(track, bend, pace); });
			}).filter(function ({ cost }) { return cost < best; });
		});
		const choose = function (row: number, cost: number, chosen: readonly LandingRoute[]) {
			const candidates = routes[row];
			if (!candidates) { best = cost; bestPaths = chosen.map(function (route) { return route.route; }); return; }
			for (const candidate of candidates) {
				let next = cost + candidate.cost;
				for (const previous of chosen) {
					if (next >= best) break;
					next += clearance(candidate, previous);
				}
				if (next < best) choose(row + 1, next, [...chosen, candidate]);
			}
		};
		choose(0, 0, []);
		return bestPaths ? { paths: bestPaths, cost: best } : undefined;
	};
	return { direct, detour };
};

export const planLaunchLanding = function (state: CombatStateView, map: MissionMap) {
	const terrain = landingField(map, state);
	const goal = function (body: Body, frame: FrameId, loadout: readonly WeaponMount[]) {
		return { x: body.x, y: body.y, angle: body.angle, shape: launchFootprint(frame, loadout) };
	};
	const actors = [goal(state.player, state.frame, state.loadout), ...state.squadmates.map(function (mate) { return goal(mate, mate.frameId, mate.loadout); })];
	const chooseLayout = function (site: LandingSite, limit: number) {
		const toe = site.at(0, DROPSHIP_DECK.toe);
		const goals = actors.map(function (actor) {
			return { x: (actor.x - toe.x) * Math.sin(site.heading) - (actor.y - toe.y) * Math.cos(site.heading), z: site.aftAt(actor) };
		});
		const cache = new Map<string, LandingRoute>();
		const layouts = boardingLayouts(goals).flatMap(function (berths) {
			const distance = berths.reduce(function (sum, berth, i) {
				const p = goals[i]; if (!p) throw new Error('Missing formation position');
				const lateral = Math.abs(p.x - berth.x);
				return sum + Math.hypot(lateral, p.z - DROPSHIP_DECK.toe) + .5 * lateral;
			}, 0);
			// A farther wingmate going first leaves the near station free to pass.
			const waiting = berths.reduce(function (cost, berth, i) {
				if (i === 0) return cost;
				const own = goals[i]; if (!own) throw new Error('Missing formation position');
				return cost + berths.reduce(function (extra, other, j) {
					const point = goals[j];
					return extra + (j > 0 && point && other.exitOrder < berth.exitOrder ? Math.max(0, own.z - point.z) * .5 : 0);
				}, 0);
			}, 0);
			if (distance + waiting >= limit) return [];
			const routes = rigPaths(site, terrain, actors, berths, cache);
			return [{ berths, routes, distance: distance + waiting, cost: routes.direct.cost + distance + waiting }];
		});
		if (layouts.length === 0) return undefined;
		const direct = layouts.reduce(function (a, b) { return a.cost <= b.cost ? a : b; });
		let best = { berths: direct.berths, paths: direct.routes.direct.paths, cost: direct.cost };
		for (const layout of layouts) {
			const allowance = Math.min(limit, best.cost) - layout.distance;
			if (allowance <= 0 || layout.routes.direct.cost === 0) continue;
			const detour = layout.routes.detour(allowance);
			if (detour) best = { berths: layout.berths, paths: detour.paths, cost: layout.distance + detour.cost };
		}
		const sin = Math.sin(site.heading), cos = Math.cos(site.heading);
		const sideways = function (p: Point) { return (p.x - toe.x) * sin - (p.y - toe.y) * cos; };
		const backtrack = best.paths.reduce(function (sum, path) {
			const start = sideways(path(8));
			let last = start, travel = 0;
			for (let t = 8.125; t <= 13.875; t += .125) {
				const at = sideways(path(t)); travel += Math.abs(at - last); last = at;
			}
			return sum + travel - Math.abs(last - start);
		}, 0);
		return { ...best, site, backtrack, score: best.cost + 2 * backtrack };
	};
	const sites = landingSites(map, state, terrain);
	const first = sites.next();
	if (first.done) throw new Error('Missing landing site');
	let best = chooseLayout(first.value, Infinity);
	if (!best) throw new Error('Missing deployment plan');
	// Try other clear touchdown points if a rig would need to double back.
	// Bound the extra work up front, before the first frame of the sequence.
	for (let i = 0; i < 8 && best.backtrack > 6; i++) {
		const next = sites.next(); if (next.done) break;
		const candidate = chooseLayout(next.value, best.score);
		if (candidate && candidate.score < best.score) best = candidate;
	}
	const { site } = best;
	// Keep the ramp planted until the trailing rig, including its back foot and
	// outboard equipment, has walked beyond the lip on the held-pose clock.
	let closeAt = LAUNCH_TIMING.lift - .125;
	const clearOfRamp = function (path: GroundPath, index: number) {
		const actor = actors[index]; if (!actor) throw new Error('Missing deployment rig');
		return site.aftAt(path(closeAt)) > DROPSHIP_DECK.toe + actor.shape.radius + 12;
	};
	while (closeAt < 13.875 && !best.paths.every(clearOfRamp)) closeAt += .125;
	return { site, berths: best.berths, paths: best.paths, closeAt };
};

// Advance the deployed rig's normal game gait and expose only poses on the
// launch clock. Each sole takes the grade of the ramp under its planted foot.
const rigTrack = function (site: LandingSite, frameId: FrameId, bodyAt: GroundPath) {
	const frame = getFrame(frameId), rig = FRAME_RIGS[frameId];
	const advancePose = getMechAssetBinding(frameId)?.advancePose;
	let tick = 0;
	let gait = createGait(bodyAt(LAUNCH_TIMING.touchdown), frame.size, rig);
	let authored = advancePose?.(undefined, gait.body, 0);
	return function (time: number): LandingRig {
		const until = Math.max(0, Math.round((time - LAUNCH_TIMING.touchdown) * 60));
		while (tick < until) {
			tick++;
			const body = bodyAt(LAUNCH_TIMING.touchdown + tick / 60);
			authored = advancePose?.(authored, body, tick / 60);
			gait = authored?.gait ?? advanceGait(gait, body, 1 / 60, frame.size, frame.stride, rig);
		}
		const base = deckHeight(site.aftAt(gait.body));
		const sole = function (foot: Foot) { return { ...foot, lift: foot.lift + deckHeight(site.aftAt(foot)) - base }; };
		return { gait: { ...gait, feet: [sole(gait.feet[0]), sole(gait.feet[1])] }, authored, elevation: base + altitude(Math.min(time, LAUNCH_TIMING.touchdown + .5)) };
	};
};

// Plan view of the transport. This ground silhouette also draws the survey's
// tracked contact, so the two meet exactly as the survey wipes off the field.
const silhouette = [[-78, -207], [78, -207], [110, -155], [110, -92], [135, -92], [140, -148], [175, -130], [180, 101], [157, 143], [128, 136], [119, 95], [108, 95], [107, 196], [-107, 196], [-108, 95], [-119, 95], [-128, 136], [-157, 143], [-180, 101], [-175, -130], [-140, -148], [-135, -92], [-110, -92], [-110, -155]] as const;

export const createSurfaceLanding = function (scene: Scene, state: CombatStateView, map: MissionMap, { site, paths, closeAt } = planLaunchLanding(state, map)) {
	const ship = createDropship();
	const root = new Group(); root.name = 'mission-landing'; scene.add(root); root.add(ship.root);
	ship.root.rotation.y = Math.PI / 2 - site.heading;
	const shape = new Shape();
	for (const [index, [x, z]] of silhouette.entries()) { if (index === 0) shape.moveTo(x * DROPSHIP_WIDTH / 360, -z); else shape.lineTo(x * DROPSHIP_WIDTH / 360, -z); }
	shape.closePath();
	const shadowGeometry = new ShapeGeometry(shape);
	const shadowPaint = new MeshBasicMaterial({ color: '#141a20', side: DoubleSide, transparent: true, opacity: .45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
	const shadow = new Mesh(shadowGeometry, shadowPaint); shadow.name = 'transport-ground-shadow'; shadow.rotation.order = 'YXZ'; shadow.rotation.set(-Math.PI / 2, ship.root.rotation.y, 0); root.add(shadow);
	const dustShape = new IcosahedronGeometry(1, 0);
	const dustPaint = new MeshBasicMaterial({ color: SURFACE_PALETTES[map.biome].dust, transparent: true, opacity: .38, depthWrite: false });
	const dust = new InstancedMesh(dustShape, dustPaint, 16); dust.frustumCulled = false; root.add(dust);
	const puff = new Object3D();
	const tracks = [state.frame, ...state.squadmates.map(function (mate) { return mate.frameId; })].map(function (frame, index) {
		const path = paths[index];
		if (!path) throw new Error('Missing deployment berth');
		return rigTrack(site, frame, path);
	});
	let poseTime = -1;
	let poses: LandingRig[] = [];
	const origin = site.at(0, 0), rear = site.at(0, 170);
	const rampFocus = { x: rear.x - 71, y: rear.y - 71 };
	const liftoffFocus = mixPoint({ x: origin.x - 60, y: origin.y - 60 }, state.player, .45);
	const shadowAt = function (time: number): Point {
		const progress = ease(between(time, LAUNCH_TIMING.approach, LAUNCH_TIMING.touchdown));
		return { x: origin.x - 475 * (1 - progress) + 35 * progress, y: origin.y + 245 * (1 - progress) + 25 * progress };
	};
	const update = function (time: number, w: number, h: number) {
		const normalClose = LAUNCH_TIMING.lift - .125;
		const shipTime = time <= closeAt ? Math.min(time, normalClose) : mix(normalClose, LAUNCH_TIMING.end, between(time, closeAt, LAUNCH_TIMING.end));
		const airborne = altitude(shipTime);
		const approach = time < LAUNCH_TIMING.touchdown;
		const pullback = 1 - (1 - between(time, LAUNCH_TIMING.touchdown, 13.875)) ** 1.7;
		const lift = between(shipTime, LAUNCH_TIMING.lift, LAUNCH_TIMING.end);
		const travel = site.at(0, -45 * ease(between(shipTime, LAUNCH_TIMING.lift, 12.5)) - 980 * between(shipTime, 12.45, LAUNCH_TIMING.end) ** 1.6);
		ship.root.visible = !approach;
		ship.root.position.set(travel.x, airborne, travel.y);
		ship.root.rotation.z = Math.round(-lift * 5) * Math.PI / 90;
		ship.setRamp(ease(between(shipTime, 7.125, 8.125)) * (1 - ease(between(shipTime, normalClose, LAUNCH_TIMING.lift + .625))));
		ship.setThrust(approach ? 0 : .14 + .86 * Math.max(1 - ease(between(time, 7.25, 8.0)), ease(between(time, 11, 12.5))));
		const silhouetteAt = approach ? shadowAt(time) : { x: travel.x + 15 + airborne * .37, y: travel.y + 8 + airborne * .32 };
		shadow.position.set(silhouetteAt.x, 1.05, silhouetteAt.y);
		shadowPaint.opacity = approach ? .48 : Math.max(.15, .45 - airborne * .0005);
		const wash = shipTime < 10 ? between(shipTime, 7.125, 8.5) : between(shipTime, normalClose, 13.0);
		dust.visible = wash > 0 && wash < 1;
		if (dust.visible) {
			dustPaint.opacity = .44 * (1 - wash);
			for (let i = 0; i < dust.count; i++) {
				const a = i * 2.4, radius = 82 + wash * (124 + i % 4 * 19);
				const p = site.at(Math.cos(a) * radius, Math.sin(a) * radius + (i % 2 ? -35 : 55));
				puff.position.set(p.x, 5 + Math.sin(wash * Math.PI) * (6 + i % 5 * 3), p.y);
				puff.scale.set(19 + wash * 30, 5 + wash * 9, 12 + wash * 22); puff.rotation.y = a; puff.updateMatrix(); dust.setMatrixAt(i, puff.matrix);
			}
			dust.instanceMatrix.needsUpdate = true;
		}
		if (time !== poseTime) { poses = tracks.map(function (sample) { return sample(time); }); poseTime = time; }
		const scale = viewScale(w, h) * Math.sqrt(3 / 2);
		const tight = Math.max(1, Math.min(2.5, w / (scale * (DROPSHIP_WIDTH - 75)), h / (scale * 235)));
		const wide = mixPoint(rampFocus, liftoffFocus, ease(between(time, 7, LAUNCH_TIMING.lift)));
		return { poses, visible: !approach, zoom: approach ? .70 : mix(tight, 1, pullback), dockBlend: ease(between(time, LAUNCH_TIMING.lift, 13.875)),
			focus: approach ? { x: origin.x - 110, y: origin.y + 64 } : mixPoint(wide, state.player, ease(between(time, 12.125, 13.875))) };
	};
	const drawSurvey = function (ctx: CanvasRenderingContext2D, w: number, h: number, camera: OrthographicCamera, time: number) {
		const progress = between(time, LAUNCH_TIMING.approach, LAUNCH_TIMING.touchdown);
		const edge = Math.round(w * (1 - ease(progress)) / 5) * 5;
		ctx.save(); ctx.beginPath(); ctx.rect(0, 0, edge, h); ctx.clip();
		ctx.fillStyle = '#183238'; ctx.fillRect(0, 0, w, h);
		const project = function (pt: Point) { return toScreen(pt, camera, w, h); };
		const line = function (points: readonly Point[]) {
			ctx.beginPath(); points.forEach(function (p, i) { const at = project(p); if (i === 0) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y); }); ctx.stroke();
		};
		ctx.strokeStyle = '#2c4b4c'; ctx.lineWidth = 1;
		for (let x = 0; x <= map.width; x += 180) line([{ x, y: 0 }, { x, y: map.height }]);
		for (let y = 0; y <= map.height; y += 180) line([{ x: 0, y }, { x: map.width, y }]);
		ctx.strokeStyle = '#577d75';
		for (const mark of map.landmarks) {
			const at = project(mark), margin = mark.radius + 80;
			if (at.x < -margin || at.x > edge + margin || at.y < -margin || at.y > h + margin) continue;
			for (const band of [.65, 1, 1.35]) {
				line(Array.from({ length: 17 }, function (_, i) {
					const a = i * Math.PI / 8;
					const radius = mark.radius * band * (1 + .14 * Math.sin(a * 3 + mark.rotation));
					return { x: mark.x + Math.cos(a) * radius, y: mark.y + Math.sin(a) * radius * .8 };
				}));
			}
		}
		ctx.strokeStyle = '#88a798'; ctx.lineWidth = 1.5;
		for (const o of map.terrain?.obstacles ?? []) {
			const hw = o.width / 2, hd = o.depth / 2;
			for (const gap of [0, 14]) line([{ x: o.x - hw - gap, y: o.y - hd - gap }, { x: o.x + hw + gap, y: o.y - hd - gap }, { x: o.x + hw + gap, y: o.y + hd + gap }, { x: o.x - hw - gap, y: o.y + hd + gap }, { x: o.x - hw - gap, y: o.y - hd - gap }]);
		}
		ctx.strokeStyle = '#96bfac'; ctx.lineWidth = 3;
		for (const road of map.terrain?.roads ?? [[map.drop, map.objective, map.extraction]]) line(road);
		ctx.strokeStyle = '#edb765'; ctx.lineWidth = 3; ctx.setLineDash([8, 7]); line([shadowAt(LAUNCH_TIMING.approach), shadowAt(LAUNCH_TIMING.touchdown)]); ctx.setLineDash([]);
		const lz = project(map.drop);
		ctx.strokeStyle = '#c1d9b6'; ctx.lineWidth = 1.5;
		ctx.strokeRect(lz.x - 6, lz.y - 6, 12, 12);
		ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 12px monospace'; ctx.fillText('LZ', lz.x + 12, lz.y + 4);
		const contactScale = mix(.37, 1, ease(between(progress, .32, .84)));
		const contact = function (x: number, z: number) {
			const p = site.at(x * (DROPSHIP_WIDTH / 360) * contactScale, z * contactScale);
			return project({ x: p.x - origin.x + shadow.position.x, y: p.y - origin.y + shadow.position.z });
		};
		ctx.fillStyle = '#243b39'; ctx.strokeStyle = '#f4c37a'; ctx.lineWidth = 2;
		const polygon = function (points: readonly (readonly [number, number])[]) {
			ctx.beginPath(); points.forEach(function ([x, z], i) { const v = contact(x, z); if (!i) ctx.moveTo(v.x, v.y); else ctx.lineTo(v.x, v.y); });
			ctx.closePath(); ctx.fill(); ctx.stroke();
		};
		polygon(silhouette);
		for (const side of [-1, 1]) polygon([[side * 137, -117], [side * 166, -100], [side * 166, 101], [side * 137, 119]]);
		ctx.fillStyle = '#e8ba72'; polygon([[-57, -161], [57, -161], [70, -124], [-70, -124]]);
		ctx.fillStyle = '#d2e2cb'; ctx.font = 'bold 12px monospace'; ctx.fillText('SURFACE APPROACH', 20, 30);
		ctx.restore();
	};
	return { update, drawSurvey, dispose: function () {
		root.removeFromParent(); ship.dispose(); dust.dispose(); dustShape.dispose(); dustPaint.dispose(); shadowGeometry.dispose(); shadowPaint.dispose(); root.clear();
	} };
};
