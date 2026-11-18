/**
 * 第三轮回放脚本共用的那部分（从 replay-verify.mjs 抽出来的，写法没变；差别只是「页面上装着哪几个节点」由调用方给）。
 *
 * 脚本自己只和沙箱后端 9199 说话；页面发出去的请求由 createGuardedContext 把关：
 * 发往 8022 / 8009 的一律拦下并记账，发往沙箱后端的只放行 GET 和三种只读 POST（调用方可以临时多放一条，见 allowExtraPost）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Matrix4, Quaternion, Vector3 } from 'three';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OUT = path.join(HERE, 'out');
export const TMP = path.join(HERE, 'tmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

export const FRONT = 'http://127.0.0.1:3103';
export const BACKEND = 'http://127.0.0.1:9199';
export const LIVE_PORTS = new Set(['8022', '8009']);
export const PROJECT = 'AvevaMarineSample';
export const FIXTURE = path.join(HERE, 'bin', 'db_session_fixture.debug-20261112.exe');
const DB_DIR = path.join(HERE, 'projects', 'E3D3.1', 'AvevaMarineSample', 'ams000');
export const LIBS = {
  8000: { work: path.join(DB_DIR, 'ams8000_0001'), source: path.join(HERE, 'finals', 'ams8000_0001.sesno1865') },
  7998: { work: path.join(DB_DIR, 'ams7998_0001'), source: path.join(HERE, 'finals', 'ams7998_0001.sesno683') },
};

// 8000 库里录制时用的测试区域（都是真实 E3D 会话造出来的）
export const SITE = '24384_47462';
export const Z = '24384_47463';
export const Z2 = '24384_47500';
export const PIPE = '24384_47481';
export const EQ_RN = '24384_47468';
export const EQ_CASE = '24384_47470';
export const BOX_CASE = '24384_47471';
export const EQ_CP = '24384_47479';
export const EQ_Z2 = '24384_47501';
// 7998 库
export const X_SITE = '24382_1893';
export const X_ZONE = '24382_1911';
export const X_EQUI = '24382_1912';
export const X_BOX = '24382_1913';

export const v1 = (refno) => String(refno).replace('_', '/');
export const key = (refno) => String(refno ?? '').trim().replace('/', '_');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const stamp = () => new Date().toTimeString().slice(0, 8);
export const isRefno = (id) => /^\d+_\d+$/.test(id);

/** 同一时间只许一个回放脚本动沙箱的库文件 */
export function takeReplayLock() {
  const lock = path.join(OUT, 'replay.lock');
  if (existsSync(lock)) {
    const owner = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    try { process.kill(owner, 0); alive = true; } catch { alive = false; }
    if (alive) {
      console.error(`另一个回放脚本（进程 ${owner}）正在跑，这一个不跑`);
      process.exit(9);
    }
  }
  writeFileSync(lock, String(process.pid), 'utf8');
  process.on('exit', () => { try { if (readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } catch { /* 已经没了 */ } });
}

// ------------------------------------------------------------------ 沙箱后端（脚本自己问的，都是只读）

export async function backendFetch(pathAndQuery, init) {
  const response = await fetch(BACKEND + pathAndQuery, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

export async function backendChildren(refno) {
  const { status, body } = await backendFetch(`/api/v1/tree/children?refno=${encodeURIComponent(v1(refno))}&resolved=1`);
  if (status !== 200) return { status, nodes: null, message: typeof body === 'object' ? body?.message : String(body).slice(0, 200) };
  return { status, nodes: (body.nodes ?? []).map((node) => ({ id: key(node.refno), name: node.name, noun: node.noun, owner: key(node.owner), children: node.children_count ?? 0 })) };
}

export async function backendRecords(refno) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const payload = { generation_root: v1(refno), limit: 5000 };
    if (cursor !== null) payload.cursor = cursor;
    const { status, body } = await backendFetch('/api/v1/model/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (status !== 200) return { status, items, message: typeof body === 'object' ? body?.message : String(body).slice(0, 200) };
    items.push(...(body.items ?? []));
    cursor = body.next_cursor ?? null;
    if (cursor === null) return { status, items, complete: body.complete, modelSource: body.model_source, pending: body.pending ?? null };
  }
  return { status: 0, items, message: '翻页太多' };
}

export async function backendRow(dbnum) {
  const { body } = await backendFetch('/api/v1/dbnums');
  return (body.dbnums ?? []).find((row) => row.dbnum === dbnum) ?? null;
}

export const rowBrief = (row) => (row
  ? { file: row.file_latest_sesno, applied: row.applied_sesno, model: row.model_sesno, initialized: row.initialized, excluded: row.excluded, excludedReason: row.excluded_reason, verdict: row.model_verdict }
  : null);

export async function backendNodeStatus(refno) {
  const { status, body } = await backendFetch(`/api/v1/node/model-status?refno=${encodeURIComponent(v1(refno))}`);
  return { status, verdict: body?.verdict ?? null, reason: body?.verdict_reason ?? null, units: body?.units ?? null, code: body?.code ?? null };
}

/** 一条记录的全部实例矩阵：compose(world_trans) × compose(inst.transform)，列主序（与前端 instanceMapping 同一条公式） */
function expectedMatrices(item) {
  const compose = (transform) => {
    const t = transform ?? {};
    const translation = t.translation ?? [0, 0, 0];
    const rotation = t.rotation ?? [0, 0, 0, 1];
    const scale = t.scale ?? [1, 1, 1];
    return new Matrix4().compose(new Vector3(...translation), new Quaternion(...rotation).normalize(), new Vector3(...scale));
  };
  const out = [];
  for (const inst of item.insts ?? []) {
    if (!String(inst.geo_hash ?? '').trim()) continue;
    out.push(compose(item.world_trans).multiply(compose(inst.transform)).toArray());
  }
  return out;
}

export const matrixClose = (a, b) => a.length === 16 && b.length === 16 && a.every((value, index) => Math.abs(value - b[index]) <= 0.05 + 1e-4 * Math.max(Math.abs(value), Math.abs(b[index])));

/** 后端此刻的样子：这几个根的记录（按构件收矩阵）和各库的三枚水位 */
export async function snapshotBackend(roots, dbnums = [8000, 7998]) {
  const out = {};
  for (const root of roots) {
    const result = await backendRecords(root.refno);
    const byRefno = new Map();
    for (const item of result.items) {
      const id = key(item.refno);
      byRefno.set(id, [...(byRefno.get(id) ?? []), ...expectedMatrices(item)]);
    }
    out[root.refno] = { status: result.status, message: result.message ?? null, complete: result.complete ?? null, count: result.items.length, byRefno };
  }
  const rows = {};
  for (const dbnum of dbnums) rows[dbnum] = rowBrief(await backendRow(dbnum));
  return { roots: out, rows };
}

// ------------------------------------------------------------------ 回放与等后端追上

export function replayStep(dbnum, to) {
  const lib = LIBS[dbnum];
  const startedAt = Date.now();
  const run = spawnSync(FIXTURE, ['replay-step', '--source', lib.source, '--work', lib.work, '--to', String(to)], { encoding: 'utf8' });
  const ms = Date.now() - startedAt;
  const last = (run.stdout ?? '').trim().split('\n').pop() ?? '';
  if (run.status !== 0) throw new Error(`replay-step ${dbnum} → ${to} 失败（退出码 ${run.status}）：${run.stderr || run.stdout}`);
  let report = null;
  try { report = JSON.parse(last); } catch { report = { raw: last.slice(0, 300) }; }
  return { ms, at: Date.now(), report };
}

/** 等这个库三枚水位都到 to；记下各用了多久（从 replay-step 写完算起） */
export async function waitCaughtUp(dbnum, to, since, timeoutMs = 240_000) {
  const marks = { fileSeenMs: null, appliedMs: null, modelMs: null };
  let last = null;
  while (Date.now() - since < timeoutMs) {
    const row = await backendRow(dbnum);
    last = rowBrief(row);
    const elapsed = Date.now() - since;
    if (row) {
      if (marks.fileSeenMs === null && row.file_latest_sesno === to) marks.fileSeenMs = elapsed;
      if (marks.appliedMs === null && row.applied_sesno === to) marks.appliedMs = elapsed;
      if (marks.modelMs === null && row.model_sesno === to) marks.modelMs = elapsed;
      if (row.file_latest_sesno === to && row.applied_sesno === to && row.model_sesno === to) return { ok: true, ...marks, row: last };
    }
    await sleep(250);
  }
  return { ok: false, ...marks, row: last };
}

export async function taskFor(dbnum, to) {
  const { body } = await backendFetch('/api/v1/tasks?limit=40');
  const task = (body.tasks ?? []).find((item) => item.dbnum === dbnum && item.end_sesno === to);
  if (!task) return null;
  const detail = task.detail ?? {};
  return {
    task_id: task.task_id, kind: task.kind, state: task.state, start_sesno: task.start_sesno, end_sesno: task.end_sesno,
    units: Array.isArray(detail.units) ? detail.units.map((unit) => ({ root: key(unit.root_refno), noun: unit.noun, kind: unit.kind, status: unit.status })).slice(0, 20) : null,
  };
}

// ------------------------------------------------------------------ 页面

const READ_ONLY_POST = [/^\/api\/v1\/model\/records$/, /^\/api\/v1\/meshes\/batch$/, /^\/api\/v1\/element\/attributes$/];

/**
 * `allowExtraPost()` 回一个正则数组：这一刻额外放行的、发往**沙箱后端**的 POST（只给「在沙箱里按需生成一个小节点」那一步用）。
 * 放行了几发单独记在 `log.extraPost` 里。
 */
export async function createGuardedContext(browser, { viewport = { width: 1600, height: 1000 }, allowExtraPost = () => [] } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'zh-CN' });
  const log = { requests: [], timings: [], blocked: [], toLive: [], allowedPost: {}, extraPost: {}, httpFailures: [], wsReceived: [], wsOpened: [] };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    let url;
    try { url = new URL(request.url()); } catch { return route.continue(); }
    if (LIVE_PORTS.has(url.port)) {
      log.toLive.push({ method, url: url.origin + url.pathname });
      return route.abort('blockedbyclient');
    }
    const isBackend = url.origin === BACKEND || url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/');
    if (!isBackend) return route.continue();
    if (url.origin === BACKEND) log.requests.push({ at: Date.now(), method, path: url.pathname, query: url.search.slice(0, 120) });
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const toSandbox = url.origin === BACKEND && method === 'POST';
      if (toSandbox && READ_ONLY_POST.some((pattern) => pattern.test(url.pathname))) {
        log.allowedPost[url.pathname] = (log.allowedPost[url.pathname] ?? 0) + 1;
      } else if (toSandbox && allowExtraPost().some((pattern) => pattern.test(url.pathname))) {
        log.extraPost[url.pathname] = (log.extraPost[url.pathname] ?? 0) + 1;
      } else {
        log.blocked.push({ method, origin: url.origin, path: url.pathname });
        return route.abort('blockedbyclient');
      }
    }
    return route.continue();
  });
  const startedAt = new Map();
  context.on('request', (request) => {
    if (request.url().startsWith(BACKEND)) startedAt.set(request, Date.now());
  });
  const finish = (request, outcome) => {
    const from = startedAt.get(request);
    if (from === undefined) return;
    startedAt.delete(request);
    let url;
    try { url = new URL(request.url()); } catch { return; }
    log.timings.push({ at: from, ms: Date.now() - from, method: request.method(), path: url.pathname, query: url.search.slice(0, 110), outcome });
  };
  context.on('requestfinished', (request) => finish(request, 'ok'));
  context.on('requestfailed', (request) => finish(request, request.failure()?.errorText ?? 'failed'));
  context.on('response', (response) => {
    if (response.status() < 400 || log.httpFailures.length > 200) return;
    try {
      const url = new URL(response.url());
      if (url.origin === BACKEND) log.httpFailures.push({ at: Date.now(), status: response.status(), method: response.request().method(), path: url.pathname, query: url.search.slice(0, 100) });
    } catch { /* 不是 http(s) 的地址 */ }
  });
  return { context, log };
}

