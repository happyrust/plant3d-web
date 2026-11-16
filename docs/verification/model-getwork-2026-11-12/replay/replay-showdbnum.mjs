/**
 * 「取最新」真实增量回放·整库显示：页面用 show_dbnum=8000 把整个库装进来（每个顶层 SITE 登记成一个在册节点），
 * 然后库文件真的往前推——先是一个新建整个 SITE 的 E3D 会话，再是几步小改动——看取最新把新 SITE 装进来、
 * 已装的 SITE 跟上，并量一下「库的模型水位一动，在册的 SITE 各重载一次」到底要多久。
 *
 *   node replay-showdbnum.mjs
 *
 * 沙箱要先恢复到 8000 库会话 1528（reset-sandbox.ps1 -Base8000 1528）。护栏同 replay-verify.mjs。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import { Matrix4, Quaternion, Vector3 } from 'three';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
mkdirSync(OUT, { recursive: true });
const FRONT = 'http://127.0.0.1:3103';
const BACKEND = 'http://127.0.0.1:9199';
const LIVE_PORTS = new Set(['8022', '8009']);
const DBNUM = 8000;
const FIXTURE = path.join(HERE, 'bin', 'db_session_fixture.debug-20261112.exe');
const WORK = path.join(HERE, 'projects', 'E3D3.1', 'AvevaMarineSample', 'ams000', 'ams8000_0001');
const SOURCE = path.join(HERE, 'finals', 'ams8000_0001.sesno1865');
const NEW_SITE = '24384_47462';

const v1 = (refno) => String(refno).replace('_', '/');
const key = (refno) => String(refno ?? '').trim().replace('/', '_');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);

// 同一时间只许一个回放脚本动沙箱的库文件（2026-11-12 撞到过同一条命令被执行了两遍，第二遍把第一遍的库文件推乱了）
const LOCK = path.join(OUT, 'replay.lock');
if (existsSync(LOCK)) {
  const owner = Number(readFileSync(LOCK, 'utf8'));
  let alive = false;
  try { process.kill(owner, 0); alive = true; } catch { alive = false; }
  if (alive) {
    console.error(`另一个回放脚本（进程 ${owner}）正在跑，这一个不跑`);
    process.exit(9);
  }
}
writeFileSync(LOCK, String(process.pid), 'utf8');
process.on('exit', () => { try { if (readFileSync(LOCK, 'utf8') === String(process.pid)) unlinkSync(LOCK); } catch { /* 已经没了 */ } });

async function backendFetch(pathAndQuery, init) {
  const response = await fetch(BACKEND + pathAndQuery, init);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

async function backendRow() {
  const { body } = await backendFetch('/api/v1/dbnums');
  const row = (body.dbnums ?? []).find((item) => item.dbnum === DBNUM);
  return row ? { file: row.file_latest_sesno, applied: row.applied_sesno, model: row.model_sesno, roots: row.model_caught_up_roots } : null;
}

async function recordsOf(refno) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < 200; page += 1) {
    const payload = { generation_root: v1(refno), limit: 5000 };
    if (cursor !== null) payload.cursor = cursor;
    const { status, body } = await backendFetch('/api/v1/model/records', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (status !== 200) throw new Error(`记录接口 ${status}（${refno}）：${JSON.stringify(body).slice(0, 200)}`);
    items.push(...(body.items ?? []));
    cursor = body.next_cursor ?? null;
    if (cursor === null) return items;
  }
  throw new Error(`记录翻页太多（${refno}）`);
}

function matricesOf(item) {
  const compose = (transform) => {
    const t = transform ?? {};
    return new Matrix4().compose(new Vector3(...(t.translation ?? [0, 0, 0])), new Quaternion(...(t.rotation ?? [0, 0, 0, 1])).normalize(), new Vector3(...(t.scale ?? [1, 1, 1])));
  };
  return (item.insts ?? []).filter((inst) => String(inst.geo_hash ?? '').trim()).map((inst) => compose(item.world_trans).multiply(compose(inst.transform)).toArray());
}

