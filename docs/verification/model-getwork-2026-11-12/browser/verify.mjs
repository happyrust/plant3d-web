/**
 * 「取最新」的浏览器验证：工作树自己的开发服务器（3103）连现网后端 8022，后台不会真的发生增量，
 * 用 page.route 在真实答复上叠一层「变了之后」的答复，然后点「取最新」，从页面里读状态核对。
 *
 *   node verify.mjs [tree|showrefno|showdbnum|all]
 *
 * 只读：对后端只放行 GET 和显示模型本来就要发的三种只读 POST（model/records、meshes/batch、element/attributes），
 * 别的在浏览器这一层拦掉并记下来。本脚本自己对 8022 只发 GET，外加一发只读的 model/records（摸清构件清单）。
 *
 * 场景都落在 8000 库 SITE 24384_24932（/1CSV-HVACHB）下的真实节点上：
 *   ZONE Z=24384_25586（/-SR-CSV-6-HVAC-SUPP）：STRU A=24384_25587、B=24384_25611、C=24384_25635
 *   ZONE Y=24384_26199：STRU 24384_26205、STRU M=24384_26202、PIPE 24384_26203
 *   别处的 STRU N=24384_24970（ZONE 24384_24945 下）
 * 「之前 / 之后」靠叠加层藏起或露出真实的节点与记录，几何都是真的。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const TMP = path.join(HERE, 'tmp');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const FRONT = 'http://127.0.0.1:3103';
const BACKEND = 'http://127.0.0.1:8022';
const PROJECT = 'AvevaMarineSample';
const DBNUM = 8000;

const SITE = '24384_24932';
const TEST_SITE = '24384_26547';
const Z = '24384_25586';
const Y = '24384_26199';
const A = '24384_25587';
const B = '24384_25611';
const C = '24384_25635';
const M = '24384_26202';
const N = '24384_24970';
const N_HOME = '24384_24945';
/** ZONE Y 下一个独立的 STRU：单独装它，重启护栏那一段拿它试「去重载时记录查空」 */
const R = '24384_26205';
const RENAMED = '/-SR-CSV-S6125-GETWORK-RENAMED';

const v1 = (refno) => refno.replace('_', '/');
const key = (refno) => String(refno ?? '').trim().replace('/', '_');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);

async function backendGet(pathAndQuery) {
  const response = await fetch(BACKEND + pathAndQuery);
  if (!response.ok) throw new Error(`${response.status} ${pathAndQuery}`);
  return response.json();
}

async function childrenOf(refno) {
  return (await backendGet(`/api/v1/tree/children?refno=${v1(refno)}&resolved=1`)).nodes;
}

/** 一个节点名下全部后代（含自己） */
async function subtreeOf(refno) {
  const out = new Set([refno]);
  const queue = [refno];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const node of await childrenOf(current)) {
      const id = key(node.refno);
      if (out.has(id)) continue;
      out.add(id);
      if ((node.children_count ?? 0) > 0) queue.push(id);
    }
  }
  return out;
}

/** 真实世界里要用到的东西：各 STRU 的后代、其中带几何记录的构件、要挪动 / 新增的节点的真实 DTO */
async function surveyRealWorld() {
  const [subA, subB, subC, subTest, subR] = await Promise.all([subtreeOf(A), subtreeOf(B), subtreeOf(C), subtreeOf('24384_26549'), subtreeOf(R)]);
  const recordsOfR = await (await fetch(`${BACKEND}/api/v1/model/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation_root: v1(R), limit: 1000 }),
  })).json();
  const recordsResponse = await fetch(`${BACKEND}/api/v1/model/records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation_root: v1(Z), limit: 1000 }),
  });
  const records = await recordsResponse.json();
  const withGeometry = records.items.map((item) => key(item.refno));
  const geo = (subtree) => withGeometry.filter((refno) => subtree.has(refno));
  const yChildren = await childrenOf(Y);
  const homeChildren = await childrenOf(N_HOME);
  const dbnums = await backendGet('/api/v1/dbnums');
  const row = dbnums.dbnums.find((item) => item.dbnum === DBNUM);
  return {
    subA, subB, subC, subTest, subR,
    geoA: geo(subA), geoB: geo(subB), geoC: geo(subC),
    geoR: recordsOfR.items.map((item) => key(item.refno)),
    nodeM: yChildren.find((node) => key(node.refno) === M),
    nodeN: homeChildren.find((node) => key(node.refno) === N),
    sesno: row.model_sesno,
    row,
  };
}

/** 叠加层：这一刻「后台」是什么样 */
function makeWorld() {
  return {
    phase: 'A',
    /** 记录里藏起来的构件（a_b） */
    hidden: new Set(),
    /** 库里已经没有的节点（a_b）：树接口 404 not_found，节点模型状态 404 REFNO_NOT_FOUND */
    gone: new Set(),
    /** 父节点（a_b）→ 把真实的子节点改成这一刻的样子 */
    treeChildren: new Map(),
    /** 8000 库三枚水位各往前几个会话 */
    bump: 0,
    /** 节点（a_b）→ 这一刻它「在本页装的那一版之后被改到了」 */
    changed: new Set(),
    /** 节点（a_b）→ (真实答复, 第几次问) => 改过的答复 */
    statusOverride: new Map(),
    statusCalls: new Map(),
    /** 换一个启动时刻 = 后端重启过 */
    startedAt: null,
    /** 这一阶段页面查过几次记录（重启护栏那一段用：重载查过记录之后，节点模型状态才改口） */
    recordsSeen: 0,
  };
}

const notFoundBody = (refno, sesno) => JSON.stringify({ code: 'not_found', message: `dbnum ${DBNUM} 会话 Some(${sesno}) 的索引里没有 ${v1(refno)}`, detail: null });
const refnoNotFoundBody = (refno, sesno) => JSON.stringify({
  code: 'REFNO_NOT_FOUND',
  message: `生成根 ${v1(refno)} 解出 dbnum ${DBNUM}，但库文件最新会话 ${sesno} 的索引里没有它`,
  detail: null,
});

