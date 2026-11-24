/**
 * 页面这一侧的取数：带请求闸门的浏览器上下文、开页面、装节点、读行上的状态和按钮、点「取最新」读回执、读场景对象的
 * 世界矩阵和包围盒、读模型树，外加页面的请求和报错清单。从 11-17 回归的脚本（`docs/verification/model-getwork-2026-11-12/`
 * 的 `r3-lib.mjs` 等）整理过来，写法没变，地址和节点改成由调用方给。
 *
 * 请求闸门：发往 8022 / 8009 的一律拦下并记数；写请求只放行发往隔离后端的几种只读 POST（调用方可以临时多放一条）；
 * 其余的读请求放行但逐条记下，发没发到别处由 W6 判。
 *
 * 驱动在页面上做的每一个操作（展开、滚动、选中、点眼睛、点取最新）都记在 `log.interactions` 里：W1 要求存盘之后、行上的信号出来之前
 * 什么都不碰。读行只读已经画出来的 DOM，不滚动、不选中。
 *
 * 闸门只管页面发的请求。浏览器进程自己发的（自带功能的探测、更新之类）闸门看不见，由启动参数上的联网锁管（`NETWORK_LOCK_ARGS`）。
 */
import net from 'node:net';

import { chromium } from 'playwright';

import { loopbackOrigin, sleep } from './backend.mjs';
import { LIVE_PORTS, refnoKey } from './judge.mjs';

const READ_ONLY_POSTS = [/^\/api\/v1\/model\/records$/, /^\/api\/v1\/meshes\/batch$/, /^\/api\/v1\/element\/attributes$/];
const SENSITIVE_PARAM = /token|user|requester|pass|secret|key|login|auth/i;
const ROW_HEIGHT = 32;
const ROW_OVERSCAN = 10;

/** 记地址之前把像凭据、账号的查询参数的值打码 */
export function maskUrl(address) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return String(address);
  }
  let masked = false;
  for (const name of [...new Set(url.searchParams.keys())]) {
    if (!SENSITIVE_PARAM.test(name)) continue;
    url.searchParams.set(name, '***');
    masked = true;
  }
  return masked ? url.toString() : String(address);
}

