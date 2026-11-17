/**
 * 每库「模型生成状态」的进程内单例 store：模型树行尾的小圆点吃它（plan 收口「按库看生成状态」）。
 *
 * 判据只来自 `/dbnums` 那一行（`useGenModelV1Health` 已在轮询，首屏与 ref0→dbnum 共用同一次请求，零额外成本），
 * 判定与说法都交给 `judgeDbnumFreshness` / `describeDbnumFreshness`（`./dbnumFreshness`）——「模型生成」面板的状态徽标
 * 用的是同一对函数，两处对同一个库说法一致（方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` C1）。
 * 库一级按**库文件最新会话**判：模型与已入库数据一致、但库文件还有新会话的库不再是「最新」。
 * 别处的数据批次落地（任务流的 `task_finished`，断线重连后补进来的也算）时另外重拉一次 `/dbnums`，不等下一拍轮询。
 *
 * 2026-11-10 起**不再调用 `GET /dbnums/{n}/model/roots`**（同一份方案的 A1）：
 * 那条接口要冻结源文件并枚举整库生成根（实测 7997 一次 21–24 s、7999 15–25 s、7333 40 s），而它的 `ready`
 * 只是后端本进程投影的判据——后端重启之后恒为假——既贵又答不了「这个库有没有模型」。
 * 未初始化库里「哪些节点按需生成过」是节点级的事，库级圆点不替它作答；本页面生成过或查到过记录的只在提示里补一句。
 */
import { reactive } from 'vue';

import type { DbnumRow } from '@/api/genModelV1Api';

import { describeDbnumFreshness, judgeDbnumFreshness, type DbnumFreshnessKind } from '@/composables/dbnumFreshness';
import { useGenModelV1Health } from '@/composables/useGenModelV1Health';
import { subscribeGenModelV1FinishedBatches } from '@/composables/useGenModelV1UpdateNotice';
import { getGenModelV1ServiceSnapshot } from '@/model-source/genModelV1/serviceLifecycle';

/**
 * 单库状态（图标怎么画）：`current` 绿（三枚水位对齐）；`file_ahead` 蓝（模型与已入库数据一致，库文件还有新会话）；
 * `stale` 琥珀（模型落后于已入库数据）；`updating` 转圈（库正在被写）；`empty` 空心（未初始化，按需生成）；
 * `unknown` 虚线灰（库状态还没取到 / 判不了）。`probing` 是旧的根级探测在飞时的状态，现在不再产生，
 * 留着只为不动既有调用方。
 */
export type DbnumModelStatusKind = 'current' | 'file_ahead' | 'stale' | 'updating' | 'empty' | 'unknown' | 'probing';

const STATUS_KIND_OF: Record<DbnumFreshnessKind, DbnumModelStatusKind> = {
  latest: 'current',
  file_ahead: 'file_ahead',
  model_behind: 'stale',
  updating: 'updating',
  uninitialized: 'empty',
  awaiting: 'empty',
  blocked: 'unknown',
  excluded: 'unknown',
  unknown: 'unknown',
};

export type DbnumModelStatusView = {
  kind: DbnumModelStatusKind;
  /** 行尾 title：库号 + 状态 */
  title: string;
};

/** 本页面在这个库里见过模型的证据：`generated` = 刚生成成功，`records` = 查到过记录。只影响提示文字。 */
type SessionEvidence = { source: 'generated' | 'records'; at: number; generation: number };

/** 「后台还在生成 / 库任务刚收口」之后补拉 `/dbnums` 的节奏与次数上限 */
export const DBNUM_STATUS_PENDING_RETRY_DELAYS_MS = [10_000, 30_000, 60_000];

const sessionEvidence = reactive(new Map<number, SessionEvidence>());
const pendingRetries = new Map<number, { count: number; timer: ReturnType<typeof setTimeout> }>();
/** 别处的数据批次落地之后隔这么久重拉一次 `/dbnums`；这段时间里又落了批次就从头再等，连着落几批只拉一次 */
export const DBNUM_STATUS_BATCH_REFRESH_DELAY_MS = 2_000;
let unsubscribeBatches: (() => void) | null = null;
let batchRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function rowOf(dbnum: number): DbnumRow | null {
  const { state } = useGenModelV1Health();
  return (state.verdict.rows?.[dbnum] as DbnumRow | undefined) ?? null;
}

/** 证据记的是哪个服务代次：换过代（后端重启 / 换库）的不作数——未初始化库的按需生成结果随后端重启就没了。 */
function liveEvidence(dbnum: number): SessionEvidence | null {
  const evidence = sessionEvidence.get(dbnum);
  if (!evidence) return null;
  if (evidence.generation !== getGenModelV1ServiceSnapshot().generation) return null;
  return evidence;
}

function refreshRows(): void {
  // `/dbnums` 不带身份参数是轻量形态（服务端毫秒级）；在飞的共用，不会堆请求
  void useGenModelV1Health().refreshVerdict();
}

