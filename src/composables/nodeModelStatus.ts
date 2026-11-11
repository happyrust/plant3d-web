/**
 * 节点模型状态（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C2；ADR 0072 第 4 条）：
 * 一个 SITE / ZONE（或更下层的节点），它的模型生成过没有、新不新。
 *
 * 口径（2026-11-10 用户定）：库一级按库文件最新会话；**节点一级只有模型生成之后真有会话改到它下面的构件**
 * （网格变、位置变、新增、删除）才算落后，E3D 登录产生的空会话不算。所以「库有 10 个新会话」和「这个 SITE 落后」是两回事。
 *
 * 页面还多一层：本页装的是哪一版。库里的模型已经比本页装的新、而且其间真改到了这个节点，是「有更新可重载」。
 *
 * **事实来源只有 `resolveNodeModelStatus` 一个入口。** 2026-11-11 起它问后端的 `GET node/model-status`
 * （gen-model 规范 §4.5.3，ADR-099）：一次回答这个节点生成过没有、是不是最新、要生成的话有多少，未初始化的库也答得出；
 * 落后按净差分判（先改后改回不算）。「有更新可重载」是页面这一层的事（本页装的是哪一版），后端不知道，只在库的模型水位
 * 比本页装的那一版新时，再用节点版本表（`node/versions?since_sesno=`）问一次其间改没改到本节点。
 *
 * 服务端没有那条路由（旧构建）时退回过渡办法：`/dbnums` 那一行的水位加节点版本表现算——那时未初始化的库说不出结论
 * （`untracked`），`partial` / `not_generated` / `empty` 也给不出。
 */
import type { DbnumRow, NodeModelStatusResponse } from '@/api/genModelV1Api';

import { judgeDbnumFreshness } from '@/composables/dbnumFreshness';
import { toRefnoKey } from '@/utils/refnoKey';

/**
 * - `latest`：全部生成过，生成之后没有会话改到这个节点；
 * - `lagging`：全部生成过，但生成之后有会话改到了它——已初始化的库要「更新到最新」；
 * - `reloadable`：库里的模型比本页装的新，其间有会话改到了它——点「重载」就能换上；
 * - `partial`：只生成了一部分单元——点「生成」补齐；
 * - `not_generated`：一个单元都没生成过；
 * - `empty`：这个节点下没有生成单元，不需要生成；
 * - `updating`：库正在被写；
 * - `untracked`：未初始化的库、而且服务端没有节点模型状态接口（旧构建）：没有水位可比；
 * - `unknown`：判不了（库状态没取到、没有模型水位、水位对不上、接口失败）。
 */
export type NodeModelVerdict =
  | 'latest'
  | 'lagging'
  | 'reloadable'
  | 'updating'
  | 'untracked'
  | 'unknown'
  | 'partial'
  | 'not_generated'
  | 'empty';

/** 改到了这个节点模型的一个会话。 */
export type NodeChangedSession = {
  sesno: number;
  /** 这个会话在 E3D 里的保存时刻；读不出为 `null` */
  time: string | null;
  /** 这个会话里有几何要重算的最小交付单元数 */
  unitsChanged: number;
};

/** 子树里生成单元的计数（`total = generated + missing + failed`，`lagging ≤ generated`） */
export type NodeModelUnits = {
  total: number;
  generated: number;
  missing: number;
  /** 最近一次生成失败、还没重新成功的 */
  failed: number;
  /** 已生成的里面，生成之后被改到了的 */
  lagging: number;
  /** `lagging` 与 `missing` 是不是精确的 */
  exact: boolean;
};

/** 生成之后到库文件最新之间这个节点下的净变化 */
export type NodeModelChanges = {
  fromSesno: number;
  toSesno: number;
  /** 有几何变化的交付单元数（含新增的、被删的） */
  unitsChanged: number;
  unitsAdded: number;
  unitsRemoved: number;
  /** 有不属于任何生成单元的构件发生了几何变化 */
  unattributed: boolean;
};

/** 已生成的那部分靠什么担保：库的模型水位、本进程按需生成的回执、两种都有 */
export type NodeModelGeneratedBasis = 'library_watermark' | 'own_generation' | 'mixed';

