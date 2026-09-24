import { describe, expect, it, vi } from 'vitest';

import { applyTaskModelFilter, type TaskModelFilterAabb, type TaskModelFilterScene } from './taskModelFilter';

/**
 * 线上 #84 那张单据：HVAC 支管 BRAN 24384_24935（/-CSV-S-1-H-7801）自己没有几何，成员 BEND 24384_24936 / STRT 24384_24939
 * 各一个对象；场景里另有一根无关的 BRAN 24384_700000 及其成员。状态表（objectIds）里 BRAN 键是 showModelByRefno 建的占位。
 */
const BRAN = '24384_24935';
const MEMBERS = ['24384_24936', '24384_24939'];
const OTHERS = ['24384_700000', '24384_700001'];
const MEMBER_BOX: TaskModelFilterAabb = [32934, -26599, 21000, 34934, -24246, 22100];

function createScene(options: {
  objectIds?: string[];
  subtree?: Record<string, string[]>;
  subtreeAabb?: TaskModelFilterAabb | null;
  aabb?: TaskModelFilterAabb | null;
} = {}) {
  const subtree = options.subtree ?? { [BRAN]: MEMBERS };
  const scene = {
    objectIds: options.objectIds ?? [BRAN, ...MEMBERS, ...OTHERS],
    setObjectsVisible: vi.fn(),
    getAABB: vi.fn(() => options.aabb ?? null),
    getSubtreeRefnos: vi.fn((refnos: string[]) => refnos.flatMap((refno) => subtree[refno] ?? [])),
    getSubtreeAABB: vi.fn(() => (options.subtreeAabb === undefined ? MEMBER_BOX : options.subtreeAabb)),
  };
  return scene as typeof scene & TaskModelFilterScene;
}

describe('applyTaskModelFilter（#84）', () => {
  it('任务是单元（BRAN 自己无对象）：藏全部 → 亮 BRAN + 子树里的成员，飞成员并集盒', () => {
    const scene = createScene();

    const result = applyTaskModelFilter(scene, [BRAN]);

    expect(result).toEqual({ applied: true, shownRefnos: [BRAN, ...MEMBERS], aabb: MEMBER_BOX });
    expect(scene.setObjectsVisible.mock.calls).toEqual([
      [[BRAN, ...MEMBERS, ...OTHERS], false],
      [[BRAN, ...MEMBERS], true],
    ]);
    expect(scene.getSubtreeAABB).toHaveBeenCalledWith([BRAN]);
  });

  it('修前的坑：BRAN 键只是状态表占位、子树一个对象都没装 → 不动场景、不飞（否则整个视口被藏空）', () => {
    const scene = createScene({ subtree: {} });

    const result = applyTaskModelFilter(scene, [BRAN]);

    expect(result).toEqual({ applied: false, reason: 'task-not-loaded' });
    expect(scene.setObjectsVisible).not.toHaveBeenCalled();
    expect(scene.getSubtreeAABB).not.toHaveBeenCalled();
  });

  it('叶子构件任务：子树就是自己；多个任务 refno 取并集并去重、空白 / 重复剔掉', () => {
    const scene = createScene({ subtree: { '24384_24936': ['24384_24936'], [BRAN]: MEMBERS } });

    const result = applyTaskModelFilter(scene, ['24384_24936', ' ', BRAN, '24384_24936']);

    expect(result).toMatchObject({ applied: true, shownRefnos: ['24384_24936', BRAN, '24384_24939'] });
    expect(scene.getSubtreeRefnos).toHaveBeenCalledWith(['24384_24936', BRAN]);
    expect(scene.setObjectsVisible).toHaveBeenLastCalledWith(['24384_24936', BRAN, '24384_24939'], true);
  });

  it('子树盒解不出时退回成员自己的盒；两个都没有就不飞（aabb=null）但过滤照样生效', () => {
    const fallback = createScene({ subtreeAabb: null, aabb: MEMBER_BOX });
    expect(applyTaskModelFilter(fallback, [BRAN])).toMatchObject({ applied: true, aabb: MEMBER_BOX });
    expect(fallback.getAABB).toHaveBeenCalledWith(MEMBERS);

    const none = createScene({ subtreeAabb: null, aabb: null });
    expect(applyTaskModelFilter(none, [BRAN])).toMatchObject({ applied: true, aabb: null });
    expect(none.setObjectsVisible).toHaveBeenCalledTimes(2);
  });

  it('场景还是空的 / 任务清单没有 refno：什么都不做', () => {
    const empty = createScene({ objectIds: [] });
    expect(applyTaskModelFilter(empty, [BRAN])).toEqual({ applied: false, reason: 'no-objects' });
    expect(empty.setObjectsVisible).not.toHaveBeenCalled();

    const scene = createScene();
    expect(applyTaskModelFilter(scene, [])).toEqual({ applied: false, reason: 'no-task-refnos' });
    expect(applyTaskModelFilter(scene, ['', '  '])).toEqual({ applied: false, reason: 'no-task-refnos' });
    expect(scene.setObjectsVisible).not.toHaveBeenCalled();
    expect(scene.getSubtreeRefnos).not.toHaveBeenCalled();
  });
});