export async function newPage(context, log) {
  const page = await context.newPage();
  const events = { console: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' && events.console.length < 80) events.console.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => events.pageErrors.push(String(error).slice(0, 400)));
  page.on('websocket', (socket) => {
    const url = socket.url();
    let live = false;
    try { live = LIVE_PORTS.has(new URL(url).port); } catch { /* 忽略 */ }
    if (live) log.toLive.push({ method: 'WS', url });
    log.wsOpened.push({ at: Date.now(), url });
    socket.on('framereceived', (frame) => {
      if (!url.includes('/api/v1/ws')) return;
      log.wsReceived.push({ at: Date.now(), payload: String(frame.payload).slice(0, 4000) });
    });
    socket.on('close', () => log.wsOpened.push({ at: Date.now(), url, closed: true }));
  });
  // 页面弹过的每一条提示（应用自己的提示总线）和底部提示条上实际显示过的字
  await page.addInitScript(() => {
    window.__toasts = [];
    window.__snackbarTexts = [];
    import('/src/ribbon/toastBus.ts').then((bus) => {
      bus.onToast((payload) => {
        window.__toasts.push({ at: Date.now(), level: payload.level ?? 'info', message: payload.message });
      });
    }).catch(() => undefined);
    const watch = () => {
      const observer = new MutationObserver(() => {
        for (const node of document.querySelectorAll('.v-snackbar__content')) {
          const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
          const last = window.__snackbarTexts[window.__snackbarTexts.length - 1];
          if (text && (!last || last.text !== text)) window.__snackbarTexts.push({ at: Date.now(), text });
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    };
    if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);
  });
  return { page, events };
}

export function pageUrl(params = {}) {
  const query = new URLSearchParams({ output_project: PROJECT, gm_backend: BACKEND, ...params });
  return `${FRONT}/?${query.toString()}`;
}

export async function openApp(page, params = {}) {
  await page.goto(pageUrl(params), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dtxViewer && !!window.__dtxLayer, null, { timeout: 180_000 });
  await page.waitForSelector('[data-testid="model-getwork-button"]', { timeout: 60_000 });
  await waitInPage(page, async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
  }, null, { timeoutMs: 120_000, intervalMs: 300, what: '模型树取到根' });
}

/** 从页面里读状态：场景里每个对象的矩阵、各根名下的构件、两张登记表、取最新的回执、状态栏、行上的按钮 */
export async function readPage(page, roots, dbnums = [8000, 7998]) {
  return page.evaluate(async ({ roots: wanted, dbnums: libs }) => {
    const [loader, getWork, loadedNodes, registry, generation, notice] = await Promise.all([
      import('/src/composables/useDbnoInstancesDtxLoader.ts'),
      import('/src/composables/useModelGetWork.ts'),
      import('/src/composables/useLoadedNodeStatus.ts'),
      import('/src/composables/modelGetWorkRegistry.ts'),
      import('/src/composables/useModelGeneration.ts'),
      import('/src/composables/useGenModelV1UpdateNotice.ts'),
    ]);
    const layer = window.__dtxLayer;
    const scene = {};
    const objectIds = layer?.getAllObjectIds?.() ?? [];
    for (const dbno of libs) {
      const byRefno = {};
      for (const objectId of objectIds) {
        const refno = loader.resolveDtxRefnoByObjectId(dbno, objectId);
        if (!refno) continue;
        const matrix = layer.getObjectMatrix(objectId);
        (byRefno[refno] ??= []).push({ id: objectId, m: matrix ? Array.from(matrix.elements) : null, visible: layer.isObjectVisible(objectId) });
      }
      scene[dbno] = byRefno;
    }
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: layer } });
    const state = getWork.useModelGetWork().state;
    const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const current = notice.useGenModelV1UpdateNotice().notice.value;
    const rowButtons = {};
    for (const { refno } of wanted) {
      const row = document.querySelector(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
      rowButtons[refno] = row
        ? {
          action: row.querySelector('[data-testid="model-tree-node-action"]')?.getAttribute('data-action') ?? null,
          actionLabel: row.querySelector('[data-testid="model-tree-node-action"]')?.textContent?.trim() ?? null,
          fill: row.querySelector('[data-testid="model-tree-node-fill"]')?.textContent?.trim() ?? null,
          status: row.querySelector('[data-testid="model-tree-status"]')?.getAttribute('data-node-status') ?? null,
        }
        : null;
    }
    return {
      scene,
      sceneObjects: objectIds.length,
      roots: wanted.map(({ refno, dbnum }) => ({ refno, dbnum, members: gen.loadedRefnosOf(refno, dbnum), inScene: gen.isRootInScene(refno, dbnum) })),
      loadedTable: loadedNodes.useLoadedNodeStatus().entries().map((entry) => ({
        refno: entry.refno, dbnum: entry.dbnum, loaded: entry.loaded, modelSesno: entry.loadedModelSesno, fileLatestSesno: entry.loadedFileLatestSesno,
        verdict: entry.status?.verdict ?? null, staleReason: entry.staleReason ?? null, checking: entry.checking,
      })),
      registry: { roots: registry.getWorkRegisteredRoots() },
      getWork: { running: state.running, progress: state.progress, last: state.last ? JSON.parse(JSON.stringify(state.last)) : null },
      notice: current ? JSON.parse(JSON.stringify(current)) : null,
      rowButtons,
      dom: {
        result: text('[data-testid="model-getwork-result"]'),
        updateNotice: text('[data-testid="gen-model-v1-update-notice-text"]'),
        updateNoticeTitle: document.querySelector('[data-testid="gen-model-v1-update-notice"]')?.getAttribute('title') ?? null,
        noticeHasReload: !!document.querySelector('[data-testid="gen-model-v1-update-notice-reload"]'),
        noticeHasDismiss: !!document.querySelector('[data-testid="gen-model-v1-update-notice-dismiss"]'),
        noticeHint: text('[data-testid="gen-model-v1-update-notice-getwork-hint"]'),
      },
      toasts: [...(window.__toasts ?? [])],
      snackbarTexts: [...(window.__snackbarTexts ?? [])],
    };
  }, { roots, dbnums });
}

