import type { ModelVersionAttributeRow } from '@/model-source/ports';

/**
 * 属性历史对比的纯函数：把某构件在版本 A / B 下的两张属性表按属性名合并成逐行 before / after。
 * 两侧都是同一个渲染器印出来的字（`history/query tool=attributes` 与 `element/attributes` 同型），字一样就是一样。
 */

export type AttrDiffStatus = 'changed' | 'only-before' | 'only-after' | 'unchanged';

export type AttrDiffRow = {
  name: string;
  before: ModelVersionAttributeRow | null;
  after: ModelVersionAttributeRow | null;
  status: AttrDiffStatus;
};

/** 两行「同一个值」的判据：显示文本相同且 unset 状态相同。 */
export function sameAttributeValue(a: ModelVersionAttributeRow, b: ModelVersionAttributeRow): boolean {
  return a.display === b.display && a.isUnset === b.isUnset;
}

/** 按属性名（大小写不敏感）合并两侧，保持 A 侧出现顺序、B 侧新名字追加在后；两侧都在才判 changed / unchanged。 */
export function diffAttributeRows(before: ModelVersionAttributeRow[], after: ModelVersionAttributeRow[]): AttrDiffRow[] {
  const key = (row: ModelVersionAttributeRow) => row.name.trim().toUpperCase();
  const beforeByName = new Map(before.map((row) => [key(row), row] as const));
  const afterByName = new Map(after.map((row) => [key(row), row] as const));
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of [...before, ...after]) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    order.push(k);
  }
  return order.map((k) => {
    const b = beforeByName.get(k) ?? null;
    const a = afterByName.get(k) ?? null;
    const name = (a ?? b)!.name;
    if (b && a) return { name, before: b, after: a, status: sameAttributeValue(b, a) ? 'unchanged' : 'changed' };
    return { name, before: b, after: a, status: b ? 'only-before' : 'only-after' };
  });
}
