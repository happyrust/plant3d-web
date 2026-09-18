import { describe, expect, it, vi } from 'vitest';

import {
  applyModelUnitRefnoVisibility,
  applyModelUnitVersionSide,
  collectModelUnitTargetObjectIds,
  compareModelUnitGeometry,
  DEFAULT_MODEL_UNIT_COMPARE_SIDE,
  DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
  getModelUnitCompareRenderPasses,
  geometrySnapshotsFromInstanceEntries,
  orderModelUnitVersionPair,
  readModelUnitVersionCompareUrl,
  shouldOpenModelUnitVersionCompareFromUrl,
  type ModelUnitGeometrySnapshot,
} from './modelUnitVersionCompare';

function snapshot(refno: string, signature: string): ModelUnitGeometrySnapshot {
  return { refno, noun: 'PIPE', signature };
}

describe('modelUnitVersionCompare', () => {
  it('URL 入口：unit_refno + compare_a/b + compare_autorun（Q16）', () => {
    expect(readModelUnitVersionCompareUrl('?unit_refno=24381/145018&compare_a=791&compare_b=897&compare_autorun=1')).toEqual({
      unitRefno: '24381/145018',
      compareA: 791,
      compareB: 897,
      autorun: true,
    });
    expect(readModelUnitVersionCompareUrl('?unit_refno=24381_145018&compare_a=abc&compare_autorun=yes')).toEqual({
      unitRefno: '24381_145018',
      compareA: null,
      compareB: null,
      autorun: true,
    });
    expect(readModelUnitVersionCompareUrl('?unit_refno=24381_145018')).toMatchObject({ autorun: false });
    expect(shouldOpenModelUnitVersionCompareFromUrl('?unit_refno=24381_145018&compare_autorun=1')).toBe(true);
    expect(shouldOpenModelUnitVersionCompareFromUrl('?compare_autorun=1')).toBe(false);
    expect(shouldOpenModelUnitVersionCompareFromUrl('?unit_refno=24381_145018')).toBe(false);
  });

  it('自动把较早版本放在 A、较新版本放在 B', () => {
    const older = { sesno: 791, impactKind: 'mesh' };
    const newer = { sesno: 897, impactKind: 'mesh' };

    expect(orderModelUnitVersionPair(newer, older)).toEqual([older, newer]);
  });

  it('单 viewport 默认显示 B，切换只改变两个版本层的显隐', () => {
    const before = { setAllVisible: vi.fn() };
    const after = { setAllVisible: vi.fn() };

    expect(DEFAULT_MODEL_UNIT_COMPARE_SIDE).toBe('after');
    applyModelUnitVersionSide(before, after, 'before');

    expect(before.setAllVisible).toHaveBeenCalledWith(true);
    expect(after.setAllVisible).toHaveBeenCalledWith(false);
  });

  it('版本查看默认单视口，分屏时左 A 右 B 且完整覆盖奇数宽度', () => {
    expect(DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE).toBe('single');
    expect(getModelUnitCompareRenderPasses('single', 'before', 1001, 600)).toEqual([
      { side: 'before', x: 0, y: 0, width: 1001, height: 600 },
    ]);
    expect(getModelUnitCompareRenderPasses('split', 'after', 1001, 600)).toEqual([
      { side: 'before', x: 0, y: 0, width: 500, height: 600 },
      { side: 'after', x: 500, y: 0, width: 501, height: 600 },
    ]);
  });

  it('只收集目标完整子树对象并按 refno 显隐状态恢复', () => {
    const ids = collectModelUnitTargetObjectIds(
      '1_10',
      ['1_10', '1_11'],
      (refno) => refno === '1_10' ? ['root'] : ['child-a', 'child-b'],
      () => ['child-b', 'owned'],
    );
    expect(ids).toEqual(['child-b', 'owned', 'root', 'child-a']);

    const setObjectVisible = vi.fn();
    applyModelUnitRefnoVisibility(
      { setObjectVisible },
      new Map([['1_11', false]]),
      () => ['child-a', 'child-b'],
    );
    expect(setObjectVisible.mock.calls).toEqual([
      ['child-a', false],
      ['child-b', false],
    ]);
  });

  it('按 refno 分类新增、删除、修改和未变几何', () => {
    const rows = compareModelUnitGeometry(
      [snapshot('1_1', 'same'), snapshot('1_2', 'old'), snapshot('1_3', 'gone')],
      [snapshot('1_1', 'same'), snapshot('1_2', 'new'), snapshot('1_4', 'added')],
    );

    expect(rows.map(({ refno, status }) => [refno, status])).toEqual([
      ['1_4', 'added'],
      ['1_3', 'deleted'],
      ['1_2', 'modified'],
      ['1_1', 'unchanged'],
    ]);
  });

  it('几何签名关注网格和矩阵，不受显示名称变化影响', () => {
    const entry = (name: string, x: number) => ({
      geo_hash: 'mesh-a',
      geo_index: 0,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1],
      uniforms: { noun: 'PIPE', name },
    });

    const oldSnapshot = geometrySnapshotsFromInstanceEntries(new Map([['1_1', [entry('old', 0)]]]))[0];
    const renamedSnapshot = geometrySnapshotsFromInstanceEntries(new Map([['1_1', [entry('new', 0)]]]))[0];
    const movedSnapshot = geometrySnapshotsFromInstanceEntries(new Map([['1_1', [entry('new', 10)]]]))[0];

    expect(renamedSnapshot.signature).toBe(oldSnapshot.signature);
    expect(movedSnapshot.signature).not.toBe(oldSnapshot.signature);
  });
});
