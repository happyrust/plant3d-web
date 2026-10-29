import { describe, expect, it } from 'vitest';

import { createDimensionFrameRecorder, percentile } from './dimensionFrameStats';

describe('percentile', () => {
  it('uses the nearest-rank convention shared with dimensionPerf.ts', () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(values, 0.5)).toBe(5);
    expect(percentile(values, 0.95)).toBe(10);
    expect(percentile(values, 0.9)).toBe(9);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile([], 0.95)).toBe(0);
    // Never reorders the caller's array.
    expect(values[0]).toBe(10);
  });
});

describe('createDimensionFrameRecorder', () => {
  it('infers the kind for legacy callers and keeps paint on full-layout frames', () => {
    const recorder = createDimensionFrameRecorder();
    const { record } = recorder;
    record(10, { layoutMs: 6, paintMs: 4 });
    record(2, { layoutMs: 0, paintMs: 2 });
    record(7, { layoutMs: 4, paintMs: 3 });

    expect(recorder.summary()).toEqual({
      frames: 3,
      layoutFrames: 2,
      frameKinds: { layout: 2, style: 1, camera: 0 },
      frameMs: { p50: 7, p95: 10, max: 10 },
      layoutMs: { p50: 4, p95: 6, max: 6 },
      paintMs: { p50: 3, p95: 4, max: 4 },
    });
  });

  it('buckets by the reported kind instead of inferring it from layoutMs', () => {
    const recorder = createDimensionFrameRecorder();
    // 极快的全量帧：布局测得 0 ms，但 kind 说是 layout —— 按 `layoutMs > 0` 会漏算。
    recorder.record(1, { layoutMs: 0, paintMs: 1, kind: 'layout' });
    // 相机帧：视口根本没画，`paintMs` 是整帧 —— 不能算进画家成本。
    recorder.record(9, { layoutMs: 0, paintMs: 9, kind: 'camera' });
    // 样式帧：`paintMs` 也是整帧（必要时退回整幅 paint）。
    recorder.record(5, { layoutMs: 0, paintMs: 5, kind: 'style' });

    const summary = recorder.summary();
    expect(summary.frames).toBe(3);
    expect(summary.layoutFrames).toBe(1);
    expect(summary.frameKinds).toEqual({ layout: 1, style: 1, camera: 1 });
    expect(summary.layoutMs).toEqual({ p50: 0, p95: 0, max: 0 });
    // 只有 layout 帧的 1 ms 进画家成本，相机帧的 9 ms 与样式帧的 5 ms 都被排除。
    expect(summary.paintMs).toEqual({ p50: 1, p95: 1, max: 1 });
    // 整帧分位仍然覆盖全部三类。
    expect(summary.frameMs).toEqual({ p50: 5, p95: 9, max: 9 });
  });

  it('keeps only the newest frames once the ring is full, oldest first', () => {
    const recorder = createDimensionFrameRecorder(3);
    for (let frame = 1; frame <= 5; frame += 1) {
      recorder.record(frame, { layoutMs: frame, paintMs: 0 });
    }

    expect(recorder.samples().map(sample => sample.frameMs)).toEqual([3, 4, 5]);
    expect(recorder.summary().frames).toBe(3);
    expect(recorder.summary().layoutMs.max).toBe(5);
  });

  it('starts from an empty buffer again after reset', () => {
    const recorder = createDimensionFrameRecorder(2);
    recorder.record(5, { layoutMs: 5, paintMs: 0 });
    recorder.record(6, { layoutMs: 6, paintMs: 0 });
    recorder.reset();

    expect(recorder.summary()).toEqual({
      frames: 0,
      layoutFrames: 0,
      frameKinds: { layout: 0, style: 0, camera: 0 },
      frameMs: { p50: 0, p95: 0, max: 0 },
      layoutMs: { p50: 0, p95: 0, max: 0 },
      paintMs: { p50: 0, p95: 0, max: 0 },
    });
    recorder.record(1, { layoutMs: 1, paintMs: 0 });
    expect(recorder.samples().map(sample => sample.frameMs)).toEqual([1]);
  });

  it('rejects a capacity that cannot hold a frame', () => {
    expect(() => createDimensionFrameRecorder(0)).toThrow(RangeError);
    expect(() => createDimensionFrameRecorder(1.5)).toThrow(RangeError);
  });

  it('drops non-finite samples instead of poisoning the quantiles', () => {
    const recorder = createDimensionFrameRecorder();
    recorder.record(10, { layoutMs: 6, paintMs: 4 });
    // NaN / Infinity 会毒化排序与 max（`NaN > max` 恒 false，max 会报 0）。
    recorder.record(Number.NaN, { layoutMs: 0, paintMs: Number.NaN });
    recorder.record(Number.POSITIVE_INFINITY, { layoutMs: Number.POSITIVE_INFINITY, paintMs: 0 });

    expect(recorder.summary()).toEqual({
      frames: 1,
      layoutFrames: 1,
      frameKinds: { layout: 1, style: 0, camera: 0 },
      frameMs: { p50: 10, p95: 10, max: 10 },
      layoutMs: { p50: 6, p95: 6, max: 6 },
      paintMs: { p50: 4, p95: 4, max: 4 },
    });
  });
});
