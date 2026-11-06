import { describe, expect, it } from 'vitest';

import { MBD_ANNOTATABLE_NOUNS, isMbdAnnotatableNoun } from './mbdAnnotatableNouns';

/**
 * #103 M7：模型树右键的 MBD 标注入口对管道、设备、支架、土建 / 建筑的主体都开放；类型判定与
 * 「标不了」的结论在服务端（422 `not_annotatable`），这里只挡明显不相干的节点。
 */
describe('isMbdAnnotatableNoun', () => {
  it('opens the MBD entries for pipes, equipment, supports, civil and architecture', () => {
    expect([...MBD_ANNOTATABLE_NOUNS].sort()).toEqual([
      'BRAN',
      'EQUI',
      'FLOOR',
      'FRMW',
      'GWALL',
      'HANG',
      'NOZZ',
      'PANE',
      'PCLA',
      'REST',
      'SCTN',
      'STRU',
      'STWALL',
      'SUPPO',
      'WALL',
    ]);
    for (const noun of MBD_ANNOTATABLE_NOUNS) {
      expect(isMbdAnnotatableNoun(noun), noun).toBe(true);
    }
  });

  it('ignores case and surrounding blanks in the tree node type', () => {
    expect(isMbdAnnotatableNoun('bran')).toBe(true);
    expect(isMbdAnnotatableNoun(' Equi ')).toBe(true);
    expect(isMbdAnnotatableNoun('stWall')).toBe(true);
  });

  it('keeps the entries closed for containers, components and missing types', () => {
    for (const noun of ['SITE', 'ZONE', 'PIPE', 'ATTA', 'TUBI', 'ELBO', 'FLAN', 'BOX', 'CYLI', 'SUPP', 'BRANCH', '']) {
      expect(isMbdAnnotatableNoun(noun), noun).toBe(false);
    }
    expect(isMbdAnnotatableNoun(undefined)).toBe(false);
    expect(isMbdAnnotatableNoun(null)).toBe(false);
  });
});
