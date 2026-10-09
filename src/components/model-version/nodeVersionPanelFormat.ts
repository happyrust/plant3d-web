import type { ModelNodeDiffRow, ModelVersionImpactKind } from '@/model-source';
import type { AttributeNetDiffView } from '@/utils/nodeVersionTimeline';

/** 差异摘要里有变的一行 + 它所属的单元（面板 `changedElementRows` 拼的，属性对比 tab 列的） */
export type ChangedElementRow = ModelNodeDiffRow & { unitRefno: string | null; unitNoun: string | null };

/**
 * 节点版本面板（`ModelUnitVersionComparePanel` 与它拆出来的三个子组件）共用的显示口径：徽章文案 / 配色、净差去向、成员差一句话。
 * 只出字与 class，不碰状态。行上那颗徽章显示哪一列（`timelineRowImpact` / `timelineRowAttributeOnly`）在 `utils/nodeVersionTimeline`。
 */

export function impactLabel(impact: ModelVersionImpactKind | null): string {
  return impact ?? '未变';
}

export function impactClass(impact: ModelVersionImpactKind | null): string {
  switch (impact) {
    case 'mesh': return 'bg-amber-100 text-amber-700';
    case 'placement': return 'bg-blue-100 text-blue-700';
    case 'delivery': return 'bg-emerald-100 text-emerald-700';
    case 'tombstone': return 'bg-rose-100 text-rose-700';
    case 'noop': return 'bg-slate-100 text-slate-600';
    default: return 'bg-slate-100 text-slate-500';
  }
}

export const STATUS_LABEL: Record<string, string> = { added: '新增', deleted: '删除', modified: '修改', unchanged: '未变', noop: 'noop' };
export const STATUS_CLASS: Record<string, string> = {
  added: 'bg-emerald-100 text-emerald-700',
  deleted: 'bg-rose-100 text-rose-700',
  modified: 'bg-amber-100 text-amber-700',
  unchanged: 'bg-slate-100 text-slate-600',
  noop: 'bg-slate-100 text-slate-600',
};

/** 属性净差的去向（服务端 `kind`）：created = A 侧不存在，deleted = B 侧不存在 */
export const DIFF_KIND_LABEL: Record<string, string> = { created: 'A 侧不存在 · 新建', modified: '修改', deleted: 'B 侧不存在 · 已删', unchanged: '两端一字没差' };
export const DIFF_KIND_CLASS: Record<string, string> = {
  created: 'bg-emerald-100 text-emerald-700',
  modified: 'bg-amber-100 text-amber-700',
  deleted: 'bg-rose-100 text-rose-700',
  unchanged: 'bg-slate-100 text-slate-600',
};

/** 成员表两端真差的一句话：`新增 n · 移除 m · 重排` */
export function membersText(members: NonNullable<AttributeNetDiffView['members']>): string {
  const parts: string[] = [];
  if (members.added.length) parts.push(`新增 ${members.added.length}（${members.added.slice(0, 3).join('、')}${members.added.length > 3 ? '…' : ''}）`);
  if (members.removed.length) parts.push(`移除 ${members.removed.length}（${members.removed.slice(0, 3).join('、')}${members.removed.length > 3 ? '…' : ''}）`);
  if (members.reordered) parts.push('重排');
  return parts.join(' · ');
}

/** 一格净差的取数口径，写在表底：服务端两端直接读终态，还是旧服务端下折出来的 */
export function diffSourceText(view: AttributeNetDiffView): string {
  return view.source === 'server'
    ? '取数：服务端 element/attribute-diff——A / B 各钉一个会话、同一个属性渲染器两端各出一次字，直接读终态；未变的属性不列。'
    : '取数：服务端还没有 element/attribute-diff，这里把 (A, B] 里逐会话的 before / after 折成净差；成员 / owner 只能说「动过」。';
}
