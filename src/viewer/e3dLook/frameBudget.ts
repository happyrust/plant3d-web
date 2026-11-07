/**
 * 交互帧耗时采样（E3D 外观管线降画质判定用）。
 *
 * 环形缓冲保存最近 N 帧的渲染耗时，按 **p90** 判断该不该降画质：用 p90 而不是均值，
 * 偶发一帧尖峰（GC、纹理上传、浏览器合成）不该把画质拉低一档。
 * 样本口径见 `frameSampleMs`（CPU 耗时与出帧间隔取大），刷新周期见 `probeRefreshMs`。
 *
 * 纯函数、无副作用、不碰 DOM（rAF 由调用方注入），方便单测。
 */

/** 窗口大小：60fps 下约 0.33 s，场景突变时的反应延迟可以接受 */
export const FRAME_BUDGET_WINDOW = 20;

/** 少于这么多帧不作判断，保持当前档位 */
export const FRAME_BUDGET_MIN_SAMPLES = 5;

export interface FrameBudgetState {
  /** 环形缓冲（定长，未写入的位置是 null） */
  readonly samples: readonly (number | null)[];
  /** 下一个写入位置 */
  readonly next: number;
  /** 当前有效样本数（0..窗口大小） */
  readonly count: number;
}

export interface FrameBudgetSample {
  /** 本帧渲染耗时（ms） */
  frameMs: number;
  /** 只有交互（相机在动、真的画了帧）才记样本；false 会清空窗口 */
  interacting: boolean;
}

export interface FrameBudgetStep {
  state: FrameBudgetState;
  /** 窗口内耗时的 p90（ms）；没有样本为 null */
  p90: number | null;
  /** 当前有效样本数 */
  samples: number;
  /** 样本够不够做判断（>= FRAME_BUDGET_MIN_SAMPLES） */
  settled: boolean;
}

export function createFrameBudgetState(window = FRAME_BUDGET_WINDOW): FrameBudgetState {
  const size = Math.max(1, Math.floor(window));
  return { samples: new Array<number | null>(size).fill(null), next: 0, count: 0 };
}

/** 清空窗口（保留缓冲长度） */
export function resetFrameBudget(state: FrameBudgetState): FrameBudgetState {
  return { samples: state.samples.map(() => null), next: 0, count: 0 };
}

/**
 * 窗口内耗时的 p90（nearest-rank，按 (n-1) 取整）。
 * N=20 时取第 18 小的样本，允许 2 个尖峰不影响判定；样本只有 5 个时取第 4 小，
 * 也仍能容忍 1 个尖峰（若按 ceil(0.9·n) 取，5 个样本会退化成取最大值）。
 */
export function frameBudgetP90(state: FrameBudgetState): number | null {
  const values: number[] = [];
  for (const v of state.samples) {
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const rank = Math.floor(0.9 * (values.length - 1));
  return values[Math.min(values.length - 1, Math.max(0, rank))]!;
}

/**
 * 喂一帧样本。非交互 / 非法耗时直接清空窗口并返回空结果，
 * 这样「停下再动」时不会拿静止前的旧样本继续判断。
 */
export function stepFrameBudget(prev: FrameBudgetState, sample: FrameBudgetSample): FrameBudgetStep {
  if (!sample.interacting || !Number.isFinite(sample.frameMs) || sample.frameMs < 0) {
    return { state: resetFrameBudget(prev), p90: null, samples: 0, settled: false };
  }
  const samples = prev.samples.slice();
  samples[prev.next] = sample.frameMs;
  const state: FrameBudgetState = {
    samples,
    next: (prev.next + 1) % samples.length,
    count: Math.min(samples.length, prev.count + 1),
  };
  return {
    state,
    p90: frameBudgetP90(state),
    samples: state.count,
    settled: state.count >= FRAME_BUDGET_MIN_SAMPLES,
  };
}

/** 一帧的出帧记录，用来算「这一帧实际占了多久」 */
export interface FrameTiming {
  /** 这一帧开始画的时间戳（ms） */
  start: number;
  /** 从进入渲染到画完，CPU 上花的时间（ms） */
  cpuMs: number;
  /** 画完时下一帧已经排上（相机还在动 / 持续渲染）；没排上说明之后空闲过，间隔不算数 */
  scheduledNext: boolean;
}

/**
 * 上一帧的耗时样本（ms）：CPU 耗时与「上一帧开始 → 本帧开始」的出帧间隔取大。
 *
 * WebGL 异步执行，CPU 计时看不到 GPU 上的开销（AO / HLR 全屏趟）；GPU 跟不上时浏览器会推迟
 * 下一次 rAF，出帧间隔随之变长，所以要把间隔算进去。只有上一帧画完就排了下一帧，间隔才代表
 * 它的真实耗时；否则（中间空闲过）只用 CPU 耗时。`useInterval = false` 时始终只用 CPU 耗时。
 */
export function frameSampleMs(prev: FrameTiming | null, start: number, useInterval = true): number | null {
  if (prev === null || !Number.isFinite(prev.cpuMs) || prev.cpuMs < 0) return null;
  if (!useInterval || !prev.scheduledNext) return prev.cpuMs;
  const interval = start - prev.start;
  if (!Number.isFinite(interval) || interval < 0) return prev.cpuMs;
  return Math.max(prev.cpuMs, interval);
}

/** 刷新周期的合理范围（ms）：250Hz ~ 20Hz */
export const REFRESH_MS_MIN = 4;
export const REFRESH_MS_MAX = 50;

/** 一串 rAF 时间戳相邻间隔的中位数（ms），夹在合理范围内；没有有效间隔返回 null */
export function medianRefreshMs(stamps: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const gap = stamps[i]! - stamps[i - 1]!;
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return Math.min(REFRESH_MS_MAX, Math.max(REFRESH_MS_MIN, median));
}

export interface RefreshProbeOptions {
  /** 量多少个间隔，默认 20 */
  count?: number;
  /** 返回 true 表示探测期间出了帧（间隔被渲染拖长），本次作废 */
  busy?: () => boolean;
}

/**
 * 量显示器刷新周期（ms）：连挂 `count` 个空 rAF，取相邻回调间隔的中位数。
 * 笔记本省电模式、部分远程桌面会把页面限到 30Hz，这时 33ms 一帧是刷新上限而不是掉帧。
 * 要在视口空闲时量；期间 `busy()` 为 true 就作废，返回 null。
 */
export function probeRefreshMs(
  requestFrame: (callback: (time: number) => void) => unknown,
  options: RefreshProbeOptions = {},
): Promise<number | null> {
  const count = Math.max(2, Math.floor(options.count ?? 20));
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const tick = (time: number) => {
      if (options.busy?.()) {
        resolve(null);
        return;
      }
      stamps.push(time);
      if (stamps.length > count) {
        resolve(medianRefreshMs(stamps));
        return;
      }
      requestFrame(tick);
    };
    requestFrame(tick);
  });
}
