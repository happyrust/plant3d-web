/**
 * 草稿 / 已确认分层合并（交互方案 2026-09-14 §3.6「防串任务是数据边界，不是切页面时 clearAll()」，计划 §3 U0，决策 d-565）。
 *
 * 场景恢复（`restoreConfirmedRecordsIntoScene`）把服务端确认记录回放成一份 V7 payload。U0 之前它整份 `importJSON` 替换内存，
 * 本机还没确认的草稿一并被顶掉；U0 之后本机草稿按 scope 隔离，恢复时应当是**两层叠加**：
 *
 * - **已确认层**（服务端回放）对它含有的 id 是权威：本机同 id 的副本一律被它覆盖（本机对已确认条目的未确认改动**不**保留——
 *   记录上没有 `updatedAt`，分不出「本机后改的」和「服务端后改的」，宁可以服务端为准；U3 的草稿快照 + `base_record_revision` 到位后再做三方合并）。
 * - **草稿层**（本机容器里 id 不在已确认层的条目）原样保留，排在已确认条目之后。
 *
 * 只按 `id` 对齐、只做数组合并，不 normalize、不改任一条目内容——normalize 交给 `importJSON` 的漏斗。
 * 没有 Vue、没有 localStorage 访问。
 */

export const LAYERED_PAYLOAD_ARRAY_FIELDS = [
  'measurements',
  'legacyMeasurements',
  'annotations',
  'obbAnnotations',
  'cloudAnnotations',
  'rectAnnotations',
] as const;

export type LayeredPayloadArrayField = (typeof LAYERED_PAYLOAD_ARRAY_FIELDS)[number];

export type LayeredPayload = { version: 7 } & Record<LayeredPayloadArrayField, unknown[]>;

export type DraftLayerMergeResult = {
  /** 合并后的 V7 payload（JSON 字串，可直接 `importJSON`） */
  payload: string;
  /** 各数组保留下来的本机草稿条数（id 不在已确认层） */
  keptDrafts: Record<LayeredPayloadArrayField, number>;
  /** 本机同 id 副本被已确认层覆盖的条数（合计） */
  overriddenByConfirmed: number;
  /** 本机 payload 解析失败 / 不是 V7：只回放已确认层 */
  localPayloadIgnored: boolean;
};

function emptyCounts(): Record<LayeredPayloadArrayField, number> {
  return {
    measurements: 0,
    legacyMeasurements: 0,
    annotations: 0,
    obbAnnotations: 0,
    cloudAnnotations: 0,
    rectAnnotations: 0,
  };
}

function readItemId(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const id = (item as { id?: unknown }).id;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 只认 `version: 7`、字段缺省当空数组、非数组字段视为坏 payload */
export function parseLayeredPayload(raw: string | null | undefined): LayeredPayload | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 7) return null;
  const source = parsed as Record<string, unknown>;
  const out = { version: 7 } as LayeredPayload;
  for (const field of LAYERED_PAYLOAD_ARRAY_FIELDS) {
    const value = source[field];
    if (value === undefined || value === null) {
      out[field] = [];
    } else if (Array.isArray(value)) {
      out[field] = value;
    } else {
      return null;
    }
  }
  return out;
}

/**
 * 已确认层 ∪ 本机草稿层。`confirmedPayload` 必须是 V7（回放器产出的就是），否则原样返回它、不合并。
 */
export function mergeConfirmedReplayWithLocalDrafts(
  confirmedPayload: string,
  localPayload: string | null | undefined,
): DraftLayerMergeResult {
  const confirmed = parseLayeredPayload(confirmedPayload);
  const local = parseLayeredPayload(localPayload);
  if (!confirmed || !local) {
    return {
      payload: confirmedPayload,
      keptDrafts: emptyCounts(),
      overriddenByConfirmed: 0,
      localPayloadIgnored: !local,
    };
  }

  const merged = { version: 7 } as LayeredPayload;
  const keptDrafts = emptyCounts();
  let overriddenByConfirmed = 0;

  for (const field of LAYERED_PAYLOAD_ARRAY_FIELDS) {
    const confirmedItems = confirmed[field];
    const confirmedIds = new Set<string>();
    for (const item of confirmedItems) {
      const id = readItemId(item);
      if (id) confirmedIds.add(id);
    }
    const drafts: unknown[] = [];
    for (const item of local[field]) {
      const id = readItemId(item);
      if (id && confirmedIds.has(id)) {
        overriddenByConfirmed += 1;
        continue;
      }
      drafts.push(item);
    }
    keptDrafts[field] = drafts.length;
    merged[field] = [...confirmedItems, ...drafts];
  }

  return {
    payload: JSON.stringify(merged),
    keptDrafts,
    overriddenByConfirmed,
    localPayloadIgnored: false,
  };
}

export function countKeptDrafts(result: DraftLayerMergeResult): number {
  return LAYERED_PAYLOAD_ARRAY_FIELDS.reduce((sum, field) => sum + result.keptDrafts[field], 0);
}
