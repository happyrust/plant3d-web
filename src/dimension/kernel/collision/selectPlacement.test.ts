import { describe, expect, it, vi } from 'vitest';

import {
  NoAcceptablePlacementError,
  selectPlacement,
} from './selectPlacement';

type Candidate = Readonly<{ id: string }>;

const a: Candidate = { id: 'a' };
const b: Candidate = { id: 'b' };
const c: Candidate = { id: 'c' };

describe('selectPlacement', () => {
  it('takes the first acceptable candidate in the order given, not the best-scoring one', () => {
    // 入参顺序就是优先级。这里让第一个和第三个都可接受，必须拿第一个：
    // 若实现自作主张按别的标准挑，这条会红。
    const accept = (candidate: Candidate) => candidate.id !== 'b';
    const choice = selectPlacement([a, b, c], accept);
    expect(choice.chosen).toBe(a);
    expect(choice.index).toBe(0);
    expect(choice.outcome).toBe('accepted');
    expect(choice.tried).toBe(1);
  });

  it('walks past rejected candidates and reports how many it tried', () => {
    const accept = (candidate: Candidate) => candidate.id === 'c';
    const choice = selectPlacement([a, b, c], accept);
    expect(choice.chosen).toBe(c);
    expect(choice.index).toBe(2);
    expect(choice.outcome).toBe('accepted');
    // 试了 a、b、c 三个才拿到。
    expect(choice.tried).toBe(3);
  });

  it('returns the first candidate when every candidate is rejected', () => {
    // 缺省兜底是「最优先的那个」：候选序本身就是优先级，最差也比不画强。
    const choice = selectPlacement([a, b, c], () => false);
    expect(choice.chosen).toBe(a);
    expect(choice.index).toBe(0);
    expect(choice.outcome).toBe('exhausted');
    expect(choice.tried).toBe(3);
  });

  it('returns an explicit fallback when every candidate is rejected', () => {
    const fallback: Candidate = { id: 'fallback' };
    const choice = selectPlacement([a, b], () => false, { fallback });
    expect(choice.chosen).toBe(fallback);
    // -1 而不是 0：兜底不是候选表里的一员，调用方据此知道「没挑到」。
    expect(choice.index).toBe(-1);
    expect(choice.outcome).toBe('exhausted');
    expect(choice.tried).toBe(2);
  });

  it('reports "nothing acceptable" instead of guessing when the caller asks for it', () => {
    // `fallback: null` 是显式表态：调用方要自己处理「没有可接受位置」。
    // 这时静默返回 candidates[0] 会把「全都撞了」伪装成「第一个能放」。
    expect(() => selectPlacement([a, b], () => false, { fallback: null }))
      .toThrow(NoAcceptablePlacementError);
    try {
      selectPlacement([a, b], () => false, { fallback: null });
    } catch (error) {
      expect(error).toBeInstanceOf(NoAcceptablePlacementError);
      expect((error as NoAcceptablePlacementError).tried).toBe(2);
      // 消息要能区分「都撞了」与「压根没候选」。
      expect((error as Error).message).toContain('all 2 candidates were rejected');
    }
  });

  it('distinguishes an empty candidate list from an all-rejected one', () => {
    // 空候选表是编排错误（在没候选的情况下问「选哪个」），`tried` 是 0。
    try {
      selectPlacement([] as readonly Candidate[], () => true);
      expect.unreachable('empty candidate list must throw');
    } catch (error) {
      expect((error as NoAcceptablePlacementError).tried).toBe(0);
      expect((error as Error).message).toContain('no candidates');
    }
    // 显式 fallback 时空表也不该炸——那是「允许没有候选」的合法用法。
    expect(selectPlacement([] as readonly Candidate[], () => true, { fallback: a }).chosen)
      .toBe(a);
  });

  it('passes the candidate index to the predicate and the reject hook', () => {
    // 下标必须是真的下标：polar 侧要靠它把拒绝原因映射回 candidates 里的一员。
    const seen: number[] = [];
    const rejected: [string, number][] = [];
    const choice = selectPlacement([a, b, c], (candidate, index) => {
      seen.push(index);
      return candidate.id === 'b';
    }, {
      onReject: (candidate, index) => { rejected.push([candidate.id, index]); },
    });
    expect(choice.chosen).toBe(b);
    expect(seen).toEqual([0, 1]);
    // 被接受的那个不进 onReject。
    expect(rejected).toEqual([['a', 0]]);
  });

  it('does not mutate the candidate list', () => {
    const candidates = [a, b, c];
    const snapshot = [...candidates];
    selectPlacement(candidates, (candidate) => candidate.id === 'c');
    expect(candidates).toEqual(snapshot);
    expect(candidates[0]).toBe(a);
  });

  it('works with candidates that carry a screen bounds, which is what both callers pass', () => {
    // 结构化最小接口：只要 `bounds` 能算出屏幕位置，判据就能基于它。
    // 这条同时钉住「不依赖 polar 的 PolarCandidate 字段」。
    type WithBounds = Readonly<{
      bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>;
    const inside: WithBounds = { bounds: { x: 0, y: 0, width: 10, height: 10 } };
    const outside: WithBounds = { bounds: { x: 900, y: 900, width: 10, height: 10 } };
    const viewport = { x: 0, y: 0, width: 800, height: 600 };
    const fits = (candidate: WithBounds): boolean => {
      const { x, y, width, height } = candidate.bounds;
      return x >= viewport.x && y >= viewport.y
        && x + width <= viewport.x + viewport.width
        && y + height <= viewport.y + viewport.height;
    };
    const choice = selectPlacement([outside, inside], fits);
    expect(choice.chosen).toBe(inside);
    expect(choice.index).toBe(1);
    expect(choice.outcome).toBe('accepted');
  });

  it('never calls the reject hook for an accepted first candidate', () => {
    const onReject = vi.fn();
    selectPlacement([a], () => true, { onReject });
    expect(onReject).not.toHaveBeenCalled();
  });
});
