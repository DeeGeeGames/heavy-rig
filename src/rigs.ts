import { FRAMES, getFrame, type FrameId } from './frames';

// First copies retain the historical frame key, so existing saves remain valid.
// Fleet references (including legacy fields named frameId) identify one rig.
export type RigId = FrameId | `${FrameId}#${number}`;
export const isRigId = function (value: unknown): value is RigId {
	return typeof value === 'string' && FRAMES.some(function (frame) {
		if (value === frame.id) return true;
		if (!value.startsWith(`${frame.id}#`)) return false;
		const serial = value.slice(frame.id.length + 1);
		return /^[1-9][0-9]*$/.test(serial) && Number.isSafeInteger(Number(serial)) && Number(serial) >= 2;
	});
};
export const rigFrameId = function (id: RigId): FrameId {
	const frame = FRAMES.find(function (frame) { return id === frame.id || id.startsWith(`${frame.id}#`); });
	if (!frame) throw new RangeError('Unknown rig');
	return frame.id;
};
export const rigName = function (id: RigId): string {
	const frame = rigFrameId(id);
	const definition = getFrame(frame);
	return `${definition.chassisName} ${definition.variant}${id === frame ? '' : ` #${id.slice(frame.length + 1)}`}`;
};
