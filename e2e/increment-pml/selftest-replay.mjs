/**
 * 取数层的回放自测：在一套回放数据上把「一条腿」的流程（`lib/leg.mjs`）真跑一遍，看取来的数送进判定层之后，结论是不是
 * 配置里写的那样、和 11-17 回归同一场景记下的是不是一致。存盘这一步用回放：把录好的 E3D 会话一个个推进沙箱里的库文件副本
 * （`db_session_fixture replay-step`），不开 E3D。
 *
 * 页面经带闸门的浏览器打开；脚本自己只问配置里的隔离后端（本机回环，端口不能是 8022 / 8009）。写的只有两处：回放用的库文件副本
 * （必须在配置的 `replay.root` 下）和报告目录。
 *
 * 用法：node e2e/increment-pml/selftest-replay.mjs --config <配置.json> [--out <目录>] [--wait-ready <秒>] [--headed]
 * 退出码：0 全部检查通过；1 有检查没过；2 没跑完（环境不对，或中途出错）。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { createBackend, loopbackOrigin, sleep } from './lib/backend.mjs';
import { judgeW3, judgeW7, loadKnownGaps, refnoKey, VERDICT_LABEL } from './lib/judge.mjs';
import { observeBackend, observePage, runLeg, sceneForJudging, sceneTruth } from './lib/leg.mjs';
import {
  clickGetWork,
  createGuardedContext,
  expandTree,
  fetchedLayers,
  launchBrowser,
  loadRoots,
  newPage,
  openApp,
  readLoadedLayerCount,
  readTreeTops,
  requestSummary,
} from './lib/page.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function refuse(message) {
  console.error(`[回放自测] ${message}`);
  process.exit(2);
}

const { values: args } = parseArgs({
  options: {
    config: { type: 'string' },
    out: { type: 'string' },
    'wait-ready': { type: 'string', default: '0' },
    headed: { type: 'boolean', default: false },
  },
});
if (!args.config) refuse('没给 --config');
const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));

const inside = (target, root) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const systemDrive = (process.env.SystemDrive ?? 'C:').toLowerCase();
const onSystemDrive = (target) => path.resolve(target).slice(0, 2).toLowerCase() === systemDrive;

let pageOrigin;
let backendOrigin;
try {
  pageOrigin = loopbackOrigin(config.page, '页面服务的地址');
  backendOrigin = loopbackOrigin(config.backend, '隔离后端的地址');
} catch (error) {
  refuse(error.message);
}
if (pageOrigin === backendOrigin) refuse('页面服务和隔离后端是同一个地址');

const outDir = path.resolve(args.out ?? config.outDir ?? '');
if (!args.out && !config.outDir) refuse('没给报告目录（--out 或配置里的 outDir）');
const cacheDir = config.browser?.cacheDir ? path.resolve(config.browser.cacheDir) : path.join(outDir, '_browser-cache');
for (const [what, dir] of [['报告目录', outDir], ['浏览器缓存目录', cacheDir], ['临时目录（TEMP）', os.tmpdir()]]) {
  if (onSystemDrive(dir)) refuse(`${what}在系统盘上（${dir}）：换到别的盘再跑`);
}

const replay = config.replay ?? {};
if (!replay.root || !replay.fixture || !replay.libraries) refuse('配置的 replay 段不全（root、fixture、libraries）');
if (/^[a-z]:\\aveva(\\|$)/i.test(path.resolve(replay.root))) refuse(`replay.root 是正式工程的目录，不在这里回放：${replay.root}`);
for (const [dbnum, library] of Object.entries(replay.libraries)) {
  for (const name of ['work', 'source']) {
    if (!library[name] || !inside(library[name], replay.root)) refuse(`库 ${dbnum} 的 ${name} 不在 replay.root 下：${library[name]}`);
  }
  if (!Number.isInteger(library.base)) refuse(`库 ${dbnum} 没写基线会话（base）`);
}
if (!inside(replay.fixture, replay.root)) refuse(`回放工具不在 replay.root 下：${replay.fixture}`);
for (const leg of config.legs ?? []) {
  if (!replay.libraries[leg.step?.dbnum]) refuse(`腿 ${leg.id} 要推的库 ${leg.step?.dbnum} 不在 replay.libraries 里`);
  if (leg.restoreOf && !(config.legs ?? []).some((other) => other.id === leg.restoreOf)) refuse(`腿 ${leg.id} 要还原的腿 ${leg.restoreOf} 不在配置里`);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

const roots = config.roots.map((root) => ({ refno: refnoKey(root.refno), dbnum: root.dbnum, name: root.name ?? '' }));
const rootIds = roots.map((root) => root.refno);
const sceneToMm = config.sceneToMm ?? 1000;
const report = {
  what: config.what ?? '取数层的回放自测',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  verdict: null,
  config: { file: path.resolve(args.config), page: pageOrigin, backend: backendOrigin, project: config.project, roots, expand: config.expand, sceneToMm },
  environment: {},
  setup: {},
  legs: [],
  checks: [],
  guard: null,
  error: null,
};

function check(where, name, pass, detail = '') {
  const ok = pass === true;
  const text = String(detail);
  report.checks.push({ where, name, pass: ok, detail: text.slice(0, 4000) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${where}] ${name}${text ? ` | ${text.slice(0, 300)}` : ''}`);
}

function writeJson(name, value, indent = 2) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, indent)}\n`, 'utf8');
}

async function codeState() {
  try {
    const head = await run('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { windowsHide: true });
    const status = await run('git', ['--no-optional-locks', '-C', repoRoot, 'status', '--short', '--ignored', '--', 'e2e/increment-pml'], { windowsHide: true });
    return { commit: head.stdout.trim(), uncommitted: status.stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean) };
  } catch (error) {
    return { commit: null, uncommitted: [], error: String(error.message).slice(0, 200) };
  }
}

const atBase = (row, base) => !!row && row.initialized === true && row.excluded !== true && row.file === base && row.applied === base && row.model === base;
const levelText = (row) => (row ? `文件 ${row.file} / 数据 ${row.applied} / 模型 ${row.model}${row.initialized ? '' : '（未初始化）'}${row.excluded ? '（不在更新范围）' : ''}` : '没有这个库');

/** 等后端起来、各库停在基线会话上（三枚水位齐平）。接口还没通就接着等 */
async function waitAtBase(backend, seconds) {
  const from = Date.now();
  let said = 0;
  for (;;) {
    let levels = null;
    let text = '';
    try {
      levels = await backend.libraries();
      text = Object.entries(replay.libraries).map(([dbnum, library]) => `库 ${dbnum}（基线 ${library.base}）：${levelText(levels[dbnum])}`).join('；');
    } catch (error) {
      text = `接口还没通（${error.cause?.code ?? error.message}）`;
    }
    const ready = !!levels && Object.entries(replay.libraries).every(([dbnum, library]) => atBase(levels[dbnum], library.base));
    if (ready || Date.now() - from >= seconds * 1000) return { ok: ready, waitedMs: Date.now() - from, text, levels };
    if (Date.now() - said > 30_000) {
      console.log(`[回放自测] 等后端到基线（已等 ${Math.round((Date.now() - from) / 1000)} 秒）：${text}`);
      said = Date.now();
    }
    await sleep(2000);
  }
}

