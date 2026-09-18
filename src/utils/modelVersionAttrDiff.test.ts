import { describe, expect, it } from 'vitest';

import { diffAttributeRows, sameAttributeValue } from './modelVersionAttrDiff';

import type { ModelVersionAttributeRow } from '@/model-source/ports';

function row(name: string, display: string, extra: Partial<ModelVersionAttributeRow> = {}): ModelVersionAttributeRow {
  return { name, valueType: 'string', display, isUnset: false, isUda: false, ...extra };
}

describe('modelVersionAttrDiff', () => {
  it('按属性名合并两侧：两侧都有的判 changed / unchanged，只有一侧的判 only-before / only-after，保持 A 侧顺序、B 侧新名追加', () => {
    const rows = diffAttributeRows(
      [row('NAME', '/P1'), row('ANGL', '90'), row('DESC', '', { isUnset: true }), row('OLDATT', 'x')],
      [row('NAME', '/P1'), row('ANGL', '45'), row('DESC', 'moved'), row('NEWATT', 'y')],
    );
    expect(rows.map((item) => [item.name, item.status])).toEqual([
      ['NAME', 'unchanged'],
      ['ANGL', 'changed'],
      ['DESC', 'changed'],
      ['OLDATT', 'only-before'],
      ['NEWATT', 'only-after'],
    ]);
    expect(rows[1]).toMatchObject({ before: { display: '90' }, after: { display: '45' } });
    expect(rows[3]?.after).toBeNull();
    expect(rows[4]?.before).toBeNull();
  });

  it('属性名大小写不敏感地对上，显示名取 B 侧的写法', () => {
    const rows = diffAttributeRows([row('pos', '0 0 0')], [row('POS', '0 0 10')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'POS', status: 'changed' });
  });

  it('sameAttributeValue：字一样且 unset 状态一样才算同一个值', () => {
    expect(sameAttributeValue(row('A', ''), row('A', '', { isUnset: true }))).toBe(false);
    expect(sameAttributeValue(row('A', '1'), row('A', '1'))).toBe(true);
    expect(sameAttributeValue(row('A', '1'), row('A', '1.0'))).toBe(false);
  });

  it('两侧都空 → 空表', () => {
    expect(diffAttributeRows([], [])).toEqual([]);
  });
});