const matrixClose = (a, b) => a.length === 16 && b.length === 16 && a.every((value, index) => Math.abs(value - b[index]) <= 0.05 + 1e-4 * Math.max(Math.abs(value), Math.abs(b[index])));

/** 后端此刻 8000 库的全部：每个顶层 SITE、它名下每个子节点的记录（整 SITE 一发在服务端太重，按子节点分着问） */
async function snapshotLibrary() {
  const startedAt = Date.now();
  const roots = (await backendFetch('/api/v1/tree/roots')).body.nodes.filter((node) => node.dbnum === DBNUM && node.noun === 'SITE');
  const sites = [];
  const expected = new Map();
  for (const site of roots) {
    const children = (await backendFetch(`/api/v1/tree/children?refno=${encodeURIComponent(v1(site.refno))}`)).body.nodes ?? [];
    let count = 0;
    for (const child of children) {
      for (const item of await recordsOf(child.refno)) {
        const matrices = matricesOf(item);
        if (matrices.length === 0) continue;
        const id = key(item.refno);
        expected.set(id, [...(expected.get(id) ?? []), ...matrices]);
        count += 1;
      }
    }
    sites.push({ refno: key(site.refno), name: site.name, zones: children.length, records: count });
  }
  return { sites, expected, row: await backendRow(), ms: Date.now() - startedAt };
}

function replayStep(to) {
  const run = spawnSync(FIXTURE, ['replay-step', '--source', SOURCE, '--work', WORK, '--to', String(to)], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`replay-step → ${to} 失败：${run.stderr || run.stdout}`);
  return Date.now();
}

async function waitCaughtUp(to, since, timeoutMs = 420_000) {
  let last = null;
  while (Date.now() - since < timeoutMs) {
    last = await backendRow();
    if (last && last.file === to && last.applied === to && last.model === to) return { ok: true, ms: Date.now() - since, row: last };
    await sleep(300);
  }
  return { ok: false, ms: Date.now() - since, row: last };
}

const checks = [];
function check(step, name, pass, detail = '') {
  checks.push({ step, name, pass: !!pass, detail: String(detail).slice(0, 1500) });
  console.log(`  ${pass ? '✓' : '✗'} [${step}] ${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: process.env.PAGE_HEADED !== '1', args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling', `--disk-cache-dir=${path.join(HERE, 'tmp', 'chrome-cache')}`] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
const log = { toLive: [], blocked: [], allowedPost: {}, requests: 0, timings: [] };
const startedAt = new Map();
await context.route('**/*', (route) => {
  const request = route.request();
  let url;
  try { url = new URL(request.url()); } catch { return route.continue(); }
  if (LIVE_PORTS.has(url.port)) { log.toLive.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient'); }
  if (url.origin !== BACKEND && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/files/')) return route.continue();
  const method = request.method().toUpperCase();
  if (url.origin === BACKEND) log.requests += 1;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const allowed = url.origin === BACKEND && method === 'POST' && /^\/api\/v1\/(model\/records|meshes\/batch|element\/attributes)$/.test(url.pathname);
    if (!allowed) { log.blocked.push(`${method} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient'); }
    log.allowedPost[url.pathname] = (log.allowedPost[url.pathname] ?? 0) + 1;
  }
  return route.continue();
});
context.on('request', (request) => { if (request.url().startsWith(BACKEND)) startedAt.set(request, Date.now()); });
const finish = (request) => {
  const from = startedAt.get(request);
  if (from === undefined) return;
  startedAt.delete(request);
  log.timings.push({ at: from, ms: Date.now() - from, path: new URL(request.url()).pathname, method: request.method() });
};
context.on('requestfinished', finish);
context.on('requestfailed', finish);
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

