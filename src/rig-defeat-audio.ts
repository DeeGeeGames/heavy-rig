import { RIG_ARMOR_BURSTS } from './rig-defeat-timing';

export type ArmorBurst = (typeof RIG_ARMOR_BURSTS)[number];

// Only new defeats enter the sound mix. Drawing an existing wreck does not
// start another sequence.
export const createRigDefeatAudio = function () {
	const missions = new WeakMap<object, Map<number, number>>();
	return {
		start: function (owner: object, time: number) {
			const falls = missions.get(owner) ?? new Map<number, number>();
			if (!falls.has(time)) falls.set(time, 0);
			missions.set(owner, falls);
		},
		advance: function (owner: object, time: number): ArmorBurst | undefined {
			const falls = missions.get(owner);
			if (!falls) return;
			let loudest: ArmorBurst | undefined;
			for (const [start, next] of falls) {
				const elapsed = time - start + 1e-8;
				let index = next;
				let cue = RIG_ARMOR_BURSTS[index];
				while (cue && cue.at <= elapsed) {
					// A resumed or skipped frame must not dump a backlog of blasts.
					// The game advances at most 100 ms in a foreground frame.
					if (elapsed - cue.at <= 0.100001 && (!loudest || cue.left + cue.right > loudest.left + loudest.right)) loudest = cue;
					cue = RIG_ARMOR_BURSTS[++index];
				}
				if (!cue) falls.delete(start);
				else if (index !== next) falls.set(start, index);
			}
			if (!falls.size) missions.delete(owner);
			return loudest;
		},
	};
};