/** 推一个录好的会话进库文件副本。工具最后一行输出是 JSON */
async function replayStep(dbnum, to) {
  const library = replay.libraries[dbnum];
  const startedAt = Date.now();
  let stdout = '';
  try {
    ({ stdout } = await run(replay.fixture, ['replay-step', '--source', library.source, '--work', library.work, '--to', String(to)], { windowsHide: true }));
  } catch (error) {
    throw new Error(`replay-step ${dbnum} → ${to} 失败（退出码 ${error.code}）：${String(error.stderr || error.stdout || error.message).slice(0, 400)}`);
  }
  const savedAt = Date.now();
  const last = stdout.trim().split('\n').pop() ?? '';
  let result;
  try {
    result = JSON.parse(last);
  } catch {
    result = { raw: last.slice(0, 300) };
  }
  return { savedAt, ms: savedAt - startedAt, dbnum, to, report: result };
}

const byRefno = (a, b) => a.refno.localeCompare(b.refno);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function receiptBrief(receipt) {
  if (!receipt) return null;
  const tree = receipt.tree;
  const ids = (items) => (items ?? []).map((item) => refnoKey(item.id)).sort();
  return {
    ok: receipt.ok,
    error: receipt.error,
    level: receipt.level,
    summary: receipt.summary,
    detail: receipt.detail,
    backendRestarted: receipt.backendRestarted,
    waited: receipt.waited,
    libraries: receipt.libraries,
    models: receipt.models,
    tree: tree ? {
      layersRequested: tree.layersRequested,
      layersRefreshed: tree.layersRefreshed,
      layersFailed: tree.layersFailed,
      added: ids(tree.added),
      deleted: ids((tree.removed ?? []).filter((item) => item.fate === 'deleted')),
      relocated: ids((tree.removed ?? []).filter((item) => item.fate === 'relocated')),
      renamed: ids(tree.renamed),
      moved: ids(tree.moved),
    } : null,
    treeError: receipt.treeError,
  };
}

