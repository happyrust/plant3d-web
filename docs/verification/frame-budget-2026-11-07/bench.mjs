// 帧耗时驱动降画质：真实后端 + 真实拖动下的档位观测。
// 用法：node bench.mjs <baseUrl> <dbnum> <out.json> [extraQuery]
// 依赖解析到 plant3d-web 的 node_modules；脚本放在仓库外（docs/verification 下）。
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('D:/work/plant-code/old/plant3d-web/package.json');
const { chromium } = require('playwright');

const [baseUrl = 'http://localhost:3101', dbnum = '7997', outFile = 'result.json', extra = ''] = process.argv.slice(2);
const url = `${baseUrl}/?show_dbnum=${dbnum}&dtx_look=sgl&dtx_look_preset=factory${extra}`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => log('pageerror', String(e).slice(0, 300)));

log('goto', url);
await page.goto(url, { timeout: 240_000, waitUntil: 'load' });
await page.waitForFunction(() => !!window.__dtxViewer && !!window.__dtxLayer && !!window.__sglLookPipeline && !!window.__dtxViewCull, null, { timeout: 300_000, polling: 500 });

// 用面板上的接口按库号装模型（与 dtx-lod1 bench 同一路径）
const load = await page.evaluate(async (db) => {
  let inst = null;
  for (const e of document.querySelectorAll('*')) {
    let c = e.__vueParentComponent;
    while (c && !(c.setupState && 'modelGenerationRef' in c.setupState)) c = c.parent;
    if (c) { inst = c; break; }
  }
  if (!inst) return { error: 'no ViewerPanel instance' };
  window.__benchInst = inst;
  const ref = inst.setupState.modelGenerationRef;
  const gen = ref?.value ?? ref;
  try {
    const r = await gen.showModelByDbnum(Number(db), { flyTo: true });
    return { loaded: r?.loaded, instanceCount: r?.instanceCount ?? null, budgetLimited: r?.budgetLimited ?? null };
  } catch (e) {
    return { error: String(e).slice(0, 300) };
  }
}, dbnum);
log('load', JSON.stringify(load));

// 等几何稳定（三角形数 > 0 且 4 秒不变）
let lastCount = -1;
let stableSince = Date.now();
while (Date.now() - stableSince < 180_000) {
  const count = await page.evaluate(() => window.__dtxViewCull.getStats?.()?.totalTriangles ?? 0);
  if (count !== lastCount) { lastCount = count; stableSince = Date.now(); }
  if (count > 0 && Date.now() - stableSince >= 4000) break;
  await page.waitForTimeout(500);
}
log('geometry stable', 'triangles', lastCount);

