/**
 * 一条用例跑一个来回（gen-model 计划 AD-6 的次序）：开页面、装节点、记「之前」→ 每条腿：调外面给的命令存盘并导出 →
 * 不碰页面等行上的信号 → 等后端跟上 → 点一次「取最新」→ 判 → 落证据。腿的流程在 `leg.mjs`，这里管它前后的事：
 * 开跑前的前提、腿命令、W4（场景 = E3D）、和用例表写明的改动对一遍（X）、每条腿的证据文件。
 *
 * 腿命令是运行配置里写好的一条外部命令（字符串数组，不过 shell），由开 E3D 的那一侧给；这里不认识 E3D，也不带那一侧的路径。
 * 命令行里的 `{{RESULT}}` 换成结果文件的位置，命令跑完要在那里写一份 JSON（`schema: increment-web-leg/1`），这里读它的：
 *
 *   ok              整批过没过
 *   saved_at_ms     存盘完成的时刻（毫秒）
 *   libraries[]     { dbnum, before, after }：各库在这一批前后的会话号（变了的库要等后端跟到 after）
 *   steps[]         各步；写步的 dbs、sesno_before 用来算「后端多久跟上这次存盘」
 *   truth           { snapshot, element, dbnum, sesno_at_export, sesno_after_export }：这一批导出的 RVM 快照（W4 的真值）
 *   evidence        那一侧自己的证据目录（报告里按路径引用，不复制）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { sleep } from './backend.mjs';
import { judgeW3, judgeW4, refnoKey, summarize, VERDICT_LABEL } from './judge.mjs';
import { observeBackend, observePage, runLeg, sceneForJudging, sceneTruth } from './leg.mjs';
import {
  cameraChange,
  clickGetWork,
  createGuardedContext,
  expandTree,
  fetchedLayers,
  loadRoots,
  maskText,
  newPage,
  openApp,
  readCamera,
  readLoadedLayerCount,
  readTreeTops,
  requestSummary,
} from './page.mjs';
import { loadRvmSnapshot, membersUnder, truthBoxes } from './rvm.mjs';

export const LEG_RESULT_SCHEMA = 'increment-web-leg/1';
export const CHECKPOINT_ORDER = Object.freeze(['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'X']);

const SENSITIVE_LINE = /login|passw|-user|username|secret|token/i;
const COMMAND_TIMEOUT_MS = 75 * 60_000;
const MOVE_TOLERANCE_MM = 1;
const LINEAR_TOLERANCE = 1e-4;
const TREE_LISTS = ['added', 'deleted', 'renamed', 'moved'];

const round3 = (value) => Number(value.toFixed(3));
const keys = (values) => [...new Set((values ?? []).map(refnoKey))].sort();

/**
 * 跑一条外部命令（不过 shell），输出逐行收下：像凭据、登录的行不留，其余的把地址里的敏感参数打码。
 * 到时限不杀进程（那一侧开的东西归那一侧管），只是不再等。
 *
 * @param {string[]} argv 程序在前，参数在后
 * @param {{ timeoutMs?: number, onLine?: (line: string) => void }} [options]
 * @returns {Promise<{ code: number | null, timedOut: boolean, ms: number, lines: string[], dropped: number }>}
 */
export function runLegCommand(argv, { timeoutMs = COMMAND_TIMEOUT_MS, onLine = () => undefined } = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((part) => typeof part === 'string' && part !== '')) {
    throw new TypeError('腿命令要写成字符串数组（程序在前，参数在后）');
  }
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const lines = [];
    let dropped = 0;
    let settled = false;
    let timer = null;
    const child = spawn(argv[0], argv.slice(1), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const keep = (line) => {
      if (line.trim() === '') return;
      if (SENSITIVE_LINE.test(line)) {
        dropped += 1;
        return;
      }
      const shown = maskText(line).slice(0, 2000);
      if (lines.length < 2000) lines.push(shown);
      onLine(shown);
    };
    const reader = (stream) => {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        const parts = (rest + chunk).split(/\r?\n/);
        rest = parts.pop();
        for (const part of parts) keep(part);
      });
      return () => {
        if (rest) keep(rest);
        rest = '';
      };
    };
    const flushOut = reader(child.stdout);
    const flushErr = reader(child.stderr);
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      flushOut();
      flushErr();
      resolve({ ...outcome, ms: Date.now() - startedAt, lines, dropped });
    };
    timer = setTimeout(() => {
      child.unref();
      child.stdout.unref?.();
      child.stderr.unref?.();
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`腿命令起不来（${argv[0]}）：${error.message}`));
    });
    child.on('close', (code) => finish({ code, timedOut: false }));
  });
}

/** 读腿命令写的结果文件 */
export function readLegResult(file) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`腿命令的结果读不出来（${file}）：${error.message}`);
  }
  if (raw?.schema !== LEG_RESULT_SCHEMA) throw new Error(`腿命令的结果不是认识的格式（schema = ${raw?.schema}）`);
  return raw;
}

/**
 * 腿进行当中隔一阵问一次后端各库的水位，变了就记一笔（只读）。用来算「存盘之后后端多久跟上」：腿的流程自己要等到
 * 整批跑完才开始问，那时后端多半早就跟上了。
 */
