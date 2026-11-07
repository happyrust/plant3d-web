// 交互降画质修订版的实测验收（docs/plans/2026-11-08-frame-budget-downgrade-revision-plan.md 验收标准 2/3/4/6/7）。
// 用法：node accept.mjs [baseUrl] [out.json] [场景名...]；场景缺省全跑。
// 用内置图元演示场景（?dtx_demo=primitives），不依赖后端；通过拦截开发态 window.__dtxDowngrade 的赋值逐帧记录。
import { writeFileSync } from 'node:fs';

import { chromium } from 'playwright';

const [baseUrl = 'http://localhost:3101', outFile = 'result.json', ...only] = process.argv.slice(2);
const HEAVY_COUNT = Number(process.env.ACCEPT_HEAVY_COUNT || 100000);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const E3D = 'dtx_look=sgl&dtx_look_preset=factory';

const hookScript = () => {
  window.__dgLog = [];
  window.__dgLogging = false;
  window.__dgSeen = 0;
  let cur = null;
  Object.defineProperty(window, '__dtxDowngrade', {
    configurable: true,
    get() { return cur; },
    set(v) {
      cur = v;
      window.__dgSeen += 1;
      if (!window.__dgLogging || !v) return;
      window.__dgLog.push({
        t: performance.now(),
        level: v.level,
        p90: v.p90,
        samples: v.samples,
        flips: v.flips,
        warmLevel: v.warmLevel,
        sampleMs: v.sampleMs,
        cpuMs: v.cpuMs,
        intervalMs: v.intervalMs,
        refreshMs: v.refreshMs,
        metric: v.metric,
        moved: v.moved,
        held: v.held,
        enabled: v.enabled,
        pipelineActive: v.pipelineActive,
        // 裁剪状态在本帧赋值之后才更新，这里读到的是上一帧的
        cull: window.__dtxViewCull?.dragging ?? null,
      });
    },
  });
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});

async function openScene(query, { viewport = { width: 1600, height: 900 }, deviceScaleFactor = 1 } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  await context.addInitScript(hookScript);
  const page = await context.newPage();
  page.on('pageerror', (e) => log('pageerror', String(e).slice(0, 300)));
  const url = `${baseUrl}/?dtx_demo=primitives&${query}`;
  log('goto', url, JSON.stringify({ viewport, deviceScaleFactor }));
  await page.goto(url, { timeout: 240_000, waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__dtxViewer && window.__dgSeen > 0, null, { timeout: 300_000, polling: 250 });
  // 首次刷新周期探测在初始化后 1.5 秒开始，约 20 帧
  await page.waitForTimeout(3500);
  const canvas = await page.evaluate(() => {
    const r = window.__dtxViewer.renderer.domElement.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const idle = await page.evaluate(() => ({
    refreshMs: window.__dtxDowngrade?.refreshMs ?? null,
    level: window.__dtxDowngrade?.level ?? null,
    sgl: !!window.__sglLookPipeline,
  }));
  return { context, page, url, canvas, idle };
}

function pct(arr, p) {
  const v = arr.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  return +v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))].toFixed(1);
}

function runLength(levels) {
  const out = [];
  for (const v of levels) {
    const last = out[out.length - 1];
    if (last && last.level === v) last.frames += 1;
    else out.push({ level: v, frames: 1 });
  }
  return out.map((r) => `L${r.level}x${r.frames}`).join(' ');
}

function analyze(entries, tUp, after) {
  const firstMoved = entries.findIndex((e) => e.moved);
  const gestureAll = firstMoved >= 0 ? entries.slice(firstMoved) : [];
  const lastMovedIdx = gestureAll.map((e) => e.moved).lastIndexOf(true);
  const gesture = lastMovedIdx >= 0 ? gestureAll.slice(0, lastMovedIdx + 1) : [];
  const levels = gesture.map((e) => e.level);
  const transitions = [];
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] !== levels[i - 1]) transitions.push({ frame: i, from: levels[i - 1], to: levels[i] });
  }
  const framesTo = (lv) => {
    const i = levels.findIndex((v) => v >= lv);
    return i < 0 ? null : i;
  };
  const lastMoved = gesture[gesture.length - 1] ?? null;
  const restore = lastMoved ? gestureAll.slice(lastMovedIdx + 1).find((e) => e.level === 0) ?? null : null;
  return {
    frames: gesture.length,
    startLevel: levels.length ? levels[0] : null,
    maxLevel: levels.length ? Math.max(...levels) : null,
    levels: runLength(levels),
    transitions,
    onlyUp: transitions.every((x) => x.to > x.from),
    flipsAtEnd: lastMoved?.flips ?? null,
    framesToL1: framesTo(1),
    framesToL2: framesTo(2),
    restoreAfterLastMoveMs: restore && lastMoved ? +(restore.t - lastMoved.t).toFixed(1) : null,
    restoreAfterMouseUpMs: restore ? +(restore.t - tUp).toFixed(1) : null,
    cullDuringDrag: gesture.slice(1).some((e) => e.cull === true),
    cpuMs: { p50: pct(gesture.map((e) => e.cpuMs), 0.5), p90: pct(gesture.map((e) => e.cpuMs), 0.9) },
    intervalMs: { p50: pct(gesture.map((e) => e.intervalMs), 0.5), p90: pct(gesture.map((e) => e.intervalMs), 0.9) },
    sampleMs: { p50: pct(gesture.map((e) => e.sampleMs), 0.5), p90: pct(gesture.map((e) => e.sampleMs), 0.9) },
    metric: gesture.find((e) => e.metric)?.metric ?? null,
    enabledSeen: [...new Set(entries.map((e) => e.enabled))],
    refreshMs: [...entries].reverse().find((e) => typeof e.refreshMs === 'number')?.refreshMs ?? null,
    after,
  };
}

