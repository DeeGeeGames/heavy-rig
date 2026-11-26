import { defaultKeyboard, defaultController, keyLabel, padLabel, type KeyboardBindings, type ControllerBindings } from './bindings';
import type { ControlMode } from './profile';
import { createMount, getWeapon, type WeaponId } from './arsenal';
import { loadedMounts } from './combat-resources';
import { RIG_RADIUS } from './combat-spatial';
import type { FrameId } from './frames';
import { isFrameLoadout } from './hardpoints';
import { RIG_COLLAPSE_SECONDS, angleDelta, createEnemyLoadout, createState, distance, step, type Controls, type CombatStateView } from './simulation';

export const TRAINING_STAGES = ['drive', 'neutral', 'steer', 'cannon', 'missiles', 'combined', 'heat', 'coolant', 'evade', 'complete'] as const;
export type TrainingStage = typeof TRAINING_STAGES[number];
export interface Training {
	state: CombatStateView;
	stage: TrainingStage | 'range';
	distance: number;
	turn: number;
	combinedTime: number;
}

export interface TrainingSetup {
	frame: FrameId;
	loadout: readonly (WeaponId | null)[];
	reserves: readonly number[];
}

const RANGE_LANE_X = 650;

const practiceTarget = function (state: CombatStateView, x: number, y: number) {
	return { id: state.nextId++, x, y, angle: Math.atan2(state.player.y - y, state.player.x - x), hp: 150, maxHp: 150, cooldown: Infinity, heavy: false, kind: 'scout' as const, stationary: true as const, loadout: createEnemyLoadout('scout'), reactor: { heat: 0, overheated: false } };
};

const placeRangeTargets = function (state: CombatStateView) {
	state.wrecks = [];
	state.enemies = [practiceTarget(state, RANGE_LANE_X, 625), practiceTarget(state, RANGE_LANE_X + 65, 565), practiceTarget(state, RANGE_LANE_X, 520)];
};

// A separate, unscored range uses the same drive, weapons and warning rules as
// the operation. It never owns or writes the player's profile.
export const createTraining = function (setup?: TrainingSetup): Training {
	const state = createState({ difficulty: 'story', frame: setup?.frame ?? 'warden' });
	if (setup && !isFrameLoadout(setup.frame, setup.loadout)) throw new RangeError(`Invalid training loadout for ${setup.frame}`);
	state.loadout = setup ? loadedMounts(setup.loadout, setup.reserves) : loadedMounts(['autocannon', 'machine-gun', 'cluster-missiles', 'stream-rockets']);
	state.spawnIn = 3600;
	if (setup) {
		state.player.x = RANGE_LANE_X;
		placeRangeTargets(state);
	}
	return { state, stage: setup ? 'range' : 'drive', distance: 0, turn: 0, combinedTime: 0 };
};

const placeTarget = function (state: CombatStateView) {
	const p = state.player;
	const x = Math.max(80, Math.min(1720, p.x + Math.cos(p.turret) * 140));
	const y = Math.max(80, Math.min(1120, p.y + Math.sin(p.turret) * 140));
	state.enemies = [practiceTarget(state, x, y)];
};

const advance = function (training: Training, stage: TrainingStage) {
	training.stage = stage;
	if (stage === 'cannon' || stage === 'missiles' || stage === 'combined') placeTarget(training.state);
	if (stage === 'combined') { training.state.player.heat = 0; training.state.player.overheated = false; }
	if (stage === 'heat') {
		training.state.frame = 'warden-b';
		training.state.loadout = [{ ...createMount('laser'), slot: 2 }];
		training.state.enemies = []; training.state.shots = []; training.state.player.heat = 0;
		training.state.player.overheated = false;
	}
	if (stage === 'coolant') training.state.coolantCharges = 3;
	if (stage === 'evade') {
		const { state } = training;
		// Start the committed-strike exercise with clear runway in every direction.
		state.player.x = 900; state.player.y = 780;
		state.player.angle = -Math.PI / 2; state.player.turret = -Math.PI / 2;
		state.player.throttle = 0; state.player.speed = 0;
		state.shots = [];
		const x = 620, y = 630;
		state.enemies = [{
			id: state.nextId++, kind: 'artillery', heavy: true, stationary: true,
			x, y, angle: Math.atan2(state.player.y - y, state.player.x - x),
			hp: 50, maxHp: 50, cooldown: 0, loadout: createEnemyLoadout('artillery'), reactor: { heat: 0, overheated: false },
		}];
	}
};

