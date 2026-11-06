import { describe, expect, it } from 'vitest';

import { LabelOccupancy } from './occupancy';

describe('LabelOccupancy.overlapsExcluding', () => {
  it('ignores only the excluded claim, by identity', () => {
    const occupancy = new LabelOccupancy();
    const own = { x: 0, y: 0, width: 40, height: 20 };
    const twin = { x: 0, y: 0, width: 40, height: 20 };
    occupancy.insert(own);
    const probe = { x: 10, y: 5, width: 10, height: 10 };

    expect(occupancy.overlaps(probe)).toBe(true);
    expect(occupancy.overlapsExcluding(probe, own)).toBe(false);

    // Same geometry, different claim: still in the way.
    occupancy.insert(twin);
    expect(occupancy.overlapsExcluding(probe, own)).toBe(true);
  });
});
