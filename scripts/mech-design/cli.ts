import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { catalog, contractSignature } from './catalog';
import { buildPrompt, parseRequest, type BaselineReference, type DesignRequest } from './prompt';
import { verifiedVisualReferences } from './visual-references';
const root = resolve(import.meta.dir, '../..');
const localPath = function(path: string): string {
	const absolute = resolve(root,path); const rel = relative(root,absolute);
	if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Design references must remain in the repository.');
	return absolute;
};
export const verifiedBaseline = async function(request: DesignRequest): Promise<BaselineReference | undefined> {
	if (request.mode === 'baseline') return undefined;
	const frame = catalog.frames.find(function(f) { return f.id === request.variantId; });
	if (!frame) throw Error('Unknown frame.');
	const record: unknown = await Bun.file(resolve(root,`design/mechs/chassis/${frame.chassisId}/design.json`)).json();
	if (typeof record !== 'object' || record === null || !('activeBaseline' in record) || record.activeBaseline !== request.baselineId || !('baselines' in record) || !Array.isArray(record.baselines)) throw Error('No active approved baseline. Obtain owner approval first.');
	const entry: unknown = record.baselines.find(function(item: unknown) { return typeof item === 'object' && item !== null && 'id' in item && item.id === request.baselineId; });
	if (typeof entry !== 'object' || entry === null || !('status' in entry) || entry.status !== 'approved' || !('image' in entry) || typeof entry.image !== 'string' || !('imageSha256' in entry) || typeof entry.imageSha256 !== 'string' || !('request' in entry) || typeof entry.request !== 'string' || !('requestSha256' in entry) || typeof entry.requestSha256 !== 'string' || !('approval' in entry) || typeof entry.approval !== 'string' || !entry.approval.trim() || !('contractSignature' in entry) || entry.contractSignature !== contractSignature(frame.chassisId)) throw Error('Baseline is draft, incomplete, or has stale gameplay definitions. Owner review is required.');
	const image = Bun.file(localPath(entry.image));
	const hash = new Bun.CryptoHasher('sha256').update(await image.arrayBuffer()).digest('hex');
	if (hash !== entry.imageSha256) throw Error('Baseline image changed since approval.');
	const sourceRequest = Bun.file(localPath(entry.request));
	if (new Bun.CryptoHasher('sha256').update(await sourceRequest.arrayBuffer()).digest('hex') !== entry.requestSha256) throw Error('Baseline request changed since approval.');
	const original = parseRequest(await sourceRequest.json());
	const source = catalog.frames.find(function(f) { return f.id === original.variantId; });
	if (original.mode !== 'baseline' || source?.chassisId !== frame.chassisId) throw Error('Baseline source request is not for this chassis.');
	buildPrompt(catalog,original);
	return {id:request.baselineId ?? '',image:entry.image,imageSha256:hash,variantId:original.variantId};
};
if (import.meta.main) {
	const input = process.argv[2]; const output = process.argv[3];
	if (!input || !output) throw Error('Usage: bun run mech:prompt request.json new-output-directory');
	const request = parseRequest(await Bun.file(input).json());
	const baseline = await verifiedBaseline(request);
	const references = request.mode === 'baseline' ? await verifiedVisualReferences() : [];
	const prompt = buildPrompt(catalog,request,baseline);
	const frame = catalog.frames.find(function(f) { return f.id === request.variantId; });
	if (!frame) throw Error('Unknown frame.');
	await mkdir(dirname(resolve(output)),{recursive:true});
	await mkdir(resolve(output),{recursive:false});
	await Bun.write(resolve(output,'request.json'),JSON.stringify(request,null,2)+'\n');
	await Bun.write(resolve(output,'prompt.txt'),prompt+'\n');
	await Bun.write(resolve(output,'contract.json'),JSON.stringify({chassisId:frame.chassisId,variantId:frame.id,contractSignature:contractSignature(frame.chassisId),mounts:frame.mounts,baseline:baseline??null,reviewStatus:'pending',ownerApproval:null},null,2)+'\n');
	const attachments = baseline
		? [{role:'edit-target',image:baseline.image,imageSha256:baseline.imageSha256,baselineId:baseline.id}]
		: [
			{role:'finish-reference',...catalog.visualReferenceSet.finishReference},
			...references.map(function(reference) { return {role:'style-reference',...reference}; }),
		];
	await Bun.write(resolve(output,'attachments.json'),JSON.stringify({schemaVersion:1,scope:'Attach the actual PNG files to the image generator; writing their paths in a prompt does not attach them.',attachments},null,2)+'\n');
	if (request.mode === 'baseline') {
		await Bun.write(resolve(output,'family-review.json'),JSON.stringify({schemaVersion:1,status:'pending',referenceSetId:catalog.visualReferenceSet.id,references,finishReference:catalog.visualReferenceSet.finishReference,styleSha256:new Bun.CryptoHasher('sha256').update(await Bun.file(resolve(root,'design/mechs/style.json')).arrayBuffer()).digest('hex'),candidateImage:null,candidateImageSha256:null,criteria:catalog.visualReferenceSet.reviewCriteria.map(function(criterion) { return {criterion,result:'pending',evidence:null}; }),ownerApproval:null,gate:'Complete family review and explicit owner baseline approval before turnaround generation. Existing reference approvals do not approve this candidate.'},null,2)+'\n');
	}
	console.log(`Prepared ${resolve(output)}. Inspect the actual generated image against contract.json; owner approval remains separate.`);
}
