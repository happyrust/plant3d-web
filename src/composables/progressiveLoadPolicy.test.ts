import { describe, expect, it } from 'vitest';

import {
  PROGRESSIVE_COST_MULTIPLE,
  PROGRESSIVE_MIN_INTERVAL_MS,
  progressiveBatchWaitMs,
  shouldLoadProgressiveBatch,
} from './progressiveLoadPolicy';

describe('边取边画的装载节奏（shouldLoadProgressiveBatch）', () => {
  it('没有攒着的构件就不装', () => {
    expect(shouldLoadProgressiveBatch({ pending: 0, loaded: 0, sinceLastBatchMs: 9999, lastBatchMs: 0 })).toBe(false);
    expect(progressiveBatchWaitMs({ pending: 0, loaded: 500, sinceLastBatchMs: 0, lastBatchMs: 10 })).toBeNull();
  });

  it('第一批立刻装：先出图', () => {
    expect(shouldLoadProgressiveBatch({ pending: 1, loaded: 0, sinceLastBatchMs: 0, lastBatchMs: 0 })).toBe(true);
  });

  it('之后攒够不少于已装的数量才装（翻倍）', () => {
    expect(shouldLoadProgressiveBatch({ pending: 999, loaded: 1000, sinceLastBatchMs: 10, lastBatchMs: 20 })).toBe(false);
    expect(shouldLoadProgressiveBatch({ pending: 1000, loaded: 1000, sinceLastBatchMs: 10, lastBatchMs: 20 })).toBe(true);
  });

  it('攒不够翻倍，但离上一批装完够久了也装一次：至少 0.5 秒', () => {
    const base = { pending: 10, loaded: 1000, lastBatchMs: 20 };
    expect(shouldLoadProgressiveBatch({ ...base, sinceLastBatchMs: PROGRESSIVE_MIN_INTERVAL_MS - 1 })).toBe(false);
    expect(shouldLoadProgressiveBatch({ ...base, sinceLastBatchMs: PROGRESSIVE_MIN_INTERVAL_MS })).toBe(true);
  });

  it('上一批装得慢（大场景），间隔跟着拉长：装载占主线程的份额有上限', () => {
    const base = { pending: 10, loaded: 40_000, lastBatchMs: 400 };
    const needed = PROGRESSIVE_COST_MULTIPLE * 400;
    expect(needed).toBeGreaterThan(PROGRESSIVE_MIN_INTERVAL_MS);
    expect(shouldLoadProgressiveBatch({ ...base, sinceLastBatchMs: needed - 1 })).toBe(false);
    expect(shouldLoadProgressiveBatch({ ...base, sinceLastBatchMs: needed })).toBe(true);
  });

  it('progressiveBatchWaitMs：还差多久到下一次按时间装的时刻；已经该装了是 0', () => {
    expect(progressiveBatchWaitMs({ pending: 10, loaded: 1000, sinceLastBatchMs: 100, lastBatchMs: 20 })).toBe(PROGRESSIVE_MIN_INTERVAL_MS - 100);
    expect(progressiveBatchWaitMs({ pending: 10, loaded: 40_000, sinceLastBatchMs: 100, lastBatchMs: 400 })).toBe(PROGRESSIVE_COST_MULTIPLE * 400 - 100);
    expect(progressiveBatchWaitMs({ pending: 10, loaded: 0, sinceLastBatchMs: 0, lastBatchMs: 0 })).toBe(0);
    expect(progressiveBatchWaitMs({ pending: 2000, loaded: 1000, sinceLastBatchMs: 0, lastBatchMs: 50 })).toBe(0);
  });

  it('按「到一个算一个」的节奏推演：79,000 个构件匀速到达时，批数是对数级的，不是每个成员一批', () => {
    // 531 个成员、每个约 149 个构件、每 19 ms 到一个（约 10 s 收完）；每批耗时按已装数量的 0.005 ms/个 估（8 万件约 400 ms）
    let loaded = 0;
    let pending = 0;
    let clock = 0;
    let lastEnd = 0;
    let lastMs = 0;
    let batches = 0;
    for (let member = 0; member < 531; member++) {
      clock += 19;
      pending += 149;
      if (shouldLoadProgressiveBatch({ pending, loaded, sinceLastBatchMs: clock - lastEnd, lastBatchMs: lastMs })) {
        loaded += pending;
        pending = 0;
        lastMs = Math.max(5, loaded * 0.005);
        clock += lastMs;
        lastEnd = clock;
        batches++;
      }
    }
    expect(batches).toBeGreaterThanOrEqual(5);
    expect(batches).toBeLessThanOrEqual(20);
  });
});
