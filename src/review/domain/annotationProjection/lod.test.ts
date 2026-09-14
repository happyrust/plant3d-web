import { describe, expect, it } from 'vitest';

import { cloudLodPriority, planCloudLod, type CloudLodCandidate, type CloudLodLevel } from './lod';

function candidates(n: number, previous: (i: number) => CloudLodLevel | null = () => null, pinned: (i: number) => boolean = () => false): CloudLodCandidate[] {
  const out: CloudLodCandidate[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `c${String(i).padStart(4, '0')}`, priority: i / n, pinnedHigh: pinned(i), previous: previous(i) });
  }
  return out;
}

function levelsOf(plan: ReturnType<typeof planCloudLod>): Record<CloudLodLevel, string[]> {
  const out: Record<CloudLodLevel, string[]> = { full: [], pin: [] };
  for (const [id, level] of plan.levels) out[level].push(id);
  out.full.sort();
  out.pin.sort();
  return out;
}

describe('cloudLodPriority', () => {
  it('屏内按到视口中心的距离；屏外 2 + 出屏距离；相机背后 4 + …；非有限值最低', () => {
    expect(cloudLodPriority(0, 0, false)).toBe(0);
    expect(cloudLodPriority(0.6, 0.8, false)).toBeCloseTo(1, 9);
    expect(cloudLodPriority(1, 1, false)).toBeCloseTo(Math.SQRT2, 9);
    expect(cloudLodPriority(1.5, 0, false)).toBeCloseTo(2.5, 9);
    expect(cloudLodPriority(-3, 0.2, false)).toBeCloseTo(4, 9);
    // 背后的锚点即便投影落在屏内也排在所有屏外之后
    expect(cloudLodPriority(0, 0, true)).toBe(4);
    expect(cloudLodPriority(2, 0, true)).toBe(5);
    expect(cloudLodPriority(Number.NaN, 0, false)).toBe(Number.POSITIVE_INFINITY);
    // 三段互不重叠
    expect(cloudLodPriority(1, 1, false)).toBeLessThan(cloudLodPriority(1.0001, 0, false));
    expect(cloudLodPriority(100, 100, false)).toBeGreaterThan(2);
  });
});

describe('planCloudLod', () => {
  it('不超预算：全部 full，overBudget=false（≤ 64 条零开销路径）', () => {
    const plan = planCloudLod(candidates(64), { budget: 64, slack: 16 });
    expect(plan.overBudget).toBe(false);
    expect(plan.fullCount).toBe(64);
    expect(plan.pinCount).toBe(0);
    expect([...plan.levels.values()].every((l) => l === 'full')).toBe(true);
  });

  it('超预算首次规划：按优先级取前 budget 条 full，其余 pin；同分按 id 字典序确定', () => {
    const plan = planCloudLod(candidates(10), { budget: 4, slack: 2 });
    expect(plan.overBudget).toBe(true);
    expect(levelsOf(plan)).toEqual({
      full: ['c0000', 'c0001', 'c0002', 'c0003'],
      pin: ['c0004', 'c0005', 'c0006', 'c0007', 'c0008', 'c0009'],
    });

    const tie = planCloudLod(
      [
        { id: 'b', priority: 0.5, pinnedHigh: false, previous: null },
        { id: 'a', priority: 0.5, pinnedHigh: false, previous: null },
        { id: 'c', priority: 0.5, pinnedHigh: false, previous: null },
      ],
      { budget: 2, slack: 0 },
    );
    expect(levelsOf(tie)).toEqual({ full: ['a', 'b'], pin: ['c'] });
  });

  it('pinnedHigh（激活 / 拖动 / 悬停）固定 full 且占预算，即便优先级最差', () => {
    const list = candidates(10, () => null, (i) => i === 9);
    const plan = planCloudLod(list, { budget: 4, slack: 0 });
    const levels = levelsOf(plan);
    expect(levels.full).toEqual(['c0000', 'c0001', 'c0002', 'c0009']);
    expect(plan.fullCount).toBe(4);

    // 固定高档超过预算本身：全部 full，其它一律 pin
    const allPinned = planCloudLod(candidates(6, () => null, (i) => i >= 2), { budget: 2, slack: 0 });
    expect(levelsOf(allPinned)).toEqual({ full: ['c0002', 'c0003', 'c0004', 'c0005'], pin: ['c0000', 'c0001'] });
  });

  it('滞回：已是 full 的条目排名掉进 [budget, budget+slack) 仍保持 full；掉出带外才降；pin 条目要排进 budget 内才升', () => {
    // 上一帧前 4 条 full；这一帧优先级整体翻转：原 full 的 c0000..c0003 排到 6..9
    const flipped: CloudLodCandidate[] = candidates(10, (i) => (i < 4 ? 'full' : 'pin')).map((c, i) => ({ ...c, priority: (10 - i) / 10 }));
    const plan = planCloudLod(flipped, { budget: 4, slack: 3 });
    const levels = levelsOf(plan);
    // 新排名：c0009(0.1) c0008 c0007 c0006 | c0005 c0004 c0003(6) c0002(7) c0001(8) c0000(9)
    // 前 4 名升 full；原 full 里 c0003 排 6 < 4+3=7 保持，c0002 排 7 不在带内 → 降
    expect(levels.full).toEqual(['c0003', 'c0006', 'c0007', 'c0008', 'c0009']);
    expect(levels.pin).toEqual(['c0000', 'c0001', 'c0002', 'c0004', 'c0005']);
    // 总 full 数不超过 budget + slack
    expect(plan.fullCount).toBeLessThanOrEqual(4 + 3);
  });

  it('滞回不抖：预算边界附近两条互换名次，已 full 的不掉、pin 的不升', () => {
    const prev = candidates(6, (i) => (i < 3 ? 'full' : 'pin'));
    // c0002（full）与 c0003（pin）名次互换：c0003 更靠前
    const swapped = prev.map((c) => (c.id === 'c0002' ? { ...c, priority: 0.55 } : c.id === 'c0003' ? { ...c, priority: 0.3 } : c));
    const plan = planCloudLod(swapped, { budget: 3, slack: 1 });
    // 排名：c0000 c0001 c0003(2) c0002(3)：c0003 排进 budget 升 full；c0002 排 3 在 [3,4) 保持 full
    expect(levelsOf(plan)).toEqual({ full: ['c0000', 'c0001', 'c0002', 'c0003'], pin: ['c0004', 'c0005'] });

    // 再次以同样输入规划（previous 更新）：结果稳定
    const again = planCloudLod(swapped.map((c) => ({ ...c, previous: plan.levels.get(c.id) ?? null })), { budget: 3, slack: 1 });
    expect(levelsOf(again)).toEqual(levelsOf(plan));
  });

  it('非有限优先级排最后；预算 0 时只有 pinnedHigh 是 full', () => {
    const list: CloudLodCandidate[] = [
      { id: 'nan', priority: Number.NaN, pinnedHigh: false, previous: null },
      { id: 'far', priority: 3, pinnedHigh: false, previous: null },
      { id: 'near', priority: 0.1, pinnedHigh: false, previous: null },
    ];
    expect(levelsOf(planCloudLod(list, { budget: 2, slack: 0 }))).toEqual({ full: ['far', 'near'], pin: ['nan'] });
    expect(levelsOf(planCloudLod([...list, { id: 'active', priority: 9, pinnedHigh: true, previous: null }], { budget: 0, slack: 0 })))
      .toEqual({ full: ['active'], pin: ['far', 'nan', 'near'] });
  });
});