/** 报错文字里夹着的地址：同样把那几种查询参数的值打码 */
export function maskText(text) {
  return String(text).replace(
    /([?&][^=&#\s"']*(?:token|user|requester|pass|secret|key|login|auth)[^=&#\s"']*=)[^&#\s"']*/gi,
    '$1***',
  );
}

/**
 * 浏览器进程的联网锁：不走系统代理，除 127.0.0.1 以外的主机一律解析不到——浏览器进程除了本机回环哪里都连不上。
 * 不按功能一个个去关（关不全，换个版本又多出来），直接让它解析不了别的地址。
 */
export const NETWORK_LOCK_ARGS = Object.freeze(['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1']);

const NETWORK_LOCKS = new WeakMap();

/** 本机上一个这一刻没人听的端口（占一下就放） */
function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * 验联网锁真的在起作用：另开一个空白上下文（不带闸门——闸门会抢在前面拦掉，验不到锁），访问三个不该连得上的地址，
 * 三个都应当是「解析不到」：
 *   回环上的另一个地址（127.0.0.2）—— 没放开的 IP 也挡住了；
 *   localhost —— 没放开的名字也挡住了（不锁的话浏览器自己就把它算成回环，不问网络）；
 *   一个保留的、永远解析不出来的外面名字（.invalid）—— 路上没有代理（走代理的话名字交给代理去查，这里就不是「解析不到」）。
 * 前两个的端口没人听。锁在起作用时浏览器一个包都不发；不起作用时，前两个只是连本机被拒，第三个最多是去查一个保留的名字。
 *
 * @param {import('playwright').Browser} browser
 * @returns {Promise<{ locked: boolean, probes: { what: string, outcome: string, locked: boolean }[] }>}
 */
export async function probeNetworkLock(browser) {
  const port = await unusedPort();
  const targets = [
    ['回环上的另一个地址', `http://127.0.0.2:${port}/`],
    ['localhost', `http://localhost:${port}/`],
    ['外面的名字（保留的 .invalid）', 'http://increment-web-lock-probe.invalid/'],
  ];
  const context = await browser.newContext();
  const probes = [];
  try {
    const page = await context.newPage();
    for (const [what, address] of targets) {
      let outcome = 'loaded';
      try {
        await page.goto(address, { timeout: 20000 });
      } catch (error) {
        outcome = /net::(ERR_[A-Z_]+)/.exec(String(error?.message ?? error))?.[1] ?? 'other-error';
      }
      probes.push({ what, outcome, locked: outcome === 'ERR_NAME_NOT_RESOLVED' });
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  return { locked: probes.every((probe) => probe.locked), probes };
}

/** 验联网锁：没起作用（或者验不成）就把浏览器关掉、报错；过了就记下结果（`networkLockOf` 取） */
export async function requireNetworkLock(browser) {
  let lock;
  try {
    lock = await probeNetworkLock(browser);
  } catch (error) {
    lock = { locked: false, probes: [], error: String(error?.message ?? error).split('\n')[0].slice(0, 300) };
  }
  if (!lock.locked) {
    await browser.close().catch(() => undefined);
    const seen = lock.error
      ? `验锁出错：${lock.error}`
      : lock.probes.filter((probe) => !probe.locked).map((probe) => `${probe.what}：${probe.outcome}`).join('；');
    throw new Error(`验收用的浏览器的联网锁没有起作用（${seen}），不往下跑`);
  }
  NETWORK_LOCKS.set(browser, lock);
  return lock;
}

/** 起验收用的浏览器。起来之后先验联网锁，没起作用就关掉、报错，不让调用方接着用 */
export async function launchBrowser({ headed = false, cacheDir, channel = 'chrome' } = {}) {
  const args = ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', ...NETWORK_LOCK_ARGS];
  if (cacheDir) args.push(`--disk-cache-dir=${cacheDir}`);
  const browser = await chromium.launch({ channel, headless: !headed, args });
  await requireNetworkLock(browser);
  return browser;
}

/** `launchBrowser` 起浏览器时验联网锁的结果（验了哪几个地址、各是什么结果） */
export function networkLockOf(browser) {
  return NETWORK_LOCKS.get(browser) ?? null;
}

/** 这段在页面里跑（每个新文档都装一遍）：读行、行的定时采样、记应用弹过的提示。只读 DOM，不动页面 */
function pageTools() {
  const tools = {
    watch: null,
    toasts: [],
    readRows(ids) {
      const out = {};
      for (const id of ids) {
        const row = document.querySelector(`[data-testid="model-tree-row"][data-refno="${id}"]`);
        if (!row) {
          out[id] = { present: false };
          continue;
        }
        const button = row.querySelector('[data-testid="model-tree-node-action"]');
        const status = row.querySelector('[data-testid="model-tree-status"]');
        const eye = row.querySelector('[data-testid="model-tree-eye"]');
        const icons = eye ? [...eye.querySelectorAll('svg')].map((svg) => svg.getAttribute('class') ?? '') : [];
        out[id] = {
          present: true,
          action: button?.getAttribute('data-action') ?? null,
          label: button?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
          busy: button?.getAttribute('data-busy') === 'true',
          nodeStatus: status?.getAttribute('data-node-status') ?? null,
          dbStatus: status?.getAttribute('data-db-status') ?? null,
          pending: !!row.querySelector('[data-testid="model-tree-node-action-pending"]'),
          eyeLit: icons.some((name) => /lucide-eye(?!-off)/.test(name)) && !icons.some((name) => name.includes('eye-off')),
          loading: eye?.getAttribute('data-loading') === 'true',
        };
      }
      return out;
    },
    startWatch(ids, intervalMs, heartbeatMs) {
      tools.stopWatch();
      const watch = { ids, startedAt: Date.now(), samples: [], ticks: 0, timer: null, lastKey: null, lastAt: 0 };
      const tick = () => {
        const rows = tools.readRows(ids);
        const now = Date.now();
        const key = JSON.stringify(rows);
        watch.ticks += 1;
        if (key === watch.lastKey && now - watch.lastAt < heartbeatMs) return;
        watch.samples.push({ t: now, rows });
        watch.lastKey = key;
        watch.lastAt = now;
      };
      tick();
      watch.timer = setInterval(tick, intervalMs);
      tools.watch = watch;
    },
    peekWatch() {
      return tools.watch ? tools.watch.samples : [];
    },
    stopWatch() {
      const watch = tools.watch;
      if (!watch) return null;
      clearInterval(watch.timer);
      tools.watch = null;
      const rows = tools.readRows(watch.ids);
      watch.samples.push({ t: Date.now(), rows });
      return { ids: watch.ids, startedAt: watch.startedAt, stoppedAt: Date.now(), ticks: watch.ticks, samples: watch.samples };
    },
  };
  window.__incrPml = tools;
  import('/src/ribbon/toastBus.ts').then((bus) => {
    bus.onToast((payload) => {
      tools.toasts.push({ t: Date.now(), level: payload.level ?? 'info', message: payload.message });
    });
  }).catch(() => undefined);
}

/**
 * 带闸门的浏览器上下文。`log` 里按时刻记着页面发出的全部请求、拦下的、发往现网端口的、报错和驱动做过的操作。
 *
 * @param {import('playwright').Browser} browser
 * @param {object} options
 * @param {string} options.pageOrigin 页面服务的地址
 * @param {string} options.backendOrigin 隔离后端的地址
 * @param {{ width: number, height: number }} [options.viewport]
 * @param {() => RegExp[]} [options.extraPosts] 这一刻额外放行的、发往隔离后端的 POST（按路径）
 */
export async function createGuardedContext(browser, options) {
  const pageOrigin = loopbackOrigin(options.pageOrigin, '页面服务的地址');
  const backendOrigin = loopbackOrigin(options.backendOrigin, '隔离后端的地址');
  const extraPosts = options.extraPosts ?? (() => []);
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const log = {
    pageOrigin,
    backendOrigin,
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
  };
  const livePorts = new Set(LIVE_PORTS.map(String));
  const count = (bucket, name) => {
    bucket[name] = (bucket[name] ?? 0) + 1;
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const t = Date.now();
    let url;
    try {
      url = new URL(request.url());
    } catch {
      log.requests.push({ t, method, url: request.url() });
      log.blocked.push({ t, method, url: request.url(), why: '地址读不出来' });
      return route.abort('blockedbyclient');
    }
    const shown = maskUrl(url.href);
    log.requests.push({ t, method, url: shown });
    if (livePorts.has(url.port)) {
      log.toLive.push({ t, method, url: shown });
      return route.abort('blockedbyclient');
    }
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.continue();
    const toBackend = url.origin === backendOrigin || (url.origin === pageOrigin && /^\/(api|files)\//.test(url.pathname));
    if (toBackend && method === 'POST') {
      if (READ_ONLY_POSTS.some((pattern) => pattern.test(url.pathname))) {
        count(log.allowedPost, url.pathname);
        return route.continue();
      }
      if (extraPosts().some((pattern) => pattern.test(url.pathname))) {
        count(log.extraPost, url.pathname);
        return route.continue();
      }
    }
    log.blocked.push({ t, method, url: shown, why: toBackend ? '发往隔离后端的写请求，不在放行名单里' : '发往别处的写请求' });
    return route.abort('blockedbyclient');
  });
  context.on('response', (response) => {
    if (response.status() < 400 || log.httpFailures.length >= 500) return;
    const failure = { t: Date.now(), status: response.status(), method: response.request().method(), url: maskUrl(response.url()) };
    log.httpFailures.push(failure);
    // 隔离后端回的错误，正文里有错误码和一句原因（同是 404，「节点找不到」和「读某个会话失败」是两回事）：
    // 连同这个请求等了多久一起留下，归类的时候用，不参与判定。
    if (!response.url().startsWith(`${backendOrigin}/`)) return;
    const waited = response.request().timing().responseStart;
    if (waited >= 0) failure.waitedMs = Math.round(waited);
    response.text().then((text) => {
      failure.body = maskText(text).slice(0, 600);
    }).catch(() => undefined);
  });
  await context.addInitScript(pageTools);
  return { context, log };
}

export async function newPage(context, log) {
  const page = await context.newPage();
  const livePorts = new Set(LIVE_PORTS.map(String));
  page.on('console', (message) => {
    if (message.type() !== 'error' || log.consoleErrors.length >= 500) return;
    const where = message.location()?.url;
    log.consoleErrors.push({ t: Date.now(), text: `${maskText(message.text()).slice(0, 400)}${where ? ` [${maskUrl(where)}]` : ''}` });
  });
  page.on('pageerror', (error) => {
    log.pageErrors.push({ t: Date.now(), text: maskText(String(error?.stack ?? error)).slice(0, 600) });
  });
  page.on('dialog', async (dialog) => {
    log.dialogs.push({ t: Date.now(), type: dialog.type(), message: maskText(dialog.message()).slice(0, 400) });
    await dialog.dismiss();
  });
  page.on('websocket', (socket) => {
    const t = Date.now();
    const shown = maskUrl(socket.url());
    let live = false;
    try {
      live = livePorts.has(new URL(socket.url()).port);
    } catch {
      live = false;
    }
    log.requests.push({ t, method: 'WS', url: shown });
    if (live) log.toLive.push({ t, method: 'WS', url: shown });
    log.websockets.push({ t, url: shown });
    socket.on('framereceived', (frame) => {
      if (!shown.includes('/api/v1/ws') || log.frames.length >= 2000) return;
      log.frames.push({ t: Date.now(), payload: maskText(String(frame.payload)).slice(0, 2000) });
    });
    socket.on('close', () => log.websockets.push({ t: Date.now(), url: shown, closed: true }));
  });
  return page;
}

/** 页面地址。`dtx_recenter=0`：场景按真坐标摆，包围盒才能和 E3D 导出的对 */
export function pageUrl({ pageOrigin, backendOrigin, project, query = {} }) {
  const params = new URLSearchParams({ output_project: project, gm_backend: backendOrigin, dtx_recenter: '0', ...query });
  return `${pageOrigin}/?${params.toString()}`;
}

/**
 * 在页面里反复问一个（可以是异步的）判断，直到它为真。不用 `page.waitForFunction`：它不等异步判断的结果——判断函数回的是
 * 一个 Promise，Promise 本身就算「真」，头一拍就放行（11-12 查出来的）。
 */
export async function waitInPage(page, predicate, arg, { timeoutMs = 120_000, intervalMs = 150, what = '页面里的条件' } = {}) {
  const from = Date.now();
  for (;;) {
    if (await page.evaluate(predicate, arg)) return Date.now() - from;
    if (Date.now() - from > timeoutMs) throw new Error(`等「${what}」超过 ${timeoutMs} 毫秒`);
    await sleep(intervalMs);
  }
}

export async function openApp(page, target) {
  await page.goto(pageUrl(target), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dtxViewer && !!window.__dtxLayer, null, { timeout: 180_000 });
  await page.waitForSelector('[data-testid="model-getwork-button"]', { timeout: 60_000 });
  await waitInPage(page, async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    return (treeStore.getModelTreeInstance()?.flatRows.value.length ?? 0) > 1;
  }, null, { timeoutMs: 120_000, intervalMs: 300, what: '模型树取到根' });
}

/** 等到没有任何装载在跑。刚点完一个会触发装载的按钮时，装载要过一两百毫秒才开始：调用方先等一等再来问 */
export async function waitIdle(page, timeoutMs = 300_000) {
  await waitInPage(page, async () => {
    const sessions = await import('/src/composables/modelLoadSession.ts');
    return !sessions.hasActiveModelLoad();
  }, null, { timeoutMs, what: '装载结束' });
}

/** 等这个节点装进场景、而且装载已经结束 */
export async function waitRootLoaded(page, root, timeoutMs = 120_000) {
  await waitInPage(page, async ({ refno, dbnum }) => {
    const [generation, sessions] = await Promise.all([
      import('/src/composables/useModelGeneration.ts'),
      import('/src/composables/modelLoadSession.ts'),
    ]);
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
    return gen.isRootInScene(refno, dbnum) && !sessions.hasActiveModelLoad();
  }, { refno: refnoKey(root.refno), dbnum: root.dbnum }, { timeoutMs, what: `节点 ${root.refno} 装完` });
}

function touched(log, what) {
  log.interactions.push({ t: Date.now(), what });
}

/** 把这几个节点展开（连同一路上的上级）：它们的成员那一层从此算页面「取过的层」 */
export async function expandTree(page, log, ids) {
  touched(log, `展开模型树：${ids.join('、')}`);
  await page.evaluate(async (list) => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const tree = treeStore.getModelTreeInstance();
    for (const id of list) await tree.expandPathToNode(id, { expandSelf: true });
  }, ids.map(refnoKey));
}

/** 让模型树滚到这一行（选中它；树是虚拟列表，不在视口里的行不画） */
export async function locateRow(page, log, refno) {
  const id = refnoKey(refno);
  touched(log, `选中并滚到 ${id}`);
  await page.evaluate(async (target) => {
    const selection = await import('/src/composables/useSelectionStore.ts');
    selection.setGlobalSelectedRefno(target);
  }, id);
  const row = page.locator(`[data-testid="model-tree-row"][data-refno="${id}"]`);
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  return row;
}

export async function clickEye(page, log, refno) {
  const row = await locateRow(page, log, refno);
  touched(log, `点 ${refnoKey(refno)} 的眼睛`);
  await row.locator('[data-testid="model-tree-eye"]').click();
}

/** 从树上逐个点眼睛装节点，前一个装完再点下一个（两次装载重叠会装出重复的对象） */
export async function loadRoots(page, log, roots) {
  for (const root of roots) {
    await clickEye(page, log, root.refno);
    await waitRootLoaded(page, root);
  }
  await sleep(800);
  await waitIdle(page);
}

/** 点「取最新」，等它做完，回这一次的回执 */
export async function clickGetWork(page, log, timeoutMs = 240_000) {
  const readState = () => page.evaluate(async () => {
    const getWork = await import('/src/composables/useModelGetWork.ts');
    const state = getWork.useModelGetWork().state;
    return {
      running: state.running,
      progress: state.progress,
      finishedAt: state.last?.finishedAt ?? 0,
      last: state.last ? JSON.parse(JSON.stringify(state.last)) : null,
    };
  });
  const before = (await readState()).finishedAt;
  const clickedAt = Date.now();
  touched(log, '点「取最新」');
  await page.click('[data-testid="model-getwork-button"]');
  for (;;) {
    const state = await readState();
    if (!state.running && state.finishedAt > before) {
      const ms = Date.now() - clickedAt;
      await sleep(300);
      await waitIdle(page);
      return { clickedAt, ms, receipt: state.last };
    }
    if (Date.now() - clickedAt > timeoutMs) throw new Error(`取最新 ${timeoutMs} 毫秒没做完（${state.progress}）`);
    await sleep(100);
  }
}

/** 这几行此刻的样子（只读已经画出来的行；没画出来的是 `present: false`） */
export async function readRows(page, ids) {
  return page.evaluate((list) => window.__incrPml.readRows(list), ids.map(refnoKey));
}

/**
 * 等这几行都定下来（不在核对、不在装载）再读。`loaded` 里的行是装着的节点，行上还没有新旧标记也算没定。
 * 到时限还没定就照最后一次读到的回，`settled` 为假。
 */
export async function readSettledRows(page, ids, { loaded = ids, timeoutMs = 60_000, pollMs = 300 } = {}) {
  const mustHaveStatus = new Set(loaded.map(refnoKey));
  const from = Date.now();
  for (;;) {
    const rows = await readRows(page, ids);
    const unsettled = Object.entries(rows).filter(([id, row]) => {
      if (!row.present) return false;
      if (row.pending || row.busy || row.loading) return true;
      if (row.nodeStatus === 'checking' || row.nodeStatus === 'updating') return true;
      return row.nodeStatus === null && mustHaveStatus.has(id);
    }).map(([id]) => id);
    if (unsettled.length === 0 || Date.now() - from > timeoutMs) {
      return { rows, settled: unsettled.length === 0, unsettled, waitedMs: Date.now() - from };
    }
    await sleep(pollMs);
  }
}

/**
 * 把要看的行都摆进模型树画出来的范围（视口上下各多画 10 行），之后不滚动就能一直读到它们。摆不下就加高窗口，还摆不下就抛错。
 * 行组件挂着才盯它所在库的状态，所以 W1 期间这些行得一直挂着：存盘之前摆好，存盘之后不再动。
 * `allowMissing`：树上已经没有的行（节点被删了）跳过，列在 `missing` 里，不抛错。
 */
export async function arrangeRows(page, log, ids, { maxHeight = 3200, allowMissing = false } = {}) {
  const asked = ids.map(refnoKey);
  const measure = () => page.evaluate((list) => {
    const hook = window.__plant3dModelTreeE2E;
    const indices = {};
    let rows = 0;
    for (const id of list) {
      const snapshot = hook.getSnapshot(id);
      indices[id] = snapshot.targetIndex;
      rows = snapshot.flatRowCount;
    }
    let scroller = document.querySelector('[data-testid="model-tree-row"]')?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    return { indices, rows, clientHeight: scroller?.clientHeight ?? 0, scrollTop: scroller?.scrollTop ?? 0, hasScroller: !!scroller };
  }, asked);

  let info = await measure();
  const missing = asked.filter((id) => !(info.indices[id] >= 0));
  if (missing.length > 0 && !allowMissing) throw new Error(`模型树的行里没有 ${missing.join('、')}（上级没展开？）`);
  const wanted = asked.filter((id) => info.indices[id] >= 0);
  if (wanted.length === 0) {
    return { indices: info.indices, treeRows: info.rows, span: 0, containerHeight: info.clientHeight, resizedTo: null, rows: {}, missing };
  }
  if (!info.hasScroller) throw new Error('没找到模型树的滚动容器');
  const positions = wanted.map((id) => info.indices[id]);
  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const span = last - first + 1;
  // 第一行摆在视口顶上往下一行：视口里的行加下面多画的 10 行装得下才算摆得下（留 2 行余量）
  const room = ROW_OVERSCAN - 2;
  const fits = (clientHeight) => span <= Math.floor(clientHeight / ROW_HEIGHT) + room;
  const viewport = page.viewportSize();
  let resizedTo = null;
  if (!fits(info.clientHeight)) {
    const need = (span - room) * ROW_HEIGHT;
    const height = viewport.height + (need - info.clientHeight) + ROW_HEIGHT;
    if (height > maxHeight) {
      throw new Error(`要看的行在树上跨 ${span} 行，窗口加高到 ${maxHeight} 也摆不下（要 ${height}）`);
    }
    touched(log, `窗口加高到 ${height}（要看的行跨 ${span} 行）`);
    await page.setViewportSize({ width: viewport.width, height });
    await sleep(400);
    resizedTo = height;
    info = await measure();
  }
  touched(log, '滚动模型树，把要看的行摆进画出来的范围');
  await page.evaluate((top) => {
    let scroller = document.querySelector('[data-testid="model-tree-row"]')?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (scroller) scroller.scrollTop = top;
  }, Math.max(0, (first - 1) * ROW_HEIGHT));
  await sleep(400);
  const rows = await readRows(page, wanted);
  const absent = wanted.filter((id) => rows[id]?.present !== true);
  if (absent.length > 0) throw new Error(`摆完之后还有行没画出来：${absent.join('、')}（跨 ${span} 行，容器高 ${info.clientHeight}）`);
  return { indices: info.indices, treeRows: info.rows, span, containerHeight: info.clientHeight, resizedTo, rows, missing };
}

/** 开始在页面里定时采这几行（行变了就记一笔，没变也隔一阵记一笔）。先用 `arrangeRows` 摆好 */
export async function startRowWatch(page, ids, { intervalMs = 250, heartbeatMs = 2000 } = {}) {
  await page.evaluate(({ list, interval, heartbeat }) => window.__incrPml.startWatch(list, interval, heartbeat), {
    list: ids.map(refnoKey),
    interval: intervalMs,
    heartbeat: heartbeatMs,
  });
}

export async function stopRowWatch(page) {
  return page.evaluate(() => window.__incrPml.stopWatch());
}

function rowShows(row, want) {
  if (!row || row.present === false) return false;
  if (want.nodeStatus && !want.nodeStatus.includes(row.nodeStatus ?? null)) return false;
  if (want.action && !want.action.includes(row.action ?? null)) return false;
  return true;
}

/**
 * 存盘之后等行上出信号：只读采样器已经记下的东西，不碰页面。受影响的行都出了预期的信号（或到了时限）就停，再多采 `settleMs`
 * 让不受影响的行有定下来的最后一笔。没有受影响的行时只等 `quietMs`。
 *
 * @param {import('playwright').Page} page
 * @param {object} options
 * @param {Record<string, { nodeStatus?: string[], action?: string[] }>} options.affected
 * @param {number} options.startAt 存盘完成的时刻
 * @param {number} options.windowMs 时限
 */
export async function waitRowSignal(page, { affected, startAt, windowMs, settleMs = 3000, quietMs = 30_000, pollMs = 500 }) {
  const wants = Object.entries(affected ?? {}).map(([id, want]) => [refnoKey(id), want]);
  let seen = false;
  if (wants.length === 0) {
    await sleep(Math.max(0, startAt + quietMs - Date.now()));
  } else {
    for (;;) {
      const samples = (await page.evaluate(() => window.__incrPml.peekWatch())).filter((sample) => sample.t >= startAt);
      seen = wants.every(([id, want]) => samples.some((sample) => rowShows(sample.rows[id], want)));
      if (seen || Date.now() - startAt > windowMs) break;
      await sleep(pollMs);
    }
  }
  await sleep(settleMs);
  return { seen, waitedMs: Date.now() - startAt };
}

/**
 * 场景里的全部对象，按库、按构件收：世界矩阵（列主序，mm）、可见不可见、世界包围盒（mm；场景给的是米，乘 `sceneToMm`）。
 * 隐式管段仍归在属主构件名下（渲染和合盒不变），另外在 `tubeBoxes` 里按 `tube:<属主>#<FTUBE n>` 逐件收一份。
 * 哪个库都不认的对象记在 `unresolved`。
 */
export async function readScene(page, dbnums, { sceneToMm = 1000 } = {}) {
  return page.evaluate(async ({ libs, scale }) => {
    const loader = await import('/src/composables/useDbnoInstancesDtxLoader.ts');
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const layer = window.__dtxLayer;
    const objectIds = layer?.getAllObjectIds?.() ?? [];
    const byDbnum = {};
    for (const dbno of libs) byDbnum[dbno] = {};
    // 属主成员表：给隐式管段排 FTUBE n（属主自己由加载器排在最前，这里只送子成员）。没展开的层没有成员，那些段退回按槽位和装入先后排。
    const isRefno = (id) => /^\d+_\d+$/.test(id);
    const nodes = treeStore.getModelTreeInstance()?.nodesById.value ?? {};
    const membersByOwner = {};
    for (const [id, node] of Object.entries(nodes)) {
      if (!isRefno(id)) continue;
      const children = (node.childrenIds ?? []).filter(isRefno);
      if (children.length > 0) membersByOwner[id] = children;
    }
    let unresolved = 0;
    for (const objectId of objectIds) {
      let placed = false;
      for (const dbno of libs) {
        const refno = loader.resolveDtxRefnoByObjectId(dbno, objectId);
        if (!refno) continue;
        const matrix = layer.getObjectMatrix(objectId);
        const bounds = layer.getObjectBoundingBox?.(objectId) ?? null;
        const box = bounds && !bounds.isEmpty()
          ? [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].map((value) => value * scale)
          : null;
        (byDbnum[dbno][refno] ??= []).push({
          id: objectId,
          m: matrix ? Array.from(matrix.elements) : null,
          visible: !!layer.isObjectVisible(objectId),
          box,
          // 带直段身份的隐式管段。构件合盒照旧算在属主名下；逐件盒另按 tube:<属主>#<FTUBE n> 收。
          implicitTube: !!loader.describeDtxImplicitTube(dbno, objectId),
        });
        placed = true;
        break;
      }
      if (!placed) unresolved += 1;
    }
    const tubeBoxes = {};
    if (layer) {
      for (const dbno of libs) {
        tubeBoxes[dbno] = loader.collectImplicitTubeCompareBoxes(layer, Number(dbno), membersByOwner, scale);
      }
    }
    return { at: Date.now(), objects: objectIds.length, unresolved, byDbnum, tubeBoxes };
  }, { libs: dbnums, scale: sceneToMm });
}

/**
 * 相机的位姿：位置、看向的点（控制器的目标点）、朝向（四元数）、视场角、缩放。位置和目标点是场景自己的单位。
 * 相机飞过去是一段动画（查看器的 `flyTo` 缺省 800 毫秒），读在半路上幅度就不准：在页面里隔 50 毫秒看一眼，连着 `restMs`
 * 没动才算停住（`atRest`）；等了 `timeoutMs` 还在动，就记最后看到的那一帧，`atRest` 是 `false`。「没动」允许浮点的零头：
 * 控制器每帧都把位置重算一遍，静止的相机最后一位也会跳。
 * 只是记下来看的，不进判定。页面上没有查看器时返回 `null`。
 */
export async function readCamera(page, { restMs = 300, timeoutMs = 3000 } = {}) {
  return page.evaluate(async ({ rest, limit }) => {
    const viewer = window.__dtxViewer;
    const camera = viewer?.camera;
    if (!camera) return null;
    const pose = () => {
      const target = viewer.controls?.target ?? null;
      return {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: target ? [target.x, target.y, target.z] : null,
        quaternion: [camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w],
        fov: camera.fov ?? null,
        zoom: camera.zoom ?? null,
      };
    };
    const numbers = (item) => [...item.position, ...(item.target ?? []), ...item.quaternion, item.fov ?? 0, item.zoom ?? 0];
    const still = (a, b) => {
      const from = numbers(a);
      const to = numbers(b);
      return from.length === to.length && from.every((value, index) => Math.abs(value - to[index]) <= 1e-9 * Math.max(1, Math.abs(value)));
    };
    const startedAt = Date.now();
    let last = pose();
    let stillSince = startedAt;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const now = Date.now();
      const next = pose();
      if (!still(last, next)) stillSince = now;
      last = next;
      const atRest = now - stillSince >= rest;
      if (atRest || now - startedAt >= limit) return { at: now, ...last, atRest, waitedMs: now - startedAt };
    }
  }, { rest: restMs, limit: timeoutMs });
}

/**
 * 两次相机位姿差多少：位置、看向的点各挪了多远（场景单位），朝向转了多少度，相机离看向的点前后各多远，视场角、缩放变没变。
 * 超出舍入误差就算动了。有一次没读到（或者读到的不成形）时 `moved` 是 `null`（不知道），不抛错。
 */
export function cameraChange(before, after, { distanceEps = 1e-6, angleEpsDeg = 1e-3 } = {}) {
  const numbers = (value, length) => Array.isArray(value) && value.length === length && value.every((item) => Number.isFinite(item));
  const usable = (pose) => !!pose && numbers(pose.position, 3) && numbers(pose.quaternion, 4) && (pose.target === null || numbers(pose.target, 3));
  if (!usable(before) || !usable(after)) {
    return { moved: null, positionBy: null, targetBy: null, turnedDeg: null, viewDistance: { before: null, after: null }, fovChanged: null, zoomChanged: null };
  }
  const distance = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null);
  const positionBy = distance(before.position, after.position);
  const targetBy = distance(before.target, after.target);
  // q 和 -q 是同一个朝向，所以取点积的绝对值；一模一样时直接算 0（反余弦在 1 附近会带出舍入的零头）
  const sameTurn = before.quaternion.every((value, index) => value === after.quaternion[index]);
  const dot = Math.abs(before.quaternion.reduce((sum, value, index) => sum + value * after.quaternion[index], 0));
  const turnedDeg = sameTurn ? 0 : (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
  const fovChanged = before.fov !== after.fov;
  const zoomChanged = before.zoom !== after.zoom;
  const targetKnown = (before.target === null) === (after.target === null);
  const moved = positionBy > distanceEps || (targetBy ?? 0) > distanceEps || !targetKnown || turnedDeg > angleEpsDeg || fovChanged || zoomChanged;
  const viewDistance = { before: distance(before.position, before.target), after: distance(after.position, after.target) };
  return { moved, positionBy, targetBy, turnedDeg, viewDistance, fovChanged, zoomChanged };
}

/** 页面自己的账：各根名下装了哪些构件、已加载节点表、取最新的登记表和上一次的回执、弹过的提示 */
export async function readPageState(page, roots) {
  return page.evaluate(async (wanted) => {
    const [getWork, loadedNodes, registry, generation] = await Promise.all([
      import('/src/composables/useModelGetWork.ts'),
      import('/src/composables/useLoadedNodeStatus.ts'),
      import('/src/composables/modelGetWorkRegistry.ts'),
      import('/src/composables/useModelGeneration.ts'),
    ]);
    const gen = generation.useModelGeneration({ viewer: { __dtxLayer: window.__dtxLayer } });
    const state = getWork.useModelGetWork().state;
    return {
      at: Date.now(),
      roots: wanted.map(({ refno, dbnum }) => ({
        refno,
        dbnum,
        members: gen.loadedRefnosOf(refno, dbnum),
        inScene: gen.isRootInScene(refno, dbnum),
      })),
      loadedTable: loadedNodes.useLoadedNodeStatus().entries().map((entry) => ({
        refno: entry.refno,
        dbnum: entry.dbnum,
        loaded: entry.loaded,
        modelSesno: entry.loadedModelSesno,
        fileLatestSesno: entry.loadedFileLatestSesno,
        verdict: entry.status?.verdict ?? null,
        staleReason: entry.staleReason ?? null,
        checking: entry.checking,
      })),
      registry: registry.getWorkRegisteredRoots(),
      getWork: { running: state.running, progress: state.progress, last: state.last ? JSON.parse(JSON.stringify(state.last)) : null },
      resultText: document.querySelector('[data-testid="model-getwork-result"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      toasts: [...(window.__incrPml?.toasts ?? [])],
    };
  }, roots.map((root) => ({ refno: refnoKey(root.refno), dbnum: root.dbnum })));
}

/**
 * 页面上的模型树：参考号 → 名字、类型、上级、成员。只收参考号样子的节点。
 *
 * `childrenIds`：取过成员的层是数组（取过、但一个成员都没有的层是空数组），没取过的是 `null`。页面只对外给「取过成员的层」有几层，
 * 不给是哪几层，空层靠两样认：它展开着（展开一个节点就会取它的成员）；或者这一场页面会话里以前认过它是取过的层——页面的规则是
 * 取过的层只要节点还在树上就一直算（`pdmsTreeRefresh`），成员后来删光了「取最新」也照样重取它。认过的层记在页面里
 * （`window.__incrPml.fetchedLayers`），页面重新载入时跟页面自己的记录一起清掉。没展开、被预取过的空层认不出来，由层数的核对
 * （`layerCounts`）拦下。
 */
export async function readTree(page) {
  return page.evaluate(async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const tree = treeStore.getModelTreeInstance();
    const nodes = tree?.nodesById.value ?? {};
    const expanded = tree?.expandedIds.value ?? new Set();
    const isRefno = (id) => /^\d+_\d+$/.test(id);
    const store = (window.__incrPml ??= {});
    const known = (store.fetchedLayers ??= new Set());
    for (const id of [...known]) if (!nodes[id]) known.delete(id);
    const out = {};
    for (const [id, node] of Object.entries(nodes)) {
      if (!isRefno(id)) continue;
      const children = (node.childrenIds ?? []).filter(isRefno);
      if (children.length > 0 || expanded.has(id)) known.add(id);
      out[id] = {
        name: node.name ?? '',
        type: node.type ?? '',
        parentId: node.parentId && isRefno(node.parentId) ? node.parentId : null,
        childrenIds: known.has(id) ? children : null,
      };
    }
    return out;
  });
}

/** 页面树上取过成员的那些层（取过、但一个成员都没有的层也算：页面「取最新」时照样重取它们） */
export function fetchedLayers(tree) {
  return Object.entries(tree).filter(([, node]) => Array.isArray(node.childrenIds)).map(([id]) => id).sort();
}

/** 页面树上不是参考号的节点（最上面的库、分组之类）：`readTree` 不收它们，这里列出来给报告看 */
export async function readTreeTops(page) {
  return page.evaluate(async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const nodes = treeStore.getModelTreeInstance()?.nodesById.value ?? {};
    const isRefno = (id) => /^\d+_\d+$/.test(id);
    return Object.entries(nodes).filter(([id]) => !isRefno(id)).map(([id, node]) => ({
      id,
      name: node.name ?? '',
      type: node.type ?? '',
      parentId: node.parentId ?? null,
      children: (node.childrenIds ?? []).length,
    }));
  });
}

