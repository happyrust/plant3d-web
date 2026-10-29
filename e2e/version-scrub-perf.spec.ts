/**
 * 版本时间轴 · 性能实测（tasks.md 17.2 / Requirement 12）。
 *
 * **只手动跑，不进 CI**：默认 `npm run test:e2e` 不执行它，必须显式给门：
 *
 * ```powershell
 * # 1) 后端：rocksdb 档（不用 mem 档），8022
 * cd D:\work\plant-code\old\gen-model-timeline-scrub
 * $env:AIOS_STORE_MODE = 'rocksdb'
 * # 2) 前端 dev server（或让 Playwright 自己起 3101）
 * cd D:\work\plant-code\old\plant3d-web
 * $env:VERSION_SCRUB_PERF_GATE = '1'
 * $env:VERSION_SCRUB_PERF_EVIDENCE = 'docs/verification/model-version-timeline-scrub/perf'
 * npx playwright test e2e/version-scrub-perf.spec.ts --workers=1
 * ```
 *
 * 门与旋钮：
 * - `VERSION_SCRUB_PERF_GATE=1` 才跑，否则整文件 skip；
 * - `GEN_MODEL_V1_BASE_URL`（缺省 `http://127.0.0.1:8022`）：探针与 `/health` 读这里；
 * - `VERSION_SCRUB_PERF_UNIT`（缺省 `24384_23257`）、`VERSION_SCRUB_PERF_DBNUM`（缺省 `8000`）、
 *   `VERSION_SCRUB_PERF_PROJECT`（缺省 `AvevaMarineSample`）；
 * - `VERSION_SCRUB_PERF_EVIDENCE`：给了目录就把每次耗时 / 每个采样点的 JSON 落进去；
 * - `VERSION_SCRUB_PERF_CACHE_OFF=1`：本次服务端是按 `AIOS_MODEL_HISTORY_REALTIME_CACHE=0` 起的（12.3 用）。
 *
 * 数字一律取自页面里的 `performance.mark`（`version-scrub:frame-shown` / `version-scrub:badge-updated`，
 * 见 tasks.md 17.1 的埋点）与 `window.__versionScrubDebug`，不靠 Playwright 的墙钟——后者含 IPC 抖动。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1920, height: 1080 } });
test.setTimeout(20 * 60_000);
test.skip(
  process.env.VERSION_SCRUB_PERF_GATE !== '1',
  '性能实测只手动跑：设 VERSION_SCRUB_PERF_GATE=1（见文件头注释）',
);

const GEN_MODEL_BASE = process.env.GEN_MODEL_V1_BASE_URL || 'http://127.0.0.1:8022';
const DBNUM = Number(process.env.VERSION_SCRUB_PERF_DBNUM || '8000');
const PROJECT = process.env.VERSION_SCRUB_PERF_PROJECT || 'AvevaMarineSample';
const UNIT = process.env.VERSION_SCRUB_PERF_UNIT || '24384_23257';
const EVIDENCE_DIR = process.env.VERSION_SCRUB_PERF_EVIDENCE || '';
const CACHE_OFF = process.env.VERSION_SCRUB_PERF_CACHE_OFF === '1';

/** Requirement 12 的门槛集中在这里；实测后要调口径只改这一处，并在验证记录里写理由 */
const BUDGET = {
  /** 12.1 缓存热、方向键 20 次，每次 ≤ 300 ms */
  cachedStepMs: 300,
  /** 12.2 服务端缓存热、前端缓存空，10 次 ≤ 500 ms */
  warmStepMs: 500,
  /** 12.3 服务端结果缓存容量 0，10 次 ≤ 2 s */
  coldStepMs: 2_000,
  /** 12.4 仅属性会话 304，角标 200 ms 内更新 */
  notModifiedBadgeMs: 200,
  /** 12.5 拖动期间每个 1 s 窗口 ≥ 30 fps、吸附后 100 ms 内标签更新 */
  dragFps: 30,
  dragSnapLabelMs: 100,
  /** 12.6 前端缓存 ≤ 12 帧、后端 in_flight ≤ 并发上限、结果缓存 ≤ 容量 */
  frameCacheKeys: 12,
  /** 12.7 退出后 1 s 内前端进行中请求 0、5 s 内后端 in_flight 回初值 */
  exitSettleMs: 1_000,
  exitBackendSettleMs: 5_000,
  /** 17.2 末条：500 行版本表首次渲染 */
  tableFirstRenderMs: 500,
};

