import { describe, expect, it } from 'vitest';

import { DTXGeometry } from './DTXGeometry';

describe('DTXGeometry', () => {
  it('uses drawRange without allocating a per-vertex placeholder buffer', () => {
    const geometry = new DTXGeometry(12_000_000);

    expect(geometry.getAttribute('position')).toBeUndefined();
    expect(geometry.drawRange).toEqual({ start: 0, count: 12_000_000 });
  });
});
