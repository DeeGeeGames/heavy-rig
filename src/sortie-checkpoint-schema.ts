import * as v from 'valibot';
import { isReserve, type WeaponId } from './arsenal';
import { isFrameId, isWeaponId } from './company';
import type { FrameId } from './frames';
import { SQUAD_SIZE } from './pilots';
import { isRigId, type RigId } from './rigs';

// Checkpoints live outside the running ECS world. Decode every value that will
// re-enter the simulation, including intermediary state inside a weapon burst.
const real = v.pipe(v.number(), v.finite());
const positive = v.pipe(real, v.gtValue(0));
const nonnegative = v.pipe(real, v.minValue(0));
const integer = v.pipe(real, v.safeInteger());
const count = v.pipe(integer, v.minValue(0));
const slot = v.pipe(count, v.maxValue(3));
const hp = v.pipe(nonnegative, v.maxValue(100));
const bool = v.boolean();
const text = v.pipe(v.string(), v.nonEmpty());
const flag = v.literal(true);
const opt = v.exactOptional;
const xy = { x: real, y: real };
const point = v.object(xy);
const spatial = v.object({ ...xy, elevation: real });
const frame = v.custom<FrameId>(function (value) { return isFrameId(value); });
const rigId = v.custom<RigId>(function (value) { return isRigId(value); });
const weapon = v.custom<WeaponId>(function (value) { return isWeaponId(value); });
const mobileKinds = ['scout', 'striker', 'siege', 'helicopter', 'vtol', 'tank'] as const;
const kind = v.picklist([...mobileKinds, 'artillery']);
const actor = v.union([integer, text]);
const objectiveTarget = v.picklist(['player', 'relay']);
const reactor = { heat: nonnegative, overheated: bool };
const mount = v.pipe(v.object({
	weapon, rounds: count, cooldown: real, firing: bool, slot: opt(slot),
	rocketVolley: opt(v.object({ remaining: count, nextIn: real })),
}), v.check(function (mount) { return isReserve(mount.weapon, mount.rounds); }));
const mounts = v.pipe(v.array(mount), v.maxLength(4), v.check(function (mounts) {
	return new Set(mounts.map(function (mount, index) { return mount.slot ?? index; })).size === mounts.length;
}));