export async function clickGetWork(page, timeoutMs = 240_000) {
  const before = await page.evaluate(async () => {
    const getWork = await import('/src/composables/useModelGetWork.ts');
    return getWork.useModelGetWork().state.last?.finishedAt ?? 0;
  });
  const startedAt = Date.now();
  await page.click('[data-testid="model-getwork-button"]');
  for (;;) {
    const state = await page.evaluate(async () => {
      const getWork = await import('/src/composables/useModelGetWork.ts');
      const s = getWork.useModelGetWork().state;
      return { running: s.running, progress: s.progress, finishedAt: s.last?.finishedAt ?? 0 };
    });
    if (!state.running && state.finishedAt > before) break;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`取最新 ${timeoutMs} 毫秒没做完（${state.progress}）`);
    await sleep(100);
  }
  return { ms: Date.now() - startedAt, clickedAt: startedAt };
}

/** 让模型树滚到这一行（选中它；树是虚拟列表，不在视口里的行不画） */
export async function locateRow(page, refno) {
  await page.evaluate(async (id) => {
    const selection = await import('/src/composables/useSelectionStore.ts');
    selection.setGlobalSelectedRefno(id);
  }, refno);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  return row;
}

export async function clickEye(page, refno) {
  await locateRow(page, refno);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.locator('[data-testid="model-tree-eye"]').click();
}