const retryDryDrill = function (training: Training) {
	const state = training.state;
	const slots = training.stage === 'cannon' ? [0] : training.stage === 'missiles' ? [2] : training.stage === 'combined' ? [0, 1, 2, 3] : [];
	const dry = state.loadout.some(function (mount, index) {
		return slots.includes(mount.slot ?? index) && getWeapon(mount.weapon).ammunition !== null && mount.rounds === 0;
	});
	// Simulator retries wait for launched rounds and staggered volleys. Normal
	// missions never call this hook, so expended combat supplies stay expended.
	if (!dry || state.shots.length > 0 || state.loadout.some(function (mount) { return mount.rocketVolley !== undefined; })) return;
	state.loadout = state.loadout.map(function (mount) { return { ...createMount(mount.weapon), ...(mount.slot === undefined ? {} : { slot: mount.slot }) }; });
	state.player.heat = 0; state.player.overheated = false;
	training.combinedTime = 0;
	placeTarget(state);
};

export interface TrainingBefore { x: number; y: number; angle: number; hits: number }
export const trainingFireSlot = function (stage: TrainingStage | undefined): number {
	return stage === 'cannon' ? 0 : stage === 'missiles' || stage === 'heat' || stage === 'evade' ? 2 : -1;
};

export const prepareTraining = function (training: Training, controls: Controls): Controls {
	const state = training.state;
	state.spawnIn = 3600;
	if (training.stage === 'range') return controls;
	retryDryDrill(training);
	if (training.stage === 'coolant') state.player.heat = Math.max(45, state.player.heat);
	const slot = trainingFireSlot(training.stage);
	return { ...controls, fire: training.stage === 'combined' ? controls.fire : [slot === 0 && controls.fire[0], false, slot === 2 && controls.fire[2], false], coolant: training.stage === 'coolant' && controls.coolant };
};
export const finishTraining = function (training: Training, controls: Controls, dt: number, before: TrainingBefore) {
	const state = training.state;
	// A missed drill is a retry, never a defeat or scored kill.
	state.player.hp = 100; state.relay = 100;
	state.outcome = 'playing'; state.phase = 'combat';
	if (training.stage === 'range') {
		if (state.enemies.length === 0 && !state.wrecks.some(function (wreck) {
			return wreck.rig && state.time - wreck.rig.defeatedAt < RIG_COLLAPSE_SECONDS;
		})) placeRangeTargets(state);
		return;
	}
	training.distance += distance(before, state.player);
	training.turn += Math.abs(angleDelta(before.angle, state.player.angle));
	if (training.stage === 'drive' && training.distance >= 100) advance(training, 'neutral');
	else if (training.stage === 'neutral' && controls.stop && Math.abs(state.player.speed) < 8) {
		training.turn = 0; advance(training, 'steer');
	} else if (training.stage === 'steer' && training.turn >= Math.PI / 3) advance(training, 'cannon');
	else if (training.stage === 'cannon' && state.stats.shotsHit > before.hits) {
		state.shots = []; state.enemies = []; advance(training, 'missiles');
	} else if (training.stage === 'missiles' && state.stats.shotsHit > before.hits) {
		state.shots = []; state.enemies = []; advance(training, 'combined');
	} else if (training.stage === 'combined') {
		if (controls.fire.filter(Boolean).length >= 2 && !state.player.overheated) training.combinedTime += Math.min(Math.max(0, dt), 0.04);
		else training.combinedTime = 0;
		if (training.combinedTime >= 0.8) advance(training, 'heat');
	} else if (training.stage === 'heat' && state.player.heat >= 45) advance(training, 'coolant');
	else if (training.stage === 'coolant' && state.events.includes('coolant')) advance(training, 'evade');
	else if (training.stage === 'evade') {
		if (state.events.includes('artillery')) training.distance = 0;
		if (state.strikes.length) return;
		const gun = state.enemies[0];
		if (!gun) { advance(training, 'complete'); return; }
		// With the one practice gun alive, its shell is the only explosion.
		if (!state.events.includes('explosion')) return;
		if (training.distance >= RIG_RADIUS && !state.events.includes('player-hit')) { advance(training, 'complete'); return; }
		const mortar = gun.loadout?.[0];
		if (mortar?.rounds === 0) mortar.rounds = getWeapon(mortar.weapon).ammunition?.defaultLoad ?? 0;
	}
};
export const stepTraining = function (training: Training, controls: Controls, dt: number) {
	if (training.stage === 'complete') { training.state.events = []; return; }
	const state = training.state;
	const before = { x: state.player.x, y: state.player.y, angle: state.player.angle, hits: state.stats.shotsHit };
	step(state, prepareTraining(training, controls), dt);
	finishTraining(training, controls, dt, before);
};

