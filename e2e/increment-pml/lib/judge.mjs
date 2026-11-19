/**
 * 增量测试「PML 触发 + 网页验收」七个看点（W1–W7）的判定，规格在 gen-model
 * `docs/plans/2026-11-17-increment-pml-web-acceptance-spec.md` 的「看点」一节。
 *
 * 全是纯函数：输入是已经采好的数据，输出是 过 / 不过 / 已知缺口，带上实际值和预期值；不开浏览器、不发请求。
 * 已知缺口登记在旁边的 `known-gaps.json`：条件逐项命中才记，记了不算过；条件不命中的同类偏差照样判不过。
 *
 * 约定：refno 的两种写法（`a/b`、`a_b`）都收，内部统一成 `a_b`；矩阵是列主序 4×4，平移在第 12–14 个分量，单位 mm；
 * 包围盒是 `[minX, minY, minZ, maxX, maxY, maxZ]`，单位 mm。
 */
import fs from 'node:fs';

/**
 * @typedef {'pass' | 'fail' | 'known-gap' | 'not-applicable'} Verdict
 * @typedef {{ code: string, message: string, actual?: unknown, expected?: unknown }} Problem
 * @typedef {{ gap: string, title: string, reason: string, message: string, actual?: unknown, expected?: unknown }} GapHit
 * @typedef {{ id: string, title: string, verdict: Verdict, label: string, problems: Problem[], gaps: GapHit[], facts: Record<string, unknown> }} Judgement
 * @typedef {{ present?: boolean, action?: string | null, nodeStatus?: string | null, pending?: boolean, eyeLit?: boolean }} RowState
 *   行的样子：`action` 是行上那颗按钮（`update` / `update-node` / `reload` / `generate`），`nodeStatus` 是新旧标记
 *   （`latest` / `lagging` / `reloadable` …，正在核对是 `checking`），`pending` 是「核对中」
 * @typedef {{ dbnum: number, loadedVia?: 'address' | 'tree' | 'library', aloneInLibraryAtLoad?: boolean, reloadsBefore?: number, withdrawnVia?: 'address' | 'getwork' | null }} RootFacts
 *   已知缺口的条件要用的事实，含义见 `known-gaps.json` 的 `facts`
 * @typedef {number[] | { m: number[] | null, visible?: boolean }} SceneObject
 * @typedef {Record<string, Record<string, SceneObject[]>>} SceneByRoot 根 → 构件 → 对象
 * @typedef {Record<string, { name?: string, type?: string, parentId?: string | null, childrenIds?: string[] | null }>} Tree
 *   页面上的模型树；`childrenIds` 没取过成员是 `null`，取过、但一个成员都没有是空数组
 */

export const VERDICT_LABEL = Object.freeze({
  pass: '过',
  fail: '不过',
  'known-gap': '已知缺口',
  'not-applicable': '不适用',
});

/** 存盘之后等行上出信号的时限（规格 W1） */
export const SIGNAL_WINDOW_MS = 180_000;

/** 现网的两个端口：页面一条请求都不许发过去（规格 W6） */
export const LIVE_PORTS = Object.freeze([8022, 8009]);

/**
 * 场景与后端、还原之后与起点对拍的容差：位置按规格是 1 mm；朝向和尺寸那九个分量沿用 11-17 回归的口径
 * （绝对 0.05 加相对万分之一）。
 */
export const MATCH_TOLERANCE = Object.freeze({ positionMm: 1, linearAbs: 0.05, linearRel: 1e-4 });

/** 「没动」的容差：同一份后端记录重装一遍，只该有浮点误差 */
export const UNCHANGED_TOLERANCE = Object.freeze({ positionMm: 1e-3, linearAbs: 1e-6, linearRel: 1e-6 });

/** 包围盒六个分量各自的容差（规格 W4） */
export const BOX_TOLERANCE_MM = 1;

export function refnoKey(value) {
  return String(value).trim().replace(/^=/, '').replace('/', '_');
}

function keyList(values) {
  return [...new Set((values ?? []).map(refnoKey))].sort();
}

function keyedMap(record) {
  const out = new Map();
  for (const [key, value] of Object.entries(record ?? {})) out.set(refnoKey(key), value);
  return out;
}

function listedByRefno(items) {
  return new Map((items ?? []).map((item) => [refnoKey(item.refno), item]));
}

function setDiff(actual, expected) {
  const have = new Set(actual);
  const want = new Set(expected);
  return {
    extra: [...have].filter((item) => !want.has(item)).sort(),
    missing: [...want].filter((item) => !have.has(item)).sort(),
  };
}

function conclude(id, title, problems, gaps, facts) {
  const verdict = problems.length > 0 ? 'fail' : gaps.length > 0 ? 'known-gap' : 'pass';
  return { id, title, verdict, label: VERDICT_LABEL[verdict], problems, gaps, facts };
}

let registeredGaps = null;

export function loadKnownGaps(file = new URL('./known-gaps.json', import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, 'utf8')).gaps;
}

function knownGap(options, id) {
  const gaps = options.knownGaps ?? (registeredGaps ??= loadKnownGaps());
  return gaps.find((gap) => gap.id === id) ?? null;
}

/**
 * 一条已知缺口的条件对不对得上。逐项都对上才算；事实缺一项（没记下来）就不算命中——宁可判不过，不放宽。
 * 条件的值是字面量就要相等，是 `{ min, max }` 就要落在范围里。
 */
export function gapApplies(gap, facts) {
  if (!gap || !facts) return false;
  return Object.entries(gap.when).every(([name, want]) => {
    const have = facts[name];
    if (want !== null && typeof want === 'object') {
      if (typeof have !== 'number' || !Number.isFinite(have)) return false;
      return (want.min === undefined || have >= want.min) && (want.max === undefined || have <= want.max);
    }
    return have === want;
  });
}

function gapHit(gap, detail) {
  return { gap: gap.id, title: gap.title, reason: gap.reason, ...detail };
}

const TRANSIENT_ROW_STATUS = new Set(['checking', 'updating']);

function rowBrief(row) {
  if (!row) return null;
  return {
    present: row.present !== false,
    action: row.action ?? null,
    nodeStatus: row.nodeStatus ?? null,
    pending: row.pending === true,
  };
}

function rowShows(row, want) {
  if (!row || row.present === false) return false;
  if (want.nodeStatus && !want.nodeStatus.includes(row.nodeStatus ?? null)) return false;
  if (want.action && !want.action.includes(row.action ?? null)) return false;
  return true;
}

/** 「核对中」和库正在被写的那几秒是过程，不是结论：不拿它们说行变了，也不拿它们说行没变 */
function rowSettled(row) {
  return row.pending !== true && !TRANSIENT_ROW_STATUS.has(row.nodeStatus);
}

function sameRow(a, b) {
  if ((a.present !== false) !== (b.present !== false)) return false;
  return (a.action ?? null) === (b.action ?? null) && (a.nodeStatus ?? null) === (b.nodeStatus ?? null);
}

/**
 * W1 不点任何东西，页面自己知道变了：存盘后时限内，受影响的已装节点的行出现预期的信号，而且到点「取最新」之前还在；
 * 不受影响的行不变。实际用了多久记在 `facts.latencyMs`，不卡线；信号出过又没了的，哪一刻没的记在 `facts.withdrawnMs`。
 *
 * @param {object} input
 * @param {number} input.startAt 存盘完成的时刻（毫秒）
 * @param {number} [input.windowMs] 时限，缺省 180 秒
 * @param {Record<string, RowState>} input.baseline 存盘之前各行的样子
 * @param {{ t: number, rows: Record<string, RowState> }[]} input.samples 存盘之后、点「取最新」之前的采样（行的采样在点之前就停了）
 * @param {Record<string, { nodeStatus?: string[], action?: string[] }>} [input.affected] 受影响的根 → 行上该出现什么（两样都写就都要对上）
 * @param {string[]} [input.unaffected] 不受影响的根
 * @param {{ t: number, what: string }[]} [input.interactions] 这期间在页面上做过的操作
 * @returns {Judgement}
 */