const READ_ONLY_POST = [/^\/api\/v1\/model\/records$/, /^\/api\/v1\/meshes\/batch$/, /^\/api\/v1\/element\/attributes$/];

async function createGuardedContext(browser, world, real) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const log = { requests: [], blocked: [], allowedPost: {}, overlaid: {}, httpFailures: [], wsFramesSent: [] };
  const overlay = (name) => {
    log.overlaid[name] = (log.overlaid[name] ?? 0) + 1;
  };
  const cors = { 'access-control-allow-origin': '*' };
  const fulfill404 = (route, body) => route.fulfill({ status: 404, contentType: 'application/json', headers: cors, body });
  const sesnoNow = () => real.sesno + world.bump;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    let url;
    try {
      url = new URL(request.url());
    } catch {
      return route.continue();
    }
    const isBackend = url.origin === BACKEND || url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/');
    if (!isBackend) return route.continue();
    if (url.origin === BACKEND) log.requests.push({ at: Date.now(), phase: world.phase, method, path: url.pathname, refno: key(url.searchParams.get('refno')) });

    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      const allowed = url.origin === BACKEND && method === 'POST' && READ_ONLY_POST.some((pattern) => pattern.test(url.pathname));
      if (!allowed) {
        log.blocked.push({ method, origin: url.origin, path: url.pathname, phase: world.phase });
        return route.abort('blockedbyclient');
      }
      log.allowedPost[url.pathname] = (log.allowedPost[url.pathname] ?? 0) + 1;
      if (url.pathname === '/api/v1/model/records') world.recordsSeen += 1;
      if (url.pathname === '/api/v1/model/records' && world.hidden.size > 0) {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const json = await response.json();
        if (Array.isArray(json.items)) {
          const before = json.items.length;
          json.items = json.items.filter((item) => !world.hidden.has(key(item.refno)));
          if (json.items.length !== before) {
            overlay('records');
            if (typeof json.total === 'number') json.total -= before - json.items.length;
          }
        }
        return route.fulfill({ response, json });
      }
      return route.continue();
    }
    if (url.origin !== BACKEND || method !== 'GET') return route.continue();

    const refno = key(url.searchParams.get('refno'));
    try {
      switch (url.pathname) {
        case '/api/v1/health': {
          if (!world.startedAt) break;
          const response = await route.fetch();
          const json = await response.json();
          json.started_at = world.startedAt;
          overlay('health');
          return route.fulfill({ response, json });
        }
        case '/api/v1/dbnums': {
          if (world.bump === 0) break;
          const response = await route.fetch();
          const json = await response.json();
          for (const row of json.dbnums ?? []) {
            if (row.dbnum !== DBNUM) continue;
            for (const field of ['file_latest_sesno', 'applied_sesno', 'model_sesno']) row[field] += world.bump;
          }
          overlay('dbnums');
          return route.fulfill({ response, json });
        }
        case '/api/v1/tree/children': {
          if (world.gone.has(refno)) {
            overlay('tree-gone');
            return fulfill404(route, notFoundBody(refno, sesnoNow()));
          }
          const rewrite = world.treeChildren.get(refno);
          if (!rewrite) break;
          const response = await route.fetch();
          const json = await response.json();
          json.nodes = rewrite(json.nodes ?? []);
          overlay('tree-children');
          return route.fulfill({ response, json });
        }
        case '/api/v1/tree/ancestors': {
          if (!world.gone.has(refno)) break;
          overlay('tree-gone');
          return fulfill404(route, notFoundBody(refno, sesnoNow()));
        }
        case '/api/v1/node/model-status': {
          if (world.gone.has(refno)) {
            overlay('status-gone');
            return fulfill404(route, refnoNotFoundBody(refno, sesnoNow()));
          }
          if (world.bump === 0 && !world.statusOverride.has(refno)) break;
          const response = await route.fetch();
          if (!response.ok()) return route.fulfill({ response });
          let json = await response.json();
          if (json.dbnum === DBNUM) {
            for (const field of ['file_latest_sesno', 'applied_sesno', 'model_sesno']) {
              if (typeof json.library?.[field] === 'number') json.library[field] += world.bump;
            }
            if (json.generated_at) {
              json.generated_at.sesno_min += world.bump;
              json.generated_at.sesno_max += world.bump;
            }
          }
          const override = world.statusOverride.get(refno);
          if (override) {
            const call = (world.statusCalls.get(refno) ?? 0) + 1;
            world.statusCalls.set(refno, call);
            json = override(json, call);
          }
          overlay('status');
          return route.fulfill({ response, json });
        }
        case '/api/v1/node/versions': {
          if (world.gone.has(refno)) {
            overlay('status-gone');
            return fulfill404(route, refnoNotFoundBody(refno, sesnoNow()));
          }
          if (world.bump === 0) break;
          const since = Number(url.searchParams.get('since_sesno') ?? '0');
          const response = await route.fetch();
          if (!response.ok()) return route.fulfill({ response });
          const json = await response.json();
          if (json.dbnum === DBNUM) {
            json.file_latest_sesno = sesnoNow();
            if (world.changed.has(refno) && since < sesnoNow()) {
              json.versions = [
                ...(json.versions ?? []),
                { sesno: sesnoNow(), session_time: new Date().toISOString(), impact: 'mesh', self_impact: 'mesh', units_changed: 1, units_touched: 1 },
              ];
            }
          }
          overlay('versions');
          return route.fulfill({ response, json });
        }
        default:
          break;
      }
    } catch (error) {
      log.httpFailures.push({ path: url.pathname, error: String(error).slice(0, 200) });
    }
    return route.continue();
  });

  context.on('response', (response) => {
    if (response.status() < 400 || log.httpFailures.length > 80) return;
    try {
      const url = new URL(response.url());
      if (url.origin === BACKEND || url.pathname.startsWith('/api/')) {
        log.httpFailures.push({ status: response.status(), method: response.request().method(), path: url.pathname, refno: key(url.searchParams.get('refno')), phase: world.phase });
      }
    } catch {
      // 不是 http(s) 的地址
    }
  });
  return { context, log };
}

