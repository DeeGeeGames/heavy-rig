import { expect, test } from 'bun:test';
import { createRigDefeatAudio } from '../src/rig-defeat-audio';
import { RIG_ARMOR_BURSTS } from '../src/rig-defeat-timing';

test('simultaneous defeats share each blast once across a frozen combat clock and player fall', function () {
	const audio = createRigDefeatAudio(), mission = {};
	const fatalTick = 37;
	audio.start(mission, fatalTick);
	audio.start(mission, fatalTick);
	const heard: number[] = [];
	for (let frame = 0; frame <= 120; frame++) {
		const elapsed = frame / 60;
		const cue = audio.advance(mission, fatalTick + elapsed);
		if (cue) heard.push(elapsed);
		expect(audio.advance(mission, fatalTick + elapsed)).toBeUndefined();
	}
	expect(heard).toEqual(RIG_ARMOR_BURSTS.map(function (cue) { return cue.at; }));
});

test('restoring another sortie or skipping ahead never replays a backlog of explosions', function () {
	const audio = createRigDefeatAudio(), first = {}, restored = {};
	audio.start(first, 3);
	expect(audio.advance(restored, 3.1)).toBeUndefined();
	expect(audio.advance(first, 4.23)).toBeUndefined();
	audio.start(first, 4.30);
	// The new chest burst and older hull burst coincide in this render frame.
	expect(audio.advance(first, 4.40)?.part).toBe('chest');
	expect(audio.advance(first, 4.41)).toBeUndefined();
	expect(audio.advance(first, 40)).toBeUndefined();
});