export function judgeW1(input) {
  const { startAt } = input;
  const windowMs = input.windowMs ?? SIGNAL_WINDOW_MS;
  const deadline = startAt + windowMs;
  const baseline = keyedMap(input.baseline);
  const affected = keyedMap(input.affected);
  const unaffected = keyList(input.unaffected);
  const samples = (input.samples ?? [])
    .filter((sample) => sample.t >= startAt)
    .sort((a, b) => a.t - b.t)
    .map((sample) => ({ t: sample.t, rows: keyedMap(sample.rows) }));
  const problems = [];
  const facts = { windowMs, samples: samples.length, latencyMs: {}, transient: {} };

  if (affected.size + unaffected.length === 0) {
    problems.push({ code: 'nothing-to-judge', message: '没有给出要看的行', actual: 0, expected: '至少 1 行' });
  }
  if (samples.length === 0) {
    problems.push({ code: 'no-samples', message: '存盘之后没有采到行状态', actual: 0, expected: '至少 1 次' });
  }

  let quietUntil = affected.size > 0 ? startAt : (samples.at(-1)?.t ?? startAt);
  for (const [root, want] of affected) {
    if (!want.nodeStatus && !want.action) throw new TypeError(`W1：${root} 没有写行上该出现什么`);
    const before = baseline.get(root);
    if (!before) {
      problems.push({ code: 'no-baseline', message: `${root} 存盘之前的行状态没有采到`, actual: null, expected: '存盘之前的行状态' });
      continue;
    }
    if (rowShows(before, want)) {
      problems.push({
        code: 'signal-before-change',
        message: `${root} 的行在存盘之前就是这个样子，看不出是不是页面自己发现的`,
        actual: rowBrief(before),
        expected: want,
      });
      continue;
    }
    const hit = samples.find((sample) => rowShows(sample.rows.get(root), want));
    if (!hit) {
      const last = samples.at(-1);
      quietUntil = Math.max(quietUntil, deadline);
      problems.push({
        code: 'no-signal',
        message: `${root} 的行没有出现预期的信号`,
        actual: rowBrief(last?.rows.get(root)),
        expected: want,
        waitedMs: last ? last.t - startAt : 0,
      });
      continue;
    }
    facts.latencyMs[root] = hit.t - startAt;
    quietUntil = Math.max(quietUntil, hit.t);
    if (hit.t > deadline) {
      problems.push({
        code: 'signal-late',
        message: `${root} 的行过了 ${windowMs / 1000} 秒才出现信号`,
        actual: hit.t - startAt,
        expected: windowMs,
      });
    }
    // 信号出过、点「取最新」之前又没了：页面先知道、后来又不说了（行上的标记撤了，场景还没换）。看的是点之前最后一次定下来的样子：
    // 中途「核对中」、没了又出来的都不算
    const settledLater = samples.filter((sample) => {
      const row = sample.rows.get(root);
      return sample.t > hit.t && row !== undefined && rowSettled(row);
    });
    const last = settledLater.at(-1);
    if (last && !rowShows(last.rows.get(root), want)) {
      // 没的那一刻 = 最后这一段没有信号的采样里最早的一次
      let goneIndex = settledLater.length - 1;
      while (goneIndex > 0 && !rowShows(settledLater[goneIndex - 1].rows.get(root), want)) goneIndex -= 1;
      const gone = settledLater[goneIndex];
      (facts.withdrawnMs ??= {})[root] = gone.t - startAt;
      problems.push({
        code: 'signal-withdrawn',
        message: `${root} 的行出过信号，点取最新之前又没了（存盘后 ${((hit.t - startAt) / 1000).toFixed(1)} 秒出，${((gone.t - startAt) / 1000).toFixed(1)} 秒没）`,
        actual: rowBrief(last.rows.get(root)),
        expected: want,
        shownAtMs: hit.t - startAt,
        goneAtMs: gone.t - startAt,
      });
    }
  }

  for (const root of unaffected) {
    const before = baseline.get(root);
    if (!before) {
      problems.push({ code: 'no-baseline', message: `${root} 存盘之前的行状态没有采到`, actual: null, expected: '存盘之前的行状态' });
      continue;
    }
    let transient = 0;
    let missed = 0;
    let changed = null;
    for (const sample of samples) {
      const row = sample.rows.get(root);
      if (!row) {
        missed += 1;
      } else if (!rowSettled(row)) {
        transient += 1;
      } else if (!sameRow(row, before)) {
        changed = { t: sample.t, row };
        break;
      }
    }
    if (transient > 0) facts.transient[root] = transient;
    const last = samples.at(-1)?.rows.get(root);
    if (changed) {
      problems.push({
        code: 'unaffected-row-changed',
        message: `不受影响的 ${root} 的行变了`,
        actual: rowBrief(changed.row),
        expected: rowBrief(before),
        atMs: changed.t - startAt,
      });
    } else if (missed > 0) {
      problems.push({ code: 'row-not-sampled', message: `${root} 的行有 ${missed} 次没采到，不能说它没变`, actual: missed, expected: 0 });
    } else if (last && !rowSettled(last)) {
      problems.push({
        code: 'row-not-settled',
        message: `${root} 的行到最后还在核对，不能说它没变`,
        actual: rowBrief(last),
        expected: rowBrief(before),
      });
    }
  }

  const touched = (input.interactions ?? []).filter((item) => item.t >= startAt && item.t <= quietUntil);
  if (touched.length > 0) {
    problems.push({
      code: 'touched-before-signal',
      message: '行上的信号出现之前在页面上做了操作，不算页面自己发现的',
      actual: touched,
      expected: [],
    });
  }
  return conclude('W1', '不点任何东西，页面自己知道变了', problems, [], facts);
}

function reloadBrief(entry) {
  return { added: entry.added, removed: entry.removed, total: entry.total };
}

/** 一个根在回执里的增减与预期比。回「撤下」按已知缺口多算了几个（合计的「撤下」跟着多这么多） */
function compareReloadEntry(root, got, want, info, options, problems, gaps) {
  let overcount = 0;
  if (got.added !== want.added) {
    problems.push({
      code: 'root-added',
      message: `${root}：回执里新增 ${got.added} 个构件，预期 ${want.added}`,
      actual: got.added,
      expected: want.added,
    });
  }
  if (got.removed !== want.removed) {
    const gap = knownGap(options, 'KG1');
    if (gap && got.removed === want.removed + gap.deviation.by && gapApplies(gap, info)) {
      overcount = gap.deviation.by;
      gaps.push(gapHit(gap, {
        message: `${root}：回执里撤下 ${got.removed} 个构件，预期 ${want.removed}，多的 ${gap.deviation.by} 个是节点自己`,
        root,
        actual: got.removed,
        expected: want.removed,
      }));
    } else {
      problems.push({
        code: 'root-removed',
        message: `${root}：回执里撤下 ${got.removed} 个构件，预期 ${want.removed}`,
        actual: got.removed,
        expected: want.removed,
      });
    }
  }
  if (want.total !== undefined && got.total !== want.total) {
    problems.push({
      code: 'root-total',
      message: `${root}：回执里现有 ${got.total} 个构件，预期 ${want.total}`,
      actual: got.total,
      expected: want.total,
    });
  }
  return overcount;
}

/**
 * 不在预期里的根被重载了：登记在册的那一种（同库的节点跟着重载、构件没有增减）记已知缺口，别的判不过。
 */
function judgeUnexpectedReload(root, entry, info, movedLibraries, options) {
  const problems = [];
  const gaps = [];
  const gap = knownGap(options, 'KG3');
  const libraryModelMoved = info ? movedLibraries.has(Number(info.dbnum)) : undefined;
  if (!gapApplies(gap, { ...info, expectedReload: false, libraryModelMoved })) {
    const library = libraryModelMoved === false ? '所在的库后端模型水位也没动' : '所在的库后端模型水位动没动不知道';
    problems.push({
      code: 'unexpected-reload',
      message: `${root} 不该重载（它名下的后端记录前后没有差，${library}），回执里却重载了`,
      actual: reloadBrief(entry),
      expected: null,
      libraryModelMoved: libraryModelMoved ?? null,
    });
    return { problems, gaps, overcount: 0, accompanying: false };
  }
  const want = { added: gap.deviation.added, removed: gap.deviation.removed };
  const overcount = compareReloadEntry(root, entry, want, info, options, problems, gaps);
  if (problems.length > 0) return { problems, gaps: [], overcount: 0, accompanying: false };
  gaps.push(gapHit(gap, {
    message: `${root} 不在预期重载的根里，跟着同一个库重载了一次（构件没有增减）`,
    root,
    actual: reloadBrief(entry),
    expected: null,
  }));
  return { problems, gaps, overcount, accompanying: true };
}

function judgeReceiptTree(receipt, expectedTree, problems) {
  const want = {
    added: keyList(expectedTree.added),
    deleted: keyList(expectedTree.deleted),
    renamed: keyList(expectedTree.renamed),
    moved: keyList(expectedTree.moved),
  };
  const tree = receipt.tree;
  if (!tree) {
    problems.push({
      code: 'tree-not-refreshed',
      message: `回执里没有模型树的结果${receipt.treeError ? `：${receipt.treeError}` : ''}`,
      actual: null,
      expected: { added: want.added.length, deleted: want.deleted.length, renamed: want.renamed.length, moved: want.moved.length },
    });
    return;
  }
  if ((tree.layersFailed ?? []).length > 0) {
    problems.push({ code: 'tree-layers-failed', message: `模型树有 ${tree.layersFailed.length} 层没取到`, actual: tree.layersFailed, expected: [] });
  }
  const ids = (items) => keyList((items ?? []).map((item) => item.id));
  const removed = tree.removed ?? [];
  const got = {
    added: ids(tree.added),
    deleted: ids(removed.filter((item) => item.fate === 'deleted')),
    renamed: ids(tree.renamed),
    // 挪到还没展开的位置的，页面记在 removed 里（fate = relocated），给人看的那一句把它算进「挪位置」
    moved: keyList([...ids(tree.moved), ...ids(removed.filter((item) => item.fate === 'relocated'))]),
  };
  const vanished = ids(removed.filter((item) => item.fate !== 'deleted' && item.fate !== 'relocated'));
  if (vanished.length > 0) {
    problems.push({ code: 'tree-vanished', message: `树上有 ${vanished.length} 行消失了，页面没问到是删了还是挪了`, actual: vanished, expected: [] });
  }
  for (const [name, label] of [['added', '新增'], ['deleted', '删除'], ['renamed', '改名'], ['moved', '挪位置']]) {
    const diff = setDiff(got[name], want[name]);
    if (diff.extra.length === 0 && diff.missing.length === 0) continue;
    problems.push({
      code: `tree-${name}`,
      message: `回执里模型树${label} ${got[name].length}，预期 ${want[name].length}`,
      actual: { count: got[name].length, ids: got[name] },
      expected: { count: want[name].length, ids: want[name] },
      extra: diff.extra,
      missing: diff.missing,
    });
  }
}

function judgeReceiptModels(models, expected, rootsInfo, options, problems, gaps, facts) {
  const reloaded = listedByRefno(models.reloaded);
  const withdrawn = listedByRefno(models.withdrawn);
  const wantReload = keyedMap(expected.reload);
  const wantWithdrawn = keyedMap(expected.withdrawn);
  const movedLibraries = new Set((expected.movedLibraries ?? []).map(Number));
  let overcount = 0;
  let accompanying = 0;

  for (const [root, want] of wantReload) {
    const got = reloaded.get(root);
    if (!got) {
      problems.push({ code: 'not-reloaded', message: `${root} 该重载，回执里没有`, actual: null, expected: want });
      continue;
    }
    overcount += compareReloadEntry(root, got, want, rootsInfo.get(root), options, problems, gaps);
  }
  for (const [root, got] of reloaded) {
    if (wantReload.has(root)) continue;
    const outcome = judgeUnexpectedReload(root, got, rootsInfo.get(root), movedLibraries, options);
    problems.push(...outcome.problems);
    gaps.push(...outcome.gaps);
    overcount += outcome.overcount;
    if (outcome.accompanying) accompanying += 1;
  }
  facts.reloaded = { actual: reloaded.size, expected: wantReload.size, accompanying };

  for (const [root, want] of wantWithdrawn) {
    const got = withdrawn.get(root);
    if (!got) {
      problems.push({ code: 'not-withdrawn', message: `${root} 该撤下，回执里没有`, actual: null, expected: want });
    } else if (got.why !== want.why || got.refnos !== want.refnos) {
      problems.push({
        code: 'withdrawn-differs',
        message: `${root} 撤下的缘由或个数对不上`,
        actual: { why: got.why, refnos: got.refnos },
        expected: { why: want.why, refnos: want.refnos },
      });
    }
  }
  for (const [root, got] of withdrawn) {
    if (wantWithdrawn.has(root)) continue;
    problems.push({ code: 'unexpected-withdraw', message: `${root} 不该撤下，回执里却撤下了`, actual: { why: got.why, refnos: got.refnos }, expected: null });
  }

  const kept = (models.kept ?? []).map((item) => ({ refno: refnoKey(item.refno), reason: item.reason }));
  const keptDiff = setDiff(kept.map((item) => item.refno), keyList(expected.kept));
  if (keptDiff.extra.length > 0 || keptDiff.missing.length > 0) {
    problems.push({ code: 'kept', message: '回执里「模型没有动」的节点对不上', actual: kept, expected: keyList(expected.kept) });
  }
  const failed = (models.failed ?? []).map((item) => ({ refno: refnoKey(item.refno), reason: item.reason }));
  if (failed.length > 0) {
    problems.push({ code: 'reload-failed', message: `有 ${failed.length} 个节点重载没成`, actual: failed, expected: [] });
  }
  const loadedNew = keyList((models.loadedNew ?? []).map((item) => item.refno));
  const loadedNewDiff = setDiff(loadedNew, keyList(expected.loadedNew));
  if (loadedNewDiff.extra.length > 0 || loadedNewDiff.missing.length > 0) {
    problems.push({ code: 'loaded-new', message: '回执里新装入的 SITE 对不上', actual: loadedNew, expected: keyList(expected.loadedNew) });
  }

  const wantAdded = expected.componentsAdded ?? 0;
  const wantRemoved = expected.componentsRemoved ?? 0;
  if (models.componentsAdded !== wantAdded) {
    problems.push({
      code: 'components-added',
      message: `回执里一共新增 ${models.componentsAdded} 个构件，预期 ${wantAdded}`,
      actual: models.componentsAdded,
      expected: wantAdded,
    });
  }
  if (models.componentsRemoved !== wantRemoved + overcount) {
    const note = overcount > 0 ? `（已知缺口多算的 ${overcount} 个算进去是 ${wantRemoved + overcount}）` : '';
    problems.push({
      code: 'components-removed',
      message: `回执里一共撤下 ${models.componentsRemoved} 个构件，预期 ${wantRemoved}${note}`,
      actual: models.componentsRemoved,
      expected: wantRemoved,
      overcount,
    });
  }
}

