import { describe, expect, it } from 'vitest';

import { createTestProjector } from '../testUtils';

import { projectArcToScreenPath } from './arcProjection';

const CENTER_X = 200;
const CENTER_Y = 200;

describe('projectArcToScreenPath', () => {
  it('projects a full circle as one closed path on the screen circle', () => {
    const projected = projectArcToScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 1], radiusM: 0.5 },
      createTestProjector(),
    );

    expect(projected).not.toBeNull();
    expect(projected!.closed).toBe(true);
    expect(projected!.points.length).toBeGreaterThanOrEqual(16);
    for (const point of projected!.points) {
      const radius = Math.hypot(point[0] - CENTER_X, point[1] - CENTER_Y);
      expect(Math.abs(radius - 50)).toBeLessThan(0.5);
    }
  });

  it('keeps the chord error below the subdivision tolerance', () => {
    const projected = projectArcToScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 1], radiusM: 1 },
      createTestProjector(),
    )!;

    const points = [...projected.points, projected.points[0]!];
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!;
      const to = points[index + 1]!;
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const sagitta = 100 - Math.hypot(mid[0] - CENTER_X, mid[1] - CENTER_Y);
      expect(sagitta).toBeLessThan(0.3);
    }
  });

  it('projects a quarter arc as an open path with exact endpoints', () => {
    const projected = projectArcToScreenPath(
      {
        center: [0, 0, 0],
        normal: [0, 0, 1],
        radiusM: 0.5,
        startAngle: 0,
        endAngle: Math.PI / 2,
      },
      createTestProjector(),
    );

    expect(projected).not.toBeNull();
    expect(projected!.closed).toBe(false);
    const first = projected!.points[0]!;
    const last = projected!.points[projected!.points.length - 1]!;
    expect(first[0]).toBeCloseTo(CENTER_X, 6);
    expect(first[1]).toBeCloseTo(CENTER_Y + 50, 6);
    expect(last[0]).toBeCloseTo(CENTER_X + 50, 6);
    expect(last[1]).toBeCloseTo(CENTER_Y, 6);
  });

  it('rejects degenerate arcs', () => {
    const projector = createTestProjector();
    expect(projectArcToScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 1], radiusM: 0 },
      projector,
    )).toBeNull();
    expect(projectArcToScreenPath(
      { center: [0, 0, 0], normal: [0, 0, 0], radiusM: 1 },
      projector,
    )).toBeNull();
    expect(projectArcToScreenPath(
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
