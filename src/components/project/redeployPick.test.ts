/** 选库页候选库变化后的勾选对账。 */
import { describe, expect, it } from 'vitest';

import { reconcilePicks } from './redeployPick';

const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b);

describe('reconcilePicks', () => {
  it('全选意图下新出现的库自动勾上', () => {
    const { picked, seen } = reconcilePicks({
      picked: new Set([5100, 8000]),
      seen: new Set([5100, 8000]),
      wantAll: true,
      candidates: [5100, 8000, 250206],
    });
    expect(sorted(picked)).toEqual([5100, 8000, 250206]);
    expect(sorted(seen)).toEqual([5100, 8000, 250206]);
  });

  it('用户点掉过的库保持不勾，新库也不擅自加', () => {
    const { picked } = reconcilePicks({
      picked: new Set([5100]),
      seen: new Set([5100, 8000]),
      wantAll: false,
      candidates: [5100, 8000, 9000],
    });
    expect(sorted(picked)).toEqual([5100]);
  });

  it('后台先带出新库、之后再对账，仍按全选意图补勾', () => {
    // 新库进了列表但还没对账：allPicked 此刻已经是 false，意图仍是全选
    const { picked } = reconcilePicks({
      picked: new Set([5100]),
      seen: new Set([5100]),
      wantAll: true,
      candidates: [5100, 8000],
    });
    expect(sorted(picked)).toEqual([5100, 8000]);
  });

  it('库消失后从勾选里剔除，再出现时按新库勾上', () => {
    const first = reconcilePicks({ picked: new Set([5100, 8000]), seen: new Set([5100, 8000]), wantAll: true, candidates: [5100] });
    expect(sorted(first.picked)).toEqual([5100]);
    const second = reconcilePicks({ picked: first.picked, seen: first.seen, wantAll: true, candidates: [5100, 8000] });
    expect(sorted(second.picked)).toEqual([5100, 8000]);
  });

  it('全不选时刷新不擅自加选', () => {
    const { picked } = reconcilePicks({ picked: new Set(), seen: new Set([5100]), wantAll: false, candidates: [5100, 9000] });
    expect(sorted(picked)).toEqual([]);
  });

  it('没有变化时返回同一个集合', () => {
    const before = new Set([8000]);
    const { picked } = reconcilePicks({ picked: before, seen: new Set([5100, 8000]), wantAll: false, candidates: [5100, 8000] });
    expect(picked).toBe(before);
  });
});
