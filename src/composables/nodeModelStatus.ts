/**
 * 节点模型状态（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C2；ADR 0072 第 4 条）：
 * 一个已经装进场景的 SITE / ZONE（或更下层的节点），它的模型新不新。
 *
 * 口径（2026-11-10 用户定）：库一级按库文件最新会话；**节点一级只有模型生成之后真有会话改到它下面的构件**
 * （网格变、位置变、新增、删除）才算落后，E3D 登录产生的空会话不算。所以「库有 10 个新会话」和「这个 SITE 落后」是两回事。
 *
 * 页面还多一层：本页装的是哪一版。库里的模型已经比本页装的新、而且其间真改到了这个节点，是「有更新可重载」。
 *
 * **事实来源只有 `resolveNodeModelStatus` 一个入口。** 现在它拿 `/dbnums` 那一行的水位加 `GET node/versions?since_sesno=`
 * （逐会话的影响表）现算；后端的 `GET node/model-status`（gen-model 规范 §4.5.3）部署之后换成它，只改这一个函数——
 * 判定值已经按那边的七个值留了位置（`partial` / `not_generated` / `empty` 现在给不出）。
 */
import type { DbnumRow } from '@/api/genModelV1Api';

import { judgeDbnumFreshness } from '@/composables/dbnumFreshness';

/**
 * - `latest`：生成之后没有会话改到这个节点；
 * - `lagging`：库的模型水位之后有会话改到了它——要「更新到最新」；
 * - `reloadable`：库里的模型比本页装的新，其间有会话改到了它——点「重载」就能换上；
 * - `updating`：库正在被写；
 * - `untracked`：未初始化的库，模型按需生成，没有水位可比（等 `node/model-status`）；
 * - `unknown`：判不了（库状态没取到、没有模型水位、接口失败）；
 * - `partial` / `not_generated` / `empty`：留给 `node/model-status`（部分生成 / 未生成 / 子树里没有生成单元）。
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

export type NodeModelStatus = {
  verdict: NodeModelVerdict;
  /** `unknown` 的原因（给人看） */
  reason: string | null;
  dbnum: number;
  /** 库里的模型按哪个会话生成（模型水位） */
  modelSesno: number | null;
  /** 模型水位那个会话的保存时刻 */
  modelSavedAt: string | null;
  fileLatestSesno: number | null;
  /** 本页装的时候库的模型水位；当时没记下为 `null` */
  loadedModelSesno: number | null;
  /** 库的模型水位之后改到本节点的会话：要「更新到最新」才追得上 */
  laggingSessions: NodeChangedSession[];
  /** 本页那一版之后、库的模型水位之前（含）改到本节点的会话：「重载」就能换上 */
  reloadableSessions: NodeChangedSession[];
  /** 库文件最新会话比模型水位多出几个会话（不管涉没涉及本节点） */
  librarySessionsAhead: number;
  checkedAt: number;
};

function sesnoOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 要不要问「水位之后谁改到了这个节点」、从哪个会话之后问起。不用问回 `null`：
 * 库状态没取到、未初始化、没有模型水位、库正在被写，或者库文件根本没有比起点更新的会话。
 * 起点取「本页装的那一版」和「库现在的模型水位」里靠前的那个，一次问全。
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

/**
 * 判定（纯函数）。`changedSessions`：比较起点之后**影响模型**的会话（按会话号升序；`noop` 的不要传进来）；
 * `null` = 没问到（接口失败），此时不下「最新 / 落后」的结论。
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
    modelSesno: null,
    modelSavedAt: null,
    fileLatestSesno: sesnoOf(row?.file_latest_sesno),
    loadedModelSesno,
    laggingSessions: [],
    reloadableSessions: [],
    librarySessionsAhead: 0,
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

/**
 * 事实来源的唯一入口：给一个已装的节点，回它现在的状态。从不抛错——问不到就是 `unknown`，不挡显示。
 *
 * 现在的做法：水位看 `/dbnums` 那一行；需要时用 `listChangedSessions`（`node/versions?since_sesno=`）问一次。
 * 换成 `node/model-status` 时只改这里：那边一次回 `verdict` / `generated_at` / `changes`，未初始化的库也答得出。
 */
export async function resolveNodeModelStatus(input: {
  dbnum: number;
  /** `a_b` */
  refno: string;
  row: DbnumRow | null | undefined;
  loadedModelSesno: number | null;
  listChangedSessions: ListNodeChangedSessions;
  signal?: AbortSignal;
  now?: number;
}): Promise<NodeModelStatus> {
  const { dbnum, refno, row, loadedModelSesno } = input;
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
      error: error instanceof Error ? error.message : String(error),
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

function generatedText(status: NodeModelStatus): string {
  if (status.modelSesno === null) return '';
  const savedAt = formatSavedAt(status.modelSavedAt);
  const model = savedAt ? `模型按会话 ${status.modelSesno} 生成（${savedAt} 保存）` : `模型按会话 ${status.modelSesno} 生成`;
  return status.fileLatestSesno !== null ? `${model}；库文件最新 ${status.fileLatestSesno}` : model;
}

/** 状态 → 行尾提示里的两句话（结论、说明）。 */
export function describeNodeModelStatus(status: NodeModelStatus): { headline: string; detail: string } {
  switch (status.verdict) {
    case 'latest':
      return {
        headline: status.librarySessionsAhead > 0 ? `最新（库有 ${status.librarySessionsAhead} 个新会话，未涉及本节点）` : '最新',
        detail: generatedText(status),
      };
    case 'lagging': {
      const reloadable = status.reloadableSessions.length > 0
        ? `；另有${sessionsText(status.reloadableSessions)}的改动库里已经生成，点「重载」可先换上`
        : '';
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
    case 'partial':
      return { headline: '部分生成', detail: generatedText(status) };
    case 'not_generated':
      return { headline: '未生成', detail: '' };
    case 'empty':
      return { headline: '这个节点下没有要生成的模型', detail: '' };
    default:
      return { headline: `新旧未知（${status.reason || '没有可比的水位'}）`, detail: generatedText(status) };
  }
}

/** 行上给的动作：落后 → 更新到最新；有更新可重载 → 重载；其余没有。 */
export function nodeModelStatusAction(status: NodeModelStatus): 'update' | 'reload' | null {
  if (status.verdict === 'lagging') return 'update';
  if (status.verdict === 'reloadable') return 'reload';
  return null;
}

/** 行尾图标怎么画：说得出结论的三种各有画法，其余回 `null`（沿用库一级的圆点）。 */
export function nodeModelStatusIconKind(status: NodeModelStatus): 'current' | 'stale' | 'reloadable' | null {
  if (status.verdict === 'latest') return 'current';
  if (status.verdict === 'lagging') return 'stale';
  if (status.verdict === 'reloadable') return 'reloadable';
  return null;
}
