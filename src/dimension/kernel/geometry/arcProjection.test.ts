import { describe, expect, it } from 'vitest';

import { createTestProjector } from '../testUtils';

import { sampleArcToDesignAndScreenPath } from './arcProjection';

import { present } from '@/testing/present';

const CENTER_X = 200;
const CENTER_Y = 200;

describe('sampleArcToDesignAndScreenPath', () => {
  it('projects a full circle as one closed path on the screen circle', () => {
    const sampled = sampleArcToDesignAndScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 1], radiusM: 0.5 },
      createTestProjector(),
    );

    expect(sampled).not.toBeNull();
    const sampledCircle = present(sampled, 'sampled circle');
    expect(sampledCircle.closed).toBe(true);
    expect(sampledCircle.screenPoints.length).toBeGreaterThanOrEqual(16);
    for (const point of sampledCircle.screenPoints) {
      const radius = Math.hypot(point[0] - CENTER_X, point[1] - CENTER_Y);
      expect(Math.abs(radius - 50)).toBeLessThan(0.5);
    }
  });

  it('keeps the chord error below the subdivision tolerance', () => {
    const sampled = present(
      sampleArcToDesignAndScreenPath(
        { center: [0, 0, 0], normal: [0, 0, 1], radiusM: 1 },
        createTestProjector(),
      ),
      'sampled unit circle',
    );

    const points = [...sampled.screenPoints, present(sampled.screenPoints[0], 'first point')];
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = present(points[index], 'point');
      const to = present(points[index + 1], 'next point');
      const mid = [
        (present(from[0], 'from x') + present(to[0], 'to x')) / 2,
        (present(from[1], 'from y') + present(to[1], 'to y')) / 2,
      ] as const;
      const sagitta = 100 - Math.hypot(mid[0] - CENTER_X, mid[1] - CENTER_Y);
      expect(sagitta).toBeLessThan(0.3);
    }
  });

  it('projects a quarter arc as an open path with exact endpoints', () => {
    const sampled = sampleArcToDesignAndScreenPath(
      {
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 0.5,
        startAngle: 0,
        endAngle: Math.PI / 2,
      },
      createTestProjector(),
    );

    expect(sampled).not.toBeNull();
    const quarter = present(sampled, 'sampled quarter arc');
    expect(quarter.closed).toBe(false);
    const first = present(quarter.screenPoints[0], 'first point');
    const last = present(quarter.screenPoints[quarter.screenPoints.length - 1], 'last point');
    expect(first[0]).toBeCloseTo(CENTER_X, 6);
    expect(first[1]).toBeCloseTo(CENTER_Y + 50, 6);
    expect(last[0]).toBeCloseTo(CENTER_X + 50, 6);
    expect(last[1]).toBeCloseTo(CENTER_Y, 6);
  });

  it('rejects degenerate arcs', () => {
    const projector = createTestProjector();
    expect(sampleArcToDesignAndScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 1], radiusM: 0 },
      projector,
    )).toBeNull();
    expect(sampleArcToDesignAndScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 0], radiusM: 1 },
      projector,
    )).toBeNull();
    expect(sampleArcToDesignAndScreenPath(
      {
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 1,
        startAngle: 1,
        endAngle: 1,
      },
      projector,
    )).toBeNull();
  });
});