/**
 * 页面自己记的「取过成员的层」有几层（「取最新」重取的就是这些层）。取过、但一个成员都没有的层也算在里面——`readTree` 靠展开状态和
 * 以前认过的记录认它们，认漏了两边的数就对不上，说明脚本对账的层比页面少。读不到回 `null`。
 */
export async function readLoadedLayerCount(page) {
  return page.evaluate(async () => {
    const treeStore = await import('/src/composables/useModelTreeStore.ts');
    const tree = treeStore.getModelTreeInstance();
    return typeof tree?.loadedLayerCount === 'function' ? tree.loadedLayerCount() : null;
  });
}

/**
 * 脚本认出的层和页面自己记的层数对不对得上。页面记的 = 参考号层 + 最上面不是参考号、有成员的层；页面多出来的要是比最上面那几层还多，
 * 就是有取过的层脚本没认出来，这时按脚本认的层去算「树该怎么变」会漏（页面照样重取那几层）。
 *
 * @param {import('playwright').Page} page
 * @param {Record<string, { childrenIds?: string[] | null }>} tree `readTree` 的结果
 */
export async function layerCounts(page, tree) {
  const refnoLayers = fetchedLayers(tree).length;
  const topLayers = (await readTreeTops(page)).filter((node) => node.children > 0).length;
  const pageLoadedLayers = await readLoadedLayerCount(page);
  const ok = pageLoadedLayers !== null && pageLoadedLayers >= refnoLayers && pageLoadedLayers - refnoLayers <= topLayers;
  return { ok, refnoLayers, topLayers, pageLoadedLayers };
}

