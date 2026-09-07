import { describe, expect, it } from 'vitest';

import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from './vec';

describe('kernel vec3', () => {
  it('normalizes and preserves perpendicular cross products', () => {
    expect(normalize3([3, 0, 0])).toEqual([1, 0, 0]);
    expect(cross3([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(dot3(cross3([1, 0, 0], [0, 1, 0]), [1, 0, 0])).toBe(0);
  });

  it('supports immutable tuple arithmetic', () => {
    expect(add3([1, 2, 3], scale3(sub3([4, 2, 3], [1, 2, 3]), 0.5))).toEqual([2.5, 2, 3]);
    expect(length3([0, 3, 4])).toBe(5);
  });

  it('rejects zero-length normalization', () => {
    expect(() => normalize3([0, 0, 0])).toThrow(
      new RangeError('Cannot normalize a zero-length vector'),
    );
  });
});
