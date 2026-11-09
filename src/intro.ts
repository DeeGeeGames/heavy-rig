import { createMount } from './arsenal';
import { keyLabel, padLabel, type ControllerBindings, type KeyboardBindings } from './bindings';
import { getFrame, type FrameId } from './frames';
import type { ControlMode } from './profile';
import { createState, type State } from './simulation';

export const INTRO_LINES = [
	"They haven't seen me yet.",
	'Just a little more to the Rig Bay.',
	"Then I'm finally free...",
	"Made it. Now, let's see what my terrible hosts will be lending me.",
] as const;
export const SADDLE_LINES = [
	'Its good to be back in the saddle.',
	'Now, I just have to pray to God that they got my signal...',
] as const;
export const INTRO_FRAMES = ['kestrel', 'longbow'] as const satisfies readonly FrameId[];
export type IntroFrame = typeof INTRO_FRAMES[number];

// Each line owns its typing, full-text hold, and fade. Carry surplus frame time
// through line boundaries so a slow frame cannot shorten the next line's hold.
export const narrativeFrame = function (lines: readonly string[], elapsed: number) {
	let remaining = Math.max(0, elapsed);
	for (const [index, line] of lines.entries()) {
		const typing = line.length / 5;
		const duration = typing + 3 + 2;
		if (remaining < duration) return {
			index, text: line.slice(0, Math.min(line.length, Math.floor((remaining + 1e-8) * 5))),
			opacity: Math.max(0, Math.min(1, 1 - (remaining - typing - 3) / 2)), done: false,
		};
		remaining -= duration;
	}
	return { index: lines.length, text: '', opacity: 0, done: true };
};

export const createEscape = function (frame: IntroFrame): State {
	const state = createState({ frame, difficulty: 'story', seed: 74156863 });
	const drop = { x: 220, y: 220 };
	const extraction = { x: 2380, y: 1780 };
	const heading = Math.atan2(extraction.y - drop.y, extraction.x - drop.x);
	state.player = { ...state.player, ...drop, angle: heading, turret: heading };
	state.loadout = frame === 'kestrel'
		? [0, 1].map(function (slot) { return { ...createMount('machine-gun'), slot }; })
		: [{ ...createMount(getFrame(frame).starter), slot: 0 }];
	// The escape uses the existing extraction, navigation marker, minimap, and
	// enemy rules. It has no company contract and never settles campaign rewards.
	state.mission = {
		contract: { id: 'intro-escape', seed: state.seed, planetId: 'meridian', kind: 'clearance', employer: 'freeholds', opponent: 'combine', title: 'Stolen freedom', briefing: 'Reach the evacuation point.', reward: 0, favor: 0, hostility: 0, tier: 1, requiredReputation: 0 },
		map: {
			seed: state.seed, biome: 'badlands', width: 2600, height: 2000, drop, objective: extraction, extraction,
			sites: [], landmarks: [
				{ x: 160, y: 400, radius: 90, rotation: 0, kind: 'depot' },
				{ x: 510, y: 160, radius: 110, rotation: 0, kind: 'depot' },
				{ x: 1050, y: 380, radius: 80, rotation: 0.4, kind: 'rocks' },
				{ x: 800, y: 1200, radius: 100, rotation: 0.8, kind: 'crater' },
				{ x: 1920, y: 850, radius: 90, rotation: 0.2, kind: 'depot' },
				{ x: 1600, y: 1730, radius: 90, rotation: 0.7, kind: 'rocks' },
			],
		},
		stage: 'extract', structure: undefined, targetId: undefined, progress: 0, required: 0, extractTime: 0,
	};
	state.spawnIn = 3600;
	state.enemies = [
		{ x: 2000, y: 1150 },
		{ x: 2240, y: 1540 },
	].map(function (point) { return { ...point, id: state.nextId++, angle: heading + Math.PI, hp: 120, maxHp: 120, cooldown: 5, heavy: false, kind: 'scout' as const, engaged: false }; });
	return state;
};

export interface EscapePrompts {
	device: 'keyboard' | 'gamepad' | 'touch';
	keyboard: KeyboardBindings;
	controller: ControllerBindings;
	controlMode: ControlMode;
	buttonLabel?: (index: number) => string;
}
export const escapeMessage = function (time: number, prompts: EscapePrompts): string {
	const key = function (action: keyof KeyboardBindings) { return prompts.keyboard[action].map(keyLabel).join(' / ') || 'the on-screen control'; };
	const button = prompts.buttonLabel ?? padLabel;
	const arcade = prompts.controlMode === 'arcade' && prompts.device !== 'touch';
	const drive = prompts.device === 'touch' ? 'Hold + to raise throttle; release to cruise.'
		: prompts.device === 'gamepad' ? arcade ? 'Point the left stick to move; release to slow.' : 'Left stick up/down sets throttle; release to cruise.'
			: arcade ? `${key('forward')} / ${key('back')} / ${key('left')} / ${key('right')} move; release to slow.` : `${key('forward')} raises throttle; ${key('back')} lowers it. Release to cruise.`;
	const steer = prompts.device === 'touch' ? 'Hold the turn arrows to steer. STOP brings you to neutral.'
		: prompts.device === 'gamepad' ? `${arcade ? 'Left stick chooses your direction.' : 'Left stick left/right turns your legs.'} ${button(prompts.controller.stop)} stops.`
			: `${arcade ? 'Movement keys choose your direction.' : `${key('left')} / ${key('right')} turn your legs.`} ${key('stop')} stops.`;
	const aim = prompts.device === 'touch' ? 'Tap the field to aim. Hold a weapon button to fire.'
		: prompts.device === 'gamepad' ? `${arcade ? 'Right stick aims.' : 'Right stick left/right turns your torso.'} Hold ${button(prompts.controller['mount-0'])} to fire.`
			: `Mouse aims independently of your legs. Hold ${key('mount-0')} to fire.`;
	const coolant = prompts.device === 'touch' ? 'VENT COOLANT' : prompts.device === 'gamepad' ? button(prompts.controller.coolant) : key('coolant');
	if (time < 7) return `ALARMS ARE UP. Head southeast to the green evacuation point. ${drive}`;
	if (time < 9) return '';
	if (time < 16) return steer;
	if (time < 18) return '';
	if (time < 26) return `Security ahead. ${aim} Fight or keep moving.`;
	if (time < 28) return '';
	if (time < 35) return `Weapons build heat. ${coolant} vents it. You don't have to destroy every guard.`;
	if (time < 38) return '';
	return 'Reach the green evacuation point in the bottom-right of the map. Hold inside it for 3 seconds.';
};