async function drag(scene, ms, { dx = 260, dy = 90, stepMs = 40 } = {}) {
  const { page, canvas } = scene;
  const cx = canvas.x + canvas.w * 0.5;
  const cy = canvas.y + canvas.h * 0.5;
  await page.mouse.move(cx, cy);
  await page.evaluate(() => { window.__dgLog = []; window.__dgLogging = true; });
  await page.mouse.down();
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < ms) {
    const k = (i % 40) / 40;
    await page.mouse.move(cx + dx * Math.sin(k * Math.PI * 2), cy + dy * Math.cos(k * Math.PI * 2));
    i += 1;
    await page.waitForTimeout(stepMs);
  }
  const tUp = await page.evaluate(() => performance.now());
  await page.mouse.up();
  // 松手后阻尼还会转一会；等到回 L0 且停稳（重场景每帧很慢，给足时间）
  await page.waitForFunction(() => {
    const d = window.__dtxDowngrade;
    return !!d && d.level === 0 && !d.moved && !d.held;
  }, null, { timeout: 20_000, polling: 50 }).catch(() => log('  20 秒内未停稳（全画质重场景每帧很慢，阻尼尾巴很长）'));
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    level: window.__dtxDowngrade?.level ?? null,
    pipelineLevel: window.__sglLookPipeline?.downgradeLevel ?? null,
    cull: window.__dtxViewCull?.dragging ?? null,
    refreshMs: window.__dtxDowngrade?.refreshMs ?? null,
  }));
  const entries = await page.evaluate(() => { window.__dgLogging = false; return window.__dgLog; });
  return analyze(entries, tUp, after);
}

/** 一步到位地绕 Z 轴转相机（模拟视图立方体 / 定位构件）：只触发一次 change，之后不再有帧进来 */
async function rotateCamera(page, deg = 30) {
  await page.evaluate((a) => {
    const v = window.__dtxViewer;
    const t = v.controls.target;
    const p = v.camera.position;
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    p.set(t.x + dx * Math.cos(a) - dy * Math.sin(a), t.y + dx * Math.sin(a) + dy * Math.cos(a), p.z);
    v.camera.lookAt(t);
    v.controls.update();
    v.controls.dispatchEvent({ type: 'change' });
  }, (deg * Math.PI) / 180);
}

async function waitLevel(page, level, timeout = 3000) {
  return page.waitForFunction((want) => window.__dtxDowngrade?.level === want, level, { timeout, polling: 'raf' })
    .then(() => true, () => false);
}