function libraryLevels(row) {
  return row ? `文件 ${row.file} / 数据 ${row.applied} / 模型 ${row.model}` : '没有采到';
}

/**
 * 手动路径：后端对页面发的更新请求（`POST /api/v1/update/execute { dbnums: [库] }`）的答复，对这一个库意味着什么。
 * 只看后端回的状态码和正文，不取页面自己的解读。受理 = 给这个库排了批次（新排的、并进已有批次的、本来就在队列里的）；
 * 没有批次可排的后端形态回的是一个 `status`，不是 `up_to_date` 就算受理。没受理的把后端给的缘由带出来。
 *
 * @param {number} dbnum
 * @param {number} status HTTP 状态码
 * @param {unknown} body 后端回的正文（JSON；读不出来给 null）
 * @returns {{ status: number, accepted: boolean, reason: string, code?: string | null, receipt?: object }}
 */
export function readUpdateAnswer(dbnum, status, body) {
  const answer = { status, accepted: false, reason: '' };
  const brief = (text) => String(text ?? '').slice(0, 300);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    answer.reason = `后端回 ${status}，正文读不出来`;
    return answer;
  }
  if (status < 200 || status >= 300) {
    answer.code = typeof body.code === 'string' ? body.code : null;
    const said = typeof body.message === 'string' && body.message !== '' ? `：${brief(body.message)}` : '';
    answer.reason = `后端回 ${status}${answer.code ? ` ${answer.code}` : ''}${said}`;
    return answer;
  }
  const list = (value) => (Array.isArray(value) ? value : []);
  const batch = (item) => ({
    dbnum: item?.dbnum ?? null,
    intent: item?.intent ?? null,
    startSesno: item?.start_sesno ?? null,
    endSesno: item?.end_sesno ?? null,
    position: item?.position ?? null,
    taskId: item?.task_id ?? null,
  });
  const receipt = {
    status: typeof body.status === 'string' && body.status !== '' ? body.status : null,
    scanned: body.scanned ?? null,
    enqueued: list(body.enqueued).map(batch),
    merged: list(body.merged).map(batch),
    alreadyCovered: list(body.already_covered),
    blocked: list(body.blocked).map((item) => ({ dbnum: item?.dbnum ?? null, reason: brief(item?.reason) })),
    upToDate: body.up_to_date ?? null,
    unselected: list(body.unselected),
    warnings: list(body.warnings).map(brief),
    appliedSesnoChanged: body.applied_sesno_changed ?? null,
  };
  answer.receipt = receipt;
  const mine = [...receipt.enqueued, ...receipt.merged].filter((item) => item.dbnum === dbnum);
  const blocked = receipt.blocked.find((item) => item.dbnum === dbnum);
  const named = new RegExp(`dbnum\\s*=\\s*${dbnum}(?!\\d)`);
  const warning = receipt.warnings.find((text) => named.test(text));
  if (mine.length > 0) {
    const [first] = mine;
    answer.accepted = true;
    answer.reason = Number.isInteger(first.startSesno) && Number.isInteger(first.endSesno)
      ? `排上了：会话 ${first.startSesno}→${first.endSesno}`
      : '排上了';
  } else if (blocked) {
    answer.reason = `后端拒绝：${blocked.reason}`;
  } else if (receipt.alreadyCovered.includes(dbnum)) {
    answer.accepted = true;
    answer.reason = '这个库本来就在后端的队列里';
  } else if (receipt.status) {
    answer.accepted = receipt.status !== 'up_to_date';
    answer.reason = receipt.status === 'up_to_date' ? '后端说这个库已经是最新（up_to_date）' : `后端回执：${receipt.status}`;
  } else if (warning) {
    answer.reason = `后端没有受理：${warning}`;
  } else if ((receipt.upToDate ?? 0) > 0) {
    answer.reason = '后端说这个库已经是最新';
  } else {
    answer.reason = '后端没有为这个库排任何批次';
  }
  return answer;
}

/**
 * 手动路径（后端不自动跟库）里点「取最新」之前的那一下：点行上的「更新」，让后端去跟库。问题记进 `problems`，经过记进 `facts.manual`。
 *
 * 先看前提（不成立就是这一腿验的不是手动路径）：点之前后端没有自己跟——数据、模型两枚水位还停在存盘之前；库文件确实比后端新。
 * 再按次序看这一下走到了哪一步，只报头一个没走通的（后面的都是它带出来的）：行上有「更新」→ 点上了 → 确认框点了确定 →
 * 后端受理了 → 后端追上了 → 受影响的行出了预期的信号（「重载」）。另有一样单独看：还没点「取最新」，场景不该已经变了
 * （页面的规矩是更新完不替人换场景）——拿存盘之前和点「取最新」之前的两份场景逐个对象比，按浮点误差的量级判（和 W5 一样）。
 *
 * @param {object} manual
 * @param {number} manual.dbnum 点的是哪个库的「更新」
 * @param {string} manual.row 点的是哪一行
 * @param {{ file: number, applied: number, model: number } | null} manual.libraryBefore 存盘之前后端这个库的水位
 * @param {{ file: number, applied: number, model: number } | null} manual.libraryAtClick 点「更新」之前的
 * @param {boolean} manual.offered 要点的那一刻，行上有没有库一级的「更新」
 * @param {RowState | null} [manual.rowAtClick] 那一刻这一行的样子
 * @param {boolean} [manual.clicked] 点上了没有
 * @param {string} [manual.clickError]
 * @param {boolean} [manual.confirmed] 确认框出了、点了确定
 * @param {{ status: number | null, accepted: boolean, reason?: string } | null} [manual.request] 页面发的更新请求，后端怎么回的
 * @param {{ ok: boolean, waitedMs?: number, library?: object } | null} [manual.caughtUp] 点了之后后端追上没有
 * @param {Record<string, RowState>} [manual.rowsAfter] 后端追上之后、点「取最新」之前各行的样子
 * @param {boolean} [manual.signalSeen] 后端追上之后行上出过预期的信号没有（只用来把「出过又没了」和「没出过」分开说）
 * @param {Record<string, { nodeStatus?: string[], action?: string[] }>} [manual.wantAfter] 受影响的根 → 这时行上该是什么
 * @param {string[]} [manual.sceneRoots] 场景里要比的根（装着的都算）
 * @param {SceneByRoot | null} [manual.sceneBefore] 存盘之前的场景
 * @param {SceneByRoot | null} [manual.sceneAtGetWork] 点「取最新」之前的场景
 * @param {Problem[]} problems
 * @param {Record<string, unknown>} facts
 */
