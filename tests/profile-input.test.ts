import { describe, expect, test } from 'bun:test';
import { createGamepadInput, type GamepadSnapshot } from '../src/gamepad';
import { addOperationRecord, defaultSettings, parseProfile } from '../src/profile';
import { createControllerFeedback } from '../src/controller-feedback';

const pad = function (pressed: number[] = [], axes = [0, 0, 0, 0], index = 0, id = `Controller ${index}`): GamepadSnapshot {
	return { axes, buttons: Array.from({ length: 17 }, function (_, at) { return { pressed: pressed.includes(at), touched: pressed.includes(at), value: pressed.includes(at) ? 1 : 0 }; }), connected: true, index, id, mapping: 'standard' };
};
const claimedInput = function () {
	const input = createGamepadInput(); input.read([pad()], 0); input.read([pad([0])], 4); input.read([pad()], 8);
	return input;
};
// Gamepad exposes its fields as prototype accessors in the browser.
class NativeGamepadSnapshot implements GamepadSnapshot {
	private readonly snapshot: GamepadSnapshot;
	constructor(snapshot: GamepadSnapshot) { this.snapshot = snapshot; }
	get axes() { return this.snapshot.axes; }
	get buttons() { return this.snapshot.buttons; }
	get connected() { return this.snapshot.connected; }
	get id() { return this.snapshot.id; }
	get index() { return this.snapshot.index; }
	get mapping() { return this.snapshot.mapping; }
}
describe('Heavy Rig player preferences and input boundaries', function () {
	test('native gamepads with an empty mapping use standard button and axis indices', function () {
		const input = createGamepadInput();
		const raw = function (buttons: number[] = [], axes = [0, 0, 0, 0, 0, 0]): GamepadSnapshot {
			return new NativeGamepadSnapshot({ ...pad(buttons, axes), mapping: '' });
		};
		const claim = input.read([raw([7])], 0);
		expect(claim.claimed).toBe(true); expect(claim.confirm).toBe(false); expect(claim.fire[0]).toBe(false);
		expect(claim.id).toBe(raw().id); expect(claim.index).toBe(0);
		expect(input.read([raw([12])], 16).ready).toBe(false);
		input.read([raw()], 32);
		const x = input.read([raw([2], [0, 0, 0, 0, 0, -1])], 48);
		expect(x.confirm).toBe(false); expect(x.discard).toBe(true); expect(x.stop).toBe(true);
		expect(x.direction).toBeUndefined(); expect(x.drive).toBe(0);
		const active = input.read([raw([0, 1, 4, 5, 6, 7, 9, 12, 15], [0, 0, 1, -1])], 64);
		expect(active.confirm).toBe(true); expect(active.back).toBe(true); expect(active.pause).toBe(true); expect(active.direction).toBe('up');
		expect(active.fire).toEqual([true, true, true, true]); expect(active.coolant).toBe(true);
		expect(active.drive).toBe(1); expect(active.turn).toBe(1); expect(active.aimX).toBe(1); expect(active.aimY).toBe(-1);
		for (const [button, direction, drive, turn] of [[13, 'down', -1, 0], [14, 'left', 0, -1], [15, 'right', 0, 1]] as const) {
			const move = input.read([raw([button])], 80);
			expect(move.direction).toBe(direction); expect(move.drive).toBe(drive); expect(move.turn).toBe(turn);
		}
		input.requireNeutral();
		expect(input.read([raw([7])], 96).fire[0]).toBe(false);
		input.read([raw()], 112);
		const remapped = { ...defaultSettings().controller, 'mount-0': 3 };
		expect(input.read([raw([3])], 128, remapped).fire[0]).toBe(true);
		expect(input.read([raw([7])], 144, remapped).fire[0]).toBe(false);
		const lost = input.read([], 160);
		expect(lost.lost).toBe(true); expect(lost.fire).toEqual([false, false, false, false]);
		expect(input.read([raw([9])], 176).claimed).toBe(false);
		input.read([raw()], 192);
		const reclaim = input.read([raw([9])], 208);
		expect(reclaim.claimed).toBe(true); expect(reclaim.pause).toBe(false);
	});
	test('skin choices survive reload while historical preferences and invalid skin values stay usable', function () {
		const old = parseProfile(JSON.stringify({ settings: { master: 0.35, controlMode: 'simulation' } }));
		expect(old.settings).toMatchObject({ mechSkin: 'freeholds', master: 0.35, legControls: 'tank', torsoAim: 'rotate' });
		for (const mechSkin of ['original', 'freeholds', 'accord', 'freeholds-caps', 'combine-field', 'accord-flank'] as const) {
			const profile = { ...old, settings: { ...old.settings, mechSkin } };
			expect(parseProfile(JSON.stringify(profile)).settings).toEqual(profile.settings);
		}
		for (const mechSkin of ['combine', 'combine-camo', 'accord-unknown', null, {}, 7]) expect(parseProfile(JSON.stringify({ settings: { mechSkin } })).settings.mechSkin).toBe('freeholds');
	});
	test('corrupt or partial storage cannot prevent deployment or introduce invalid settings', function () {
		expect(parseProfile('{broken')).toEqual({ settings: defaultSettings(), records: [], bests: [] });
		const profile = parseProfile(JSON.stringify({ settings: { master: 90, music: -5, effects: 'loud', difficulty: 'impossible', touchControls: 'false' }, records: [{ score: 100 }, null] }));
		expect(profile.settings.master).toBe(1); expect(profile.settings.music).toBe(0); expect(profile.settings.effects).toBe(0.85);
		expect(profile.settings.difficulty).toBe('standard'); expect(profile.settings.touchControls).toBe(false); expect(profile.records).toEqual([]);
	});
	test('historical difficulty records survive bounded recent history and storage reload', function () {
		let profile = addOperationRecord(parseProfile(null), { difficulty: 'standard', won: true, score: 18000, rank: 'S', kills: 39, wave: 5, time: 300, relay: 90 });
		for (let index = 0; index < 12; index++) profile = addOperationRecord(profile, { difficulty: 'standard', won: false, score: 200, rank: 'D', kills: 1, wave: 1, time: 30, relay: 0 });
		const restored = parseProfile(JSON.stringify(profile));
		expect(restored.records).toHaveLength(8); expect(restored.bests[0]?.score).toBe(18000);
	});
	test('menu buttons trigger only once until released, and disconnect clears firing and axes', function () {
		const input = claimedInput();
		const first = input.read([pad([9, 7], [0.5, -1, 1, 0])], 16);
		expect(first.pause).toBe(true); expect(first.fire[0]).toBe(true); expect(first.drive).toBe(1); expect(first.aimX).toBe(1);
		expect(input.read([pad([9, 7])], 32).pause).toBe(false);
		const lost = input.read([], 48); expect(lost.connected).toBe(false); expect(lost.fire[0]).toBe(false); expect(lost.drive).toBeCloseTo(0); expect(lost.turn).toBe(0);
		input.read([pad()], 64); const reclaim = input.read([pad([9])], 80);
		expect(reclaim.claimed).toBe(true); expect(reclaim.pause).toBe(false);
		input.read([pad()], 96); expect(input.read([pad([9])], 112).pause).toBe(true);
	});
	test('all four shoulder inputs fire independently and coolant is isolated on B', function () {
		const input = claimedInput();
		for (const [slot, button] of [7, 6, 5, 4].entries()) {
			const result = input.read([pad([button])], 16 + slot * 16);
			expect(result.fire).toEqual([slot === 0, slot === 1, slot === 2, slot === 3]);
			expect(result.coolant).toBe(false);
		}
		const volley = input.read([pad([4, 5, 6, 7])], 100);
		expect(volley.fire).toEqual([true, true, true, true]); expect(volley.coolant).toBe(false);
		const purge = input.read([pad([1, 4, 5, 6, 7])], 116);
		expect(purge.fire).toEqual([true, true, true, true]); expect(purge.coolant).toBe(true);
		input.requireNeutral();
		const heldBack = input.read([pad([1])], 132);
		expect(heldBack.ready).toBe(false); expect(heldBack.coolant).toBe(false);
		input.read([pad()], 148);
		expect(input.read([pad([1])], 164).coolant).toBe(true);
		input.requireNeutral();
		expect(input.read([pad([4, 5, 6, 7])], 180).fire).toEqual([false, false, false, false]);
		input.read([pad()], 196);
		expect(input.read([pad([4, 5, 6, 7])], 212).fire).toEqual([true, true, true, true]);
	});
	test('stick drift is ignored and menu navigation repeats at a bounded rate', function () {
		const input = claimedInput(); const drifting = input.read([pad([], [0.12, -0.09, 0.03, -0.1])], 10);
		expect(drifting.drive).toBeCloseTo(0); expect(drifting.turn).toBe(0); expect(drifting.aimX).toBe(0); expect(drifting.navigate).toBe(0);
		expect(input.read([pad([13])], 16).navigate).toBe(1);
		expect(input.read([pad([13])], 32).navigate).toBe(0);
		expect(input.read([pad([13])], 450).navigate).toBe(1);
	});
	test('another connected pad cannot silently replace a disconnected pilot or spend the claim press', function () {
		const input = createGamepadInput(); input.read([pad(), pad([], undefined, 1)], 0);
		const claim = input.read([pad([0]), pad([], undefined, 1)], 16);
		expect(claim.claimed).toBe(true); expect(claim.confirm).toBe(false); expect(claim.index).toBe(0);
		input.read([pad(), pad([], undefined, 1)], 32);
		const lost = input.read([null, pad([0, 7], undefined, 1)], 48);
		expect(lost.lost).toBe(true); expect(lost.connected).toBe(false); expect(lost.fire[0]).toBe(false);
		expect(input.read([null, pad([0, 7], undefined, 1)], 64).connected).toBe(false);
		input.read([null, pad([], undefined, 1)], 80);
		const replacement = input.read([null, pad([0, 7], undefined, 1)], 96);
		expect(replacement.claimed).toBe(true); expect(replacement.index).toBe(1); expect(replacement.confirm).toBe(false); expect(replacement.fire[0]).toBe(false);
		expect(input.read([null, pad([7], undefined, 1)], 112).fire[0]).toBe(false);
		input.read([null, pad([], undefined, 1)], 128);
		expect(input.read([null, pad([7], undefined, 1)], 144).fire[0]).toBe(true);
	});
	test('a higher-slot pilot keeps ownership when an idle lower-slot controller connects', function () {
		const input = createGamepadInput(); input.read([null, pad([], undefined, 1)], 0); input.read([null, pad([0], undefined, 1)], 16);
		input.read([pad(), pad([], undefined, 1)], 32);
		const active = input.read([pad([7]), pad([6], undefined, 1)], 48);
		expect(active.index).toBe(1); expect(active.fire[1]).toBe(true); expect(active.fire[0]).toBe(false); expect(active.lost).toBe(false);
		const swapped = input.read([pad(), pad([], undefined, 1, 'Replacement')], 64);
		expect(swapped.lost).toBe(true); expect(swapped.connected).toBe(false);
	});
	test('menu transitions suppress held driving, weapons and menu navigation until neutral', function () {
		const input = claimedInput();
		expect(input.read([pad([7], [1, -1, 0, 1])], 16).fire[0]).toBe(true);
		input.requireNeutral();
		const held = input.read([pad([7], [1, -1, 0, 1])], 32);
		expect(held.fire[0]).toBe(false); expect(held.drive).toBe(0); expect(held.turn).toBe(0); expect(held.aimY).toBe(0); expect(held.scroll).toBe(0); expect(held.navigate).toBe(0);
		input.read([pad()], 48);
		const resumed = input.read([pad([7], [0, -1, 1, 0])], 64);
		expect(resumed.fire[0]).toBe(true); expect(resumed.drive).toBe(1); expect(resumed.aimX).toBe(1);
		expect(input.read([pad([], [0, 0, 0, 1])], 80).scroll).toBe(1);
	});
	test('any browser-exposed button can claim on first exposure or after a neutral sample, without activating controls', function () {
		for (const button of pad().buttons.keys()) {
			for (const exposedBeforePress of [false, true]) {
				const input = createGamepadInput();
				input.requireNeutral();
				if (exposedBeforePress) expect(input.read([pad()], 0).connected).toBe(false);
				const claim = input.read([pad([button])], 16);
				expect(claim.claimed).toBe(true); expect(claim.ready).toBe(false);
				expect(claim.confirm).toBe(false); expect(claim.pause).toBe(false); expect(claim.navigate).toBe(0);
				expect(claim.fire).toEqual([false, false, false, false]);
			}
		}
		const input = createGamepadInput();
		expect(input.read([pad([0])], 48).confirm).toBe(false);
		expect(input.read([pad([0])], 64).confirm).toBe(false);
		input.read([pad()], 80); expect(input.read([pad([0])], 96).confirm).toBe(true);
	});
	test('controller feedback stops when disabled and hardware failures cannot interrupt play or cleanup', async function () {
		let pulses = 0; let stops = 0;
		const vibrationActuator: Pick<GamepadHapticActuator, 'playEffect' | 'reset'> = {
			playEffect: async function () { pulses++; throw new Error('Device disconnected'); },
			reset: async function () { stops++; throw new Error('Device disconnected'); },
		};
		const device = { index: 0, id: 'Test controller', connected: true, vibrationActuator };
		const feedback = createControllerFeedback(); feedback.update(device, true); feedback.play(['cannon'], 0); feedback.play(['cannon'], 16);
		expect(pulses).toBe(1);
		feedback.update(device, false); feedback.play(['player-hit'], 100);
		expect(stops).toBe(1); expect(pulses).toBe(1);
		feedback.update(device, true); await feedback.dispose(); expect(stops).toBe(2);
		feedback.play(['cannon'], 200); expect(pulses).toBe(1);
	});
	test('buttons pressed while the page is away must be released before they can resume or confirm', function () {
		const input = claimedInput(); input.suspend();
		const returned = input.read([pad([0, 9, 13], [0, -1, 0, 1])], 5000);
		expect(returned.pause).toBe(false); expect(returned.confirm).toBe(false); expect(returned.navigate).toBe(0); expect(returned.scroll).toBe(0);
		const held = input.read([pad([0, 9, 13])], 5100);
		expect(held.pause).toBe(false); expect(held.confirm).toBe(false); expect(held.navigate).toBe(0);
		input.read([pad()], 5200);
		expect(input.read([pad([0])], 5300).confirm).toBe(true);
		input.read([pad()], 5400); expect(input.read([pad([9])], 5500).pause).toBe(true);
	});
});