export function watchLibraries(backend, dbnums, intervalMs = 500) {
  const changes = [];
  const last = {};
  let failures = 0;
  let current = null;
  const ask = async () => {
    try {
      const levels = await backend.libraries();
      const t = Date.now();
      for (const dbnum of dbnums) {
        const row = levels[dbnum];
        const key = row ? `${row.file}/${row.applied}/${row.model}` : 'none';
        if (last[dbnum] === key) continue;
        last[dbnum] = key;
        changes.push({ t, dbnum, file: row?.file ?? null, applied: row?.applied ?? null, model: row?.model ?? null });
      }
    } catch {
      failures += 1;
    }
  };
  const tick = () => {
    if (current) return;
    current = ask().finally(() => {
      current = null;
    });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      if (current) await current;
      return { changes, failures };
    },
  };
}

/** 从水位的变化记录里找：某个库的三枚水位各自头一次到（或过了）`target` 是什么时候，从 `since` 算起 */
export function followTimes(changes, dbnum, target, since) {
  const first = (name) => {
    const hit = changes.find((change) => change.dbnum === dbnum && change[name] !== null && change[name] >= target);
    return hit ? hit.t - since : null;
  };
  return { target, fileSeenMs: first('file'), appliedMs: first('applied'), modelMs: first('model') };
}

/**
 * 拼 W4 的分组：每个要比的根，一边是场景里它名下各构件的包围盒，一边是 E3D 导出里它下面带几何的成员。
 * `per-item` 逐件比。有参考号的按参考号；没有参考号但快照写了 `compare_key` 的（`tube:` / `path:`）按那把键，不再列进 `unplaced`。
 * 两样都没有的成员才列进 `unplaced`（W4 会判不过；旧快照没有 `compare_key` 时仍是这样，这种根继续用 `count-union`）。
 * `count-union` 比件数和合起来的包围盒，用的是构件合盒，不拆管段。
 *
 * @param {object} snapshot `loadRvmSnapshot()` 的结果
 * @param {{ root: string, mode?: 'per-item' | 'count-union' }[]} defs
 * @param {Record<string, Record<string, number[]>>} sceneBoxes 根 → 构件 → 包围盒（mm），count-union 用它
 * @param {Record<string, string>} [nameOf] 根 → 报告里用的名字
 * @param {Record<string, Record<string, number[]>> | null} [perItemBoxes] 根 → 逐件键（含 `tube:`）→ 包围盒。给了才在 per-item 里用；不给就仍用构件合盒
 */
export function truthGroups(snapshot, defs, sceneBoxes, nameOf = {}, perItemBoxes = undefined) {
  const groups = [];
  const unplaced = [];
  const facts = [];
  const useItems = perItemBoxes != null;
  for (const def of defs ?? []) {
    const root = refnoKey(def.root);
    const name = nameOf[root] ?? root;
    const mode = def.mode ?? 'per-item';
    const members = membersUnder(snapshot, root);
    const truth = truthBoxes(members);
    const componentScene = sceneBoxes?.[root] ?? {};
    const scene = mode === 'per-item' && useItems ? (perItemBoxes[root] ?? {}) : componentScene;
    facts.push({
      root,
      name,
      mode,
      inExport: members.length > 0,
      withRefno: Object.keys(truth.byRefno).length,
      anonymous: truth.anonymous.length,
      inScene: Object.keys(scene).length,
    });
    if (mode === 'per-item') {
      groups.push({ name, mode, scene, truth: truth.byRefno });
      for (const item of truth.anonymous) {
        if (item.compareKey) continue;
        unplaced.push(`${name}：${item.path}（认不出参考号，逐件比不了）`);
      }
    } else if (mode === 'count-union') {
      groups.push({ name, mode, scene: Object.values(componentScene), truth: [...Object.values(truth.byRefno), ...truth.anonymous.map((item) => item.box)] });
    } else {
      throw new TypeError(`W4：不认识的比法 ${mode}`);
    }
  }
  return { groups, unplaced, facts };
}

/** 两份「构件 → 包围盒」前后挪了多少：名单要一样，每个盒子的六个分量都正好挪了 `byMm` */
function boxMove(what, before, after, byMm, toleranceMm) {
  const problems = [];
  const wasIds = Object.keys(before ?? {}).sort();
  const nowIds = Object.keys(after ?? {}).sort();
  const facts = { items: wasIds.length, compared: 0, movedMm: null, worstOffMm: 0 };
  if (wasIds.length === 0 || wasIds.join(' ') !== nowIds.join(' ')) {
    problems.push({
      code: 'stated-move-items',
      message: wasIds.length === 0
        ? `${what}：之前一件带几何的都没有`
        : `${what}：前后带几何的件不是同一批（之前 ${wasIds.length} 件，之后 ${nowIds.length} 件）`,
      actual: nowIds,
      expected: wasIds,
    });
  }
  const want = [...byMm, ...byMm];
  for (const id of wasIds) {
    if (!after?.[id]) continue;
    const moved = after[id].map((value, index) => value - before[id][index]);
    const off = Math.max(...moved.map((value, index) => Math.abs(value - want[index])));
    facts.compared += 1;
    facts.movedMm ??= moved.map(round3);
    facts.worstOffMm = Math.max(facts.worstOffMm, round3(off));
    if (off > toleranceMm && problems.length < 6) {
      problems.push({
        code: 'stated-move',
        message: `${what}：${id} 的包围盒挪了 [${moved.map((value) => value.toFixed(2)).join(', ')}]，用例表写的是 [${want.join(', ')}]`,
        actual: moved.map(round3),
        expected: want,
      });
    }
  }
  return { problems, facts };
}

