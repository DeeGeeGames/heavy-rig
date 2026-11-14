import { expect, test } from 'bun:test';
import { catalog } from '../scripts/mech-design/catalog';
import { buildPrompt, parseRequest } from '../scripts/mech-design/prompt';

const baseline = {schemaVersion:1,mode:'baseline',variantId:'kestrel-b',background:'Transparent',details:'',loadout:[{weaponId:'machine-gun',rounds:1200},{weaponId:'laser',rounds:0}]};

test('design requests reject malformed or missing mount equipment before generation', function() {
	expect(function() { parseRequest({...baseline,loadout:[null]}); }).toThrow();
	expect(function() { parseRequest({...baseline,loadout:[{weaponId:'machine-gun',rounds:-1}]}); }).toThrow();
	expect(function() { buildPrompt(catalog,parseRequest({...baseline,loadout:[]})); }).toThrow();
});

test('compact energy mounts reject particle weapons and energy ammunition', function() {
	expect(function() { buildPrompt(catalog,parseRequest({...baseline,loadout:[baseline.loadout[0],{weaponId:'ppc',rounds:0}]})); }).toThrow('incompatible');
	expect(function() { buildPrompt(catalog,parseRequest({...baseline,loadout:[baseline.loadout[0],{weaponId:'laser',rounds:1}]})); }).toThrow('ammunition');
	expect(function() { buildPrompt(catalog,parseRequest(baseline)); }).not.toThrow();
});

test('variant prompts require a matching verified baseline from the same chassis', function() {
	expect(function() { parseRequest({...baseline,mode:'variant'}); }).toThrow('baselineId');
	const request=parseRequest({...baseline,mode:'variant',baselineId:'kestrel-v1'});
	expect(function() { buildPrompt(catalog,request); }).toThrow('baseline');
	expect(function() { buildPrompt(catalog,request,{id:'kestrel-v1',variantId:'warden',image:'warden.png',imageSha256:'test'}); }).toThrow('different chassis');
});

test('deriving Longbow A from a two-mount baseline explicitly removes auxiliary hardware', function() {
	const request=parseRequest({schemaVersion:1,mode:'variant',variantId:'longbow',baselineId:'longbow-b-v1',background:'Transparent',details:'',loadout:[{weaponId:'ppc',rounds:0}]});
	const prompt=buildPrompt(catalog,request,{id:'longbow-b-v1',variantId:'longbow-b',image:'baseline.png',imageSha256:'test'});
	expect(prompt).toContain('Remove baseline mount 2');
	expect(prompt).toContain('Remove the auxiliary mounting brace');
	expect(prompt).not.toContain('No structural redesign is authorized.');
});
