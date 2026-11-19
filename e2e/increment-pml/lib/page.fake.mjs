/**
 * 假页面和假后端：给流程的自测（`case-runner.selftest.mjs`）用，不开浏览器、不连后端、不开 E3D。
 *
 * `page.mjs` 里碰浏览器的函数，流程用到的在这里各有一个同名的假的，照同一个「假的世界」回话；不碰浏览器的那几个原样用真的
 * （最下面列着）。自测把 `case-runner.mjs`、`leg.mjs` 导入的 `./page.mjs` 换成这个文件，流程代码和判定函数一行不改、照原样跑。
 * 流程以后多导入一个这里没有的名字，自测一启动就报「没有这个导出」，不会悄悄用上真的。
 *
 * 假的世界：一个库，几个会话；每个会话写明各节点叫什么、是什么类型、挂在谁下面、有没有几何（有就写世界位置，mm）。
 * 假后端此刻在哪个会话，就按那个会话回话；腿的流程等后端跟上（`waitCaughtUp`）的时候，假后端就走到要等的那个会话。
 *
 * 假页面是一张「做对了」的页面，产品现有的毛病这里不学：
 * - 点眼睛装一个节点，装进场景的就是后端此刻它名下的几何；
 * - 点「取最新」，装过的节点名下的对象换成后端此刻的记录：名下空了的撤下，又有了的装回来；取过成员的层重取一遍。
 * - 两种装不上：后端此刻它名下没有几何（空节点装不进场景）；或者它写在 `refuses` 里（后端有几何，页面就是没装上）。
 *   装不上时和真的 `loadRoots` 一样抛「等……装完超过 120000 毫秒」，只是不真等。
 *
 * 只做到够判 W3（场景 = 后端）和 W6（干净）：行上只有「最新 / 没装」两种样子，没有「有更新」的信号；回执里的名单是按假的世界
 * 自己算的，没有逐项对过产品的口径。要判 W1、W2、W5、W7，得先把这两样补上。手动路径（点行上的「更新」）没有做。
 */
import path from 'node:path';

import { loopbackOrigin, sleep } from './backend.mjs';
import { refnoKey } from './judge.mjs';

const byRefno = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const childrenIn = (nodes, id) => Object.keys(nodes).filter((child) => nodes[child].owner === id).sort(byRefno);
const matrixAt = ([x, y, z]) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

/** 一个节点名下带几何的构件（一路往下找）→ 各自的世界矩阵（列主序，mm） */
function componentsIn(nodes, root) {
  const out = {};
  const walk = (id) => {
    for (const child of childrenIn(nodes, id)) {
      if (nodes[child].at) out[child] = [matrixAt(nodes[child].at)];
      walk(child);
    }
  };
  if (nodes[root]) walk(root);
  return out;
}

/** 页面树上看得见的节点：最上面的，加上取过成员的层下面的（按树上的次序） */
function visibleIn(nodes, fetched) {
  const out = [];
  const walk = (id) => {
    out.push(id);
    if (fetched.has(id)) childrenIn(nodes, id).forEach(walk);
  };
  Object.keys(nodes).filter((id) => nodes[id].owner === null).sort(byRefno).forEach(walk);
  return out;
}

function fakeBackend(world) {
  const nodes = () => world.sessions[world.current];
  const level = () => ({
    dbnum: world.dbnum,
    file: world.current,
    applied: world.current,
    model: world.current,
    initialized: true,
    excluded: false,
    excludedReason: null,
    verdict: 'in_sync',
  });

  async function libraries() {
    return { [world.dbnum]: level() };
  }

  async function exists(refno) {
    return !!nodes()[refnoKey(refno)];
  }

  async function layers(ids) {
    const here = nodes();
    const members = (id) => childrenIn(here, id).map((child) => ({
      id: child,
      name: here[child].name,
      noun: here[child].noun,
      owner: id,
      children: childrenIn(here, child).length,
    }));
    return Object.fromEntries(ids.map(refnoKey).map((id) => [id, here[id] ? members(id) : null]));
  }

  async function snapshot(roots) {
    const at = Date.now();
    const here = nodes();
    const out = {};
    for (const root of roots.map(refnoKey)) {
      const components = componentsIn(here, root);
      out[root] = here[root]
        ? {
          status: 200,
          message: null,
          complete: true,
          modelSource: 'database',
          pending: null,
          records: Object.keys(components).length,
          components,
          geometry: Object.fromEntries(Object.keys(components).map((component) => [component, [`geo-${component}`]])),
        }
        : { status: 404, message: '节点找不到', complete: null, modelSource: null, pending: null, records: 0, components: {}, geometry: {} };
    }
    return { at, roots: out, libraries: await libraries() };
  }

  /** 等库跟到会话 `to`：假的世界里有这个会话就立刻走过去，没有就算没跟上 */
  async function waitCaughtUp(dbnum, { to = null } = {}) {
    if (to === null) throw new TypeError('假后端：等后端跟上要写明等到哪个会话（to）');
    const mine = Number(dbnum) === world.dbnum;
    const ok = mine && !!world.sessions[to];
    if (ok) world.current = to;
    const mark = ok ? 0 : null;
    return { ok, target: to, fileSeenMs: mark, appliedMs: mark, modelMs: mark, library: mine ? level() : null };
  }

  return { libraries, layers, exists, snapshot, waitCaughtUp };
}