function judgeManualUpdate(manual, problems, facts) {
  const row = refnoKey(manual.row);
  const before = manual.libraryBefore ?? null;
  const atClick = manual.libraryAtClick ?? null;
  const caughtUp = manual.caughtUp ?? null;
  const sceneRoots = keyList(manual.sceneRoots);
  const sceneSampled = Boolean(manual.sceneBefore && manual.sceneAtGetWork);
  const sceneChanged = [];
  let sceneObjects = 0;
  if (sceneSampled) {
    const sceneBefore = keyedMap(manual.sceneBefore);
    const sceneAtGetWork = keyedMap(manual.sceneAtGetWork);
    for (const root of sceneRoots) {
      const result = compareComponents(root, sceneAtGetWork.get(root), sceneBefore.get(root), UNCHANGED_TOLERANCE);
      sceneObjects += result.objects;
      if (result.problems.length > 0) sceneChanged.push({ root, problems: result.problems.map((item) => item.message) });
    }
  }
  facts.manual = {
    dbnum: manual.dbnum,
    row,
    libraryBefore: before,
    libraryAtClick: atClick,
    offered: manual.offered === true,
    clicked: manual.clicked === true,
    confirmed: manual.confirmed === true,
    request: manual.request ?? null,
    caughtUp: caughtUp ? { ok: caughtUp.ok === true, waitedMs: caughtUp.waitedMs ?? null, library: caughtUp.library ?? null } : null,
    signalSeen: manual.signalSeen === true,
    sceneObjects,
    sceneChanged: sceneChanged.map((item) => item.root),
  };

  if (!before || !atClick) {
    problems.push({
      code: 'manual-no-levels',
      message: `库 ${manual.dbnum} 在后端上的水位没有采全（存盘之前：${libraryLevels(before)}；点「更新」之前：${libraryLevels(atClick)}）`,
      actual: { before, atClick },
      expected: '两次的水位',
    });
  } else if (atClick.applied !== before.applied || atClick.model !== before.model) {
    problems.push({
      code: 'manual-backend-followed',
      message: `点「更新」之前后端自己跟了库 ${manual.dbnum}（存盘之前 ${libraryLevels(before)}，点之前 ${libraryLevels(atClick)}）：这一腿验的不是手动路径`,
      actual: atClick,
      expected: { applied: before.applied, model: before.model },
    });
  } else if (!(atClick.file > atClick.applied)) {
    problems.push({
      code: 'manual-nothing-to-update',
      message: `点「更新」之前库 ${manual.dbnum} 的库文件并不比后端新（${libraryLevels(atClick)}）：没有可更新的`,
      actual: atClick,
      expected: '库文件的会话号大于数据的',
    });
  }

  if (manual.offered !== true) {
    problems.push({
      code: 'manual-update-not-offered',
      message: `要点「更新」的时候，${row} 的行上没有这颗按钮`,
      actual: rowBrief(manual.rowAtClick),
      expected: { action: ['update'] },
    });
  } else if (manual.clicked !== true) {
    problems.push({
      code: 'manual-not-clicked',
      message: `${row} 行上的「更新」没有点上${manual.clickError ? `（${manual.clickError}）` : ''}`,
      actual: rowBrief(manual.rowAtClick),
      expected: '点上',
    });
  } else if (manual.confirmed !== true) {
    problems.push({ code: 'manual-no-confirm', message: '点了「更新」，没有等到页面的确认框', actual: null, expected: '确认框' });
  } else if (manual.request?.accepted !== true) {
    problems.push({
      code: 'manual-update-rejected',
      message: `点了「更新」，后端没有受理${manual.request?.reason ? `：${manual.request.reason}` : ''}`,
      actual: manual.request ?? null,
      expected: '受理（排上了批次）',
    });
  } else if (caughtUp?.ok !== true) {
    const waited = Number.isFinite(caughtUp?.waitedMs) ? ` ${Math.round(caughtUp.waitedMs / 1000)} 秒` : '';
    problems.push({
      code: 'manual-not-caught-up',
      message: `点了「更新」之后，后端${waited}没有追上库 ${manual.dbnum}（${libraryLevels(caughtUp?.library)}）`,
      actual: caughtUp?.library ?? null,
      expected: '三枚水位齐平',
    });
  } else {
    const want = keyedMap(manual.wantAfter);
    if (want.size === 0) throw new TypeError('W2：手动路径没有写后端追上之后行上该出现什么');
    const rows = keyedMap(manual.rowsAfter);
    for (const [root, wanted] of want) {
      if (rowShows(rows.get(root), wanted)) continue;
      problems.push({
        code: 'manual-no-reload-signal',
        message: manual.signalSeen === true
          ? `后端追上之后，${root} 的行出过预期的信号，点「取最新」之前又没了`
          : `后端追上之后，${root} 的行没有出现预期的信号`,
        actual: rowBrief(rows.get(root)),
        expected: wanted,
      });
    }
  }

  if (!sceneSampled || sceneRoots.length === 0) {
    problems.push({
      code: 'manual-scene-not-sampled',
      message: '存盘之前、点「取最新」之前的场景没有都采到，不能说这中间场景没变',
      actual: { before: Boolean(manual.sceneBefore), atGetWork: Boolean(manual.sceneAtGetWork), roots: sceneRoots.length },
      expected: '两份场景',
    });
  } else if (sceneChanged.length > 0) {
    problems.push({
      code: 'manual-scene-changed',
      message: `还没点「取最新」，${sceneChanged.map((item) => item.root).join('、')} 在场景里已经变了`,
      actual: sceneChanged,
      expected: [],
    });
  }
}

/**
 * W2 点一次「取最新」就到位：回执里的数等于预期。预期由调用方拿后端接口在存盘前后的差算好传进来，不取页面自己的说法。
 *
 * 手动路径（`input.manual`，后端不自动跟库）多一下：点「取最新」之前先点行上的「更新」，让后端去跟库。两下各自的结果都在这一项里判
 * （第一下见 `judgeManualUpdate`），「取最新」照样只该点一次。
 *
 * - `expected.tree` 的四个名单按页面树上已经取过的层算（没展开的层页面不知道，回执里也不会有）；`deleted` 只列被删子树的根。
 * - `expected.reload`：名下的后端记录前后有差的根（构件增减、位置变了都算）→ 构件的新增、撤下、现有个数。
 * - `expected.withdrawn`：名下已经没有几何（`empty`）、或库里已经没有它（`deleted`）的根 → 缘由和撤下的个数。
 * - `expected.movedLibraries`：后端模型水位在这一腿前后动了的库。
 *
 * @param {object} input
 * @param {object | null} input.receipt 页面的回执（`GetWorkReport`）
 * @param {number} [input.clicks] 这一腿点了几次「取最新」，缺省 1
 * @param {object} [input.manual] 手动路径：点「取最新」之前点行上「更新」那一下的经过（字段见 `judgeManualUpdate`）
 * @param {Record<string, RootFacts>} [input.roots] 页面上装着的根
 * @param {object} input.expected
 * @param {{ added?: string[], deleted?: string[], renamed?: string[], moved?: string[] }} [input.expected.tree]
 * @param {Record<string, { added: number, removed: number, total?: number }>} [input.expected.reload]
 * @param {Record<string, { why: 'deleted' | 'empty', refnos: number }>} [input.expected.withdrawn]
 * @param {string[]} [input.expected.kept]
 * @param {string[]} [input.expected.loadedNew]
 * @param {number} [input.expected.componentsAdded]
 * @param {number} [input.expected.componentsRemoved]
 * @param {number[]} [input.expected.movedLibraries]
 * @param {{ dbnum: number, kind: string }[]} [input.expected.libraries] 回执里该说「没跟到最新」的库
 * @param {boolean} [input.expected.backendRestarted]
 * @param {{ knownGaps?: object[] }} [options]
 * @returns {Judgement}
 */
export function judgeW2(input, options = {}) {
  const { receipt, expected } = input;
  if (!expected) throw new TypeError('W2：没有给预期');
  const clicks = input.clicks ?? 1;
  const title = input.manual ? '先点行上的「更新」，再点一次「取最新」就到位' : '点一次「取最新」就到位';
  const problems = [];
  const gaps = [];
  const facts = { clicks };
  if (input.manual) judgeManualUpdate(input.manual, problems, facts);

  if (clicks !== 1) {
    problems.push({ code: 'clicks', message: `「取最新」点了 ${clicks} 次`, actual: clicks, expected: 1 });
  }
  if (!receipt) {
    problems.push({ code: 'no-receipt', message: '没有拿到取最新的回执', actual: null, expected: '回执' });
    return conclude('W2', title, problems, gaps, facts);
  }
  if (receipt.ok !== true) {
    problems.push({
      code: 'receipt-failed',
      message: `取最新没有完成：${receipt.error ?? '原因不明'}`,
      actual: { ok: receipt.ok ?? null, error: receipt.error ?? null },
      expected: { ok: true, error: null },
    });
  }
  const restarted = receipt.backendRestarted === true;
  const wantRestarted = expected.backendRestarted === true;
  if (restarted !== wantRestarted) {
    problems.push({
      code: 'backend-restarted',
      message: restarted ? '回执说这次取最新之前后端重启过' : '预期后端重启过，回执里没有',
      actual: restarted,
      expected: wantRestarted,
    });
  }

  judgeReceiptTree(receipt, expected.tree ?? {}, problems);
  judgeReceiptModels(receipt.models ?? {}, expected, keyedMap(input.roots), options, problems, gaps, facts);

  const libraryKey = (item) => `${item.dbnum}:${item.kind}`;
  const libraries = receipt.libraries ?? [];
  const wantLibraries = expected.libraries ?? [];
  const libraryDiff = setDiff(libraries.map(libraryKey), wantLibraries.map(libraryKey));
  if (libraryDiff.extra.length > 0 || libraryDiff.missing.length > 0) {
    problems.push({
      code: 'libraries',
      message: '回执里「没跟到最新」的库对不上',
      actual: libraries.map((item) => ({ dbnum: item.dbnum, kind: item.kind, text: item.text })),
      expected: wantLibraries,
    });
  }
  return conclude('W2', title, problems, gaps, facts);
}

const LINEAR_INDEXES = [0, 1, 2, 4, 5, 6, 8, 9, 10];

