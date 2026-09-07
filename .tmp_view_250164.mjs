import { chromium } from 'playwright';

const url = 'http://localhost:3101/?output_project=AvevaPlantSample&show_dbnum=250164&data_source=parquet';
const shot = 'D:/work/plant-code/plant-model-gen/.tmp_view_250164.png';

const browser = await chromium.launch({
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

console.log('GOTO', url);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

let result = null;
for (let i = 0; i < 75; i++) {
  result = await page.evaluate(() => (window.__dtxLastShowDbnumLoadResult || null));
  if (result && (result.status === 'success' || result.status === 'error' || (result.loadedObjects ?? 0) > 0)) break;
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(1500);

// Fit camera to the loaded model (replicate ToolManagerPanel.fitToScene)
const fit = await page.evaluate(() => {
  const tryFit = (v) => {
    if (!v) return null;
    const layer = v.__dtxLayer;
    const box = layer?.getBoundingBox?.();
    if (!box || !box.min || !box.max) return null;
    const aabb = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
    if (v.cameraFlight?.jumpTo) { v.cameraFlight.jumpTo({ aabb }); return { via: 'cameraFlight', aabb }; }
    return { via: 'box-only', aabb };
  };
  return tryFit(window.__xeokitViewer) || tryFit(window.__viewerContext?.viewerRef?.value) || null;
});
console.log('FIT:', JSON.stringify(fit));

// Explicit camera + force render (headless RAF can stall)
const cam = await page.evaluate(() => {
  const out = {};
  const dv = window.__dtxViewer;
  const v = window.__xeokitViewer;
  try {
    const layer = v?.__dtxLayer;
    out.layerVisible = layer?.visible;
    if (layer && 'visible' in layer) layer.visible = true;
    const box = layer?.getBoundingBox?.();
    if (box) {
      const cx=(box.min.x+box.max.x)/2, cy=(box.min.y+box.max.y)/2, cz=(box.min.z+box.max.z)/2;
      const r = Math.max(box.max.x-box.min.x, box.max.y-box.min.y, box.max.z-box.min.z);
      const d = r*1.6;
      if (dv?.flyTo) { dv.flyTo([cx+d,cy+d,cz+d],[cx,cy,cz],{duration:0}); out.flyTo=true; }
      out.center=[cx,cy,cz]; out.r=r;
    }
    for (const fn of ['requestRender','render','needsRender','forceRender']) {
      if (typeof dv?.[fn]==='function') { try{dv[fn]();}catch{} out['dv_'+fn]=true; }
      if (typeof v?.[fn]==='function') { try{v[fn]();}catch{} out['v_'+fn]=true; }
    }
  } catch(e){ out.err=String(e); }
  return out;
});
console.log('CAM:', JSON.stringify(cam));

const vis = await page.evaluate(() => {
  const out = {};
  const v = window.__xeokitViewer; const dv = window.__dtxViewer;
  const layer = v?.__dtxLayer;
  try {
    out.layerKeys = layer ? Object.getOwnPropertyNames(Object.getPrototypeOf(layer)).filter(k=>typeof layer[k]==='function').slice(0,40) : null;
    out.layerVisible = layer?.visible;
    // reveal everything
    if (typeof layer?.setAllVisible==='function'){ try{layer.setAllVisible(true);}catch(e){out.savErr=String(e);} out.setAllVisible=true; }
    if ('visible' in (layer||{})) layer.visible = true;
    // scene-level setObjectsVisible
    const scene = dv?.scene || v?.scene;
    if (scene?.setObjectsVisible && scene?.objectIds){ try{scene.setObjectsVisible(scene.objectIds,true);}catch{} out.sceneShowAll=true; }
    // closer iso camera
    const box = layer?.getBoundingBox?.();
    if (box && dv?.flyTo){
      const cx=(box.min.x+box.max.x)/2, cy=(box.min.y+box.max.y)/2, cz=(box.min.z+box.max.z)/2;
      const r=Math.max(box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z); const d=r*0.9;
      dv.flyTo([cx+d,cy-d,cz+d*0.7],[cx,cy,cz],{duration:0}); out.flyClose=true;
    }
    dv?.requestRender?.(); v?.requestRender?.();
  } catch(e){ out.err=String(e); }
  return out;
});
console.log('VIS:', JSON.stringify(vis));
for (let i=0;i<6;i++){ await page.evaluate(()=>{ try{window.__dtxViewer?.requestRender?.();}catch{} }); await page.waitForTimeout(400); }

// Far iso camera + pixel-diversity probe on the WebGL canvas
const probe = await page.evaluate(async () => {
  const dv = window.__dtxViewer; const v = window.__xeokitViewer;
  const layer = v?.__dtxLayer; const box = layer?.getBoundingBox?.();
  const out = {};
  if (box && dv?.flyTo){
    const cx=(box.min.x+box.max.x)/2, cy=(box.min.y+box.max.y)/2, cz=(box.min.z+box.max.z)/2;
    const r=Math.max(box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z); const d=r*2.2;
    dv.flyTo([cx+d,cy-d,cz+d*0.8],[cx,cy,cz],{duration:0});
  }
  for (let i=0;i<8;i++){ try{dv?.requestRender?.();}catch{} await new Promise(r=>requestAnimationFrame(r)); }
  // find the gl canvas (largest)
  const cs=[...document.querySelectorAll('canvas')].map(c=>({c,a:c.width*c.height})).sort((x,y)=>y.a-x.a);
  out.canvasCount=cs.length;
  if (cs[0]){ out.w=cs[0].c.width; out.h=cs[0].c.height; }
  return out;
});
console.log('PROBE:', JSON.stringify(probe));

const finalR = await page.evaluate(async () => {
  const dv = window.__dtxViewer; const v = window.__xeokitViewer; const layer = v?.__dtxLayer;
  const out = {};
  try {
    if (layer?.setAllVisible) layer.setAllVisible(true);
    if (typeof layer?.update==='function'){ try{layer.update();}catch(e){out.updErr=String(e);} out.update=true; }
    if (typeof layer?.recompile==='function'){ try{layer.recompile();}catch{} out.recompile=true; }
    const box = layer?.getBoundingBox?.();
    if (box && v?.cameraFlight?.jumpTo){ v.cameraFlight.jumpTo({ aabb:[box.min.x,box.min.y,box.min.z,box.max.x,box.max.y,box.max.z] }); out.nativeFit=true; }
    for (let i=0;i<10;i++){ try{dv?.requestRender?.();}catch{} await new Promise(r=>requestAnimationFrame(r)); }
    // pixel diversity sample from gl canvas
    const c=[...document.querySelectorAll('canvas')].sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    if (c){ const gl=c.getContext('webgl2')||c.getContext('webgl'); if(gl){ const px=new Uint8Array(4*200); gl.readPixels(c.width/2-10,c.height/2-10,20,10,gl.RGBA,gl.UNSIGNED_BYTE,px); const set=new Set(); for(let i=0;i<px.length;i+=4)set.add(px[i]+'_'+px[i+1]+'_'+px[i+2]); out.centerColors=[...set].slice(0,8); } }
  } catch(e){ out.err=String(e); }
  return out;
});
console.log('FINAL:', JSON.stringify(finalR));
await page.waitForTimeout(1500);
for (let i=0;i<5;i++){ await page.evaluate(()=>{ try{window.__dtxViewer?.requestRender?.();}catch{} }); await page.waitForTimeout(400); }
// screenshot only the 3D viewer canvas region
try {
  const canvas = await page.$('canvas');
  if (canvas) { await canvas.screenshot({ path: 'D:/work/plant-code/plant-model-gen/.tmp_view_250164_canvas.png' }); }
} catch (e) { console.log('canvas shot err', String(e)); }
// nudge several render frames
for (let i=0;i<6;i++){ await page.evaluate(()=>{ try{window.__dtxViewer?.requestRender?.();}catch{} }); await page.waitForTimeout(500); }
await page.waitForTimeout(2500);
await page.screenshot({ path: shot });
console.log('RESULT:', JSON.stringify(result));
console.log('LOGS_TAIL:');
console.log(logs.slice(-35).join('\n'));
await browser.close();