export async function expandTree(page, ids) {
  await page.evaluate(async (list) => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const tree = treeStore.getModelTreeInstance();
    for (const id of list) await tree.expandPathToNode(id, { expandSelf: true });
  }, ids);
}

/**
 * 在页面里反复问一个（可以是异步的）判断，直到它为真。
 *
 * 不用 `page.waitForFunction`：它不等异步判断的结果——判断函数回的是一个 Promise，Promise 本身就算「真」，头一拍就放行。
 * 2026-11-12 查出来的：前两轮回放脚本里「等上一个节点装完」「等装载结束」用的都是异步判断，其实一下都没等，
 * 靠的是后面跟着的固定等待。先点设备、紧接着点它所在的 ZONE 时两次装载会重叠，偶尔装出两个一样的对象。
 */
export async function waitInPage(page, predicate, arg, { timeoutMs = 120_000, intervalMs = 150, what = '页面里的条件' } = {}) {
  const from = Date.now();
  for (;;) {
    if (await page.evaluate(predicate, arg)) return Date.now() - from;
    if (Date.now() - from > timeoutMs) throw new Error(`等「${what}」超过 ${timeoutMs} 毫秒`);
    await sleep(intervalMs);
  }
}

/** 等到没有任何装载在跑。刚点完一个会触发装载的按钮时，装载要过一两百毫秒才开始：调用方先等一等再来问。 */
export async function waitIdle(page, timeoutMs = 300_000) {
  await waitInPage(page, async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, { timeoutMs, what: '装载结束' });
}

