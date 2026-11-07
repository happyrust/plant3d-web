import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DOWNGRADE_RATIO,
  DEFAULT_FRAME_BUDGET_MS,
  DEFAULT_WARM_START_MS,
  DRAG_DOWNGRADE_GRACE_MS,
  createDragDowngradeState,
  effectiveBudgetMs,
  isDragDowngradeEnabled,
  readDragDowngradeOptions,
  readFrameMetric,
  stepDragDowngrade,
  type DragDowngradeInput,
  type DragDowngradeOptions,
  type DragDowngradeState,
  type SglDowngradeLevel,
} from './dragDowngrade';

const base: DragDowngradeInput = {
  enabled: true,
  pipelineActive: true,
  held: false,
  cameraMoving: true,
  frameMs: null,
  now: 0,
};

interface Frame {
  ms?: number | null;
  at: number;
  cameraMoving?: boolean;
  held?: boolean;
  enabled?: boolean;
  pipelineActive?: boolean;
  floorLevel?: SglDowngradeLevel;
  refreshMs?: number | null;
}

/** 按给定帧序列推进状态，返回每步结果 */
function run(
  frames: Frame[],
  start: DragDowngradeState = createDragDowngradeState(),
  options: Partial<DragDowngradeOptions> = {},
) {
  let state = start;
  return frames.map((f) => {
    const step = stepDragDowngrade(
      state,
      {
        ...base,
        frameMs: f.ms === undefined ? null : f.ms,
        now: f.at,
        cameraMoving: f.cameraMoving ?? true,
        held: f.held ?? false,
        enabled: f.enabled ?? true,
        pipelineActive: f.pipelineActive ?? true,
        ...(f.floorLevel !== undefined ? { floorLevel: f.floorLevel } : {}),
        ...(f.refreshMs !== undefined ? { refreshMs: f.refreshMs } : {}),
      },
      options,
    );
    state = step.state;
    return step;
  });
}

/** 连续 n 帧都耗时 `ms`，时间步进按 16ms */
function steady(n: number, ms: number | null, startAt = 0): Frame[] {
  return Array.from({ length: n }, (_, i) => ({ ms, at: startAt + i * 16 }));
}

/** 用 40ms 一帧拖到 L2，返回最后的状态和最后一帧的时间 */
function dragToL2(options: Partial<DragDowngradeOptions> = {}) {
  const frames = steady(30, 40);
  const steps = run(frames, createDragDowngradeState(), options);
  return { state: steps[steps.length - 1]!.state, lastAt: frames[frames.length - 1]!.at };
}

/** 停手到宽限期满，返回回 L0 那一步 */
function release(state: DragDowngradeState, lastAt: number, options: Partial<DragDowngradeOptions> = {}) {
  const at = lastAt + DRAG_DOWNGRADE_GRACE_MS;
  const step = stepDragDowngrade(state, { ...base, cameraMoving: false, now: at }, options);
  return { step, state: step.state, at };
}

/**
 * 模拟连续拖动：各档实际耗时不同，样本取上一帧所在档位的耗时，
 * 帧间隔取 max(耗时, 16.7ms)（60Hz 垂直同步）。
 */
function simulateDrag(costs: readonly [number, number, number], durationMs: number) {
  let state = createDragDowngradeState();
  let t = 0;
  let sample: number | null = null;
  const levels: SglDowngradeLevel[] = [];
  while (t < durationMs) {
    const step = stepDragDowngrade(state, { ...base, frameMs: sample, now: t });
    state = step.state;
    levels.push(step.level);
    sample = costs[step.level];
    t += Math.max(costs[step.level], 16.7);
  }
  return { levels, state };
}

describe('stepDragDowngrade 三档', () => {
  it('轻场景（帧耗时在预算内）全程停在 L0', () => {
    const steps = run(steady(60, 8));
    expect(steps.every((s) => s.level === 0)).toBe(true);
    expect(steps.some((s) => s.changed)).toBe(false);
  });

  it('样本不足 5 帧不作判断', () => {
    const steps = run(steady(4, 40));
    expect(steps.every((s) => s.level === 0)).toBe(true);
  });

  it('重场景逐级升档，每帧最多升一档', () => {
    // 40ms 远超 16.7 × 1.3 ≈ 21.7ms
    const steps = run(steady(30, 40));
    expect(steps[3]!.level).toBe(0); // 前 4 帧样本不足
    expect(steps[4]!.level).toBe(1); // 第 5 帧够样本，升到 L1
    expect(steps[4]!.changed).toBe(true);
    expect(steps[8]!.level).toBe(1); // 升档后窗口清空，需重新累计 5 帧
    expect(steps[9]!.level).toBe(2);
    expect(steps.slice(10).every((s) => s.level === 2)).toBe(true);
  });

  it('L1 保留法线/深度：sglFramePasses 仍开 normalDepth（由 sglFramePasses 测试覆盖档位表）', () => {
    const steps = run(steady(30, 40));
    expect(steps[9]!.level).toBe(2);
  });

  it('升档阈值来自 options.budgetMs × upRatio', () => {
    const options = { budgetMs: 10, upRatio: 2 }; // 阈值 20ms
    const steps = run(steady(12, 15), createDragDowngradeState(), options);
    expect(steps.every((s) => s.level === 0)).toBe(true);
    const heavy = run(steady(12, 25), createDragDowngradeState(), options);
    expect(heavy.some((s) => s.level === 1)).toBe(true);
  });

  it('降到 L2 后不再继续升档', () => {
    const steps = run(steady(40, 200));
    expect(steps.every((s) => s.level <= 2)).toBe(true);
    expect(steps[steps.length - 1]!.level).toBe(2);
  });
});

