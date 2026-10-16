/**
 * 每库「模型生成状态」的进程内单例 store：模型树行尾的小圆点吃它（plan 收口「按库看生成状态」）。
 *
 * 判据两层，取较新的一次观察：
 * - `/dbnums` 的 `model_verdict`（`useGenModelV1Health` 已在轮询，零成本）：`in_sync` → 已生成且与最新一致；
 *   `lagging` → 已生成但滞后；`not_judged` / 缺行不表态（读透形态恒为 `not_judged`），落到根级探测。
 * - `GET /dbnums/{n}/model/roots`：`ready` 的判据本来就要求回执按冻结时刻的当前源 sesno 生成——
 *   `ready_total > 0` = 「存在且最新」，`ready_total === 0` = 没有现成最新模型（未生成或已全部过期）。
 *
 * 成本约束：根级探测要冻结源文件并枚举整库生成根（大库秒级），所以——
 * - 只探界面正在展示的库（`acquireDbnumStatus` 引用计数）；
 * - 并发封顶 `PROBE_CONCURRENCY`，其余排队；
 * - 结论按 `PROBE_TTL_MS` 缓存；verdict 已表态（in_sync/lagging）时不探，省掉这次扫描；
 * - `invalidateDbnumModelStatus`（生成完成 / 查到记录 / 服务换代）让在看的库立刻重探；
 * - `scheduleDbnumModelReprobe` 给「后台还在生成」的库排延迟补探，让圆点自己变绿。
 */
import { reactive } from 'vue';

import {
  genModelV1DbnumModelRoots,
  isGenModelV1ApiError,
  type DbnumModelRootsResponse,
} from '@/api/genModelV1Api';
import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { getGenModelV1ServiceSnapshot } from '@/model-source/genModelV1/serviceLifecycle';

/** 单库状态：`current` 绿（存在且最新）；`stale` 琥珀（已生成但滞后，只有 verdict 能分辨）；`empty` 空心（无最新模型）；`unknown` 虚线灰（未探/探失败）；`probing` 转圈。 */
export type DbnumModelStatusKind = 'current' | 'stale' | 'empty' | 'unknown' | 'probing';

export type DbnumModelStatusView = {
  kind: DbnumModelStatusKind;
  /** 行尾 title：库号 + 状态 + 就绪根数 / 错误 */
  title: string;
};

type ProbeEntry = {
  kind: 'current' | 'empty';
  readyTotal: number;
  rootTotal: number;
  /** `generated` = 本会话刚生成完（未复探的乐观结论），`roots` = model/roots 实探 */
  source: 'roots' | 'generated';
  checkedAt: number;
  generation: number;
};

type ProbeError = { message: string; checkedAt: number; generation: number };

/** 探测结论保鲜期：界面常开时一分钟重探一次在看的库 */
export const DBNUM_STATUS_PROBE_TTL_MS = 60_000;
/** 在看的库多久扫一遍要不要重探 */
export const DBNUM_STATUS_TICK_MS = 15_000;
/** 根枚举是重活，探测并发封顶 */
export const DBNUM_STATUS_PROBE_CONCURRENCY = 3;
/** 「后台生成中」的补探节奏与次数上限 */
export const DBNUM_STATUS_PENDING_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];
/** acquire 释放后仍认最近一次「想看」的宽限期（滚动闪挂不立刻丢探测结论的时效） */
const WANTED_GRACE_MS = 5 * 60_000;

const probeEntries = reactive(new Map<number, ProbeEntry>());
const probeErrors = reactive(new Map<number, ProbeError>());
const inflightDbnums = reactive(new Set<number>());
/** 行尾圆点引用计数：大于 0 的库才配后台重探 */
const wantedCounts = new Map<number, number>();
const wantedAt = new Map<number, number>();
const probeQueue: number[] = [];
const queuedDbnums = new Set<number>();
let runningProbes = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;
const pendingRetries = new Map<number, { count: number; timer: ReturnType<typeof setTimeout> }>();

function now(): number {
  return Date.now();
}

function isWanted(dbnum: number): boolean {
  const count = wantedCounts.get(dbnum) ?? 0;
  if (count > 0) return true;
  const at = wantedAt.get(dbnum);
  return at !== undefined && now() - at < WANTED_GRACE_MS;
}

/** 探测记的是哪个服务代次：换过代（重启/换库）的旧结论一律不作数。 */
function liveProbeEntry(dbnum: number): ProbeEntry | null {
  const entry = probeEntries.get(dbnum);
  if (!entry) return null;
  if (entry.generation !== getGenModelV1ServiceSnapshot().generation) return null;
  return entry;
}

function judgedVerdict(dbnum: number): 'in_sync' | 'lagging' | null {
  const { state } = useGenModelV1Health();
  const verdict = state.verdict.byDbnum[dbnum];
  return verdict === 'in_sync' || verdict === 'lagging' ? verdict : null;
}