/** 等这个节点装进场景、而且装载已经结束 */
export async function waitRootLoaded(page, root, timeoutMs = 120_000) {
  await waitInPage(page, async ({ refno, dbnum }) => {
    const [generation, sessions] = await Promise.all([import('/src/composables/useModelGeneration.ts'), import('/src/composables/modelLoadSession.ts')]);
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
    return gen.isRootInScene(refno, dbnum) && !sessions.hasActiveModelLoad();
  }, root, { timeoutMs, what: `节点 ${root.refno} 装完` });
}

/**
 * 状态栏原有的「重载」、重新部署后的重装派发的就是这个事件（`showModelByRefnos { refreshModel: true }`）：
 * 按给定的次序一个个重载。等查看器回执（带 requestId 才有回执）。
 */
export async function dispatchReload(page, refnos) {
  return page.evaluate(({ list, requestId }) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), 180_000);
    const onDone = (event) => {
      if (event.detail?.requestId !== requestId) return;
      window.removeEventListener('showModelByRefnosDone', onDone);
      clearTimeout(timer);
      resolve({ ok: event.detail.ok, fail: event.detail.fail, error: event.detail.error ?? null });
    };
    window.addEventListener('showModelByRefnosDone', onDone);
    window.dispatchEvent(new CustomEvent('showModelByRefnos', { detail: { refnos: list, refreshModel: true, flyTo: false, requestId } }));
  }), { list: refnos, requestId: `r3-${Date.now()}-${Math.random().toString(16).slice(2)}` });
}

