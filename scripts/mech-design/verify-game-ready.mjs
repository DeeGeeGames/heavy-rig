/** Validate the retained Warden GLB directly; no Blender or ignored reports required.
 * bun scripts/mech-design/verify-game-ready.mjs [asset.glb] [new-report.json] [--candidate]
 * --candidate permits an unpromoted digest while retaining structural checks.
 * Texture decoding, physical controls and hardware timing remain browser/owner checks.
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { AnimationMixer, LoopOnce, Mesh, Quaternion, Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareAuthoredWarden, authoredMuzzleError } from '../../src/authored-mech.ts';
import { createGait, advanceGait } from '../../src/gait.ts';
import { getPlayerMuzzle } from '../../src/weapon-rig.ts';

const root = resolve(import.meta.dirname, '../..');
const manifest = await Bun.file(resolve(root, 'design/mechs/assets/warden/game-ready/manifest.json')).json();
const recipePath = 'design/mechs/assets/warden/game-ready/recipe.json';
const recipe = await Bun.file(resolve(root, recipePath)).json();
const candidate = process.argv.includes('--candidate');
const arguments_ = process.argv.slice(2).filter(function (value) { return value !== '--candidate'; });
if (arguments_.length > 2) throw new Error('Expected at most asset and new report paths');
const path = resolve(root, arguments_[0] ?? manifest.asset.path);
const output = arguments_[1] ? resolve(root, arguments_[1]) : undefined;
if (output && await Bun.file(output).exists()) throw new Error('Validation output must be new');
const data = await Bun.file(path).arrayBuffer();
const sha256 = createHash('sha256').update(new Uint8Array(data)).digest('hex');
if (!candidate && sha256 !== manifest.asset.sha256) throw new Error('Asset differs from the selected manifest hash');
const loader = new GLTFLoader().register(function () { return { name: 'HEADLESS_VALIDATION', loadTexture: async function () { return new Texture(); } }; });
const asset = await loader.parseAsync(data, '');
const originalName = function (node) { return node.userData.name ?? node.name; };
const nodes = new Map();
asset.scene.traverse(function (node) { const name = originalName(node); if (nodes.has(name)) throw new Error('Duplicate node ' + name); nodes.set(name, node); });
const named = function (name) { const node = nodes.get(name); if (!node) throw new Error('Missing node ' + name); return node; };
asset.scene.updateMatrixWorld(true);
for (const group of recipe.rigGroups) if (group.parent && originalName(named(group.name).parent) !== group.parent) throw new Error('Wrong parent: ' + group.name);
const rigid = [...recipe.rigGroups.filter(function (group) { return group.name.startsWith('rig_mount_'); }).map(function (group) { return named(group.name); }), named('geometry_mount_connections')];
for (const node of rigid) if (originalName(node.parent) !== 'rig_torso') throw new Error('Attachment is not rigidly torso-owned');
const rigidRest = rigid.map(function (node) { node.updateMatrix(); return node.matrix.toArray(); });
const matrixError = function (matrix, values) { return Math.max(...matrix.elements.map(function (v, i) { return Math.abs(v - values[i]); })); };
let maximumRigidMatrixError = 0;
const checkRigid = function () { for (const [index, node] of rigid.entries()) { node.updateMatrix(); maximumRigidMatrixError = Math.max(maximumRigidMatrixError, matrixError(node.matrix, rigidRest[index])); } if (maximumRigidMatrixError > 1e-10) throw new Error('Torso attachment moved locally'); };
let triangles = 0; let meshSections = 0;
const arrays = new Set(); const geometries = new Set(); const materials = new Set();
asset.scene.traverse(function (node) {
 if (!(node instanceof Mesh)) return;
 geometries.add(node.geometry);
 triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count) / 3;
 meshSections += Math.max(1, node.geometry.groups.length);
 for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
 for (const attribute of Object.values(node.geometry.attributes)) {
  arrays.add(attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array);
  for (const value of attribute.array) if (!Number.isFinite(value)) throw new Error('Non-finite vertex attribute');
 }
 if (node.geometry.index) arrays.add(node.geometry.index.array);
});
if (triangles !== manifest.asset.triangles || meshSections !== manifest.asset.meshSections || materials.size !== manifest.asset.materials) throw new Error('Asset geometry budget differs from manifest');
const geometryBufferBytes = [...arrays].reduce(function (total, array) { return total + array.byteLength; }, 0);
if (geometryBufferBytes !== manifest.asset.geometryArrayBytes) throw new Error('Geometry memory differs from manifest');
const point = new Vector3();
let maximumGuardProbeError = 0;
for (const rule of recipe.ownershipOverrides) {
 const points = [];
 named(rule.to).traverse(function (node) {
  if (!(node instanceof Mesh)) return;
  let owner = node;
  while (owner && !originalName(owner).startsWith('rig_')) owner = owner.parent;
  if (!owner || originalName(owner) !== rule.to) return;
  const attribute = node.geometry.getAttribute('position');
  for (let i = 0; i < attribute.count; i++) points.push(new Vector3().fromBufferAttribute(attribute, i).applyMatrix4(node.matrixWorld));
 });
 for (const probe of rule.probePositionsGlb) {
  const expected = new Vector3(...probe);
  const error = Math.min(...points.map(function (p) { return p.distanceTo(expected); }));
  maximumGuardProbeError = Math.max(maximumGuardProbeError, error);
  if (error > recipe.validation.ownershipProbeTolerance) throw new Error('Guard component is absent from shin geometry: ' + rule.id);
 }
}
const mixer = new AnimationMixer(asset.scene);
const clips = {};
const animatedGroups = new Set(recipe.rigGroups.map(function (group) { return named(group.name).name; }));
for (const clip of asset.animations) {
 if (!manifest.asset.clips.includes(clip.name)) throw new Error('Unexpected clip ' + clip.name);
 for (const track of clip.tracks) {
  const target = track.name.slice(0, track.name.lastIndexOf('.'));
  if (!animatedGroups.has(target)) throw new Error('Only rigid assembly groups may be animated: ' + track.name);
  if (rigid.some(function (node) { return track.name.startsWith(node.name + '.'); })) throw new Error('Rigid attachment has animation tracks');
 }
 const action = mixer.clipAction(clip); action.setLoop(LoopOnce, 1); action.clampWhenFinished = true; action.play();
 const times = [...new Set(clip.tracks.flatMap(function (track) { return [...track.times]; }))].toSorted(function (a, b) { return a - b; });
 let minimumGround = Infinity; let maximumAnkleArticulation = 0;
 const starts = new Map(); let maximumLoopError = 0;
 for (const time of times) {
  mixer.setTime(time); asset.scene.updateMatrixWorld(true); checkRigid();
  for (const side of ['left', 'right']) {
   const foot = named(`rig_leg_${side}_foot`); maximumAnkleArticulation = Math.max(maximumAnkleArticulation, foot.quaternion.angleTo(new Quaternion()));
   foot.traverse(function (node) { if (!(node instanceof Mesh)) return; const attr = node.geometry.getAttribute('position'); for (let i = 0; i < attr.count; i++) minimumGround = Math.min(minimumGround, point.fromBufferAttribute(attr, i).applyMatrix4(node.matrixWorld).y); });
  }
  for (const group of recipe.rigGroups) {
   const matrix = named(group.name).matrixWorld;
   if (time === times[0]) starts.set(group.name, matrix.toArray());
   if (time === times.at(-1)) maximumLoopError = Math.max(maximumLoopError, matrixError(matrix, starts.get(group.name)));
  }
 }
 if (minimumGround < -2e-5 || maximumLoopError > 2e-5 || maximumAnkleArticulation < 0.01) throw new Error('Gait floor/loop/articulation check failed: ' + clip.name);
 clips[clip.name] = { samples: times.length, duration: clip.duration, minimumGround, maximumLoopError, maximumAnkleArticulation };
 action.stop();
}
if (Object.keys(clips).length !== 3) throw new Error('Three gait clips required');
mixer.stopAllAction(); mixer.uncacheRoot(asset.scene); asset.scene.updateMatrixWorld(true);
const factory = prepareAuthoredWarden(asset); const remove = factory.install(); const model = factory.create();
let maximumMuzzleError = 0; let originRenderDependencyError = 0;
let body = { x: 500, y: 400, angle: 0 }; let gait = createGait(body); let context = factory.advancePose(undefined, body, 0);
try {
 for (let tick = 1; tick <= 480; tick++) {
  const speed = tick < 120 ? 38 : tick < 240 ? 90 : tick < 360 ? -28 : 0;
  const angle = tick * 0.004;
  body = { x: body.x + Math.cos(angle) * speed / 60, y: body.y + Math.sin(angle) * speed / 60, angle };
  context = factory.advancePose(context, body, tick / 60); gait = advanceGait(gait, body, 1 / 60);
  const heading = angle + Math.sin(tick / 40);
  const target = { x: body.x + Math.cos(heading) * 150, y: body.y + Math.sin(heading) * 150, elevation: tick % 2 ? 220 : 0 };
  const before = getPlayerMuzzle('warden', 0, body, heading, undefined, target, context);
  model.pose(createGait({ x: -900, y: 73, angle: 2 }), -1, { recoil: 0, hit: 0, heat: 0, time: 50, target });
  const after = getPlayerMuzzle('warden', 0, body, heading, undefined, target, context);
  originRenderDependencyError = Math.max(originRenderDependencyError, Math.hypot(after.x - before.x, after.y - before.y, after.elevation - before.elevation));
  model.pose(gait, heading, { recoil: 0, hit: 0, heat: 0, time: tick / 60, authoredPose: context, target });
  maximumMuzzleError = Math.max(maximumMuzzleError, authoredMuzzleError(model, factory.weaponRigs, gait, heading, target, context));
 }
 if (maximumMuzzleError > 1e-7 || originRenderDependencyError !== 0) throw new Error('Simulation/render firing-origin mismatch');
} finally {
 model.dispose(); remove(); factory.dispose();
 for (const geometry of geometries) geometry.dispose();
 for (const material of materials) { for (const value of Object.values(material)) if (value instanceof Texture) value.dispose(); material.dispose(); }
}
const fingerprints = {};
for (const file of [recipePath, 'scripts/mech-design/verify-game-ready.mjs', 'src/authored-mech.ts', 'src/authored-pose.ts', 'src/weapon-rig.ts']) fingerprints[file] = createHash('sha256').update(new Uint8Array(await Bun.file(resolve(root, file)).arrayBuffer())).digest('hex');
const result = { schemaVersion: 1, sha256, selectedAssetMatch: sha256 === manifest.asset.sha256, bytes: data.byteLength, triangles, meshSections, materials: materials.size, geometryBufferBytes, shinOwnership: { components: recipe.ownershipOverrides.length, maximumProbeError: maximumGuardProbeError }, rigidAttachments: { mounts: 4, staticNeckMeshes: 1, maximumLocalMatrixError: maximumRigidMatrixError }, clips, firingOrigins: { runtimeSamples: 480, maximumMuzzleError, originRenderDependencyError }, fingerprints, limits: ['Headless texture placeholders; image appearance requires browser review', 'Samples do not establish swept-volume clearance or hardware frame time'], errors: [] };
if (output) await Bun.write(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