const canvasBox = await page.evaluate(() => {
  const r = window.__dtxViewer.renderer.domElement.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
log('canvas', JSON.stringify(canvasBox));

// 逐帧采样：档位 + 管线实际下发的 level
await page.evaluate(() => {
  window.__benchSamples = [];
  window.__benchSampling = false;
  const tick = () => {
    if (window.__benchSampling) {
      window.__benchSamples.push({
        t: performance.now(),
        level: window.__sglLookPipeline?.downgradeLevel ?? null,
        cullDragging: window.__dtxViewCull?.dragging ?? null,
        d: window.__dtxDowngrade ?? null,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

async function dragFor(ms, opts = {}) {
  const { dx = 260, dy = 90, stepMs = 40 } = opts;
  await page.evaluate(() => { window.__benchSamples = []; window.__benchSampling = true; });
  const cx = canvasBox.x + canvasBox.w * 0.5;
  const cy = canvasBox.y + canvasBox.h * 0.5;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < ms) {
    const k = (i % 40) / 40;
    const s = Math.sin(k * Math.PI * 2);
    await page.mouse.move(cx + dx * s, cy + dy * Math.cos(k * Math.PI * 2));
    i += 1;
    await page.waitForTimeout(stepMs);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const samples = await page.evaluate(() => { window.__benchSampling = false; return window.__benchSamples; });
  return summarize(samples, ms);
}

function summarize(samples, ms) {
  const levels = samples.map((s) => s.level).filter((v) => v !== null);
  const transitions = [];
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] !== levels[i - 1]) transitions.push({ at: i, from: levels[i - 1], to: levels[i] });
  }
  const hist = {};
  for (const v of levels) hist[v] = (hist[v] ?? 0) + 1;
  const times = samples.map((s) => s.t);
  const intervals = [];
  for (let i = 1; i < times.length; i += 1) {
    const d = times[i] - times[i - 1];
    if (d > 0 && d < 2000) intervals.push(d);
  }
  intervals.sort((a, b) => a - b);
  const pct = (p) => (intervals.length ? +intervals[Math.min(intervals.length - 1, Math.floor(p * (intervals.length - 1)))].toFixed(1) : null);
  let oscillation = 0;
  for (let i = 2; i < transitions.length; i += 1) {
    if (transitions[i].to === transitions[i - 2].from && transitions[i].from === transitions[i - 2].to) oscillation += 1;
  }
  const frameMsSeen = samples.map((s) => s.d?.frameMs).filter((v) => typeof v === 'number');
  const p90Seen = samples.map((s) => s.d?.p90).filter((v) => typeof v === 'number');
  const pctOf = (arr, p) => (arr.length ? +[...arr].sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))].toFixed(1) : null);
  return {
    requestedMs: ms,
    frames: levels.length,
    levelHistogram: hist,
    transitions,
    oscillationCount: oscillation,
    rafIntervalMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: intervals.length ? +intervals[intervals.length - 1].toFixed(1) : null },
    measuredFrameMs: { p50: pctOf(frameMsSeen, 0.5), p90: pctOf(frameMsSeen, 0.9) },
    measuredP90: { p50: pctOf(p90Seen, 0.5), max: pctOf(p90Seen, 1) },
  };
}

const results = { url, dbnum, load, triangles: lastCount, canvas: canvasBox, runs: {} };

results.runs.lightDrag5s = await dragFor(5000);
log('lightDrag5s', JSON.stringify(results.runs.lightDrag5s));

results.runs.lightDrag5sRepeat = await dragFor(5000);
log('lightDrag5sRepeat', JSON.stringify(results.runs.lightDrag5sRepeat));

// 极端压力：把预算压到 2ms（升档阈值 2.6ms），验证升 / 降档通路在真实拖动里确实会动
await page.evaluate(() => {
  // 走 URL 才能改 options；这里直接改开发态可观测对象不行，改为下一轮导航
});
await page.goto(`${url}&dtx_frame_budget_ms=2`, { timeout: 240_000, waitUntil: 'load' });
await page.waitForFunction(() => !!window.__sglLookPipeline && !!window.__dtxViewer && !!window.__dtxViewCull, null, { timeout: 300_000, polling: 500 });
await page.evaluate(async (db) => {
  let inst = null;
  for (const e of document.querySelectorAll('*')) {
    let c = e.__vueParentComponent;
    while (c && !(c.setupState && 'modelGenerationRef' in c.setupState)) c = c.parent;
    if (c) { inst = c; break; }
  }
  window.__benchInst = inst;
  const ref = inst?.setupState?.modelGenerationRef;
  const gen = ref?.value ?? ref;
  try { await gen.showModelByDbnum(Number(db), { flyTo: true }); } catch { /* 已装过 */ }
}, dbnum);
let lastCount2 = -1;
let stableSince2 = Date.now();
while (Date.now() - stableSince2 < 180_000) {
  const count = await page.evaluate(() => window.__dtxViewCull.getStats?.()?.totalTriangles ?? 0);
  if (count !== lastCount2) { lastCount2 = count; stableSince2 = Date.now(); }
  if (count > 0 && Date.now() - stableSince2 >= 4000) break;
  await page.waitForTimeout(500);
}
await page.evaluate(() => {
  window.__benchSamples = [];
  window.__benchSampling = false;
  const tick = () => {
    if (window.__benchSampling) {
      window.__benchSamples.push({
        t: performance.now(),
        level: window.__sglLookPipeline?.downgradeLevel ?? null,
        cullDragging: window.__dtxViewCull?.dragging ?? null,
        d: window.__dtxDowngrade ?? null,
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
results.runs.tightBudgetDrag5s = await dragFor(5000);
log('tightBudgetDrag5s', JSON.stringify(results.runs.tightBudgetDrag5s));

writeFileSync(outFile, JSON.stringify(results, null, 2));
log('wrote', outFile);
await browser.close();
