#!/usr/bin/env node
// 排管测量（管道距离抽屉「连排相邻」）真实浏览器端到端验证。
//
// 自己起 Vite dev server（端口 3191，strictPort），用系统 Chrome（channel:'chrome'，无头）
// 打开真实 app，经功能区「测量 → 管道距离」打开抽屉，真实 UI 交互 + DEV 钩子
// `window.__plant3dPipeDistanceE2E`（detectPipeRows / detectBrans / detectPipeRowTubes / getSnapshot）
// 驱动 R1–R6（+ 可选 O1）场景，逐步断言并截图。
//
// 后端指向：`--backend <url>`（缺省线上 0.1.42 `http://123.57.182.243:3100`）。
// 前端经 `?gm_backend=/gm` + dev server env `VITE_GEN_MODEL_V1_PROXY_TARGET=<backend>`
// 走 vite.config.ts 的同源 /gm 代理（文档 §3.4 的现行连法）。
// 读 `<backend>/api/v1/health` 的 version 自动选期望档：>=0.1.42 现行期望（目录外径、
// 管底对齐直接生成）；更旧走降级期望（推导间隔带 ≈、管底对齐可能「待确认（估算外径）」）。
//
// 断言失败或环境不可达 → 非零退出（fail-closed）。数值断言以「结构 + 内部一致性」为准；
// 文档 §3.4 的具体数值（208/207/206、187/186/184、511/478）作对照记录进 evidence.json。
//
// 用法：
//   node scripts/pipe-row-browser-verify.mjs [--backend <url>] [--out <dir>] [--port <n>]
//   node scripts/pipe-row-browser-verify.mjs --backend http://localhost:8022 --out docs/verification/pipe-row-browser-2026-10-22/local-0.1.40
//
// 产出：<out>/evidence.json + <out>/NN-*.png 截图。
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

const CENTER_BRANS = ['24381_146830', '24381_146810', '24381_145018'];
const BOTTOM_BRANS = ['24381_146228', '24381_146240', '24381_146280'];
const PROJECT = 'AvevaMarineSample';
const FIXTURE_DBNUM = 7997;
const DOC_CENTER_PAIRS = [
  { centerMm: 208, gapMm: 187 },
  { centerMm: 207, gapMm: 186 },
  { centerMm: 206, gapMm: 184 },
];
const DOC_BOTTOM_PAIR = { centerMm: 511, gapMm: 478 };

function parseArgs(argv) {
  const args = {
    backend: 'http://123.57.182.243:3100',
    out: 'docs/verification/pipe-row-browser-2026-10-22/online-0.1.42',
    port: 3191,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--backend') args.backend = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`unknown arg: ${a}`);
      args.help = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log('usage: node scripts/pipe-row-browser-verify.mjs [--backend <url>] [--out <dir>] [--port 3191]');
  process.exit(0);
}

const backend = args.backend.replace(/\/+$/, '');
const outDir = path.resolve(ROOT, args.out);
fs.mkdirSync(outDir, { recursive: true });

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

function parseVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? '').trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

/** >=0.1.42 → 现行期望（逐段 diameter_evidence）；否则降级期望。version 缺失按旧服务端处理。 */
function expectationTier(version) {
  const v = parseVersion(version);
  if (!v) return 'legacy';
  return v.major > 0 || v.minor > 1 || (v.minor === 1 && v.patch >= 42) ? 'modern' : 'legacy';
}

const evidence = {
  checkedAt: new Date().toISOString(),
  script: 'scripts/pipe-row-browser-verify.mjs',
  frontend: { baseSha: '0d7a1138', vitePort: args.port, note: 'working tree = HEAD + 工作区未提交改动（含 PipeDistanceDrawer.vue 自动加载 WIP）' },
  backend: { url: backend, health: null, version: null },
  expectationTier: null,
  steps: [],
  consoleErrors: [],
  pageErrors: [],
  differences: [],
  defects: [],
  screenshots: [],
};

const failures = [];
let currentStep = null;

function step(id, title) {
  currentStep = { id, title, ok: true, assertions: [], observations: {}, screenshots: [] };
  evidence.steps.push(currentStep);
  console.log(`\n== ${id} ${title}`);
}

function assert(cond, desc, detail = '') {
  const entry = { desc, ok: !!cond, detail: String(detail).slice(0, 500) };
  currentStep?.assertions.push(entry);
  if (!cond) {
    if (currentStep) currentStep.ok = false;
    failures.push(`${currentStep?.id ?? '?'}: ${desc}${detail ? ` (${entry.detail})` : ''}`);
    console.log(`  FAIL ${desc}${detail ? ` :: ${entry.detail}` : ''}`);
  } else {
    console.log(`  ok   ${desc}${detail ? ` :: ${entry.detail}` : ''}`);
  }
  return cond;
}

function observe(key, value) {
  if (currentStep) currentStep.observations[key] = value;
  console.log(`  note ${key} = ${typeof value === 'string' ? value : JSON.stringify(value)?.slice(0, 300)}`);
}

function difference(desc, detail = '') {
  evidence.differences.push({ step: currentStep?.id ?? '?', desc, detail });
  console.log(`  diff ${desc}${detail ? ` :: ${detail}` : ''}`);
}