describe('stepDragDowngrade 交互内只升不降', () => {
  it('耗时回落也不回升，flips 记本次交互的升档次数', () => {
    const { state } = dragToL2();
    expect(state.level).toBe(2);
    expect(state.flips).toBe(2);
    const steps = run(steady(300, 10, 1000), state);
    expect(steps.every((s) => s.level === 2 && !s.changed)).toBe(true);
    expect(steps[steps.length - 1]!.state.flips).toBe(2);
  });

  it('L0 下低耗时不会误升档，也不报 changed', () => {
    const steps = run(steady(60, 10));
    expect(steps.every((s) => !s.changed)).toBe(true);
  });

  it.each([
    { costs: [25, 15, 10] as const, settle: 1 },
    { costs: [30, 20, 12] as const, settle: 1 },
    { costs: [40, 30, 17] as const, settle: 2 },
  ])('耗时随档位变化（$costs）时连续拖 5 秒不来回跳', ({ costs, settle }) => {
    const { levels, state } = simulateDrag(costs, 5000);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);
    }
    expect(levels[levels.length - 1]).toBe(settle);
    expect(state.flips).toBe(settle);
  });
});

describe('stepDragDowngrade 交互结束', () => {
  it('停手后宽限 200ms 回到 L0，并只报一次 restored', () => {
    const { state, lastAt } = dragToL2();
    const steps = run(
      [
        { at: lastAt + 100, cameraMoving: false },
        { at: lastAt + DRAG_DOWNGRADE_GRACE_MS, cameraMoving: false },
        { at: lastAt + DRAG_DOWNGRADE_GRACE_MS + 200, cameraMoving: false },
      ],
      state,
    );
    expect(steps[0]!.level).toBe(2);
    expect(steps[0]!.restoreAt).toBe(lastAt + DRAG_DOWNGRADE_GRACE_MS);
    expect(steps[1]!.level).toBe(0);
    expect(steps[1]!.restored).toBe(true);
    expect(steps[2]!.restored).toBe(false);
    expect(steps[2]!.restoreAt).toBeNull();
  });

  it('宽限期内又动了，档位保持、仍算同一次交互', () => {
    const { state, lastAt } = dragToL2();
    const steps = run(
      [
        { at: lastAt + 100, cameraMoving: false },
        { at: lastAt + 150, ms: 10 },
      ],
      state,
    );
    expect(steps[1]!.level).toBe(2);
    expect(steps[1]!.changed).toBe(false);
    expect(steps[1]!.state.flips).toBe(2);
  });

  it('降级中按着不动保持当前档位（不因为停下就恢复）', () => {
    const { state } = dragToL2();
    const steps = run([{ at: 2000, cameraMoving: false, held: true }], state);
    expect(steps[0]!.level).toBe(2);
    expect(steps[0]!.restoreAt).toBeNull();
  });

  it('只按着不动（从未降级）不升档', () => {
    const steps = run(steady(40, 40).map((f) => ({ ...f, cameraMoving: false, held: true })));
    expect(steps.every((s) => s.level === 0)).toBe(true);
  });

  it('静止时清空采样窗口', () => {
    let state = createDragDowngradeState();
    for (const f of steady(6, 10)) {
      state = stepDragDowngrade(state, { ...base, frameMs: f.ms!, now: f.at }).state;
    }
    expect(state.budget.count).toBe(6);
    const step = stepDragDowngrade(state, { ...base, cameraMoving: false, now: 500 });
    expect(step.state.budget.count).toBe(0);
  });

  it('L0 停手立即结束这次交互，不等宽限也不报 restored', () => {
    const steps = run([...steady(6, 10), { at: 200, cameraMoving: false }]);
    const last = steps[steps.length - 1]!;
    expect(last.state.inGesture).toBe(false);
    expect(last.restored).toBe(false);
    expect(last.restoreAt).toBeNull();
  });
});