function verdictCheckedAt(): number {
  const { state } = useGenModelV1Health();
  return state.verdict.lastCheckedAt ?? 0;
}

/** verdict 已表态（in_sync/lagging）时根级探测就省了——它已回答「最新/滞后」且是轮询来的免费数据。 */
function resolvedKind(dbnum: number): DbnumModelStatusKind {
  const probe = liveProbeEntry(dbnum);
  const verdict = judgedVerdict(dbnum);
  if (verdict && (!probe || verdictCheckedAt() >= probe.checkedAt)) {
    return verdict === 'in_sync' ? 'current' : 'stale';
  }
  if (probe) return probe.kind;
  if (inflightDbnums.has(dbnum)) return 'probing';
  return 'unknown';
}

export function dbnumModelStatusView(dbnum: number): DbnumModelStatusView {
  const kind = resolvedKind(dbnum);
  const probe = liveProbeEntry(dbnum);
  const error = probeErrors.get(dbnum);
  const counts = probe ? `（就绪根 ${probe.readyTotal}/${probe.rootTotal}）` : '';
  const prefix = `DB ${dbnum} · `;
  switch (kind) {
    case 'current':
      return {
        kind,
        title: prefix + (probe?.source === 'generated'
          ? '模型刚生成'
          : `模型已生成且为最新${counts}`),
      };
    case 'stale':
      return { kind, title: `${prefix}模型已生成但滞后于最新数据${counts}` };
    case 'empty':
      return { kind, title: `${prefix}尚无已生成的最新模型${counts}` };
    case 'probing':
      return { kind, title: `${prefix}正在检查模型生成状态…` };
    default:
      return {
        kind: 'unknown',
        title: `${prefix}模型生成状态未知${error?.message ? `（${error.message}）` : ''}`,
      };
  }
}

function drainProbeQueue(): void {
  while (runningProbes < DBNUM_STATUS_PROBE_CONCURRENCY && probeQueue.length > 0) {
    const dbnum = probeQueue.shift()!;
    queuedDbnums.delete(dbnum);
    void runProbe(dbnum);
  }
}

async function runProbe(dbnum: number): Promise<void> {
  if (inflightDbnums.has(dbnum)) return;
  inflightDbnums.add(dbnum);
  runningProbes += 1;
  const generation = getGenModelV1ServiceSnapshot().generation;
  try {
    const view: DbnumModelRootsResponse = await genModelV1DbnumModelRoots(dbnum, { timeoutMs: 60_000 });
    if (getGenModelV1ServiceSnapshot().generation !== generation) return;
    const roots = view.roots ?? [];
    const readyTotal = typeof view.ready_total === 'number'
      ? view.ready_total
      : roots.filter((root) => root.ready === true).length;
    const rootTotal = typeof view.total === 'number' ? view.total : roots.length;
    probeEntries.set(dbnum, {
      kind: readyTotal > 0 ? 'current' : 'empty',
      readyTotal,
      rootTotal,
      source: 'roots',
      checkedAt: now(),
      generation,
    });
    probeErrors.delete(dbnum);
  } catch (error) {
    if (getGenModelV1ServiceSnapshot().generation !== generation) return;
    probeErrors.set(dbnum, {
      message: isGenModelV1ApiError(error)
        ? `${error.code}${error.status ? `(${error.status})` : ''}: ${error.message}`
        : error instanceof Error ? error.message : String(error),
      checkedAt: now(),
      generation,
    });
  } finally {
    inflightDbnums.delete(dbnum);
    runningProbes -= 1;
    drainProbeQueue();
  }
}

/** force=true 跳过 TTL/verdict 短路（人点圆点重查、失效后补探）。 */
function requestProbe(dbnum: number, options: { force?: boolean } = {}): void {
  if (inflightDbnums.has(dbnum) || queuedDbnums.has(dbnum)) return;
  if (!options.force) {
    if (judgedVerdict(dbnum) !== null) return;
    const probe = liveProbeEntry(dbnum);
    if (probe && now() - probe.checkedAt < DBNUM_STATUS_PROBE_TTL_MS) return;
    const error = probeErrors.get(dbnum);
    // 失败结论短命一点也要有个度：30 s 内的失败不自动重打，靠人点圆点
    if (error && error.generation === getGenModelV1ServiceSnapshot().generation && now() - error.checkedAt < 30_000) return;
  }
  queuedDbnums.add(dbnum);
  probeQueue.push(dbnum);
  drainProbeQueue();
}

function ensureTicker(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    for (const dbnum of wantedCounts.keys()) {
      if ((wantedCounts.get(dbnum) ?? 0) > 0) requestProbe(dbnum);
    }
  }, DBNUM_STATUS_TICK_MS);
}

