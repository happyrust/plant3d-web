import { describe, expect, it, vi } from 'vitest';

import {
  DimensionViewportScheduler,
  InvalidationSet,
} from './invalidation';

describe('InvalidationSet', () => {
  it('deduplicates reasons and atomically consumes them', () => {
    const invalidations = new InvalidationSet();
    invalidations.add('camera');
    invalidations.add('camera');
    invalidations.add('theme');

    expect(invalidations.dirty).toBe(true);
    expect([...invalidations.consume()]).toEqual(['camera', 'theme']);
    expect(invalidations.dirty).toBe(false);
    expect([...invalidations.consume()]).toEqual([]);
  });
});

describe('DimensionViewportScheduler', () => {
  function createHarness(
    paint: (reasons: ReadonlySet<string>) => void = vi.fn(),
  ) {
    const callbacks: FrameRequestCallback[] = [];
    const cancelled: number[] = [];
    const scheduler = new DimensionViewportScheduler({
      requestFrame: callback => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: id => cancelled.push(id),
      onFrame: paint,
    });
    return { callbacks, cancelled, scheduler };
  }

  it('coalesces multiple invalidations into one animation frame', () => {
    const onFrame = vi.fn();
    const { callbacks, scheduler } = createHarness(onFrame);

    scheduler.invalidate('camera');
    scheduler.invalidate('size');
    scheduler.invalidate('camera');

    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(1);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect([...onFrame.mock.calls[0][0]]).toEqual(['camera', 'size']);
    expect(callbacks).toHaveLength(0);
  });

  it('does no work while the view stays static', () => {
    const onFrame = vi.fn();
    const { callbacks } = createHarness(onFrame);

    expect(callbacks).toHaveLength(0);
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('schedules exactly one follow-up when invalidated during paint', () => {
    const onFrame = vi.fn(() => harness.scheduler.invalidate('preview'));
    const harness = createHarness(onFrame);
    const scheduler: DimensionViewportScheduler = harness.scheduler;

    scheduler.invalidate('document');
    harness.callbacks.shift()?.(1);

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(harness.callbacks).toHaveLength(1);
    harness.callbacks.shift()?.(2);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending frame on dispose', () => {
    const { cancelled, scheduler } = createHarness();
    scheduler.invalidate('document');

    scheduler.dispose();

    expect(cancelled).toEqual([1]);
  });
});