describe('stepDragDowngrade 起步档', () => {
  it('宽限结束后 warmMs 内再动，第一帧就是上次的档位', () => {
    const { state, lastAt } = dragToL2();
    const released = release(state, lastAt);
    expect(released.step.restored).toBe(true);
    expect(released.state.warmLevel).toBe(2);

    const again = stepDragDowngrade(released.state, { ...base, frameMs: 12, now: released.at + 1000 });
    expect(again.level).toBe(2);
    expect(again.changed).toBe(true);
    expect(again.state.flips).toBe(0);
    // 这一帧的样本来自按 L0 画的静止帧，不计入 L2 的窗口
    expect(again.state.budget.count).toBe(0);
  });

  it('超过 warmMs 从 L0 重新试', () => {
    const { state, lastAt } = dragToL2();
    const released = release(state, lastAt);
    const again = stepDragDowngrade(released.state, {
      ...base,
      frameMs: 12,
      now: released.at + DEFAULT_WARM_START_MS + 1,
    });
    expect(again.level).toBe(0);
    expect(again.state.budget.count).toBe(1);
  });

  it('warmMs = 0 时每次都从 L0 起步', () => {
    const options = { warmMs: 0 };
    const { state, lastAt } = dragToL2(options);
    const released = release(state, lastAt, options);
    expect(released.step.level).toBe(0);
    const again = stepDragDowngrade(released.state, { ...base, now: released.at + 100 }, options);
    expect(again.level).toBe(0);
  });

  it('开关关掉再打开，不沿用起步档', () => {
    const { state, lastAt } = dragToL2();
    const released = release(state, lastAt);
    const off = stepDragDowngrade(released.state, { ...base, enabled: false, now: released.at + 100 });
    const again = stepDragDowngrade(off.state, { ...base, now: released.at + 200 });
    expect(again.level).toBe(0);
  });
});

describe('stepDragDowngrade 最低档', () => {
  it('floorLevel = 1：相机一动就是 L1，松手宽限后回 L0 并报 restored', () => {
    const steps = run([
      { at: 0, floorLevel: 1 },
      { at: 16, ms: 8, floorLevel: 1 },
      { at: 32, ms: 8, floorLevel: 1, cameraMoving: false },
      { at: 16 + DRAG_DOWNGRADE_GRACE_MS, floorLevel: 1, cameraMoving: false },
    ]);
    expect(steps[0]!.level).toBe(1);
    expect(steps[0]!.changed).toBe(true);
    expect(steps[1]!.level).toBe(1);
    expect(steps[2]!.level).toBe(1);
    expect(steps[2]!.restoreAt).toBe(16 + DRAG_DOWNGRADE_GRACE_MS);
    expect(steps[3]!.level).toBe(0);
    expect(steps[3]!.restored).toBe(true);
  });

  it('floorLevel = 1 时耗时超标仍会升到 L2', () => {
    const steps = run(steady(12, 40).map((f) => ({ ...f, floorLevel: 1 as const })));
    expect(steps[0]!.level).toBe(1);
    expect(steps[steps.length - 1]!.level).toBe(2);
  });
});

describe('stepDragDowngrade 有效预算', () => {
  it('refreshMs = 33.3（被限到 30Hz）时 34ms 一帧不算掉帧', () => {
    const capped = run(steady(30, 34).map((f) => ({ ...f, refreshMs: 33.3 })));
    expect(capped.every((s) => s.level === 0)).toBe(true);
    const uncapped = run(steady(30, 34));
    expect(uncapped[uncapped.length - 1]!.level).toBe(2);
  });

  it('refreshMs 比预算短（120Hz）或非法时按预算算', () => {
    expect(effectiveBudgetMs(16.7, 8.3)).toBe(16.7);
    expect(effectiveBudgetMs(16.7, 33.3)).toBe(33.3);
    expect(effectiveBudgetMs(16.7, null)).toBe(16.7);
    expect(effectiveBudgetMs(16.7, undefined)).toBe(16.7);
    expect(effectiveBudgetMs(16.7, Number.NaN)).toBe(16.7);
    expect(effectiveBudgetMs(16.7, 0)).toBe(16.7);
  });
});

describe('stepDragDowngrade 开关与管线', () => {
  it('开关关闭时始终 L0；降级中关掉立刻恢复', () => {
    const off = run(steady(20, 40).map((f) => ({ ...f, enabled: false })));
    expect(off.every((s) => s.level === 0 && !s.restored)).toBe(true);

    const { state } = dragToL2();
    expect(state.level).toBe(2);
    const step = stepDragDowngrade(state, { ...base, enabled: false, now: 2000 });
    expect(step.level).toBe(0);
    expect(step.restored).toBe(true);
    expect(step.changed).toBe(true);
  });

  it('档位没用处（不走管线且不裁剪）时不受影响', () => {
    const steps = run(steady(20, 40).map((f) => ({ ...f, pipelineActive: false })));
    expect(steps.every((s) => s.level === 0 && !s.restored && s.restoreAt === null)).toBe(true);
  });
});

