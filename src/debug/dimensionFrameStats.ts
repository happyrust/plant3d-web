import type { DimensionFrameBreakdown } from '@/dimension/viewport/dimensionViewport';

/**
 * 尺寸视口逐帧耗时的只读观测（W4-1 性能基线，
 * `docs/verification/mbd-perf-baseline-2026-10-29/README.md`）。
 *
 * 宿主把 `record` 交给 `createDimensionSystem({ onFrame })`；环形缓冲只留最近
 * `capacity` 帧，`summary()` 按最近邻秩取分位，与 `dimensionPerf.ts` /
 * `benchKernel.ts` 同一口径。它不碰布局与绘制：有没有这个钩子，视口每一步都一样。
 */
export type DimensionFrameSample = Readonly<{
  /** 整帧耗时：全量布局 + 绘制，或一次增量样式更新 */
  frameMs: number;
  /** 全量布局耗时；增量帧（只改样式 / 相机未换 projector）为 0 */
  layoutMs: number;
  paintMs: number;
}>;

export type DimensionFrameQuantiles = Readonly<{
  p50: number;
  p95: number;
  max: number;
}>;

export type DimensionFrameSummary = Readonly<{
  /** 缓冲里现有的帧数（≤ capacity） */
  frames: number;
  /** 其中跑了全量布局（`layoutMs > 0`）的帧数 */
  layoutFrames: number;
  frameMs: DimensionFrameQuantiles;
  /** 只统计全量布局帧；增量帧的 0 不拉低分位 */
  layoutMs: DimensionFrameQuantiles;
  paintMs: DimensionFrameQuantiles;
}>;

export type DimensionFrameRecorder = Readonly<{
  /** 形状与 `DimensionViewportInput.onFrame` 相同，可以直接当回调传 */
  record: (durationMs: number, breakdown: DimensionFrameBreakdown) => void;
  summary: () => DimensionFrameSummary;
  /** 按时间顺序（最老在前）的样本副本 */
  samples: () => readonly DimensionFrameSample[];
  reset: () => void;
}>;

/** 最近邻秩分位（`dimensionPerf.ts` / `benchKernel.ts` 同款）；空数组给 0。 */
export function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function quantiles(values: readonly number[]): DimensionFrameQuantiles {
  let max = 0;
  for (const value of values) {
    if (value > max) max = value;
  }
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max,
  };
}

/** `capacity` 缺省 600 帧 ≈ 60 fps 下 10 s，正好装下基线脚本的一圈绕轨。 */
export function createDimensionFrameRecorder(capacity = 600): DimensionFrameRecorder {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  }
  const buffer: DimensionFrameSample[] = [];
  /** 缓冲装满后下一帧要覆盖的位置 = 最老的样本 */
  let next = 0;

  const samples = (): readonly DimensionFrameSample[] =>
    [...buffer.slice(next), ...buffer.slice(0, next)];

  return {
    record: (durationMs, breakdown) => {
      const sample: DimensionFrameSample = {
        frameMs: durationMs,
        layoutMs: breakdown.layoutMs,
        paintMs: breakdown.paintMs,
      };
      if (buffer.length < capacity) {
        buffer.push(sample);
        return;
      }
      buffer[next] = sample;
      next = (next + 1) % capacity;
    },
    summary: () => {
      const all = samples();
      const layoutFrames = all.filter(sample => sample.layoutMs > 0);
      return {
        frames: all.length,
        layoutFrames: layoutFrames.length,
        frameMs: quantiles(all.map(sample => sample.frameMs)),
        layoutMs: quantiles(layoutFrames.map(sample => sample.layoutMs)),
        paintMs: quantiles(all.map(sample => sample.paintMs)),
      };
    },
    samples,
    reset: () => {
      buffer.length = 0;
      next = 0;
    },
  };
}
