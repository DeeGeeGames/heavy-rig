import { expect, test } from 'bun:test';
import { createGamepadInput, type GamepadSnapshot } from '../src/gamepad';

const pad = function (buttons: readonly number[] = [], axes: readonly number[] = [0, 0, 0, 0], index = 0, id = 'Xbox controller'): GamepadSnapshot {
	return {
		axes, connected: true, mapping: 'standard', index, id,
		buttons: Array.from({ length: 18 }, function (_, button) { return { pressed: buttons.includes(button), touched: false, value: buttons.includes(button) ? 1 : 0 }; }),
	};
};
const claimed = function () {
	const input = createGamepadInput();
	input.read([pad()], 0); input.read([pad([0])], 1); input.read([pad()], 2);
	return input;
};

test('department and page edges are separate, single-press commands and keep combat mappings', function () {
	const input = claimed();
	const leftDepartment = input.read([pad([4])], 10);
	expect(leftDepartment.department).toBe(-1); expect(leftDepartment.page).toBe(0);
	expect(leftDepartment.fire).toEqual([false, false, false, true]);
	expect(input.read([pad([4])], 1000).department).toBe(0);
	input.read([pad()], 1001);
	expect(input.read([pad([5])], 1002).department).toBe(1);
	input.read([pad()], 1003);
	expect(input.read([pad([6])], 1004).page).toBe(-1);
	input.read([pad()], 1005);
	expect(input.read([pad([7])], 1006).page).toBe(1);
	expect(input.read([pad([7])], 2000).page).toBe(0);
	input.read([pad()], 2001);
	const opposed = input.read([pad([4, 5, 6, 7])], 2002);
	expect(opposed.department).toBe(0); expect(opposed.page).toBe(0);
	expect(opposed.fire).toEqual([true, true, true, true]);
});

test('held shoulder and utility buttons must release across screen or focus transitions', function () {
	for (const button of [2, 3, 4, 5, 6, 7]) {
		const input = claimed();
		input.read([pad([button])], 10);
		input.requireNeutral();
		const held = input.read([pad([button])], 20);
		expect(held.department).toBe(0); expect(held.page).toBe(0); expect(held.help).toBe(false); expect(held.discard).toBe(false);
		expect(held.fire).toEqual([false, false, false, false]);
		// Releasing A alone is not enough while a menu shoulder/utility remains held.
		expect(input.read([pad([button, 0])], 30).confirm).toBe(false);
		input.read([pad()], 40);
		expect(input.read([pad([0])], 50).confirm).toBe(true);
		input.suspend();
		const resumed = input.read([pad([button])], 60);
		expect(resumed.department).toBe(0); expect(resumed.page).toBe(0); expect(resumed.help).toBe(false); expect(resumed.discard).toBe(false);
		input.read([pad()], 70);
		const fresh = input.read([pad([button])], 80);
		if (button === 2) expect(fresh.discard).toBe(true);
		if (button === 3) expect(fresh.help).toBe(true);
		if (button === 4) expect(fresh.department).toBe(-1);
		if (button === 5) expect(fresh.department).toBe(1);
		if (button === 6) expect(fresh.page).toBe(-1);
		if (button === 7) expect(fresh.page).toBe(1);
	}
});

test('the claimed controller supplies identity and inactive pads cannot navigate or change prompt activity', function () {
	const input = createGamepadInput();
	const sony = function (buttons: readonly number[] = []) { return pad(buttons, undefined, 1, 'DualSense Wireless Controller (054c)'); };
	input.read([pad(), sony()], 0);
	const claim = input.read([pad(), sony([0, 5, 7])], 1);
	expect(claim.id).toBe('DualSense Wireless Controller (054c)'); expect(claim.index).toBe(1);
	expect(claim.department).toBe(0); expect(claim.page).toBe(0); expect(claim.confirm).toBe(false);
	input.read([pad(), sony()], 2);
	const other = input.read([pad([4, 5, 6, 7]), sony()], 3);
	expect(other.id).toBe(claim.id); expect(other.department).toBe(0); expect(other.page).toBe(0); expect(other.promptActivity).toBe(false);
	const lost = input.read([pad([0, 5])], 4);
	expect(lost.id).toBeUndefined(); expect(lost.index).toBeUndefined(); expect(lost.department).toBe(0); expect(lost.promptActivity).toBe(false);
});

test('direction preserves spatial intent, including turning from left to up without waiting for repeat', function () {
	const input = claimed();
	const left = input.read([pad([14])], 10);
	expect(left.navigate).toBe(-1); expect(left.direction).toBe('left'); expect(left.adjust).toBe(-1);
	const held = input.read([pad([14])], 20);
	expect(held.direction).toBeUndefined(); expect(held.navigate).toBe(0);
	const up = input.read([pad([12])], 30);
	expect(up.navigate).toBe(-1); expect(up.direction).toBe('up'); expect(up.adjust).toBe(0);
	const down = input.read([pad([], [0, 1, 0, 0])], 40);
	expect(down.navigate).toBe(1); expect(down.direction).toBe('down'); expect(down.adjust).toBe(0);
});

test('held controller inputs cannot reclaim keyboard prompts until fresh activity', function () {
	const input = claimed();
	expect(input.read([pad([5])], 10).promptActivity).toBe(true);
	const held = input.read([pad([5])], 20);
	expect(held.activity).toBe(true); expect(held.promptActivity).toBe(false);
	expect(input.read([pad([5], [.5, 0, 0, 0])], 30).promptActivity).toBe(true);
	expect(input.read([pad([5], [.5, 0, 0, 0])], 40).promptActivity).toBe(false);
	expect(input.read([pad([5], [.53, 0, 0, 0])], 50).promptActivity).toBe(false);
	expect(input.read([pad([5], [.56, 0, 0, 0])], 60).promptActivity).toBe(false);
	expect(input.read([pad([5], [.7, 0, 0, 0])], 70).promptActivity).toBe(true);
	expect(input.read([pad()], 80).promptActivity).toBe(false);
	expect(input.read([pad([5])], 90).promptActivity).toBe(true);
});

test('analog trigger noise cannot repeat page changes without a deliberate release', function () {
	const input = claimed();
	const trigger = function (value: number): GamepadSnapshot {
		const base = pad();
		return { ...base, buttons: base.buttons.map(function (button, index) { return index === 7 ? { value, pressed: value > .5, touched: value > 0 } : button; }) };
	};
	expect(input.read([trigger(.6)], 10).page).toBe(1);
	for (const [step, value] of [.4, .36, .3, .5, .6].entries()) expect(input.read([trigger(value)], 20 + step * 10).page).toBe(0);
	input.read([trigger(.1)], 80);
	expect(input.read([trigger(.6)], 90).page).toBe(1);
});
