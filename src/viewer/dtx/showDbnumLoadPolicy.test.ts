import { describe, expect, it } from 'vitest';

import { shouldStopShowDbnumLoad } from './showDbnumLoadPolicy';

describe('shouldStopShowDbnumLoad', () => {
  it('stops the default overview before GPU resources grow without bound', () => {
    expect(shouldStopShowDbnumLoad({ objects: 5_000, triangles: 1 })).toBe(true);
    expect(shouldStopShowDbnumLoad({ objects: 1, triangles: 1_000_000 })).toBe(true);
  });

  it('allows an explicit full-load diagnostic run', () => {
    expect(
      shouldStopShowDbnumLoad({ objects: 5_000, triangles: 1_000_000 }, true),
    ).toBe(false);
  });
});