/**
 * @param {object} input
 * @param {number} input.dbnum 这个库的库号
 * @param {Record<number, Record<string, { name: string, noun: string, owner: string | null, at?: number[] }>>} input.sessions
 *   会话 → 节点表（参考号 → 名字、类型、上级、几何的世界位置；没有 `at` 就是没有几何）
 * @param {number} input.start 开头在哪个会话
 * @param {string[]} [input.refuses] 点了眼睛也装不上的节点（后端有没有几何都装不上）
 * @returns 假的世界：`browser` 交给 `runCase` 当浏览器，`backend` 当后端；`shots` 是截过的图的文件名，`pages` 是开过的页面
 */
export function createFakeWorld({ dbnum, sessions, start, refuses = [] }) {
  if (!sessions[start]) throw new TypeError(`假的世界：没有开头的会话 ${start}`);
  const world = { dbnum, sessions, current: start, refuses: new Set(refuses.map(refnoKey)), shots: [], pages: [], closed: 0 };
  world.browser = { fakeWorld: world };
  world.backend = fakeBackend(world);
  return world;
}

function worldOf(holder) {
  const world = holder?.fakeWorld;
  if (!world) throw new TypeError('假页面：要的是 createFakeWorld() 给的 browser（和用它开出来的页面）');
  return world;
}

/** 记录是按毫秒切时段的：等时钟走过这一毫秒，前后两件事才分得出先后 */
async function nextMillisecond() {
  const from = Date.now();
  while (Date.now() === from) await sleep(1);
}

/** 页面发了一条请求（只记进闸门的记录，哪儿也不发） */
async function request(page, method, url) {
  page.log.requests.push({ t: Date.now(), method, url });
  await nextMillisecond();
}

function touched(page, what) {
  page.log.interactions.push({ t: Date.now(), what });
}

/** 把后端的构件摆进场景：每个矩阵一个对象，对象号在这张页面里不重复 */
function placed(page, components) {
  return Object.fromEntries(Object.entries(components).map(([component, matrices]) => [
    component,
    matrices.map((m) => ({ id: `obj-${(page.objects += 1)}`, m })),
  ]));
}

const inScene = (entry) => !!entry && Object.keys(entry.objects).length > 0;

function rowsOf(page, ids) {
  const seen = new Set(visibleIn(worldOf(page).sessions[page.treeAt], page.fetched));
  return Object.fromEntries(ids.map(refnoKey).map((id) => {
    if (!seen.has(id)) return [id, { present: false }];
    const lit = inScene(page.loaded.get(id));
    return [id, { present: true, action: null, label: null, busy: false, nodeStatus: lit ? 'latest' : null, dbStatus: 'current', pending: false, eyeLit: lit, loading: false }];
  }));
}

export async function createGuardedContext(browser, options) {
  const world = worldOf(browser);
  const log = {
    pageOrigin: loopbackOrigin(options.pageOrigin, '页面服务的地址'),
    backendOrigin: loopbackOrigin(options.backendOrigin, '隔离后端的地址'),
    requests: [],
    toLive: [],
    blocked: [],
    httpFailures: [],
    consoleErrors: [],
    pageErrors: [],
    websockets: [],
    frames: [],
    dialogs: [],
    interactions: [],
    allowedPost: {},
    extraPost: {},
    openPosts: [],
    acceptDialogs: [],
  };
  const context = {
    fakeWorld: world,
    close: async () => {
      world.closed += 1;
    },
  };
  return { context, log };
}

export async function newPage(context, log) {
  const world = worldOf(context);
  const page = {
    fakeWorld: world,
    log,
    // 页面的树是照哪个会话取的、取过成员的层
    treeAt: world.current,
    fetched: new Set(),
    // 装过的节点 → 装的时候后端的记录、场景里的对象（名下空了的是撤下的，留在表里）
    loaded: new Map(),
    objects: 0,
    watching: null,
    lastReceipt: null,
    screenshot: async ({ path: file }) => {
      world.shots.push(path.basename(file));
    },
  };
  world.pages.push(page);
  return page;
}

export async function openApp(page) {
  page.treeAt = worldOf(page).current;
  await request(page, 'GET', `${page.log.pageOrigin}/`);
}

