import type { DimensionFrameBreakdown, DimensionFrameKind } from '@/dimension/viewport/dimensionViewport';

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
  /** 视口原样报来的值：`layout` 帧只含 `scenePainter.paint`，`style` / `camera` 帧是整帧 */
  paintMs: number;
  /**
   * 帧来源。老调用方（只传两个耗时的 breakdown）不给，此时按 `layoutMs > 0` 推断；
   * 视口自己总是给，所以 `kind === 'layout'` 才是判定全量帧的准绳。
   */
  kind?: DimensionFrameKind;
}>;

export type DimensionFrameQuantiles = Readonly<{
  p50: number;
  p95: number;
  max: number;
}>;

export type DimensionFrameSummary = Readonly<{
  /** 缓冲里现有的帧数（≤ capacity） */
  frames: number;
  /**
   * 其中跑了全量布局的帧数。按 `kind === 'layout'` 判（老调用方没给 kind 时退回
   * `layoutMs > 0`）：极快的全量帧 `layoutMs` 可能测得 0，按耗时会漏算。
   */
  layoutFrames: number;
  /** 各类帧的条数，三类相加等于 `frames`（没给 kind 的样本按耗时推断后计入） */
  frameKinds: Readonly<Record<DimensionFrameKind, number>>;
  frameMs: DimensionFrameQuantiles;
  /** 只统计全量布局帧；增量帧的 0 不拉低分位 */
  layoutMs: DimensionFrameQuantiles;
  /** 只统计全量布局帧：`style` / `camera` 帧的 `paintMs` 是整帧，混进来跨场景就不可比 */
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

/**
 * 一帧的来源。视口自己报的 kind 优先；老调用方只传两个耗时时，非 0 的 `layoutMs`
 * 说明跑了全量布局，否则无法区分 `style` 与 `camera`（两者都不布局），统一记 `style`。
 */
function frameKind(sample: DimensionFrameSample): DimensionFrameKind {
  if (sample.kind !== undefined) return sample.kind;
  return sample.layoutMs > 0 ? 'layout' : 'style';
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
      // 非有限值会毒化分位：NaN 让排序比较器返回 NaN（顺序不定）、`percentile` 可能
      // 返回 NaN，而 `quantiles` 的 `max` 因 `NaN > max` 恒 false 报 0。宁可不记。
      if (
        !Number.isFinite(durationMs)
        || !Number.isFinite(breakdown.layoutMs)
        || !Number.isFinite(breakdown.paintMs)
      ) {
        return;
      }
      const sample: DimensionFrameSample = {
        frameMs: durationMs,
        layoutMs: breakdown.layoutMs,
        paintMs: breakdown.paintMs,
        ...(breakdown.kind === undefined ? {} : { kind: breakdown.kind }),
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
      const layoutFrames = all.filter(sample => frameKind(sample) === 'layout');
      const frameKinds: Record<DimensionFrameKind, number> = { layout: 0, style: 0, camera: 0 };
      for (const sample of all) frameKinds[frameKind(sample)] += 1;
      return {
        frames: all.length,
        layoutFrames: layoutFrames.length,
        frameKinds,
        frameMs: quantiles(all.map(sample => sample.frameMs)),
        layoutMs: quantiles(layoutFrames.map(sample => sample.layoutMs)),
        // `style` / `camera` 帧的 `paintMs` 是整帧（后者根本没画），混进来会把画家成本
        // 拉偏；要比画家成本只能看全量布局帧。
        paintMs: quantiles(layoutFrames.map(sample => sample.paintMs)),
      };
    },
    samples,
    reset: () => {
      buffer.length = 0;
      next = 0;
    },
  };
}