function isMatrix(value) {
  return Array.isArray(value) && value.length === 16 && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function positionOf(matrix) {
  return [matrix[12], matrix[13], matrix[14]];
}

function positionGap(a, b) {
  return Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
}

/** 朝向和尺寸那九个分量里超出容差最多的一个；都在容差里回 `null` */
function linearGap(a, b, tolerance) {
  let worst = null;
  for (const index of LINEAR_INDEXES) {
    const gap = Math.abs(a[index] - b[index]);
    const allowed = tolerance.linearAbs + tolerance.linearRel * Math.max(Math.abs(a[index]), Math.abs(b[index]));
    if (gap > allowed && (!worst || gap > worst.gap)) worst = { index, gap, actual: a[index], expected: b[index] };
  }
  return worst;
}

function toObjects(list) {
  return (list ?? []).map((item) => (
    Array.isArray(item) ? { m: item, visible: true } : { m: item?.m ?? null, visible: item?.visible !== false }
  ));
}

function countObjects(byComponent) {
  let count = 0;
  for (const list of Object.values(byComponent ?? {})) count += (list ?? []).length;
  return count;
}

/**
 * 对象在两边没有共同的身份（重载之后对象换了一批），只能按几何配：位置最近的先配，位置一样的再看朝向和尺寸。
 */
function pairObjects(have, want, tolerance) {
  const candidates = [];
  have.forEach((a, i) => {
    want.forEach((b, j) => {
      candidates.push({ i, j, distance: positionGap(a, b), linear: linearGap(a, b, tolerance) });
    });
  });
  candidates.sort((x, y) => x.distance - y.distance || (x.linear?.gap ?? 0) - (y.linear?.gap ?? 0));
  const usedHave = new Set();
  const usedWant = new Set();
  const pairs = [];
  for (const candidate of candidates) {
    if (usedHave.has(candidate.i) || usedWant.has(candidate.j)) continue;
    usedHave.add(candidate.i);
    usedWant.add(candidate.j);
    pairs.push(candidate);
  }
  return pairs;
}

function compareObjects(where, actualList, expectedList, tolerance) {
  const problems = [];
  const actual = toObjects(actualList);
  const broken = actual.filter((item) => !isMatrix(item.m)).length;
  if (broken > 0) {
    problems.push({ code: 'object-without-matrix', message: `${where} 有 ${broken} 个对象读不出位置`, actual: broken, expected: 0 });
  }
  const hidden = actual.filter((item) => !item.visible).length;
  if (hidden > 0) {
    problems.push({ code: 'object-hidden', message: `${where} 有 ${hidden} 个对象在场景里但不可见`, actual: hidden, expected: 0 });
  }
  const have = actual.filter((item) => isMatrix(item.m)).map((item) => item.m);
  const want = toObjects(expectedList).filter((item) => isMatrix(item.m)).map((item) => item.m);
  if (have.length !== want.length) {
    problems.push({ code: 'object-count', message: `${where} 有 ${have.length} 个对象，预期 ${want.length}`, actual: have.length, expected: want.length });
  }
  let maxPositionMm = 0;
  let compared = 0;
  for (const pair of pairObjects(have, want, tolerance)) {
    compared += 1;
    maxPositionMm = Math.max(maxPositionMm, pair.distance);
    if (pair.distance > tolerance.positionMm) {
      problems.push({
        code: 'position',
        message: `${where} 的位置差 ${pair.distance.toFixed(3)} mm（容差 ${tolerance.positionMm} mm）`,
        actual: positionOf(have[pair.i]),
        expected: positionOf(want[pair.j]),
        gapMm: pair.distance,
      });
    } else if (pair.linear) {
      problems.push({
        code: 'orientation',
        message: `${where} 的朝向或尺寸对不上（矩阵第 ${pair.linear.index} 个分量差 ${pair.linear.gap.toPrecision(3)}）`,
        actual: pair.linear.actual,
        expected: pair.linear.expected,
      });
    }
  }
  return { problems, maxPositionMm, compared };
}

function withObjects(byComponent) {
  const out = new Map();
  for (const [component, list] of keyedMap(byComponent)) {
    if ((list ?? []).length > 0) out.set(component, list);
  }
  return out;
}

/** 一个根名下：有对象的构件集合两边相等，每个构件的对象逐个对得上 */
function compareComponents(root, actualByComponent, expectedByComponent, tolerance) {
  const problems = [];
  const actual = withObjects(actualByComponent);
  const expected = withObjects(expectedByComponent);
  const have = [...actual.keys()].sort();
  const want = [...expected.keys()].sort();
  const diff = setDiff(have, want);
  if (diff.missing.length > 0) {
    problems.push({
      code: 'component-missing',
      message: `${root} 名下少 ${diff.missing.length} 个构件`,
      actual: have,
      expected: want,
      missing: diff.missing,
    });
  }
  if (diff.extra.length > 0) {
    problems.push({
      code: 'component-extra',
      message: `${root} 名下多 ${diff.extra.length} 个构件`,
      actual: have,
      expected: want,
      extra: diff.extra,
    });
  }
  let maxPositionMm = 0;
  let objects = 0;
  for (const component of want) {
    if (!actual.has(component)) continue;
    const result = compareObjects(`${root} 名下的 ${component}`, actual.get(component), expected.get(component), tolerance);
    problems.push(...result.problems);
    maxPositionMm = Math.max(maxPositionMm, result.maxPositionMm);
    objects += result.compared;
  }
  return { problems, maxPositionMm, objects, components: want.length };
}

/**
 * W3 场景 = 后端：受影响的根名下，场景里有对象的构件集合等于后端记录，每个构件的位置与后端记录相差不超过 1 mm。
 * 朝向和尺寸也比（位置对了、转错了不能算对）。
 *
 * @param {object} input
 * @param {string[]} input.roots 要比的根
 * @param {SceneByRoot} input.scene 场景里的对象
 * @param {Record<string, { complete: boolean, components: Record<string, number[][]> }>} input.backend
 *   后端记录：根 → 收齐了没有、带几何的构件各自的矩阵
 * @param {{ positionMm?: number, linearAbs?: number, linearRel?: number }} [input.tolerance]
 * @param {boolean} [input.allowEmpty] 这一腿之后这些根名下本来就该一个对象都没有
 * @returns {Judgement}
 */
export function judgeW3(input) {
  const tolerance = { ...MATCH_TOLERANCE, ...input.tolerance };
  const scene = keyedMap(input.scene);
  const backend = keyedMap(input.backend);
  const roots = keyList(input.roots);
  const problems = [];
  const facts = { roots: roots.length, components: 0, objects: 0, maxPositionMm: 0, tolerance };

  for (const root of roots) {
    const records = backend.get(root);
    if (!records) {
      problems.push({ code: 'no-backend-records', message: `${root} 没有取到后端记录`, actual: null, expected: '后端记录' });
      continue;
    }
    if (records.complete !== true) {
      problems.push({
        code: 'backend-incomplete',
        message: `${root} 的后端记录没有收齐，不能当预期用`,
        actual: records.complete ?? null,
        expected: true,
      });
    }
    const result = compareComponents(root, scene.get(root), records.components, tolerance);
    problems.push(...result.problems);
    facts.components += result.components;
    facts.objects += result.objects;
    facts.maxPositionMm = Math.max(facts.maxPositionMm, result.maxPositionMm);
  }
  if (facts.objects === 0 && input.allowEmpty !== true) {
    problems.push({ code: 'nothing-compared', message: '一个对象都没有比到', actual: 0, expected: '至少 1 个' });
  }
  return conclude('W3', '场景 = 后端', problems, [], facts);
}

function isBox(value) {
  if (!Array.isArray(value) || value.length !== 6) return false;
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) return false;
  return value[0] <= value[3] && value[1] <= value[4] && value[2] <= value[5];
}

function boxGap(a, b) {
  return Math.max(...a.map((item, index) => Math.abs(item - b[index])));
}

function unionBox(boxes) {
  const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      out[axis] = Math.min(out[axis], box[axis]);
      out[axis + 3] = Math.max(out[axis + 3], box[axis + 3]);
    }
  }
  return out;
}

function boxProblem(code, where, actual, expected, toleranceMm) {
  const gapMm = boxGap(actual, expected);
  if (gapMm <= toleranceMm) return { gapMm, problem: null };
  return {
    gapMm,
    problem: {
      code,
      message: `${where} 的包围盒差 ${gapMm.toFixed(3)} mm（容差 ${toleranceMm} mm）`,
      actual,
      expected,
      gapMm,
    },
  };
}

function compareBoxesPerItem(group, toleranceMm, problems) {
  const scene = keyedMap(group.scene);
  const truth = keyedMap(group.truth);
  const have = [...scene.keys()].sort();
  const want = [...truth.keys()].sort();
  const diff = setDiff(have, want);
  if (diff.extra.length > 0 || diff.missing.length > 0) {
    problems.push({
      code: 'count',
      message: `${group.name}：场景里 ${have.length} 件，E3D 导出 ${want.length} 件`,
      actual: { count: have.length, items: have },
      expected: { count: want.length, items: want },
      extra: diff.extra,
      missing: diff.missing,
    });
  }
  let compared = 0;
  let maxGapMm = 0;
  for (const key of want) {
    if (!scene.has(key)) continue;
    const actual = scene.get(key);
    const expected = truth.get(key);
    if (!isBox(actual) || !isBox(expected)) {
      problems.push({ code: 'box-invalid', message: `${group.name} 的 ${key} 包围盒读不出来`, actual, expected });
      continue;
    }
    const result = boxProblem('box', `${group.name} 的 ${key}`, actual, expected, toleranceMm);
    if (result.problem) problems.push(result.problem);
    compared += 1;
    maxGapMm = Math.max(maxGapMm, result.gapMm);
  }
  return { compared, maxGapMm };
}

function compareBoxesByUnion(group, toleranceMm, problems) {
  const boxesOf = (value) => (Array.isArray(value) ? value : Object.values(value ?? {}));
  const scene = boxesOf(group.scene);
  const truth = boxesOf(group.truth);
  const invalid = [...scene, ...truth].filter((box) => !isBox(box));
  if (invalid.length > 0) {
    problems.push({ code: 'box-invalid', message: `${group.name} 有 ${invalid.length} 个包围盒读不出来`, actual: invalid, expected: [] });
    return { compared: 0, maxGapMm: 0 };
  }
  if (scene.length !== truth.length) {
    problems.push({
      code: 'count',
      message: `${group.name}：场景里 ${scene.length} 件，E3D 导出 ${truth.length} 件`,
      actual: { count: scene.length },
      expected: { count: truth.length },
    });
  }
  if (scene.length === 0 || truth.length === 0) return { compared: 0, maxGapMm: 0 };
  const result = boxProblem('union-box', `${group.name} 合起来`, unionBox(scene), unionBox(truth), toleranceMm);
  if (result.problem) problems.push(result.problem);
  return { compared: Math.min(scene.length, truth.length), maxGapMm: result.gapMm };
}

/**
 * W4 场景 = E3D：场景里构件的世界包围盒与这一腿之后 E3D 只读导出的 RVM 对上：件数相等，逐个不超过 1 mm。
 *
 * 分组比，组由调用方分好：认得出身份的成员用 `per-item`（两边按同一个键逐个比）；认不出身份的（没有名字的隐式直管段）
 * 按所属的支管用 `count-union`（件数相等、合起来的包围盒对上）。导出里放不进任何一组的成员列在 `unplaced`，有就判不过。
 *
 * @param {object} input
 * @param {boolean} [input.applicable] 这条用例有没有 E3D 真值；没有就记不适用
 * @param {string} [input.reason] 不适用的缘由
 * @param {{ name: string, mode: 'per-item' | 'count-union', scene: object, truth: object }[]} [input.groups]
 * @param {string[]} [input.unplaced]
 * @param {number} [input.toleranceMm]
 * @param {boolean} [input.allowEmpty] 这一腿之后两边本来就该一件都没有
 * @returns {Judgement}
 */
export function judgeW4(input) {
  const title = '场景 = E3D';
  if (input.applicable === false) {
    return {
      id: 'W4',
      title,
      verdict: 'not-applicable',
      label: VERDICT_LABEL['not-applicable'],
      problems: [],
      gaps: [],
      facts: { reason: input.reason ?? '这条用例没有 E3D 真值' },
    };
  }
  const toleranceMm = input.toleranceMm ?? BOX_TOLERANCE_MM;
  const problems = [];
  const facts = { groups: [], compared: 0, maxGapMm: 0, toleranceMm };
  const unplaced = input.unplaced ?? [];
  if (unplaced.length > 0) {
    problems.push({
      code: 'truth-unplaced',
      message: `E3D 导出里有 ${unplaced.length} 个带几何的成员对不上模型树`,
      actual: unplaced,
      expected: [],
    });
  }
  for (const group of input.groups ?? []) {
    let result;
    if (group.mode === 'per-item') result = compareBoxesPerItem(group, toleranceMm, problems);
    else if (group.mode === 'count-union') result = compareBoxesByUnion(group, toleranceMm, problems);
    else throw new TypeError(`W4：不认识的比法 ${group.mode}`);
    facts.groups.push({ name: group.name, mode: group.mode, ...result });
    facts.compared += result.compared;
    facts.maxGapMm = Math.max(facts.maxGapMm, result.maxGapMm);
  }
  if (facts.compared === 0 && input.allowEmpty !== true) {
    problems.push({ code: 'nothing-compared', message: '一件都没有比到', actual: 0, expected: '至少 1 件' });
  }
  return conclude('W4', title, problems, [], facts);
}

