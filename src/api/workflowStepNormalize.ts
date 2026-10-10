// 流转步归一（#86 T5）
// 独立成小模块：reviewApi 与 useUserStore 都用，而大量测试把 `@/api/reviewApi` 整个 mock 掉，
// 放在 reviewApi 里会让那些 mock 缺这个导出。

import type { WorkflowStep } from '@/types/auth';

/**
 * 时间戳归一：毫秒数原样；秒数（< 1e12）乘 1000；字符串（后端的 "YYYY-MM-DD HH:MM:SS" / RFC 3339）
 * 经 Date 解析；解析不出返回 undefined。与 reviewApi 对 created_at / updated_at 的口径一致。
 */
export function normalizeTimestampMillis(value: unknown): number | undefined {
  if (!value) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined;
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const date = new Date(trimmed);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  return undefined;
}

/**
 * 规范化一条流转步。后端（gen-model `WorkflowStep`）的 `timestamp` 是北京时间字符串
 * "YYYY-MM-DD HH:MM:SS"，前端 `WorkflowStep.timestamp` 是毫秒数；不归一的话
 * `reviewTaskFilters` 里 `Math.max(...timestamps)` 对字符串得 NaN，退回时间永远走 `updatedAt`「约」。
 * 字段名兼容 snake / camel；`operator*` 为空时回退 `actor*`。缺 node / action / 可解析时间戳的步丢弃。
 */
export function normalizeWorkflowStep(raw: unknown): WorkflowStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const node = typeof record.node === 'string' ? record.node.trim().toLowerCase() : '';
  const action = typeof record.action === 'string' ? record.action.trim().toLowerCase() : '';
  const timestamp = normalizeTimestampMillis(record.timestamp);
  if (!node || !action || !timestamp) return null;

  const pickString = (...keys: string[]): string => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  };

  const comment = pickString('comment');
  return {
    node: node as WorkflowStep['node'],
    action: action as WorkflowStep['action'],
    operatorId: pickString('operatorId', 'operator_id', 'actorId', 'actor_id'),
    operatorName: pickString('operatorName', 'operator_name', 'actorName', 'actor_name'),
    ...(comment ? { comment } : {}),
    timestamp,
  };
}

/** 数组版：非数组得 `[]`，非法步丢弃 */
export function normalizeWorkflowSteps(raw: unknown): WorkflowStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeWorkflowStep(item))
    .filter((step): step is WorkflowStep => step !== null);
}