function unionBox(boxes) {
  if (boxes.length === 0) return null;
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      out[axis] = Math.min(out[axis], box[axis]);
      out[axis + 3] = Math.max(out[axis + 3], box[axis + 3]);
    }
  }
  return out;
}

function tubeOwnerKey(compareKey) {
  const match = /^tube:([^#]+)#\d+$/.exec(String(compareKey));
  return match ? refnoKey(match[1]) : null;
}

/**
 * 把 `readScene` 的结果按根分好，给判定函数用：根 → 构件 → 对象（`byRoot`），根 → 构件 → 可见对象合起来的包围盒（`boxes`）。
 * `perItemBoxes` 是逐件盒：普通构件仍按参考号；纯由隐式管段组成的属主不再留合盒，改成 `tube:<属主>#<FTUBE n>`。
 * `boxes` 始终是构件合盒，count-union 和「跟用例表对平移」继续用它。
 *
 * 一个构件归哪个根：页面说这个根名下装着它（`roots[].members`），或者调用方说后端记录里这个根名下有它（`claims`）。
 * 场景里有对象、却哪个根都不认的构件列在 `strays`（库 → 构件 → 对象数）：不归到哪个根名下，由调用方单独报。
 *
 * @param {object} input
 * @param {{ byDbnum: Record<string, Record<string, object[]>>, tubeBoxes?: Record<string, Record<string, number[]>> }} input.scene
 * @param {{ refno: string, dbnum: number, members?: string[] | null }[]} input.roots
 * @param {Record<string, string[]>} [input.claims]
 */
export function sceneByRoot({ scene, roots, claims = {} }) {
  const byRoot = {};
  const boxes = {};
  const perItemBoxes = {};
  const claimed = {};
  for (const root of roots) {
    const id = refnoKey(root.refno);
    const components = new Set([...(root.members ?? []), ...(claims[id] ?? [])].map(refnoKey));
    const objects = scene.byDbnum[root.dbnum] ?? {};
    const mine = (claimed[root.dbnum] ??= new Set());
    byRoot[id] = {};
    boxes[id] = {};
    for (const component of components) {
      mine.add(component);
      const list = objects[component] ?? [];
      if (list.length === 0) continue;
      byRoot[id][component] = list.map((object) => ({ m: object.m, visible: object.visible }));
      const box = unionBox(list.filter((object) => object.visible && object.box).map((object) => object.box));
      if (box) boxes[id][component] = box;
    }
    const perItem = { ...boxes[id] };
    for (const component of components) {
      const visible = (objects[component] ?? []).filter((object) => object.visible && object.box);
      const rest = visible.filter((object) => object.implicitTube !== true);
      if (rest.length === 0) delete perItem[component];
      else if (rest.length !== visible.length) perItem[component] = unionBox(rest.map((object) => object.box));
    }
    const tubeBoxes = scene.tubeBoxes?.[root.dbnum] ?? scene.tubeBoxes?.[String(root.dbnum)] ?? {};
    for (const [key, box] of Object.entries(tubeBoxes)) {
      const owner = tubeOwnerKey(key);
      if (!owner || !components.has(owner)) continue;
      if (!Array.isArray(box) || box.length !== 6) continue;
      perItem[key] = box;
    }
    perItemBoxes[id] = perItem;
  }
  const strays = {};
  for (const [dbnum, objects] of Object.entries(scene.byDbnum)) {
    const extra = Object.keys(objects).filter((component) => !claimed[dbnum]?.has(component));
    if (extra.length > 0) strays[dbnum] = Object.fromEntries(extra.map((component) => [component, objects[component].length]));
  }
  return { byRoot, boxes, perItemBoxes, strays };
}

/**
 * 从闸门的记录里切出一段时间，拼成 W6 的输入。
 *
 * @param {object} log `createGuardedContext` 的 `log`
 * @param {object} options
 * @param {number} [options.from]
 * @param {number} [options.to]
 * @param {{ pattern: string, reason: string }[]} [options.ignoreErrors]
 */
export function cleanlinessInput(log, { from = 0, to = Infinity, ignoreErrors = [] } = {}) {
  const within = (item) => item.t >= from && item.t < to;
  return {
    allowedOrigins: [log.pageOrigin, log.backendOrigin],
    requests: log.requests.filter(within).map(({ method, url }) => ({ method, url })),
    toLive: log.toLive.filter(within).map(({ method, url }) => ({ method, url })),
    blocked: log.blocked.filter(within),
    consoleErrors: log.consoleErrors.filter(within).map((item) => item.text),
    pageErrors: log.pageErrors.filter(within).map((item) => item.text),
    ignoreErrors,
  };
}

/** 一段时间里页面的请求按去向汇总（给报告看的，不是判定的依据） */
export function requestSummary(log, { from = 0, to = Infinity } = {}) {
  const within = (item) => item.t >= from && item.t < to;
  const byOrigin = {};
  const backendPaths = {};
  for (const item of log.requests.filter(within)) {
    let origin = '（读不出来）';
    let path = null;
    try {
      const url = new URL(item.url);
      origin = url.protocol === 'data:' || url.protocol === 'blob:' ? url.protocol : url.host;
      if (url.origin === log.backendOrigin) path = `${item.method} ${url.pathname}`;
    } catch {
      path = null;
    }
    byOrigin[origin] = (byOrigin[origin] ?? 0) + 1;
    if (path) backendPaths[path] = (backendPaths[path] ?? 0) + 1;
  }
  return {
    total: log.requests.filter(within).length,
    byOrigin,
    backendPaths,
    toLive: log.toLive.filter(within).length,
    blocked: log.blocked.filter(within).length,
    httpFailures: log.httpFailures.filter(within).map(({ status, method, url }) => `${status} ${method} ${url}`),
    allowedPost: { ...log.allowedPost },
    extraPost: { ...log.extraPost },
    websockets: log.websockets.filter(within).map(({ url, closed }) => `${closed ? '关' : '开'} ${url}`),
  };
}