function normalizeTree(tree) {
  const out = new Map();
  for (const [id, node] of Object.entries(tree ?? {})) {
    out.set(refnoKey(id), {
      name: node.name ?? '',
      type: node.type ?? '',
      parentId: node.parentId === null || node.parentId === undefined ? null : refnoKey(node.parentId),
      childrenIds: Array.isArray(node.childrenIds) ? node.childrenIds.map(refnoKey) : null,
    });
  }
  return out;
}

function nodeBrief(tree, id) {
  const node = tree.get(id);
  return node ? { id, name: node.name, type: node.type } : { id };
}

function diffNormalizedTrees(before, after) {
  const diff = { added: [], removed: [], renamed: [], retyped: [], moved: [], childrenChanged: [] };
  for (const id of after.keys()) {
    if (!before.has(id)) diff.added.push(id);
  }
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now) {
      diff.removed.push(id);
      continue;
    }
    if (was.name !== now.name) diff.renamed.push({ id, before: was.name, after: now.name });
    if (was.type !== now.type) diff.retyped.push({ id, before: was.type, after: now.type });
    if (was.parentId !== now.parentId) diff.moved.push({ id, before: was.parentId, after: now.parentId });
    if (was.childrenIds && now.childrenIds && was.childrenIds.join(' ') !== now.childrenIds.join(' ')) {
      diff.childrenChanged.push({ id, before: was.childrenIds, after: now.childrenIds });
    }
  }
  diff.added.sort();
  diff.removed.sort();
  return diff;
}

/**
 * 两份页面树的差：多的行、少的行、改了名的、换了类型的、换了上级的、成员表变了的。
 *
 * @param {Tree} before
 * @param {Tree} after
 */
export function diffTree(before, after) {
  return diffNormalizedTrees(normalizeTree(before), normalizeTree(after));
}

/** 树的差里用例解释不了的那些（`allowed` 为空就是全部） */
function strayTreeChanges(diff, before, after, allowedInput) {
  const allowed = {
    added: new Set(keyList(allowedInput.added)),
    deleted: new Set(keyList(allowedInput.deleted)),
    renamed: new Set(keyList(allowedInput.renamed)),
    moved: new Set(keyList(allowedInput.moved)),
  };
  // 子树整棵加进来、删掉、挪走时，预期里只列子树的根：它下面的行跟着算有解释
  const under = (tree, id, sets) => {
    const seen = new Set();
    for (let at = id; at !== null && at !== undefined && !seen.has(at); at = tree.get(at)?.parentId) {
      if (sets.some((set) => set.has(at))) return true;
      seen.add(at);
    }
    return false;
  };
  const stray = {
    added: diff.added.filter((id) => !under(after, id, [allowed.added, allowed.moved])),
    removed: diff.removed.filter((id) => !under(before, id, [allowed.deleted, allowed.moved])),
    renamed: diff.renamed.filter((item) => !allowed.renamed.has(item.id)),
    retyped: diff.retyped,
    moved: diff.moved.filter((item) => !allowed.moved.has(item.id)),
    reordered: [],
  };
  // 成员表只看两边都在、又没有换上级的行的先后：多的、少的、挪的已经各自算过
  const steady = (id) => before.has(id) && after.has(id) && before.get(id).parentId === after.get(id).parentId;
  for (const item of diff.childrenChanged) {
    if (item.before.filter(steady).join(' ') !== item.after.filter(steady).join(' ')) stray.reordered.push(item);
  }
  return stray;
}

function pushTreeProblems(stray, before, after, where, problems) {
  if (stray.added.length > 0) {
    problems.push({
      code: 'tree-added',
      message: `${where}多了 ${stray.added.length} 行`,
      actual: stray.added.map((id) => nodeBrief(after, id)),
      expected: [],
    });
  }
  if (stray.removed.length > 0) {
    problems.push({
      code: 'tree-removed',
      message: `${where}少了 ${stray.removed.length} 行`,
      actual: [],
      expected: stray.removed.map((id) => nodeBrief(before, id)),
    });
  }
  if (stray.renamed.length > 0) {
    problems.push({
      code: 'tree-renamed',
      message: `${where}有 ${stray.renamed.length} 行名字变了`,
      actual: stray.renamed.map((item) => ({ id: item.id, name: item.after })),
      expected: stray.renamed.map((item) => ({ id: item.id, name: item.before })),
    });
  }
  if (stray.retyped.length > 0) {
    problems.push({
      code: 'tree-retyped',
      message: `${where}有 ${stray.retyped.length} 行类型变了`,
      actual: stray.retyped.map((item) => ({ id: item.id, type: item.after })),
      expected: stray.retyped.map((item) => ({ id: item.id, type: item.before })),
    });
  }
  if (stray.moved.length > 0) {
    problems.push({
      code: 'tree-moved',
      message: `${where}有 ${stray.moved.length} 行换了上级`,
      actual: stray.moved.map((item) => ({ id: item.id, parentId: item.after })),
      expected: stray.moved.map((item) => ({ id: item.id, parentId: item.before })),
    });
  }
  if (stray.reordered.length > 0) {
    problems.push({
      code: 'tree-reordered',
      message: `${where}有 ${stray.reordered.length} 行下面的先后次序变了`,
      actual: stray.reordered.map((item) => ({ id: item.id, childrenIds: item.after })),
      expected: stray.reordered.map((item) => ({ id: item.id, childrenIds: item.before })),
    });
  }
  return stray.added.length + stray.removed.length + stray.renamed.length + stray.retyped.length + stray.moved.length + stray.reordered.length;
}

function sameRowAndEye(a, b) {
  return sameRow(a, b) && (a.eyeLit === true) === (b.eyeLit === true);
}

/**
 * W5 不该动的没动：用例之外的根没有被重载，对象和位置逐个不变；模型树别处不变。
 *
 * 「别处」= 用例预期的树变化之外：`expected.tree` 列的新增 / 删除 / 改名 / 挪位置及它们下面的行算有解释，其余的差都判不过。
 * 对象「不变」按浮点误差的量级判（不是 1 mm）。
 *
 * @param {object} input
 * @param {string[]} input.controlRoots 用例之外、装着作对照的根
 * @param {object | null} input.receipt 页面的回执
 * @param {Record<string, RootFacts>} [input.roots]
 * @param {{ movedLibraries?: number[], tree?: { added?: string[], deleted?: string[], renamed?: string[], moved?: string[] } }} [input.expected]
 * @param {SceneByRoot} input.sceneBefore 取最新之前的场景
 * @param {SceneByRoot} input.sceneAfter 取最新之后的场景
 * @param {Tree} input.treeBefore
 * @param {Tree} input.treeAfter
 * @param {Record<string, RowState>} [input.rowsBefore] 对照根的行，存盘之前
 * @param {Record<string, RowState>} [input.rowsAfter] 对照根的行，取最新之后
 * @param {{ positionMm?: number, linearAbs?: number, linearRel?: number }} [input.tolerance]
 * @param {{ knownGaps?: object[] }} [options]
 * @returns {Judgement}
 */
export function judgeW5(input, options = {}) {
  const expected = input.expected ?? {};
  const controls = keyList(input.controlRoots);
  const rootsInfo = keyedMap(input.roots);
  const tolerance = { ...UNCHANGED_TOLERANCE, ...input.tolerance };
  const problems = [];
  const gaps = [];
  const facts = { controlRoots: controls.length, objects: 0, maxPositionMm: 0, strayTreeChanges: 0, tolerance };

  if (controls.length === 0) {
    problems.push({ code: 'no-control', message: '没有装用例之外的根，没有东西作对照', actual: 0, expected: '至少 1 个' });
  }

  if (!input.receipt) {
    problems.push({ code: 'no-receipt', message: '没有拿到取最新的回执，不能说对照的根没有被重载', actual: null, expected: '回执' });
  } else {
    const models = input.receipt.models ?? {};
    const movedLibraries = new Set((expected.movedLibraries ?? []).map(Number));
    const reloaded = listedByRefno(models.reloaded);
    const others = [
      ['control-withdrawn', '被撤下了', listedByRefno(models.withdrawn)],
      ['control-failed', '重载没成', listedByRefno(models.failed)],
      ['control-kept', '被回执列成「模型没有动」（页面认为它有事）', listedByRefno(models.kept)],
    ];
    for (const root of controls) {
      if (reloaded.has(root)) {
        const outcome = judgeUnexpectedReload(root, reloaded.get(root), rootsInfo.get(root), movedLibraries, options);
        problems.push(...outcome.problems);
        gaps.push(...outcome.gaps);
      }
      for (const [code, what, listed] of others) {
        if (!listed.has(root)) continue;
        problems.push({ code, message: `用例之外的根 ${root} ${what}`, actual: listed.get(root), expected: null });
      }
    }
  }

  const sceneBefore = keyedMap(input.sceneBefore);
  const sceneAfter = keyedMap(input.sceneAfter);
  for (const root of controls) {
    if (!sceneBefore.has(root)) {
      problems.push({ code: 'no-baseline', message: `${root} 取最新之前的场景没有采到`, actual: null, expected: '取最新之前的场景' });
      continue;
    }
    const result = compareComponents(root, sceneAfter.get(root), sceneBefore.get(root), tolerance);
    problems.push(...result.problems);
    facts.objects += result.objects;
    facts.maxPositionMm = Math.max(facts.maxPositionMm, result.maxPositionMm);
  }
  if (controls.length > 0 && facts.objects === 0) {
    problems.push({ code: 'nothing-compared', message: '对照的根名下一个对象都没有比到', actual: 0, expected: '至少 1 个' });
  }

  if (!input.treeBefore || !input.treeAfter) {
    problems.push({ code: 'no-tree', message: '没有前后两份模型树，不能说别处没变', actual: null, expected: '前后两份模型树' });
  } else {
    const before = normalizeTree(input.treeBefore);
    const after = normalizeTree(input.treeAfter);
    const stray = strayTreeChanges(diffNormalizedTrees(before, after), before, after, expected.tree ?? {});
    facts.strayTreeChanges = pushTreeProblems(stray, before, after, '模型树别处', problems);
  }

  if (input.rowsBefore && input.rowsAfter) {
    const rowsBefore = keyedMap(input.rowsBefore);
    const rowsAfter = keyedMap(input.rowsAfter);
    for (const root of controls) {
      const was = rowsBefore.get(root);
      const now = rowsAfter.get(root);
      if (!was || !now) {
        problems.push({ code: 'row-not-sampled', message: `${root} 的行前后没有都采到`, actual: rowBrief(now), expected: rowBrief(was) });
      } else if (!sameRowAndEye(was, now)) {
        problems.push({
          code: 'control-row-changed',
          message: `用例之外的根 ${root} 的行变了`,
          actual: { ...rowBrief(now), eyeLit: now.eyeLit === true },
          expected: { ...rowBrief(was), eyeLit: was.eyeLit === true },
        });
      }
    }
  }
  return conclude('W5', '不该动的没动', problems, gaps, facts);
}