async function newPage(context, log) {
  const page = await context.newPage();
  const events = { console: [], pageErrors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error' && events.console.length < 60) events.console.push(message.text().slice(0, 300));
  });
  page.on('pageerror', (error) => events.pageErrors.push(String(error).slice(0, 400)));
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      if (log.wsFramesSent.length < 20) log.wsFramesSent.push({ url: socket.url(), payload: String(frame.payload).slice(0, 200) });
    });
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

/** 从页面里读状态：树、场景、已加载节点表、登记表、选中、取最新的回执 */
async function readPage(page, refnos) {
  return page.evaluate(async ({ refnos, dbno }) => {
    const [treeStore, loader, getWork, selection, loadedNodes, registry] = await Promise.all([
      import('/src/composables/useModelTreeStore.ts'),
      import('/src/composables/useDbnoInstancesDtxLoader.ts'),
      import('/src/composables/useModelGetWork.ts'),
      import('/src/composables/useSelectionStore.ts'),
      import('/src/composables/useLoadedNodeStatus.ts'),
      import('/src/composables/modelGetWorkRegistry.ts'),
    ]);
    const tree = treeStore.getModelTreeInstance();
    const nodes = tree?.nodesById.value ?? {};
    const pick = (id) => (nodes[id] ? { name: nodes[id].name, type: nodes[id].type, parentId: nodes[id].parentId, childrenIds: nodes[id].childrenIds } : null);
    const state = getWork.useModelGetWork().state;
    return {
      tree: {
        present: !!tree,
        nodes: Object.fromEntries(refnos.tree.map((id) => [id, pick(id)])),
        expanded: refnos.tree.filter((id) => tree?.expandedIds.value.has(id)),
        selected: tree ? [...tree.selectedIds.value] : [],
        checks: Object.fromEntries(refnos.tree.map((id) => [id, nodes[id] ? tree.getCheckState(id) : null])),
        loadedLayers: tree?.loadedLayerCount() ?? 0,
        touchedDbnums: tree?.loadedLayerDbnums() ?? [],
      },
      scene: Object.fromEntries(refnos.scene.map((id) => [id, loader.isDtxRefnoLoaded(dbno, id)])),
      sceneObjects: Number(window.__dtxLayer?.getStats?.()?.totalObjects ?? -1),
      loadedTable: loadedNodes.useLoadedNodeStatus().entries().map((entry) => ({
        refno: entry.refno, loaded: entry.loaded, modelSesno: entry.loadedModelSesno, fileLatestSesno: entry.loadedFileLatestSesno, verdict: entry.status?.verdict ?? null,
      })),
      registry: { roots: registry.getWorkRegisteredRoots(), scopes: registry.getWorkRegisteredScopes().map((scope) => ({ ...scope, knownSites: [...scope.knownSites] })) },
      selection: { refno: selection.getGlobalSelectedRefno(), deleted: selection.getGlobalSelectedIsDeleted() },
      getWork: { running: state.running, progress: state.progress, last: state.last ? JSON.parse(JSON.stringify(state.last)) : null },
      dom: {
        button: document.querySelector('[data-testid="model-getwork-label"]')?.textContent?.trim() ?? null,
        result: document.querySelector('[data-testid="model-getwork-result"]')?.textContent?.trim() ?? null,
        resultLevel: document.querySelector('[data-testid="model-getwork-result"]')?.getAttribute('data-level') ?? null,
        resultTitle: document.querySelector('[data-testid="model-getwork-result"]')?.getAttribute('title') ?? null,
        deletedNotice: document.querySelector('[data-testid="properties-deleted-notice"]')?.textContent?.trim() ?? null,
        treeRows: [...document.querySelectorAll('[data-testid="model-tree-row"]')].map((row) => `${row.getAttribute('data-refno')} ${row.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60)}`),
      },
      toasts: (window.__toasts ?? []).slice(-12),
    };
  }, { refnos, dbno: DBNUM });
}

/** 点状态栏的「取最新」，等这一轮做完，回页面里的回执 */
async function clickGetWork(page, timeoutMs = 240_000) {
  const before = await page.evaluate(async () => {
    const getWork = await import('/src/composables/useModelGetWork.ts');
    return getWork.useModelGetWork().state.last?.finishedAt ?? 0;
  });
  const startedAt = Date.now();
  await page.click('[data-testid="model-getwork-button"]');
  const progress = new Set();
  for (;;) {
    const state = await page.evaluate(async () => {
      const getWork = await import('/src/composables/useModelGetWork.ts');
      const s = getWork.useModelGetWork().state;
      return { running: s.running, progress: s.progress, finishedAt: s.last?.finishedAt ?? 0, label: document.querySelector('[data-testid="model-getwork-label"]')?.textContent?.trim() ?? '' };
    });
    if (state.label && state.label !== '取最新') progress.add(state.label);
    if (!state.running && state.finishedAt > before) break;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`取最新 ${timeoutMs} 毫秒没做完（${state.progress}）`);
    await sleep(120);
  }
  return { ms: Date.now() - startedAt, progress: [...progress] };
}

/** 等树上的某个节点出现在 DOM 里（先用全局选中让模型树滚过去），再点它的眼睛 */
async function clickEye(page, refno) {
  await page.evaluate(async (id) => {
    const selection = await import('/src/composables/useSelectionStore.ts');
    selection.setGlobalSelectedRefno(id);
  }, refno);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${refno}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  await row.locator('[data-testid="model-tree-eye"]').click();
}

async function expandTree(page, ids) {
  await page.evaluate(async (list) => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const tree = treeStore.getModelTreeInstance();
    for (const id of list) await tree.expandPathToNode(id, { expandSelf: true });
  }, ids);
}

async function waitLoaded(page, refnos, timeoutMs = 120_000) {
  await page.waitForFunction(async ({ list, dbno }) => {
    const loader = await import('/src/composables/useDbnoInstancesDtxLoader.ts');
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return list.every((id) => loader.isDtxRefnoLoaded(dbno, id)) && !sessions.hasActiveModelLoad();
  }, { list: refnos, dbno: DBNUM }, { timeout: timeoutMs, polling: 250 });
}

async function waitIdle(page, timeoutMs = 300_000) {
  await page.waitForFunction(async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, { timeout: timeoutMs, polling: 300 });
}

