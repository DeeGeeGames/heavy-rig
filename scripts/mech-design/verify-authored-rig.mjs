/** Check actual exported GLB animation/foot poses in the engine-native loader. */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, Box3, LoopOnce, Mesh, Texture, Vector3 } from 'three';
import { createHash } from 'node:crypto';
const [path, reportPath, outputPath] = process.argv.slice(2);
if (!path || !reportPath || !outputPath) throw new Error('Usage: validate_rig.mjs GLB RIG_REPORT OUTPUT');
if (await Bun.file(outputPath).exists()) throw new Error('Output must be new');
const data = await Bun.file(path).arrayBuffer();
const report = await Bun.file(reportPath).json();
const loader = new GLTFLoader().register(function () { return {name:'HEADLESS_GEOMETRY_VALIDATION',loadTexture:async function () { return new Texture(); }}; });
const asset = await loader.parseAsync(data, '');
const rawView = new DataView(data);
const rawDocument = JSON.parse(new TextDecoder().decode(new Uint8Array(data,20,rawView.getUint32(12,true))));
const sha256 = createHash('sha256').update(new Uint8Array(data)).digest('hex');
const originalName = function (node) { return node.userData.name ?? node.name; };
const nodes = new Map();
asset.scene.traverse(function(node) { nodes.set(originalName(node),node); });
const requiredGroups = Object.keys(report.groups);
for (const name of requiredGroups) {
 const node = nodes.get(name);
 if (!node) throw new Error(`Missing ${name}`);
 const parent = report.groups[name].parent;
 if (parent && originalName(node.parent) !== parent) throw new Error(`Wrong parent of ${name}`);
}
for (const anchor of report.anchors) {
 const node = nodes.get(anchor.name);
 if (!node || originalName(node.parent) !== anchor.parent) throw new Error(`Bad anchor ${anchor.name}`);
}
const bounds = new Box3().setFromObject(asset.scene);
asset.scene.updateMatrixWorld(true);
if (report.weaponBinding !== 'rigid-to-torso' || report.staticConnections?.length !== 4) throw new Error('Expected four torso-fixed Warden attachments');
const rigidNames = [...new Set([...requiredGroups.filter(function (name) { return name.startsWith('rig_mount_'); }), ...report.staticConnections.map(function (connection) { return connection.node; })])];
const rigidMatrices = new Map();
for (const name of rigidNames) {
 const node = nodes.get(name);
 if (!node || originalName(node.parent) !== 'rig_torso') throw new Error('Attachment is not a direct torso child: '+name);
 rigidMatrices.set(name,[...node.matrix.elements]);
}
for (const animation of rawDocument.animations ?? []) for (const channel of animation.channels) {
 if (rigidNames.includes(rawDocument.nodes[channel.target.node]?.name)) throw new Error('Rigid torso attachment has animation tracks');
}
let maximumRigidMatrixError = 0;
const checkRigidAttachments = function () {
 asset.scene.updateMatrixWorld(true);
 for (const name of rigidNames) {
  const node = nodes.get(name); const expected = rigidMatrices.get(name);
  maximumRigidMatrixError = Math.max(maximumRigidMatrixError,...node.matrix.elements.map(function (value,index) { return Math.abs(value-expected[index]); }));
 }
 if (maximumRigidMatrixError > 1e-10) throw new Error('Mount or neck moved relative to torso');
};
checkRigidAttachments();
const mixer = new AnimationMixer(asset.scene);
const clips = {};
let meshSections = 0;
let triangles = 0;
const materials = new Set();
const arrays = new Set();
asset.scene.traverse(function(node) {
 if (!(node instanceof Mesh)) return;
 triangles += (node.geometry.index?.count ?? node.geometry.getAttribute('position').count)/3;
 meshSections += Math.max(1,node.geometry.groups.length);
 for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
 for (const attribute of Object.values(node.geometry.attributes)) arrays.add(attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array);
 if (node.geometry.index) arrays.add(node.geometry.index.array);
});
const point = new Vector3();
const current = new Vector3();
const toGlb = function (values) { return [values[0],values[2],-values[1]]; };
for (const clip of asset.animations) {
 const source = report.clips[clip.name];
 if (!source) throw new Error('Unexpected clip '+clip.name);
 const action = mixer.clipAction(clip);
 action.setLoop(LoopOnce,1);
 action.clampWhenFinished = true;
 action.play();
 let minimumGround = Infinity;
 let maximumTargetError = 0;
 let maximumForwardDrift = 0;
 const startMatrices = new Map();
 let maximumLoopMatrixError = 0;
 let frameIndex = 0;
 for (const sample of source.samples) {
  mixer.setTime(Math.min(sample.phase*source.duration,clip.duration)); checkRigidAttachments();
  asset.scene.updateMatrixWorld(true);
  const pelvis = nodes.get('rig_pelvis');
  maximumForwardDrift = Math.max(maximumForwardDrift,Math.abs(pelvis.position.z+report.groups.rig_pelvis.pivot[1]));
  for (const side of ['left','right']) {
   const foot = nodes.get(`rig_leg_${side}_foot`);
   const expected = new Vector3(...toGlb(sample.feet[side].ankle));
   foot.getWorldPosition(current);
   maximumTargetError = Math.max(maximumTargetError,current.distanceTo(expected));
   foot.traverse(function(node) {
    if (!(node instanceof Mesh)) return;
    const position = node.geometry.getAttribute('position');
    for (let index=0;index<position.count;index++) {
     point.fromBufferAttribute(position,index).applyMatrix4(node.matrixWorld);
     minimumGround = Math.min(minimumGround,point.y);
    }
   });
  }
  for (const name of requiredGroups) {
   const matrix = nodes.get(name).matrixWorld.elements;
   if (frameIndex===0) startMatrices.set(name,[...matrix]);
   if (frameIndex===source.samples.length-1) maximumLoopMatrixError = Math.max(maximumLoopMatrixError,...matrix.map(function(value,i) { return Math.abs(value-startMatrices.get(name)[i]); }));
  }
  frameIndex += 1;
 }
 if (maximumTargetError>2e-5 || minimumGround < -2e-5 || maximumForwardDrift > 2e-5 || maximumLoopMatrixError>2e-5) throw new Error(JSON.stringify({clip:clip.name,maximumTargetError,minimumGround,maximumForwardDrift,maximumLoopMatrixError}));
 clips[clip.name] = {frames:frameIndex,duration:clip.duration,maximumTargetError,minimumGround,maximumForwardDrift,maximumLoopMatrixError};
 action.stop();
}
if (Object.keys(clips).length!==3) throw new Error('Expected three motion clips');
mixer.stopAllAction();
mixer.uncacheRoot(asset.scene);
const result = {rigidAttachments:{mounts:4,staticNeckMeshes:rigidNames.length-4,maximumLocalMatrixError:maximumRigidMatrixError},sha256,bytes:data.byteLength,textureImages:rawDocument.images?.length ?? 0,textureDecode:'Headless texture placeholders; image decoding and appearance require browser validation',triangles,meshSections,materials:materials.size,geometryBufferBytes:[...arrays].reduce(function(total,array) { return total+array.byteLength; },0),neutralBounds:{minimum:bounds.min.toArray(),maximum:bounds.max.toArray()},rigGroups:requiredGroups.length,anchors:report.anchors.length,clips,errors:[]};
await Bun.write(outputPath,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
