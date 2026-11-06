/** 选库页刷新后的勾选合并：新出现的库默认勾上，取消勾选的库不被刷新复活。 */
import { describe, expect, it } from 'vitest';

import { mergePickedAfterRefresh } from './redeployPick';

describe('mergePickedAfterRefresh', () => {
  it('全选状态下刷新，新出现的库自动勾上', () => {
    const seen = new Set([5100, 8000]);
    const before = new Set([5100, 8000]);
    const { picked, seen: nextSeen } = mergePickedAfterRefresh(before, true, [5100, 8000, 9000], seen);
    expect([...picked].sort()).toEqual([5100, 8000, 9000]);
    expect([...nextSeen].sort()).toEqual([5100, 8000, 9000]);
  });

  it('取消勾选的库刷新后保持不勾，其余已勾的保持', () => {
    const seen = new Set([5100, 8000]);
    const before = new Set([5100]);
    const { picked } = mergePickedAfterRefresh(before, false, [5100, 8000, 9000], seen);
    expect([...picked].sort()).toEqual([5100]);
  });

  it('库消失后从勾选里剔除，再出现时按新库勾上', () => {
    const seen = new Set([5100, 8000]);
    const before = new Set([5100, 8000]);
    const first = mergePickedAfterRefresh(before, true, [5100], seen);
    expect([...first.picked]).toEqual([5100]);
    const second = mergePickedAfterRefresh(first.picked, true, [5100, 8000], first.seen);
    expect([...second.picked].sort()).toEqual([5100, 8000]);
  });

  it('一个都没勾时刷新不擅自加选', () => {
    const seen = new Set([5100]);
    const before = new Set<number>();
    const { picked } = mergePickedAfterRefresh(before, false, [5100, 9000], seen);
    expect([...picked]).toEqual([]);
  });

  it('刷新前后候选库没变时不动勾选', () => {
    const seen = new Set([5100, 8000]);
    const before = new Set([8000]);
    const { picked } = mergePickedAfterRefresh(before, false, [5100, 8000], seen);
    expect([...picked]).toEqual([8000]);
  });
});