export function dbnumModelStatusView(dbnum: number): DbnumModelStatusView {
  const prefix = `DB ${dbnum} · `;
  const row = rowOf(dbnum);
  const evidence = liveEvidence(dbnum);
  const seen = evidence
    ? evidence.source === 'generated' ? '；本页面已按需生成过模型' : '；本页面已查到模型记录'
    : '';
  if (!row) {
    const { state } = useGenModelV1Health();
    const why = state.verdict.error ? `（${state.verdict.error}）` : '';
    return { kind: 'unknown', title: `${prefix}库状态还没取到${why}${seen}` };
  }
  const freshness = judgeDbnumFreshness(row);
  const text = describeDbnumFreshness(freshness);
  const kind = STATUS_KIND_OF[freshness.kind];
  // 「本页面见过模型」只对说不出模型水位的库有信息量（未初始化 / 判不了）；水位对得上的库不用补这一句
  const headline = kind === 'empty' || kind === 'unknown' ? `${text.headline}${seen}` : text.headline;
  return { kind, title: [`${prefix}${headline}`, text.detail, text.watermarks].filter(Boolean).join('\n') };
}

/** 批次落地后库的水位变了：重拉 `/dbnums`。一次请求带回全部库，所以不分落在哪个库上。 */
function ensureBatchSubscription(): void {
  if (unsubscribeBatches) return;
  unsubscribeBatches = subscribeGenModelV1FinishedBatches(() => {
    if (batchRefreshTimer) clearTimeout(batchRefreshTimer);
    batchRefreshTimer = setTimeout(() => {
      batchRefreshTimer = null;
      refreshRows();
    }, DBNUM_STATUS_BATCH_REFRESH_DELAY_MS);
  });
}

/**
 * 行尾圆点挂载。状态全部来自已在轮询的 `/dbnums`，这里不需要为「在看」的库另起探测；
 * 第一个圆点挂上时订阅「批次落地」，登记 / 释放本身什么都不记（保留这一对只为不动调用方 `ModelTreeRow`）。
 */
export function acquireDbnumStatus(_dbnum: number): () => void {
  ensureBatchSubscription();
  return () => {};
}

function clearPendingRetry(dbnum: number): void {
  const retry = pendingRetries.get(dbnum);
  if (!retry) return;
  clearTimeout(retry.timer);
  pendingRetries.delete(dbnum);
}

/** 丢掉本页面的证据并重拉一次 `/dbnums`（库任务收口、水位变了时用）。不传库号 = 全部。 */
export function invalidateDbnumModelStatus(dbnum?: number): void {
  const targets = typeof dbnum === 'number' ? [dbnum] : [...new Set([...sessionEvidence.keys(), ...pendingRetries.keys()])];
  for (const target of targets) {
    sessionEvidence.delete(target);
    clearPendingRetry(target);
  }
  refreshRows();
}

/** 生成在服务端后台继续（pending）：排几次延迟重拉 `/dbnums`，让圆点在水位变化后自己跟上。 */
export function scheduleDbnumModelReprobe(dbnum: number): void {
  const existing = pendingRetries.get(dbnum);
  if (existing) clearTimeout(existing.timer);
  const count = existing?.count ?? 0;
  if (count >= DBNUM_STATUS_PENDING_RETRY_DELAYS_MS.length) return;
  const timer = setTimeout(() => {
    refreshRows();
    scheduleDbnumModelReprobe(dbnum);
  }, DBNUM_STATUS_PENDING_RETRY_DELAYS_MS[count] ?? 60_000);
  pendingRetries.set(dbnum, { count: count + 1, timer });
}

/** 人点行尾圆点：立刻重拉 `/dbnums`。 */
export function refreshDbnumModelStatus(_dbnum: number): void {
  refreshRows();
}

function noteEvidence(dbnum: number, source: SessionEvidence['source']): void {
  sessionEvidence.set(dbnum, { source, at: Date.now(), generation: getGenModelV1ServiceSnapshot().generation });
}

/** 本页面刚在这个库里生成成功（回执 / 记录已落账）。 */
export function noteDbnumModelGenerated(dbnum: number): void {
  noteEvidence(dbnum, 'generated');
  clearPendingRetry(dbnum);
}

/** 本页面在这个库里查到了模型记录（`records` 证据）；已经记过「刚生成」的不降级。 */
export function reconcileDbnumModelStatus(dbnum: number): void {
  if (liveEvidence(dbnum)) return;
  noteEvidence(dbnum, 'records');
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
      sessionEvidence.clear();
      for (const retry of pendingRetries.values()) clearTimeout(retry.timer);
      pendingRetries.clear();
      unsubscribeBatches?.();
      unsubscribeBatches = null;
      if (batchRefreshTimer) clearTimeout(batchRefreshTimer);
      batchRefreshTimer = null;
    },
  };
}
