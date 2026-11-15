/** Actual exported geometry, rigid fit, motion and forward-ray probes. */
import { verifyHousingCoverage } from './housing-coverage.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AnimationMixer, LoopOnce, Mesh, Raycaster, Texture, Vector3 } from 'three';
import { canEquipWeapon, getHardpoints } from '../../src/hardpoints.ts';
import { createHash } from 'node:crypto';
const folder = process.argv[2];
if (!folder) throw new Error('Usage: bun scripts/mech-design/verify-warden-modularity.mjs generated-folder');
if (getHardpoints('warden')[0]?.id !== 'left-gun' || !canEquipWeapon('warden',0,'machine-gun')) throw new Error('Live gameplay compatibility changed');
const loader = new GLTFLoader().register(function () { return { name:'HEADLESS_MODULE_PROOF', loadTexture:async function () { return new Texture(); } }; });
const contract=await Bun.file(new URL('../../design/mechs/assets/warden/game-ready/modularity-contract.json',import.meta.url)).json();
if(contract.frame!=='warden'||contract.slot!==0||contract.alternateWeapon!=='machine-gun')throw new Error('Authoring contract changed');
const assets=[];
for (const name of ['original','alternate','empty']) {
 const data=await Bun.file(`${folder}/${name}.glb`).arrayBuffer();
 const asset=await loader.parseAsync(data,'');
 const nodes=new Map();asset.scene.traverse(function(n){nodes.set(n.userData.name??n.name,n);});
 assets.push({name,asset,nodes,mixer:new AnimationMixer(asset.scene),sha256:createHash('sha256').update(new Uint8Array(data)).digest('hex')});
}
const reference=assets[0];
if(reference.sha256!==contract.selectedSha256)throw new Error('Proof source is not the selected derivative');
const report={samples:0,clips:[],aimDegrees:[-90,-45,0,45,90],maxSharedWorldMatrixError:0,maxSocketRelativeError:0,maxExitRelativeError:0,minimumForwardRayClearance:Infinity,assets:assets.map(function(a){return {name:a.name,sha256:a.sha256};}),limitations:['Sampled clips and yaw only; no exhaustive swept collision or projectile volume test.','Headless texture stub; appearance reviewed separately.','Standalone authoring assembly, no runtime equipment integration.']};
for (const state of assets.slice(1)) {
 if (state.nodes.has('physical_exit_left_gun_1')) throw new Error('Old functional muzzle retained');
 if (state.name==='empty' && [...state.nodes.keys()].some(function(n){return n.startsWith('physical_exit_left_machine_gun');})) throw new Error('Empty mount has active exits');
 const socket=state.nodes.get('socket_left_gun');
 if (socket?.parent!==state.nodes.get('rig_mount_left-gun')) throw new Error('Wrong socket binding');
 if (state.nodes.get('geometry_rig_mount_left-gun')?.children.some(function(n){return n instanceof Mesh;}) || state.nodes.get('geometry_rig_mount_left-gun') instanceof Mesh) throw new Error('Old functional gun geometry retained');
}
// Recompute fingerprints from disk, independently of the builder's report.
for (const name of ['alternate','empty']) {
 const process = Bun.spawn(['python3','scripts/mech-design/modular-export.py',`${folder}/original.glb`,`${folder}/${name}.glb`,'--exclude','geometry_rig_mount_left-gun','--exclude',`module_left_${name}`],{stdout:'pipe',stderr:'pipe'});
 const [output,error,code]=await Promise.all([new Response(process.stdout).text(),new Response(process.stderr).text(),process.exited]);
 if(code!==0)throw new Error(error);if(!JSON.parse(output).motion)throw new Error('Missing fingerprint');
}
report.housingCoverage = [];
for (const state of assets.slice(1)) {
 const module = state.nodes.get('module_left_' + state.name);
 if (!(module instanceof Mesh) || module.parent !== state.nodes.get('socket_left_gun')) throw new Error('Wrong module binding');
 const probes = verifyHousingCoverage(module.geometry, contract.housingBounds, new Vector3(...contract.retainedNeckEndpointLocal));
 report.housingCoverage.push({name: state.name, probes, tolerance: 1e-6, method: 'indexed triangles; nine outward rays per contracted face'});
}
const raycaster=new Raycaster();
for (const clip of reference.asset.animations) {
 report.clips.push({name:clip.name,duration:clip.duration,phases:61});
 for (const state of assets) {
  const matching=state.asset.animations.find(function(c){return c.name===clip.name;});
  if (!matching) throw new Error('Missing shared clip');
  const action=state.mixer.clipAction(matching);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();
 }
 for (let phase=0;phase<=60;phase++) for (const yaw of report.aimDegrees) {
  for (const state of assets) {
   state.mixer.setTime(phase/60*clip.duration);
   state.nodes.get('rig_torso').rotateY(yaw*Math.PI/180);
   state.asset.scene.updateMatrixWorld(true);
  }
  for (const state of assets.slice(1)) {
   for (const [name,node] of reference.nodes) {
    if (!name.startsWith('rig_') && !name.startsWith('geometry_')) continue;
    if (name==='geometry_rig_mount_left-gun') continue;
    const actual=state.nodes.get(name);if (!actual) throw new Error('Missing shared '+name);
    report.maxSharedWorldMatrixError=Math.max(report.maxSharedWorldMatrixError,...node.matrixWorld.elements.map(function(v,i){return Math.abs(v-actual.matrixWorld.elements[i]);}));
   }
   const socket=state.nodes.get('socket_left_gun');const mount=state.nodes.get('rig_mount_left-gun');
   const relative=mount.matrixWorld.clone().invert().multiply(socket.matrixWorld);
   report.maxSocketRelativeError=Math.max(report.maxSocketRelativeError,...relative.elements.map(function(v,i){return Math.abs(v-(i%5===0?1:0));}));
   const module=state.nodes.get('module_left_'+state.name);
   if (!(module instanceof Mesh)) throw new Error('Missing module geometry');
   const endpoint=new Vector3(...contract.retainedNeckEndpointLocal).applyMatrix4(socket.matrixWorld);
   const localEndpoint=module.worldToLocal(endpoint.clone());
   if (localEndpoint.distanceTo(new Vector3(...contract.retainedNeckEndpointLocal)) > 1e-7) throw new Error('Housing detached from retained neck');
   if (state.name==='alternate') {
    for (let i=1;i<=3;i++) {
     const exit=state.nodes.get(`physical_exit_left_machine_gun_${i}`);
     if (exit?.parent!==socket) throw new Error('Wrong exit binding');
     const point=exit.getWorldPosition(new Vector3());
     const local=socket.worldToLocal(point.clone());
     report.maxExitRelativeError=Math.max(report.maxExitRelativeError,local.distanceTo(exit.position));
     if (Math.abs(local.z-.282)>1e-7) throw new Error('Exit behind barrel lip');
     const direction=new Vector3(0,0,1).transformDirection(exit.matrixWorld);
     // A backward center ray must enter the hollow bore without hitting a cap;
     // an offset ray must hit the actual exported terminal ring at z=.280.
     raycaster.set(point,direction.clone().negate());raycaster.far=.02;
     if(raycaster.intersectObject(module,true).length)throw new Error('Bore center is capped');
     const rim=socket.localToWorld(new Vector3(local.x+.0095,local.y,local.z));
     raycaster.set(rim,direction.clone().negate());raycaster.far=.01;
     const hit=raycaster.intersectObject(module,true)[0];
     if(!hit || Math.abs(hit.distance-.002)>1e-6)throw new Error('Exit does not align with actual barrel rim');
     raycaster.set(point,direction);raycaster.far=.5;
     if (raycaster.intersectObject(state.asset.scene,true).length) throw new Error('Forward firing ray blocked');
     report.minimumForwardRayClearance=Math.min(report.minimumForwardRayClearance,.5);
    }
   }
  }
  report.samples++;
 }
 for (const state of assets) state.mixer.stopAllAction();
}
if (report.maxSharedWorldMatrixError>1e-9 || report.maxSocketRelativeError>1e-9 || report.maxExitRelativeError>1e-9) throw new Error('Motion or interface drift');
await Bun.write(`${folder}/motion-proof.json`,JSON.stringify(report,null,2)+'\n');
for (const state of assets) {
 state.mixer.uncacheRoot(state.asset.scene);
 state.asset.scene.traverse(function(n){if(n instanceof Mesh){n.geometry.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])m.dispose();}});
}
console.log(JSON.stringify(report,null,2));