// ------------------------------------------------------------------ 对账

/** 场景和后端逐条对：每个在册的根名下的构件集合、每个构件的每个实例矩阵；场景里不许有哪个在册的根都不认的构件 */
export function compareScene(pageState, backend, roots, dbnums = [8000, 7998]) {
  const mismatches = [];
  const expectedByDbnum = Object.fromEntries(dbnums.map((dbnum) => [dbnum, new Map()]));
  let matricesCompared = 0;
  const registered = new Set([
    ...pageState.loadedTable.filter((entry) => entry.loaded).map((entry) => entry.refno),
    ...pageState.registry.roots.map((item) => item.refno),
  ]);
  const unregistered = [];
  for (const root of roots) {
    const want = backend.roots[root.refno];
    const have = pageState.roots.find((item) => item.refno === root.refno);
    if (want.status !== 200) { mismatches.push(`根 ${root.refno}：后端记录接口回 ${want.status}（${want.message}）`); continue; }
    if (!registered.has(root.refno)) { unregistered.push(root.refno); continue; }
    for (const [refno, matrices] of want.byRefno) expectedByDbnum[root.dbnum].set(refno, matrices);
    const wantIds = [...want.byRefno.keys()].filter((refno) => want.byRefno.get(refno).length > 0).sort();
    const members = have?.members ? [...have.members].sort() : null;
    if (wantIds.length === 0) {
      if (have?.inScene) mismatches.push(`根 ${root.refno}：后端一条记录都没有了，页面还说它在场景里（名下 ${members?.length ?? 0} 件）`);
      continue;
    }
    if (!have?.inScene) { mismatches.push(`根 ${root.refno}：后端有 ${wantIds.length} 件，页面说这个根不在场景里`); continue; }
    if (members && members.join(',') !== wantIds.join(',')) {
      const missing = wantIds.filter((id) => !members.includes(id));
      const extra = members.filter((id) => !wantIds.includes(id));
      mismatches.push(`根 ${root.refno} 名下的构件对不上：缺 ${missing.join(',') || '无'}，多 ${extra.join(',') || '无'}`);
    }
  }
  for (const dbnum of dbnums) {
    const sceneRefnos = pageState.scene[dbnum] ?? {};
    const expected = expectedByDbnum[dbnum];
    for (const [refno, matrices] of expected) {
      const objects = sceneRefnos[refno] ?? [];
      if (matrices.length === 0) continue;
      if (objects.length !== matrices.length) {
        mismatches.push(`${refno}：后端 ${matrices.length} 个实例，场景里 ${objects.length} 个对象`);
        continue;
      }
      const unused = objects.map((object) => object.m);
      for (const matrix of matrices) {
        matricesCompared += 1;
        const index = unused.findIndex((candidate) => candidate && matrixClose(candidate, matrix));
        if (index < 0) {
          const near = unused[0];
          mismatches.push(`${refno}：有一个实例的矩阵在场景里找不到（后端平移 ${matrix.slice(12, 15).map((n) => Math.round(n)).join(',')}，场景里 ${near ? near.slice(12, 15).map((n) => Math.round(n)).join(',') : '无'}）`);
        } else {
          unused.splice(index, 1);
        }
      }
    }
    for (const refno of Object.keys(sceneRefnos)) {
      if (!expected.has(refno)) mismatches.push(`场景里还有库 ${dbnum} 的 ${refno}（${sceneRefnos[refno].length} 个对象），后端哪个在册的节点名下都没有它`);
    }
  }
  return { matricesCompared, mismatches, registered: [...registered], unregistered };
}

