import { describe, expect, it } from 'vitest';

import { groupRefnosByDbnum } from './refnoDbnumGroup';

/** 两条 BRAN 分属两个库的典型布局：24381_* 在 1，24383_* 在 2。 */
const DBNUM_BY_REF0: Readonly<Record<string, number>> = {
  '24381': 1,
  '24383': 2,
};

const resolveDbno = (refno: string): number | null => {
  const ref0 = refno.split('_')[0] ?? '';
  return DBNUM_BY_REF0[ref0] ?? null;
};

describe('groupRefnosByDbnum', () => {
  it('keeps a single BRAN in one group', () => {
    expect(groupRefnosByDbnum(['24381_145018'], resolveDbno)).toEqual({
      groups: [{ dbno: 1, refnos: ['24381_145018'] }],
      unresolved: [],
    });
  });

  it('splits BRANs that live in different databases', () => {
    const { groups, unresolved } = groupRefnosByDbnum(
      ['24381_145018', '24381_146979', '24383_91813'],
      resolveDbno,
    );
    expect(unresolved).toEqual([]);
    expect(groups).toEqual([
      { dbno: 1, refnos: ['24381_145018', '24381_146979'] },
      { dbno: 2, refnos: ['24383_91813'] },
    ]);
  });

  it('groups by first appearance so the caller keeps URL order', () => {
    const { groups } = groupRefnosByDbnum(
      ['24383_91813', '24381_145018', '24383_1'],
      resolveDbno,
    );
    expect(groups).toEqual([
      { dbno: 2, refnos: ['24383_91813', '24383_1'] },
      { dbno: 1, refnos: ['24381_145018'] },
    ]);
  });

  it('normalizes and de-duplicates before grouping', () => {
    const { groups } = groupRefnosByDbnum(
      [' 24381/145018 ', '24381_145018', '=24383/91813'],
      resolveDbno,
    );
    expect(groups).toEqual([
      { dbno: 1, refnos: ['24381_145018'] },
      { dbno: 2, refnos: ['24383_91813'] },
    ]);
  });

  it('collects BRANs whose dbnum cannot be resolved', () => {
    const { groups, unresolved } = groupRefnosByDbnum(
      ['24381_145018', '99999_1', 'not-a-refno'],
      resolveDbno,
    );
    expect(groups).toEqual([{ dbno: 1, refnos: ['24381_145018'] }]);
    expect(unresolved).toEqual(['99999_1', 'not-a-refno']);
  });

  it('treats a throwing resolver as unresolved instead of aborting the batch', () => {
    const throwing = (refno: string): number | null => {
      if (refno === '24383_91813') throw new Error('db_meta 未加载');
      return resolveDbno(refno);
    };
    const { groups, unresolved } = groupRefnosByDbnum(
      ['24381_145018', '24383_91813'],
      throwing,
    );
    expect(groups).toEqual([{ dbno: 1, refnos: ['24381_145018'] }]);
    expect(unresolved).toEqual(['24383_91813']);
  });

  it('rejects non-positive or non-finite dbnum values', () => {
    const { groups, unresolved } = groupRefnosByDbnum(
      ['A', 'B', 'C'],
      refno => (refno === 'A' ? 0 : refno === 'B' ? Number.NaN : 3),
    );
    expect(groups).toEqual([{ dbno: 3, refnos: ['C'] }]);
    expect(unresolved).toEqual(['A', 'B']);
  });

  it('returns empty groups for an empty input', () => {
    expect(groupRefnosByDbnum([], resolveDbno)).toEqual({ groups: [], unresolved: [] });
  });
});
