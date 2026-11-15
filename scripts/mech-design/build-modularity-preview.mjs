/** Standalone production-bundled review of actual GLBs; no runtime factory fork. */
const folder=process.argv[2];if(!folder)throw new Error('Usage: bun scripts/mech-design/build-modularity-preview.mjs folder');
const assets={};for(const name of ['original','alternate','empty'])assets[name]=Buffer.from(await Bun.file(`${folder}/${name}.glb`).arrayBuffer()).toString('base64');
const fallbackImages={};
for(const label of ['original','alternate','empty']) {
 fallbackImages[label]={};
 for(const view of ['front','socket-close','rear']) {
  const path=`${folder}/${label}-${view}.png`;
  if(!await Bun.file(path).exists())throw new Error(`Render actual-export fallback first: ${path}`);
  fallbackImages[label][view]=`data:image/png;base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString('base64')}`;
 }
}
const source=`
import {Scene,Color,PerspectiveCamera,WebGLRenderer,HemisphereLight,DirectionalLight,AnimationMixer,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const assets=${JSON.stringify(assets)};
const scenes=[];const loader=new GLTFLoader();
const fallbacks=${JSON.stringify(fallbackImages)};
const status=document.getElementById('status');
let failures=0;
window.addEventListener('error',()=>{status.textContent='Interactive error. Actual-export stills remain available.';});

await Promise.all(Object.entries(assets).map(async function([label,bytes]){
 let renderer;
 try {
 const cell=document.getElementById(label);renderer=new WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.domElement.hidden=true;cell.append(renderer.domElement);
 const scene=new Scene();scene.background=new Color('#171d26');const camera=new PerspectiveCamera(32,1,.01,20);
 scene.add(new HemisphereLight(0xe7efff,0x33302b,2));const key=new DirectionalLight(0xffffff,3);key.position.set(2,4,3);scene.add(key);
 const asset=await loader.parseAsync(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)).buffer,'');scene.add(asset.scene);
 const nodes=new Map();asset.scene.traverse(n=>nodes.set(n.userData.name??n.name,n));
 const rest=new Map();asset.scene.traverse(n=>rest.set(n,{p:n.position.clone(),q:n.quaternion.clone(),s:n.scale.clone()}));
 scenes.push({renderer,scene,camera,asset,nodes,mixer:new AnimationMixer(asset.scene),rest,cell,label,frames:0});
 }catch(error){renderer?.dispose();renderer?.forceContextLoss();failures++;status.textContent='Interactive load failed: '+error.message+'. Actual-export stills remain available.';}
}));

document.getElementById('view').addEventListener('change',function(){
 const view=this.value==='close'?'socket-close':this.value==='rear'?'rear':'front';
 for(const label of Object.keys(fallbacks))document.querySelector('#'+label+' img').src=fallbacks[label][view];
});
let previous=0,clock=0;function draw(time,schedule=true){const delta=Math.min((time-previous)/1000,.05);previous=time;if(document.getElementById('play').checked)clock+=delta;
 const clip=document.getElementById('clip').value;const phase=Number(document.getElementById('phase').value);const yaw=Number(document.getElementById('yaw').value)*Math.PI/180;
 for(const s of scenes){s.mixer.stopAllAction();for(const [n,r]of s.rest){n.position.copy(r.p);n.quaternion.copy(r.q);n.scale.copy(r.s);}
 if(clip!=='rest'){const c=s.asset.animations.find(c=>c.name===clip);s.mixer.clipAction(c).play();s.mixer.setTime(document.getElementById('play').checked?clock%c.duration:phase*c.duration);}
 s.nodes.get('rig_torso').rotateY(yaw);s.scene.updateMatrixWorld(true);
 const view=document.getElementById('view').value;let target=new Vector3(0,.53,0);let pos=new Vector3(1.6,1.1,2.6);
 if(view==='rear')pos.set(-1.6,1.1,-2.6);if(view==='front')pos.set(0,.95,3);if(view==='close'){target.set(.29,.68,.02);pos.set(.85,.95,1.05);}
 s.camera.position.copy(pos);s.camera.lookAt(target);const w=Math.max(1,s.cell.clientWidth),h=340;if(s.renderer.domElement.width!==Math.round(w*s.renderer.getPixelRatio())||s.renderer.domElement.height!==Math.round(h*s.renderer.getPixelRatio()))s.renderer.setSize(w,h,false);s.camera.aspect=w/h;s.camera.updateProjectionMatrix();s.renderer.render(s.scene,s.camera);
 s.frames++;s.renderer.domElement.hidden=false;s.cell.querySelector('img').hidden=true;
 s.cell.dataset.frames=String(s.frames);s.cell.dataset.clip=clip;s.cell.dataset.yaw=String(yaw);s.cell.dataset.phase=String(document.getElementById('play').checked?clock:phase);s.cell.dataset.view=view;s.cell.dataset.pose=JSON.stringify(s.nodes.get('rig_torso').matrixWorld.elements);
 status.textContent=failures?'Some interactive models failed; stills available.':'Interactive models ready — actual exported GLBs';
 }if(schedule)requestAnimationFrame(draw);}
draw(performance.now());
for(const control of document.querySelectorAll('input,select'))for(const event of ['input','change'])control.addEventListener(event,()=>draw(performance.now(),false));
window.addEventListener('pagehide',()=>{for(const s of scenes){s.mixer.uncacheRoot(s.asset.scene);s.asset.scene.traverse(n=>{if(n.isMesh){n.geometry.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material]){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}}});s.renderer.dispose();s.renderer.forceContextLoss();}});
`;
const temp=`${folder}/viewer-entry.mjs`;await Bun.write(temp,source);
const result=await Bun.build({entrypoints:[temp],target:'browser',minify:true});if(!result.success)throw new AggregateError(result.logs);
const script=await result.outputs[0].text();
const controls=`<div class="controls"><label>Motion <select id="clip"><option value="rest">Neutral rest</option><option>walk</option><option>run</option><option>backward</option></select></label><label><input id="play" type="checkbox" checked>Play</label><label>Phase <input id="phase" type="range" min="0" max="1" step="0.01" value=".25"></label><label>Torso aim <input id="yaw" type="range" min="-90" max="90" value="0"></label><label>View <select id="view"><option value="three">Three quarter</option><option value="front">Front</option><option value="rear">Rear</option><option value="close">Socket close</option></select></label></div>`;
const panels=Object.entries({original:'Selected original',alternate:'Draft machine gun',empty:'Draft empty socket'}).map(function([label,title]){return `<article><h3>${title}</h3><div class="stage" id="${label}"><img src="${fallbackImages[label].front}" alt="Actual exported ${title}"></div></article>`;}).join('');
const html=`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Warden modularity proof</title><style>html,body{background:transparent;margin:0;padding:0}body{font:14px var(--font-sans,system-ui);color:var(--foreground)}.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center}label{display:flex;gap:6px;align-items:center}select{background:var(--secondary);color:var(--foreground);border:1px solid var(--border);padding:4px}input{accent-color:var(--primary)}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}article{min-width:0}h3{font-size:14px;font-weight:500}.stage{height:340px;position:relative;overflow:hidden}.stage img,.stage canvas{position:absolute;inset:0;width:100%;height:340px;object-fit:contain}.stage [hidden]{display:none}p{color:var(--muted-foreground);font-size:12px}@media(max-width:650px){main{grid-template-columns:1fr}}</style>${controls}<p id="status">Loading interactive models. Showing actual-export stills until the first draw.</p><main>${panels}</main><p>Owner approved these exact configurations on 2026-11-15 for bounded authoring proof retention; rough appearance is scoped to this experiment. Stills show the imported first pose; interactive controls apply after loading. Three exits, one projectile per shot; empty has no active exits. Torso-rigid aim. Sampled clearance only; no runtime equipment integration.</p><script type="module">${script.replaceAll('</script','<\\/script')}</script></html>`;
await Bun.write(`${folder}/comparison.html`,html);console.log(`${folder}/comparison.html`);

const views=['front','socket-close','rear'];
if(await Bun.file(`${folder}/original-front.png`).exists()) {
 const rows=[];
 for(const view of views){
  const cells=[];
  for(const [label,title]of [['original','Selected original'],['alternate','Draft machine gun'],['empty','Draft empty socket']]){
   const image=Buffer.from(await Bun.file(`${folder}/${label}-${view}.png`).arrayBuffer()).toString('base64');
   cells.push(`<figure><img src="data:image/png;base64,${image}"><figcaption>${title} / ${view}</figcaption></figure>`);
  }
  rows.push(`<section>${cells.join('')}</section>`);
 }
 await Bun.write(`${folder}/render-comparison.html`,`<!doctype html><html><meta charset="utf-8"><style>section{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}figure{margin:0}img{width:100%;display:block}figcaption{font:12px var(--font-sans);color:var(--muted-foreground);padding:6px 0}p{font:14px var(--font-sans)}</style><p>Actual selected-export assemblies. Alternate and empty appearances await owner review.</p>${rows.join('')}</html>`);
}