/**
 * 底部的提示条正显示着的时候，状态栏上的东西有没有被它盖住：提示条与状态栏的矩形有没有交叠；
 * 「重载」「忽略」「取最新」三个按钮各自正中那一点上，最上面的元素是不是按钮自己（被盖住就点不到）。
 */
export async function overlayVersusStatusBar(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null;
    };
    const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const hit = (element) => {
      const rect = rectOf(element);
      if (!rect) return null;
      const top = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      return !!top && (top === element || element.contains(top));
    };
    const statusBar = document.querySelector('[data-testid="app-status-bar"]');
    const reload = document.querySelector('[data-testid="gen-model-v1-update-notice-reload"]');
    const dismiss = document.querySelector('[data-testid="gen-model-v1-update-notice-dismiss"]');
    const getWork = document.querySelector('[data-testid="model-getwork-button"]');
    const snackbars = [...document.querySelectorAll('.v-snackbar__wrapper')].map(rectOf).filter(Boolean);
    const bar = rectOf(statusBar);
    return {
      viewport: window.innerWidth,
      menuMode: document.querySelector('.hierarchical-app-bar') ? 'hierarchical' : 'ribbon',
      statusBar: bar,
      snackbars,
      snackbarOverStatusBar: snackbars.some((item) => overlaps(item, bar)),
      reload: { rect: rectOf(reload), covered: snackbars.some((item) => overlaps(item, rectOf(reload))), clickable: hit(reload) },
      dismiss: { rect: rectOf(dismiss), covered: snackbars.some((item) => overlaps(item, rectOf(dismiss))), clickable: hit(dismiss) },
      getWork: { rect: rectOf(getWork), covered: snackbars.some((item) => overlaps(item, rectOf(getWork))), clickable: hit(getWork) },
    };
  });
}

/** 改窗口宽度，等页面排版跟上（状态栏的右边缘回到窗口之内） */
export async function resizeAndSettle(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForFunction((w) => {
    const bar = document.querySelector('[data-testid="app-status-bar"]');
    return window.innerWidth === w && !!bar && Math.round(bar.getBoundingClientRect().right) <= w;
  }, width, { timeout: 10_000, polling: 100 }).catch(() => undefined);
  await sleep(300);
}

/** 往应用自己的提示总线里放一条验证用的长提示（和取最新那句差不多长），等提示条画出来 */
export async function showProbeToast(page) {
  await page.evaluate(async () => {
    const bus = await import('/src/ribbon/toastBus.ts');
    bus.emitToast({
      message: '（验证用的提示）已取最新：模型树新增 1、删除 1、改名 9；模型重载 3 个节点（新增 9 个构件、撤下 9 个构件）；选中的构件已被删除。没跟到最新：库 7998 不在范围里：模型停在会话 677，库文件已到 679。',
      level: 'warning',
    });
  });
  await page.waitForSelector('.v-snackbar__wrapper', { state: 'visible', timeout: 5_000 });
  await sleep(450);
}

export function makeChecks() {
  const checks = [];
  const check = (step, name, pass, detail = '') => {
    checks.push({ step, name, pass: !!pass, detail: String(detail).slice(0, 1500) });
    console.log(`  ${pass ? '✓' : '✗'} [${step}] ${name}${detail ? ` — ${String(detail).slice(0, 420)}` : ''}`);
  };
  return { checks, check };
}

export function saveJson(name, value) {
  writeFileSync(path.join(OUT, name), `${JSON.stringify(value, (prop, item) => (item instanceof Map ? Object.fromEntries(item) : item), 1)}\n`, 'utf8');
}