export async function waitIdle(page) {
  worldOf(page);
}

export async function expandTree(page, log, ids) {
  touched(page, `展开模型树：${ids.join('、')}`);
  for (const id of ids.map(refnoKey)) {
    page.fetched.add(id);
    await request(page, 'GET', `${page.log.backendOrigin}/api/v1/tree/children`);
  }
  page.treeAt = worldOf(page).current;
}

export async function loadRoots(page, log, roots) {
  const world = worldOf(page);
  for (const root of roots) {
    const id = refnoKey(root.refno);
    touched(page, `点 ${id} 的眼睛`);
    await request(page, 'POST', `${page.log.backendOrigin}/api/v1/model/records`);
    const source = world.refuses.has(id) ? {} : componentsIn(world.sessions[world.current], id);
    if (Object.keys(source).length === 0) throw new Error(`等「节点 ${root.refno} 装完」超过 120000 毫秒`);
    page.loaded.set(id, { dbnum: root.dbnum, source, objects: placed(page, source) });
  }
}

export async function clickGetWork(page) {
  const world = worldOf(page);
  const clickedAt = Date.now();
  touched(page, '点「取最新」');
  await request(page, 'GET', `${page.log.backendOrigin}/api/v1/dbnums`);
  const before = world.sessions[page.treeAt];
  const now = world.sessions[world.current];

  // 树：取过成员的层重取一遍（库里已经没有的层不再算）
  const layersRequested = page.fetched.size;
  const seenBefore = visibleIn(before, page.fetched);
  for (const id of [...page.fetched]) if (!now[id]) page.fetched.delete(id);
  page.treeAt = world.current;
  const seenNow = visibleIn(now, page.fetched);
  const was = new Set(seenBefore);
  const is = new Set(seenNow);
  const brief = (nodes, id) => ({ id, name: nodes[id].name, type: nodes[id].noun, dbnum: world.dbnum });
  const kept = seenNow.filter((id) => was.has(id));
  const tree = {
    layersRequested,
    layersRefreshed: page.fetched.size,
    layersFailed: [],
    added: seenNow.filter((id) => !was.has(id)).map((id) => brief(now, id)),
    removed: seenBefore.filter((id) => !is.has(id)).map((id) => ({ ...brief(before, id), fate: now[id] ? 'relocated' : 'deleted' })),
    renamed: kept.filter((id) => before[id].name !== now[id].name).map((id) => ({ ...brief(now, id), from: before[id].name, to: now[id].name })),
    moved: kept.filter((id) => before[id].owner !== now[id].owner).map((id) => ({ ...brief(now, id), from: before[id].owner, to: now[id].owner })),
  };
  tree.changed = tree.added.length + tree.removed.length + tree.renamed.length + tree.moved.length > 0;

  // 模型：装过的节点，后端的记录和装的时候不一样了就换成现在的
  const reloaded = [];
  const withdrawn = [];
  for (const [id, entry] of page.loaded) {
    const source = componentsIn(now, id);
    if (JSON.stringify(source) === JSON.stringify(entry.source)) continue;
    const had = Object.keys(entry.source);
    const has = Object.keys(source);
    if (has.length === 0) withdrawn.push({ refno: id, refnos: had.length, why: now[id] ? 'empty' : 'deleted' });
    else reloaded.push({ refno: id, added: has.filter((item) => !had.includes(item)).length, removed: had.filter((item) => !has.includes(item)).length, total: has.length });
    entry.source = source;
    entry.objects = placed(page, source);
  }

  const quiet = !tree.changed && reloaded.length + withdrawn.length === 0;
  const receipt = {
    startedAt: clickedAt,
    finishedAt: Date.now(),
    ok: true,
    error: null,
    backendRestarted: false,
    tree,
    treeError: null,
    models: { rootsTotal: page.loaded.size, checked: page.loaded.size, reloaded, loadedNew: [], withdrawn, kept: [], failed: [] },
    libraries: [],
    waited: null,
    level: 'success',
    summary: quiet ? '已是最新。' : `已取最新：模型重载 ${reloaded.length} 个节点、撤下 ${withdrawn.length} 个节点。`,
    detail: [],
  };
  page.lastReceipt = receipt;
  return { clickedAt, ms: Date.now() - clickedAt, receipt };
}