/**
 * 后端节点模型状态接口给的事实（`GET node/model-status`），字段改成驼峰。这是服务端按需现算的派生量，不是页面的记忆。
 */
export type NodeModelFacts = {
  /** 后端的七个判定值 */
  verdict: 'unknown' | 'updating' | 'empty' | 'not_generated' | 'partial' | 'lagging' | 'latest';
  verdictReason: string | null;
  dbnum: number;
  noun: string;
  /** 请求的节点在某个生成单元之内时是那个单元的根（`a_b`） */
  unitRoot: string | null;
  units: NodeModelUnits;
  generatedAt: {
    sesnoMin: number;
    sesnoMax: number;
    timeMin: string | null;
    timeMax: string | null;
    basis: NodeModelGeneratedBasis;
  } | null;
  changes: NodeModelChanges | null;
  /** 生成预检：不带 force 生成一次至少要生成几个单元、要不要先确认、阈值（后端给的） */
  precheck: { unitsToGenerate: number; needsConfirm: boolean; thresholdUnits: number };
  library: {
    fileLatestSesno: number | null;
    modelSesno: number | null;
    modelSesnoTime: string | null;
    /** 这个库在不在后端的更新范围里；不在的库「更新到最新」会被拒绝 */
    inWatchScope: boolean;
  };
};

export type NodeModelStatus = {
  verdict: NodeModelVerdict;
  /** `unknown` 的原因（给人看） */
  reason: string | null;
  dbnum: number;
  /** 事实从哪来：`model-status` = 后端的节点模型状态接口；`versions` = 过渡办法（库水位 + 节点版本表） */
  source: 'model-status' | 'versions';
  /** 库里的模型按哪个会话生成（模型水位） */
  modelSesno: number | null;
  /** 模型水位那个会话的保存时刻 */
  modelSavedAt: string | null;
  fileLatestSesno: number | null;
  /** 本页装的时候库的模型水位；当时没记下（或这个节点没装进场景）为 `null` */
  loadedModelSesno: number | null;
  /** 库的模型水位之后改到本节点的会话：要「更新到最新」才追得上（只有过渡办法逐个点名；接口给的是净变化，见 `changes`） */
  laggingSessions: NodeChangedSession[];
  /** 本页那一版之后、库的模型水位之前（含）改到本节点的会话：「重载」就能换上 */
  reloadableSessions: NodeChangedSession[];
  /** 库文件最新会话比模型对应到的会话多出几个（不管涉没涉及本节点） */
  librarySessionsAhead: number;
  /** 生成单元的计数；过渡办法给不出为 `null` */
  units: NodeModelUnits | null;
  /** 不带 force 生成一次至少要生成的单元数；过渡办法给不出为 `null` */
  unitsToGenerate: number | null;
  /** 已生成的那部分对应到哪些会话、靠什么担保 */
  generated: { sesnoMin: number; sesnoMax: number; timeMin: string | null; basis: NodeModelGeneratedBasis } | null;
  /** 生成之后的净变化（落后时有） */
  changes: NodeModelChanges | null;
  /** 这个库在不在后端的更新范围里；过渡办法不知道为 `null` */
  inWatchScope: boolean | null;
  checkedAt: number;
};

function sesnoOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 接口回执 → 事实。数字缺了按 0、布尔缺了按保守的一边算（不精确、不在更新范围里）。 */
export function nodeModelFactsOf(response: NodeModelStatusResponse): NodeModelFacts {
  const units = response.units ?? ({} as NodeModelStatusResponse['units']);
  const generatedAt = response.generated_at;
  const changes = response.changes;
  // 不认识的担保方式按「靠库的模型水位」算（它给「更新」，另两种不给）
  const rawBasis = generatedAt?.basis;
  const basis: NodeModelGeneratedBasis = rawBasis === 'own_generation' ? 'own_generation' : rawBasis === 'mixed' ? 'mixed' : 'library_watermark';
  const unitsToGenerate = countOf(response.precheck?.units_to_generate);
  const thresholdUnits = countOf(response.precheck?.confirm_threshold_units);
  return {
    verdict: response.verdict,
    verdictReason: response.verdict_reason ?? null,
    dbnum: response.dbnum,
    noun: String(response.noun ?? '').trim().toUpperCase(),
    unitRoot: response.unit_root ? toRefnoKey(response.unit_root) : null,
    units: {
      total: countOf(units.total),
      generated: countOf(units.generated),
      missing: countOf(units.missing),
      failed: countOf(units.failed),
      lagging: countOf(units.lagging),
      exact: units.exact === true,
    },
    generatedAt: generatedAt
      ? {
        sesnoMin: countOf(generatedAt.sesno_min),
        sesnoMax: countOf(generatedAt.sesno_max),
        timeMin: generatedAt.time_min ?? null,
        timeMax: generatedAt.time_max ?? null,
        basis,
      }
      : null,
    changes: changes
      ? {
        fromSesno: countOf(changes.from_sesno),
        toSesno: countOf(changes.to_sesno),
        unitsChanged: countOf(changes.units_changed),
        unitsAdded: countOf(changes.units_added),
        unitsRemoved: countOf(changes.units_removed),
        unattributed: changes.unattributed === true,
      }
      : null,
    precheck: {
      unitsToGenerate,
      // 后端没给这一格时自己按阈值算（阈值 0 = 从不要求确认）
      needsConfirm: typeof response.precheck?.needs_confirm === 'boolean'
        ? response.precheck.needs_confirm
        : thresholdUnits > 0 && unitsToGenerate > thresholdUnits,
      thresholdUnits,
    },
    library: {
      fileLatestSesno: sesnoOf(response.library?.file_latest_sesno),
      modelSesno: sesnoOf(response.library?.model_sesno),
      modelSesnoTime: response.library?.model_sesno_time ?? null,
      inWatchScope: response.library?.in_watch_scope === true,
    },
  };
}

/**
 * 问后端「这个节点的模型状态」。回 `null` = 服务端没有这条路由（旧构建），调用方退回过渡办法；别的失败照常抛。
 */
export type FetchNodeModelFacts = (query: { refno: string; signal?: AbortSignal }) => Promise<NodeModelFacts | null>;

/**
 * 要不要问「水位之后谁改到了这个节点」、从哪个会话之后问起。不用问回 `null`：
 * 库状态没取到、未初始化、没有模型水位、库正在被写，或者库文件根本没有比起点更新的会话。
 * 起点取「本页装的那一版」和「库现在的模型水位」里靠前的那个，一次问全。（过渡办法用）
 */
export function nodeStatusQuerySince(row: DbnumRow | null | undefined, loadedModelSesno: number | null): number | null {
  if (!row) return null;
  const freshness = judgeDbnumFreshness(row);
  if (freshness.kind === 'updating' || !freshness.initialized) return null;
  const model = freshness.model;
  if (model === null || model <= 0) return null;
  const since = loadedModelSesno !== null && loadedModelSesno > 0 ? Math.min(loadedModelSesno, model) : model;
  const fileLatest = freshness.fileLatest ?? model;
  return Math.max(fileLatest, model) > since ? since : null;
}

/** 过渡办法给不出的那几格 */
const NO_FACTS = {
  units: null,
  unitsToGenerate: null,
  generated: null,
  changes: null,
  inWatchScope: null,
} satisfies Partial<NodeModelStatus>;

/**
 * 过渡办法的判定（纯函数；服务端没有节点模型状态接口时用）。`changedSessions`：比较起点之后**影响模型**的会话
 * （按会话号升序；`noop` 的不要传进来）；`null` = 没问到（接口失败），此时不下「最新 / 落后」的结论。
 */