function sortedInstances(entry, id) {
  const matrices = entry?.components?.[id] ?? [];
  const geometry = entry?.geometry?.[id] ?? [];
  return matrices
    .map((m, index) => ({ geo: String(geometry[index] ?? ''), m }))
    .sort((a, b) => a.geo.localeCompare(b.geo) || a.m[12] - b.m[12] || a.m[13] - b.m[13] || a.m[14] - b.m[14]);
}

/** 后端记录前后挪了多少：根名下带几何的构件要是同一批，每个实例的矩阵只有平移变了，且正好是 `byMm` */
function backendMove(what, before, after, byMm, toleranceMm) {
  const problems = [];
  const wasIds = Object.keys(before?.components ?? {}).sort();
  const nowIds = Object.keys(after?.components ?? {}).sort();
  const facts = { components: wasIds.length, instances: 0, movedMm: null, worstOffMm: 0 };
  if (wasIds.length === 0 || wasIds.join(' ') !== nowIds.join(' ')) {
    problems.push({
      code: 'stated-move-items',
      message: wasIds.length === 0
        ? `${what}：之前名下一个带几何的构件都没有`
        : `${what}：前后带几何的构件不是同一批（之前 ${wasIds.length} 个，之后 ${nowIds.length} 个）`,
      actual: nowIds,
      expected: wasIds,
    });
  }
  for (const id of wasIds) {
    if (!after?.components?.[id]) continue;
    const was = sortedInstances(before, id);
    const now = sortedInstances(after, id);
    if (was.length !== now.length) {
      if (problems.length < 6) {
        problems.push({ code: 'stated-move-items', message: `${what}：${id} 的几何实例数变了（${was.length} → ${now.length}）`, actual: now.length, expected: was.length });
      }
      continue;
    }
    was.forEach((item, index) => {
      const other = now[index];
      const moved = [0, 1, 2].map((axis) => other.m[12 + axis] - item.m[12 + axis]);
      const off = Math.max(...moved.map((value, axis) => Math.abs(value - byMm[axis])));
      const turned = Math.max(...item.m.slice(0, 12).map((value, i) => Math.abs(other.m[i] - value)));
      facts.instances += 1;
      facts.movedMm ??= moved.map(round3);
      facts.worstOffMm = Math.max(facts.worstOffMm, round3(off));
      if ((off > toleranceMm || turned > LINEAR_TOLERANCE || item.geo !== other.geo) && problems.length < 6) {
        problems.push({
          code: 'stated-move',
          message: `${what}：${id} 挪了 [${moved.map((value) => value.toFixed(2)).join(', ')}]${turned > LINEAR_TOLERANCE ? '，朝向或尺寸也变了' : ''}${item.geo !== other.geo ? '，几何也换了' : ''}，用例表写的是只挪 [${byMm.join(', ')}]`,
          actual: moved.map(round3),
          expected: byMm,
        });
      }
    });
  }
  return { problems, facts };
}

/**
 * X 和用例表写明的改动对得上（计划 AD-7 的第三个来源）：预期值是按后端前后的差、按 E3D 的导出算的，这两样要是自己就不对
 * （宏没按写的改、后端算错了），W2–W4 会跟着错的预期一起「过」。所以拿用例表里写死的改动再对一遍：
 *
 * - `tree: 'unchanged'`：后端前后的差里树没有变；
 * - `reload`（`withdrawn`）：按后端前后的差，名下的模型变了（没了）的根正好是这几个；
 * - `moves[]`：根名下的构件在后端记录里、在 E3D 前后两次导出里，都正好挪了 `byMm`（场景里挪了多少只记，它由 W3、W4 判）。
 *
 * @param {object} input
 * @param {{ tree?: 'unchanged', reload?: string[], withdrawn?: string[], moves?: { root: string, byMm: number[], toleranceMm?: number }[] }} [input.stated]
 * @param {object} input.expected 腿的流程按后端前后的差算出来的预期（`tree`、`reload`、`withdrawn`）
 * @param {Record<string, object>} [input.backendBefore] 根 → 存盘之前的后端记录
 * @param {Record<string, object>} [input.backendAfter]
 * @param {Record<string, Record<string, number[]>> | null} [input.truthBefore] 根 → 构件 → 上一份 E3D 导出里的包围盒
 * @param {Record<string, Record<string, number[]>> | null} [input.truthAfter] 这条腿的导出；这条腿没有导出就给 `null`，E3D 那一项不比
 * @param {Record<string, Record<string, number[]>>} [input.sceneBefore]
 * @param {Record<string, Record<string, number[]>>} [input.sceneAfter]
 */
