import { describe, expect, it } from 'vitest';

import {
  FRAME_BUDGET_MIN_SAMPLES,
  FRAME_BUDGET_WINDOW,
  REFRESH_MS_MAX,
  REFRESH_MS_MIN,
  createFrameBudgetState,
  frameBudgetP90,
  frameSampleMs,
  medianRefreshMs,
  probeRefreshMs,
  resetFrameBudget,
  stepFrameBudget,
  type FrameBudgetState,
} from './frameBudget';

function feed(state: FrameBudgetState, values: number[]): FrameBudgetState {
  let s = state;
  for (const v of values) s = stepFrameBudget(s, { frameMs: v, interacting: true }).state;
  return s;
}

describe('frameBudgetP90', () => {
  it('空窗口返回 null', () => {
    expect(frameBudgetP90(createFrameBudgetState())).toBeNull();
  });

  it('取 nearest-rank 的 p90：20 个样本允许 2 个尖峰', () => {
    const state = feed(createFrameBudgetState(), [...Array(18).fill(10), 100, 200]);
    expect(state.count).toBe(20);
    expect(frameBudgetP90(state)).toBe(10);
  });

  it('样本少时按实际个数算', () => {
    const state = feed(createFrameBudgetState(), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    // floor(0.9 * (10 - 1)) = 8 → 第 9 小的样本
    expect(frameBudgetP90(state)).toBe(13);
  });
});

describe('stepFrameBudget', () => {
  it('交互中逐帧记样本，够 5 帧才算 settled', () => {
    let state = createFrameBudgetState();
    for (let i = 1; i <= FRAME_BUDGET_MIN_SAMPLES; i += 1) {
      const step = stepFrameBudget(state, { frameMs: 10, interacting: true });
      state = step.state;
      expect(step.samples).toBe(i);
      expect(step.settled).toBe(i >= FRAME_BUDGET_MIN_SAMPLES);
    }
  });

  it('环形缓冲只保留最近 N 帧', () => {
    let state = feed(createFrameBudgetState(), Array(FRAME_BUDGET_WINDOW).fill(10));
    // 再喂 5 帧 100ms，窗口里应有 15 个 10 与 5 个 100 → p90 = 100
    state = feed(state, Array(5).fill(100));
    expect(state.count).toBe(FRAME_BUDGET_WINDOW);
    expect(frameBudgetP90(state)).toBe(100);
  });

  it('非交互帧清空窗口', () => {
    const state = feed(createFrameBudgetState(), [10, 20, 30]);
    const step = stepFrameBudget(state, { frameMs: 10, interacting: false });
    expect(step.samples).toBe(0);
    expect(step.p90).toBeNull();
    expect(step.settled).toBe(false);
    expect(step.state.count).toBe(0);
  });

  it('非法耗时当作非交互，清空窗口', () => {
    const state = feed(createFrameBudgetState(), [10, 20, 30]);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const step = stepFrameBudget(state, { frameMs: bad, interacting: true });
      expect(step.samples).toBe(0);
      expect(step.state.count).toBe(0);
    }
  });

  it('resetFrameBudget 保留窗口长度', () => {
    const state = feed(createFrameBudgetState(), [10, 20]);
    const cleared = resetFrameBudget(state);
    expect(cleared.samples.length).toBe(FRAME_BUDGET_WINDOW);
    expect(cleared.count).toBe(0);
    expect(cleared.next).toBe(0);
  });

  it('不修改入参状态', () => {
    const state = feed(createFrameBudgetState(), [10, 20]);
    const before = [...state.samples];
    stepFrameBudget(state, { frameMs: 30, interacting: true });
    expect(state.samples).toEqual(before);
    expect(state.count).toBe(2);
  });
});

describe('frameSampleMs', () => {
  it('上一帧画完就排了下一帧：CPU 耗时与出帧间隔取大', () => {
    // GPU 跟不上：CPU 只花 6ms，但下一帧 33ms 后才开始
    expect(frameSampleMs({ start: 100, cpuMs: 6, scheduledNext: true }, 133.3)).toBeCloseTo(33.3);
    // CPU 本身就慢
    expect(frameSampleMs({ start: 100, cpuMs: 40, scheduledNext: true }, 116.7)).toBe(40);
  });

  it('上一帧之后空闲过（没排下一帧）只用 CPU 耗时', () => {
    expect(frameSampleMs({ start: 100, cpuMs: 6, scheduledNext: false }, 2100)).toBe(6);
  });

  it('只用 CPU 口径时忽略间隔', () => {
    expect(frameSampleMs({ start: 100, cpuMs: 6, scheduledNext: true }, 133.3, false)).toBe(6);
  });

  it('没有上一帧或 CPU 耗时非法返回 null，时钟倒退只用 CPU 耗时', () => {
    expect(frameSampleMs(null, 100)).toBeNull();
    expect(frameSampleMs({ start: 100, cpuMs: Number.NaN, scheduledNext: true }, 120)).toBeNull();
    expect(frameSampleMs({ start: 100, cpuMs: -1, scheduledNext: true }, 120)).toBeNull();
    expect(frameSampleMs({ start: 100, cpuMs: 6, scheduledNext: true }, 90)).toBe(6);
  });
});

describe('medianRefreshMs', () => {
  const stamps = (period: number, n: number) => Array.from({ length: n }, (_, i) => i * period);

  it('60Hz / 120Hz / 30Hz 取到对应的刷新周期', () => {
    expect(medianRefreshMs(stamps(16.67, 21))).toBeCloseTo(16.67, 1);
    expect(medianRefreshMs(stamps(8.33, 21))).toBeCloseTo(8.33, 1);
    expect(medianRefreshMs(stamps(33.33, 21))).toBeCloseTo(33.33, 1);
  });

  it('个别回调被拖长不影响中位数', () => {
    const late = stamps(16.67, 21).map((t, i) => (i >= 10 ? t + 16.67 : t));
    expect(medianRefreshMs(late)).toBeCloseTo(16.67, 1);
  });

  it('夹在 [REFRESH_MS_MIN, REFRESH_MS_MAX]，没有有效间隔返回 null', () => {
    expect(medianRefreshMs(stamps(1, 10))).toBe(REFRESH_MS_MIN);
    expect(medianRefreshMs(stamps(100, 10))).toBe(REFRESH_MS_MAX);
    expect(medianRefreshMs([])).toBeNull();
    expect(medianRefreshMs([5])).toBeNull();
    expect(medianRefreshMs([5, 5, 5])).toBeNull();
  });
});

describe('probeRefreshMs', () => {
  /** 假的 rAF：每次调用排一个回调，flush 时按固定周期推进时钟依次执行 */
  function fakeFrames(period: number) {
    let now = 0;
    const queue: ((time: number) => void)[] = [];
    return {
      requestFrame: (callback: (time: number) => void) => {
        queue.push(callback);
      },
      flush() {
        while (queue.length > 0) {
          now += period;
          queue.shift()!(now);
        }
      },
    };
  }

  it('连挂 count 个空帧，返回间隔中位数', async () => {
    const frames = fakeFrames(33.33);
    const probe = probeRefreshMs(frames.requestFrame, { count: 10 });
    frames.flush();
    expect(await probe).toBeCloseTo(33.33, 1);
  });

  it('探测期间出了帧就作废，返回 null', async () => {
    const frames = fakeFrames(16.67);
    let rendered = 0;
    const probe = probeRefreshMs(frames.requestFrame, { count: 10, busy: () => rendered > 0 });
    rendered = 1;
    frames.flush();
    expect(await probe).toBeNull();
  });
});