function defect(desc, detail = '') {
  evidence.defects.push({ step: currentStep?.id ?? '?', desc, detail });
  console.log(`  DEFECT ${desc}${detail ? ` :: ${detail}` : ''}`);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms / 1000}s）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchJson(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

let server = null;
let browser = null;
let shotIndex = 0;
let page = null;

async function shot(name) {
  shotIndex += 1;
  const file = path.join(outDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  evidence.screenshots.push(rel(file));
  currentStep?.screenshots.push(rel(file));
  console.log(`  shot ${rel(file)}`);
  return file;
}

async function main() {
  step('S0', '环境探测：后端 health + Vite + 系统 Chrome');

  // 0) 后端 health → version → 期望档（环境不可达直接失败退出）
  let health;
  try {
    health = await fetchJson(`${backend}/api/v1/health`, 15_000);
  } catch (error) {
    assert(false, `后端不可达 ${backend}/api/v1/health`, error instanceof Error ? error.message : String(error));
    return;
  }
  evidence.backend.health = health;
  evidence.backend.version = health?.version ?? null;
  evidence.expectationTier = expectationTier(health?.version);
  observe('backend.version', evidence.backend.version ?? '(missing)');
  observe('expectationTier', evidence.expectationTier);
  const isModern = evidence.expectationTier === 'modern';

  // 1) Vite dev server（走 /gm 代理到目标后端）
  process.env.VITE_GEN_MODEL_V1_PROXY_TARGET = backend;
  process.env.VITE_GEN_MODEL_V1_BASE_URL = '/gm';
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: path.resolve(ROOT, 'vite.config.ts'),
    root: ROOT,
    logLevel: 'warn',
    server: { host: '127.0.0.1', port: args.port, strictPort: true },
  });
  await server.listen();
  const origin = `http://127.0.0.1:${args.port}`;
  console.log(`vite ${origin} → gm proxy ${backend}`);

  // 2) 系统 Chrome
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') evidence.consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => evidence.pageErrors.push(String(e).slice(0, 300)));

  await page.addInitScript(() => {
    try {
      localStorage.setItem('plant3d-menu-mode', 'classic');
      localStorage.removeItem('plant3d-onboarding-v1');
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('plant3d-pipe-distance-v1') || key.startsWith('plant3d-clearance-v1')) {
          localStorage.removeItem(key);
        }
      }
    } catch { /* ignore */ }
    // Vite dev 对 HMR 更新过的模块在 URL 上挂 ?t=；解析页面实际加载的模块 URL（避免另起模块实例拿到假 store）
    window.__appModuleUrl = (p) => {
      const hit = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => {
        try {
          return new URL(name).pathname === p;
        } catch {
          return false;
        }
      });
      return hit ?? p;
    };
  });

  // 不接 dev-server websocket：HMR full-reload 会把查看器与抽屉拆掉（e2e 惯例）
  try {
    const devHost = new URL(origin).host;
    await page.routeWebSocket((url) => url.host === devHost, () => {});
  } catch { /* 旧版 playwright 没有 routeWebSocket */ }

  const params = new URLSearchParams({
    output_project: PROJECT,
    model_source: 'gen-model-v1',
    gm_backend: '/gm',
    show_refno: CENTER_BRANS[2],
  });
  await page.goto(`${origin}/?${params.toString()}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('canvas', { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__xeokitViewer?.scene, null, { timeout: 60_000 });

  const onboardingClose = page.getByRole('button', { name: '关闭向导', exact: true });
  if (await onboardingClose.isVisible().catch(() => false)) {
    await onboardingClose.click({ force: true }).catch(() => undefined);
  }

  // store / 钩子的页面侧读取器
  const readStore = () => page.evaluate(async () => {
    const modUrl = (p) => window.__appModuleUrl?.(p) ?? p;
    const storeMod = await import(modUrl('/src/composables/usePipeDistanceStore.ts'));
    const textMod = await import(modUrl('/src/clearance/adapters/pipeRowRecords.ts'));
    const geomMod = await import(modUrl('/src/clearance/domain/pipeRowGeometry.ts'));
    const s = storeMod.usePipeDistanceStore();
    const slim = (r) => ({
      id: r.id,
      status: r.status,
      metric: r.pipeRow?.metric ?? null,
      alignMode: r.pipeRow?.alignMode ?? null,
      distanceM: r.snapshot?.distanceM ?? null,
      signedGapM: r.pipeRow?.signedGapM ?? null,
      sourceRefno: r.inputs?.sourceRefno ?? null,
      targetRefno: r.inputs?.targetRefno ?? null,
      sourceOdM: r.pipeRow?.sourceOd?.odM ?? null,
      targetOdM: r.pipeRow?.targetOd?.odM ?? null,
      sourceOdEvidence: r.pipeRow?.sourceOd?.evidence ?? null,
      targetOdEvidence: r.pipeRow?.targetOd?.evidence ?? null,
      rowGroupId: r.pipeRow?.rowGroupId ?? null,
      method: r.provenance?.method ?? null,
      warnings: (r.provenance?.warnings ?? []).map((w) => w.code),
      text: r.pipeRow ? textMod.pipeRowValueText(r) : null,
    });
    const det = s.lastRowDetection.value;
    return {
      detectionMode: s.detectionMode.value,
      alignMode: s.pipeRowAlignMode.value,
      maxAdjacentMm: s.pipeRowMaxAdjacentMm.value,
      minCommonMm: s.pipeRowMinCommonMm.value,
      bothMetrics: s.pipeRowBothMetrics.value,
      keyPoints: s.pipeRowKeyPoints.value,
      selectedBranRefnos: [...s.selectedBranRefnos.value],
      selectedTubeKeys: [...s.selectedTubeKeys.value],
      isDetecting: s.isDetecting.value,
      detectError: s.detectError.value,
      detectNotice: s.detectNotice.value,
      diagnostics: [...s.detectDiagnostics.value],
      activeResultId: s.activeResultId.value ?? null,
      hiddenIds: [...s.hiddenResultIds.value],
      counts: {
        all: s.pipeResults.value.length,
        mode: s.modeResults.value.length,
        listed: s.listedResults.value.length,
        visible: s.visibleResults.value.length,
        otherModeVisible: s.otherModeVisibleCount.value,
      },
      results: s.pipeResults.value.map(slim),
      listed: s.listedResults.value.map(slim),
      preview: det ? {
        groupCount: det.groups.length,
        groups: det.groups.map((g) => ({
          key: g.key,
          members: g.members.map((m) => m.branRefno),
          pairCount: g.pairs.length,
          centerDistancesMm: g.pairs.map((p) => Math.round(p.centerDistanceMm * 100) / 100),
          gapsMm: g.pairs.map((p) => p.signedGapMm),
          sectionM: [g.section.axialStartMm / 1000, g.section.axialEndMm / 1000],
          formal: geomMod.isFormalPipeRowGroup(g),
          ambiguous: !!g.ambiguous,
          incomplete: !!g.incomplete,
          estimatedGrouping: !!g.estimatedGrouping,
          diagnostics: [...(g.diagnostics ?? [])],
        })),
        diagnostics: [...(det.diagnostics ?? [])],
        supportNormalDegenerate: !!det.supportNormalDegenerate,
      } : null,
    };
  });

  const hook = (name, hookArgs = []) => page.evaluate(
    async ([n, a]) => {
      const h = window.__plant3dPipeDistanceE2E;
      if (!h || typeof h[n] !== 'function') throw new Error(`__plant3dPipeDistanceE2E.${n} 不存在`);
      return h[n](...a);
    },
    [name, hookArgs],
  );

  const waitHook = () => page.waitForFunction(
    () => typeof window.__plant3dPipeDistanceE2E?.getSnapshot === 'function',
    null,
    { timeout: 60_000 },
  );

  const sceneSummary = () => page.evaluate(() => {
    const scene = window.__xeokitViewer?.scene;
    if (!scene) return { objectIds: 0, loadedRefnos: [], selectedIds: [] };
    const objectIds = scene.objectIds?.length ?? 0;
    const loaded = scene.getLoadedRefnos ? scene.getLoadedRefnos() : [...(scene.objectIds ?? [])];
    const selected = [...(scene.selectedObjectIds ?? [])];
    return { objectIds, loadedRefnos: loaded, selectedIds: selected };
  }).catch(() => ({ objectIds: 0, loadedRefnos: [], selectedIds: [] }));

  // 内部一致性：同一对相邻管 G = D − (OD1+OD2)/2
  function checkPairConsistency(state, { expectApprox = null } = {}) {
    const byPair = new Map();
    for (const r of state.results.filter((x) => x.metric)) {
      const key = r.id.replace(/:(center-distance|derived-gap):/, ':');
      const list = byPair.get(key) ?? [];
      list.push(r);
      byPair.set(key, list);
    }
    const pairs = [];
    for (const [key, recs] of byPair) {
      const cd = recs.find((r) => r.metric === 'center-distance');
      const dg = recs.find((r) => r.metric === 'derived-gap');
      pairs.push({ key, cd, dg });
      assert(!!cd && !!dg, `管对 ${key} 两种度量记录齐全`, `cd=${!!cd} dg=${!!dg}`);
      if (!cd || !dg) continue;
      const dMm = cd.distanceM === null ? null : cd.distanceM * 1000;
      const odA = dg.sourceOdM === null ? null : dg.sourceOdM * 1000;
      const odB = dg.targetOdM === null ? null : dg.targetOdM * 1000;
      const gMm = dg.signedGapM === null ? null : dg.signedGapM * 1000;
      if (dMm !== null && gMm !== null && odA !== null && odB !== null) {
        const expected = dMm - (odA + odB) / 2;
        assert(Math.abs(expected - gMm) <= 0.6, `管对 ${key} G = D − (OD1+OD2)/2 容差内`, `D=${dMm.toFixed(1)} OD=${odA.toFixed(1)}/${odB.toFixed(1)} G=${gMm.toFixed(1)} 期望≈${expected.toFixed(1)}`);
      } else if (gMm === null) {
        assert(odA === null || odB === null || dg.warnings.includes('pipe_row_od_missing'),
          `管对 ${key} 缺外径口径自洽`, `odA=${odA} odB=${odB} warnings=${dg.warnings.join(',')}`);
      }
      if (expectApprox === true && gMm !== null) {
        const estimated = [dg.sourceOdEvidence, dg.targetOdEvidence].some((e) => e === 'legacy-member' || e === 'bore-estimate');
        if (estimated) assert(dg.text.startsWith('≈'), `管对 ${key} 估算外径推导间隔带 ≈`, `text=${dg.text}`);
      }
      if (expectApprox === false && gMm !== null) {
        const estimated = [dg.sourceOdEvidence, dg.targetOdEvidence].some((e) => e === 'legacy-member' || e === 'bore-estimate');
        if (!estimated) assert(!dg.text.startsWith('≈'), `管对 ${key} 目录外径推导间隔不带 ≈`, `text=${dg.text} ev=${dg.sourceOdEvidence}/${dg.targetOdEvidence}`);
      }
    }
    return pairs;
  }

  const setRowNumberInput = async (testid, value) => {
    const input = page.getByTestId(testid);
    await input.fill(String(value));
    await input.press('Enter');
    await input.blur().catch(() => undefined);
    await page.waitForTimeout(150);
    return input.inputValue();
  };

  const setCheckbox = async (testid, on) => {
    const box = page.getByTestId(testid).locator('input[type="checkbox"]');
    await box.setChecked(on);
    await page.waitForTimeout(150);
    return box.isChecked();
  };

  const clickButton = (name) => page.getByRole('button', { name, exact: true }).click();

  const listedHeaderCount = async () => {
    const text = await page.locator('span:has-text("检测结果 (")').first().textContent().catch(() => '');
    const m = /检测结果 \((\d+)/.exec(text ?? '');
    return m ? Number(m[1]) : null;
  };

  step('S1', '页面就绪 + 抽屉钩子');
  await waitHook();
  assert(true, 'DEV 钩子 __plant3dPipeDistanceE2E 可用');
  // show_refno 模型加载是异步链路：等一等但不阻塞（首轮文档也只有标注没有实体）
  const modelLoaded = await page.waitForFunction(
    (dbno) => {
      const viewer = window.__xeokitViewer;
      return viewer?.__dtxLastLoadedDbno === dbno;
    },
    FIXTURE_DBNUM,
    { timeout: 90_000 },
  ).then(() => true).catch(() => false);
  observe('modelLoaded(show_refno)', modelLoaded);
  observe('scene', await sceneSummary());
  if (!modelLoaded) difference('show_refno 模型 90s 内未就绪', '三维里可能只有标注没有管道实体（与文档首轮一致）');

  // ------------------------------------------------------------------
  step('R1', '打开抽屉与连排相邻缺省设置');
  // 真实 UI：功能区「测量」页签 → 「管理 → 管道距离」
  const ribbonTab = page.locator('[data-ribbon-tab="measurement"]');
  const drawerButton = page.locator('button[data-command="panel.pipeDistance"]');
  for (let i = 0; i < 3 && !(await drawerButton.isVisible().catch(() => false)); i += 1) {
    await ribbonTab.click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
  if (await drawerButton.isVisible().catch(() => false)) {
    await drawerButton.click();
    observe('drawerOpen', 'ribbon 测量 → 管道距离');
  } else {
    // 兜底：与 RibbonBar 同一入口的命令总线
    await page.evaluate(async () => {
      const mod = await import(window.__appModuleUrl?.('/src/ribbon/commandBus.ts') ?? '/src/ribbon/commandBus.ts');
      mod.emitCommand('panel.pipeDistance');
    });
    observe('drawerOpen', 'emitCommand 兜底（功能区按钮不可见）');
  }
  await page.waitForSelector('text=距离标注控制', { timeout: 15_000 });
  await clickButton('连排相邻');
  await page.waitForSelector('[data-testid="pipe-row-max-adjacent"]', { timeout: 10_000 });

  let state = await readStore();
  assert(state.detectionMode === 'pipe-row', '检测模式切到连排相邻', state.detectionMode);
  assert(state.alignMode === 'center', '归排方式缺省管中心成排', state.alignMode);
  assert(state.maxAdjacentMm === 1000, '排内相邻上限缺省 1000', state.maxAdjacentMm);
  assert(state.minCommonMm === 300, '最短共同区段缺省 300', state.minCommonMm);
  assert(state.bothMetrics === false, '「同时显示中心距」缺省关', state.bothMetrics);
  assert(state.keyPoints === false, '「三维显示关键点」缺省关', state.keyPoints);
  const maxAdjInput = await page.getByTestId('pipe-row-max-adjacent').inputValue();
  const minCommonInput = await page.getByTestId('pipe-row-min-common').inputValue();
  assert(maxAdjInput === '1000', '排内相邻上限输入框显示 1000', maxAdjInput);
  assert(minCommonInput === '300', '最短共同区段输入框显示 300', minCommonInput);
  // 必填：清空回到 1000
  await page.getByTestId('pipe-row-max-adjacent').fill('');
  await page.getByTestId('pipe-row-max-adjacent').blur();
  await page.waitForTimeout(200);
  state = await readStore();
  const refilled = await page.getByTestId('pipe-row-max-adjacent').inputValue();
  assert(state.maxAdjacentMm === 1000, '清空排内相邻上限回到 1000（store）', state.maxAdjacentMm);
  assert(refilled === '1000', '清空排内相邻上限输入框显示 1000', refilled);
  await shot('r1-drawer-defaults');

  // ------------------------------------------------------------------
  step('R2', '管中心成排：3 根管检测 → 识别预览 → 结果口径');
  await clickButton('管中心成排').catch(() => undefined);
  const detected = await withTimeout(hook('detectPipeRows', [CENTER_BRANS, 'center']), 120_000, 'detectPipeRows(center)');
  assert(detected === true, 'detectPipeRows 返回 true', detected);
  state = await readStore();
  observe('detectError', state.detectError);
  observe('detectNotice', state.detectNotice);
  observe('diagnostics', state.diagnostics);
  assert(state.detectError === null, '检测无错误', state.detectError);
  const preview = state.preview;
  assert(!!preview && preview.groupCount > 0, '识别预览有排', preview?.groupCount);
  const totalPairs = preview ? preview.groups.reduce((n, g) => n + g.pairCount, 0) : 0;
  const heldGroups = preview ? preview.groups.filter((g) => !g.formal) : [];
  observe('preview.groups', preview?.groups.map((g) => ({ members: g.members, pairs: g.pairCount, D: g.centerDistancesMm, sectionM: g.sectionM, formal: g.formal })));
  observe('preview.groupCount', preview?.groupCount);
  observe('preview.totalPairs', totalPairs);
  observe('preview.held', heldGroups.map((g) => g.key));
  if (preview) {
    // 对照文档 §3.4：3 排 3 对全生成
    if (preview.groupCount !== 3 || totalPairs !== 3) {
      difference('文档期望 3 排 3 对', `实测 ${preview.groupCount} 排 ${totalPairs} 对`);
    }
    if (heldGroups.length > 0) {
      difference('文档期望全部直接生成', `${heldGroups.length} 排待确认：${heldGroups.map((g) => [g.key, g.diagnostics.join('|')].join(' ')).join('；')}`);
    }
  }
  if (isModern) {
    assert(heldGroups.length === 0, '0.1.42 期望全部排直接生成（无待确认）', `${heldGroups.length} 排待确认`);
  }
  // 预览摘要 UI 与 store 一致
  const summaryText = (await page.getByTestId('pipe-row-summary').textContent().catch(() => '')) ?? '';
  observe('pipe-row-summary', summaryText.trim());
  const previewRowCount = await page.locator('[data-testid="pipe-row-preview-row"]').count();
  assert(previewRowCount === (preview?.groupCount ?? -1), '预览排数 UI == store', `${previewRowCount} vs ${preview?.groupCount}`);
  // 结果记录：每对两条（中心距 + 推导间隔），缺省列表只列名义间隔
  assert(state.results.filter((r) => r.alignMode === 'center').length === totalPairs * 2,
    '连排记录数 = 对数 × 2', `${state.results.filter((r) => r.alignMode === 'center').length} vs ${totalPairs * 2}`);
  assert(state.listed.length === totalPairs, '缺省列表行数 = 对数（只列名义间隔）', `${state.listed.length} vs ${totalPairs}`);
  assert(state.listed.every((r) => r.metric === 'derived-gap'), '缺省只列名义间隔（derived-gap）', state.listed.map((r) => r.metric).join(','));
  const headerN = await listedHeaderCount();
  assert(headerN === state.counts.visible, '列表头「检测结果 (N)」== visibleResults', `${headerN} vs ${state.counts.visible}`);
  checkPairConsistency(state, { expectApprox: !isModern });
  if (isModern) {
    const approxCount = state.results.filter((r) => r.metric === 'derived-gap' && r.text?.startsWith('≈')).length;
    assert(approxCount === 0, '0.1.42 推导间隔不带 ≈（目录外径）', `${approxCount} 条带 ≈`);
  } else {
    const approxCount = state.results.filter((r) => r.metric === 'derived-gap' && r.text?.startsWith('≈')).length;
    assert(approxCount > 0, '旧服务端推导间隔带 ≈（外径估算）', `${approxCount} 条`);
    if (!(state.detectNotice ?? '').includes('旧服务端')) {
      difference('文档期望提示旧服务端外径估算', `detectNotice=${state.detectNotice}`);
    }
  }
  // 对照文档 §3.4 数值（只记差异不断言）
  const docPairs = DOC_CENTER_PAIRS.map((doc) => {
    const found = (state.results.filter((r) => r.metric === 'center-distance') ?? [])
      .find((r) => Math.abs((r.distanceM ?? 0) * 1000 - doc.centerMm) <= 3);
    return { doc, found: !!found };
  });
  for (const { doc, found } of docPairs) {
    if (!found) difference(`文档中心距 ${doc.centerMm} mm 未在 ±3mm 内命中`, `实测中心距=${state.results.filter((r) => r.metric === 'center-distance').map((r) => ((r.distanceM ?? 0) * 1000).toFixed(1)).join(',')}`);
  }
  observe('values.centerDistancesMm', state.results.filter((r) => r.metric === 'center-distance').map((r) => Math.round((r.distanceM ?? 0) * 1000)));
  observe('values.gaps', state.results.filter((r) => r.metric === 'derived-gap').map((r) => r.text));
  await shot('r2-center-preview-list');
  // 「同时显示中心距」勾上 → 两种都列
  assert(await setCheckbox('pipe-row-both-metrics', true), '勾选「同时显示中心距」');
  state = await readStore();
  assert(state.bothMetrics === true, 'store.bothMetrics on', state.bothMetrics);
  assert(state.listed.length === totalPairs * 2, '勾选后列表行数 = 对数 × 2', `${state.listed.length} vs ${totalPairs * 2}`);
  assert(state.listed.some((r) => r.metric === 'center-distance') && state.listed.some((r) => r.metric === 'derived-gap'),
    '勾选后两种度量都列出');
  await shot('r2-both-metrics');
  await setCheckbox('pipe-row-both-metrics', false);
  state = await readStore();
  assert(state.listed.length === totalPairs, '取消勾选回到只列名义间隔', `${state.listed.length} vs ${totalPairs}`);

  // ------------------------------------------------------------------
  step('R3', '三维标注：关键点 + 行定位');
  assert(await setCheckbox('pipe-row-key-points', true), '勾选「三维显示关键点」');
  state = await readStore();
  assert(state.keyPoints === true, 'store.keyPoints on', state.keyPoints);
  await page.waitForTimeout(800);
  await shot('r3-keypoints-3d');
  observe('sceneAfterKeyPoints', await sceneSummary());
  // 点列表第一行 → activeResult + 飞到测量截面（选中两管）
  const resultRow = page.locator('div.group.flex.cursor-pointer').first();
  if (await resultRow.count() > 0) {
    await resultRow.click();
    await page.waitForTimeout(600);
    state = await readStore();
    assert(!!state.activeResultId, '点行后激活记录', state.activeResultId);
    observe('sceneAfterRowClick', await sceneSummary());
    await shot('r3-row-locate');
  } else {
    defect('结果列表行不可点（无 .group 行）', '跳过行定位断言');
  }
  await setCheckbox('pipe-row-key-points', false);

  // ------------------------------------------------------------------
  step('R4', '隐藏/显示、模式隔离与「另有 N 条」提示');
  const beforeHide = await readStore();
  const firstGroupKey = beforeHide.preview?.groups[0]?.key;
  const firstGroupPairCount = beforeHide.preview?.groups[0]?.pairCount ?? 0;
  const hideBtn = page.locator('[data-testid="pipe-row-preview-row"]').first().getByRole('button', { name: '隐藏本排' });
  assert(await hideBtn.count() > 0, '预览行有「隐藏本排」按钮');
  if (await hideBtn.count() > 0) {
    await hideBtn.click();
    await page.waitForTimeout(300);
    state = await readStore();
    const hiddenRowRecords = state.results.filter((r) => r.rowGroupId === firstGroupKey);
    assert(hiddenRowRecords.length > 0 && hiddenRowRecords.every((r) => state.hiddenIds.includes(r.id)),
      '隐藏本排：该排全部记录进隐藏集', `${hiddenRowRecords.length} 条`);
    assert(state.counts.visible === beforeHide.counts.visible - firstGroupPairCount,
      '隐藏本排：列表可见数 -对数', `${beforeHide.counts.visible} → ${state.counts.visible}`);
    await shot('r4-row-hidden');
    const showBtn = page.locator('[data-testid="pipe-row-preview-row"]').first().getByRole('button', { name: '显示本排' });
    await showBtn.click().catch(() => undefined);
    await page.waitForTimeout(300);
    state = await readStore();
    assert(state.counts.visible === beforeHide.counts.visible, '显示本排恢复', `${state.counts.visible} vs ${beforeHide.counts.visible}`);
  }
  // 模式隔离：连排模式下跑「所有管对」→ 结果各归各
  await withTimeout(hook('detectBrans', [CENTER_BRANS]), 240_000, 'detectBrans(all-pairs)').catch((e) => {
    defect('detectBrans 未完成', e instanceof Error ? e.message : String(e));
  });
  state = await readStore();
  const allPairsRecords = state.results.filter((r) => r.metric === null);
  const rowRecords = state.results.filter((r) => r.metric !== null && r.alignMode === 'center');
  observe('allPairs.records', allPairsRecords.length);
  observe('pipeRow.records', rowRecords.length);
  assert(rowRecords.length === totalPairs * 2, '所有管对检测不动连排结果', `${rowRecords.length} vs ${totalPairs * 2}`);
  if (allPairsRecords.length > 0) {
    const otherMode = page.getByTestId('pipe-distance-other-mode');
    assert(await otherMode.isVisible().catch(() => false), '「另有 N 条其他模式的结果」提示出现');
    const otherText = (await otherMode.textContent().catch(() => '')) ?? '';
    assert(/另有 \d+ 条其他模式/.test(otherText), '提示文案带条数', otherText.trim());
    observe('otherModeVisibleCount', state.counts.otherModeVisible);
  } else {
    difference('所有管对检测未产出记录', `detectError=${state.detectError} notice=${state.detectNotice}`);
  }
  await shot('r4-other-mode-notice');
  // 切到所有管对 → 列表换口径；清空只清当前模式
  await clickButton('所有管对');
  await page.waitForTimeout(300);
  state = await readStore();
  assert(state.detectionMode === 'all-pairs', '切到所有管对模式', state.detectionMode);
  assert(state.listed.every((r) => r.metric === null), '所有管对列表只列非连排记录');
  const clearBtn = page.locator('span:has-text("检测结果") ~ button');
  if (await clearBtn.count() > 0) {
    await clearBtn.first().click();
    await page.waitForTimeout(300);
    state = await readStore();
    assert(state.results.filter((r) => r.metric === null).length === 0, '「清空」清掉所有管对记录');
    assert(state.results.filter((r) => r.metric !== null).length === totalPairs * 2,
      '「清空」不动连排记录', `${state.results.filter((r) => r.metric !== null).length} vs ${totalPairs * 2}`);
  } else if (state.counts.mode === 0) {
    observe('clearButton', '所有管对 0 条结果，「清空」按 v-if 不显示（符合 UI）');
  } else {
    defect('所有管对模式有结果但无「清空」按钮', `modeResults=${state.counts.mode}`);
  }
  await shot('r4-mode-isolation');
  await clickButton('连排相邻');
  await page.waitForTimeout(300);

  // ------------------------------------------------------------------
  step('R5', '管底对齐（阀组 3 根）');
  await clickButton('管底对齐');
  await page.waitForTimeout(250);
  const detectedBottom = await withTimeout(hook('detectPipeRows', [BOTTOM_BRANS, 'bottom']), 120_000, 'detectPipeRows(bottom)');
  assert(detectedBottom === true, 'detectPipeRows(bottom) 返回 true', detectedBottom);
  state = await readStore();
  observe('bottom.preview', state.preview?.groups.map((g) => ({ members: g.members, pairs: g.pairCount, D: g.centerDistancesMm, formal: g.formal, estimated: g.estimatedGrouping })));
  observe('bottom.detectNotice', state.detectNotice);
  assert(state.detectError === null, '管底对齐检测无错误', state.detectError);
  const bottomPreview = state.preview;
  assert(!!bottomPreview && bottomPreview.groupCount > 0, '有管底对齐预览', bottomPreview?.groupCount);
  const bottomHeld = bottomPreview ? bottomPreview.groups.filter((g) => !g.formal) : [];
  const bottomPairs = bottomPreview ? bottomPreview.groups.reduce((n, g) => n + g.pairCount, 0) : 0;
  if (isModern) {
    assert(bottomHeld.length === 0, '0.1.42 管底对齐直接生成（不待确认）', `${bottomHeld.length} 排待确认`);
    if (bottomPreview && (bottomPreview.groupCount !== 1 || bottomPairs !== 1)) {
      difference('文档期望管底对齐 1 排 1 对（511/478）', `实测 ${bottomPreview.groupCount} 排 ${bottomPairs} 对`);
    }
  } else if (bottomHeld.length > 0) {
    // 降级档：估算外径 → 待确认 → 确认生成
    const confirmAll = page.getByRole('button', { name: '全部确认', exact: true });
    const confirmOne = page.locator('[data-testid="pipe-row-preview-row"]').first().getByRole('button', { name: '确认生成' });
    assert(bottomHeld.every((g) => g.estimatedGrouping), '待确认原因含「估算外径」', bottomHeld.map((g) => g.key).join(','));
    if (await confirmAll.isVisible().catch(() => false)) await confirmAll.click();
    else if (await confirmOne.count() > 0) await confirmOne.click();
    await page.waitForTimeout(400);
    state = await readStore();
    observe('bottom.afterConfirm.counts', state.counts);
  }
  state = await readStore();
  const bottomRecords = state.results.filter((r) => r.alignMode === 'bottom');
  assert(bottomRecords.length >= bottomPairs * 2 || bottomRecords.length > 0,
    '管底对齐生成记录', `${bottomRecords.length} 条（pairs=${bottomPairs}）`);
  checkPairConsistency(state, { expectApprox: !isModern });
  const bottomGaps = state.results.filter((r) => r.alignMode === 'bottom' && r.metric === 'derived-gap').map((r) => r.text);
  observe('bottom.gapTexts', bottomGaps);
  if (isModern && !bottomGaps.includes(`${DOC_BOTTOM_PAIR.gapMm} mm`)) {
    difference('文档期望管底对齐名义间隔 478 mm', `实测=${bottomGaps.join(',')}`);
  }
  if (bottomPreview?.supportNormalDegenerate) {
    difference('支承法向退化（需指定竖管支承法向）', '文档场景未命中');
  }
  await shot('r5-bottom-align');

  // ------------------------------------------------------------------
  step('R6', '参数边界：相邻上限 / 最短共同区段');
  await clickButton('管中心成排');
  await page.waitForTimeout(250);
  // 用文档下限断开：比最小中心距还小 → 全部断开
  const minCenterMm = Math.min(...(await readStore()).results.filter((r) => r.metric === 'center-distance' && r.alignMode === 'center').map((r) => (r.distanceM ?? 0) * 1000));
  const breakLimit = Number.isFinite(minCenterMm) ? Math.max(1, Math.floor(minCenterMm) - 1) : 150;
  observe('breakLimitMm', breakLimit);
  await setRowNumberInput('pipe-row-max-adjacent', breakLimit);
  await withTimeout(hook('detectPipeRows', [CENTER_BRANS, 'center']), 120_000, 'detectPipeRows(limit)');
  state = await readStore();
  const brokePairs = state.preview ? state.preview.groups.reduce((n, g) => n + g.pairCount, 0) : -1;
  observe('limited.pairs', brokePairs);
  assert(brokePairs >= 0 && brokePairs < totalPairs, '相邻上限改小 → 排/对减少或断开', `上限 ${breakLimit} mm：${brokePairs} 对（基线 ${totalPairs}）`);
  await shot('r6-max-adjacent-break');
  await setRowNumberInput('pipe-row-max-adjacent', 1000);
  // 最短共同区段改大 → 短区段不成对
  await setRowNumberInput('pipe-row-min-common', 100000);
  await withTimeout(hook('detectPipeRows', [CENTER_BRANS, 'center']), 120_000, 'detectPipeRows(minCommon)');
  state = await readStore();
  const minCommonPairs = state.preview ? state.preview.groups.reduce((n, g) => n + g.pairCount, 0) : -1;
  observe('minCommon100m.pairs', minCommonPairs);
  assert(minCommonPairs === 0, '最短共同区段 100 m → 不成对', `${minCommonPairs} 对`);
  await shot('r6-min-common-break');
  // 回缺省再检测：与 R2 一致
  await setRowNumberInput('pipe-row-min-common', 300);
  await withTimeout(hook('detectPipeRows', [CENTER_BRANS, 'center']), 120_000, 'detectPipeRows(restore)');
  state = await readStore();
  const restoredPairs = state.preview ? state.preview.groups.reduce((n, g) => n + g.pairCount, 0) : -1;
  assert(restoredPairs === totalPairs && state.preview?.groupCount === preview?.groupCount,
    '回缺省重测与 R2 一致', `${state.preview?.groupCount} 排 ${restoredPairs} 对（基线 ${preview?.groupCount} 排 ${totalPairs} 对）`);
  observe('restored.values', state.results.filter((r) => r.metric === 'derived-gap' && r.alignMode === 'center').map((r) => r.text));
  await shot('r6-restored');

  // ------------------------------------------------------------------
  step('O1', '可选：直段 TUBI 选择（best-effort）');
  try {
    // 从中心线取两 BRAN 各自的隐式直段（refno `from~to`），挑中点最近且近平行的一对 → 组 tubeKey
    const segOf = (resp, bran) => (resp.segments ?? []).filter((s) => s.implicit || String(s.noun).toUpperCase() === 'TUBI')
      .map((s, i) => {
        const [f, t] = String(s.refno).split('~');
        return {
          key: `${bran}#${f === 'Head' ? bran : f}-${t === 'Tail' ? bran : t}#${i + 1}`,
          from: f === 'Head' ? bran : f,
          to: t === 'Tail' ? bran : t,
          mid: [(s.start.x + s.end.x) / 2, (s.start.y + s.end.y) / 2, (s.start.z + s.end.z) / 2],
          dir: [s.end.x - s.start.x, s.end.y - s.start.y, s.end.z - s.start.z],
          lengthMm: s.length_mm,
        };
      });
    const [lineA, lineB] = await Promise.all([
      fetchJson(`${backend}/api/v1/spatial/centerline?refno=24381/146830`, 30_000),
      fetchJson(`${backend}/api/v1/spatial/centerline?refno=24381/146810`, 30_000),
    ]);
    const segsA = segOf(lineA, '24381_146830');
    const segsB = segOf(lineB, '24381_146810');
    let best = null;
    for (const a of segsA) {
      for (const b of segsB) {
        const dist = Math.hypot(a.mid[0] - b.mid[0], a.mid[1] - b.mid[1], a.mid[2] - b.mid[2]);
        const la = Math.hypot(...a.dir) || 1;
        const lb = Math.hypot(...b.dir) || 1;
        const cos = Math.abs((a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2]) / (la * lb));
        if (cos > 0.95 && (!best || dist < best.dist)) best = { a, b, dist };
      }
    }
    observe('tubePair', best ? { a: best.a.key, b: best.b.key, midDistMm: Math.round(best.dist) } : null);
    if (best) {
      const tubeOk = await withTimeout(hook('detectPipeRowTubes', [[best.a.key, best.b.key], 'center']), 120_000, 'detectPipeRowTubes');
      state = await readStore();
      const tubePairs = state.preview ? state.preview.groups.reduce((n, g) => n + g.pairCount, 0) : -1;
      observe('tube.result', { ok: tubeOk, groups: state.preview?.groupCount, pairs: tubePairs, selectedTubeKeys: state.selectedTubeKeys, gaps: state.results.filter((r) => r.metric === 'derived-gap').map((r) => r.text) });
      assert(tubeOk === true, 'detectPipeRowTubes 返回 true', tubeOk);
      if (tubePairs !== 1) difference('文档期望直段 1 排 1 对（约 206/184 mm，区段约 1.78 m）', `实测 ${state.preview?.groupCount} 排 ${tubePairs} 对`);
      await shot('o1-tube-detect');
    } else {
      difference('O1 找不到近平行的隐式直段对', `${segsA.length} vs ${segsB.length} 段`);
    }
  } catch (error) {
    difference('O1 直段检测未执行', error instanceof Error ? error.message : String(error));
  }

  // ------------------------------------------------------------------
  step('Z', '页面健康检查');
  observe('consoleErrors.count', evidence.consoleErrors.length);
  if (evidence.consoleErrors.length > 0) observe('consoleErrors.sample', evidence.consoleErrors.slice(0, 5));
  assert(evidence.pageErrors.length === 0, '无未捕获页面错误', evidence.pageErrors.slice(0, 3).join(' | '));
  await shot('final-state');
}

try {
  await main();
} catch (error) {
  console.error('run failed:', error);
  failures.push(`未捕获异常: ${error instanceof Error ? error.message : String(error)}`);
  try {
    if (page) await shot('failure-state');
  } catch { /* ignore */ }
} finally {
  evidence.finishedAt = new Date().toISOString();
  evidence.failures = failures;
  evidence.result = failures.length === 0 ? 'PASS' : 'FAIL';
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`\nevidence → ${rel(path.join(outDir, 'evidence.json'))}`);
  if (browser) await browser.close().catch(() => undefined);
  if (server) await server.close().catch(() => undefined);
}

console.log(failures.length === 0 ? `\nPASS -> ${rel(outDir)}` : `\nFAIL (${failures.length}): \n  ${failures.join('\n  ')}`);
process.exit(failures.length === 0 ? 0 : 1);