export function judgeStated(input) {
  const title = '和用例表写明的改动对得上';
  const stated = input.stated;
  if (!stated) {
    return {
      id: 'X',
      title,
      verdict: 'not-applicable',
      label: VERDICT_LABEL['not-applicable'],
      problems: [],
      gaps: [],
      facts: { reason: '用例表没有写这条腿的改动' },
    };
  }
  const problems = [];
  const facts = {};
  const expected = input.expected ?? {};

  if (stated.tree === 'unchanged') {
    const tree = expected.tree ?? {};
    facts.tree = Object.fromEntries(TREE_LISTS.map((name) => [name, (tree[name] ?? []).length]));
    const changed = TREE_LISTS.filter((name) => facts.tree[name] > 0);
    if (changed.length > 0) {
      problems.push({
        code: 'stated-tree',
        message: `用例表写的是树不变，按后端前后的差树变了（${changed.map((name) => `${name} ${facts.tree[name]} 个`).join('、')}）`,
        actual: Object.fromEntries(TREE_LISTS.map((name) => [name, tree[name] ?? []])),
        expected: 'unchanged',
      });
    }
  } else if (stated.tree !== undefined) {
    throw new TypeError(`X：不认识的 tree 写法 ${stated.tree}`);
  }

  for (const [name, code, what] of [['reload', 'stated-reload', '变了'], ['withdrawn', 'stated-withdrawn', '没了']]) {
    if (stated[name] === undefined && !(name === 'withdrawn' && stated.reload !== undefined)) continue;
    const want = keys(stated[name] ?? []);
    const got = keys(Object.keys(expected[name] ?? {}));
    facts[name] = got;
    if (want.join(' ') !== got.join(' ')) {
      problems.push({
        code,
        message: `用例表写的是 ${want.join('、') || '（没有）'} 名下的模型${what}，按后端前后的差是 ${got.join('、') || '（没有）'}`,
        actual: got,
        expected: want,
      });
    }
  }

  if ((stated.moves ?? []).length > 0) facts.moves = [];
  for (const move of stated.moves ?? []) {
    const root = refnoKey(move.root);
    const byMm = move.byMm;
    if (!Array.isArray(byMm) || byMm.length !== 3 || !byMm.every((value) => Number.isFinite(value))) {
      throw new TypeError(`X：${root} 的 byMm 要写成三个数（东、北、上，mm）`);
    }
    const tolerance = move.toleranceMm ?? MOVE_TOLERANCE_MM;
    const fact = { root, byMm, toleranceMm: tolerance };

    const backendSide = backendMove(`${root} 的后端记录`, input.backendBefore?.[root], input.backendAfter?.[root], byMm, tolerance);
    problems.push(...backendSide.problems);
    fact.backend = backendSide.facts;

    if (!input.truthAfter) {
      fact.e3d = null;
    } else if (!input.truthBefore?.[root]) {
      fact.e3d = null;
      problems.push({
        code: 'stated-move-no-previous-truth',
        message: `${root}：没有上一份 E3D 导出，比不了它在 E3D 里挪了多少`,
        actual: null,
        expected: '上一份导出（头一条腿是起点的那份）',
      });
    } else {
      const e3dSide = boxMove(`${root} 在 E3D 前后两次导出里`, input.truthBefore[root], input.truthAfter[root], byMm, tolerance);
      problems.push(...e3dSide.problems);
      fact.e3d = e3dSide.facts;
    }

    const sceneSide = boxMove(`${root} 在场景里`, input.sceneBefore?.[root], input.sceneAfter?.[root], byMm, tolerance);
    fact.scene = { ...sceneSide.facts, asStated: sceneSide.problems.length === 0 };
    facts.moves.push(fact);
  }

  const verdict = problems.length > 0 ? 'fail' : 'pass';
  return { id: 'X', title, verdict, label: VERDICT_LABEL[verdict], problems, gaps: [], facts };
}

