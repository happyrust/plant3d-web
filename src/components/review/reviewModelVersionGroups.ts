import { isReviewModelContext, reviewModelVersionKey } from './reviewModelContext';

import type { ConfirmedRecord } from '@/composables/useReviewStore';

export type ReviewModelVersionGroup = Readonly<{ key: string; label: string; count: number; disabled: boolean; records: ConfirmedRecord[] }>;

export function groupReviewRecordsByModelVersion(records: ConfirmedRecord[]): ReviewModelVersionGroup[] {
  const groups = new Map<string, ReviewModelVersionGroup>();
  for (const record of records) {
    const context = record.modelContext;
    const valid = isReviewModelContext(context);
    const key = !context ? '__legacy__' : valid ? reviewModelVersionKey(context) : '__invalid__';
    const comparison = valid ? context.comparison : null;
    const label = !context ? '旧记录（未绑定模型版本）' : !valid ? '版本信息无效'
      : comparison ? `${context.project} · 模型库 ${comparison.dbnum} · ${comparison.refno} · ${comparison.a} → ${comparison.b}${comparison.units.length > 1 ? ` · ${comparison.units.length} 个单元` : ''}`
        : `${context.project} · 当前模型${context.dbnum ? ` · 模型库 ${context.dbnum}` : ''}`;
    const previous = groups.get(key);
    groups.set(key, { key, label, count: (previous?.count ?? 0) + 1, disabled: key === '__invalid__', records: [...(previous?.records ?? []), record] });
  }
  return [...groups.values()].map(group => ({ ...group, disabled: group.disabled || (groups.size > 1 && group.key === '__legacy__') }));
}
