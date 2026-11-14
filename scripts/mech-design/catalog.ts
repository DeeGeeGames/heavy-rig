import { FRAMES } from '../../src/frames';
import { getHardpoints } from '../../src/hardpoints';
import { WEAPONS } from '../../src/arsenal';
import style from '../../design/mechs/style.json';
import type { Catalog } from './prompt';
export const catalog: Catalog = { frames: FRAMES.map(function(frame) { return { ...frame, mounts: getHardpoints(frame.id) }; }), weapons: WEAPONS, ...style };
export const contractSignature = function(chassisId: string): string {
	const frames = catalog.frames.filter(function(frame) { return frame.chassisId === chassisId; });
	return new Bun.CryptoHasher('sha256').update(JSON.stringify({ frames, weapons: catalog.weapons })).digest('hex');
};