export function receiptBrief(receipt) {
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

export function judgementBrief(judgement) {
  return {
    title: judgement.title,
    verdict: judgement.verdict,
    label: judgement.label,
    problems: judgement.problems.map((problem) => ({ code: problem.code, message: problem.message })),
    gaps: judgement.gaps.map((hit) => ({ gap: hit.gap, message: hit.message })),
    facts: judgement.facts,
  };
}

export function verdictText(judgement) {
  if (!judgement) return '没有判';
  const first = judgement.problems[0]?.message ?? judgement.gaps[0]?.message ?? '';
  const more = judgement.problems.length + judgement.gaps.length;
  return `${judgement.label}${first ? `：${first}${more > 1 ? `（共 ${more} 条）` : ''}` : ''}`;
}

const isFollowed = (row) => !!row && row.initialized === true && row.excluded !== true;
const isLevel = (row) => isFollowed(row) && row.file !== null && row.file === row.applied && row.applied === row.model;
const levelText = (row) => (row
  ? `文件 ${row.file} / 数据 ${row.applied} / 模型 ${row.model}${row.initialized ? '' : '（未初始化）'}${row.excluded ? '（不在更新范围）' : ''}`
  : '后端没有这个库');

/** 等这几个库在后端上三枚水位齐平（上一条用例的尾巴可能还没消化完） */
async function waitLevel(backend, dbnums, timeoutMs) {
  const from = Date.now();
  for (;;) {
    const levels = await backend.libraries();
    const uneven = dbnums.filter((dbnum) => !isLevel(levels[dbnum]));
    if (uneven.length === 0 || Date.now() - from >= timeoutMs) return { levels, uneven, waitedMs: Date.now() - from };
    await sleep(2000);
  }
}

/**
 * 跑一条用例。前提没过、腿命令没过、中途出错都算「没跑完」（`completed: false`），不算判定不过；记录和证据照样落在 `caseDir`。
 *
 * @param {object} env 这一次运行共用的东西
 * @param {import('playwright').Browser} env.browser
 * @param {string} env.pageOrigin
 * @param {string} env.backendOrigin
 * @param {string} env.project
 * @param {object} [env.query]
 * @param {object} env.backend `createBackend` 的结果
 * @param {number} [env.sceneToMm]
 * @param {{ pattern: string, reason: string }[]} [env.ignoreErrors]
 * @param {object[]} [env.knownGaps]
 * @param {Record<string, string>} [env.startTruth] 库 → 起点的 RVM 快照文件（没改过的副本在 E3D 里的样子）
 * @param {{ width: number, height: number }} [env.viewport]
 * @param {number} [env.commandTimeoutMs]
 * @param {(text: string) => void} [env.say]
 * @param {object} caseDef 运行配置里的一条用例（`id`、`roots`、`expand`、`baselineTruth`、`legs`）
 * @param {string} caseDir 这条用例的证据目录（已经建好）
 */
export async function runCase(env, caseDef, caseDir) {
  const say = env.say ?? (() => undefined);
  const backend = env.backend;
  const roots = caseDef.roots.map((root) => ({ refno: refnoKey(root.refno), dbnum: root.dbnum, name: root.name ?? '' }));
  const rootIds = roots.map((root) => root.refno);
  const dbnums = [...new Set(roots.map((root) => root.dbnum))];
  const nameOf = Object.fromEntries(roots.map((root) => [root.refno, root.name || root.refno]));
  const dbnumOf = Object.fromEntries(roots.map((root) => [root.refno, root.dbnum]));
  const record = {
    id: caseDef.id,
    title: caseDef.title ?? '',
    dir: caseDir,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    completed: false,
    verdict: 'incomplete',
    error: null,
    roots,
    expand: caseDef.expand ?? [],
    setup: {},
    checks: [],
    legs: [],
    guard: null,
  };
  const writeJson = (name, value, indent = 2) => {
    fs.writeFileSync(path.join(caseDir, name), `${JSON.stringify(value, null, indent)}\n`, 'utf8');
  };
  const check = (name, pass, detail = '') => {
    const ok = pass === true;
    const text = String(detail);
    record.checks.push({ name, pass: ok, detail: text.slice(0, 2000) });
    say(`前提${ok ? '过' : '不过'}：${name}${text ? ` | ${text.slice(0, 300)}` : ''}`);
  };
  // 各库最近一份 E3D 导出：开头是起点的那份，每条腿导出之后换成新的（X 要比前后两次导出）
  const truthState = Object.fromEntries(Object.entries(env.startTruth ?? {}).map(([dbnum, file]) => [dbnum, { file, from: '起点', snapshot: null }]));
  const truthOf = (dbnum) => {
    const entry = truthState[dbnum];
    if (!entry) return null;
    entry.snapshot ??= loadRvmSnapshot(entry.file);
    return entry;
  };

  let context = null;
  let log = null;
  let shot = async () => undefined;
  try {
    // 后端先到位
    const level = await waitLevel(backend, dbnums, caseDef.levelWaitMs ?? 60_000);
    record.setup.librariesAtStart = Object.fromEntries(dbnums.map((dbnum) => [dbnum, level.levels[dbnum] ?? null]));
    check('要装的节点所在的库，后端上三枚水位齐平', level.uneven.length === 0, dbnums.map((dbnum) => `库 ${dbnum}：${levelText(level.levels[dbnum])}`).join('；'));
    if (level.uneven.length > 0) throw new Error(`前提没过：库 ${level.uneven.join('、')} 在后端上的水位不齐平`);

    // 开页面、展开、装节点：每条用例一个新的浏览器上下文，请求和报错的记录按用例分开
    const guarded = await createGuardedContext(env.browser, { pageOrigin: env.pageOrigin, backendOrigin: env.backendOrigin, viewport: env.viewport });
    context = guarded.context;
    log = guarded.log;
    const page = await newPage(context, log);
    shot = async (name) => {
      try {
        await page.screenshot({ path: path.join(caseDir, `${name}.png`) });
      } catch (error) {
        say(`截图 ${name} 没成：${String(error.message).slice(0, 120)}`);
      }
    };
    const openedAt = Date.now();
    await openApp(page, { pageOrigin: env.pageOrigin, backendOrigin: env.backendOrigin, project: env.project, query: env.query ?? {} });
    await expandTree(page, log, caseDef.expand ?? []);
    await loadRoots(page, log, roots);
    record.setup.openedAt = openedAt;
    record.setup.loadMs = Date.now() - openedAt;

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
      sceneToMm: env.sceneToMm ?? 1000,
      ignoreErrors: env.ignoreErrors ?? [],
      knownGaps: env.knownGaps,
      // 写了才收紧 W2/W5。没写时 runLeg 不带这两项，判定与旧用例一致。
      disallowGaps: Array.isArray(caseDef.disallowGaps) ? caseDef.disallowGaps : undefined,
      zero_signal: caseDef.zero_signal ?? caseDef.zeroSignal,
    };

    // 前提：装好之后场景先对一遍，空点一次「取最新」。这几样不对就不开 E3D
    const pageBase = await observePage(ctx);
    const layerIds = fetchedLayers(pageBase.tree);
    const backendBase = await observeBackend(backend, rootIds, layerIds);
    const sceneBase = sceneForJudging(pageBase, backendBase);
    const baseW3 = judgeW3(sceneTruth(sceneBase, backendBase, rootIds));
    const treeTops = await readTreeTops(page);
    record.setup.baseline = {
      libraries: backendBase.libraries,
      components: Object.fromEntries(rootIds.map((root) => [root, Object.keys(backendBase.roots[root].components).length])),
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
    check(`${roots.length} 个节点都装进了场景`, notInScene.length === 0, notInScene.length ? `没装上：${notInScene.join('、')}` : `场景里 ${pageBase.scene.objects} 个对象`);
    check('装好之后场景 = 后端（没有说不清归谁的对象）', baseW3.verdict === 'pass', verdictText(baseW3));

    if ((caseDef.baselineTruth ?? []).length > 0) {
      const groups = [];
      const unplaced = [];
      const groupFacts = [];
      const sources = {};
      const missing = [];
      for (const dbnum of dbnums) {
        const defs = caseDef.baselineTruth.filter((def) => dbnumOf[refnoKey(def.root)] === dbnum);
        if (defs.length === 0) continue;
        const entry = truthOf(dbnum);
        if (!entry) {
          missing.push(dbnum);
          continue;
        }
        sources[dbnum] = entry.file;
        const built = truthGroups(entry.snapshot, defs, sceneBase.boxes, nameOf, sceneBase.perItemBoxes);
        groups.push(...built.groups);
        unplaced.push(...built.unplaced);
        groupFacts.push(...built.facts);
      }
      const baseW4 = judgeW4({ groups, unplaced });
      record.setup.baseline.w4 = { ...judgementBrief(baseW4), sources, groups: groupFacts };
      check('装好之后场景 = 起点的 E3D 导出（副本的内容在起点上）', missing.length === 0 && baseW4.verdict === 'pass',
        missing.length ? `库 ${missing.join('、')} 没有起点的 E3D 导出` : `${verdictText(baseW4)}（比了 ${baseW4.facts.compared} 件，最大差 ${round3(baseW4.facts.maxGapMm)} mm）`);
    }

    const idle = await clickGetWork(page, log);
    const idleBrief = receiptBrief(idle.receipt);
    record.setup.idleClick = { ms: idle.ms, receipt: idleBrief };
    const idleModels = idleBrief?.models ?? {};
    const idleQuiet = idleBrief?.ok === true
      && (idleModels.reloaded ?? []).length + (idleModels.withdrawn ?? []).length + (idleModels.failed ?? []).length + (idleModels.kept ?? []).length === 0
      && !!idleBrief.tree
      && idleBrief.tree.added.length + idleBrief.tree.deleted.length + idleBrief.tree.relocated.length + idleBrief.tree.renamed.length + idleBrief.tree.moved.length === 0;
    check('后台没变时点「取最新」：一个模型都不重载，树不动', idleQuiet, idleBrief?.summary ?? '没有回执');
    // 脚本对账的层 = 页面树上取过成员的参考号层（取过、但没有成员的空层也认，见 `readTree`）；页面重取的层 = 它自己记的
    // 「取过成员的层」（最上面不是参考号的层也算）。页面多出来的层数要是比最上面那几层还多，就是有取过的层脚本没认出来
    // （没展开、被预取过的空层）。各条腿存盘之前还会再核一遍（`runLeg`）
    const topLayers = treeTops.filter((node) => node.children > 0).length;
    const loadedLayers = await readLoadedLayerCount(page);
    const layersRequested = idleBrief?.tree?.layersRequested ?? null;
    record.setup.baseline.layerCounts = { refnoLayers: layerIds.length, topLayers, pageLoadedLayers: loadedLayers, layersRequested };
    check('脚本对账的树层没有比页面重取的少（页面多出来的只是最上面不是参考号的层）',
      loadedLayers !== null && loadedLayers >= layerIds.length && loadedLayers - layerIds.length <= topLayers,
      `页面记的取过成员的层 ${loadedLayers}，其中脚本对账的参考号层 ${layerIds.length}，最上面不是参考号的层 ${topLayers}`);
    check('空点时页面核对的树层数 = 页面记的取过成员的层数', layersRequested !== null && layersRequested === loadedLayers, `核对了 ${layersRequested} 层`);
    await shot('00-baseline');
    const failed = record.checks.filter((item) => !item.pass);
    if (failed.length > 0) throw new Error(`前提没过（${failed.length} 项）：${failed.map((item) => item.name).join('；')}`);

    // 各腿
    const results = {};
    let from = openedAt;
    for (const legDef of caseDef.legs) {
      say(`腿 ${legDef.id}：${legDef.title ?? ''}`);
      const judged = legDef.judge ?? ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];
      const base = legDef.restoreOf ? results[legDef.restoreOf] : null;
      if (legDef.restoreOf && !base) throw new Error(`腿 ${legDef.id} 要还原的腿 ${legDef.restoreOf} 没有跑出结果`);
      const resultFile = path.join(caseDir, `${legDef.id}.leg.json`);
      const libraries = [];
      const legNotes = [];
      let command = null;
      let legResult = null;
      let cameraBefore = null;
      let levels = null;
      let result;
      const levelWatch = watchLibraries(backend, dbnums);
      try {
        result = await runLeg(ctx, {
          id: legDef.id,
          title: legDef.title,
          judge: judged,
          affected: legDef.affected,
          unaffected: legDef.unaffected,
          controls: legDef.controls,
          receipt: legDef.receipt,
          windowMs: legDef.windowMs,
          settleMs: legDef.settleMs,
          catchUpMs: legDef.catchUpMs,
          allowEmptyScene: legDef.allowEmptyScene,
          // 要等哪几个库、等到哪个会话，腿命令跑完才知道；腿的流程在存盘返回之后才读这个名单
          libraries,
          save: async () => {
            const startedAt = Date.now();
            const argv = legDef.command.map((part) => String(part).replaceAll('{{RESULT}}', resultFile));
            const ran = await runLegCommand(argv, { timeoutMs: env.commandTimeoutMs, onLine: (line) => say(`  | ${line}`) });
            command = { argv, startedAt, code: ran.code, timedOut: ran.timedOut, ms: ran.ms, linesDropped: ran.dropped, output: ran.lines };
            if (ran.timedOut) throw new Error(`腿命令 ${Math.round(ran.ms / 60_000)} 分钟没跑完，不再等（没有杀它）`);
            if (!fs.existsSync(resultFile)) throw new Error(`腿命令退出 ${ran.code}，没有写结果文件`);
            legResult = readLegResult(resultFile);
            if (ran.code !== 0 || legResult.ok !== true) {
              throw new Error(`腿命令没过（退出 ${ran.code}）：${(legResult.problems ?? []).join('；') || `结论 ${legResult.verdict}`}`);
            }
            const savedAt = legResult.saved_at_ms;
            if (!Number.isFinite(savedAt) || savedAt < startedAt - 1000 || savedAt > Date.now() + 1000) {
              throw new Error(`腿命令报的存盘时刻不在它自己的起止之间（${savedAt}）`);
            }
            const known = await backend.libraries();
            for (const library of legResult.libraries ?? []) {
              if (library.after === library.before) continue;
              if (isFollowed(known[library.dbnum])) libraries.push({ dbnum: library.dbnum, to: library.after });
              else legNotes.push(`库 ${library.dbnum} 的会话号变了（${library.before} → ${library.after}），但它不在后端的更新范围里，没有等它`);
            }
            if (libraries.length === 0) throw new Error('腿命令说过了，但后端跟着的库里没有一个会话号变了');
            return { savedAt, commandMs: ran.ms, evidence: legResult.evidence ?? null, libraries: legResult.libraries };
          },
          restore: base ? { base, mode: legDef.restoreMode ?? 'identical', rebuiltCount: legDef.rebuiltCount } : undefined,
          beforeClick: async () => {
            cameraBefore = await readCamera(page).catch(() => null);
            await shot(`${legDef.id}-1-before-click`);
          },
          from,
        });
      } catch (error) {
        // 没跑完的腿也留一笔：腿命令跑没跑、报了什么
        record.legs.push({ id: legDef.id, title: legDef.title ?? '', completed: false, command, legResult, error: maskText(String(error?.message ?? error)).slice(0, 1000) });
        throw error;
      } finally {
        levels = await levelWatch.stop();
      }
      from = result.times.to;
      results[legDef.id] = result;
      await shot(`${legDef.id}-2-after`);

      // 相机：点「取最新」之前和这条腿判完之后各读一次位姿（等它停住再记），只记不判；读不出来就记「不知道」，不连累这条腿
      const cameraAfter = await readCamera(page).catch(() => null);
      const cameraDiff = cameraChange(cameraBefore, cameraAfter);
      const toMm = (value) => (value === null ? null : value * (env.sceneToMm ?? 1000));
      const camera = {
        moved: cameraDiff.moved,
        positionByMm: toMm(cameraDiff.positionBy),
        targetByMm: toMm(cameraDiff.targetBy),
        turnedDeg: cameraDiff.turnedDeg,
        viewDistanceMm: { before: toMm(cameraDiff.viewDistance.before), after: toMm(cameraDiff.viewDistance.after) },
        fovChanged: cameraDiff.fovChanged,
        zoomChanged: cameraDiff.zoomChanged,
        beforeClick: cameraBefore,
        afterClick: cameraAfter,
      };

      // W4：场景 = 这条腿导出的 E3D
      const judgements = { ...result.judgements };
      const truth = legResult.truth ?? null;
      const exported = truth?.snapshot ? loadRvmSnapshot(truth.snapshot) : null;
      let truthInfo = null;
      if (exported) {
        truthInfo = {
          snapshot: truth.snapshot,
          element: truth.element ?? null,
          dbnum: truth.dbnum ?? null,
          sesnoAtExport: truth.sesno_at_export ?? null,
          sesnoAfterExport: truth.sesno_after_export ?? null,
          members: exported.members.length,
          invalidBoxes: exported.invalidBoxes,
        };
      }
      if (judged.includes('W4')) {
        if (!exported) throw new Error(`腿 ${legDef.id} 要判 W4，但腿命令的结果里没有导出的快照`);
        const built = truthGroups(exported, legDef.truth?.groups ?? [], result.after.scene.boxes, nameOf, result.after.scene.perItemBoxes);
        judgements.W4 = judgeW4({ groups: built.groups, unplaced: built.unplaced, allowEmpty: legDef.truth?.allowEmpty === true });
        judgements.W4.facts.truth = { ...truthInfo, groups: built.facts };
      }

      // X：和用例表写明的改动对一遍
      if (legDef.stated) {
        const moveRoots = (legDef.stated.moves ?? []).map((move) => refnoKey(move.root));
        const boxesIn = (snapshot) => Object.fromEntries(moveRoots.map((root) => [root, truthBoxes(membersUnder(snapshot, root)).byRefno]));
        const previous = exported && truth.dbnum !== undefined ? truthOf(truth.dbnum) : null;
        judgements.X = judgeStated({
          stated: legDef.stated,
          expected: result.expected,
          backendBefore: result.before.backend.roots,
          backendAfter: result.after.backend.roots,
          truthBefore: previous ? boxesIn(previous.snapshot) : null,
          truthAfter: exported ? boxesIn(exported) : null,
          sceneBefore: result.before.scene.boxes,
          sceneAfter: result.after.scene.boxes,
        });
        judgements.X.facts.previousTruth = previous ? { file: previous.file, from: previous.from } : null;
      }
      if (exported && truth.dbnum !== undefined) truthState[truth.dbnum] = { file: truth.snapshot, from: `腿 ${legDef.id} 的导出`, snapshot: exported };

      const ordered = Object.fromEntries(CHECKPOINT_ORDER.filter((id) => judgements[id]).map((id) => [id, judgements[id]]));
      const summary = summarize(Object.values(ordered));

      // 存盘完成之后，后端多久跟上这次存盘（写步存出来的那个会话）
      const follow = {};
      const writeSteps = (legResult.steps ?? []).filter((step) => step.kind === 'write');
      for (const library of libraries) {
        const lastWrite = writeSteps.findLast((step) => (step.dbs ?? []).includes(library.dbnum));
        const before = lastWrite?.sesno_before?.[library.dbnum];
        if (Number.isInteger(before)) follow[library.dbnum] = followTimes(levels.changes, library.dbnum, before + 1, result.times.startAt);
      }

      // 证据：完整记录、判定、这条腿的起止之间页面发的请求
      const files = {
        legResult: resultFile,
        record: `${legDef.id}.record.json`,
        judgements: `${legDef.id}.judgements.json`,
        requests: `${legDef.id}.requests.json`,
        shots: [`${legDef.id}-1-before-click.png`, `${legDef.id}-2-after.png`],
      };
      const span = { from: result.times.from, to: result.times.to };
      const inSpan = (item) => item.t >= span.from && item.t <= span.to;
      writeJson(files.requests, {
        leg: legDef.id,
        span,
        summary: requestSummary(log, span),
        requests: log.requests.filter(inSpan),
        toLive: log.toLive.filter(inSpan),
        blocked: log.blocked.filter(inSpan),
        httpFailures: log.httpFailures.filter(inSpan),
        consoleErrors: log.consoleErrors.filter(inSpan),
        pageErrors: log.pageErrors.filter(inSpan),
        dialogs: log.dialogs.filter(inSpan),
        interactions: log.interactions.filter(inSpan),
      }, 0);
      writeJson(files.record, { ...result, judgements: ordered, summary, command, legResult, libraryLevels: levels, follow, camera }, 0);
      const legRecord = {
        id: legDef.id,
        title: legDef.title ?? '',
        completed: true,
        required: legDef.required ?? null,
        command: {
          argv: command.argv,
          code: command.code,
          ms: command.ms,
          linesDropped: command.linesDropped,
          evidence: legResult.evidence ?? null,
          savedAt: legResult.saved_at_ms,
          libraries: legResult.libraries ?? [],
          steps: (legResult.steps ?? []).map((step) => ({
            index: step.index,
            spec: step.spec,
            kind: step.kind,
            verdict: step.verdict,
            seconds: step.seconds,
            sesnoBefore: step.sesno_before,
            sesnoAfter: step.sesno_after,
            quitFinished: step.quit_finished,
          })),
        },
        times: result.times,
        durations: {
          commandMs: command.ms,
          saveToSignalMs: ordered.W1?.facts?.latencyMs ?? null,
          saveToClickMs: result.times.clickedAt - result.times.startAt,
          clickMs: result.click.ms,
          legMs: result.times.to - result.times.saveStartedAt,
        },
        waitedFor: libraries,
        caughtUp: Object.fromEntries(Object.entries(result.caughtUp).map(([dbnum, caught]) => [dbnum, {
          ok: caught.ok,
          target: caught.target,
          fileSeenMs: caught.fileSeenMs,
          appliedMs: caught.appliedMs,
          modelMs: caught.modelMs,
        }])),
        follow,
        libraryLevels: levels,
        signal: result.signal,
        timeline: result.timeline,
        samples: result.watch.samples.length,
        receipt: receiptBrief(result.receipt),
        expected: result.expected,
        judgements: Object.fromEntries(Object.entries(ordered).map(([id, judgement]) => [id, judgementBrief(judgement)])),
        summary,
        truth: truthInfo,
        rootFacts: result.rootFacts,
        requests: result.requests,
        camera,
        notes: [...result.notes, ...legNotes],
        files,
      };
      writeJson(files.judgements, legRecord);
      record.legs.push(legRecord);
      say(`腿 ${legDef.id}：${summary.label}（${Object.entries(summary.checkpoints).map(([id, verdict]) => `${id} ${VERDICT_LABEL[verdict] ?? verdict}`).join('，')}）`);
    }

    record.completed = true;
    const verdicts = record.legs.map((leg) => leg.summary.verdict);
    record.verdict = verdicts.includes('fail') ? 'fail' : verdicts.includes('known-gap') ? 'known-gap' : 'pass';
  } catch (error) {
    record.error = {
      message: maskText(String(error?.message ?? error)).slice(0, 1000),
      stack: maskText(String(error?.stack ?? '')).slice(0, 3000),
    };
    say(`中途出错：${record.error.message}`);
    await shot('99-error');
  } finally {
    if (log) {
      const all = requestSummary(log);
      record.guard = {
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
    if (context) await context.close().catch(() => undefined);
    record.finishedAt = new Date().toISOString();
    writeJson('case.json', record);
  }
  return record;
}
