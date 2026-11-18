/**
 * 「取最新」的真实增量回放验证。
 *
 * 工作树自己的开发服务器（3103）连沙箱后端（9199，现网那版程序的副本，只监听被回放的库）；库文件用
 * db_session_fixture replay-step 真的往前推一个个 E3D 存盘会话。**没有叠加层**：页面拿到的每一个答复都是沙箱后端自己给的。
 *
 *   node replay-verify.mjs [--stop-after=<步号>] [--no-restart]
 *
 * 每一步：记下后端此刻的样子 → replay-step → 等后端批次追上（记耗时）→ 看推送到没到、状态栏提示出没出 →
 * 点「取最新」→ 页面里的树和沙箱后端的 tree/children 逐层对、场景里的构件和矩阵与 model/records 逐条对。
 *
 * 护栏：页面发到沙箱后端的只放行 GET 和三种只读 POST；凡是发往 8022 / 8009 的一律拦下并记账（应当一条都没有）。
 * 本脚本自己只和 9199 说话；对它发的写请求只有 replay-step（改的是沙箱里的库文件副本）和重起沙箱后端。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { Matrix4, Quaternion, Vector3 } from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const TMP = path.join(HERE, 'tmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const FRONT = 'http://127.0.0.1:3103';
const BACKEND = 'http://127.0.0.1:9199';
const LIVE_PORTS = new Set(['8022', '8009']);
const PROJECT = 'AvevaMarineSample';
const FIXTURE = path.join(HERE, 'bin', 'db_session_fixture.debug-20261112.exe');
const DB_DIR = path.join(HERE, 'projects', 'E3D3.1', 'AvevaMarineSample', 'ams000');
const LIBS = {
  8000: { work: path.join(DB_DIR, 'ams8000_0001'), source: path.join(HERE, 'finals', 'ams8000_0001.sesno1865') },
  7998: { work: path.join(DB_DIR, 'ams7998_0001'), source: path.join(HERE, 'finals', 'ams7998_0001.sesno683') },
};

// 8000 库里录制时用的测试区域（都是真实 E3D 会话造出来的）
const SITE = '24384_47462';
const Z = '24384_47463';
const Z2 = '24384_47500';
const PIPE = '24384_47481';
const BRAN_OLD = '24384_47574';
const BRAN_COPY = '24384_47584';
const BRAN_AUTO = '24384_47594';
const EQ_RN = '24384_47468';
const EQ_CASE = '24384_47470';
const BOX_CASE = '24384_47471';
const EQ_CP = '24384_47479';
const EQ_Z2 = '24384_47501';
// 7998 库
const X_SITE = '24382_1893';
const X_ZONE = '24382_1911';
const X_EQUI = '24382_1912';
const X_BOX = '24382_1913';

// 页面上装着的四个节点。EQ-CASE 是 ZONE Z 名下的一台设备，先单独装它、再装 Z：一个嵌套在另一个里面
const ROOTS = [
  { refno: EQ_CASE, dbnum: 8000 },
  { refno: Z, dbnum: 8000 },
  { refno: Z2, dbnum: 8000 },
  { refno: X_ZONE, dbnum: 7998 },
];

const args = process.argv.slice(2);
const stopAfter = args.find((arg) => arg.startsWith('--stop-after='))?.slice('--stop-after='.length) ?? null;
const noRestart = args.includes('--no-restart');

const v1 = (refno) => String(refno).replace('_', '/');
const key = (refno) => String(refno ?? '').trim().replace('/', '_');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);
const isRefno = (id) => /^\d+_\d+$/.test(id);

// ------------------------------------------------------------------ 沙箱后端（脚本自己问的，都是只读）

async function backendFetch(pathAndQuery, init) {
  const response = await fetch(BACKEND + pathAndQuery, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

async function backendChildren(refno) {
  const { status, body } = await backendFetch(`/api/v1/tree/children?refno=${encodeURIComponent(v1(refno))}&resolved=1`);
  if (status !== 200) return { status, nodes: null, message: typeof body === 'object' ? body?.message : String(body).slice(0, 200) };
  return { status, nodes: (body.nodes ?? []).map((node) => ({ id: key(node.refno), name: node.name, noun: node.noun, owner: key(node.owner), children: node.children_count ?? 0 })) };
}

async function backendRecords(refno) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 100; page += 1) {
    const payload = { generation_root: v1(refno), limit: 5000 };
    if (cursor !== null) payload.cursor = cursor;
    const { status, body } = await backendFetch('/api/v1/model/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (status !== 200) return { status, items, message: typeof body === 'object' ? body?.message : String(body).slice(0, 200) };
    items.push(...(body.items ?? []));
    cursor = body.next_cursor ?? null;
    if (cursor === null) return { status, items, complete: body.complete, modelSource: body.model_source };
  }
  return { status: 0, items, message: '翻页太多' };
}

async function backendRow(dbnum) {
  const { body } = await backendFetch('/api/v1/dbnums');
  return (body.dbnums ?? []).find((row) => row.dbnum === dbnum) ?? null;
}

const rowBrief = (row) => (row
  ? { file: row.file_latest_sesno, applied: row.applied_sesno, model: row.model_sesno, initialized: row.initialized, excluded: row.excluded, excludedReason: row.excluded_reason, verdict: row.model_verdict }
  : null);

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

const matrixClose = (a, b) => a.length === 16 && b.length === 16 && a.every((value, index) => Math.abs(value - b[index]) <= 0.05 + 1e-4 * Math.max(Math.abs(value), Math.abs(b[index])));

/** 后端此刻的样子：几层树、几个根的记录 */
async function snapshotBackend(layerIds) {
  const layers = {};
  for (const id of layerIds) layers[id] = await backendChildren(id);
  const roots = {};
  for (const root of ROOTS) {
    const result = await backendRecords(root.refno);
    const byRefno = new Map();
    for (const item of result.items) {
      const id = key(item.refno);
      byRefno.set(id, [...(byRefno.get(id) ?? []), ...expectedMatrices(item)]);
    }
    roots[root.refno] = { status: result.status, message: result.message ?? null, complete: result.complete ?? null, count: result.items.length, byRefno };
  }
  const rows = { 8000: rowBrief(await backendRow(8000)), 7998: rowBrief(await backendRow(7998)) };
  return { layers, roots, rows };
}

