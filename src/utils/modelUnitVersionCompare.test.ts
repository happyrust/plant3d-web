import { describe, expect, it, vi } from 'vitest';

import {
  applyModelUnitRefnoVisibility,
  applyModelUnitVersionSide,
  buildTreeDiffModels,
  collectModelUnitTargetObjectIds,
  compareModelUnitGeometry,
  countModelUnitGeometryStatuses,
  DEFAULT_MODEL_UNIT_COMPARE_SIDE,
  DEFAULT_MODEL_UNIT_COMPARE_VIEW_MODE,
  getModelUnitCompareRenderPasses,
  geometrySnapshotsFromInstanceEntries,
  MODEL_UNIT_GEOMETRY_STATUS_COLORS,
  orderModelUnitVersionPair,
  planModelUnitCompareObjectStyles,
  readModelUnitVersionCompareUrl,
  refnoFromCompareObjectId,
  shouldOpenModelUnitVersionCompareFromUrl,
  sideFromCompareObjectId,
  type ModelUnitGeometryDiff,
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

  it('buildTreeDiffModels：unchanged 不进树、被删的 ownerRefno 取 A 侧、tombstone 补单元根', () => {
    const version = (sesno: number, impactKind: 'placement' | 'tombstone') => ({
      dbnum: 8000, unitRefno: '24384_26480', unitNoun: 'EQUI', sesno, sessionTime: null, impactKind,
    });
    const rows = [
      { refno: '24384_26481', noun: 'BOX', status: 'deleted' as const },
      { refno: '24384_26483', noun: 'CYLI', status: 'added' as const },
      { refno: '24384_26484', noun: 'BOX', status: 'unchanged' as const },
    ];
    const beforeOwners = new Map([['24384_26481', '24384_26480'], ['24384_26480', '24384_100']]);
    const afterOwners = new Map([['24384_26483', '24384_26480']]);

    const placement = buildTreeDiffModels({
      dbnum: 8000, before: version(587, 'placement'), after: version(602, 'placement'), rows, beforeOwners, afterOwners,
    });
    expect(placement).toEqual([
      { refno: '24384_26481', category: 'BOX', status: 'deleted', sourceNouns: 'BOX', ownerRefno: '24384_26480' },
      { refno: '24384_26483', category: 'CYLI', status: 'added', sourceNouns: 'CYLI', ownerRefno: '24384_26480' },
    ]);

    const tombstone = buildTreeDiffModels({
      dbnum: 8000, before: version(602, 'placement'), after: version(604, 'tombstone'), rows: [rows[0]!], beforeOwners,
    });
    expect(tombstone).toEqual([
      { refno: '24384_26481', category: 'BOX', status: 'deleted', sourceNouns: 'BOX', ownerRefno: '24384_26480' },
      { refno: '24384_26480', category: 'EQUI', status: 'deleted', sourceNouns: 'EQUI', ownerRefno: '24384_100' },
    ]);

    // 两侧都没有属主表：ownerRefno 不给（树回落挂根），不报错
    const bare = buildTreeDiffModels({ dbnum: 8000, before: version(587, 'placement'), after: version(602, 'placement'), rows });
    expect(bare.every((model) => model.ownerRefno === undefined)).toBe(true);
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

  it('「三维只看差异」：只把当前显示那一侧的 unchanged 对象藏掉，另一侧整层已关不再多写', () => {
    const before = { setAllVisible: vi.fn(), setObjectsVisible: vi.fn() };
    const after = { setAllVisible: vi.fn(), setObjectsVisible: vi.fn() };
    const hidden = { before: ['unit-compare:a:1_1:0'], after: ['unit-compare:b:1_1:3'] };

    applyModelUnitVersionSide(before, after, 'after', hidden);
    expect(after.setAllVisible).toHaveBeenCalledWith(true);
    expect(after.setObjectsVisible).toHaveBeenCalledWith(['unit-compare:b:1_1:3'], false);
    expect(before.setObjectsVisible).not.toHaveBeenCalled();

    // 不开开关（null）就是老行为：整层显 / 隐，不碰单个对象
    vi.clearAllMocks();
    applyModelUnitVersionSide(before, after, 'before', null);
    expect(before.setAllVisible).toHaveBeenCalledWith(true);
    expect(before.setObjectsVisible).not.toHaveBeenCalled();
    expect(after.setObjectsVisible).not.toHaveBeenCalled();

    // 该侧没有 unchanged 时不发空数组
    vi.clearAllMocks();
    applyModelUnitVersionSide(before, after, 'before', { before: [], after: ['x'] });
    expect(before.setObjectsVisible).not.toHaveBeenCalled();
  });

  it('三维按「模型几何差异」着色：对象 id 里的 refno 查 rows 定四态，查不到按 unchanged；计数与面板徽章同一份 rows', () => {
    const rows: ModelUnitGeometryDiff[] = [
      { refno: '24384_23262', noun: 'FTUB', status: 'modified' },
      { refno: '24384_23270', noun: 'ELBO', status: 'added' },
      { refno: '24384_23258', noun: 'TUBI', status: 'deleted' },
      { refno: '24384_23259', noun: 'TUBI', status: 'unchanged' },
    ];

    expect(refnoFromCompareObjectId('unit-compare:a:24384_23262:5')).toBe('24384_23262');
    expect(refnoFromCompareObjectId('o:24384_23262:0')).toBe('24384_23262');
    expect(refnoFromCompareObjectId('bare')).toBeNull();
    // 三维里点到的对象属于哪一侧（属性面板据此钉到 A / B 那版）；主图层的 `o:` 对象不算
    expect(sideFromCompareObjectId('unit-compare:a:24384_23262:5')).toBe('before');
    expect(sideFromCompareObjectId('unit-compare:b:24384_23262:9')).toBe('after');
    expect(sideFromCompareObjectId('o:24384_23262:0')).toBeNull();

    // A 侧：修改琥珀 / 删除玫红 / 未变灰；派生对象（rows 里没有的 refno）不乱标
    expect(planModelUnitCompareObjectStyles([
      'unit-compare:a:24384_23262:0',
      'unit-compare:a:24384/23258:1',
      'unit-compare:a:24384_23259:2',
      'unit-compare:a:24384_99999:3',
    ], rows)).toEqual([
      { objectId: 'unit-compare:a:24384_23262:0', status: 'modified' },
      { objectId: 'unit-compare:a:24384/23258:1', status: 'deleted' },
      { objectId: 'unit-compare:a:24384_23259:2', status: 'unchanged' },
      { objectId: 'unit-compare:a:24384_99999:3', status: 'unchanged' },
    ]);
    // B 侧：新增翠绿
    expect(planModelUnitCompareObjectStyles(['unit-compare:b:24384_23270:7'], rows)).toEqual([
      { objectId: 'unit-compare:b:24384_23270:7', status: 'added' },
    ]);

    expect(countModelUnitGeometryStatuses(rows)).toEqual({ added: 1, deleted: 1, modified: 1, unchanged: 1 });
    expect(countModelUnitGeometryStatuses([])).toEqual({ added: 0, deleted: 0, modified: 0, unchanged: 0 });
    // 与面板徽章 / 模型树差异模式同一套 Tailwind 色值（emerald-500 / rose-500 / amber-500 / slate-400）
    expect(MODEL_UNIT_GEOMETRY_STATUS_COLORS).toEqual({ added: 0x10b981, deleted: 0xf43f5e, modified: 0xf59e0b, unchanged: 0x94a3b8 });
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
