import { isAbsolute, relative, resolve } from 'node:path';
import visualReferenceSet from '../../design/mechs/visual-references.json';

export interface VisualReference {
	readonly chassisId: string;
	readonly baselineId: string;
	readonly image: string;
	readonly imageSha256: string;
}

// Exact reference provenance is independent of the new candidate's approval.
export const validateVisualReference = function(reference: VisualReference, record: unknown, actualImageSha256: string): void {
	if (typeof record !== 'object' || record === null || !('chassisId' in record) || record.chassisId !== reference.chassisId || !('activeBaseline' in record) || record.activeBaseline !== reference.baselineId || !('baselines' in record) || !Array.isArray(record.baselines)) throw Error(`Visual reference is not the active chassis baseline: ${reference.chassisId}`);
	const entry: unknown = record.baselines.find(function(item: unknown) { return typeof item === 'object' && item !== null && 'id' in item && item.id === reference.baselineId; });
	if (typeof entry !== 'object' || entry === null || !('status' in entry) || entry.status !== 'approved' || !('approval' in entry) || typeof entry.approval !== 'string' || !entry.approval.trim() || !('image' in entry) || entry.image !== reference.image || !('imageSha256' in entry) || entry.imageSha256 !== reference.imageSha256) throw Error(`Visual reference lacks matching owner-approved provenance: ${reference.chassisId}`);
	if (actualImageSha256 !== reference.imageSha256) throw Error(`Visual reference image changed since approval: ${reference.chassisId}`);
};

export const verifiedVisualReferences = async function(): Promise<readonly VisualReference[]> {
	const root = resolve(import.meta.dir, '../..');
	const finish = visualReferenceSet.finishReference;
	const finishBytes = await Bun.file(resolve(root, finish.image)).arrayBuffer();
	if (new Bun.CryptoHasher('sha256').update(finishBytes).digest('hex') !== finish.imageSha256) throw Error('Playable finish reference changed. Review the lineup before composing a baseline.');
	for (const reference of visualReferenceSet.references) {
		const image = resolve(root, reference.image);
		const imageRelative = relative(root, image);
		if (imageRelative.startsWith('..') || isAbsolute(imageRelative) || !/^[a-z][a-z0-9-]*$/.test(reference.chassisId)) throw Error('Visual references must remain in the repository');
		const record: unknown = await Bun.file(resolve(root, `design/mechs/chassis/${reference.chassisId}/design.json`)).json();
		const hash = new Bun.CryptoHasher('sha256').update(await Bun.file(image).arrayBuffer()).digest('hex');
		validateVisualReference(reference, record, hash);
	}
	return visualReferenceSet.references;
};