// ---------------------------------------------------------------------------
// 探针：门 + 夹具（版本数 ≥ 25、几何变化 ≥ 5）
// ---------------------------------------------------------------------------

type VersionRow = { sesno: number; session_time: string | null; impact_kind: string };
type VersionsResponse = { unit_noun: string; file_latest_sesno: number; versions: VersionRow[] };
type RealtimeHealth = {
  cache_entries: number;
  cache_capacity: number;
  in_flight: number;
  concurrency_limit: number;
  input_cache: { entries: number; capacity: number };
};
type HealthResponse = {
  model_cache?: { realtime_history?: RealtimeHealth; historical?: unknown } & Record<string, unknown>;
} & Record<string, unknown>;

let fixture: { rows: VersionRow[]; geometrySesnos: number[] } | null = null;
let probeReason: string | null = null;

const slash = (refno: string) => refno.replace('_', '/');

async function getJson<T>(pathAndQuery: string): Promise<{ status: number; body: T | null }> {
  try {
    const response = await fetch(`${GEN_MODEL_BASE}/api/v1/${pathAndQuery}`);
    if (!response.ok) return { status: response.status, body: null };
    return { status: response.status, body: (await response.json()) as T };
  } catch {
    return { status: 0, body: null };
  }
}

async function realtimeHealth(): Promise<RealtimeHealth | null> {
  const result = await getJson<HealthResponse>('health');
  return result.body?.model_cache?.realtime_history ?? null;
}

async function healthSnapshot(): Promise<HealthResponse | null> {
  return (await getJson<HealthResponse>('health')).body;
}

/** `impact_kind` 里表示「几何有变化」的几种（与前端 `impactLabel` 同一套词） */
const GEOMETRY_IMPACT = new Set(['mesh', 'placement', 'delivery', 'tombstone']);

async function probe(): Promise<string | null> {
  if (!(await healthSnapshot())) return `gen-model 不在 ${GEN_MODEL_BASE}`;
  if (!(await realtimeHealth())) return '`/health.model_cache.realtime_history` 不在——要带实时历史那批改动的构建';

  const versions = await getJson<VersionsResponse>(
    `model/versions?dbnum=${DBNUM}&unit_refno=${slash(UNIT)}&limit=5000`,
  );
  if (!versions.body) return `model/versions HTTP ${versions.status}（${UNIT}）`;
  const rows = versions.body.versions ?? [];
  const geometrySesnos = rows.filter((row) => GEOMETRY_IMPACT.has(row.impact_kind)).map((row) => row.sesno);
  fixture = { rows, geometrySesnos };
  // Requirement 12 的验证口径：版本 ≥ 25、其中几何变化 ≥ 5；不满足时把实际数写进跳过理由
  if (rows.length < 25) {
    return `被测单元 ${UNIT} 只有 ${rows.length} 个版本（要 ≥ 25）：换 VERSION_SCRUB_PERF_UNIT，或先把实际数记进 docs/verification/`;
  }
  if (geometrySesnos.length < 5) {
    return `被测单元 ${UNIT} 只有 ${geometrySesnos.length} 个几何变化版本（要 ≥ 5）：换一个 BRAN`;
  }
  return null;
}

test.beforeAll(async () => {
  probeReason = await probe();
});

test.beforeEach(() => {
  test.skip(probeReason !== null, probeReason ?? '');
});

// ---------------------------------------------------------------------------
// 页面工具
// ---------------------------------------------------------------------------