export function judgeNodeModelStatus(input: {
  dbnum: number;
  row: DbnumRow | null | undefined;
  loadedModelSesno: number | null;
  changedSessions: NodeChangedSession[] | null;
  error?: string | null;
  now?: number;
}): NodeModelStatus {
  const { dbnum, row } = input;
  const loadedModelSesno = input.loadedModelSesno !== null && input.loadedModelSesno > 0 ? input.loadedModelSesno : null;
  const base: NodeModelStatus = {
    verdict: 'unknown',
    reason: null,
    dbnum,
    source: 'versions',
    modelSesno: null,
    modelSavedAt: null,
    fileLatestSesno: sesnoOf(row?.file_latest_sesno),
    loadedModelSesno,
    laggingSessions: [],
    reloadableSessions: [],
    librarySessionsAhead: 0,
    ...NO_FACTS,
    checkedAt: input.now ?? Date.now(),
  };
  if (!row) return { ...base, reason: '库状态还没取到' };
  const freshness = judgeDbnumFreshness(row);
  if (freshness.kind === 'updating') return { ...base, verdict: 'updating' };
  if (!freshness.initialized) return { ...base, verdict: 'untracked' };
  const model = freshness.model;
  if (model === null || model <= 0) return { ...base, reason: '这个库还没有模型水位' };
  const fileLatest = freshness.fileLatest ?? model;
  const known: NodeModelStatus = {
    ...base,
    modelSesno: model,
    modelSavedAt: freshness.modelSavedAt,
    fileLatestSesno: fileLatest,
    librarySessionsAhead: Math.max(0, fileLatest - model),
  };
  if (input.changedSessions === null) return { ...known, reason: input.error || '变化查询没有应答' };
  const laggingSessions = input.changedSessions.filter((item) => item.sesno > model);
  const reloadableSessions = loadedModelSesno !== null && loadedModelSesno < model
    ? input.changedSessions.filter((item) => item.sesno > loadedModelSesno && item.sesno <= model)
    : [];
  const verdict: NodeModelVerdict = laggingSessions.length > 0 ? 'lagging' : reloadableSessions.length > 0 ? 'reloadable' : 'latest';
  return { ...known, verdict, laggingSessions, reloadableSessions };
}

/** 后端判不了时给的原因码 → 给人看的话 */
const UNKNOWN_REASON_TEXT: Record<string, string> = {
  watermarks_inconsistent: '这个库的数据水位和模型水位对不上',
  model_watermark_unavailable: '这个库的模型水位读不到',
  changes_unreadable: '生成之后的改动算不出来（会话不在链上或超时）',
};

/**
 * 本页装的那一版比库现在的模型水位旧——要不要再问一次「其间改没改到本节点」。只对靠库的模型水位担保的节点问
 * （按需生成的库没有「库里比本页新」这回事）。回要问的起点；不用问回 `null`。
 */
export function reloadCheckSince(facts: NodeModelFacts, loadedModelSesno: number | null): number | null {
  if (facts.verdict !== 'latest' && facts.verdict !== 'lagging') return null;
  if (loadedModelSesno === null || loadedModelSesno <= 0) return null;
  const model = facts.library.modelSesno;
  if (model === null || model <= 0 || loadedModelSesno >= model) return null;
  if (facts.generatedAt && facts.generatedAt.basis === 'own_generation') return null;
  return loadedModelSesno;
}

/**
 * 接口给的事实 → 行上的状态（纯函数）。`changedSinceLoaded`：本页那一版之后影响模型的会话（`reloadCheckSince` 说要问时
 * 才有）；`null` = 该问而没问到；`undefined` = 不用问。
 */