export const trainingCopy = function (stage: TrainingStage, controller: boolean, mappings: { keyboard: KeyboardBindings; controller: ControllerBindings; controlMode?: ControlMode; touch?: boolean; buttonLabel?: (index: number) => string } = { keyboard: defaultKeyboard(), controller: defaultController() }): { title: string; instruction: string; progress: string } {
	const key = function (action: keyof KeyboardBindings) { return mappings.keyboard[action].map(keyLabel).join(' / ') || 'the on-screen control'; };
	const arcade = mappings.touch || mappings.controlMode === 'arcade';
	const buttonLabel = mappings.buttonLabel ?? padLabel;
	const controls = mappings.touch
		? { drive: 'Point the left stick toward your heading; push farther for more speed', stop: 'Hold STOP', steer: 'Point the left stick toward a new direction', aim: 'Tap the target to track it, or use NEXT', cannon: 'FIRE with mount 1 armed', mountThree: 'FIRE with mount 3 armed', coolant: 'VENT' }
		: controller
		? { drive: 'Press D-pad up or push the left stick up', stop: `Hold ${buttonLabel(mappings.controller.stop)}`, steer: arcade ? 'Choose a new direction with the D-pad or left stick' : 'Press D-pad left/right or move the left stick left/right', aim: arcade ? 'Point the right stick at the target' : 'Hold the right stick left or right to rotate the torso', cannon: buttonLabel(mappings.controller['mount-0']), mountThree: buttonLabel(mappings.controller['mount-2']), coolant: buttonLabel(mappings.controller.coolant) }
		: { drive: `Hold ${key('forward')}`, stop: `Hold ${key('stop')}`, steer: arcade ? `Use ${key('forward')} / ${key('back')} / ${key('left')} / ${key('right')} to choose a direction` : `Hold ${key('left')} / ${key('right')}`, aim: 'Point at the target', cannon: key('mount-0'), mountThree: key('mount-2'), coolant: key('coolant') };
	const copy: Record<TrainingStage, [string, string]> = {
		drive: ['SET THE FRAME IN MOTION', `${controls.drive} to move. ${arcade ? 'Keep holding to travel; release to slow.' : 'Release it to cruise.'} Travel 100 meters.`],
		neutral: ['BRING IT TO NEUTRAL', `${controls.stop} until the frame settles. Neutral cuts engine demand; eighty tons still need time to stop.`],
		steer: ['TURN THE HULL', `${controls.steer}. The hull and your turret turn independently.`],
		cannon: ['PUT A ROUND ON TARGET', `${controls.aim}; use ${controls.cannon}. Ammunition is finite; this simulator reloads dry weapons for retries.`],
		missiles: ['GUIDED FIRE', `${controls.aim}; use ${controls.mountThree}. Select the target with NEXT / nearest, hold it in the firing arc for 1.5 seconds, then fire. Trident follows the acquired target. Firing ammunition sheds weight and improves speed.`],
		combined: ['COMBINE YOUR FIRE', mappings.touch ? 'Tap at least two mount chips to arm them, then hold FIRE. All mounts share reactor heat.' : 'Hold any two mapped weapon inputs or on-screen mounts together for a moment. Warden has two ballistic guns and two launcher pods; all share reactor heat.'],
		heat: ['FEEL THE REACTOR', `Switched to Warden B: ARC draws reactor power and builds heat. Hold ${controls.mountThree} to build heat to 45%.`],
		coolant: ['VENT THE HEAT', `Press ${controls.coolant}. One charge purges 55 heat. At 100% heat, weapons lock until heat falls to 35%.`],
		evade: ['CLEAR THE IMPACT ZONE', `${controls.drive} when the orange circle appears. Travel at least ${RIG_RADIUS} m and finish outside the circle. To destroy the gun emplacement, aim at it and use ${controls.mountThree}.`],
		complete: ['FRAME QUALIFICATION COMPLETE', 'You are ready for the operation. Flank armored siege frames and strike while they recover from a barrage.'],
	};
	const [title, instruction] = copy[stage];
	return { title, instruction, progress: `${Math.min(TRAINING_STAGES.length - 1, TRAINING_STAGES.indexOf(stage) + 1)} / ${TRAINING_STAGES.length - 1}` };
};