async function waitRestored(page, timeout = 3000) {
  const t0 = Date.now();
  const ok = await page.waitForFunction(() => {
    const d = window.__dtxDowngrade;
    return !!d && d.level === 0 && !window.__dtxViewCull?.dragging;
  }, null, { timeout, polling: 'raf' }).then(() => true, () => false);
  const state = await page.evaluate(() => ({ level: window.__dtxDowngrade?.level ?? null, cull: window.__dtxViewCull?.dragging ?? null }));
  return { ok, ms: Date.now() - t0, ...state };
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  log(ok === null ? '—' : ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

const SCENARIOS = {
  async light() {
    const s = await openScene(`${E3D}&dtx_demo_count=500`);
    const d1 = await drag(s, 5000);
    check('标准 2 轻场景全程 L0、flips=0', d1.maxLevel === 0 && d1.flipsAtEnd === 0, `maxLevel=${d1.maxLevel} flips=${d1.flipsAtEnd} frames=${d1.frames}`);
    await s.context.close();
    return { url: s.url, idle: s.idle, drag5s: d1 };
  },

  async heavy() {
    const s = await openScene(`${E3D}&dtx_demo_count=${HEAVY_COUNT}`);
    const d1 = await drag(s, 5000);
    check('标准 3 重场景会升档', (d1.maxLevel ?? 0) >= 1, `maxLevel=${d1.maxLevel} levels=${d1.levels}`);
    check('标准 3 到 L1 ≤ 6 帧', d1.framesToL1 === null ? null : d1.framesToL1 <= 6, `framesToL1=${d1.framesToL1}`);
    check('标准 3 到 L2 ≤ 12 帧', d1.framesToL2 === null ? null : d1.framesToL2 <= 12, `framesToL2=${d1.framesToL2}`);
    check('标准 3 松手前只升不降、flips ≤ 2', d1.onlyUp && (d1.flipsAtEnd ?? 0) <= 2, `onlyUp=${d1.onlyUp} flips=${d1.flipsAtEnd}`);
    check('标准 3 停稳后约 200ms 回 L0', d1.restoreAfterLastMoveMs !== null && d1.restoreAfterLastMoveMs >= 150 && d1.restoreAfterLastMoveMs <= 600 && d1.after.level === 0, `restoreAfterLastMoveMs=${d1.restoreAfterLastMoveMs} after=${JSON.stringify(d1.after)}`);
    const d2 = await drag(s, 2000);
    check('标准 3 3 秒内再拖从上次档位起步', d1.maxLevel ? d2.startLevel === d1.maxLevel : null, `上次 maxLevel=${d1.maxLevel} 本次 startLevel=${d2.startLevel}`);
    await s.page.waitForTimeout(3500);
    const d3 = await drag(s, 2000);
    check('超过 3 秒再拖从 L0 起步', d3.startLevel === 0, `startLevel=${d3.startLevel}`);
    await s.context.close();
    return { url: s.url, idle: s.idle, drag5s: d1, warmDrag2s: d2, coldDrag2s: d3 };
  },

  async gpu() {
    const opts = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 };
    const a = await openScene(`${E3D}&dtx_demo_count=20000`, opts);
    const di = await drag(a, 5000);
    await a.context.close();
    const b = await openScene(`${E3D}&dtx_demo_count=20000&dtx_frame_metric=cpu`, opts);
    const dc = await drag(b, 5000);
    await b.context.close();
    // 瓶颈要看 L0 帧：间隔口径那一轮几帧内就升档了，之后的帧已经变快；CPU 口径那一轮不升档，全程是 L0
    const gpuBound = (dc.cpuMs.p90 ?? Infinity) < 21.7 && (dc.intervalMs.p90 ?? 0) > 21.7;
    check('标准 4 出现 GPU 瓶颈（L0 帧 cpu p90 < 21.7 且 interval p90 > 21.7）', gpuBound, `CPU 口径一轮 levels=${dc.levels} cpu=${JSON.stringify(dc.cpuMs)} interval=${JSON.stringify(dc.intervalMs)}`);
    check('标准 4 间隔口径升档、CPU 口径不升档', gpuBound ? (di.maxLevel ?? 0) >= 1 && dc.maxLevel === 0 : null, `interval maxLevel=${di.maxLevel}（${di.metric}，升档后 interval=${JSON.stringify(di.intervalMs)}） cpu maxLevel=${dc.maxLevel}（${dc.metric}）`);
    return { interval: { url: a.url, idle: a.idle, drag5s: di }, cpu: { url: b.url, idle: b.idle, drag5s: dc } };
  },

  async nonE3d() {
    const s = await openScene('dtx_look=pbr&dtx_demo_count=500');
    const d1 = await drag(s, 3000);
    check('标准 6 非 E3D 一动就到 L1', d1.startLevel === 1, `startLevel=${d1.startLevel} sgl=${s.idle.sgl} levels=${d1.levels}`);
    check('标准 6 拖动中裁小构件、松手后恢复', d1.cullDuringDrag && d1.after.cull === false && d1.after.level === 0, `cullDuringDrag=${d1.cullDuringDrag} after=${JSON.stringify(d1.after)} restoreAfterLastMoveMs=${d1.restoreAfterLastMoveMs}`);
    await s.context.close();
    return { url: s.url, idle: s.idle, drag3s: d1 };
  },

  async flagOff() {
    const s = await openScene(`${E3D}&dtx_demo_count=${HEAVY_COUNT}&dtx_drag_downgrade=0`);
    const d1 = await drag(s, 3000);
    check('标准 7 dtx_drag_downgrade=0 全程 L0', d1.maxLevel === 0 && d1.enabledSeen.every((v) => v === false), `maxLevel=${d1.maxLevel} enabled=${JSON.stringify(d1.enabledSeen)}`);
    await s.context.close();
    return { url: s.url, idle: s.idle, drag3s: d1 };
  },

  async warmOff() {
    const s = await openScene(`${E3D}&dtx_demo_count=${HEAVY_COUNT}&dtx_downgrade_warm_ms=0`);
    const d1 = await drag(s, 5000);
    const d2 = await drag(s, 2000);
    check('标准 7 dtx_downgrade_warm_ms=0 不沿用起步档', d1.maxLevel ? d2.startLevel === 0 : null, `上次 maxLevel=${d1.maxLevel} 本次 startLevel=${d2.startLevel}`);
    await s.context.close();
    return { url: s.url, idle: s.idle, drag5s: d1, drag2s: d2 };
  },

  // 停下之后没有下一帧的两种情况：一步到位的相机变化、按住不动后松手；都必须自己回到 L0
  async stepAndHold() {
    const p = await openScene('dtx_look=pbr&dtx_demo_count=500');
    await rotateCamera(p.page);
    const pbrMoved = await waitLevel(p.page, 1);
    const pbrRestore = await waitRestored(p.page);
    check('一步到位的相机变化（非 E3D）：先到 L1，随后自己回 L0、裁剪关闭', pbrMoved && pbrRestore.ok, JSON.stringify({ pbrMoved, ...pbrRestore }));
    await p.context.close();

    const h = await openScene(`${E3D}&dtx_demo_count=${HEAVY_COUNT}`);
    const d1 = await drag(h, 3000);
    await rotateCamera(h.page);
    const warmMoved = d1.maxLevel ? await waitLevel(h.page, d1.maxLevel) : false;
    const warmRestore = await waitRestored(h.page);
    check('一步到位的相机变化（3 秒内）：先按起步档出画，随后自己回 L0', d1.maxLevel ? warmMoved && warmRestore.ok : null, JSON.stringify({ maxLevel: d1.maxLevel, warmMoved, ...warmRestore }));

    await h.page.waitForTimeout(3500);
    const cx = h.canvas.x + h.canvas.w * 0.5;
    const cy = h.canvas.y + h.canvas.h * 0.5;
    await h.page.mouse.move(cx, cy);
    await h.page.mouse.down();
    const start = Date.now();
    let i = 0;
    while (Date.now() - start < 2500) {
      const k = (i % 40) / 40;
      await h.page.mouse.move(cx + 260 * Math.sin(k * Math.PI * 2), cy + 90 * Math.cos(k * Math.PI * 2));
      i += 1;
      await h.page.waitForTimeout(40);
    }
    // 按住不动等阻尼走完，确认此时确实是「按住、没动、仍降档」
    await h.page.waitForTimeout(2000);
    const held = await h.page.evaluate(() => ({
      level: window.__dtxDowngrade?.level ?? null,
      moved: window.__dtxDowngrade?.moved ?? null,
      held: window.__dtxDowngrade?.held ?? null,
    }));
    await h.page.mouse.up();
    const holdRestore = await waitRestored(h.page);
    check('按住不动后松手：松手后自己回 L0', held.level > 0 && held.moved === false ? holdRestore.ok : null, JSON.stringify({ held, ...holdRestore }));
    await h.context.close();
    return { pbrStep: { pbrMoved, pbrRestore }, warmStep: { maxLevel: d1.maxLevel, warmMoved, warmRestore }, hold: { held, holdRestore } };
  },
};

const results = { baseUrl, heavyCount: HEAVY_COUNT, startedAt: new Date().toISOString(), scenarios: {}, checks };
try {
  for (const [name, run] of Object.entries(SCENARIOS)) {
    if (only.length && !only.includes(name)) continue;
    log('=== scenario', name);
    try {
      results.scenarios[name] = await run();
    } catch (e) {
      results.scenarios[name] = { error: String(e).slice(0, 500) };
      log('scenario error', name, String(e).slice(0, 300));
    }
    writeFileSync(outFile, JSON.stringify(results, null, 2));
  }
} finally {
  results.finishedAt = new Date().toISOString();
  writeFileSync(outFile, JSON.stringify(results, null, 2));
  await browser.close();
  log('wrote', outFile, `pass=${checks.filter((c) => c.ok === true).length} fail=${checks.filter((c) => c.ok === false).length} n/a=${checks.filter((c) => c.ok === null).length}`);
}
