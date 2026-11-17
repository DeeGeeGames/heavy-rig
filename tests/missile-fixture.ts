import { weaponsStep, type CombatStateView, type Controls, type Unit } from '../src/simulation';

export const acquireMissileTarget = function (state: CombatStateView, targetId: number): void {
	const input: Controls = { drive: 0, turn: 0, stop: false, aim: state.player, targetId, fire: [false, false, false, false], coolant: false };
	for (let tick = 0; tick < 90; tick++) weaponsStep(state, input, 1 / 60);
};
export const addMissileTarget = function (state: CombatStateView): Unit {
	const target: Unit = { id: state.nextId++, x: state.player.x, y: state.player.y - 400, kind: 'striker', hp: 1000, maxHp: 1000, angle: 0, cooldown: 999, heavy: false };
	state.enemies.push(target);
	acquireMissileTarget(state, target.id);
	return target;
};
