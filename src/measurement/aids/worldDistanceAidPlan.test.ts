import { describe, expect, it } from 'vitest';

import {
  buildWorldDistanceAidPlan,
  shouldDrawWorldAxisBreakdown,
  worldDistanceAidChildId,
} from './worldDistanceAidPlan';

const MM = 0.001;

describe('buildWorldDistanceAidPlan', () => {
  it('builds a direct part and staged World X/Y/Z parts with stable child ids', () => {
    const parentId = 'xeokit-measurement:measure-1';

    const plan = buildWorldDistanceAidPlan({
      parentId,
      origin: [10, 20, 30],
      target: [8, 23, 34],
      showDirect: true,
      showOrthogonal: true,
    });

    expect(plan).toEqual({
      parentId,
      parts: [
        {
          id: parentId,
          parentId,
          kind: 'direct',
          from: [10, 20, 30],
          to: [8, 23, 34],
          valueM: Math.sqrt(29),
        },
        {
          id: worldDistanceAidChildId(parentId, 'x'),
          parentId,
          kind: 'axis',
          axis: 'x',
          axisIndex: 0,
          from: [10, 20, 30],
          to: [8, 20, 30],
          valueM: -2,
        },
        {
          id: worldDistanceAidChildId(parentId, 'y'),
          parentId,
          kind: 'axis',
          axis: 'y',
          axisIndex: 1,
          from: [8, 20, 30],
          to: [8, 23, 30],
          valueM: 3,
        },
        {
          id: worldDistanceAidChildId(parentId, 'z'),
          parentId,
          kind: 'axis',
          axis: 'z',
          axisIndex: 2,
          from: [8, 23, 30],
          to: [8, 23, 34],
          valueM: 4,
        },
      ],
    });
  });

  it('keeps orthogonal parts when the direct linear dimension is hidden', () => {
    const parentId = 'xeokit-measurement:measure-2';

    const plan = buildWorldDistanceAidPlan({
      parentId,
      origin: [0, 0, 0],
      target: [1, 2, 3],
      showDirect: false,
      showOrthogonal: true,
    });

    expect(plan.parts.map(part => part.id)).toEqual([
      worldDistanceAidChildId(parentId, 'x'),
      worldDistanceAidChildId(parentId, 'y'),
      worldDistanceAidChildId(parentId, 'z'),
    ]);
  });

  it('omits zero-length axis parts without changing the staged path', () => {
    const parentId = 'xeokit-measurement:measure-3';

    const plan = buildWorldDistanceAidPlan({
      parentId,
      origin: [5, 6, 7],
      target: [5, 6, 9],
      showDirect: false,
      showOrthogonal: true,
    });

    expect(plan.parts).toEqual([
      expect.objectContaining({
        id: worldDistanceAidChildId(parentId, 'z'),
        kind: 'axis',
        axis: 'z',
        from: [5, 6, 7],
        to: [5, 6, 9],
        valueM: 2,
      }),
    ]);
  });

  describe('E3D 3.1 runtime golden G2-03 (docs/verification/e3d-measurement-runtime-golden)', () => {
    const parentId = 'xeokit-measurement:golden';
    const origin: readonly [number, number, number] = [10, 10, 15];

    function axisIds(target: readonly [number, number, number], showDirect: boolean): string[] {
      return buildWorldDistanceAidPlan({
        parentId,
        origin,
        target,
        showDirect,
        showOrthogonal: true,
      }).parts
        .filter(part => part.kind === 'axis')
        .map(part => part.id);
    }

    it('suppresses a 0.09 mm component and keeps the other legs (dE=0.09 row)', () => {
      expect(axisIds([10 + 0.09 * MM, 12, 16], true)).toEqual([
        worldDistanceAidChildId(parentId, 'y'),
        worldDistanceAidChildId(parentId, 'z'),
      ]);
    });

    it('draws a 0.11 mm component (dE=0.11 row)', () => {
      const plan = buildWorldDistanceAidPlan({
        parentId,
        origin,
        target: [10 + 0.11 * MM, 12, 16],
        showDirect: true,
        showOrthogonal: true,
      });
      const xPart = plan.parts.find(part => part.kind === 'axis' && part.axis === 'x');
      expect(xPart).toBeDefined();
      expect(xPart!.valueM).toBeCloseTo(0.11 * MM, 9);
    });

    it('draws no breakdown for a single positive axis leg while the direct line is shown (N +2000 row)', () => {
      expect(axisIds([10, 12, 15], true)).toEqual([]);
    });

    it('keeps the breakdown for the negative counterpart, as E3D does (N -2000 row)', () => {
      expect(axisIds([10, 8, 15], true)).toEqual([
        worldDistanceAidChildId(parentId, 'y'),
      ]);
    });

    it('always draws the breakdown when the direct line is hidden (Show linear off)', () => {
      expect(axisIds([10, 12, 15], false)).toEqual([
        worldDistanceAidChildId(parentId, 'y'),
      ]);
    });

    it('draws the breakdown for multi-axis measurements (3000/4000 row)', () => {
      expect(axisIds([13, 14, 15], true)).toEqual([
        worldDistanceAidChildId(parentId, 'x'),
        worldDistanceAidChildId(parentId, 'y'),
      ]);
    });
  });

  describe('shouldDrawWorldAxisBreakdown', () => {
    it('mirrors int(sum) ne int(length) in millimetres', () => {
      expect(shouldDrawWorldAxisBreakdown({ delta: [0, 2, 0], showDirect: true })).toBe(false);
      expect(shouldDrawWorldAxisBreakdown({ delta: [0, -2, 0], showDirect: true })).toBe(true);
      expect(shouldDrawWorldAxisBreakdown({ delta: [3, 4, 0], showDirect: true })).toBe(true);
      expect(shouldDrawWorldAxisBreakdown({ delta: [0.09 * MM, 2, 1], showDirect: true })).toBe(true);
    });

    it('is bypassed when the direct line is hidden', () => {
      expect(shouldDrawWorldAxisBreakdown({ delta: [0, 2, 0], showDirect: false })).toBe(true);
      expect(shouldDrawWorldAxisBreakdown({ delta: [0, 0, 0], showDirect: false })).toBe(true);
    });

    it('does not let metre→millimetre conversion noise flip the truncation', () => {
      // 0.5 m expressed through a scene→design transform that leaves 1e-13 m of noise.
      expect(shouldDrawWorldAxisBreakdown({ delta: [0, 0, 0.5 - 1e-13], showDirect: true })).toBe(false);
      expect(shouldDrawWorldAxisBreakdown({ delta: [0, 0, 0.5 + 1e-13], showDirect: true })).toBe(false);
    });
  });
});