function countRequests(log, since, pathname) {
  return log.requests.filter((item) => item.at >= since && item.path === pathname).length;
}

const checks = [];
function check(scenario, name, pass, detail = '') {
  checks.push({ scenario, name, pass: !!pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} [${scenario}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ---------------------------------------------------------------------------
// 场景一：模型树 + 从树上点眼睛装的模型（新增、删除、改名、挪位置；状态保得住；选中被删；第二次点；后端重启的护栏）
// ---------------------------------------------------------------------------
async function scenarioTree(browser, real, results) {
  const name = '树与眼睛';
  const world = makeWorld();
  const { context, log } = await createGuardedContext(browser, world, real);
  const { page, events } = await newPage(context, log);
  /** B 名下一个带几何的构件：拿它试「隐藏的状态保得住」 */
  const LEAF = real.geoB[0];
  const watch = { tree: [SITE, Z, Y, A, B, C, M, N, R, LEAF], scene: [...real.geoA, ...real.geoB, ...real.geoC, ...real.geoR] };
  try {
    // 之前：C 还不存在（树上没有它、记录里没有它的构件）
    world.phase = 'A';
    world.hidden = new Set(real.geoC);
    world.treeChildren.set(Z, (nodes) => nodes.filter((node) => key(node.refno) !== C));

    console.log(`[${stamp()}] ${name}：开页面`);
    await page.goto(pageUrl(), { waitUntil: 'domcontentloaded' });
    await waitViewerReady(page);
    await page.waitForFunction(async () => {
      const treeStore = await import('/src/composables/useModelTreeStore.ts');
      return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
    }, null, { timeout: 120_000, polling: 300 });

    // 展开 SITE › Z › A，Z › B › …（到 B 的一个构件），以及 Y
    await expandTree(page, [A, Y]);
    await page.evaluate(async (leaf) => {
      const treeStore = await import('/src/composables/useModelTreeStore.ts');
      await treeStore.getModelTreeInstance().expandPathToNode(leaf);
    }, LEAF);
    // 眼睛：先单独装 A（它自己成为一个在册节点），再装 ZONE Z（B 的构件是新装的，Z 也成为在册节点），再单独装 Y 下的 R
    await clickEye(page, A);
    await waitLoaded(page, real.geoA);
    await clickEye(page, Z);
    await waitLoaded(page, [...real.geoA, ...real.geoB]);
    await clickEye(page, R);
    await waitLoaded(page, real.geoR);
    await sleep(500);
    // 把 B 的一个构件隐藏（它有自己的几何，眼睛是亮的，点一下就是隐藏）
    await clickEye(page, LEAF);
    await sleep(800);
    // 选中 A（点它那一行）
    await page.locator(`[data-testid="model-tree-row"][data-refno="${A}"]`).click();
    await sleep(500);
    const before = await readPage(page, watch);
    await page.screenshot({ path: path.join(OUT, 'tree-1-before.png') });

    check(name, '之前：树上 Z 下是 A、B（没有 C），Y 下有 M', same(before.tree.nodes[Z].childrenIds, [A, B]) && before.tree.nodes[Y].childrenIds.includes(M),
      `Z=${before.tree.nodes[Z].childrenIds.join(',')} Y=${before.tree.nodes[Y].childrenIds.join(',')}`);
    check(name, '之前：场景里有 A、B 的构件，没有 C 的', real.geoA.every((id) => before.scene[id]) && real.geoB.every((id) => before.scene[id]) && real.geoC.every((id) => !before.scene[id]),
      `A ${real.geoA.length} 件、B ${real.geoB.length} 件、C ${real.geoC.length} 件`);
    check(name, '之前：B 的一个构件隐藏着（未勾选），A 选中', before.tree.checks[LEAF] === 'unchecked' && key(before.selection.refno) === A, `构件 ${LEAF}=${before.tree.checks[LEAF]} 选中=${before.selection.refno}`);
    check(name, '之前：在册节点有 A、Z、R', [Z, A, R].every((id) => before.loadedTable.some((entry) => entry.refno === id && entry.loaded)),
      before.loadedTable.map((entry) => `${entry.refno}@${entry.modelSesno}`).join(' '));

    // 之后：库往前一个会话——A 被删、B 改名、C 新增、M 从 Y 挪到 Z、Y 下新增 N
    world.phase = 'B';
    world.bump = 1;
    world.hidden = new Set(real.geoA);
    world.gone = new Set(real.subA);
    world.changed = new Set([Z]);
    world.treeChildren.set(Z, (nodes) => [
      ...nodes.filter((node) => key(node.refno) !== A).map((node) => (key(node.refno) === B ? { ...node, name: RENAMED } : node)),
      { ...real.nodeM, owner: Z, order: 9 },
    ]);
    world.treeChildren.set(Y, (nodes) => [...nodes.filter((node) => key(node.refno) !== M), { ...real.nodeN, owner: Y, order: 9 }]);

    console.log(`[${stamp()}] ${name}：点「取最新」`);
    const t1 = Date.now();
    const run1 = await clickGetWork(page);
    await waitIdle(page);
    await sleep(600);
    const after = await readPage(page, watch);
    await page.screenshot({ path: path.join(OUT, 'tree-2-after.png') });
    const report = after.getWork.last;
    results.tree = { before, after, run1, world: 'B' };

    check(name, '树：A 消失，C 出现在 Z 下，M 挪到 Z 下，N 出现在 Y 下，B 改了名',
      after.tree.nodes[A] === null && same(after.tree.nodes[Z].childrenIds, [B, C, M]) && same(after.tree.nodes[Y].childrenIds.filter((id) => id === N || id === M), [N])
      && after.tree.nodes[M].parentId === Z && after.tree.nodes[B].name === RENAMED,
      `Z=${after.tree.nodes[Z].childrenIds.join(',')} Y=${after.tree.nodes[Y].childrenIds.join(',')} B=${after.tree.nodes[B]?.name}`);
    check(name, '树的状态保住：SITE、Z、Y、B 还展开着；B 的那个构件还是隐藏（未勾选）', [SITE, Z, Y, B].every((id) => after.tree.expanded.includes(id)) && after.tree.checks[LEAF] === 'unchecked',
      `展开=${after.tree.expanded.join(',')} 构件 ${LEAF}=${after.tree.checks[LEAF]}`);
    check(name, '树的回执：新增 C 和 N、删除 A（已删除）、改名 B、挪位置 M',
      !!report?.tree && same(report.tree.added.map((item) => item.id), [C, N]) && same(report.tree.removed.map((item) => `${item.id}:${item.fate}`), [`${A}:deleted`])
      && same(report.tree.renamed.map((item) => item.id), [B]) && same(report.tree.moved.map((item) => `${item.id}:${item.from}>${item.to}`), [`${M}:${Y}>${Z}`]),
      report?.tree ? `新增 ${report.tree.added.map((i) => i.id)} 删除 ${report.tree.removed.map((i) => `${i.id}:${i.fate}`)} 改名 ${report.tree.renamed.map((i) => i.id)} 挪 ${report.tree.moved.map((i) => i.id)}` : '没有树的回执');
    check(name, '场景：C 的构件装进来了，A 的构件撤下了，B 的还在',
      real.geoC.every((id) => after.scene[id]) && real.geoA.every((id) => !after.scene[id]) && real.geoB.every((id) => after.scene[id]),
      `C ${real.geoC.filter((id) => after.scene[id]).length}/${real.geoC.length} A ${real.geoA.filter((id) => after.scene[id]).length}/${real.geoA.length} B ${real.geoB.filter((id) => after.scene[id]).length}/${real.geoB.length}`);
    const reloadedZ = report?.models.reloaded.find((item) => item.refno === Z);
    check(name, '模型的回执：重载 Z（新增 = C 的件数，撤下 = A 的件数），A 作为已不存在的节点撤下',
      !!reloadedZ && reloadedZ.added === real.geoC.length && reloadedZ.removed === real.geoA.length
      && report.models.withdrawn.some((item) => item.refno === A && item.why === 'deleted') && report.models.failed.length === 0
      // 合计不重复计：A 的构件既在 A 名下、又在 Z 名下，撤下只算一次
      && report.models.componentsAdded === real.geoC.length && report.models.componentsRemoved === real.geoA.length,
      JSON.stringify(report?.models));
    check(name, '选中的 A 已被删除：登记成已删除，属性面板给「该构件已删除」', after.selection.deleted === true && key(after.selection.refno) === A && report?.selectionDeleted === A,
      `deleted=${after.selection.deleted} 属性面板=${after.dom.deletedNotice ?? '（面板没开或没画）'}`);
    check(name, '那句交代：状态栏上常驻，和回执一致', !!after.dom.result && after.dom.result === report?.summary, after.dom.result ?? '');
    check(name, '在册节点：Z 重新登记到新水位，A 撤表', after.loadedTable.some((entry) => entry.refno === Z && entry.modelSesno === real.sesno + 1) && !after.loadedTable.some((entry) => entry.refno === A),
      after.loadedTable.map((entry) => `${entry.refno}@${entry.modelSesno}`).join(' '));
    results.tree.requests1 = {
      children: countRequests(log, t1, '/api/v1/tree/children'), roots: countRequests(log, t1, '/api/v1/tree/roots'),
      status: countRequests(log, t1, '/api/v1/node/model-status'), versions: countRequests(log, t1, '/api/v1/node/versions'),
      records: countRequests(log, t1, '/api/v1/model/records'), dbnums: countRequests(log, t1, '/api/v1/dbnums'), health: countRequests(log, t1, '/api/v1/health'),
    };

    // 再点一次：后台没再变
    console.log(`[${stamp()}] ${name}：再点一次（后台没再变）`);
    await sleep(1500);
    const t2 = Date.now();
    const run2 = await clickGetWork(page);
    await sleep(400);
    const second = await readPage(page, watch);
    const report2 = second.getWork.last;
    results.tree.second = { run2, report: report2, requests: { status: countRequests(log, t2, '/api/v1/node/model-status'), records: countRequests(log, t2, '/api/v1/model/records'), children: countRequests(log, t2, '/api/v1/tree/children') } };
    check(name, '再点一次：说已是最新，模型一个不重载', !!report2 && report2.ok && report2.models.reloaded.length === 0 && report2.models.withdrawn.length === 0 && report2.tree?.changed === false && /^已是最新/.test(report2.summary),
      report2?.summary ?? '');
    check(name, '再点一次：按库发现——库的水位没变，不重取记录（树照旧把取过的层对一遍）',
      results.tree.second.requests.records === 0 && results.tree.second.requests.children > 0 && report2?.models.checked === 0,
      JSON.stringify(results.tree.second.requests));

    // 连点两下：两轮不并发，排成先后两轮，各给一句交代
    console.log(`[${stamp()}] ${name}：连点两下`);
    const summariesBefore = (await readPage(page, watch)).toasts.filter((item) => /^(已取最新|已是最新|取最新没有完成)/.test(item.message)).length;
    const toastCountBefore = await page.evaluate(() => window.__toasts.length);
    const queuedSeen = await page.evaluate(async () => {
      const getWork = await import('/src/composables/useModelGetWork.ts');
      const state = getWork.useModelGetWork().state;
      const button = document.querySelector('[data-testid="model-getwork-button"]');
      button.click();
      button.click();
      const queuedRightAway = state.queued === true && state.running === true;
      const first = state.last;
      // 等两轮都做完
      for (let i = 0; i < 600; i++) {
        if (!state.running) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { queuedRightAway, changed: state.last !== first, running: state.running };
    });
    await sleep(300);
    const summariesAfter = await page.evaluate((from) => window.__toasts.slice(from).filter((item) => /^(已取最新|已是最新|取最新没有完成)/.test(item.message)).length, toastCountBefore);
    results.tree.double = { queuedSeen, summariesBefore, summariesAfter };
    check(name, '连点两下：第二下排成下一轮（按钮上看得到在排队），先后跑完两轮、各给一句交代', queuedSeen.queuedRightAway && !queuedSeen.running && summariesAfter === 2,
      `点完就在排队=${queuedSeen.queuedRightAway} 这两下之后的交代条数=${summariesAfter}`);

    // 后端重启之后：按需生成的模型没了，记录查空——不能当成已删除
    console.log(`[${stamp()}] ${name}：后端「重启」之后记录查空`);
    world.phase = 'C';
    world.bump = 2;
    world.startedAt = new Date().toISOString();
    world.hidden = new Set([...real.geoA, ...real.geoB, ...real.geoC, ...real.subR]);
    world.changed = new Set([R]);
    world.statusCalls = new Map();
    const notGenerated = (json) => ({
      ...json,
      verdict: 'not_generated',
      units: { ...json.units, generated: 0, missing: json.units.total, lagging: 0 },
      generated_at: null,
      precheck: { ...json.precheck, units_to_generate: json.units.total },
    });
    // Z：后端直说没有它的模型；B：先还说有（于是去重载），等重载查过记录（查空）之后再问就说没有了——
    // 模拟「问状态」和「查记录」之间后端重启的那个空档。按「查没查过记录」改口，不按第几次问：已加载节点表自己也会在后台问
    world.recordsSeen = 0;
    world.statusOverride.set(Z, (json) => notGenerated(json));
    world.statusOverride.set(R, (json) => (world.recordsSeen === 0 ? json : notGenerated(json)));
    const run3 = await clickGetWork(page);
    await waitIdle(page);
    await sleep(500);
    const third = await readPage(page, watch);
    await page.screenshot({ path: path.join(OUT, 'tree-3-after-restart.png') });
    const report3 = third.getWork.last;
    results.tree.restart = { run3, report: report3, scene: third.scene, statusCalls: Object.fromEntries(world.statusCalls) };
    check(name, '重启之后：认出后端重启过', report3?.backendRestarted === true, `backendRestarted=${report3?.backendRestarted}`);
    check(name, '重启之后：场景一个构件都没被撤（B、C、R 的都还在）', [...real.geoB, ...real.geoC, ...real.geoR].every((id) => third.scene[id]),
      `B ${real.geoB.filter((id) => third.scene[id]).length}/${real.geoB.length} C ${real.geoC.filter((id) => third.scene[id]).length}/${real.geoC.length} R ${real.geoR.filter((id) => third.scene[id]).length}/${real.geoR.length}`);
    check(name, '重启之后：Z 没动并说明（后端重启过…不当成已删除）', !!report3?.models.kept.some((item) => item.refno === Z && /后端重启过/.test(item.reason) && /不当成已删除/.test(item.reason)),
      JSON.stringify(report3?.models.kept));
    check(name, '重启之后：R 去重载时记录查空，护栏拦住——没撤，记成没换成', !!report3?.models.failed.some((item) => item.refno === R) && (world.statusCalls.get(R) ?? 0) >= 2 && report3.models.withdrawn.length === 0,
      `failed=${JSON.stringify(report3?.models.failed)} R 的节点状态问了 ${world.statusCalls.get(R) ?? 0} 次，查记录 ${world.recordsSeen} 次`);
    check(name, '重启之后：R、Z 还在在册节点里', [R, Z].every((id) => third.loadedTable.some((entry) => entry.refno === id && entry.loaded)), third.loadedTable.map((entry) => entry.refno).join(' '));
  } finally {
    results.treeLog = { blocked: log.blocked, allowedPost: log.allowedPost, overlaid: log.overlaid, httpFailures: log.httpFailures.slice(0, 40), wsFramesSent: log.wsFramesSent, pageErrors: events.pageErrors, consoleErrors: events.console.slice(0, 20) };
    check(name, '护栏：除 GET 和三种只读 POST 之外没有请求发到后端', log.blocked.length === 0, log.blocked.length ? JSON.stringify(log.blocked.slice(0, 5)) : `放行的只读 POST：${JSON.stringify(log.allowedPost)}`);
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// 场景二：地址栏直装（show_refno）——新增的构件装进来，被删的根撤下
// ---------------------------------------------------------------------------
async function scenarioShowRefno(browser, real, results) {
  const name = '地址栏直装';
  const world = makeWorld();
  const { context, log } = await createGuardedContext(browser, world, real);
  const { page, events } = await newPage(context, log);
  const late = real.geoB.slice(-2);
  const early = real.geoB.slice(0, -2);
  const watch = { tree: [B, C], scene: [...real.geoB, ...real.geoC] };
  try {
    // 之前：B 只有前两件（后两件还不存在）
    world.hidden = new Set(late);
    console.log(`[${stamp()}] ${name}：开页面 show_refno=${B},${C}`);
    await page.goto(pageUrl({ show_refno: `${B},${C}`, show_refno_select: '0' }), { waitUntil: 'domcontentloaded' });
    await waitViewerReady(page);
    await waitLoaded(page, [...early, ...real.geoC]);
    await sleep(1500);
    const before = await readPage(page, watch);
    await page.screenshot({ path: path.join(OUT, 'showrefno-1-before.png') });
    check(name, '之前：B 的前两件和 C 都在场景里，B 的后两件不在', early.every((id) => before.scene[id]) && late.every((id) => !before.scene[id]) && real.geoC.every((id) => before.scene[id]),
      `B ${real.geoB.filter((id) => before.scene[id]).length}/${real.geoB.length} C ${real.geoC.filter((id) => before.scene[id]).length}/${real.geoC.length}`);
    check(name, '之前：两个直装的根登记在取最新的登记表里（带装时的水位），不在已加载节点表里',
      same(before.registry.roots.map((item) => `${item.refno}:${item.origin}:${item.loadedModelSesno}`), [`${B}:show_refno:${real.sesno}`, `${C}:show_refno:${real.sesno}`])
      && !before.loadedTable.some((entry) => entry.refno === B || entry.refno === C),
      JSON.stringify(before.registry.roots));

    // 之后：B 多出两件、C 被删
    world.phase = 'B';
    world.bump = 1;
    world.hidden = new Set();
    world.gone = new Set(real.subC);
    world.changed = new Set([B]);
    console.log(`[${stamp()}] ${name}：点「取最新」`);
    const run = await clickGetWork(page);
    await waitIdle(page);
    await sleep(600);
    const after = await readPage(page, watch);
    await page.screenshot({ path: path.join(OUT, 'showrefno-2-after.png') });
    const report = after.getWork.last;
    results.showRefno = { before, after, run };
    check(name, '场景：B 的四件都在了（新增的两件装进来），C 的构件撤下了', real.geoB.every((id) => after.scene[id]) && real.geoC.every((id) => !after.scene[id]),
      `B ${real.geoB.filter((id) => after.scene[id]).length}/${real.geoB.length} C ${real.geoC.filter((id) => after.scene[id]).length}/${real.geoC.length}`);
    const reloadedB = report?.models.reloaded.find((item) => item.refno === B);
    check(name, '回执：重载 B（新增 2 件），C 作为已不存在的节点撤下', !!reloadedB && reloadedB.added === late.length && report.models.withdrawn.some((item) => item.refno === C && item.why === 'deleted'),
      JSON.stringify(report?.models));
    check(name, '之后：B 交给已加载节点表，登记表里不再有这两个根', after.loadedTable.some((entry) => entry.refno === B && entry.loaded) && after.registry.roots.length === 0,
      `已加载节点表=${after.loadedTable.map((entry) => entry.refno).join(',')} 登记表=${after.registry.roots.map((item) => item.refno).join(',')}`);
    check(name, '那句交代', !!report?.ok && /重载 1 个节点/.test(report.summary) && /撤下 1 个已不存在的节点/.test(report.summary), report?.summary ?? '');

    // 正在装一个大节点的时候点「取最新」：不打断，等它装完再对账
    const BIG = '24384_46';
    console.log(`[${stamp()}] ${name}：装 SITE ${BIG} 的同时点「取最新」`);
    await page.evaluate((refno) => {
      window.dispatchEvent(new CustomEvent('showModelByRefnos', { detail: { refnos: [refno], flyTo: false } }));
    }, BIG);
    await page.waitForFunction(async () => {
      const sessions = await import('/src/composables/modelLoadSession.ts');
      return sessions.hasActiveModelLoad();
    }, null, { timeout: 30_000, polling: 50 });
    const busyRun = await clickGetWork(page, 600_000);
    await sleep(500);
    const busyAfter = await readPage(page, watch);
    const busyReport = busyAfter.getWork.last;
    results.showRefno.busy = { run: busyRun, report: busyReport, loadedTable: busyAfter.loadedTable };
    check(name, '装载中点取最新：先说在等装载结束，装载没被打断（那个 SITE 装完、进了已加载节点表），然后这一轮照常做完',
      busyRun.progress.includes('等正在进行的装载结束…') && busyAfter.loadedTable.some((entry) => entry.refno === BIG && entry.loaded) && busyReport?.ok === true
      && !busyAfter.toasts.some((item) => /已停止加载/.test(item.message)),
      `进度=${busyRun.progress.join(' / ')} 用时 ${busyRun.ms} 毫秒；${busyReport?.summary ?? ''}`);
  } finally {
    results.showRefnoLog = { blocked: log.blocked, allowedPost: log.allowedPost, overlaid: log.overlaid, httpFailures: log.httpFailures.slice(0, 30), pageErrors: events.pageErrors, consoleErrors: events.console.slice(0, 20) };
    check(name, '护栏：除 GET 和三种只读 POST 之外没有请求发到后端', log.blocked.length === 0, log.blocked.length ? JSON.stringify(log.blocked.slice(0, 5)) : `放行的只读 POST：${JSON.stringify(log.allowedPost)}`);
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// 场景三：整库显示（show_dbnum）——已装 SITE 下新增的构件装进来、删掉的撤下；新出现的 SITE 装进来
// ---------------------------------------------------------------------------
async function scenarioShowDbnum(browser, real, results) {
  const name = '整库显示';
  const world = makeWorld();
  const { context, log } = await createGuardedContext(browser, world, real);
  const { page, events } = await newPage(context, log);
  const testGeo = [...real.subTest].filter((id) => id !== '24384_26549');
  const watch = { tree: [SITE, TEST_SITE], scene: [...real.geoA, ...real.geoB, ...real.geoC, ...testGeo] };
  try {
    // 之前：C 还不存在；测试 SITE 24384_26547 下还什么都没有
    world.hidden = new Set([...real.geoC, ...real.subTest]);
    console.log(`[${stamp()}] ${name}：开页面 show_dbnum=${DBNUM}`);
    const loadStart = Date.now();
    await page.goto(pageUrl({ show_dbnum: String(DBNUM) }), { waitUntil: 'domcontentloaded' });
    await waitViewerReady(page);
    await page.waitForFunction(() => {
      const status = window.__dtxLastShowDbnumLoadResult?.status;
      return !!status && status !== 'loading';
    }, null, { timeout: 600_000, polling: 500 });
    await waitIdle(page);
    await sleep(1000);
    const before = await readPage(page, watch);
    const loadResult = await page.evaluate(() => window.__dtxLastShowDbnumLoadResult);
    // 登记下来的 SITE 在显示流程眼里是什么样（另起一份显示流程读同一份模块级的账）
    const sceneView = await page.evaluate(async ({ site, sample, dbno }) => {
      const [generation, meta, loader] = await Promise.all([
        import('/src/composables/useModelGeneration.ts'),
        import('/src/composables/useDbMetaInfo.ts'),
        import('/src/composables/useDbnoInstancesDtxLoader.ts'),
      ]);
      const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
      const members = gen.loadedRefnosOf(site);
      return {
        dbnumOfSite: meta.tryGetDbnumByRefno(site),
        members: members ? members.length : null,
        membersSample: members ? members.slice(0, 3) : null,
        membersLoaded: members ? members.filter((id) => loader.isDtxRefnoLoaded(dbno, id)).length : null,
        // 不带库号问（修正之前的问法）和带着登记的库号问
        rootInSceneWithoutDbnum: gen.isRootInScene(site),
        rootInSceneWithDbnum: gen.isRootInScene(site, dbno),
        sampleLoaded: loader.isDtxRefnoLoaded(dbno, sample),
      };
    }, { site: SITE, sample: real.geoA[0], dbno: DBNUM });
    console.log(`  显示流程眼里的 SITE ${SITE}：${JSON.stringify(sceneView)}`);
    await page.screenshot({ path: path.join(OUT, 'showdbnum-1-before.png') });
    console.log(`[${stamp()}] ${name}：整库装完，用时 ${Math.round((Date.now() - loadStart) / 1000)} 秒，${loadResult?.loadedObjects} 个实例`);
    check(name, '之前：整库装进来了；A、B 的构件在，C 的和测试 SITE 的不在',
      loadResult?.status === 'loaded' && real.geoA.every((id) => before.scene[id]) && real.geoB.every((id) => before.scene[id]) && real.geoC.every((id) => !before.scene[id]) && testGeo.every((id) => !before.scene[id]),
      `status=${loadResult?.status} 实例 ${loadResult?.loadedObjects}，构件 ${loadResult?.refnoCount}`);
    const scope = before.registry.scopes.find((item) => item.dbnum === DBNUM);
    check(name, '之前：收齐的 SITE 登记在册；空的测试 SITE 不算已在管', !!scope && scope.discover === true && before.registry.roots.some((item) => item.refno === SITE && item.origin === 'show_dbnum')
      && !scope.knownSites.includes(TEST_SITE) && scope.knownSites.includes(SITE),
      `登记的根=${before.registry.roots.map((item) => item.refno).join(',')} 已在管=${scope?.knownSites.join(',')}`);

    // 之后：C 新增、A 被删（都在 SITE 24384_24932 下），测试 SITE 下有东西了
    world.phase = 'B';
    world.bump = 1;
    world.hidden = new Set(real.geoA);
    world.changed = new Set([SITE]);
    console.log(`[${stamp()}] ${name}：点「取最新」`);
    const run = await clickGetWork(page, 600_000);
    await waitIdle(page);
    await sleep(800);
    const after = await readPage(page, watch);
    await page.screenshot({ path: path.join(OUT, 'showdbnum-2-after.png') });
    const report = after.getWork.last;
    results.showDbnum = { loadResult, loadMs: Date.now() - loadStart, before: { registry: before.registry, sceneObjects: before.sceneObjects }, after, run };
    check(name, '场景：C 的构件装进来了，A 的撤下了，B 的还在，测试 SITE 的构件装进来了',
      real.geoC.every((id) => after.scene[id]) && real.geoA.every((id) => !after.scene[id]) && real.geoB.every((id) => after.scene[id]) && testGeo.every((id) => after.scene[id]),
      `C ${real.geoC.filter((id) => after.scene[id]).length}/${real.geoC.length} A ${real.geoA.filter((id) => after.scene[id]).length}/${real.geoA.length} 测试 SITE ${testGeo.filter((id) => after.scene[id]).length}/${testGeo.length}`);
    const reloadedSite = report?.models.reloaded.find((item) => item.refno === SITE);
    check(name, '回执：只重载了有变化的那个 SITE（新增 = C 的件数、撤下 = A 的件数），别的 SITE 没动',
      !!reloadedSite && reloadedSite.added === real.geoC.length && reloadedSite.removed === real.geoA.length && report.models.reloaded.length === 1,
      JSON.stringify(report?.models.reloaded));
    check(name, '回执：新出现的测试 SITE 装进来了', !!report?.models.loadedNew.some((item) => item.refno === TEST_SITE && item.total >= 1), JSON.stringify(report?.models.loadedNew));
    check(name, '那句交代', !!report?.ok && /重载 1 个节点/.test(report.summary) && /新装入 1 个 SITE/.test(report.summary), report?.summary ?? '');
  } finally {
    results.showDbnumLog = { blocked: log.blocked, allowedPost: log.allowedPost, overlaid: log.overlaid, httpFailures: log.httpFailures.slice(0, 30), pageErrors: events.pageErrors, consoleErrors: events.console.slice(0, 20) };
    check(name, '护栏：除 GET 和三种只读 POST 之外没有请求发到后端', log.blocked.length === 0, log.blocked.length ? JSON.stringify(log.blocked.slice(0, 5)) : `放行的只读 POST：${JSON.stringify(log.allowedPost)}`);
    await context.close();
  }
}

// ---------------------------------------------------------------------------

const which = process.argv[2] ?? 'all';
const startedAt = new Date();
console.log(`[${stamp()}] 摸清真实世界（只读）…`);
const real = await surveyRealWorld();
console.log(`  8000 库在会话 ${real.sesno}；A ${real.geoA.length} 件、B ${real.geoB.length} 件、C ${real.geoC.length} 件、R ${real.geoR.length} 件；M=${real.nodeM?.name} N=${real.nodeN?.name}`);
if (!real.nodeM || !real.nodeN || real.geoA.length === 0 || real.geoB.length < 3 || real.geoC.length === 0) throw new Error('真实世界和脚本假设的不一样，先别跑');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: process.env.PAGE_HEADED !== '1',
  args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(TMP, 'chrome-cache')}`],
});
const results = { startedAt: startedAt.toISOString(), front: FRONT, backend: BACKEND, real: { sesno: real.sesno, geoA: real.geoA, geoB: real.geoB, geoC: real.geoC } };
try {
  if (which === 'all' || which === 'tree') await scenarioTree(browser, real, results);
  if (which === 'all' || which === 'showrefno') await scenarioShowRefno(browser, real, results);
  if (which === 'all' || which === 'showdbnum') await scenarioShowDbnum(browser, real, results);
} catch (error) {
  console.error(`[${stamp()}] 出错：${error?.stack ?? error}`);
  results.error = String(error?.stack ?? error).slice(0, 2000);
  process.exitCode = 2;
} finally {
  await browser.close();
  results.finishedAt = new Date().toISOString();
  results.checks = checks;
  writeFileSync(path.join(OUT, `result-${which}.json`), `${JSON.stringify(results, null, 1)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.pass);
  console.log(`[${stamp()}] 共 ${checks.length} 项，过 ${checks.length - failed.length}，没过 ${failed.length}`);
  if (failed.length > 0 && !process.exitCode) process.exitCode = 1;
}
