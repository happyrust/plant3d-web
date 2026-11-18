/**
 * 增量测试「PML 触发 + 网页验收」页面这一侧的 runner：读运行配置，一条一条跑用例（`lib/case-runner.mjs`），每条腿落一份证据，
 * 最后出报告（`report.json`、`report.md`）。
 *
 * 页面经带闸门的浏览器打开；脚本自己只问配置里的隔离后端（本机回环，只读，端口不能是 8022 / 8009）。存盘这一步是运行配置里
 * 写好的外部命令（由开 E3D 的那一侧给），这里不认识 E3D。写的只有证据目录。
 *
 * 一条用例没跑完（前提没过、腿命令没过、中途出错）就停，后面的用例不跑：副本这时可能不在起点上，接着跑出来的结果不可信。
 *
 * 用法：node e2e/increment-pml/run.mjs --config <运行配置.json> --out <证据目录> [--case K16,K17] [--headed] [--check-config]
 * `--check-config` 只看运行配置写得对不对（和真跑时开头查的是同一套），不开浏览器、不问后端、不建目录；写得对退出 0。
 * 退出码：0 跑完了，没有「不过」（已知缺口不算「不过」）；1 跑完了，有「不过」；2 没跑完（参数或运行配置不对也是 2）。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

import { createBackend, loopbackOrigin, sleep } from './lib/backend.mjs';
import { CHECKPOINT_ORDER, runCase } from './lib/case-runner.mjs';
import { loadKnownGaps, refnoKey, SIGNAL_WINDOW_MS, VERDICT_LABEL } from './lib/judge.mjs';
import {
  clickGetWork,
  createGuardedContext,
  expandTree,
  launchBrowser,
  loadRoots,
  networkLockOf,
  newPage,
  openApp,
} from './lib/page.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const NAME = /^[A-Za-z0-9_-]+$/;

function refuse(message) {
  console.error(`[网页验收] ${message}`);
  process.exit(2);
}

const { values: args } = parseArgs({
  options: {
    config: { type: 'string' },
    out: { type: 'string' },
    case: { type: 'string' },
    headed: { type: 'boolean', default: false },
    'check-config': { type: 'boolean', default: false },
  },
});
if (!args.config) refuse('没给 --config');
if (!args.out) refuse('没给 --out（证据目录）');
const config = JSON.parse(fs.readFileSync(args.config, 'utf8'));

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

const outDir = path.resolve(args.out);
const cacheDir = config.browser?.cacheDir ? path.resolve(config.browser.cacheDir) : path.join(outDir, '_browser-cache');
for (const [what, dir] of [['证据目录', outDir], ['浏览器缓存目录', cacheDir], ['临时目录（TEMP）', os.tmpdir()]]) {
  if (onSystemDrive(dir)) refuse(`${what}在系统盘上（${dir}）：换到别的盘再跑`);
}
if (fs.existsSync(path.join(outDir, 'report.json'))) refuse(`证据目录里已经有一份报告了，不覆盖：${outDir}`);

/** 运行配置写得对不对（只看写法，不碰环境） */
function configProblems() {
  const problems = [];
  if (!config.project) problems.push('没写工程（project）');
  if (!Array.isArray(config.cases) || config.cases.length === 0) problems.push('没有用例（cases）');
  const caseIds = new Set();
  for (const item of config.cases ?? []) {
    const where = `用例 ${item.id ?? '（没写 id）'}`;
    if (!NAME.test(String(item.id ?? ''))) problems.push(`${where}：id 只用字母、数字、下划线、短横`);
    if (caseIds.has(item.id)) problems.push(`${where}：id 重复`);
    caseIds.add(item.id);
    if (!Array.isArray(item.roots) || item.roots.length === 0) problems.push(`${where}：没写要装的节点（roots）`);
    for (const root of item.roots ?? []) {
      if (!Number.isInteger(root.dbnum)) problems.push(`${where}：节点 ${root.refno} 没写库号（dbnum）`);
    }
    const loaded = new Set((item.roots ?? []).map((root) => refnoKey(root.refno)));
    const mustBeLoaded = (at, ids) => {
      for (const id of ids) {
        if (!loaded.has(refnoKey(id))) problems.push(`${at}：${id} 不在要装的节点里`);
      }
    };
    mustBeLoaded(`${where} 的 baselineTruth`, (item.baselineTruth ?? []).map((def) => def.root));
    if (!Array.isArray(item.legs) || item.legs.length === 0) problems.push(`${where}：没有腿（legs）`);
    const legIds = new Set();
    for (const leg of item.legs ?? []) {
      const at = `${where} 的腿 ${leg.id ?? '（没写 id）'}`;
      if (!NAME.test(String(leg.id ?? ''))) problems.push(`${at}：id 只用字母、数字、下划线、短横`);
      if (legIds.has(leg.id)) problems.push(`${at}：id 重复`);
      if (!Array.isArray(leg.command) || leg.command.length === 0 || !leg.command.every((part) => typeof part === 'string' && part !== '')) {
        problems.push(`${at}：腿命令要写成字符串数组（程序在前，参数在后）`);
      } else if (!leg.command.some((part) => part.includes('{{RESULT}}'))) {
        problems.push(`${at}：腿命令里没有 {{RESULT}}（结果文件写到哪）`);
      }
      if (leg.restoreOf && !legIds.has(leg.restoreOf)) problems.push(`${at}：要还原的腿 ${leg.restoreOf} 不在它前面`);
      mustBeLoaded(at, [
        ...Object.keys(leg.affected ?? {}),
        ...(leg.unaffected ?? []),
        ...(leg.controls ?? []),
        ...(leg.truth?.groups ?? []).map((group) => group.root),
        ...(leg.stated?.reload ?? []),
        ...(leg.stated?.moves ?? []).map((move) => move.root),
      ]);
      if ((leg.judge ?? ['W4']).includes('W4') && (leg.truth?.groups ?? []).length === 0) {
        problems.push(`${at}：要判 W4，但没写拿哪几个节点去比（truth.groups）`);
      }
      if (leg.manual !== undefined) {
        // 手动路径：点「取最新」之前先点行上的「更新」——点哪个库的、哪一行上的、后端追上之后行上该出什么，三样都要写
        const manual = leg.manual ?? {};
        const listed = (value) => Array.isArray(value) && value.length > 0;
        if (!Number.isInteger(manual.dbnum)) problems.push(`${at}：手动路径没写点哪个库的「更新」（manual.dbnum）`);
        if (typeof manual.row !== 'string' || manual.row === '') {
          problems.push(`${at}：手动路径没写点哪一行上的「更新」（manual.row）`);
        } else {
          const row = refnoKey(manual.row);
          const root = (item.roots ?? []).find((entry) => refnoKey(entry.refno) === row);
          if (!root) problems.push(`${at}：手动路径要点的行 ${manual.row} 不在要装的节点里`);
          else if (Number.isInteger(manual.dbnum) && root.dbnum !== manual.dbnum) {
            problems.push(`${at}：手动路径要点的行 ${manual.row} 在库 ${root.dbnum}，不在库 ${manual.dbnum}`);
          }
          if (!Object.keys(leg.affected ?? {}).some((id) => refnoKey(id) === row)) {
            problems.push(`${at}：手动路径要点的行 ${manual.row} 不在受影响的节点里（affected），行上不会出「更新」`);
          }
        }
        if (!listed(manual.then?.nodeStatus) && !listed(manual.then?.action)) {
          problems.push(`${at}：手动路径没写后端追上之后行上该出什么（manual.then）`);
        }
      }
      legIds.add(leg.id);
    }
  }
  for (const [dbnum, file] of Object.entries(config.startTruth ?? {})) {
    if (!fs.existsSync(file)) problems.push(`库 ${dbnum} 的起点 E3D 导出不在：${file}`);
  }
  return problems;
}