/** 两个时刻之间后端自己的差（给交回用的「实际看到的数据」）：树上哪层多了谁、少了谁、谁改了名；各根的记录数、矩阵变了几条 */
function backendDiff(before, after) {
  const tree = [];
  for (const id of new Set([...Object.keys(before.layers), ...Object.keys(after.layers)])) {
    const a = before.layers[id]?.nodes;
    const b = after.layers[id]?.nodes;
    if (a && !b) { tree.push(`层 ${id} 整层没了（${after.layers[id]?.status}）`); continue; }
    if (!a || !b) continue;
    const aById = new Map(a.map((node) => [node.id, node]));
    const bById = new Map(b.map((node) => [node.id, node]));
    for (const node of b) if (!aById.has(node.id)) tree.push(`层 ${id} 多了 ${node.noun} ${node.name}（${node.id}）`);
    for (const node of a) if (!bById.has(node.id)) tree.push(`层 ${id} 少了 ${node.noun} ${node.name}（${node.id}）`);
    for (const node of b) {
      const old = aById.get(node.id);
      if (old && old.name !== node.name) tree.push(`层 ${id} 里 ${node.id} 改名 ${old.name} → ${node.name}`);
    }
    const order = (list) => list.map((node) => node.id).filter((nodeId) => aById.has(nodeId) && bById.has(nodeId)).join(',');
    if (order(a) !== order(b)) tree.push(`层 ${id} 里留下来的节点次序变了`);
  }
  const records = [];
  for (const root of ROOTS) {
    const a = before.roots[root.refno];
    const b = after.roots[root.refno];
    const added = [...b.byRefno.keys()].filter((id) => !a.byRefno.has(id));
    const removed = [...a.byRefno.keys()].filter((id) => !b.byRefno.has(id));
    const moved = [...b.byRefno.keys()].filter((id) => {
      const old = a.byRefno.get(id);
      const now = b.byRefno.get(id);
      return old && (old.length !== now.length || !old.every((matrix, index) => matrixClose(matrix, now[index])));
    });
    if (added.length || removed.length || moved.length) {
      records.push(`根 ${root.refno}：记录 ${a.count} → ${b.count}，多 ${added.length}（${added.join(',')}）少 ${removed.length}（${removed.join(',')}）位置变 ${moved.length}（${moved.join(',')}）`);
    }
  }
  return { tree, records };
}

// ------------------------------------------------------------------ 回放与等后端追上

function replayStep(dbnum, to) {
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

/** 等这个库三枚水位都到 to；记下「后端看见文件变了」「数据追上」「模型追上」各用了多久（从 replay-step 写完算起） */
async function waitCaughtUp(dbnum, to, since, timeoutMs = 240_000) {
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

async function taskFor(dbnum, to) {
  const { body } = await backendFetch('/api/v1/tasks?limit=40');
  const tasks = (body.tasks ?? []).filter((task) => task.dbnum === dbnum && task.end_sesno === to);
  const task = tasks[0];
  if (!task) return null;
  const detail = task.detail ?? {};
  return {
    task_id: task.task_id, kind: task.kind, state: task.state, start_sesno: task.start_sesno, end_sesno: task.end_sesno,
    created_at: task.created_at, started_at: task.started_at, finished_at: task.finished_at,
    units_done: task.units_done, total_units: task.total_units, intent: detail.intent ?? null,
    detailKeys: Object.keys(detail),
    changes: detail.changes ?? detail.change_summary ?? detail.plan ?? null,
    units: Array.isArray(detail.units) ? detail.units.map((unit) => ({ root: unit.root_refno, noun: unit.noun, kind: unit.kind, status: unit.status })).slice(0, 12) : null,
  };
}

// ------------------------------------------------------------------ 页面

const READ_ONLY_POST = [/^\/api\/v1\/model\/records$/, /^\/api\/v1\/meshes\/batch$/, /^\/api\/v1\/element\/attributes$/];

async function createGuardedContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const log = { requests: [], timings: [], blocked: [], toLive: [], allowedPost: {}, httpFailures: [], wsSent: [], wsReceived: [], wsOpened: [] };
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
      const allowed = url.origin === BACKEND && method === 'POST' && READ_ONLY_POST.some((pattern) => pattern.test(url.pathname));
      if (!allowed) {
        log.blocked.push({ method, origin: url.origin, path: url.pathname });
        return route.abort('blockedbyclient');
      }
      log.allowedPost[url.pathname] = (log.allowedPost[url.pathname] ?? 0) + 1;
    }
    return route.continue();
  });
  // 每个发往沙箱后端的请求用了多久（看取最新慢在哪）
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
      if (url.origin === BACKEND || url.pathname.startsWith('/api/')) {
        log.httpFailures.push({ at: Date.now(), status: response.status(), method: response.request().method(), path: url.pathname, query: url.search.slice(0, 100) });
      }
    } catch { /* 不是 http(s) 的地址 */ }
  });
  return { context, log };
}

async function newPage(context, log) {
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
    socket.on('framesent', (frame) => {
      if (log.wsSent.length < 40) log.wsSent.push({ at: Date.now(), url, payload: String(frame.payload).slice(0, 200) });
    });
    socket.on('framereceived', (frame) => {
      if (!url.includes('/api/v1/ws')) return;
      log.wsReceived.push({ at: Date.now(), payload: String(frame.payload).slice(0, 4000) });
    });
    socket.on('close', () => log.wsOpened.push({ at: Date.now(), url, closed: true }));
  });
  await page.addInitScript(() => {
    window.__toasts = [];
    import('/src/ribbon/toastBus.ts').then((bus) => {
      bus.onToast((payload) => {
        window.__toasts.push({ at: Date.now(), level: payload.level ?? 'info', message: payload.message });
      });
    }).catch(() => undefined);
  });
  return { page, events };
}

function pageUrl(params = {}) {
  const query = new URLSearchParams({ output_project: PROJECT, gm_backend: BACKEND, ...params });
  return `${FRONT}/?${query.toString()}`;
}

async function waitViewerReady(page) {
  await page.waitForFunction(() => !!window.__dtxViewer && !!window.__dtxLayer, null, { timeout: 180_000 });
  await page.waitForSelector('[data-testid="model-getwork-button"]', { timeout: 60_000 });
}

