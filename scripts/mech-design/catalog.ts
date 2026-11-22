import { FRAMES } from '../../src/frames';
import { getHardpoints } from '../../src/hardpoints';
import { WEAPONS } from '../../src/arsenal';
import style from '../../design/mechs/style.json';
import visualReferenceSet from '../../design/mechs/visual-references.json';
import type { Catalog } from './prompt';
export const catalog: Catalog = { frames: FRAMES.map(function(frame) { return { ...frame, mounts: getHardpoints(frame.id) }; }), weapons: WEAPONS, ...style, visualReferenceSet };
export const contractSignature = function(chassisId: string): string {
	// Mount compatibility is already encoded by the allowed models. Size labels alone do not alter approved designs.
	const frames = catalog.frames.filter(function(frame) { return frame.chassisId === chassisId; }).map(function(frame) {
		return { ...frame, mounts: frame.mounts.map(function({ maxSize, ...mount }) { return mount; }) };
	});
	const weapons = catalog.weapons.map(function({ size, ...weapon }) { return weapon; });
	return new Bun.CryptoHasher('sha256').update(JSON.stringify({ frames, weapons })).digest('hex');
};
