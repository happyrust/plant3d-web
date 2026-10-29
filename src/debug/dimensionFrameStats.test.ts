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
  it('summarises layout over full-layout frames only and paint over every frame', () => {
    const recorder = createDimensionFrameRecorder();
    const { record } = recorder;
    record(10, { layoutMs: 6, paintMs: 4 });
    record(2, { layoutMs: 0, paintMs: 2 });
    record(7, { layoutMs: 4, paintMs: 3 });

    expect(recorder.summary()).toEqual({
      frames: 3,
      layoutFrames: 2,
      frameMs: { p50: 7, p95: 10, max: 10 },
      layoutMs: { p50: 4, p95: 6, max: 6 },
      paintMs: { p50: 3, p95: 4, max: 4 },
    });
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
      frameMs: { p50: 10, p95: 10, max: 10 },
      layoutMs: { p50: 6, p95: 6, max: 6 },
      paintMs: { p50: 4, p95: 4, max: 4 },
    });
  });
});