const body = v.object({ ...xy, angle: real });
const foot = v.object({ ...xy, angle: real, lift: real });
const footIndex = v.picklist([0, 1]);
const swing = { from: foot, elapsed: nonnegative, duration: positive };
const runLeg = v.pipe(v.object({
	swingPhase: bool, swing: v.optional(v.object({ ...swing, target: opt(body) })),
}), v.transform(function (leg) { return { ...leg, swing: leg.swing }; }));
const gait = v.pipe(v.object({
	body, motion: v.object({ lift: real, roll: real, pitch: real, impact: real }),
	feet: v.strictTuple([foot, foot]),
	swing: v.optional(v.object({ ...swing, index: footIndex, launchPitch: opt(real), direction: opt(real) })),
	nextFoot: footIndex, travelSpeed: opt(real),
	running: opt(v.object({ phase: real, swingRate: real, legs: v.strictTuple([runLeg, runLeg]), stopping: bool })),
}), v.transform(function (gait) { return { ...gait, swing: gait.swing }; }));
const pose = v.object({
	time: nonnegative, body, selected: v.picklist(['walk', 'run', 'backward', 'idle']),
	clips: v.array(v.object({ name: v.picklist(['walk', 'run', 'backward']), time: real, weight: real, timeScale: real })),
	gait: opt(gait), pelvisDrop: opt(real), standingPelvisDrop: opt(real),
});
const drive = {
	throttle: real, speed: real, motorSpeed: opt(real), targetId: opt(integer), brace: opt(real),
	designation: opt(v.object({ targetId: integer, seconds: real })),
	missileLock: opt(v.object({ targetId: integer, progress: nonnegative, interrupted: nonnegative })),
};
const rigBody = { ...xy, ...reactor, ...drive, angle: real, turret: real, hp };
const order = v.variant('kind', [
	v.object({ kind: v.literal('form') }),
	v.object({ kind: v.literal('hold'), point }),
	v.object({ kind: v.literal('move'), point, progress: opt(v.object({ searchAfter: nonnegative, firingPosition: opt(point) })) }),
	v.object({ kind: v.literal('attack'), targetId: integer }),
]);
const mate = v.object({
	...rigBody, pilotId: text, callsign: text, specialty: v.picklist(['marksman', 'skirmisher']),
	experienceBonus: opt(v.picklist([0, 1, 2])), frameId: frame,
	loadout: mounts, shotsFired: count, coolantCharges: v.pipe(count, v.maxValue(2)), defeatedAt: opt(nonnegative),
	order: opt(order), fireDiscipline: opt(v.picklist(['free', 'hold'])), authoredPose: opt(pose),
});
const unit = v.object({
	...xy, id: v.pipe(count, v.minValue(1)), hp: real, maxHp: positive, angle: real, cooldown: real, heavy: bool, kind,
	reactor: opt(v.object(reactor)), hullAngle: opt(real), commander: opt(bool),
	attack: opt(v.object({ phase: v.picklist(['committed', 'recovery']), remaining: real, cycle: real })),
	artilleryAim: opt(v.object({ targetId: integer, remaining: real })), engaged: opt(bool), loadout: opt(mounts),
	attackSlot: opt(slot), squad: opt(v.object({ id: integer, slot: v.picklist(['center', 'left', 'right']), target: objectiveTarget, reconsiderIn: real, bearing: real })),
	tactics: opt(v.object({ phase: v.picklist(['advance', 'engage', 'recover']), remaining: real, destination: point, target: objectiveTarget, lastHp: real, pressure: real, cautionIn: real })),
	stationary: opt(flag), catalog: opt(v.object({ ...drive, frameId: frame, shotsFired: count, authoredPose: opt(pose) })),
	formation: opt(count), entry: opt(point),
});
const attribution = { weapon: opt(weapon), slot: opt(slot), owner: opt(integer), squadmateId: opt(text) };
const shot = v.pipe(v.object({
	...xy, ...attribution, vx: real, vy: real, life: real, kind: v.picklist(['cannon', 'missile', 'enemy', 'bullet', 'ppc', 'rocket']),
	target: v.optional(integer), damage: nonnegative, elevation: opt(real), vElevation: opt(real), origin: opt(spatial),
	age: opt(nonnegative), splash: opt(nonnegative), hitIds: opt(v.array(integer)),
	enemyTarget: opt(v.union([objectiveTarget, v.object({ squadmateId: text })])),
}), v.transform(function (shot) { return { ...shot, target: shot.target }; }));
const strike = v.object({
	...xy, ...attribution, id: v.pipe(count, v.minValue(1)), life: real, duration: positive, radius: nonnegative, damage: nonnegative,
	emplacement: opt(v.object({ origin: spatial, direction: spatial, firedAt: nonnegative })),
	facilityMultiplier: opt(nonnegative), friendly: opt(flag),
});
const beam = v.object({
	...xy, slot, elevation: opt(real), origin: opt(spatial), contact: opt(bool), squadmateId: opt(text), owner: opt(integer),
	aim: opt(v.pipe(v.object({ direction: spatial, targetId: v.optional(integer), sweeping: bool }), v.transform(function (aim) { return { ...aim, targetId: aim.targetId }; }))),
});
const cue = { family: v.picklist(['bullet', 'cannon', 'missile', 'rocket', 'artillery']), heavy: bool, time: nonnegative, shooter: actor, direction: spatial };
const effect = v.object({
	...xy, life: real, size: real, color: text, elevation: opt(real), source: opt(v.literal('muzzle')), slot: opt(slot), squadmateId: opt(text),
	feedback: opt(v.variant('type', [
		v.object({ ...cue, type: v.literal('fire'), slot }),
		v.object({ ...cue, type: v.literal('impact'), surface: v.picklist(['armor', 'concrete', 'ground', 'wood']), target: opt(actor), normal: opt(spatial), affected: opt(v.array(actor)), scuff: opt(flag) }),
	])),
});
const wreck = v.object({
	...xy, kind, angle: real, rig: opt(v.object({ defeatedAt: nonnegative, hullAngle: real, frame: opt(frame), commander: bool, equippedSlots: v.array(slot) })),
});
const flightLeg = v.object({ glide: real, traverse: real });
const flight = v.object({
	origin: point, heading: real, startedAt: nonnegative, padHeight: real, cruiseElevation: real, turn: real,
	arrival: flightLeg, departure: flightLeg, lastExit: real,
});
const deployment = {
	...xy, life: real, drop: opt(v.object({ flight: count, lane: real, delay: nonnegative })),
	perimeter: opt(v.object({ start: point, end: point })),
};
const warning = v.pipe(v.variant('kind', [
	v.object({ ...deployment, kind: v.picklist(mobileKinds), commander: opt(bool), frameId: opt(frame), formation: opt(count) }),
	v.object({ ...deployment, kind: v.literal('artillery') }),
]), v.check(function (warning) { return !(warning.drop && warning.perimeter); }));
const structure = v.pipe(v.object({ ...xy, hp: nonnegative, maxHp: positive }), v.check(function (s) { return s.hp <= s.maxHp; }));
const mission = v.object({
	stage: v.picklist(['active', 'extract']), structure: v.optional(structure), raidTargets: opt(v.array(structure)),
	captureSites: opt(v.array(v.object({ ...xy, holdTime: nonnegative, complete: bool }))), acquisitionTime: opt(nonnegative),
	defenseArrivalRadius: opt(nonnegative), targetId: v.optional(integer), progress: count, required: v.pipe(count, v.minValue(1)), extractTime: nonnegative,
});

export const sortieSchema = v.object({
	version: v.literal(1), contractId: text, contractKind: v.picklist(['defend', 'demolition', 'assassination', 'clearance', 'raid', 'recovery', 'acquisition']),
	rigs: opt(v.object({ commander: rigId, wing: v.array(rigId) })), seed: integer, phase: v.literal('combat'), difficulty: v.picklist(['story', 'standard', 'veteran']),
	frame, loadout: mounts, player: v.object({ ...rigBody, travelAngle: opt(real), arcadeBacking: opt(bool) }), authoredPose: opt(pose),
	squadmates: v.pipe(v.array(mate), v.maxLength(SQUAD_SIZE - 1)), mission, stats: v.object({
		damageDealt: nonnegative, damageTaken: nonnegative, relayDamage: nonnegative, shotsFired: count, shotsHit: count, overheats: count, killScore: nonnegative, commanderDestroyed: bool,
	}),
	relay: hp, wave: v.pipe(count, v.minValue(1)), spawned: count, spawnIn: real, intermission: real, cannonIn: real,
	time: nonnegative, kills: count, shake: nonnegative, outcome: v.picklist(['playing', 'won', 'lost']), nextId: v.pipe(count, v.minValue(1)),
	coolantCharges: v.pipe(count, v.maxValue(3)), coolantHeld: bool, beams: v.array(beam), strikes: v.array(strike), enemies: v.array(unit),
	shots: v.array(shot), effects: v.array(effect), wrecks: v.array(wreck), flights: v.array(flight), warnings: v.array(warning),
});