const LOCAL_SCHEMES = new Set(['data:', 'blob:', 'about:']);

function parseRequest(item) {
  const url = typeof item === 'string' ? item : item.url;
  const method = typeof item === 'string' ? 'GET' : (item.method ?? 'GET');
  try {
    const parsed = new URL(url);
    const secure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
    return { method, url, protocol: parsed.protocol, host: parsed.host, port: parsed.port || (secure ? '443' : '80') };
  } catch {
    return { method, url, protocol: null, host: null, port: null };
  }
}

function tally(requests) {
  const counts = new Map();
  for (const item of requests) {
    const key = `${item.method} ${item.url}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * W6 干净：页面没有报错；页面发出的请求只到页面服务和隔离后端，发往现网端口的为 0。
 *
 * `ignoreErrors` 是明说不算的报错（每条要写缘由），被它放过的逐条记在 `facts.ignoredErrors`，不会悄悄消失。
 *
 * @param {object} input
 * @param {string[]} input.allowedOrigins 页面服务和隔离后端的地址
 * @param {(string | { method?: string, url: string })[]} input.requests 页面发出的全部请求
 * @param {(string | { method?: string, url: string })[]} [input.toLive] 守卫记下的发往现网端口的请求（含 WebSocket）
 * @param {unknown[]} [input.blocked] 守卫拦下的别的请求
 * @param {(string | { text?: string, message?: string })[]} [input.consoleErrors]
 * @param {(string | { text?: string, message?: string })[]} [input.pageErrors]
 * @param {{ pattern: string, reason: string }[]} [input.ignoreErrors]
 * @param {number[]} [input.livePorts]
 * @returns {Judgement}
 */
export function judgeW6(input) {
  const allowedHosts = new Set((input.allowedOrigins ?? []).map((origin) => new URL(origin).host));
  if (allowedHosts.size === 0) throw new TypeError('W6：没有给页面服务和隔离后端的地址');
  const livePorts = new Set((input.livePorts ?? LIVE_PORTS).map(String));
  const ignore = (input.ignoreErrors ?? []).map((rule) => {
    if (!rule.reason) throw new TypeError(`W6：放过的报错 ${rule.pattern} 没有写缘由`);
    return { regex: new RegExp(rule.pattern), reason: rule.reason };
  });
  const problems = [];
  const requests = (input.requests ?? []).map(parseRequest);
  const isLive = (item) => item.port !== null && livePorts.has(item.port);

  // 守卫记的和请求清单里的可能是同一批：按「方法 + 地址」各取多的那个数，不重复算也不漏
  const seen = tally(requests.filter(isLive));
  for (const [key, count] of tally((input.toLive ?? []).map(parseRequest))) {
    seen.set(key, Math.max(seen.get(key) ?? 0, count));
  }
  const toLive = [...seen].map(([request, count]) => ({ request, count }));
  const toLiveCount = toLive.reduce((sum, item) => sum + item.count, 0);
  if (toLiveCount > 0) {
    problems.push({
      code: 'request-to-live',
      message: `有 ${toLiveCount} 条请求发往 ${[...livePorts].join(' / ')}`,
      actual: toLive,
      expected: [],
    });
  }

  const elsewhere = requests.filter((item) => (
    item.protocol !== null && !LOCAL_SCHEMES.has(item.protocol) && !isLive(item) && !allowedHosts.has(item.host)
  ));
  if (elsewhere.length > 0) {
    problems.push({
      code: 'request-elsewhere',
      message: `有 ${elsewhere.length} 条请求没有发到页面服务或隔离后端`,
      actual: [...tally(elsewhere)].map(([request, count]) => ({ request, count })),
      expected: [...allowedHosts],
    });
  }
  const unreadable = requests.filter((item) => item.protocol === null);
  if (unreadable.length > 0) {
    problems.push({
      code: 'request-unreadable',
      message: `有 ${unreadable.length} 条请求的地址读不出来`,
      actual: unreadable.map((item) => item.url),
      expected: [],
    });
  }
  const blocked = input.blocked ?? [];
  if (blocked.length > 0) {
    problems.push({
      code: 'request-blocked',
      message: `守卫拦下了 ${blocked.length} 条请求，页面这一段不是它自己的行为`,
      actual: blocked,
      expected: [],
    });
  }
  if (requests.length === 0) {
    problems.push({ code: 'no-requests', message: '没有采到页面的请求，不能说请求只到了隔离后端', actual: 0, expected: '至少 1 条' });
  }

  const errors = [];
  const ignoredErrors = [];
  for (const [kind, list] of [['console', input.consoleErrors ?? []], ['page', input.pageErrors ?? []]]) {
    for (const entry of list) {
      const text = typeof entry === 'string' ? entry : String(entry?.text ?? entry?.message ?? JSON.stringify(entry));
      const rule = ignore.find((item) => item.regex.test(text));
      if (rule) ignoredErrors.push({ kind, text, reason: rule.reason });
      else errors.push({ kind, text });
    }
  }
  if (errors.length > 0) {
    problems.push({ code: 'page-error', message: `页面有 ${errors.length} 条报错`, actual: errors, expected: [] });
  }

  const facts = { requests: requests.length, toLive: toLiveCount, elsewhere: elsewhere.length, errors: errors.length, ignoredErrors };
  return conclude('W6', '干净', problems, [], facts);
}

/** 名字里带着自己的参考号的（没起名的元素），重建之后参考号换了、名字跟着换：比之前把它拿掉 */
function stableName(name, id) {
  const [a, b] = id.split('_');
  if (!b) return name;
  return name.replaceAll(`${a}/${b}`, '<refno>').replaceAll(`${a}_${b}`, '<refno>');
}

/** 树里没有上级（或者上级不在这份树里）的那几行，按参考号排好 */
function treeTops(tree) {
  return [...tree.keys()].filter((id) => {
    const parent = tree.get(id).parentId;
    return parent === null || !tree.has(parent);
  }).sort();
}

/**
 * 重建类的还原：删掉的元素建回来之后参考号是新的，树不能按参考号比。从顶层往下，按成员次序逐个对，比类型和名字；
 * 参考号换了的记下来，不算错。
 */
function alignRebuiltTree(before, after) {
  const problems = [];
  const refnoChanges = [];
  const topsBefore = treeTops(before);
  const topDiff = setDiff(treeTops(after), topsBefore);
  if (topDiff.extra.length > 0 || topDiff.missing.length > 0) {
    problems.push({
      code: 'tree-top',
      message: '还原之后树的顶层和还原之前不一样',
      actual: topDiff.extra.map((id) => nodeBrief(after, id)),
      expected: topDiff.missing.map((id) => nodeBrief(before, id)),
    });
  }
  const walk = (beforeId, afterId, path) => {
    const was = before.get(beforeId);
    const now = after.get(afterId);
    const here = `${path}/${was.name || beforeId}`;
    if (was.type !== now.type) {
      problems.push({ code: 'tree-retyped', message: `${here} 的类型变了`, actual: now.type, expected: was.type });
    }
    if (stableName(was.name, beforeId) !== stableName(now.name, afterId)) {
      problems.push({ code: 'tree-renamed', message: `${here} 的名字变了`, actual: now.name, expected: was.name });
    }
    if (beforeId !== afterId) refnoChanges.push({ path: here, before: beforeId, after: afterId });
    if (!was.childrenIds && !now.childrenIds) return;
    const kidsBefore = (was.childrenIds ?? []).filter((id) => before.has(id));
    const kidsAfter = (now.childrenIds ?? []).filter((id) => after.has(id));
    if (kidsBefore.length !== kidsAfter.length) {
      problems.push({
        code: 'tree-children',
        message: `${here} 下面有 ${kidsAfter.length} 行，还原之前是 ${kidsBefore.length} 行`,
        actual: kidsAfter.map((id) => nodeBrief(after, id)),
        expected: kidsBefore.map((id) => nodeBrief(before, id)),
      });
      return;
    }
    kidsBefore.forEach((kid, index) => walk(kid, kidsAfter[index], here));
  };
  for (const id of topsBefore) {
    if (after.has(id)) walk(id, id, '');
  }
  return { problems, refnoChanges };
}

/**
 * 重建类的还原在比树之前要先展开哪几行：apply 之前取过成员那一层、还原之后换了参考号又还没展开过的节点。
 * 删了再建出来的节点在页面的树上是新的一行，它的成员那一层页面还没取过；不先展开，比出来的差别只是「页面还没问」。
 * 对法和 `alignRebuiltTree` 一样（从顶层往下按成员次序）。参考号没换的节点不在此列：它那一层原来取过、现在没了，照实判。
 *
 * @param {Tree} treeBefore apply 之前的页面树
 * @param {Tree} treeAfter 还原并取最新之后的页面树
 * @returns {string[]} 还原之后那份树里要展开的节点
 */
export function rebuiltLayersToOpen(treeBefore, treeAfter) {
  const before = normalizeTree(treeBefore);
  const after = normalizeTree(treeAfter);
  const open = [];
  const walk = (beforeId, afterId) => {
    const was = before.get(beforeId);
    const now = after.get(afterId);
    if (!was.childrenIds) return;
    if (!now.childrenIds) {
      if (beforeId !== afterId) open.push(afterId);
      return;
    }
    const kidsBefore = was.childrenIds.filter((id) => before.has(id));
    const kidsAfter = now.childrenIds.filter((id) => after.has(id));
    if (kidsBefore.length !== kidsAfter.length) return;
    kidsBefore.forEach((kid, index) => walk(kid, kidsAfter[index]));
  };
  for (const id of treeTops(before)) {
    if (after.has(id)) walk(id, id);
  }
  return open;
}

/** 重建类的还原：参考号没换的构件照常逐个比；只在一边有的，按几何找对应（建回来的构件该在原处） */
function compareRebuiltComponents(root, afterByComponent, beforeByComponent, tolerance) {
  const after = withObjects(afterByComponent);
  const before = withObjects(beforeByComponent);
  const problems = [];
  const refnoChanges = [];
  let maxPositionMm = 0;
  let objects = 0;
  const tallyResult = (result) => {
    maxPositionMm = Math.max(maxPositionMm, result.maxPositionMm);
    objects += result.compared;
  };
  const unmatched = new Set([...after.keys()].filter((component) => !before.has(component)).sort());
  for (const component of [...before.keys()].sort()) {
    if (after.has(component)) {
      const result = compareObjects(`${root} 名下的 ${component}`, after.get(component), before.get(component), tolerance);
      problems.push(...result.problems);
      tallyResult(result);
      continue;
    }
    let found = null;
    for (const candidate of unmatched) {
      const result = compareObjects('', after.get(candidate), before.get(component), tolerance);
      if (result.problems.length > 0) continue;
      found = candidate;
      tallyResult(result);
      break;
    }
    if (found) {
      unmatched.delete(found);
      refnoChanges.push({ root, before: component, after: found });
    } else {
      problems.push({
        code: 'component-not-restored',
        message: `${root} 名下的 ${component} 还原之后找不到几何对得上的构件`,
        actual: [...unmatched],
        expected: component,
      });
    }
  }
  if (unmatched.size > 0) {
    problems.push({
      code: 'component-extra',
      message: `${root} 名下还原之后多 ${unmatched.size} 个构件`,
      actual: [...unmatched],
      expected: [],
    });
  }
  return { problems, refnoChanges, maxPositionMm, objects };
}

/** 名下已经没有对象的根，行上的眼睛不该亮、已加载节点表里不该还有它 */
function judgeRowsAgainstScene(rows, scene, loadedTable, rootsInfo, options, problems, gaps) {
  const gap = knownGap(options, 'KG2');
  const table = loadedTable ? new Set(keyList(loadedTable)) : null;
  for (const [root, row] of rows) {
    if (countObjects(scene.get(root)) > 0) continue;
    const eyeLit = row.eyeLit === true;
    const listed = table ? table.has(root) : null;
    if (!eyeLit && listed !== true) continue;
    const actual = { objects: 0, eyeLit, inLoadedTable: listed };
    const expected = { objects: 0, eyeLit: false, inLoadedTable: table ? false : null };
    const what = [eyeLit ? '行上的眼睛还亮着' : '', listed ? '已加载节点表里还有它' : ''].filter(Boolean).join('，');
    const message = `${root} 名下已经没有对象，${what}`;
    if (gapApplies(gap, rootsInfo.get(root))) gaps.push(gapHit(gap, { message, root, actual, expected }));
    else problems.push({ code: 'eye-lit-without-objects', message, actual, expected });
  }
}

/**
 * W7 还原之后回到原样：取最新之后，树和场景与 apply 之前逐项相同（会话号不在比的范围里）。
 *
 * - `identical`（属性类的还原）：树按参考号逐行相同，场景按参考号逐个构件相同。
 * - `rebuild`（删了再建的还原）：建回来的元素参考号是新的，树按成员次序 + 类型 + 名字比，场景里换了参考号的构件按几何找对应；
 *   换了的参考号记在 `facts.refnoChanges`，不算错。给了 `rebuiltCount` 就要求场景里换了参考号的构件正好这么多。
 *   建回来的节点在树上是新的一行、还没展开过：调用方先按 `rebuiltLayersToOpen` 把它们展开，再把展开之后的树交进来，
 *   展开过哪几行用 `openedForCompare` 报上来，记在 `facts.openedForCompare`。
 *
 * 给了行状态就顺带比：前后都有的根，行和眼睛要一样；名下没有对象的根，眼睛不该亮。
 *
 * @param {object} input
 * @param {'identical' | 'rebuild'} [input.mode]
 * @param {string[]} input.roots 页面上装着的根
 * @param {Tree} input.treeBefore apply 之前的页面树
 * @param {Tree} input.treeAfter 还原并取最新之后的页面树
 * @param {SceneByRoot} input.sceneBefore
 * @param {SceneByRoot} input.sceneAfter
 * @param {number} [input.rebuiltCount]
 * @param {string[]} [input.openedForCompare] 比树之前由脚本展开过的行（重建类）
 * @param {Record<string, RowState>} [input.rowsBefore]
 * @param {Record<string, RowState>} [input.rowsAfter]
 * @param {string[]} [input.loadedTableAfter] 还原之后已加载节点表里的根
 * @param {Record<string, RootFacts>} [input.rootsInfo]
 * @param {{ positionMm?: number, linearAbs?: number, linearRel?: number }} [input.tolerance]
 * @param {{ knownGaps?: object[] }} [options]
 * @returns {Judgement}
 */
export function judgeW7(input, options = {}) {
  const mode = input.mode ?? 'identical';
  if (mode !== 'identical' && mode !== 'rebuild') throw new TypeError(`W7：不认识的比法 ${mode}`);
  const tolerance = { ...MATCH_TOLERANCE, ...input.tolerance };
  const roots = keyList(input.roots);
  const problems = [];
  const gaps = [];
  const facts = { mode, roots: roots.length, objects: 0, maxPositionMm: 0, refnoChanges: { tree: [], scene: [] }, tolerance };
  if (input.openedForCompare) facts.openedForCompare = keyList(input.openedForCompare);

  if (!input.treeBefore || !input.treeAfter) {
    problems.push({ code: 'no-tree', message: '没有前后两份模型树', actual: null, expected: '前后两份模型树' });
  } else {
    const before = normalizeTree(input.treeBefore);
    const after = normalizeTree(input.treeAfter);
    if (before.size === 0) {
      problems.push({ code: 'no-tree', message: 'apply 之前的模型树是空的', actual: 0, expected: '至少 1 行' });
    } else if (mode === 'identical') {
      const stray = strayTreeChanges(diffNormalizedTrees(before, after), before, after, {});
      pushTreeProblems(stray, before, after, '还原之后模型树', problems);
    } else {
      const aligned = alignRebuiltTree(before, after);
      problems.push(...aligned.problems);
      facts.refnoChanges.tree = aligned.refnoChanges;
    }
  }

  const sceneBefore = keyedMap(input.sceneBefore);
  const sceneAfter = keyedMap(input.sceneAfter);
  for (const root of roots) {
    if (!sceneBefore.has(root)) {
      problems.push({ code: 'no-baseline', message: `${root} apply 之前的场景没有采到`, actual: null, expected: 'apply 之前的场景' });
      continue;
    }
    const compare = mode === 'identical' ? compareComponents : compareRebuiltComponents;
    const result = compare(root, sceneAfter.get(root), sceneBefore.get(root), tolerance);
    problems.push(...result.problems);
    facts.objects += result.objects;
    facts.maxPositionMm = Math.max(facts.maxPositionMm, result.maxPositionMm);
    if (result.refnoChanges) facts.refnoChanges.scene.push(...result.refnoChanges);
  }
  if (facts.objects === 0) {
    problems.push({ code: 'nothing-compared', message: '一个对象都没有比到', actual: 0, expected: '至少 1 个' });
  }
  if (mode === 'rebuild' && input.rebuiltCount !== undefined && facts.refnoChanges.scene.length !== input.rebuiltCount) {
    problems.push({
      code: 'rebuilt-count',
      message: `场景里换了参考号的构件有 ${facts.refnoChanges.scene.length} 个，预期 ${input.rebuiltCount}`,
      actual: facts.refnoChanges.scene,
      expected: input.rebuiltCount,
    });
  }

  if (input.rowsAfter) {
    const rowsAfter = keyedMap(input.rowsAfter);
    for (const [root, was] of keyedMap(input.rowsBefore)) {
      const now = rowsAfter.get(root);
      if (!now) {
        problems.push({ code: 'row-not-sampled', message: `${root} 的行还原之后没有采到`, actual: null, expected: rowBrief(was) });
      } else if (!sameRowAndEye(was, now)) {
        problems.push({
          code: 'row-not-restored',
          message: `${root} 的行没有回到原样`,
          actual: { ...rowBrief(now), eyeLit: now.eyeLit === true },
          expected: { ...rowBrief(was), eyeLit: was.eyeLit === true },
        });
      }
    }
    judgeRowsAgainstScene(rowsAfter, sceneAfter, input.loadedTableAfter, keyedMap(input.rootsInfo), options, problems, gaps);
  }
  return conclude('W7', '还原之后回到原样', problems, gaps, facts);
}

/**
 * 同一个看点在一条腿里判了两回（点完「取最新」一回，之后加装了节点又一回），并成一格：两回的问题、已知缺口接在一起，
 * 后一回的每一条前面加上 `prefix`（说明是哪一步之后看到的）；后一回的事实放在 `facts.afterLoad`。哪一回有「不过」，这一格就是「不过」。
 * `extraProblems` 是两回之外另记的问题（比如要加装的节点根本没装进场景），原样算进去。
 *
 * @param {Judgement} first 点完「取最新」那一回
 * @param {Judgement} second 加装之后那一回
 * @param {string} prefix
 * @param {Problem[]} [extraProblems]
 * @returns {Judgement}
 */
export function joinJudgements(first, second, prefix, extraProblems = []) {
  if (!first || !second) throw new TypeError('并判定：要两回的判定');
  if (first.id !== second.id) throw new TypeError(`并判定：两回不是同一个看点（${first.id}、${second.id}）`);
  const problems = [
    ...first.problems,
    ...extraProblems,
    ...second.problems.map((problem) => ({ ...problem, message: `${prefix}${problem.message}` })),
  ];
  const gaps = [...first.gaps, ...second.gaps.map((hit) => ({ ...hit, message: `${prefix}${hit.message}` }))];
  return conclude(first.id, first.title, problems, gaps, { ...first.facts, afterLoad: second.facts });
}

/**
 * 一条腿的几个看点合成一个结论：有一个不过就是不过；没有不过、有已知缺口就是已知缺口；不适用的不参加。
 *
 * @param {Judgement[]} judgements
 */
export function summarize(judgements) {
  const judged = judgements.filter((item) => item.verdict !== 'not-applicable');
  let verdict = 'pass';
  if (judged.length === 0) verdict = 'not-applicable';
  else if (judged.some((item) => item.verdict === 'fail')) verdict = 'fail';
  else if (judged.some((item) => item.verdict === 'known-gap')) verdict = 'known-gap';
  return {
    verdict,
    label: VERDICT_LABEL[verdict],
    checkpoints: Object.fromEntries(judgements.map((item) => [item.id, item.verdict])),
    problems: judged.reduce((sum, item) => sum + item.problems.length, 0),
    gaps: [...new Set(judged.flatMap((item) => item.gaps.map((hit) => hit.gap)))].sort(),
  };
}