/** 从页面里读状态：整棵已取到的树、场景里每个对象的矩阵、各根名下的构件、两张登记表、选中、取最新的回执、状态栏 */
async function readPage(page) {
  return page.evaluate(async ({ roots, dbnums }) => {
    const [treeStore, loader, getWork, selection, loadedNodes, registry, generation] = await Promise.all([
      import('/src/composables/useModelTreeStore.ts'),
      import('/src/composables/useDbnoInstancesDtxLoader.ts'),
      import('/src/composables/useModelGetWork.ts'),
      import('/src/composables/useSelectionStore.ts'),
      import('/src/composables/useLoadedNodeStatus.ts'),
      import('/src/composables/modelGetWorkRegistry.ts'),
      import('/src/composables/useModelGeneration.ts'),
    ]);
    const tree = treeStore.getModelTreeInstance();
    const nodes = tree?.nodesById.value ?? {};
    const treeNodes = {};
    for (const [id, node] of Object.entries(nodes)) {
      if (!/^\d+_\d+$/.test(id)) continue;
      treeNodes[id] = { name: node.name, type: node.type, parentId: node.parentId, childrenIds: node.childrenIds ? [...node.childrenIds] : null };
    }
    const layer = window.__dtxLayer;
    const scene = {};
    const objectIds = layer?.getAllObjectIds?.() ?? [];
    for (const dbno of dbnums) {
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
    return {
      tree: {
        present: !!tree,
        nodes: treeNodes,
        expanded: tree ? [...tree.expandedIds.value].filter((id) => /^\d+_\d+$/.test(id)) : [],
        selected: tree ? [...tree.selectedIds.value] : [],
        loadedLayers: tree?.loadedLayerCount() ?? 0,
        touchedDbnums: tree?.loadedLayerDbnums() ?? [],
      },
      scene,
      sceneObjects: objectIds.length,
      roots: roots.map(({ refno, dbnum }) => ({ refno, dbnum, members: gen.loadedRefnosOf(refno, dbnum), inScene: gen.isRootInScene(refno, dbnum) })),
      loadedTable: loadedNodes.useLoadedNodeStatus().entries().map((entry) => ({
        refno: entry.refno, loaded: entry.loaded, modelSesno: entry.loadedModelSesno, fileLatestSesno: entry.loadedFileLatestSesno, verdict: entry.status?.verdict ?? null,
      })),
      registry: { roots: registry.getWorkRegisteredRoots(), scopes: registry.getWorkRegisteredScopes().map((scope) => ({ ...scope, knownSites: [...scope.knownSites] })) },
      selection: { refno: selection.getGlobalSelectedRefno(), deleted: selection.getGlobalSelectedIsDeleted() },
      getWork: { running: state.running, progress: state.progress, last: state.last ? JSON.parse(JSON.stringify(state.last)) : null },
      dom: {
        button: text('[data-testid="model-getwork-label"]'),
        result: text('[data-testid="model-getwork-result"]'),
        resultLevel: document.querySelector('[data-testid="model-getwork-result"]')?.getAttribute('data-level') ?? null,
        resultTitle: document.querySelector('[data-testid="model-getwork-result"]')?.getAttribute('title') ?? null,
        updateNotice: text('[data-testid="gen-model-v1-update-notice-text"]'),
        updateNoticeTitle: document.querySelector('[data-testid="gen-model-v1-update-notice"]')?.getAttribute('title') ?? null,
        healthBadge: text('[data-testid="gen-model-v1-health-badge"]'),
        deletedNotice: text('[data-testid="properties-deleted-notice"]'),
      },
      toasts: (window.__toasts ?? []).slice(-10),
    };
  }, { roots: ROOTS, dbnums: [8000, 7998] });
}

async function noticeText(page) {
  return page.evaluate(() => document.querySelector('[data-testid="gen-model-v1-update-notice-text"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
}

async function clickGetWork(page, timeoutMs = 240_000) {
  const before = await page.evaluate(async () => {
    const getWork = await import('/src/composables/useModelGetWork.ts');
    return getWork.useModelGetWork().state.last?.finishedAt ?? 0;
  });
  const startedAt = Date.now();
  await page.click('[data-testid="model-getwork-button"]');
  const progress = [];
  for (;;) {
    const state = await page.evaluate(async () => {
      const getWork = await import('/src/composables/useModelGetWork.ts');
      const s = getWork.useModelGetWork().state;
      return { running: s.running, progress: s.progress, finishedAt: s.last?.finishedAt ?? 0, label: document.querySelector('[data-testid="model-getwork-label"]')?.textContent?.trim() ?? '' };
    });
    if (state.label && state.label !== '取最新' && progress[progress.length - 1] !== state.label) progress.push(state.label);
    if (!state.running && state.finishedAt > before) break;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`取最新 ${timeoutMs} 毫秒没做完（${state.progress}）`);
    await sleep(100);
  }
  return { ms: Date.now() - startedAt, progress };
}

async function clickEye(page, refno) {
  await page.evaluate(async (id) => {
    const selection = await import('/src/composables/useSelectionStore.ts');
    selection.setGlobalSelectedRefno(id);
  }, refno);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.locator('[data-testid="model-tree-eye"]').click();
}

async function clickRow(page, refno) {
  await page.evaluate(async (id) => {
    const selection = await import('/src/composables/useSelectionStore.ts');
    selection.setGlobalSelectedRefno(id);
  }, refno);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.click();
}

async function expandTree(page, ids) {
  await page.evaluate(async (list) => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const tree = treeStore.getModelTreeInstance();
    for (const id of list) await tree.expandPathToNode(id, { expandSelf: true });
  }, ids);
}

async function waitIdle(page, timeoutMs = 300_000) {
  await page.waitForFunction(async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, { timeout: timeoutMs, polling: 300 });
}

async function waitRootLoaded(page, root, timeoutMs = 120_000) {
  await page.waitForFunction(async ({ refno, dbnum }) => {
    const [generation, sessions] = await Promise.all([import('/src/composables/useModelGeneration.ts'), import('/src/composables/modelLoadSession.ts')]);
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
    return gen.isRootInScene(refno, dbnum) && !sessions.hasActiveModelLoad();
  }, root, { timeout: timeoutMs, polling: 300 });
}

// ------------------------------------------------------------------ 对账

const checks = [];
function check(step, name, pass, detail = '') {
  checks.push({ step, name, pass: !!pass, detail: String(detail).slice(0, 1200) });
  console.log(`  ${pass ? '✓' : '✗'} [${step}] ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
}

/** 页面的树和后端逐层对：脚本展开过的层 + 页面里凡是有子节点的层 */
async function compareTree(pageState, layerIds) {
  const nodes = pageState.tree.nodes;
  const ids = new Set(layerIds);
  for (const [id, node] of Object.entries(nodes)) {
    if ((node.childrenIds ?? []).some(isRefno)) ids.add(id);
  }
  const mismatches = [];
  let compared = 0;
  for (const id of ids) {
    const backend = await backendChildren(id);
    const pageNode = nodes[id];
    if (!backend.nodes) {
      if (pageNode) mismatches.push(`后端已经没有 ${id}（${backend.status}），页面的树上还留着它（${pageNode.name}）`);
      continue;
    }
    if (!pageNode) {
      // 页面没取过这一层（它的父层没展开）不算错；脚本点名展开过的层才要求在
      if (layerIds.includes(id)) mismatches.push(`后端有 ${id}，页面的树上没有这个节点`);
      continue;
    }
    compared += 1;
    const pageChildren = (pageNode.childrenIds ?? []).filter(isRefno);
    const backendIds = backend.nodes.map((node) => node.id);
    if (pageChildren.length === 0 && backendIds.length > 0 && !layerIds.includes(id)) continue;
    if (pageChildren.join(',') !== backendIds.join(',')) {
      mismatches.push(`层 ${id} 的子节点对不上：页面 [${pageChildren.join(',')}]，后端 [${backendIds.join(',')}]`);
      continue;
    }
    for (const child of backend.nodes) {
      const shown = nodes[child.id];
      if (!shown) { mismatches.push(`层 ${id} 的子节点 ${child.id} 在页面的节点表里没有`); continue; }
      if (shown.name !== child.name) mismatches.push(`${child.id} 的名字对不上：页面「${shown.name}」，后端「${child.name}」`);
      if (shown.type !== child.noun) mismatches.push(`${child.id} 的类型对不上：页面 ${shown.type}，后端 ${child.noun}`);
      if (shown.parentId !== id) mismatches.push(`${child.id} 的父节点对不上：页面 ${shown.parentId}，后端 ${id}`);
    }
  }
  return { compared, mismatches };
}

/** 场景和后端逐条对：每个根名下的构件集合、每个构件的每个实例矩阵；场景里不许有哪个根都不认的构件 */
function compareScene(pageState, backend) {
  const mismatches = [];
  const expectedByDbnum = { 8000: new Map(), 7998: new Map() };
  let matricesCompared = 0;
  // 页面此刻当成「单独装着」的节点：已加载节点表里装着的 + 取最新自己的登记表
  const registered = new Set([
    ...pageState.loadedTable.filter((entry) => entry.loaded).map((entry) => entry.refno),
    ...pageState.registry.roots.map((item) => item.refno),
  ]);
  const unregistered = [];
  for (const root of ROOTS) {
    const want = backend.roots[root.refno];
    const have = pageState.roots.find((item) => item.refno === root.refno);
    if (want.status !== 200) { mismatches.push(`根 ${root.refno}：后端记录接口回 ${want.status}（${want.message}）`); continue; }
    if (!registered.has(root.refno)) {
      // 页面已经不把它当成单独装着的节点了（查空撤下之后）：它名下的东西只经别的在册节点出现，这里不按它对
      unregistered.push(root.refno);
      continue;
    }
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
  for (const dbnum of [8000, 7998]) {
    const sceneRefnos = pageState.scene[dbnum] ?? {};
    const expected = expectedByDbnum[dbnum];
    for (const [refno, matrices] of expected) {
      const objects = sceneRefnos[refno] ?? [];
      if (matrices.length === 0) continue;
      if (objects.length !== matrices.length) {
        mismatches.push(`${refno}：后端 ${matrices.length} 个实例，场景里 ${objects.length} 个对象（${objects.map((object) => `${object.id}${object.visible ? '' : ' 隐藏'} @${object.m ? object.m.slice(12, 15).map((n) => Math.round(n)).join(',') : '?'}`).join('；')}）`);
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

/** 提示条（底部正中的那一条）和取最新按钮的位置：提示条正显示着的时候，按钮不许在它底下 */
async function toastVersusButton(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? { left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom) } : null;
    };
    const button = document.querySelector('[data-testid="model-getwork-button"]');
    const toasts = [...document.querySelectorAll('.v-snackbar__wrapper')].map(rectOf).filter(Boolean);
    const buttonRect = rectOf(button);
    const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    // 按钮正中那一点上最上面的元素是不是按钮自己（被别的东西盖住就点不到）
    let hit = null;
    if (buttonRect) {
      const top = document.elementFromPoint((buttonRect.left + buttonRect.right) / 2, (buttonRect.top + buttonRect.bottom) / 2);
      hit = !!top && (top === button || button.contains(top));
    }
    return { viewport: window.innerWidth, button: buttonRect, toasts, covered: toasts.some((toast) => overlaps(toast, buttonRect)), clickable: hit };
  });
}

/** 一段时间里页面发往沙箱后端的请求里最慢的几个 */
function slowest(log, since, count = 4) {
  return log.timings.filter((item) => item.at >= since).sort((a, b) => b.ms - a.ms).slice(0, count)
    .map((item) => `${item.method} ${item.path}${item.query} ${item.ms} ms${item.outcome === 'ok' ? '' : `（${item.outcome}）`}`);
}

function translationOf(pageState, dbnum, refno) {
  const object = pageState.scene[dbnum]?.[refno]?.[0];
  return object?.m ? object.m.slice(12, 15).map((n) => Math.round(n * 10) / 10) : null;
}

// ------------------------------------------------------------------ 流程

const results = { startedAt: new Date().toISOString(), front: FRONT, backend: BACKEND, steps: [] };
const LAYERS_8000 = [SITE, Z, Z2, PIPE, BRAN_OLD, EQ_RN, EQ_CASE, EQ_CP, EQ_Z2];
const LAYERS_7998 = [X_SITE, X_ZONE, X_EQUI];
let layerIds = [...LAYERS_8000, ...LAYERS_7998];

/** 一步真实会话：推文件 → 等后端 → 看推送 → 点取最新 → 对账。expect(report, page, before) 里放这一步特有的断言。 */
async function runStep(page, log, step) {
  console.log(`[${stamp()}] ${step.id}：${step.what}`);
  const record = { id: step.id, what: step.what, dbnum: step.dbnum, to: step.to };
  results.steps.push(record);
  if (step.prepare) await step.prepare(page);
  const pageBefore = await readPage(page);
  const backendBefore = await snapshotBackend(layerIds);
  record.rowsBefore = backendBefore.rows;
  const wsFrom = log.wsReceived.length;
  const replay = replayStep(step.dbnum, step.to);
  record.replay = { ms: replay.ms, report: replay.report };
  let run;
  let clickedAt;
  if (step.clickImmediately) {
    // 不等后端：文件一推就点，取最新自己要等后台做完
    clickedAt = Date.now();
    run = await clickGetWork(page);
    record.caughtUp = await waitCaughtUp(step.dbnum, step.to, replay.at, 60_000);
  } else {
    record.caughtUp = await waitCaughtUp(step.dbnum, step.to, replay.at, step.catchUpTimeoutMs ?? 240_000);
    check(step.id, `后端批次追上：库 ${step.dbnum} 三枚水位都到 ${step.to}`, record.caughtUp.ok,
      `看见文件 ${record.caughtUp.fileSeenMs} ms，数据 ${record.caughtUp.appliedMs} ms，模型 ${record.caughtUp.modelMs} ms；${JSON.stringify(record.caughtUp.row)}`);
    // 推送：等到这个窗口的任务帧，最多再等 6 秒
    const deadline = Date.now() + 6_000;
    let frames = [];
    while (Date.now() < deadline) {
      frames = log.wsReceived.slice(wsFrom).filter((frame) => frame.payload.includes(`"dbnum":${step.dbnum}`) && frame.payload.includes(`"end_sesno":${step.to}`));
      if (frames.some((frame) => /"state":"(succeeded|failed)"/.test(frame.payload))) break;
      await sleep(200);
    }
    const terminal = frames.find((frame) => /"state":"(succeeded|failed)"/.test(frame.payload));
    record.push = {
      framesSinceStep: log.wsReceived.length - wsFrom,
      framesForWindow: frames.length,
      terminalAfterMs: terminal ? terminal.at - replay.at : null,
      sample: (terminal ?? frames[0])?.payload.slice(0, 3500) ?? null,
    };
    check(step.id, '推送到达：页面的任务通道收到这个窗口的完成帧', !!terminal, `文件写完后 ${record.push.terminalAfterMs} ms 收到；这一步共收 ${record.push.framesSinceStep} 帧，属于这个窗口的 ${frames.length} 帧`);
    await sleep(800);
    record.noticeBeforeClick = await noticeText(page);
    clickedAt = Date.now();
    run = await clickGetWork(page);
  }
  await sleep(250);
  record.toast = await toastVersusButton(page);
  await waitIdle(page);
  await sleep(700);
  record.slowest = slowest(log, clickedAt);
  const versions = log.timings.filter((item) => item.at >= replay.at && item.path === '/api/v1/node/versions');
  record.versionsInBackground = { count: versions.length, maxMs: versions.reduce((max, item) => Math.max(max, item.ms), 0), unfinished: 0 };
  const pageAfter = await readPage(page);
  const backendAfter = await snapshotBackend(layerIds);
  const report = pageAfter.getWork.last;
  record.task = await taskFor(step.dbnum, step.to);
  record.rowsAfter = backendAfter.rows;
  record.backendDiff = backendDiff(backendBefore, backendAfter);
  record.getWork = { ms: run.ms, progress: run.progress, summary: report?.summary ?? null, detail: report?.detail ?? null, level: report?.level ?? null, ok: report?.ok ?? null };
  record.report = report;
  record.noticeAfterClick = pageAfter.dom.updateNotice;
  record.dom = pageAfter.dom;
  console.log(`    后端的差：${[...record.backendDiff.tree, ...record.backendDiff.records].join('；') || '（看着的这几层和几个根没有差）'}`);
  console.log(`    取最新 ${run.ms} ms：${report?.summary}`);
  if (step.screenshot) await page.screenshot({ path: path.join(OUT, step.screenshot) });

  check(step.id, '取最新做成（没有失败的节点、没有判不了的节点）', report?.ok === true && (report?.models.failed.length ?? 1) === 0 && !(report?.models.kept ?? []).some((item) => /判不了/.test(item.reason)),
    `${report?.summary ?? ''} failed=${JSON.stringify(report?.models.failed ?? null)} kept=${JSON.stringify(report?.models.kept ?? null)}`);
  const ownMs = run.ms - (report?.waited?.ms ?? 0);
  check(step.id, '取最新自己不慢：除去等后台的那一段，15 秒之内做完', ownMs < 15_000, `共 ${run.ms} ms，其中等后台 ${report?.waited?.ms ?? 0} ms；最慢的请求：${record.slowest.join('；') || '无'}`);
  check(step.id, '那一句弹出来的时候没有盖住「取最新」按钮（还点得到）', record.toast.toasts.length > 0 && record.toast.clickable === true && !record.toast.covered, JSON.stringify(record.toast));
  const tree = await compareTree(pageAfter, layerIds);
  record.treeCompare = tree;
  check(step.id, `树对上：页面取过的 ${tree.compared} 层和后端逐层一样`, tree.mismatches.length === 0, tree.mismatches.slice(0, 4).join('；'));
  const scene = compareScene(pageAfter, backendAfter);
  record.sceneCompare = scene;
  check(step.id, `三维对上：各根名下的构件和 ${scene.matricesCompared} 个实例矩阵与后端的记录逐条一样，场景里没有多余的`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));
  check(step.id, '状态栏那句交代和回执一致', !!pageAfter.dom.result && pageAfter.dom.result === report?.summary, pageAfter.dom.result ?? '');
  if (step.expect) await step.expect({ report, pageBefore, pageAfter, backendBefore, backendAfter, record });
  return { pageAfter, backendAfter, report, record };
}

const ids = (list) => (list ?? []).map((item) => item.id ?? item.refno);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.PAGE_HEADED !== '1',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
const { context, log } = await createGuardedContext(browser);
const { page, events } = await newPage(context, log);
try {
  const health = (await backendFetch('/api/v1/health')).body;
  results.backendHealth = { version: health.version, build_id: health.build_id, started_at: health.started_at, watch_dbnums: health.watch_dbnums, sul_db: health.sul_db, project: health.project };
  console.log(`[${stamp()}] 沙箱后端：${health.build_id}，监听 ${JSON.stringify(health.watch_dbnums)}，库 ${health.sul_db?.endpoint}（${health.sul_db?.medium}）`);
  if (health.sul_db?.endpoint !== '127.0.0.1:8199') throw new Error(`这台后端连的不是沙箱库：${health.sul_db?.endpoint}`);

  // ---------------- 基线：装上、对一遍
  console.log(`[${stamp()}] 基线：开页面`);
  await page.goto(pageUrl(), { waitUntil: 'domcontentloaded' });
  await waitViewerReady(page);
  await page.waitForFunction(async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
  }, null, { timeout: 120_000, polling: 300 });
  await expandTree(page, [BRAN_OLD, EQ_RN, EQ_CASE, EQ_CP, EQ_Z2, X_EQUI]);
  // 先单独装 EQ-CASE（它自己成为一个在册节点），再装它所在的 ZONE
  await clickEye(page, EQ_CASE);
  await waitRootLoaded(page, { refno: EQ_CASE, dbnum: 8000 });
  await clickEye(page, Z);
  await waitRootLoaded(page, { refno: Z, dbnum: 8000 });
  await clickEye(page, Z2);
  await waitRootLoaded(page, { refno: Z2, dbnum: 8000 });
  await clickEye(page, X_ZONE);
  await waitRootLoaded(page, { refno: X_ZONE, dbnum: 7998 });
  await sleep(800);
  {
    const pageState = await readPage(page);
    const backend = await snapshotBackend(layerIds);
    results.baseline = {
      rows: backend.rows,
      records: Object.fromEntries(ROOTS.map((root) => [root.refno, backend.roots[root.refno].count])),
      loadedTable: pageState.loadedTable, sceneObjects: pageState.sceneObjects, treeLayers: pageState.tree.loadedLayers,
      wsOpened: log.wsOpened, wsSent: log.wsSent.slice(0, 5),
    };
    await page.screenshot({ path: path.join(OUT, 'replay-0-baseline.png') });
    const tree = await compareTree(pageState, layerIds);
    check('基线', `树对上：页面取过的 ${tree.compared} 层和后端逐层一样`, tree.mismatches.length === 0, tree.mismatches.slice(0, 4).join('；'));
    const scene = compareScene(pageState, backend);
    check('基线', `三维对上：四个节点名下的构件和 ${scene.matricesCompared} 个实例矩阵与后端的记录逐条一样`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));
    check('基线', '四个节点都在已加载节点表里，装时的水位是库此刻的水位',
      ROOTS.every((root) => pageState.loadedTable.some((entry) => entry.refno === root.refno && entry.loaded && entry.modelSesno === backend.rows[root.dbnum].model)),
      pageState.loadedTable.map((entry) => `${entry.refno}@${entry.modelSesno}`).join(' '));
    check('基线', '页面的任务通道连的是沙箱后端', log.wsOpened.some((item) => item.url.startsWith('ws://127.0.0.1:9199/api/v1/ws')), log.wsOpened.map((item) => item.url).join(' '));
    // 后台没变的时候点一次
    const run = await clickGetWork(page);
    const state = await readPage(page);
    results.baseline.idleClick = { ms: run.ms, summary: state.getWork.last?.summary };
    check('基线', '后台没变时点取最新：说已是最新，一个模型都不重载', state.getWork.last?.ok === true && state.getWork.last.models.reloaded.length === 0 && /^已是最新/.test(state.getWork.last.summary ?? ''), state.getWork.last?.summary ?? '');
  }
  if (stopAfter === 'S0') throw new Error('__stop__');

  const steps = [
    {
      id: 'S1', dbnum: 8000, to: 1654, screenshot: 'replay-1-rename.png',
      what: '改名（E3D 会话 1653–1654）：BRAN /AIOS-SUITE-T3-BRAN-R 改成 …-BRAN-ROLD，连同它的 9 个管件',
      expect: ({ report, pageAfter }) => {
        check('S1', '树的回执：改名里有这条 BRAN 和它的管件，没有新增、删除、挪位置',
          ids(report?.tree?.renamed).includes(BRAN_OLD) && report.tree.renamed.length >= 10 && report.tree.added.length === 0 && report.tree.removed.length === 0 && report.tree.moved.length === 0,
          `改名 ${report?.tree?.renamed.length} 个：${report?.tree?.renamed.slice(0, 3).map((item) => `${item.id} ${item.previousName} → ${item.name}`).join('；')}`);
        check('S1', '页面树上这条 BRAN 现在叫 /AIOS-SUITE-T3-BRAN-ROLD', pageAfter.tree.nodes[BRAN_OLD]?.name === '/AIOS-SUITE-T3-BRAN-ROLD', pageAfter.tree.nodes[BRAN_OLD]?.name);
      },
    },
    {
      id: 'S2', dbnum: 8000, to: 1657, clickImmediately: true, screenshot: 'replay-2-add.png',
      what: '新增（E3D 会话 1656–1657）：PIPE 下复制出一条新 BRAN /AIOS-SUITE-T3-BRAN-R（24384/47584）；文件一推就点，不等后端',
      expect: ({ report, pageAfter, record }) => {
        check('S2', '文件一推就点：取最新自己等后台做完（回执里记了等的是 8000 库、没有等超时）', !!report?.waited && report.waited.dbnums.includes(8000) && report.waited.timedOut.length === 0,
          `waited=${JSON.stringify(report?.waited)} 进度=${record.getWork.progress.join(' / ')}`);
        check('S2', '树的回执：新增里有 24384_47584，挂在 PIPE 下', ids(report?.tree?.added).includes(BRAN_COPY) && pageAfter.tree.nodes[BRAN_COPY]?.parentId === PIPE,
          `新增 ${JSON.stringify(report?.tree?.added)}`);
        const reloaded = report?.models.reloaded.find((item) => item.refno === Z);
        check('S2', '模型的回执：重载了 ZONE Z，装进了新构件', !!reloaded && reloaded.added > 0 && reloaded.removed === 0, JSON.stringify(report?.models.reloaded));
      },
    },
    {
      id: 'S3', dbnum: 8000, to: 1660, screenshot: 'replay-3-delete.png',
      what: '删除（E3D 会话 1659–1660）：删掉 BRAN /AIOS-SUITE-T3-BRAN-ROLD（24384/47574）；删之前在树上选中它',
      prepare: async (page) => { await clickRow(page, BRAN_OLD); await sleep(400); },
      expect: ({ report, pageBefore, pageAfter }) => {
        check('S3', '删之前：选中的是这条 BRAN', key(pageBefore.selection.refno) === BRAN_OLD, String(pageBefore.selection.refno));
        const removed = report?.tree?.removed.find((item) => item.id === BRAN_OLD);
        check('S3', '树的回执：删除里有 24384_47574，判成已删除（带名字）', !!removed && removed.fate === 'deleted' && !!removed.name, JSON.stringify(report?.tree?.removed));
        check('S3', '页面树上没有它了，它的 9 个管件也没了', !pageAfter.tree.nodes[BRAN_OLD] && (report?.tree?.removedNodeCount ?? 0) >= 10, `removedNodeCount=${report?.tree?.removedNodeCount}`);
        check('S3', '选中的节点被删：登记成已删除并写进回执', pageAfter.selection.deleted === true && report?.selectionDeleted === BRAN_OLD, `deleted=${pageAfter.selection.deleted} selectionDeleted=${report?.selectionDeleted}`);
        const reloaded = report?.models.reloaded.find((item) => item.refno === Z);
        check('S3', '模型的回执：重载了 ZONE Z，撤下了被删的构件', !!reloaded && reloaded.removed > 0, JSON.stringify(report?.models.reloaded));
      },
    },
    {
      id: 'S4', dbnum: 8000, to: 1663,
      what: '删了重建（E3D 会话 1662–1663）：BRAN /AIOS-SUITE-T3-BRAN-R 删掉后重建，参考号从 24384/47584 换成 24384/47594',
      expect: ({ report }) => {
        check('S4', '树的回执：删除里有 47584、新增里有 47594', ids(report?.tree?.removed).includes(BRAN_COPY) && ids(report?.tree?.added).includes(BRAN_AUTO),
          `删除 ${ids(report?.tree?.removed).join(',')} 新增 ${ids(report?.tree?.added).join(',')}`);
      },
    },
    {
      id: 'S5', dbnum: 8000, to: 1666,
      what: '只改名（E3D 会话 1665–1666）：新 BRAN 的 9 个管件从 /Copy-of-… 改回原名；先把这条 BRAN 展开',
      prepare: async (page) => { await expandTree(page, [BRAN_AUTO]); layerIds = [...layerIds, BRAN_AUTO]; await sleep(500); },
      expect: ({ report }) => {
        check('S5', '树的回执：改名 9 个，没有新增、删除', (report?.tree?.renamed.length ?? 0) === 9 && report.tree.added.length === 0 && report.tree.removed.length === 0,
          `改名 ${report?.tree?.renamed.length}`);
      },
    },
    {
      id: 'S6', dbnum: 7998, to: 677, screenshot: 'replay-6-move.png',
      what: '挪位置·空间位移（7998 库 E3D 会话 676–677）：EQUI /AIOS-SUITE-T4-EQ-X 上抬 300 mm',
      expect: ({ report, pageBefore, pageAfter }) => {
        const before = translationOf(pageBefore, 7998, X_BOX);
        const after = translationOf(pageAfter, 7998, X_BOX);
        check('S6', '场景里 BOX 24382_1913 的矩阵真的上移了 300 mm', !!before && !!after && Math.abs(after[2] - before[2] - 300) < 0.5 && before[0] === after[0] && before[1] === after[1], `之前 ${before} 之后 ${after}`);
        check('S6', '模型的回执：重载了 7998 的那个 ZONE；树没有变化', report?.models.reloaded.some((item) => item.refno === X_ZONE) && report?.tree?.changed === false, JSON.stringify(report?.models.reloaded));
      },
    },
    {
      id: 'J1', dbnum: 8000, to: 1684, catchUpTimeoutMs: 420_000,
      what: '一口气 18 个会话（1667–1684，别的录制腿留下的会话，内容不在本验证的清单里）',
    },
    {
      id: 'S7', dbnum: 8000, to: 1686, screenshot: 'replay-7-rezone.png',
      what: '挪位置·改挂（E3D 会话 1685–1686）：PIPE /AIOS-SUITE-T3-PIPE 从 ZONE Z 挪到 ZONE Z2',
      expect: ({ report, pageAfter }) => {
        const moved = report?.tree?.moved.find((item) => item.id === PIPE);
        check('S7', '树的回执：挪位置里有 PIPE，从 Z 到 Z2', !!moved && moved.from === Z && moved.to === Z2, JSON.stringify(report?.tree?.moved));
        check('S7', '页面树上 PIPE 现在挂在 Z2 下', pageAfter.tree.nodes[PIPE]?.parentId === Z2 && pageAfter.tree.nodes[Z2]?.childrenIds.includes(PIPE) && !pageAfter.tree.nodes[Z]?.childrenIds.includes(PIPE), pageAfter.tree.nodes[PIPE]?.parentId);
        const z = report?.models.reloaded.find((item) => item.refno === Z);
        const z2 = report?.models.reloaded.find((item) => item.refno === Z2);
        check('S7', '模型的回执：两个 ZONE 都重载了，Z 撤下管道的构件、Z2 装进来', !!z && !!z2 && z.removed > 0 && z2.added > 0 && z.removed === z2.added, JSON.stringify(report?.models.reloaded));
      },
    },
    {
      id: 'S8', dbnum: 8000, to: 1689,
      what: '挪回去（E3D 会话 1688–1689）：PIPE 从 Z2 挪回 Z',
      expect: ({ report }) => {
        const moved = report?.tree?.moved.find((item) => item.id === PIPE);
        check('S8', '树的回执：PIPE 从 Z2 回到 Z', !!moved && moved.from === Z2 && moved.to === Z, JSON.stringify(report?.tree?.moved));
      },
    },
    {
      id: 'S9', dbnum: 8000, to: 1692,
      what: '挪位置·改挂（E3D 会话 1691–1692）：EQUI /AIOS-SUITE-T3-EQ-CP 从 ZONE Z 挪到 ZONE Z2',
      expect: ({ report, pageAfter }) => {
        const moved = report?.tree?.moved.find((item) => item.id === EQ_CP);
        check('S9', '树的回执：EQ-CP 从 Z 到 Z2；它展开着的那一层还在', !!moved && moved.from === Z && moved.to === Z2 && pageAfter.tree.expanded.includes(EQ_CP), `${JSON.stringify(report?.tree?.moved)} 展开=${pageAfter.tree.expanded.includes(EQ_CP)}`);
      },
    },
    {
      id: 'S10', dbnum: 8000, to: 1695,
      what: '挪回去（E3D 会话 1694–1695）：EQ-CP 从 Z2 挪回 Z',
    },
    {
      id: 'S11', dbnum: 8000, to: 1698, screenshot: 'replay-11-rehome.png',
      what: '挪位置·改挂（E3D 会话 1697–1698）：BOX /AIOS-SUITE-T3-BOX-CASE 从 EQUI EQ-CASE 挪到 EQUI EQ-RN',
      expect: ({ report, pageAfter }) => {
        const moved = report?.tree?.moved.find((item) => item.id === BOX_CASE);
        check('S11', '树的回执：BOX-CASE 从 EQ-CASE 到 EQ-RN', !!moved && moved.from === EQ_CASE && moved.to === EQ_RN, JSON.stringify(report?.tree?.moved));
        check('S11', '页面树上 BOX-CASE 挂在 EQ-RN 下', pageAfter.tree.nodes[BOX_CASE]?.parentId === EQ_RN, pageAfter.tree.nodes[BOX_CASE]?.parentId);
        // EQ-CASE 名下唯一的 BOX 挪走了：这台设备还在库里、名下已经没有几何——单独装的那个节点撤下，但不能说它「已删除」
        const emptied = report?.models.withdrawn.find((item) => item.refno === EQ_CASE);
        check('S11', '单独装的 EQ-CASE 名下已没有几何：按「查空」撤下（不是当成已删除），树上它还在', !!emptied && emptied.why === 'empty' && !!pageAfter.tree.nodes[EQ_CASE] && !pageAfter.loadedTable.some((entry) => entry.refno === EQ_CASE),
          `${JSON.stringify(report?.models.withdrawn)} 树上=${pageAfter.tree.nodes[EQ_CASE]?.name}`);
        check('S11', '那句交代没有把还在库里的 EQ-CASE 说成「已不存在」/「已删除」', !/已不存在|已删除/.test(report?.summary ?? ''), report?.summary ?? '');
      },
    },
  ];

  let last = null;
  for (const step of steps) {
    last = await runStep(page, log, step);
    if (stopAfter === step.id) throw new Error('__stop__');
  }

  // ---------------- 重起后端：7998 挪出监听范围，再各推一步
  if (!noRestart) {
    console.log(`[${stamp()}] R1：重起沙箱后端，监听名单从 [8000, 7998] 改成 [8000]`);
    const record = { id: 'R1', what: '重起沙箱后端并把 7998 挪出监听范围；然后 7998 推到 679（后端不会跟）、8000 推到 1701（后端会跟）' };
    results.steps.push(record);
    const pageBefore = await readPage(page);
    const backendBefore = await snapshotBackend(layerIds);
    record.rowsBefore = backendBefore.rows;
    const healthBefore = (await backendFetch('/api/v1/health')).body.started_at;
    const restartAt = Date.now();
    const restart = spawnSync('pwsh', ['-NoProfile', '-File', path.join(HERE, 'stack.ps1'), '-Restart', '-Watch', '8000'], { stdio: 'ignore' });
    if (restart.status !== 0) throw new Error(`重起后端失败（退出码 ${restart.status}），看 logs\\stack.log`);
    let healthAfter = null;
    for (let i = 0; i < 600; i += 1) {
      try {
        const answer = await backendFetch('/api/v1/health');
        if (answer.status === 200 && answer.body.started_at && answer.body.started_at !== healthBefore) { healthAfter = answer.body; break; }
      } catch { /* 还没起来 */ }
      await sleep(500);
    }
    if (!healthAfter) throw new Error('重起后 5 分钟 /health 没有应答');
    record.restart = { ms: Date.now() - restartAt, startedAtBefore: healthBefore, startedAtAfter: healthAfter.started_at, watch: healthAfter.watch_dbnums };
    check('R1', '后端重起了：启动时刻变了，监听名单只剩 8000', healthAfter.started_at !== healthBefore && JSON.stringify(healthAfter.watch_dbnums) === '[8000]', `${healthBefore} → ${healthAfter.started_at}，监听 ${JSON.stringify(healthAfter.watch_dbnums)}，${record.restart.ms} ms`);
    // 等 8000 回到齐平（重起后它要自己对一遍账）
    record.settle = await waitCaughtUp(8000, 1698, Date.now(), 300_000);
    record.rowsAfterRestart = { 8000: rowBrief(await backendRow(8000)), 7998: rowBrief(await backendRow(7998)) };
    check('R1', '重起后：8000 仍齐平在 1698；7998 还是初始化过的，但已标成不在监听范围',
      record.settle.ok && record.rowsAfterRestart[7998]?.initialized === true && record.rowsAfterRestart[7998]?.excluded === true,
      JSON.stringify(record.rowsAfterRestart));
    const wsFrom = log.wsReceived.length;
    const replay7998 = replayStep(7998, 679);
    const replay8000 = replayStep(8000, 1701);
    record.replay = { 7998: replay7998.report, 8000: replay8000.report };
    record.caughtUp = await waitCaughtUp(8000, 1701, replay8000.at, 240_000);
    check('R1', '后端跟上了 8000（到 1701）', record.caughtUp.ok, `数据 ${record.caughtUp.appliedMs} ms，模型 ${record.caughtUp.modelMs} ms`);
    await sleep(3_000);
    record.rows = { 8000: rowBrief(await backendRow(8000)), 7998: rowBrief(await backendRow(7998)) };
    check('R1', '后端没有跟 7998：库文件到了 679，数据和模型停在 677', record.rows[7998]?.file === 679 && record.rows[7998]?.model === 677 && record.rows[7998]?.applied === 677, JSON.stringify(record.rows[7998]));
    record.push = { framesSinceStep: log.wsReceived.length - wsFrom, wsOpened: log.wsOpened.slice(-4) };
    record.noticeBeforeClick = await noticeText(page);
    const clickedAt = Date.now();
    const run = await clickGetWork(page);
    await sleep(250);
    record.toast = await toastVersusButton(page);
    await waitIdle(page);
    await sleep(700);
    record.slowest = slowest(log, clickedAt);
    const pageAfter = await readPage(page);
    const backendAfter = await snapshotBackend(layerIds);
    const report = pageAfter.getWork.last;
    record.backendDiff = backendDiff(backendBefore, backendAfter);
    record.getWork = { ms: run.ms, progress: run.progress, summary: report?.summary ?? null, detail: report?.detail ?? null, level: report?.level ?? null, ok: report?.ok ?? null };
    record.report = report;
    record.dom = pageAfter.dom;
    await page.screenshot({ path: path.join(OUT, 'replay-12-restart-excluded.png') });
    console.log(`    后端的差：${[...record.backendDiff.tree, ...record.backendDiff.records].join('；') || '（没有差）'}`);
    console.log(`    取最新 ${run.ms} ms：${report?.summary}`);
    console.log(`    细节：${report?.detail}`);
    check('R1', '认出后端重启过', report?.backendRestarted === true, `backendRestarted=${report?.backendRestarted}`);
    const named = (report?.libraries ?? []).find((item) => item.dbnum === 7998);
    record.named7998 = named ?? null;
    check('R1', '不在监听范围的库被如实点名：库 7998，模型停在 677，库文件已到 679',
      !!named && named.kind === 'out_of_scope' && /7998/.test(named.text) && /677/.test(named.text) && /679/.test(named.text) && /监听范围/.test(named.text),
      JSON.stringify(named ?? report?.libraries));
    check('R1', '那句交代里也说了这件事（状态栏上看得到）', /7998/.test(`${report?.summary} ${report?.detail}`) && /监听范围/.test(`${report?.summary} ${report?.detail}`), `${report?.summary}｜${report?.detail}`);
    check('R1', '没有把任何节点当成已删除撤下；7998 的那个 ZONE 还在场景里', (report?.models.withdrawn.length ?? 1) === 0 && pageAfter.roots.find((item) => item.refno === X_ZONE)?.inScene === true,
      `withdrawn=${JSON.stringify(report?.models.withdrawn)} kept=${JSON.stringify(report?.models.kept)}`);
    const tree = await compareTree(pageAfter, layerIds);
    check('R1', `树对上：页面取过的 ${tree.compared} 层和后端逐层一样（含不在监听范围的 7998）`, tree.mismatches.length === 0, tree.mismatches.slice(0, 4).join('；'));
    const scene = compareScene(pageAfter, backendAfter);
    record.sceneCompare = scene;
    check('R1', `三维对上：与后端此刻供出的记录逐条一样（${scene.matricesCompared} 个实例矩阵；7998 的模型按后端说的停在 677）`, scene.mismatches.length === 0, scene.mismatches.slice(0, 4).join('；'));
    const moved = report?.tree?.moved.find((item) => item.id === BOX_CASE);
    check('R1', '8000 这一步（BOX-CASE 挪回 EQ-CASE）照常处理', !!moved && moved.from === EQ_RN && moved.to === EQ_CASE, JSON.stringify(report?.tree?.moved));
    // S11 里 EQ-CASE 因为名下没有几何被撤下，不再是单独装着的节点；现在 BOX 挪回它名下，是经 ZONE Z 装进场景的
    check('R1', 'BOX-CASE 回到 EQ-CASE 名下后在场景里（经 ZONE Z）；EQ-CASE 自己没有被重新登记成单独装着的节点',
      (pageAfter.scene[8000]?.[BOX_CASE]?.length ?? 0) === 1 && scene.unregistered.includes(EQ_CASE),
      `场景里 BOX-CASE 的对象 ${pageAfter.scene[8000]?.[BOX_CASE]?.length ?? 0} 个；不在册的：${scene.unregistered.join(',')}`);
    check('R1', '取最新做成（没有失败的节点）', report?.ok === true && (report?.models.failed.length ?? 1) === 0, JSON.stringify(report?.models.failed ?? null));
    check('R1', '取最新自己不慢：15 秒之内做完', run.ms - (report?.waited?.ms ?? 0) < 15_000, `共 ${run.ms} ms；最慢的请求：${record.slowest.join('；') || '无'}`);
    check('R1', '那一句弹出来的时候没有盖住「取最新」按钮（还点得到）', record.toast.toasts.length > 0 && record.toast.clickable === true && !record.toast.covered, JSON.stringify(record.toast));
  }

  // ---------------- 窄一点的窗口再点一次：提示条照样盖不到按钮
  {
    await page.setViewportSize({ width: 1280, height: 800 });
    await sleep(400);
    const run = await clickGetWork(page);
    await sleep(250);
    const narrow = await toastVersusButton(page);
    results.narrow = { ms: run.ms, toast: narrow };
    await page.screenshot({ path: path.join(OUT, 'replay-13-narrow-1280.png') });
    check('窄窗口', '窗口宽 1280 时：那一句弹出来也盖不到「取最新」按钮', narrow.toasts.length > 0 && narrow.clickable === true && !narrow.covered, JSON.stringify(narrow));
    await page.setViewportSize({ width: 1600, height: 1000 });
  }
} catch (error) {
  if (String(error?.message) !== '__stop__') {
    console.error(`[${stamp()}] 出错：${error?.stack ?? error}`);
    results.error = String(error?.stack ?? error).slice(0, 3000);
    process.exitCode = 2;
    try { await page.screenshot({ path: path.join(OUT, 'replay-error.png') }); } catch { /* 页面可能已经没了 */ }
  }
} finally {
  results.guard = {
    toLive: log.toLive, blocked: log.blocked, allowedPost: log.allowedPost,
    requestsToSandbox: log.requests.length,
    byPath: Object.entries(log.requests.reduce((acc, item) => { acc[`${item.method} ${item.path}`] = (acc[`${item.method} ${item.path}`] ?? 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]),
    timings: Object.entries(log.timings.reduce((acc, item) => {
      const name = `${item.method} ${item.path}`;
      const entry = (acc[name] ??= { count: 0, maxMs: 0, totalMs: 0 });
      entry.count += 1;
      entry.maxMs = Math.max(entry.maxMs, item.ms);
      entry.totalMs += item.ms;
      return acc;
    }, {})).sort((a, b) => b[1].maxMs - a[1].maxMs),
    httpFailures: log.httpFailures.slice(0, 60),
    wsOpened: log.wsOpened, wsSent: log.wsSent.slice(0, 10), wsReceived: log.wsReceived.length,
    pageErrors: events.pageErrors, consoleErrors: events.console.slice(0, 30),
  };
  check('护栏', '页面没有一个请求发往 8022 / 8009', log.toLive.length === 0, log.toLive.length ? JSON.stringify(log.toLive.slice(0, 5)) : `发往沙箱后端 ${log.requests.length} 个请求`);
  check('护栏', '页面对沙箱后端只发了 GET 和三种只读 POST（没有生成、更新、初始化）', log.blocked.length === 0, log.blocked.length ? JSON.stringify(log.blocked.slice(0, 5)) : `放行的只读 POST：${JSON.stringify(log.allowedPost)}`);
  await context.close();
  await browser.close();
  results.finishedAt = new Date().toISOString();
  results.checks = checks;
  writeFileSync(path.join(OUT, 'replay-result.json'), `${JSON.stringify(results, (name, value) => (value instanceof Map ? Object.fromEntries(value) : value), 1)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.pass);
  console.log(`[${stamp()}] 共 ${checks.length} 项，过 ${checks.length - failed.length}，没过 ${failed.length}`);
  if (failed.length > 0 && !process.exitCode) process.exitCode = 1;
}