/** 回执和 11-17 同一场景记下的逐项比，回不一样的那几条 */
function referenceDiffs(receipt, reference) {
  const diffs = [];
  const brief = receiptBrief(receipt);
  if (!brief) return ['没有回执'];
  const models = brief.models ?? {};
  if (reference.summary !== undefined && brief.summary !== reference.summary) {
    diffs.push(`那一句：现在「${brief.summary}」，那时「${reference.summary}」`);
  }
  if (reference.reloaded) {
    const pick = (item) => ({ refno: refnoKey(item.refno), added: item.added, removed: item.removed, total: item.total });
    const got = (models.reloaded ?? []).map(pick).sort(byRefno);
    const want = reference.reloaded.map(pick).sort(byRefno);
    if (!same(got, want)) diffs.push(`重载的节点：现在 ${JSON.stringify(got)}，那时 ${JSON.stringify(want)}`);
  }
  if (reference.withdrawn) {
    const pick = (item) => ({ refno: refnoKey(item.refno), refnos: item.refnos, why: item.why });
    const got = (models.withdrawn ?? []).map(pick).sort(byRefno);
    const want = reference.withdrawn.map(pick).sort(byRefno);
    if (!same(got, want)) diffs.push(`撤下的节点：现在 ${JSON.stringify(got)}，那时 ${JSON.stringify(want)}`);
  }
  for (const name of ['rootsTotal', 'checked', 'componentsAdded', 'componentsRemoved']) {
    if (reference[name] !== undefined && models[name] !== reference[name]) diffs.push(`${name}：现在 ${models[name]}，那时 ${reference[name]}`);
  }
  if (reference.tree) {
    for (const name of ['added', 'deleted', 'renamed', 'moved']) {
      const want = (reference.tree[name] ?? []).map(refnoKey).sort();
      const got = brief.tree?.[name] ?? null;
      if (!same(got, want)) diffs.push(`树上 ${name}：现在 ${JSON.stringify(got)}，那时 ${JSON.stringify(want)}`);
    }
  }
  if (reference.layersRequested !== undefined && brief.tree?.layersRequested !== reference.layersRequested) {
    diffs.push(`核对的树层数：现在 ${brief.tree?.layersRequested}，那时 ${reference.layersRequested}`);
  }
  return diffs;
}