export function judgeNodeModelFacts(input: {
  facts: NodeModelFacts;
  loadedModelSesno: number | null;
  changedSinceLoaded?: NodeChangedSession[] | null;
  error?: string | null;
  now?: number;
}): NodeModelStatus {
  const { facts } = input;
  const loadedModelSesno = input.loadedModelSesno !== null && input.loadedModelSesno > 0 ? input.loadedModelSesno : null;
  const model = facts.library.modelSesno !== null && facts.library.modelSesno > 0 ? facts.library.modelSesno : null;
  const fileLatest = facts.library.fileLatestSesno;
  // 「库有 N 个新会话」从模型对应到的最早那个会话数起（靠水位担保的就是模型水位）
  const generatedFrom = facts.generatedAt ? facts.generatedAt.sesnoMin : model;
  const base: NodeModelStatus = {
    verdict: 'unknown',
    reason: null,
    dbnum: facts.dbnum,
    source: 'model-status',
    modelSesno: model,
    modelSavedAt: facts.library.modelSesnoTime,
    fileLatestSesno: fileLatest,
    loadedModelSesno,
    laggingSessions: [],
    reloadableSessions: [],
    librarySessionsAhead: fileLatest !== null && generatedFrom !== null && generatedFrom > 0 ? Math.max(0, fileLatest - generatedFrom) : 0,
    units: facts.units,
    unitsToGenerate: facts.precheck.unitsToGenerate,
    generated: facts.generatedAt
      ? {
        sesnoMin: facts.generatedAt.sesnoMin,
        sesnoMax: facts.generatedAt.sesnoMax,
        timeMin: facts.generatedAt.timeMin,
        basis: facts.generatedAt.basis,
      }
      : null,
    changes: facts.changes,
    inWatchScope: facts.library.inWatchScope,
    checkedAt: input.now ?? Date.now(),
  };
  switch (facts.verdict) {
    case 'updating':
      return { ...base, verdict: 'updating' };
    case 'empty':
      return { ...base, verdict: 'empty' };
    case 'not_generated':
      return { ...base, verdict: 'not_generated' };
    case 'partial':
      return { ...base, verdict: 'partial' };
    case 'unknown':
      return {
        ...base,
        reason: UNKNOWN_REASON_TEXT[String(facts.verdictReason ?? '')] ?? (facts.verdictReason ? `后端判不了（${facts.verdictReason}）` : '后端判不了'),
      };
    default:
      break;
  }
  // latest / lagging：再看页面这一层——库里的模型是不是已经比本页装的新、其间改没改到本节点
  const reloadableSessions = model !== null && loadedModelSesno !== null && input.changedSinceLoaded
    ? input.changedSinceLoaded.filter((item) => item.sesno > loadedModelSesno && item.sesno <= model)
    : [];
  if (facts.verdict === 'lagging') return { ...base, verdict: 'lagging', reloadableSessions };
  if (input.changedSinceLoaded === null) {
    return { ...base, reason: input.error || '库里的模型比本页装的新，其间改没改到本节点没有问到' };
  }
  return { ...base, verdict: reloadableSessions.length > 0 ? 'reloadable' : 'latest', reloadableSessions };
}

/**
 * 节点版本表（`node/versions`）的行 → 影响模型的会话：网格变、位置变、新增（`delivery`）、删除（`tombstone`）都算，
 * `noop`（记录改了但不影响几何，比如只登录、只改名字）不算。
 */
export function changedSessionsOfNodeVersions(
  versions: readonly { sesno: number; sessionTime: string | null; impact: string; unitsChanged: number }[],
): NodeChangedSession[] {
  return versions
    .filter((version) => version.impact !== 'noop')
    .map((version) => ({ sesno: version.sesno, time: version.sessionTime, unitsChanged: version.unitsChanged }));
}

/** `resolveNodeModelStatus` 用来问「某个会话之后谁改到了这个节点」的函数：只回影响模型的会话，按会话号升序。 */
export type ListNodeChangedSessions = (query: {
  dbnum: number;
  refno: string;
  /** 只要这个会话**之后**的 */
  sinceSesno: number;
  signal?: AbortSignal;
}) => Promise<NodeChangedSession[]>;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 节点模型状态接口的业务错误码 → 给人看的话（后端的原话里带着库文件的路径，不照搬） */
const FACTS_ERROR_TEXT: Record<string, string> = {
  REFNO_NOT_FOUND: '库文件最新会话上没有这个节点（可能已被删除）',
  SOURCE_NOT_FOUND: '库文件打不开，或水位暂时读不到',
  INVALID_REFNO: '节点编号解不出',
};