function stopTickerIfIdle(): void {
  if (tickTimer && [...wantedCounts.values()].every((count) => count <= 0)) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** 行尾圆点挂载：登记「这个库正在被看」并按需起探。返回 release（卸载时调用）。 */
export function acquireDbnumStatus(dbnum: number): () => void {
  wantedCounts.set(dbnum, (wantedCounts.get(dbnum) ?? 0) + 1);
  wantedAt.set(dbnum, now());
  ensureTicker();
  requestProbe(dbnum);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    wantedCounts.set(dbnum, Math.max(0, (wantedCounts.get(dbnum) ?? 0) - 1));
    wantedAt.set(dbnum, now());
    stopTickerIfIdle();
  };
}

/** 丢弃探测结论；这个库还在界面上就补一发探测对齐（生成完成 / 查到记录推翻旧结论时用）。 */
export function invalidateDbnumModelStatus(dbnum?: number): void {
  const drop = (target: number) => {
    probeEntries.delete(target);
    probeErrors.delete(target);
    const retry = pendingRetries.get(target);
    if (retry) {
      clearTimeout(retry.timer);
      pendingRetries.delete(target);
    }
    if (isWanted(target)) requestProbe(target, { force: true });
  };
  if (typeof dbnum === 'number') drop(dbnum);
  else [...probeEntries.keys(), ...probeErrors.keys()].forEach(drop);
}

/** 生成在服务端后台继续（pending）：排几次延迟补探，让圆点在生成落账后自己变绿。 */
export function scheduleDbnumModelReprobe(dbnum: number): void {
  const existing = pendingRetries.get(dbnum);
  if (existing) clearTimeout(existing.timer);
  const count = existing?.count ?? 0;
  if (count >= DBNUM_STATUS_PENDING_RETRY_DELAYS_MS.length) return;
  const timer = setTimeout(() => {
    pendingRetries.delete(dbnum);
    if (!isWanted(dbnum)) return;
    // 已经绿了（上一次补探刚写回 current）就不再发；还没绿就丢结论重探，并再排一拍直到次数用完
    if (liveProbeEntry(dbnum)?.kind === 'current') return;
    invalidateDbnumModelStatus(dbnum);
    scheduleDbnumModelReprobe(dbnum);
  }, DBNUM_STATUS_PENDING_RETRY_DELAYS_MS[count] ?? 60_000);
  pendingRetries.set(dbnum, { count: count + 1, timer });
}

/** 人点行尾圆点：立刻重探（无视 TTL 与 verdict 短路——用户就是想看真实模型面）。 */
export function refreshDbnumModelStatus(dbnum: number): void {
  wantedAt.set(dbnum, now());
  requestProbe(dbnum, { force: true });
}

/** 本会话刚生成成功（回执/记录已落账）：先乐观记绿，探测底子让它照样走 TTL / 失效重探对齐真实值。 */
export function noteDbnumModelGenerated(dbnum: number): void {
  probeEntries.set(dbnum, {
    kind: 'current',
    readyTotal: 0,
    rootTotal: 0,
    source: 'generated',
    checkedAt: now(),
    generation: getGenModelV1ServiceSnapshot().generation,
  });
  probeErrors.delete(dbnum);
  const retry = pendingRetries.get(dbnum);
  if (retry) {
    clearTimeout(retry.timer);
    pendingRetries.delete(dbnum);
  }
}

/**
 * 本地事实与缓存结论打架时对齐（比如 `records` 查到了记录但圆点还显示「无模型」——手动 / 旁路生成过）。
 * 现状已是 current / 探测在飞就不动；否则丢结论，若在界面上还看着就补探。
 */
export function reconcileDbnumModelStatus(dbnum: number): void {
  const kind = resolvedKind(dbnum);
  if (kind === 'current' || kind === 'probing') return;
  invalidateDbnumModelStatus(dbnum);
}

export function useGenModelV1DbnumStatus() {
  return {
    view: dbnumModelStatusView,
    acquire: acquireDbnumStatus,
    invalidate: invalidateDbnumModelStatus,
    refresh: refreshDbnumModelStatus,
    scheduleReprobe: scheduleDbnumModelReprobe,
    noteGenerated: noteDbnumModelGenerated,
    reconcile: reconcileDbnumModelStatus,
    /** 测试用：清全部状态并停表。 */
    __reset(): void {
      probeEntries.clear();
      probeErrors.clear();
      inflightDbnums.clear();
      wantedCounts.clear();
      wantedAt.clear();
      probeQueue.length = 0;
      queuedDbnums.clear();
      for (const retry of pendingRetries.values()) clearTimeout(retry.timer);
      pendingRetries.clear();
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      runningProbes = 0;
    },
  };
}