/** 某个构件的包围盒在这条腿前后是不是正好挪了配置里写的那么多（验包围盒读得对、单位换得对） */
function boxShiftProblems(result, shifts) {
  const problems = [];
  const seen = [];
  for (const shift of shifts) {
    const root = refnoKey(shift.root);
    const component = refnoKey(shift.component);
    const before = result.before.scene.boxes[root]?.[component];
    const after = result.after.scene.boxes[root]?.[component];
    if (!before || !after) {
      problems.push(`${component} 的包围盒没读到（之前 ${before ? '有' : '没有'}，之后 ${after ? '有' : '没有'}）`);
      continue;
    }
    const moved = after.map((value, index) => value - before[index]);
    const want = [...shift.deltaMm, ...shift.deltaMm];
    const worst = Math.max(...moved.map((value, index) => Math.abs(value - want[index])));
    seen.push({ component, before, after, moved: moved.map((value) => Number(value.toFixed(3))), want });
    if (worst > (shift.toleranceMm ?? 1)) {
      problems.push(`${component} 的包围盒挪了 [${moved.map((value) => value.toFixed(2)).join(', ')}]，预期 [${want.join(', ')}]`);
    }
  }
  return { problems, seen };
}

function judgementBrief(judgement) {
  return {
    verdict: judgement.verdict,
    label: judgement.label,
    problems: judgement.problems.map((problem) => ({ code: problem.code, message: problem.message })),
    gaps: judgement.gaps.map((hit) => ({ gap: hit.gap, message: hit.message })),
    facts: judgement.facts,
  };
}

function verdictText(judgement) {
  if (!judgement) return '没有判';
  const first = judgement.problems[0]?.message ?? judgement.gaps[0]?.message ?? '';
  const more = judgement.problems.length + judgement.gaps.length;
  return `${judgement.label}${first ? `：${first}${more > 1 ? `（共 ${more} 条）` : ''}` : ''}`;
}

function timelineText(states) {
  return states.map((state) => {
    const at = `${(state.atMs / 1000).toFixed(1)} 秒`;
    if (!state.present) return `${at} 行不在`;
    const what = [state.nodeStatus ?? '没有标记', state.action ? `按钮 ${state.action}` : '', state.pending ? '核对中' : '', state.eyeLit ? '' : '眼睛灭'];
    return `${at} ${what.filter(Boolean).join('、')}`;
  }).join(' → ');
}

function summaryMarkdown() {
  const lines = [];
  const failed = report.checks.filter((item) => !item.pass).length;
  const cell = (text) => String(text).replaceAll('|', '／').replaceAll('\n', ' ').slice(0, 400);
  lines.push(`# ${report.what}`, '');
  lines.push(`- 时间：${report.startedAt} → ${report.finishedAt}`);
  lines.push(`- 结论：${report.verdict === 'pass' ? '通过' : '不通过'}（${report.checks.length} 项检查，${failed} 项没过）${report.error ? `；中途出错：${report.error.message}` : ''}`);
  lines.push(`- 页面服务 ${report.config.page}，隔离后端 ${report.config.backend}，工程 ${report.config.project}；代码 ${report.environment.code?.commit ?? '（没读到）'}`);
  if (report.guard) {
    lines.push(`- 页面发出的请求 ${report.guard.total} 条：发往 8022 / 8009 的 ${report.guard.toLive} 条，守卫拦下 ${report.guard.blocked} 条；脚本自己问隔离后端 ${report.guard.scriptRequests} 次`);
  }
  lines.push('', '## 各腿', '');
  for (const leg of report.legs) {
    lines.push(`### ${leg.id}：${leg.title}`, '');
    lines.push(`- 存盘：库 ${leg.step.dbnum} 推到会话 ${leg.step.to}（回放用时 ${leg.step.ms} 毫秒）`);
    for (const [dbnum, caught] of Object.entries(leg.caughtUp)) {
      lines.push(`- 后端跟上（库 ${dbnum}）：看见文件 ${caught.fileSeenMs} 毫秒，数据 ${caught.appliedMs} 毫秒，模型 ${caught.modelMs} 毫秒`);
    }
    lines.push('- 行的变化（从存盘完成算起）：');
    for (const [root, states] of Object.entries(leg.timeline)) lines.push(`  - ${root}：${timelineText(states)}`);
    lines.push(`- 回执（取最新用时 ${leg.clickMs} 毫秒）：${leg.receipt?.summary ?? '（没有）'}`);
    for (const [id, judgement] of Object.entries(leg.judgements)) {
      lines.push(`- ${id} ${judgement.label}${leg.expect[id] ? `（配置预期：${VERDICT_LABEL[leg.expect[id]] ?? leg.expect[id]}）` : '（只记不判）'}`);
      for (const problem of judgement.problems.slice(0, 8)) lines.push(`  - 不过：${problem.message}`);
      for (const hit of judgement.gaps.slice(0, 8)) lines.push(`  - 已知缺口 ${hit.gap}：${hit.message}`);
    }
    for (const note of leg.notes) lines.push(`- 备注：${note}`);
    lines.push('');
  }
  lines.push('## 检查项', '', '| 位置 | 检查 | 结果 | 细节 |', '| --- | --- | --- | --- |');
  for (const item of report.checks) lines.push(`| ${cell(item.where)} | ${cell(item.name)} | ${item.pass ? '过' : '不过'} | ${cell(item.detail)} |`);
  return `${lines.join('\n')}\n`;
}