function factsErrorText(error: unknown): string {
  const code = typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : '';
  const known = FACTS_ERROR_TEXT[code];
  if (known) return known;
  const text = errorText(error);
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * 事实来源的唯一入口：给一个节点，回它现在的状态。从不抛错——问不到就是 `unknown`，不挡显示。
 *
 * 先问 `fetchFacts`（后端的节点模型状态接口）；库里的模型比本页装的那一版新时，再用 `listChangedSessions`
 * （节点版本表）问一次其间改没改到本节点。`fetchFacts` 没给、或回 `null`（服务端没有那条路由）时走过渡办法：
 * 水位看 `/dbnums` 那一行，需要时用 `listChangedSessions` 问一次。
 */
export async function resolveNodeModelStatus(input: {
  dbnum: number;
  /** `a_b` */
  refno: string;
  row: DbnumRow | null | undefined;
  loadedModelSesno: number | null;
  fetchFacts?: FetchNodeModelFacts;
  listChangedSessions: ListNodeChangedSessions;
  signal?: AbortSignal;
  now?: number;
}): Promise<NodeModelStatus> {
  const { dbnum, refno, row, loadedModelSesno } = input;
  if (input.fetchFacts) {
    let facts: NodeModelFacts | null;
    try {
      facts = await input.fetchFacts({ refno, signal: input.signal });
    } catch (error) {
      // 接口在、但这一次没答上来：不下结论（也不退回过渡办法——库文件或水位读不到时那边一样答不上）。
      // 库状态那一行说库正在被写的，照实说「更新中」。
      const reason = factsErrorText(error);
      const known = judgeNodeModelStatus({ dbnum, row, loadedModelSesno, changedSessions: null, error: reason, now: input.now });
      return known.verdict === 'updating'
        ? { ...known, source: 'model-status' }
        : { ...known, verdict: 'unknown', reason, source: 'model-status' };
    }
    if (facts) {
      const since = reloadCheckSince(facts, loadedModelSesno);
      if (since === null) return judgeNodeModelFacts({ facts, loadedModelSesno, now: input.now });
      try {
        const changedSinceLoaded = await input.listChangedSessions({ dbnum: facts.dbnum, refno, sinceSesno: since, signal: input.signal });
        return judgeNodeModelFacts({ facts, loadedModelSesno, changedSinceLoaded, now: input.now });
      } catch (error) {
        return judgeNodeModelFacts({ facts, loadedModelSesno, changedSinceLoaded: null, error: errorText(error), now: input.now });
      }
    }
  }
  const since = nodeStatusQuerySince(row, loadedModelSesno);
  if (since === null) return judgeNodeModelStatus({ dbnum, row, loadedModelSesno, changedSessions: [], now: input.now });
  try {
    const changedSessions = await input.listChangedSessions({ dbnum, refno, sinceSesno: since, signal: input.signal });
    return judgeNodeModelStatus({ dbnum, row, loadedModelSesno, changedSessions, now: input.now });
  } catch (error) {
    return judgeNodeModelStatus({
      dbnum,
      row,
      loadedModelSesno,
      changedSessions: null,
      error: errorText(error),
      now: input.now,
    });
  }
}

/** 后端给的保存时刻 → `YYYY-MM-DD HH:mm`（浏览器本地时区）；解析不了回 `null`。 */
function formatSavedAt(stamp: string | null): string | null {
  if (!stamp) return null;
  const at = new Date(stamp);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

const SESSIONS_NAMED = 3;

function sessionsText(sessions: NodeChangedSession[]): string {
  const named = sessions.slice(0, SESSIONS_NAMED).map((item) => `${item.sesno}（${item.unitsChanged} 个单元）`).join('、');
  return sessions.length > SESSIONS_NAMED ? `会话 ${named}等 ${sessions.length} 个会话` : `会话 ${named}`;
}

/** 「模型按会话 738 生成（…保存）；库文件最新 748」——按需生成的写明是按需生成的 */
function generatedText(status: NodeModelStatus): string {
  const fileLatest = status.fileLatestSesno !== null ? `；库文件最新 ${status.fileLatestSesno}` : '';
  const generated = status.generated;
  if (generated && generated.basis !== 'library_watermark') {
    const range = generated.sesnoMin === generated.sesnoMax ? `${generated.sesnoMin}` : `${generated.sesnoMin}–${generated.sesnoMax}`;
    const how = generated.basis === 'own_generation'
      ? '模型是后端这次运行期间按需生成的'
      : '模型一部分在库里、一部分是后端这次运行期间按需生成的';
    return `${how}，对应会话 ${range}${fileLatest}`;
  }
  if (status.modelSesno === null) return '';
  const savedAt = formatSavedAt(status.modelSavedAt);
  const model = savedAt ? `模型按会话 ${status.modelSesno} 生成（${savedAt} 保存）` : `模型按会话 ${status.modelSesno} 生成`;
  return `${model}${fileLatest}`;
}

/** 「12 个单元里有 7 个没有模型（其中 2 个上次生成失败）」 */
function missingText(units: NodeModelUnits): string {
  const lacking = units.missing + units.failed;
  const failed = units.failed > 0 ? `（其中 ${units.failed} 个上次生成失败）` : '';
  return `${units.total} 个单元里有 ${lacking} 个没有模型${failed}`;
}

/** 接口给的净变化：「改到 3 个交付单元（新增 1、删除 1）」 */
function changesText(changes: NodeModelChanges): string {
  const parts = [
    changes.unitsAdded > 0 ? `新增 ${changes.unitsAdded}` : '',
    changes.unitsRemoved > 0 ? `删除 ${changes.unitsRemoved}` : '',
  ].filter(Boolean).join('、');
  return `会话 ${changes.fromSesno} 之后到 ${changes.toSesno}，改到 ${changes.unitsChanged} 个交付单元${parts ? `（${parts}）` : ''}`;
}

/**
 * 缺的单元该靠「更新到最新」补，而不是按需生成：这个库有模型水位、在后端的更新范围里、而且库文件比模型水位新。
 * 这种库里没有模型的单元多半是水位之后才建的（或上一窗失败、等下一窗重算的）——让后端跑一次更新，新会话入库、
 * 受影响的单元生成、水位前进，库里才是完整的；对节点按需生成只进后端内存，而且水位落后时后端会把范围里的根整根重算
 * （gen-model 规范 §4.5.3「不要拿 generate 去刷新到最新」）。
 */
export function missingUnitsNeedLibraryUpdate(library: {
  inWatchScope: boolean | null;
  modelSesno: number | null;
  fileLatestSesno: number | null;
}): boolean {
  return library.inWatchScope === true
    && library.modelSesno !== null && library.modelSesno > 0
    && library.fileLatestSesno !== null && library.fileLatestSesno > library.modelSesno;
}

/** 部分生成 / 未生成的节点怎么补 */
function missingRemedy(status: NodeModelStatus): string {
  if (!missingUnitsNeedLibraryUpdate(status)) return '';
  const ahead = (status.fileLatestSesno ?? 0) - (status.modelSesno ?? 0);
  return `库文件比模型水位新 ${ahead} 个会话，没有模型的单元多半是之后才有的：点「更新」让后端把这个库更新到最新`;
}

/** 落后的节点怎么追上：能「更新」的点更新；不在更新范围里的、按需生成的库，只能重新生成 */
function laggingRemedy(status: NodeModelStatus): string {
  if (nodeModelStatusAction(status) === 'update') return '点「更新」让后端把这个库更新到最新';
  if (status.generated?.basis === 'own_generation') return '这个库的模型按需生成：右键「重新生成模型」换成最新的';
  return '这个库不在后端的更新范围里（不参与），更新不了；右键「重新生成模型」可以换成最新的';
}

/** 状态 → 行尾提示里的两句话（结论、说明）。 */
export function describeNodeModelStatus(status: NodeModelStatus): { headline: string; detail: string } {
  const units = status.units;
  switch (status.verdict) {
    case 'latest':
      return {
        headline: status.librarySessionsAhead > 0 ? `最新（库有 ${status.librarySessionsAhead} 个新会话，未涉及本节点）` : '最新',
        detail: [generatedText(status), units && units.total > 0 ? `${units.total} 个单元都已生成` : ''].filter(Boolean).join('；'),
      };
    case 'lagging': {
      const reloadable = status.reloadableSessions.length > 0
        ? `；另有${sessionsText(status.reloadableSessions)}的改动库里已经生成，点「重载」可先换上`
        : '';
      if (status.source === 'model-status') {
        const what = units && units.lagging > 0
          ? `生成之后有 ${units.lagging} 个单元被改到`
          : '生成之后这个节点下有改动（不在某个生成单元名下，或有单元被删）';
        const changes = status.changes ? `${changesText(status.changes)}。` : '';
        return {
          headline: `落后：${what}`,
          detail: `${generatedText(status)}。${changes}${laggingRemedy(status)}${reloadable}`,
        };
      }
      return {
        headline: `落后：${sessionsText(status.laggingSessions)}改到了本节点`,
        detail: `${generatedText(status)}。点「更新到最新」让后端生成新模型${reloadable}`,
      };
    }
    case 'reloadable':
      return {
        headline: `有更新可重载：${sessionsText(status.reloadableSessions)}改到了本节点`,
        detail: `本页装的是会话 ${status.loadedModelSesno} 的模型，库里已到 ${status.modelSesno}。点「重载」换上`,
      };
    case 'updating':
      return { headline: '库正在更新，稍后再看', detail: '' };
    case 'untracked':
      return { headline: '库未初始化：模型按需生成，暂不跟踪新旧', detail: '' };
    case 'partial': {
      const lagging = units && units.lagging > 0 ? `；已生成的里有 ${units.lagging} 个在生成之后被改到` : '';
      return {
        headline: units ? `部分生成：${missingText(units)}` : '部分生成',
        detail: [generatedText(status), `${missingRemedy(status) || '点「生成」补齐（不重算已有的）'}${lagging}`].filter(Boolean).join('。'),
      };
    }
    case 'not_generated': {
      const failed = units && units.failed > 0 ? `（其中 ${units.failed} 个上次生成失败）` : '';
      return {
        headline: units ? `未生成：${units.total} 个单元都没有模型${failed}` : '未生成',
        detail: missingRemedy(status) || '点眼睛或「生成」：生成并显示',
      };
    }
    case 'empty':
      return { headline: '没有要生成的模型（这个节点下没有生成单元）', detail: '' };
    default:
      return { headline: `新旧未知（${status.reason || '没有可比的水位'}）`, detail: generatedText(status) };
  }
}

/**
 * 行上给的动作：
 * - 落后 → 更新到最新。接口说这个库不在后端的更新范围里、或模型是按需生成的（没有库水位可推进）时不给——
 *   更新会被后端拒绝，提示里写明只能重新生成；
 * - 有更新可重载 → 重载；
 * - 部分生成 / 未生成、而且确有单元要生成 → 库文件比模型水位新、库在更新范围里时是「更新」（见
 *   `missingUnitsNeedLibraryUpdate`），否则是「生成」（补齐，不带 force）；
 * - 其余没有。
 */
export function nodeModelStatusAction(status: NodeModelStatus): 'update' | 'reload' | 'generate' | null {
  if (status.verdict === 'lagging') {
    if (status.source !== 'model-status') return 'update';
    return status.inWatchScope === true && status.generated?.basis !== 'own_generation' ? 'update' : null;
  }
  if (status.verdict === 'reloadable') return 'reload';
  if (status.verdict === 'partial' || status.verdict === 'not_generated') {
    if (status.unitsToGenerate === null || status.unitsToGenerate <= 0) return null;
    return missingUnitsNeedLibraryUpdate(status) ? 'update' : 'generate';
  }
  return null;
}

/**
 * 行尾图标怎么画：最新、落后、有更新可重载沿用原来的三种；部分生成 = 半圆；未生成 = 空心；没有生成单元 = 一道短横。
 * 其余回 `null`（沿用库一级的圆点）。
 */
export type NodeModelStatusIconKind = 'current' | 'stale' | 'reloadable' | 'partial' | 'empty' | 'nothing';

export function nodeModelStatusIconKind(status: NodeModelStatus): NodeModelStatusIconKind | null {
  switch (status.verdict) {
    case 'latest':
      return 'current';
    case 'lagging':
      return 'stale';
    case 'reloadable':
      return 'reloadable';
    case 'partial':
      return 'partial';
    case 'not_generated':
      return 'empty';
    case 'empty':
      return 'nothing';
    default:
      return null;
  }
}
