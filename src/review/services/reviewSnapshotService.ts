/**
 * ReviewSnapshot 服务层。
 *
 * 职责：
 *   - 在 M2 SHADOW 阶段统一编排 "build snapshot → 转回旧 payload → 与既有 payload 对比"
 *     的流程，返回结构化结果给 restore 入口。
 *   - 当 `REVIEW_B_SNAPSHOT_LAYER_SHADOW` 关闭时，所有 helper 都直接 no-op，
 *     避免任何运行时开销。
 *   - 不直接接管 viewer：M2 阶段 restore 依然走旧路径，service 只产出诊断结果。
 *
 * CUTOVER 阶段（M2 收尾）将引入 `restoreFromSnapshot`，由 viewer 直接消费 snapshot。
 */

import {
  buildSnapshotFromTaskRecords,
  type BuildSnapshotFromTaskRecordsOptions,
} from '../adapters/reviewRecordAdapter';
import { buildReplayPayloadFromSnapshot } from '../adapters/toolStoreAdapter';
import {
  buildSnapshotFromWorkflowSync,
  type BuildSnapshotFromWorkflowSyncOptions,
} from '../adapters/workflowSyncAdapter';
import {
  type ReviewSnapshot,
  type SnapshotSource,
} from '../domain/reviewSnapshot';
import { isReviewFlagEnabled } from '../flags';

import type { WorkflowSyncData } from '@/api/reviewApi';
import type { ConfirmedRecord } from '@/composables/useReviewStore';
import type { WorkflowNode } from '@/types/auth';

const DIFF_PREVIEW_RADIUS = 80;
const DIFF_PREVIEW_MAX = 240;

export type SnapshotShadowResult = {
  source: SnapshotSource;
  /** 适配链路输出与既有 payload 是否字节相同。 */
  match: boolean;
  legacyByteLength: number;
  shadowByteLength: number;
  /** 仅在 mismatch 时填充：定位首个不一致字符的小段对比串。 */
  diffPreview?: {
    index: number;
    legacy: string;
    shadow: string;
  };
  snapshot: ReviewSnapshot;
}

export type SnapshotShadowReporter = (result: SnapshotShadowResult) => void;

const defaultReporter: SnapshotShadowReporter = (result) => {
  if (typeof console === 'undefined') return;
  if (result.match) return;
  console.warn(
    '[review/M2 SHADOW] snapshot payload mismatch',
    {
      source: result.source,
      legacyByteLength: result.legacyByteLength,
      shadowByteLength: result.shadowByteLength,
      diffPreview: result.diffPreview,
    },
  );
};

export function isSnapshotShadowEnabled(): boolean {
  return isReviewFlagEnabled('REVIEW_B_SNAPSHOT_LAYER_SHADOW');
}

export type RunTaskRecordsShadowOptions = {
  legacyPayload: string;
  records: readonly ConfirmedRecord[];
  build?: BuildSnapshotFromTaskRecordsOptions;
  reporter?: SnapshotShadowReporter;
  /** 强制运行（忽略 flag），主要给单测使用。 */
  force?: boolean;
}

export function runTaskRecordsShadow(
  options: RunTaskRecordsShadowOptions,
): SnapshotShadowResult | null {
  if (!options.force && !isSnapshotShadowEnabled()) return null;
  try {
    const snapshot = buildSnapshotFromTaskRecords(options.records, options.build);
    return compareAndReport('task_records', options.legacyPayload, snapshot, options.reporter);
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[review/M2 SHADOW] task_records build threw, fallback to legacy', err);
    }
    return null;
  }
}

export type RunWorkflowSyncShadowOptions = {
  legacyPayload: string;
  data: WorkflowSyncData | undefined | null;
  build?: BuildSnapshotFromWorkflowSyncOptions;
  reporter?: SnapshotShadowReporter;
  force?: boolean;
}

export function runWorkflowSyncShadow(
  options: RunWorkflowSyncShadowOptions,
): SnapshotShadowResult | null {
  if (!options.force && !isSnapshotShadowEnabled()) return null;
  try {
    const snapshot = buildSnapshotFromWorkflowSync(options.data, options.build);
    return compareAndReport('workflow_sync', options.legacyPayload, snapshot, options.reporter);
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[review/M2 SHADOW] workflow_sync build threw, fallback to legacy', err);
    }
    return null;
  }
}

function compareAndReport(
  source: SnapshotSource,
  legacyPayload: string,
  snapshot: ReviewSnapshot,
  reporter: SnapshotShadowReporter | undefined,
): SnapshotShadowResult {
  const shadowPayload = buildReplayPayloadFromSnapshot(snapshot);
  const result: SnapshotShadowResult = {
    source,
    match: shadowPayload === legacyPayload,
    legacyByteLength: legacyPayload.length,
    shadowByteLength: shadowPayload.length,
    snapshot,
  };
  if (!result.match) {
    result.diffPreview = computeDiffPreview(legacyPayload, shadowPayload);
  }
  (reporter ?? defaultReporter)(result);
  return result;
}

function computeDiffPreview(legacy: string, shadow: string): SnapshotShadowResult['diffPreview'] {
  const length = Math.min(legacy.length, shadow.length);
  let index = length;
  for (let i = 0; i < length; i += 1) {
    if (legacy.charCodeAt(i) !== shadow.charCodeAt(i)) {
      index = i;
      break;
    }
  }
  const start = Math.max(0, index - DIFF_PREVIEW_RADIUS);
  const end = index + DIFF_PREVIEW_RADIUS;
  return {
    index,
    legacy: legacy.slice(start, end).slice(0, DIFF_PREVIEW_MAX),
    shadow: shadow.slice(start, end).slice(0, DIFF_PREVIEW_MAX),
  };
}

/** 仅供测试与排障使用：给定 source 名直接得到 default reporter。 */
export const __defaultSnapshotShadowReporter = defaultReporter;

export type { WorkflowNode };