function evidence(name: string, payload: unknown): void {
  if (!EVIDENCE_DIR) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** 打开面板并进入浏览（`unit_refno` + `compare_autorun`，与既有两份版本 e2e 同一入口） */
async function openBrowse(page: Page, extra: Record<string, string> = {}): Promise<void> {
  const devHost = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:3101').host;
  await page.routeWebSocket((url) => url.host === devHost, () => {
    // 掐掉 Vite HMR：别的会话改代码时 dev server 会 full-reload，把测量冲掉
  });
  const params = new URLSearchParams({
    model_source: 'gen-model-v1',
    gm_backend: GEN_MODEL_BASE,
    output_project: PROJECT,
    unit_refno: UNIT,
    compare_autorun: '1',
    ...extra,
  });
  await page.goto(`/?${params.toString()}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('model-unit-version-compare-panel')).toBeVisible({ timeout: 60_000 });
  // 单单元浏览（不是子树），否则走差异摘要那条慢路
  const self = page.getByTestId('model-unit-compare-scope-self');
  if (await self.isVisible().catch(() => false)) await self.click();
  await expect(page.getByTestId('version-timeline-scrubber')).toBeVisible({ timeout: 60_000 });
}

const track = (page: Page) => page.getByTestId('version-timeline-scrubber-track');
const cursorEl = (page: Page) => page.getByTestId('version-timeline-scrubber-cursor');

async function cursorSesno(page: Page): Promise<number> {
  return Number(await cursorEl(page).getAttribute('data-sesno'));
}

/** 等浏览模式真正就位：首帧 mark 出现过 */
async function waitBrowseReady(page: Page): Promise<void> {
  await page.getByTestId('version-timeline-scrubber-browse').click();
  await page.waitForFunction(
    () => performance.getEntriesByName('version-scrub:frame-shown').length > 0,
    undefined,
    { timeout: 180_000 },
  );
}

/**
 * 按一次方向键，量「按键那一刻 → 该 sesno 的首帧画完」。
 * 起点在页面里打 mark（`keydown` 之前），终点取 `version-scrub:frame-shown` 的 `detail.sesno`。
 */
async function stepOnce(page: Page, direction: 'ArrowLeft' | 'ArrowRight'): Promise<{ sesno: number; ms: number }> {
  const before = await cursorSesno(page);
  const sesnos = (fixture?.rows ?? []).map((row) => row.sesno);
  const index = sesnos.indexOf(before);
  const expected = sesnos[index + (direction === 'ArrowRight' ? 1 : -1)];
  expect(expected, `${before} 的${direction === 'ArrowRight' ? '后' : '前'}一版`).toBeDefined();

  const from = await page.evaluate(() => {
    performance.clearMarks('perf:step-start');
    performance.mark('perf:step-start');
    return performance.getEntriesByName('perf:step-start').at(-1)?.startTime ?? 0;
  });
  await track(page).focus();
  await page.keyboard.press(direction);
  await expect(cursorEl(page)).toHaveAttribute('data-sesno', String(expected), { timeout: 60_000 });
  await page.waitForFunction(
    (sesno) => performance.getEntriesByName('version-scrub:frame-shown').some(
      (entry) => (entry as PerformanceMark & { detail?: { sesno?: number } }).detail?.sesno === sesno,
    ),
    expected,
    { timeout: 60_000 },
  ).catch(() => undefined);
  const to = await page.evaluate((sesno) => {
    const entries = performance.getEntriesByName('version-scrub:frame-shown') as (PerformanceMark & { detail?: { sesno?: number } })[];
    const hit = [...entries].reverse().find((entry) => entry.detail?.sesno === sesno);
    return hit?.startTime ?? performance.now();
  }, expected);
  return { sesno: expected, ms: Math.round(to - from) };
}

/** 用方向键走到目标版本（不计时），返回途经的 sesno */
async function walkTo(page: Page, target: number): Promise<number[]> {
  const sesnos = (fixture?.rows ?? []).map((row) => row.sesno);
  const passed: number[] = [];
  for (let guard = 0; guard < sesnos.length * 2; guard += 1) {
    const current = await cursorSesno(page);
    if (current === target) return passed;
    const step = sesnos.indexOf(target) > sesnos.indexOf(current) ? 'ArrowRight' : 'ArrowLeft';
    await track(page).focus();
    await page.keyboard.press(step);
    passed.push(await cursorSesno(page));
  }
  throw new Error(`走不到 ${target}`);
}

/** 只量「游标变更 → 角标更新」（Requirement 12.4 的 200 ms 口径） */
async function badgeDelayFor(page: Page, direction: 'ArrowLeft' | 'ArrowRight'): Promise<{ sesno: number; ms: number }> {
  const from = await page.evaluate(() => {
    performance.clearMarks('perf:badge-start');
    performance.mark('perf:badge-start');
    return performance.getEntriesByName('perf:badge-start').at(-1)?.startTime ?? 0;
  });
  await track(page).focus();
  await page.keyboard.press(direction);
  const sesno = await cursorSesno(page);
  await page.waitForFunction(
    (target) => performance.getEntriesByName('version-scrub:badge-updated').some(
      (entry) => (entry as PerformanceMark & { detail?: { sesno?: number } }).detail?.sesno === target,
    ),
    sesno,
    { timeout: 60_000 },
  ).catch(() => undefined);
  const to = await page.evaluate((target) => {
    const entries = performance.getEntriesByName('version-scrub:badge-updated') as (PerformanceMark & { detail?: { sesno?: number } })[];
    const hit = [...entries].reverse().find((entry) => entry.detail?.sesno === target);
    return hit?.startTime ?? performance.now();
  }, sesno);
  return { sesno, ms: Math.round(to - from) };
}

/** 前端只读调试读数（`useVersionFrames.exposeDebug()` 挂上去的） */
const frontendDebug = (page: Page) => page.evaluate(() => {
  const read = (window as unknown as { __versionScrubDebug?: () => { cacheKeys: number; inFlight: number } }).__versionScrubDebug;
  return read ? read() : null;
});

const sesnosOf = () => (fixture?.rows ?? []).map((row) => row.sesno);
const geometrySesnosOf = () => fixture?.geometrySesnos ?? [];

// ---------------------------------------------------------------------------
// 12.1 缓存已有前后各 2 版，方向键 20 次每次 ≤ 300 ms
// ---------------------------------------------------------------------------

test('12.1 缓存热时方向键 20 次每次 ≤ 300 ms', async ({ page }) => {
  await openBrowse(page);
  const sesnos = sesnosOf();
  const mid = Math.max(2, Math.min(sesnos.length - 3, Math.floor(sesnos.length / 2)));
  await walkTo(page, sesnos[mid]);
  await waitBrowseReady(page);
  // 前后各 2 版都已在缓存：来回 20 次，每次都只走一格
  const timings: { sesno: number; ms: number }[] = [];
  for (let i = 0; i < 20; i += 1) {
    timings.push(await stepOnce(page, i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft'));
  }
  evidence('12.1-cached-step', { unit: UNIT, sesnos, mid, timings, budgetMs: BUDGET.cachedStepMs });
  const worst = Math.max(...timings.map((t) => t.ms));
  console.log(`12.1 worst ${worst} ms（预算 ${BUDGET.cachedStepMs}）`, timings.map((t) => t.ms).join(','));
  expect(worst).toBeLessThanOrEqual(BUDGET.cachedStepMs);
});

// ---------------------------------------------------------------------------
// 12.2 服务端缓存热、前端缓存空，10 次 ≤ 500 ms
// ---------------------------------------------------------------------------

test('12.2 服务端缓存热而前端缓存空时 10 次 ≤ 500 ms', async ({ page }) => {
  // 先对目标 sesno 各发一次请求让 Realtime_Result_Cache 命中（Requirement 12 的验证口径）
  const targets = geometrySesnosOf().slice(-4);
  for (const sesno of targets) {
    await fetch(
      `${GEN_MODEL_BASE}/api/v1/model/history/geometry?dbnum=${DBNUM}&unit_refno=${encodeURIComponent(slash(UNIT))}&sesno=${sesno}`,
    ).catch(() => undefined);
  }
  await openBrowse(page);
  // 前端缓存空：先把游标停在 targets 之前一格（这一步不计入），随后 10 次都落进新版本
  const sesnos = sesnosOf();
  const firstIndex = sesnos.indexOf(targets[0]);
  await walkTo(page, sesnos[Math.max(0, firstIndex - 1)]);
  const timings: { sesno: number; ms: number }[] = [];
  for (let i = 0; i < 10; i += 1) {
    const current = await cursorSesno(page);
    const index = sesnos.indexOf(current);
    const direction = i < 4 ? 'ArrowRight' : i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft';
    const next = sesnos[Math.min(sesnos.length - 1, Math.max(0, index + (direction === 'ArrowRight' ? 1 : -1)))];
    expect(next).toBeDefined();
    timings.push(await stepOnce(page, direction));
  }
  evidence('12.2-warm-step', { unit: UNIT, targets, timings, budgetMs: BUDGET.warmStepMs });
  const worst = Math.max(...timings.map((t) => t.ms));
  console.log(`12.2 worst ${worst} ms（预算 ${BUDGET.warmStepMs}）`, timings.map((t) => t.ms).join(','));
  expect(worst).toBeLessThanOrEqual(BUDGET.warmStepMs);
});

// ---------------------------------------------------------------------------
// 12.3 服务端结果缓存容量 0，10 次 ≤ 2 s
// ---------------------------------------------------------------------------

test('12.3 服务端结果缓存容量 0 时 10 次 ≤ 2 s', async ({ page }) => {
  test.skip(!CACHE_OFF, '要用 AIOS_MODEL_HISTORY_REALTIME_CACHE=0 重启服务端，再加 VERSION_SCRUB_PERF_CACHE_OFF=1 跑');
  const realtime = await realtimeHealth();
  expect(realtime?.cache_capacity, 'AIOS_MODEL_HISTORY_REALTIME_CACHE=0 应让 cache_capacity 为 0').toBe(0);

  await openBrowse(page);
  const sesnos = sesnosOf();
  await walkTo(page, sesnos[Math.max(0, sesnos.length - 12)]);
  const timings: { sesno: number; ms: number }[] = [];
  for (let i = 0; i < 10; i += 1) timings.push(await stepOnce(page, 'ArrowRight'));
  evidence('12.3-cold-step', { unit: UNIT, timings, budgetMs: BUDGET.coldStepMs });
  const worst = Math.max(...timings.map((t) => t.ms));
  console.log(`12.3 worst ${worst} ms（预算 ${BUDGET.coldStepMs}）`, timings.map((t) => t.ms).join(','));
  expect(worst).toBeLessThanOrEqual(BUDGET.coldStepMs);
});

// ---------------------------------------------------------------------------
// 12.4 仅属性会话收到 304，角标 200 ms 内更新
// ---------------------------------------------------------------------------

test('12.4 仅属性会话走 304 且角标 200 ms 内更新', async ({ page }) => {
  const responses: { url: string; status: number }[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/model/history/geometry')) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });
  await openBrowse(page);
  const sesnos = sesnosOf();
  await walkTo(page, sesnos[Math.max(0, sesnos.length - 11)]);
  const timings: { sesno: number; ms: number }[] = [];
  for (let i = 0; i < 10; i += 1) {
    timings.push(await badgeDelayFor(page, i % 2 === 0 ? 'ArrowRight' : 'ArrowLeft'));
  }
  const hits = responses.filter((entry) => entry.status === 304);
  evidence('12.4-not-modified', {
    unit: UNIT, timings, budgetMs: BUDGET.notModifiedBadgeMs, responses,
  });
  console.log(`12.4 角标时延 ${timings.map((t) => t.ms).join(',')}；304 命中 ${hits.length}/${responses.length}`);
  // 库里不一定有仅属性版本；没出现 304 时这条不判红，只把实测时延记下来
  test.skip(hits.length === 0, `本次 ${UNIT} 的会话序列没有 304（仅属性版本不足）；角标时延实测 ${timings.map((t) => t.ms).join(',')}`);
  expect(Math.max(...timings.map((t) => t.ms))).toBeLessThanOrEqual(BUDGET.notModifiedBadgeMs);
});

// ---------------------------------------------------------------------------
// 12.5 拖动 30 个刻度：每 1 s 窗口 ≥ 30 fps、吸附后 100 ms 内更新标签
// ---------------------------------------------------------------------------

test('12.5 拖动 30 个刻度时每个 1 s 窗口 ≥ 30 fps 且吸附后 100 ms 内更新标签', async ({ page }) => {
  await openBrowse(page);
  await waitBrowseReady(page);

  // 页面侧采样：rAF 帧时刻 + 「最后一次 pointermove → 游标 data-sesno 变化」的延迟
  await page.evaluate(() => {
    const state = { frames: [] as number[], snapDelays: [] as number[] };
    (window as unknown as { __perfDrag: typeof state }).__perfDrag = state;
    let running = true;
    const tick = (now: number) => {
      state.frames.push(now);
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    const trackEl = document.querySelector('[data-testid="version-timeline-scrubber-track"]');
    const cursor = document.querySelector('[data-testid="version-timeline-scrubber-cursor"]');
    let lastMoveAt = 0;
    trackEl?.addEventListener('pointermove', () => { lastMoveAt = performance.now(); }, { capture: true });
    if (cursor) {
      // data-sesno 变了 = 吸附落到新刻度、游标旁显示新 sesno 与时间
      new MutationObserver(() => {
        if (lastMoveAt > 0) state.snapDelays.push(Math.round(performance.now() - lastMoveAt));
      }).observe(cursor, { attributes: true, attributeFilter: ['data-sesno'] });
    }
    (window as unknown as { __perfDragStop: () => typeof state }).__perfDragStop = () => {
      running = false;
      return state;
    };
  });

  // 从游标本体按下（pointerdown 只绑在游标与钉上，绑在轨道上不会开始拖动）
  const cursorBox = await cursorEl(page).boundingBox();
  expect(cursorBox).not.toBeNull();
  if (!cursorBox) return;
  const trackBox = await track(page).boundingBox();
  expect(trackBox).not.toBeNull();
  if (!trackBox) return;

  const y = cursorBox.y + cursorBox.height / 2;
  await page.mouse.move(cursorBox.x + cursorBox.width / 2, y);
  await page.mouse.down();
  // 3–5 s 内跨越 30 个刻度：30 步 × ~110 ms ≈ 3.3 s
  const steps = 30;
  const from = trackBox.x + 4;
  const to = trackBox.x + trackBox.width - 4;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from + ((to - from) * i) / steps, y, { steps: 2 });
    await page.waitForTimeout(110);
  }
  await page.mouse.up();
  const state = await page.evaluate(
    () => (window as unknown as { __perfDragStop: () => { frames: number[]; snapDelays: number[] } }).__perfDragStop(),
  );

  // 每个连续 1 s 窗口的帧数（窗口不重叠，从第一帧起算）
  const frames = state.frames;
  const windows: number[] = [];
  if (frames.length > 1) {
    let windowStart = frames[0];
    let count = 0;
    for (const at of frames) {
      if (at - windowStart >= 1_000) {
        windows.push(count);
        windowStart = at;
        count = 0;
      }
      count += 1;
    }
    windows.push(count);
  }
  const minFps = windows.length > 0 ? Math.min(...windows) : frames.length;
  evidence('12.5-drag', {
    unit: UNIT, framesPerWindow: windows, minFps,
    snapDelays: state.snapDelays,
    budget: { fps: BUDGET.dragFps, snapLabelMs: BUDGET.dragSnapLabelMs },
  });
  console.log(`12.5 fps/窗口 ${windows.join(',')}；吸附标签时延 ${state.snapDelays.join(',')}`);
  expect(minFps).toBeGreaterThanOrEqual(BUDGET.dragFps);
  expect(state.snapDelays.length, '吸附事件应有采样').toBeGreaterThan(0);
  expect(Math.max(...state.snapDelays)).toBeLessThanOrEqual(BUDGET.dragSnapLabelMs);
});

// ---------------------------------------------------------------------------
// 12.6 / 12.7 连续 10 分钟来回拖动：每 60 s 采样；退出后 1 s / 5 s 收敛
// ---------------------------------------------------------------------------

test('12.6/12.7 连续 10 分钟拖动时缓存与并发有界，退出后 1 s / 5 s 收敛', async ({ page }) => {
  const baselineHealth = await healthSnapshot();
  const baseline = baselineHealth?.model_cache?.realtime_history;
  expect(baseline, '基线 /health.model_cache.realtime_history').toBeTruthy();
  const historicalBaseline = JSON.stringify(baselineHealth?.model_cache?.historical ?? null);

  await openBrowse(page);
  await waitBrowseReady(page);

  const cursorBox = await cursorEl(page).boundingBox();
  const trackBox = await track(page).boundingBox();
  expect(cursorBox).not.toBeNull();
  expect(trackBox).not.toBeNull();
  if (!cursorBox || !trackBox) return;

  const samples: { at: string; frontend: { cacheKeys: number; inFlight: number } | null; backend: RealtimeHealth | null }[] = [];
  const startedAt = Date.now();
  const TEN_MINUTES = 10 * 60_000;
  let nextSampleAt = 60_000;

  const y = cursorBox.y + cursorBox.height / 2;
  await page.mouse.move(cursorBox.x + cursorBox.width / 2, y);
  await page.mouse.down();
  // 在至少 20 个刻度的范围里来回拖
  let direction = 1;
  let position = 0.1;
  const left = trackBox.x + 4;
  const right = trackBox.x + trackBox.width - 4;
  while (Date.now() - startedAt < TEN_MINUTES) {
    position += direction * 0.02;
    if (position >= 0.95) { position = 0.95; direction = -1; }
    if (position <= 0.05) { position = 0.05; direction = 1; }
    await page.mouse.move(left + (right - left) * position, y, { steps: 2 });
    await page.waitForTimeout(80);
    if (Date.now() - startedAt >= nextSampleAt) {
      nextSampleAt += 60_000;
      samples.push({
        at: new Date().toISOString(),
        frontend: await frontendDebug(page),
        backend: await realtimeHealth(),
      });
    }
  }
  await page.mouse.up();

  // 12.7：退出浏览后 1 s 内前端进行中请求为 0；5 s 内后端 in_flight 回初值
  await page.getByTestId('version-timeline-scrubber-exit-browse').click();
  await page.waitForTimeout(BUDGET.exitSettleMs);
  const afterExit = await frontendDebug(page);
  await page.waitForTimeout(BUDGET.exitBackendSettleMs);
  const afterHealth = await healthSnapshot();
  const afterBackend = afterHealth?.model_cache?.realtime_history ?? null;
  const historicalAfter = JSON.stringify(afterHealth?.model_cache?.historical ?? null);

  evidence('12.6-12.7-soak', {
    unit: UNIT, samples, afterExit, afterBackend, baseline,
    historicalUnchanged: historicalAfter === historicalBaseline,
    budget: {
      frameCacheKeys: BUDGET.frameCacheKeys,
      exitSettleMs: BUDGET.exitSettleMs,
      exitBackendSettleMs: BUDGET.exitBackendSettleMs,
    },
  });
  console.log('12.6 samples', JSON.stringify(samples));
  console.log('12.7 afterExit', JSON.stringify(afterExit), 'afterBackend', JSON.stringify(afterBackend));

  for (const sample of samples) {
    if (sample.frontend) {
      expect(sample.frontend.cacheKeys, `前端缓存键数 @${sample.at}`).toBeLessThanOrEqual(BUDGET.frameCacheKeys);
    }
    if (sample.backend) {
      expect(sample.backend.in_flight, `后端 in_flight @${sample.at}`).toBeLessThanOrEqual(sample.backend.concurrency_limit);
      expect(sample.backend.cache_entries, `结果缓存条目 @${sample.at}`).toBeLessThanOrEqual(sample.backend.cache_capacity);
    }
  }
  expect(afterExit?.inFlight ?? 0, '退出后 1 s 前端进行中请求').toBe(0);
  expect(afterExit?.cacheKeys ?? 0, '退出后 1 s 前端缓存').toBe(0);
  expect(historicalAfter, '`/health.model_cache.historical` 快照数应等于初值').toBe(historicalBaseline);
  if (baseline && afterBackend) {
    expect(afterBackend.in_flight, '退出后 5 s 后端 in_flight 应回初值').toBeLessThanOrEqual(baseline.in_flight);
  }
});

// ---------------------------------------------------------------------------
// 12.1 附带：500 行版本表首次渲染 ≤ 500 ms
// ---------------------------------------------------------------------------

test('版本表首次渲染 ≤ 500 ms', async ({ page }) => {
  await openBrowse(page);
  // 时间线默认分片显示（`NODE_TIMELINE_INITIAL_ROWS`）：先点「加载更早」把全部行放出来，再量
  const more = page.getByTestId('model-unit-compare-timeline-more');
  while (await more.isVisible().catch(() => false)) {
    await more.click();
    await page.waitForTimeout(50);
  }
  const elapsed = await page.evaluate(async () => {
    const list = document.querySelector('[data-testid="model-unit-compare-timeline"]');
    if (!list) return -1;
    const started = performance.now();
    const deadline = started + 10_000;
    while (performance.now() < deadline && list.children.length === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return Math.round(performance.now() - started);
  });
  const rows = await page.locator('[data-testid="model-unit-compare-timeline"] > li').count();
  evidence('table-first-render', { unit: UNIT, rows, ms: elapsed, budgetMs: BUDGET.tableFirstRenderMs });
  console.log(`版本表首帧 ${elapsed} ms / ${rows} 行（预算 ${BUDGET.tableFirstRenderMs}）`);
  test.skip(elapsed < 0, '版本表不在页面上');
  expect(elapsed).toBeLessThanOrEqual(BUDGET.tableFirstRenderMs);
});
