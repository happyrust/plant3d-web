// AMS 装载 + 粗网格补拉 + 帧时间测量（LOD 开 / 关对照）。
// 用法：node bench.mjs <baseUrl> <extraQuery> <out.json>
// 依赖解析到 plant3d-web 的 node_modules；脚本本身放在仓库外。
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('D:/work/plant-code/old/plant3d-web/package.json');
const { chromium } = require('playwright');

const [baseUrl = 'http://localhost:3121', extra = '', outFile = 'result.json'] = process.argv.slice(2);
// 沙箱库（ams-8009 的拷贝）里 model_verdict=in_sync 的 18 个库；6003 / 7009 / 7321 没有数据水位，不装。
const DBS = [7997, 7998, 8000, 7999, 7356, 7354, 7353, 7352, 7350, 7333, 7331, 7330, 7329, 7327, 7326, 7324, 7332, 1112];
const url = `${baseUrl}/?output_project=AvevaMarineSample&show_dbnum_full=1${extra}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const net = {
  hosts: {},
  meshes: { count: 0, bytes: 0 },
  lod1: { ok: 0, notFound: 0, other: 0, okBytes: 0, first: 0, last: 0, cacheControl: null, etag: null },
};
page.on('response', (r) => {
  const u = r.url();
  if (!u.includes('/api/v1/')) return;
  const host = new URL(u).host;
  net.hosts[host] = (net.hosts[host] ?? 0) + 1;
  if (!u.includes('/api/v1/meshes/')) return;
  const len = Number(r.headers()['content-length'] ?? 0);
  if (u.includes('lod=1')) {
    const now = Date.now();
    if (!net.lod1.first) net.lod1.first = now;
    net.lod1.last = now;
    const s = r.status();
    if (s === 200) {
      net.lod1.ok++;
      net.lod1.okBytes += len;
      if (!net.lod1.cacheControl) {
        net.lod1.cacheControl = r.headers()['cache-control'] ?? null;
        net.lod1.etag = r.headers()['etag'] ?? null;
      }
    } else if (s === 404) net.lod1.notFound++;
    else net.lod1.other++;
  } else {
    net.meshes.count++;
    net.meshes.bytes += len;
  }
});
const consoleLod = [];
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('lod1') || t.includes('粗网格')) consoleLod.push(t.slice(0, 300));
});
page.on('pageerror', (e) => log('pageerror', String(e).slice(0, 200)));

log('goto', url);
await page.goto(url, { timeout: 240_000, waitUntil: 'load' });
await page.waitForFunction(() => {
  let i = null;
  for (const e of document.querySelectorAll('*')) {
    let c = e.__vueParentComponent;
    while (c && !(c.setupState && 'modelGenerationRef' in c.setupState)) c = c.parent;
    if (c) { i = c; break; }
  }
  if (!i?.setupState?.modelGenerationRef || !window.__dtxLayer || !window.__dtxViewCull) return false;
  window.__bench = { inst: i };
  return true;
}, null, { timeout: 240_000, polling: 500 });
log('viewer ready');
const cullOptions = await page.evaluate(() => window.__dtxViewCull.getOptions?.() ?? window.__dtxLayer.getCullOptions());
log('cull options', JSON.stringify(cullOptions));
// 给图层的 recompile 计时：粗网格补拉装完后会 recompile 一次，这里数它跑了几次、花了多久
await page.evaluate(() => {
  window.__benchRecompile = { count: 0, ms: 0 };
  const wrap = (layer) => {
    if (!layer || layer.__benchWrapped) return;
    layer.__benchWrapped = true;
    const orig = layer.recompile.bind(layer);
    layer.recompile = (...a) => {
      const t0 = performance.now();
      const r = orig(...a);
      window.__benchRecompile.count++;
      window.__benchRecompile.ms += performance.now() - t0;
      return r;
    };
  };
  wrap(window.__dtxLayer);
  for (const l of window.__dtxShowDbnumExtraLayers ?? []) wrap(l);
});

const heap = () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
// 采样前先 GC（--expose-gc），不然「装载后」的数字里混着没回收的中间量
const heapAfterGc = () => page.evaluate(() => { window.gc?.(); window.gc?.(); return performance.memory?.usedJSHeapSize ?? 0; });
const loads = [];
let heapPeak = 0;
const loadStart = Date.now();
for (const db of DBS) {
  const t0 = Date.now();
  const sampler = setInterval(async () => { try { heapPeak = Math.max(heapPeak, await heap()); } catch { /* 页面忙 */ } }, 2000);
  let res;
  try {
    res = await page.evaluate(async (db) => {
      const ref = window.__bench.inst.setupState.modelGenerationRef;
      const gen = ref?.value ?? ref;
      try {
        const r = await gen.showModelByDbnum(db, { flyTo: false });
        return { loaded: r?.loaded, instanceCount: r?.instanceCount ?? null, budgetLimited: r?.budgetLimited ?? null };
      } catch (e) {
        return { error: String(e).slice(0, 200) };
      }
    }, db);
  } finally {
    clearInterval(sampler);
  }
  const ms = Date.now() - t0;
  loads.push({ db, ms, ...res });
  log('load', db, ms + 'ms', JSON.stringify(res));
}
const loadTotalMs = Date.now() - loadStart;
const loadEndAt = Date.now();
const heapAfterLoad = await heapAfterGc();

// 等粗网格补拉 + recompile 稳定：统计 8 秒不变（且距最后一个 lod=1 响应 ≥ 3 秒）
const lodStats = () => page.evaluate(() => {
  const s = window.__dtxViewCull.getStats();
  const layers = [window.__dtxLayer, ...(window.__dtxShowDbnumExtraLayers ?? [])];
  let lodTriangles = 0;
  let lod1Geometries = 0;
  for (const l of layers) {
    const cs = l.getCullStats();
    lodTriangles += cs.lodTriangles;
    lod1Geometries += l._lod1Geometries?.size ?? 0;
  }
  return { lodCapableObjects: s.lodCapableObjects, lodTriangles, lod1Geometries, totalTriangles: s.totalTriangles, layers: s.layers };
});
const stableStart = Date.now();
let last = '';
let sameSince = Date.now();
let lod = await lodStats();
while (Date.now() - stableStart < 600_000) {
  await page.waitForTimeout(1000);
  lod = await lodStats();
  const key = JSON.stringify(lod);
  if (key !== last) { last = key; sameSince = Date.now(); }
  const quietNet = !net.lod1.last || Date.now() - net.lod1.last > 3000;
  if (Date.now() - sameSince >= 8000 && quietNet) break;
  try { heapPeak = Math.max(heapPeak, await heap()); } catch { /* 页面忙 */ }
}
const lodSettleMs = Date.now() - stableStart;
const heapAfterLod = await heapAfterGc();
const recompile = await page.evaluate(() => window.__benchRecompile);
const lod1Window = net.lod1.first ? { startAfterLoadEndMs: net.lod1.first - loadEndAt, durationMs: net.lod1.last - net.lod1.first } : null;
log('lod settled', lodSettleMs + 'ms', JSON.stringify(lod), JSON.stringify(net.lod1), JSON.stringify(lod1Window), 'recompile', JSON.stringify(recompile));

const bench = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const v = window.__dtxViewer;
  const cam = v.camera;
  const ctl = window.__dtxViewCull;
  const pipe = window.__sglLookPipeline;
  const sel = window.__xeokitViewer.__dtxSelection;
  const gl = v.renderer.getContext();
  const canvas = v.renderer.domElement;
  const h = canvas.clientHeight;
  const layers = [window.__dtxLayer, ...(window.__dtxShowDbnumExtraLayers ?? [])];
  const box = new THREE.Box3();
  for (const l of layers) { const b = l.getBoundingBox(); if (!b.isEmpty()) box.union(b); }
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const views = {
    overview: c.clone().add(new THREE.Vector3(0.6, -0.6, 0.45).multiplyScalar(size)),
    mid: c.clone().add(new THREE.Vector3(0.18, -0.18, 0.12).multiplyScalar(size)),
    near: c.clone().add(new THREE.Vector3(0.05, -0.05, 0.03).multiplyScalar(size)),
  };
  const px = new Uint8Array(4);
  const setView = (pos) => {
    cam.up.set(0, 0, 1);
    cam.position.copy(pos);
    cam.lookAt(c);
    if (v.controls?.target) { v.controls.target.copy(c); v.controls.update?.(); }
    cam.updateMatrixWorld();
  };
  const frame = (mode) => {
    cam.updateMatrixWorld();
    ctl.update(cam, h);
    for (const l of layers) l.update(cam);
    const t0 = performance.now();
    if (mode === 'e3d') pipe.render(v.scene, cam, null);
    else if (sel?.hasOutline()) sel.renderOutline();
    else v.renderer.render(v.scene, cam);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return performance.now() - t0;
  };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const out = { canvas: [canvas.clientWidth, h], box: [box.min.toArray(), box.max.toArray()], frames: {}, pick: {} };
  for (const [name, pos] of Object.entries(views)) {
    setView(pos);
    for (const dragging of [false, true]) {
      ctl.setDragging(dragging);
      pipe?.setInteracting(dragging);
      for (const mode of ['direct', 'e3d']) {
        for (let i = 0; i < 3; i++) frame(mode);
        const times = [];
        const segs = new Set();
        for (let i = 0; i < 15; i++) { times.push(frame(mode)); segs.add(ctl.getStats().segments); }
        const s = ctl.getStats();
        out.frames[`${name}/${dragging ? 'drag' : 'still'}/${mode}`] = {
          medianMs: +median(times).toFixed(1), minMs: +Math.min(...times).toFixed(1), maxMs: +Math.max(...times).toFixed(1),
          triangles: s.triangles, segments: s.segments, segmentsSeen: [...segs], lodObjects: s.lodObjects,
        };
      }
    }
    ctl.setDragging(false);
    pipe?.setInteracting(false);
    frame('direct');
    const rect = canvas.getBoundingClientRect();
    const pts = Array.from({ length: 100 }, (_, i) => new THREE.Vector2(((i * 7919) % 997) / 997 * rect.width, ((i * 104729) % 991) / 991 * rect.height));
    const times = []; let hits = 0;
    for (const p of pts) { const t0 = performance.now(); const r = sel.pick(p); times.push(performance.now() - t0); if (r) hits++; }
    out.pick[name] = { medianMs: +median(times).toFixed(2), maxMs: +Math.max(...times).toFixed(2), hits };
  }
  return out;
});
const result = {
  url, cullOptions, loads, loadTotalMs, loadEndAt,
  heap: { peak: heapPeak, afterLoad: heapAfterLoad, afterLod: heapAfterLod },
  lod, lodSettleMs, lod1Window, recompile, net, consoleLod: consoleLod.slice(0, 40), bench,
};
writeFileSync(outFile, JSON.stringify(result, null, 2));
log('done', outFile);
console.log(JSON.stringify(bench.frames, null, 1));
await browser.close();