async function readPage() {
  return page.evaluate(async ({ dbno }) => {
    const [loader, getWork, loadedNodes, registry, treeStore] = await Promise.all([
      import('/src/composables/useDbnoInstancesDtxLoader.ts'),
      import('/src/composables/useModelGetWork.ts'),
      import('/src/composables/useLoadedNodeStatus.ts'),
      import('/src/composables/modelGetWorkRegistry.ts'),
      import('/src/composables/useModelTreeStore.ts'),
    ]);
    const layer = window.__dtxLayer;
    const byRefno = {};
    let objects = 0;
    for (const objectId of layer?.getAllObjectIds?.() ?? []) {
      const refno = loader.resolveDtxRefnoByObjectId(dbno, objectId);
      if (!refno) continue;
      objects += 1;
      const matrix = layer.getObjectMatrix(objectId);
      (byRefno[refno] ??= []).push(matrix ? Array.from(matrix.elements) : null);
    }
    const state = getWork.useModelGetWork().state;
    const tree = treeStore.getModelTreeInstance();
    return {
      objects, byRefno,
      loadedTable: loadedNodes.useLoadedNodeStatus().entries().filter((entry) => entry.loaded).map((entry) => `${entry.refno}@${entry.loadedModelSesno}`),
      registry: { roots: registry.getWorkRegisteredRoots().map((item) => `${item.refno}@${item.loadedModelSesno}`), scopes: registry.getWorkRegisteredScopes().map((scope) => ({ dbnum: scope.dbnum, discover: scope.discover, knownSites: [...scope.knownSites], checked: scope.checkedFileLatestSesno })) },
      last: state.last ? JSON.parse(JSON.stringify(state.last)) : null,
      treeHasNewSite: !!tree?.nodesById.value['24384_47462'],
      result: document.querySelector('[data-testid="model-getwork-result"]')?.textContent?.trim() ?? null,
    };
  }, { dbno: DBNUM });
}

function compare(pageState, backend) {
  const mismatches = [];
  let compared = 0;
  for (const [refno, matrices] of backend.expected) {
    const objects = pageState.byRefno[refno] ?? [];
    if (objects.length !== matrices.length) { mismatches.push(`${refno}：后端 ${matrices.length} 个实例，场景里 ${objects.length} 个对象`); continue; }
    const unused = [...objects];
    for (const matrix of matrices) {
      compared += 1;
      const index = unused.findIndex((candidate) => candidate && matrixClose(candidate, matrix));
      if (index < 0) mismatches.push(`${refno}：有一个实例的矩阵在场景里找不到`);
      else unused.splice(index, 1);
    }
  }
  for (const refno of Object.keys(pageState.byRefno)) {
    if (!backend.expected.has(refno)) mismatches.push(`场景里有 ${refno}，后端没有它的记录`);
  }
  return { compared, mismatches };
}

async function clickGetWork(timeoutMs = 900_000) {
  const before = await page.evaluate(async () => (await import('/src/composables/useModelGetWork.ts')).useModelGetWork().state.last?.finishedAt ?? 0);
  const from = Date.now();
  await page.click('[data-testid="model-getwork-button"]');
  const progress = [];
  for (;;) {
    const state = await page.evaluate(async () => {
      const s = (await import('/src/composables/useModelGetWork.ts')).useModelGetWork().state;
      return { running: s.running, progress: s.progress, finishedAt: s.last?.finishedAt ?? 0 };
    });
    if (state.progress && progress[progress.length - 1] !== state.progress) progress.push(state.progress);
    if (!state.running && state.finishedAt > before) break;
    if (Date.now() - from > timeoutMs) throw new Error(`取最新 ${timeoutMs} 毫秒没做完（${state.progress}）`);
    await sleep(100);
  }
  return { ms: Date.now() - from, from, progress };
}

