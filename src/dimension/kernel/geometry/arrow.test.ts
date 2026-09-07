import { describe, expect, it } from 'vitest';

import { makeOpenArrow } from './arrow';

describe('makeOpenArrow', () => {
  it('creates a symmetric 13 px by 18 degree V arrow', () => {
    const arrow = makeOpenArrow([10, 10], [1, 0], 13, 18, 'normal');
    const expectedLegLength = 13 / Math.cos((18 * Math.PI) / 180);

    expect(arrow).toHaveLength(2);
    expect(arrow[0]).toMatchObject({ kind: 'line', part: 'arrow', styleRole: 'normal' });
    expect(arrow[1]).toMatchObject({ kind: 'line', part: 'arrow', styleRole: 'normal' });
    expect(Math.hypot(arrow[0].to[0] - 10, arrow[0].to[1] - 10)).toBeCloseTo(
      expectedLegLength,
      12,
    );
    expect(arrow[0].to[0]).toBeCloseTo(23, 12);
    expect(arrow[0].to[1] - 10).toBeCloseTo(-(arrow[1].to[1] - 10), 12);
  });
});
