import { describe, expect, it } from 'vitest';

import { buildPerpendicularAidPlan, perpendicularAidLegId } from './perpendicularAidPlan';

const parentId = 'xeokit-measurement:perp';

describe('buildPerpendicularAidPlan', () => {
  it('draws the Vertical and Horizontal legs through the datum below the source (golden G4-01)', () => {
    // foot E 11000 N 9000 U 15000, source E 11000 N 9500 U 17500 (mm → m)
    const plan = buildPerpendicularAidPlan({
      parentId,
      foot: [11, 9, 15],
      source: [11, 9.5, 17.5],
    });
    expect(plan.legs).toEqual([
      {
        id: perpendicularAidLegId(parentId, 'vertical'),
        parentId,
        kind: 'vertical',
        from: [11, 9.5, 17.5],
        to: [11, 9.5, 15],
        valueM: 2.5,
      },
      {
        id: perpendicularAidLegId(parentId, 'horizontal'),
        parentId,
        kind: 'horizontal',
        from: [11, 9, 15],
        to: [11, 9.5, 15],
        valueM: 0.5,
      },
    ]);
  });

  it('omits both legs when the target plane is vertical (Vertical 0, golden G4-02)', () => {
    const plan = buildPerpendicularAidPlan({
      parentId,
      foot: [8, 10.5, 16.5],
      source: [8, 9, 16.5],
    });
    expect(plan.legs).toEqual([]);
  });

  it('omits both legs when the source sits straight above the foot (Horizontal 0)', () => {
    const plan = buildPerpendicularAidPlan({
      parentId,
      foot: [0, 0, 0],
      source: [0, 0, 2],
    });
    expect(plan.legs).toEqual([]);
  });

  it('applies the 1 mm threshold to each leg', () => {
    expect(buildPerpendicularAidPlan({
      parentId,
      foot: [0, 0, 0],
      source: [0.0009, 0, 2],
    }).legs).toEqual([]);
    expect(buildPerpendicularAidPlan({
      parentId,
      foot: [0, 0, 0],
      source: [0.0011, 0, 2],
    }).legs).toHaveLength(2);
  });

  it('returns no legs for non-finite input', () => {
    expect(buildPerpendicularAidPlan({
      parentId,
      foot: [Number.NaN, 0, 0],
      source: [1, 1, 1],
    }).legs).toEqual([]);
  });
});