const results = { startedAt: new Date().toISOString(), steps: [] };
try {
  const health = (await backendFetch('/api/v1/health')).body;
  if (health.sul_db?.endpoint !== '127.0.0.1:8199') throw new Error(`这台后端连的不是沙箱库：${health.sul_db?.endpoint}`);
  const row0 = await backendRow();
  console.log(`[${stamp()}] 沙箱后端 ${health.build_id}，8000 库 ${JSON.stringify(row0)}`);
  if (row0.model !== 1528) throw new Error(`8000 库不在会话 1528（现在 ${row0.model}）：先 reset-sandbox.ps1 -Base8000 1528`);

  console.log(`[${stamp()}] 开页面 show_dbnum=${DBNUM}`);
  const loadFrom = Date.now();
  await page.goto(`${FRONT}/?${new URLSearchParams({ output_project: 'AvevaMarineSample', gm_backend: BACKEND, show_dbnum: String(DBNUM) })}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__dtxViewer && !!window.__dtxLayer, null, { timeout: 180_000 });
  await page.waitForSelector('[data-testid="model-getwork-button"]', { timeout: 60_000 });
  await page.waitForFunction(() => {
    const status = window.__dtxLastShowDbnumLoadResult?.status;
    return !!status && status !== 'loading';
  }, null, { timeout: 900_000, polling: 500 });
  await page.waitForFunction(async () => !(await import('/src/composables/modelLoadSession.ts')).hasActiveModelLoad(), null, { timeout: 600_000, polling: 300 });
  await sleep(1500);
  const loadMs = Date.now() - loadFrom;
  const loadResult = await page.evaluate(() => window.__dtxLastShowDbnumLoadResult);
  let pageState = await readPage();
  let backend = await snapshotLibrary();
  results.baseline = {
    loadMs, loadResult: { status: loadResult?.status, loadedObjects: loadResult?.loadedObjects, refnoCount: loadResult?.refnoCount },
    sites: backend.sites, row: backend.row, sceneObjects: pageState.objects, registry: pageState.registry, loadedTable: pageState.loadedTable, snapshotMs: backend.ms,
  };
  console.log(`[${stamp()}] 整库装完：${loadMs} ms，${pageState.objects} 个对象；后端 ${backend.sites.length} 个 SITE、${backend.expected.size} 个带几何的构件（脚本自己问一遍后端用了 ${backend.ms} ms）`);
  await page.screenshot({ path: path.join(OUT, 'replay-w0-showdbnum.png') });
  {
    const result = compare(pageState, backend);
    check('整库·基线', `整库装进来了，和后端逐条一样（${result.compared} 个实例矩阵）`, loadResult?.status === 'loaded' && result.mismatches.length === 0, `${loadResult?.status}；${result.mismatches.slice(0, 3).join('；')}`);
    const scope = pageState.registry.scopes.find((item) => item.dbnum === DBNUM);
    const withGeometry = backend.sites.filter((site) => site.records > 0).map((site) => site.refno).sort();
    const registered = pageState.registry.roots.map((item) => item.split('@')[0]).sort();
    check('整库·基线', '有几何的顶层 SITE 都登记成了在册节点（带装时的水位 1528），库记成「要找新 SITE」；新 SITE 还不存在', !!scope && scope.discover === true && registered.join(',') === withGeometry.join(',') && pageState.registry.roots.every((item) => item.endsWith('@1528')) && !backend.sites.some((site) => site.refno === NEW_SITE),
      `登记 ${registered.length} 个：${pageState.registry.roots.join(' ')}；后端有几何的 SITE ${withGeometry.length} 个`);
  }

  const steps = [
    { id: 'W1', to: 1530, what: '新建整个 SITE（E3D 会话 1529–1530，ident/setup_t3.mac）：SITE /AIOS-SUITE-T3 连同两个 ZONE、十来台设备、一条管道' },
    { id: 'W2', to: 1552, what: '一口气 22 个会话（1531–1552，别的录制腿留下的）' },
    { id: 'W3', to: 1554, what: '只改一个自定义属性（E3D 会话 1553–1554，meta/uda_text_apply.mac）：模型不变，库的水位往前走' },
  ];
  for (const step of steps) {
    console.log(`[${stamp()}] ${step.id}：${step.what}`);
    const record = { id: step.id, what: step.what, to: step.to };
    results.steps.push(record);
    const before = backend;
    const at = replayStep(step.to);
    record.caughtUp = await waitCaughtUp(step.to, at);
    check(step.id, `后端批次追上：三枚水位都到 ${step.to}`, record.caughtUp.ok, `${record.caughtUp.ms} ms；${JSON.stringify(record.caughtUp.row)}`);
    await sleep(1000);
    const run = await clickGetWork();
    await page.waitForFunction(async () => !(await import('/src/composables/modelLoadSession.ts')).hasActiveModelLoad(), null, { timeout: 600_000, polling: 300 });
    await sleep(800);
    pageState = await readPage();
    backend = await snapshotLibrary();
    const report = pageState.last;
    const slow = log.timings.filter((item) => item.at >= run.from).sort((a, b) => b.ms - a.ms).slice(0, 4).map((item) => `${item.method} ${item.path} ${item.ms} ms`);
    const recordsCalls = log.timings.filter((item) => item.at >= run.from && item.path === '/api/v1/model/records');
    record.getWork = {
      ms: run.ms, waitedMs: report?.waited?.ms ?? 0, summary: report?.summary, level: report?.level,
      reloaded: report?.models.reloaded.length, loadedNew: report?.models.loadedNew, withdrawn: report?.models.withdrawn, kept: report?.models.kept, failed: report?.models.failed,
      componentsAdded: report?.models.componentsAdded, componentsRemoved: report?.models.componentsRemoved, rootsTotal: report?.models.rootsTotal, checked: report?.models.checked,
      treeAdded: report?.tree?.added.map((item) => item.id) ?? null, progress: run.progress.filter((text) => !/已等/.test(text)).slice(0, 30),
      recordsRequests: recordsCalls.length, recordsMs: recordsCalls.reduce((sum, item) => sum + item.ms, 0), slowest: slow,
    };
    record.backend = { sitesBefore: before.sites.length, sitesAfter: backend.sites.length, componentsBefore: before.expected.size, componentsAfter: backend.expected.size, row: backend.row };
    record.page = { objects: pageState.objects, registry: pageState.registry.roots, loadedTable: pageState.loadedTable.length, treeHasNewSite: pageState.treeHasNewSite };
    console.log(`    后端：SITE ${before.sites.length} → ${backend.sites.length}，带几何的构件 ${before.expected.size} → ${backend.expected.size}`);
    console.log(`    取最新 ${run.ms} ms（其中等后台 ${record.getWork.waitedMs} ms）：${report?.summary}`);
    console.log(`    在册 ${report?.models.rootsTotal} 个，核对 ${report?.models.checked} 个，重载 ${report?.models.reloaded.length} 个；记录请求 ${recordsCalls.length} 个共 ${record.getWork.recordsMs} ms；最慢：${slow.join('；')}`);
    await page.screenshot({ path: path.join(OUT, `replay-${step.id.toLowerCase()}-showdbnum.png`) });
    const result = compare(pageState, backend);
    record.compare = { compared: result.compared, mismatches: result.mismatches.slice(0, 20), count: result.mismatches.length };
    check(step.id, '取最新做成（没有失败、没有判不了的节点）', report?.ok === true && report.models.failed.length === 0 && !report.models.kept.some((item) => /判不了/.test(item.reason)), `${report?.summary} failed=${JSON.stringify(report?.models.failed)} kept=${JSON.stringify(report?.models.kept)}`);
    check(step.id, `三维对上：整个库和后端逐条一样（${result.compared} 个实例矩阵），场景里没有多余的`, result.mismatches.length === 0, result.mismatches.slice(0, 4).join('；'));
    check(step.id, '状态栏那句交代和回执一致', pageState.result === report?.summary, pageState.result ?? '');
    // 页面此刻当成在册的 SITE（登记表 + 已加载节点表）= 后端此刻有几何的顶层 SITE
    const managed = [...new Set([...pageState.registry.roots, ...pageState.loadedTable].map((item) => item.split('@')[0]))].sort();
    const withGeometry = backend.sites.filter((site) => site.records > 0).map((site) => site.refno).sort();
    check(step.id, '在册的节点正好是后端此刻有几何的顶层 SITE，装时的水位都推进到了现在', managed.join(',') === withGeometry.join(',') && [...pageState.registry.roots, ...pageState.loadedTable].every((item) => item.endsWith(`@${step.to}`)),
      `在册 ${managed.length} 个，后端 ${withGeometry.length} 个；${[...pageState.registry.roots, ...pageState.loadedTable].join(' ')}`);
    // 新装入的：之前后端没有、现在有的 SITE，件数和后端一样；撤下的「已不存在」的：之前有、现在后端没有的 SITE
    const beforeSites = new Set(before.sites.map((site) => site.refno));
    const nowSites = new Map(backend.sites.map((site) => [site.refno, site]));
    const brandNew = backend.sites.filter((site) => !beforeSites.has(site.refno) && site.records > 0).map((site) => site.refno).sort();
    const vanished = before.sites.filter((site) => !nowSites.has(site.refno) && site.records > 0).map((site) => site.refno).sort();
    const loadedNew = report?.models.loadedNew ?? [];
    const withdrawnDeleted = (report?.models.withdrawn ?? []).filter((item) => item.why === 'deleted').map((item) => item.refno).sort();
    record.sitesDelta = { brandNew, vanished };
    check(step.id, `新出现的 SITE（${brandNew.length} 个）都装进来了，件数和后端的记录数一样；库里删掉的 SITE（${vanished.length} 个）撤下了`,
      loadedNew.map((item) => item.refno).sort().join(',') === brandNew.join(',') && loadedNew.every((item) => item.total === nowSites.get(item.refno)?.records) && withdrawnDeleted.join(',') === vanished.join(','),
      `新装入 ${JSON.stringify(loadedNew)}；撤下 ${JSON.stringify(report?.models.withdrawn)}；后端新出现 ${brandNew.join(',') || '无'}，后端删掉 ${vanished.join(',') || '无'}`);
    if (step.id === 'W1') {
      check('W1', '这一步 E3D 新建的 SITE /AIOS-SUITE-T3（24384_47462）在新装入的里面，那一句里说了新装入几个 SITE', brandNew.includes(NEW_SITE) && new RegExp(`新装入 ${loadedNew.length} 个 SITE`).test(report?.summary ?? ''), report?.summary ?? '');
      const scope = pageState.registry.scopes.find((item) => item.dbnum === DBNUM);
      check('W1', '新 SITE 记成已在管；下次不会再当成新的', !!scope && scope.knownSites.includes(NEW_SITE) && scope.checked === step.to, JSON.stringify(scope));
    }
  }
} catch (error) {
  console.error(`[${stamp()}] 出错：${error?.stack ?? error}`);
  results.error = String(error?.stack ?? error).slice(0, 3000);
  process.exitCode = 2;
  try { await page.screenshot({ path: path.join(OUT, 'replay-w-error.png') }); } catch { /* 页面可能已经没了 */ }
} finally {
  results.guard = { toLive: log.toLive, blocked: log.blocked, allowedPost: log.allowedPost, requestsToSandbox: log.requests, pageErrors };
  check('护栏', '页面没有一个请求发往 8022 / 8009', log.toLive.length === 0, log.toLive.length ? log.toLive.slice(0, 5).join('；') : `发往沙箱后端 ${log.requests} 个请求`);
  check('护栏', '页面对沙箱后端只发了 GET 和三种只读 POST', log.blocked.length === 0, log.blocked.length ? log.blocked.slice(0, 5).join('；') : JSON.stringify(log.allowedPost));
  await context.close();
  await browser.close();
  results.finishedAt = new Date().toISOString();
  results.checks = checks;
  writeFileSync(path.join(OUT, 'replay-showdbnum-result.json'), `${JSON.stringify(results, null, 1)}\n`, 'utf8');
  const failed = checks.filter((item) => !item.pass);
  console.log(`[${stamp()}] 共 ${checks.length} 项，过 ${checks.length - failed.length}，没过 ${failed.length}`);
  if (failed.length > 0 && !process.exitCode) process.exitCode = 1;
}
