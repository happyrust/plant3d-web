import { describe, expect, it } from 'vitest';

import { shouldStopShowDbnumLoad } from './showDbnumLoadPolicy';

describe('shouldStopShowDbnumLoad', () => {
  it('always loads the complete dbnum model', () => {
    expect(shouldStopShowDbnumLoad({ objects: 5_000, triangles: 1 })).toBe(false);
    expect(
      shouldStopShowDbnumLoad({ objects: 5_000, triangles: 1_000_000 }, true),
    ).toBe(false);
  });
});