export async function readPageState(page, roots) {
  const world = worldOf(page);
  const entries = [...page.loaded].filter(([, entry]) => inScene(entry));
  return {
    at: Date.now(),
    roots: roots.map((root) => {
      const id = refnoKey(root.refno);
      const entry = page.loaded.get(id);
      return { refno: id, dbnum: root.dbnum, members: inScene(entry) ? Object.keys(entry.objects).sort(byRefno) : null, inScene: inScene(entry) };
    }),
    loadedTable: entries.map(([id, entry]) => ({
      refno: id,
      dbnum: entry.dbnum,
      loaded: true,
      modelSesno: world.current,
      fileLatestSesno: world.current,
      verdict: 'latest',
      staleReason: null,
      checking: false,
    })),
    registry: [],
    getWork: { running: false, progress: '', last: page.lastReceipt ? structuredClone(page.lastReceipt) : null },
    resultText: page.lastReceipt?.summary ?? null,
    toasts: [],
  };
}

/** 场景里的对象。假的世界直接用 mm，包围盒取位置上下左右各 500 mm */
export async function readScene(page, dbnums) {
  worldOf(page);
  const byDbnum = Object.fromEntries(dbnums.map((dbnum) => [dbnum, {}]));
  let objects = 0;
  let unresolved = 0;
  for (const entry of page.loaded.values()) {
    for (const [component, list] of Object.entries(entry.objects)) {
      objects += list.length;
      if (!byDbnum[entry.dbnum]) {
        unresolved += list.length;
        continue;
      }
      byDbnum[entry.dbnum][component] = list.map(({ id, m }) => ({
        id,
        m: [...m],
        visible: true,
        box: [m[12] - 500, m[13] - 500, m[14] - 500, m[12] + 500, m[13] + 500, m[14] + 500],
      }));
    }
  }
  return { at: Date.now(), objects, unresolved, byDbnum };
}

export async function readTree(page) {
  const nodes = worldOf(page).sessions[page.treeAt];
  return Object.fromEntries(visibleIn(nodes, page.fetched).map((id) => [id, {
    name: nodes[id].name,
    type: nodes[id].noun,
    parentId: nodes[id].owner,
    childrenIds: page.fetched.has(id) ? childrenIn(nodes, id) : null,
  }]));
}

/** 假的世界里最上面就是参考号节点，没有「库」「分组」那样不是参考号的行 */
export async function readTreeTops(page) {
  worldOf(page);
  return [];
}

export async function readLoadedLayerCount(page) {
  worldOf(page);
  return page.fetched.size;
}

export async function layerCounts(page, tree) {
  const refnoLayers = Object.values(tree).filter((node) => Array.isArray(node.childrenIds)).length;
  const pageLoadedLayers = await readLoadedLayerCount(page);
  return { ok: pageLoadedLayers === refnoLayers, refnoLayers, topLayers: 0, pageLoadedLayers };
}

export async function arrangeRows(page, log, ids, { allowMissing = false } = {}) {
  const all = rowsOf(page, ids);
  const missing = Object.keys(all).filter((id) => !all[id].present);
  if (missing.length > 0 && !allowMissing) throw new Error(`模型树的行里没有 ${missing.join('、')}（上级没展开？）`);
  const order = visibleIn(worldOf(page).sessions[page.treeAt], page.fetched);
  const rows = Object.fromEntries(Object.entries(all).filter(([, row]) => row.present));
  const positions = Object.keys(rows).map((id) => order.indexOf(id));
  return {
    indices: Object.fromEntries(Object.keys(all).map((id) => [id, order.indexOf(id)])),
    treeRows: order.length,
    span: positions.length > 0 ? Math.max(...positions) - Math.min(...positions) + 1 : 0,
    containerHeight: 0,
    resizedTo: null,
    rows,
    missing,
  };
}

export async function readSettledRows(page, ids) {
  return { rows: rowsOf(page, ids), settled: true, unsettled: [], waitedMs: 0 };
}

export async function startRowWatch(page, ids) {
  page.watching = { ids: ids.map(refnoKey), startedAt: Date.now() };
}

/** 只在停的时候记一笔：假页面的行不会自己变 */
export async function stopRowWatch(page) {
  if (!page.watching) return null;
  const { ids, startedAt } = page.watching;
  page.watching = null;
  const stoppedAt = Date.now();
  return { ids, startedAt, stoppedAt, ticks: 1, samples: [{ t: stoppedAt, rows: rowsOf(page, ids) }] };
}

export async function readCamera(page) {
  worldOf(page);
  return { at: Date.now(), position: [44, 8, 4], target: [40, 5, 0], quaternion: [0, 0, 0, 1], fov: 30, zoom: 1, atRest: true, waitedMs: 0 };
}

const notMade = (what) => async () => {
  throw new Error(`假页面没有做「${what}」：自测不该走到这里`);
};
export const waitRowSignal = notMade('等行上的信号');
export const clickRowUpdate = notMade('点行上的「更新」');
export const readUpdateState = notMade('读「更新到最新」走到哪了');

// 不碰浏览器的几个，原样用真的
export { cameraChange, cleanlinessInput, fetchedLayers, maskText, requestSummary, sceneByRoot } from './page.mjs';