describe('stepDragDowngrade 采样', () => {
  it('早退帧（frameMs = null）不记样本也不清窗口', () => {
    let state = createDragDowngradeState();
    for (const f of steady(5, 10)) {
      state = stepDragDowngrade(state, { ...base, frameMs: f.ms!, now: f.at }).state;
    }
    expect(state.budget.count).toBe(5);
    const step = stepDragDowngrade(state, { ...base, frameMs: null, now: 500 });
    expect(step.state.budget.count).toBe(5);
    expect(step.p90).not.toBeNull();
  });

  it('升档后清空窗口，避免旧样本继续判断', () => {
    let state = createDragDowngradeState();
    let upgradedAt = -1;
    for (const f of steady(30, 40)) {
      const step = stepDragDowngrade(state, { ...base, frameMs: f.ms!, now: f.at });
      state = step.state;
      if (upgradedAt < 0 && step.changed) upgradedAt = f.at;
      if (upgradedAt === f.at && step.changed) expect(state.budget.count).toBe(0);
    }
    expect(upgradedAt).toBeGreaterThanOrEqual(0);
  });
});

describe('isDragDowngradeEnabled', () => {
  it('默认开，URL 优先于 localStorage', () => {
    expect(isDragDowngradeEnabled(new URLSearchParams(''), null)).toBe(true);
    expect(isDragDowngradeEnabled(new URLSearchParams(''), '0')).toBe(false);
    expect(isDragDowngradeEnabled(new URLSearchParams('dtx_drag_downgrade=0'), null)).toBe(false);
    expect(isDragDowngradeEnabled(new URLSearchParams('dtx_drag_downgrade=1'), '0')).toBe(true);
  });
});

describe('readDragDowngradeOptions', () => {
  it('默认预算 16.7ms、升档倍数 1.3、起步档 3 秒', () => {
    const opts = readDragDowngradeOptions(new URLSearchParams(''), () => null);
    expect(opts.budgetMs).toBe(DEFAULT_FRAME_BUDGET_MS);
    expect(opts.upRatio).toBe(DEFAULT_DOWNGRADE_RATIO);
    expect(opts.graceMs).toBe(DRAG_DOWNGRADE_GRACE_MS);
    expect(opts.warmMs).toBe(DEFAULT_WARM_START_MS);
  });

  it('URL 覆盖，其次 localStorage，非法值退回默认', () => {
    const store: Record<string, string> = { dtx_frame_budget_ms: '12', dtx_downgrade_ratio: '1.5' };
    const stored = (k: string) => store[k] ?? null;
    const fromStore = readDragDowngradeOptions(new URLSearchParams(''), stored);
    expect(fromStore.budgetMs).toBe(12);
    expect(fromStore.upRatio).toBe(1.5);

    const fromUrl = readDragDowngradeOptions(new URLSearchParams('dtx_frame_budget_ms=20'), stored);
    expect(fromUrl.budgetMs).toBe(20);
    expect(fromUrl.upRatio).toBe(1.5);

    const bad = readDragDowngradeOptions(
      new URLSearchParams('dtx_frame_budget_ms=abc&dtx_downgrade_ratio=-1'),
      () => null,
    );
    expect(bad.budgetMs).toBe(DEFAULT_FRAME_BUDGET_MS);
    expect(bad.upRatio).toBe(DEFAULT_DOWNGRADE_RATIO);
  });

  it('dtx_downgrade_warm_ms：0 关闭起步档，负数和空值退回默认', () => {
    const read = (q: string) => readDragDowngradeOptions(new URLSearchParams(q), () => null).warmMs;
    expect(read('dtx_downgrade_warm_ms=0')).toBe(0);
    expect(read('dtx_downgrade_warm_ms=1500')).toBe(1500);
    expect(read('dtx_downgrade_warm_ms=-1')).toBe(DEFAULT_WARM_START_MS);
    expect(read('dtx_downgrade_warm_ms=')).toBe(DEFAULT_WARM_START_MS);
  });
});

describe('readFrameMetric', () => {
  it('默认 interval，cpu 可由 URL 或 localStorage 打开，URL 优先', () => {
    expect(readFrameMetric(new URLSearchParams(''), () => null)).toBe('interval');
    expect(readFrameMetric(new URLSearchParams('dtx_frame_metric=cpu'), () => null)).toBe('cpu');
    expect(readFrameMetric(new URLSearchParams(''), (k) => (k === 'dtx_frame_metric' ? 'CPU' : null))).toBe('cpu');
    expect(readFrameMetric(new URLSearchParams('dtx_frame_metric=interval'), () => 'cpu')).toBe('interval');
  });
});