let browser = null;
let log = null;
const backend = createBackend(backendOrigin);

try {
  // 后端先到位：各库停在基线会话上
  const ready = await waitAtBase(backend, Number(args['wait-ready']) || 0);
  report.setup.backendReady = { ok: ready.ok, waitedMs: ready.waitedMs, text: ready.text };
  check('准备', '隔离后端在线，要回放的库都停在基线会话上（三枚水位齐平）', ready.ok, ready.text);
  if (!ready.ok) throw new Error('后端没有停在基线上：先把回放数据重置到基线、把后端起起来');
  const health = await backend.health();
  report.environment = {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    tmpdir: os.tmpdir(),
    code: await codeState(),
    backendHealth: { status: health.status ?? null, version: health.version ?? null },
  };

  // 开页面、展开、装节点
  browser = await launchBrowser({ headed: args.headed, cacheDir, channel: config.browser?.channel ?? 'chrome' });
  report.environment.browser = `${config.browser?.channel ?? 'chrome'} ${browser.version()}`;
  const guarded = await createGuardedContext(browser, { pageOrigin, backendOrigin, viewport: config.browser?.viewport });
  log = guarded.log;
  const target = { pageOrigin, backendOrigin, project: config.project, query: config.query ?? {} };

  // 预开一遍：页面服务刚起来时，Vite 会边开边补打包依赖、让页面自己重新载入。把正式那一页要走的路（展开、装节点、取最新）
  // 先在另一页上走一遍，等它消停了关掉；正式的一页另开，W6 从正式的一页打开算起
  const warmFrom = Date.now();
  let warmAttempts = 0;
  for (;;) {
    warmAttempts += 1;
    const warm = await newPage(guarded.context, log);
    try {
      await openApp(warm, target);
      await expandTree(warm, log, config.expand ?? []);
      await loadRoots(warm, log, roots);
      await clickGetWork(warm, log);
      await sleep(config.warmUpSettleMs ?? 3000);
      break;
    } catch (error) {
      if (warmAttempts >= 3) throw new Error(`预开页面 3 次都没走完：${String(error.message).slice(0, 300)}`);
      console.log(`[回放自测] 预开页面第 ${warmAttempts} 次没走完（${String(error.message).slice(0, 160)}），再来一次`);
      await sleep(3000);
    } finally {
      await warm.close().catch(() => undefined);
    }
  }
  report.setup.warmUp = { attempts: warmAttempts, ms: Date.now() - warmFrom };

  const openedAt = Date.now();
  const page = await newPage(guarded.context, log);
  const shot = async (name) => {
    try {
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    } catch (error) {
      console.log(`[回放自测] 截图 ${name} 没成：${String(error.message).slice(0, 120)}`);
    }
  };
  await openApp(page, target);
  await expandTree(page, log, config.expand ?? []);
  await loadRoots(page, log, roots);

  const ctx = {
    page,
    log,
    backend,
    roots,
    // 在树上点眼睛装：一次点一个，每个节点自己是一轮
    rootFacts: Object.fromEntries(roots.map((root) => [root.refno, {
      dbnum: root.dbnum,
      loadedVia: 'tree',
      aloneInLibraryAtLoad: true,
      reloadsBefore: 0,
      withdrawnVia: null,
    }])),
    sceneToMm,
    ignoreErrors: config.ignoreErrors ?? [],
    knownGaps: loadKnownGaps(),
  };

  // 基线：装好之后场景和后端先对一遍，空点一次「取最新」
  const pageBase = await observePage(ctx);
  const layerIds = fetchedLayers(pageBase.tree);
  const backendBase = await observeBackend(backend, rootIds, layerIds);
  const sceneBase = sceneForJudging(pageBase, backendBase);
  const baseW3 = judgeW3(sceneTruth(sceneBase, backendBase, rootIds));
  const components = Object.fromEntries(rootIds.map((root) => [root, Object.keys(backendBase.roots[root].components).length]));
  const treeTops = await readTreeTops(page);
  report.setup.baseline = {
    libraries: backendBase.libraries,
    components,
    records: Object.fromEntries(rootIds.map((root) => [root, backendBase.roots[root].records])),
    sceneObjects: pageBase.scene.objects,
    unresolvedObjects: pageBase.scene.unresolved,
    strays: sceneBase.strays,
    layers: layerIds,
    treeTops,
    loadedTable: pageBase.state.loadedTable,
    w3: judgementBrief(baseW3),
  };
  const notInScene = pageBase.state.roots.filter((root) => !root.inScene).map((root) => root.refno);
  check('基线', `${roots.length} 个节点都装进了场景`, notInScene.length === 0, notInScene.length ? `没装上：${notInScene.join('、')}` : `场景里 ${pageBase.scene.objects} 个对象`);
  check('基线', '场景 = 后端（没有说不清归谁的对象）', baseW3.verdict === 'pass', verdictText(baseW3));
  if (config.baseline?.components) {
    const want = Object.fromEntries(Object.entries(config.baseline.components).map(([root, count]) => [refnoKey(root), count]));
    check('基线', '各节点名下带几何的构件数和 11-17 记下的一样', same(components, want), `现在 ${JSON.stringify(components)}，那时 ${JSON.stringify(want)}`);
  }
  const idle = await clickGetWork(page, log);
  const idleBrief = receiptBrief(idle.receipt);
  report.setup.idleClick = { ms: idle.ms, receipt: idleBrief };
  const idleModels = idleBrief?.models ?? {};
  const idleQuiet = idleBrief?.ok === true
    && (idleModels.reloaded ?? []).length + (idleModels.withdrawn ?? []).length + (idleModels.failed ?? []).length + (idleModels.kept ?? []).length === 0
    && !!idleBrief.tree
    && idleBrief.tree.added.length + idleBrief.tree.deleted.length + idleBrief.tree.relocated.length + idleBrief.tree.renamed.length + idleBrief.tree.moved.length === 0;
  check('基线', '后台没变时点「取最新」：一个模型都不重载，树不动', idleQuiet, idleBrief?.summary ?? '没有回执');
  if (config.baseline?.idleSummary) {
    check('基线', '空点的那一句和 11-17 记下的一样', idleBrief?.summary === config.baseline.idleSummary, `现在「${idleBrief?.summary}」，那时「${config.baseline.idleSummary}」`);
  }
  // 脚本对账的层 = 页面树上有成员的参考号层；页面重取的层 = 它自己记的「取过成员的层」（空层、最上面不是参考号的层也算）。
  // 页面多出来的层数要是比最上面那几层还多，就是有取过的空层脚本没有对账
  const topLayers = treeTops.filter((node) => node.children > 0).length;
  const loadedLayers = await readLoadedLayerCount(page);
  const layersRequested = idleBrief?.tree?.layersRequested ?? null;
  report.setup.baseline.layerCounts = { refnoLayers: layerIds.length, topLayers, pageLoadedLayers: loadedLayers, layersRequested };
  check('基线', '脚本对账的树层没有比页面重取的少（页面多出来的只是最上面不是参考号的层）',
    loadedLayers !== null && loadedLayers >= layerIds.length && loadedLayers - layerIds.length <= topLayers,
    `页面记的取过成员的层 ${loadedLayers}，其中脚本对账的参考号层 ${layerIds.length}，最上面不是参考号的层 ${topLayers}`);
  check('基线', '空点时页面核对的树层数 = 页面记的取过成员的层数', layersRequested !== null && layersRequested === loadedLayers, `核对了 ${layersRequested} 层`);
  if (config.baseline?.layersRequested !== undefined) {
    check('基线', '空点时核对的树层数和 11-17 记下的一样', layersRequested === config.baseline.layersRequested, `现在 ${layersRequested}，那时 ${config.baseline.layersRequested}`);
  }
  await shot('00-baseline');

  // 各腿
  const results = {};
  let from = openedAt;
  for (const leg of config.legs) {
    console.log(`[回放自测] 腿 ${leg.id}：${leg.title ?? ''}`);
    const base = leg.restoreOf ? results[leg.restoreOf] : null;
    const result = await runLeg(ctx, {
      id: leg.id,
      title: leg.title,
      judge: leg.judge,
      affected: leg.affected,
      unaffected: leg.unaffected,
      controls: leg.controls,
      receipt: leg.receipt,
      windowMs: leg.windowMs,
      settleMs: leg.settleMs,
      libraries: [{ dbnum: leg.step.dbnum, to: leg.step.to }],
      save: () => replayStep(leg.step.dbnum, leg.step.to),
      restore: base ? { base, mode: leg.restoreMode ?? 'identical' } : undefined,
      beforeClick: () => shot(`${leg.id}-1-before-click`),
      from,
    });
    from = result.times.to;
    results[leg.id] = result;
    await shot(`${leg.id}-2-after`);
    writeJson(`leg-${leg.id}.json`, result, 0);

    const expect = leg.expect ?? {};
    for (const [id, want] of Object.entries(expect)) {
      const judgement = result.judgements[id];
      check(leg.id, `${id} 判${VERDICT_LABEL[want] ?? want}`, judgement?.verdict === want, verdictText(judgement));
    }
    for (const [id, want] of Object.entries(leg.expectGaps ?? {})) {
      const got = [...new Set((result.judgements[id]?.gaps ?? []).map((hit) => hit.gap))].sort();
      check(leg.id, `${id} 命中的已知缺口是 ${[...want].sort().join('、')}`, same(got, [...want].sort()), `命中 ${got.join('、') || '（无）'}`);
    }
    if (leg.reference) {
      const diffs = referenceDiffs(result.receipt, leg.reference);
      check(leg.id, `回执和 ${leg.reference.from ?? '11-17 回归'} 记下的一样`, diffs.length === 0, diffs.join('；') || result.receipt?.summary);
    }
    let boxes = null;
    if (leg.boxShift) {
      boxes = boxShiftProblems(result, leg.boxShift);
      check(leg.id, '包围盒读得对：前后正好挪了预期的距离', boxes.problems.length === 0,
        boxes.problems.join('；') || boxes.seen.map((item) => `${item.component} 挪了 [${item.moved.join(', ')}]`).join('；'));
    }
    if ((leg.negativeControls ?? []).includes('W3')) {
      const control = judgeW3(sceneTruth(result.after.scene, result.before.backend, result.rootIds));
      check(leg.id, '反向对照：拿存盘之前的后端记录比取最新之后的场景，W3 判不过', control.verdict === 'fail', verdictText(control));
    }
    if ((leg.negativeControls ?? []).includes('W7')) {
      const control = judgeW7({
        mode: 'identical',
        roots: result.rootIds,
        treeBefore: result.before.page.tree,
        treeAfter: result.after.page.tree,
        sceneBefore: result.before.scene.byRoot,
        sceneAfter: result.after.scene.byRoot,
      }, { knownGaps: ctx.knownGaps });
      check(leg.id, '反向对照：不还原就拿取最新之后的样子比存盘之前，W7 判不过', control.verdict === 'fail', verdictText(control));
    }
    report.legs.push({
      id: leg.id,
      title: leg.title ?? '',
      step: result.saved,
      times: result.times,
      caughtUp: Object.fromEntries(Object.entries(result.caughtUp).map(([dbnum, caught]) => [dbnum, {
        ok: caught.ok,
        fileSeenMs: caught.fileSeenMs,
        appliedMs: caught.appliedMs,
        modelMs: caught.modelMs,
      }])),
      signal: result.signal,
      timeline: result.timeline,
      samples: result.watch.samples.length,
      clickMs: result.click.ms,
      receipt: receiptBrief(result.receipt),
      expected: result.expected,
      expect,
      judgements: Object.fromEntries(Object.entries(result.judgements).map(([id, judgement]) => [id, judgementBrief(judgement)])),
      summary: result.summary,
      boxes: boxes?.seen ?? null,
      rootFacts: result.rootFacts,
      requests: result.requests,
      notes: result.notes,
    });
  }

  check('全程', '页面发往 8022 / 8009 的请求为 0', log.toLive.length === 0, `${log.toLive.length} 条；页面一共发了 ${log.requests.length} 条请求`);
  check('全程', '守卫没有拦下别的请求', log.blocked.length === 0, `${log.blocked.length} 条`);
} catch (error) {
  report.error = { message: String(error?.message ?? error).slice(0, 1000), stack: String(error?.stack ?? '').slice(0, 3000) };
  console.error(`[回放自测] 中途出错：${report.error.message}`);
} finally {
  if (log) {
    const all = requestSummary(log);
    report.guard = {
      total: all.total,
      toLive: all.toLive,
      blocked: all.blocked,
      byOrigin: all.byOrigin,
      backendPaths: all.backendPaths,
      allowedPost: all.allowedPost,
      httpFailures: all.httpFailures,
      consoleErrors: log.consoleErrors.length,
      pageErrors: log.pageErrors.length,
      websockets: all.websockets,
      scriptRequests: backend.stats.requests,
      scriptPaths: backend.stats.byPath,
    };
    writeJson('requests.json', {
      requests: log.requests,
      toLive: log.toLive,
      blocked: log.blocked,
      httpFailures: log.httpFailures,
      consoleErrors: log.consoleErrors,
      pageErrors: log.pageErrors,
      websockets: log.websockets,
      dialogs: log.dialogs,
      interactions: log.interactions,
      frames: log.frames.map((frame) => ({ t: frame.t, payload: frame.payload.slice(0, 300) })),
    }, 0);
  }
  if (browser) await browser.close().catch(() => undefined);
  report.finishedAt = new Date().toISOString();
  const failed = report.checks.filter((item) => !item.pass).length;
  report.verdict = !report.error && failed === 0 ? 'pass' : 'fail';
  writeJson('report.json', report);
  fs.writeFileSync(path.join(outDir, 'summary.md'), summaryMarkdown(), 'utf8');
  console.log(`[回放自测] 结论：${report.verdict === 'pass' ? '通过' : '不通过'}（${report.checks.length} 项检查，${failed} 项没过）；报告在 ${outDir}`);
  process.exitCode = report.error ? 2 : failed === 0 ? 0 : 1;
}