const wrong = configProblems();
if (wrong.length > 0) refuse(`运行配置不对：\n  ${wrong.join('\n  ')}`);

const wanted = args.case ? args.case.split(',').map((id) => id.trim()).filter(Boolean) : null;
const unknown = (wanted ?? []).filter((id) => !config.cases.some((item) => item.id === id));
if (unknown.length > 0) refuse(`--case 里有运行配置没有的用例：${unknown.join('、')}`);
const selected = wanted ? config.cases.filter((item) => wanted.includes(item.id)) : config.cases;

if (args['check-config']) {
  console.log(`[网页验收] 运行配置没问题：${selected.length} 条用例（${selected.map((item) => item.id).join('、')}）`);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

const report = {
  what: config.what ?? '增量测试：PML 触发 + 网页验收',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  verdict: null,
  exitCode: null,
  config: { file: path.resolve(args.config), page: pageOrigin, backend: backendOrigin, project: config.project, cases: selected.map((item) => item.id) },
  outDir,
  environment: {},
  warmUp: null,
  cases: [],
  notRun: [],
  guard: null,
  error: null,
};

function writeJson(name, value) {
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

function seconds(ms) {
  if (ms === null || ms === undefined) return '（没记到）';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${Math.round(ms)} 毫秒`;
}

function timelineText(states) {
  return states.map((state) => {
    const at = `${(state.atMs / 1000).toFixed(1)} 秒`;
    if (!state.present) return `${at} 行不在`;
    const button = state.action ? `按钮 ${state.action}${state.busy ? '（忙）' : ''}` : '';
    const what = [state.nodeStatus ?? '没有标记', button, state.pending ? '核对中' : '', state.eyeLit ? '' : '眼睛灭'];
    return `${at} ${what.filter(Boolean).join('、')}`;
  }).join(' → ');
}

const RUN_VERDICT = {
  pass: '全部通过',
  'known-gap': '没有「不过」，有已知缺口',
  fail: '有「不过」',
  incomplete: '没跑完',
};

function reportMarkdown() {
  const lines = [];
  const cell = (text) => String(text).replaceAll('|', '／').replaceAll('\n', ' ').slice(0, 400);
  const nameOf = (item, root) => item.roots.find((entry) => entry.refno === root)?.name || root;
  lines.push(`# ${report.what}`, '');
  lines.push(`- 时间：${report.startedAt} → ${report.finishedAt}（${seconds(Date.parse(report.finishedAt) - Date.parse(report.startedAt))}）`);
  lines.push(`- 结论：${RUN_VERDICT[report.verdict] ?? report.verdict}${report.error ? `；出错：${report.error.message}` : ''}`);
  lines.push(`- 页面服务 ${report.config.page}，隔离后端 ${report.config.backend}，工程 ${report.config.project}；页面侧代码 ${report.environment.code?.commit ?? '（没读到）'}`
    + `${(report.environment.code?.uncommitted ?? []).length ? `（另有没提交的文件 ${report.environment.code.uncommitted.length} 个）` : ''}`);
  if (report.guard) {
    lines.push(`- 页面发出的请求 ${report.guard.total} 条：发往 8022 / 8009 的 ${report.guard.toLive} 条，守卫拦下 ${report.guard.blocked} 条；脚本自己问隔离后端 ${report.guard.scriptRequests} 次（只读）`);
  }
  if (report.environment.networkLock) {
    lines.push(`- 浏览器进程的联网锁（不走系统代理，127.0.0.1 以外的主机解析不到）：开跑前验了 ${report.environment.networkLock.probes.length} 个地址——`
      + `${report.environment.networkLock.probes.map((probe) => `${probe.what} ${probe.outcome}`).join('，')}`);
  }
  if (report.notRun.length > 0) lines.push(`- 没跑的用例：${report.notRun.join('、')}（前面有用例没跑完，停了）`);

  lines.push('', '## 总表', '', `| 用例 | 腿 | ${CHECKPOINT_ORDER.join(' | ')} | 这条腿 |`, `| --- | --- | ${CHECKPOINT_ORDER.map(() => '---').join(' | ')} | --- |`);
  for (const item of report.cases) {
    if (item.legs.length === 0) lines.push(`| ${cell(item.id)} | （没开始） | ${CHECKPOINT_ORDER.map(() => '没跑').join(' | ')} | 没跑完 |`);
    for (const leg of item.legs) {
      const cells = CHECKPOINT_ORDER.map((id) => (leg.completed ? leg.judgements[id]?.label ?? '—' : '没跑'));
      lines.push(`| ${cell(item.id)} | ${cell(leg.id)} | ${cells.join(' | ')} | ${leg.completed ? leg.summary.label : '没跑完'} |`);
    }
  }
  for (const id of report.notRun) lines.push(`| ${cell(id)} | （没开始） | ${CHECKPOINT_ORDER.map(() => '没跑').join(' | ')} | 没跑 |`);
  lines.push('', 'W1 存盘后行上出信号；W2 回执的数 = 按后端前后差算的预期；W3 场景 = 后端；W4 场景 = E3D 导出；W5 不该动的没动；W6 页面没有报错、请求只到隔离后端；'
    + 'W7 还原之后回到原样；X 和用例表写明的改动对得上。「—」是这条腿不判这一项。');

  for (const item of report.cases) {
    lines.push('', `## ${item.id}：${item.title}`, '');
    lines.push(`- 结论：${item.completed ? VERDICT_LABEL[item.verdict] ?? item.verdict : '没跑完'}${item.error ? `（${item.error.message}）` : ''}；证据目录 ${item.dir}`);
    lines.push(`- 装的节点：${item.roots.map((root) => `${root.name || root.refno}（${root.refno}，库 ${root.dbnum}）`).join('、')}`);
    const failedChecks = item.checks.filter((entry) => !entry.pass);
    lines.push(`- 开跑前的前提：${item.checks.length} 项，${failedChecks.length === 0 ? '全过' : `${failedChecks.length} 项没过`}`);
    for (const entry of item.checks) lines.push(`  - ${entry.pass ? '过' : '不过'}：${entry.name}${entry.detail ? `（${cell(entry.detail)}）` : ''}`);
    if (item.guard) lines.push(`- 这条用例页面发了 ${item.guard.total} 条请求：发往 8022 / 8009 的 ${item.guard.toLive} 条，守卫拦下 ${item.guard.blocked} 条`);
    for (const leg of item.legs) {
      lines.push('', `### ${item.id} / ${leg.id}：${leg.title}`, '');
      if (!leg.completed) {
        lines.push(`- 没跑完：${leg.error}`);
        if (leg.command) lines.push(`- 腿命令退出 ${leg.command.code}，用时 ${seconds(leg.command.ms)}${leg.legResult?.evidence ? `；那一侧的证据 ${leg.legResult.evidence}` : ''}`);
        continue;
      }
      const sessions = leg.command.libraries.map((library) => `库 ${library.dbnum} 会话 ${library.before} → ${library.after}`).join('，');
      lines.push(`- 腿命令：用时 ${seconds(leg.command.ms)}（${leg.command.steps.map((step) => `${step.spec} ${step.seconds} 秒`).join('；')}）；${sessions}`);
      lines.push(`  - 那一侧的证据：${leg.command.evidence}`);
      for (const [root, ms] of Object.entries(leg.durations.saveToSignalMs ?? {})) {
        lines.push(`- 存盘完成 → 行上出信号：${nameOf(item, root)} ${ms === null ? '没等到' : seconds(ms)}（时限 ${SIGNAL_WINDOW_MS / 1000} 秒）`);
      }
      for (const [dbnum, follow] of Object.entries(leg.follow ?? {})) {
        lines.push(`- 存盘完成 → 后端跟上这次存盘（库 ${dbnum} 的会话 ${follow.target}）：看见文件 ${seconds(follow.fileSeenMs)}，数据 ${seconds(follow.appliedMs)}，模型 ${seconds(follow.modelMs)}`);
      }
      if (leg.manual) {
        // 手动路径：后端不自动跟库，点「取最新」之前先点行上的「更新」。上面「后端跟上」的用时里包着等这一下的工夫
        const manual = leg.manual;
        const levels = (row) => (row ? `文件 ${row.file} / 数据 ${row.applied} / 模型 ${row.model}` : '（没采到）');
        const rowText = (row) => (row ? `${row.nodeStatus ?? '没有标记'}${row.action ? `、按钮 ${row.action}${row.busy ? '（忙）' : ''}` : '、没有按钮'}` : '行不在');
        const notReached = '（没走到这一步）';
        lines.push(`- 手动路径（后端不自动跟库 ${manual.dbnum}，先点 ${nameOf(item, manual.row)} 行上的「更新」）：`);
        lines.push(`  - 后端这个库的水位：存盘之前 ${levels(manual.libraryBefore)}；点「更新」之前 ${levels(manual.libraryAtClick)}`);
        lines.push(`  - 存盘完成 → 点「更新」：${seconds(manual.durations.saveToUpdateClickMs)}；那一刻行上是 ${rowText(manual.rowAtClick)}`);
        lines.push(`  - 点上没有：${!manual.offered ? '行上没有「更新」，没点' : manual.clicked ? '点上了' : `没点上${manual.error ? `（${cell(manual.error)}）` : ''}`}`
          + `；确认框：${!manual.clicked ? notReached : manual.confirmed ? '出了，点了确定' : '没等到'}`);
        lines.push(`  - 后端的答复：${manual.request ? `${manual.request.status ?? '没有答复'}，${manual.request.accepted ? '受理' : '没受理'}（${cell(manual.request.reason)}）` : notReached}`);
        const caught = manual.caughtUp;
        lines.push(`  - 点「更新」→ 后端追上：${!caught ? notReached : caught.ok
          ? `数据 ${seconds(caught.appliedMs)}，模型 ${seconds(caught.modelMs)}（${levels(caught.library)}）`
          : `${seconds(caught.waitedMs)} 没追上（${levels(caught.library)}）`}`);
        const wanted = Object.entries(manual.wantAfter ?? {}).map(([root, want]) => `${nameOf(item, root)} ${[...(want.nodeStatus ?? []), ...(want.action ?? []).map((name) => `按钮 ${name}`)].join('、')}`).join('；');
        lines.push(`  - 点「更新」→ 行上出预期的信号（${wanted}）：${!caught?.ok ? notReached : manual.durations.updateClickToSignalMs === null ? '没等到' : seconds(manual.durations.updateClickToSignalMs)}`
          + `；点「取最新」之前行上是 ${Object.entries(manual.rowsAfter ?? {}).map(([root, row]) => `${nameOf(item, root)} ${rowText(row)}`).join('；')}`);
        lines.push(`  - 页面自己记的这次更新（只记不判）：${manual.pageState ? `${manual.pageState.phase}（${cell(manual.pageState.message)}）` : '没有'}`);
        lines.push(`  - 点「更新」→ 点「取最新」：${seconds(manual.durations.updateClickToGetWorkMs)}`);
      }
      lines.push(`- 存盘完成 → 点「取最新」：${seconds(leg.durations.saveToClickMs)}；取最新用时 ${seconds(leg.durations.clickMs)}；整条腿 ${seconds(leg.durations.legMs)}`);
      lines.push(`- 回执：${leg.receipt?.summary ?? '（没有）'}`);
      lines.push('- 行的变化（从存盘完成算起，负的是存盘之前）：');
      for (const [root, states] of Object.entries(leg.timeline)) lines.push(`  - ${nameOf(item, root)}：${timelineText(states)}`);
      if (leg.truth) {
        lines.push(`- E3D 真值：这条腿导出的 ${leg.truth.element ?? ''}（导出时各库的会话 ${JSON.stringify(leg.truth.sesnoAtExport)}）`);
        lines.push(`  - 快照：${leg.truth.snapshot}`);
      }
      if (leg.required) lines.push(`- 规格要求这条腿判：${leg.required.join('、')}；其余是多判的`);
      lines.push('- 判定：');
      for (const [id, judgement] of Object.entries(leg.judgements)) {
        lines.push(`  - ${id} ${judgement.title}：${judgement.label}`);
        for (const problem of judgement.problems.slice(0, 8)) lines.push(`    - 不过：${problem.message}`);
        for (const hit of judgement.gaps.slice(0, 8)) lines.push(`    - 已知缺口 ${hit.gap}：${hit.message}`);
      }
      for (const note of leg.notes) lines.push(`- 备注：${note}`);
      if (leg.camera) {
        const by = (mm) => (mm === null || mm === undefined ? '（没读到）' : `${Math.round(mm)} mm`);
        const unsettled = [leg.camera.beforeClick, leg.camera.afterClick].some((pose) => pose?.atRest === false) ? '（读的时候相机还没停住，幅度只作参考）' : '';
        if (leg.camera.moved === null) {
          lines.push('- 相机（只记不判）：位姿没读到，不知道点「取最新」前后动没动');
        } else if (leg.camera.moved) {
          lines.push(`- 相机（只记不判）：点「取最新」前后动了——位置挪了 ${by(leg.camera.positionByMm)}，看向的点挪了 ${by(leg.camera.targetByMm)}，朝向转了 ${leg.camera.turnedDeg.toFixed(2)}°，`
            + `离看向的点 ${by(leg.camera.viewDistanceMm.before)} → ${by(leg.camera.viewDistanceMm.after)}${unsettled}`);
        } else {
          lines.push(`- 相机（只记不判）：点「取最新」前后没动${unsettled}`);
        }
      }
      const span = item.legs.indexOf(leg) === 0 ? '从开页面到这条腿判完' : '从上一条腿判完到这条腿判完';
      lines.push(`- ${span}，页面发了 ${leg.requests.total} 条请求：发往 8022 / 8009 的 ${leg.requests.toLive} 条，守卫拦下 ${leg.requests.blocked} 条`);
      lines.push(`- 证据文件：${[leg.files.judgements, leg.files.record, leg.files.requests, ...leg.files.shots].join('、')}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

let browser = null;
const backend = createBackend(backendOrigin);
const warmLog = { requests: 0, toLive: 0, blocked: 0 };

try {
  const health = await backend.health();
  report.environment = {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    tmpdir: os.tmpdir(),
    code: await codeState(),
    backendHealth: { status: health.status ?? null, version: health.version ?? null },
  };
  browser = await launchBrowser({ headed: args.headed, cacheDir, channel: config.browser?.channel ?? 'chrome' });
  report.environment.browser = `${config.browser?.channel ?? 'chrome'} ${browser.version()}`;
  report.environment.networkLock = networkLockOf(browser);
  const target = { pageOrigin, backendOrigin, project: config.project, query: config.query ?? {} };

  // 预开一遍：页面服务刚起来时，Vite 会边开边补打包依赖、让页面自己重新载入。把正式那一页要走的路（展开、装节点、取最新）
  // 先在另一页上走一遍，等它消停了关掉；各用例另开新的一页，W6 从那一页打开算起
  const first = selected[0];
  const warmRoots = first.roots.map((root) => ({ refno: refnoKey(root.refno), dbnum: root.dbnum }));
  const warmFrom = Date.now();
  let warmAttempts = 0;
  for (;;) {
    warmAttempts += 1;
    const guarded = await createGuardedContext(browser, { pageOrigin, backendOrigin, viewport: config.browser?.viewport });
    const warm = await newPage(guarded.context, guarded.log);
    try {
      await openApp(warm, target);
      await expandTree(warm, guarded.log, first.expand ?? []);
      await loadRoots(warm, guarded.log, warmRoots);
      await clickGetWork(warm, guarded.log);
      await sleep(config.warmUpSettleMs ?? 3000);
      break;
    } catch (error) {
      if (warmAttempts >= 3) throw new Error(`预开页面 3 次都没走完：${String(error.message).slice(0, 300)}`);
      console.log(`[网页验收] 预开页面第 ${warmAttempts} 次没走完（${String(error.message).slice(0, 160)}），再来一次`);
      await sleep(3000);
    } finally {
      warmLog.requests += guarded.log.requests.length;
      warmLog.toLive += guarded.log.toLive.length;
      warmLog.blocked += guarded.log.blocked.length;
      await guarded.context.close().catch(() => undefined);
    }
  }
  report.warmUp = { attempts: warmAttempts, ms: Date.now() - warmFrom, ...warmLog };

  const env = {
    browser,
    pageOrigin,
    backendOrigin,
    project: config.project,
    query: config.query ?? {},
    backend,
    sceneToMm: config.sceneToMm ?? 1000,
    ignoreErrors: config.ignoreErrors ?? [],
    knownGaps: loadKnownGaps(),
    startTruth: config.startTruth ?? {},
    viewport: config.browser?.viewport,
    commandTimeoutMs: config.commandTimeoutMs,
  };
  for (const [index, caseDef] of selected.entries()) {
    const caseDir = path.join(outDir, caseDef.id);
    fs.mkdirSync(caseDir, { recursive: true });
    console.log(`[网页验收] 用例 ${caseDef.id}：${caseDef.title ?? ''}`);
    const record = await runCase({ ...env, say: (text) => console.log(`[网页验收] [${caseDef.id}] ${text}`) }, caseDef, caseDir);
    report.cases.push(record);
    console.log(`[网页验收] 用例 ${caseDef.id}：${record.completed ? VERDICT_LABEL[record.verdict] ?? record.verdict : '没跑完'}`);
    if (!record.completed) {
      report.notRun = selected.slice(index + 1).map((item) => item.id);
      break;
    }
  }
} catch (error) {
  report.error = { message: String(error?.message ?? error).slice(0, 1000), stack: String(error?.stack ?? '').slice(0, 3000) };
  console.error(`[网页验收] 出错：${report.error.message}`);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  const sum = (name) => report.cases.reduce((total, item) => total + (item.guard?.[name] ?? 0), 0);
  report.guard = {
    total: sum('total') + warmLog.requests,
    toLive: sum('toLive') + warmLog.toLive,
    blocked: sum('blocked') + warmLog.blocked,
    scriptRequests: backend.stats.requests,
    scriptPaths: backend.stats.byPath,
  };
  report.finishedAt = new Date().toISOString();
  const verdicts = report.cases.map((item) => item.verdict);
  if (report.error || report.cases.length === 0 || verdicts.includes('incomplete')) report.verdict = 'incomplete';
  else if (verdicts.includes('fail')) report.verdict = 'fail';
  else if (verdicts.includes('known-gap')) report.verdict = 'known-gap';
  else report.verdict = 'pass';
  report.exitCode = report.verdict === 'incomplete' ? 2 : report.verdict === 'fail' ? 1 : 0;
  writeJson('report.json', report);
  fs.writeFileSync(path.join(outDir, 'report.md'), reportMarkdown(), 'utf8');
  console.log(`[网页验收] 结论：${RUN_VERDICT[report.verdict]}；报告在 ${outDir}`);
  process.exitCode = report.exitCode;
}
