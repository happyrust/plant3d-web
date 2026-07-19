import { describe, expect, it } from 'vitest';

import { trimLineAgainstRect } from './trimLineAgainstRect';

const rect = { x: 4, y: -1, width: 2, height: 2 };

describe('trimLineAgainstRect', () => {
  it('splits a line that crosses the label rectangle', () => {
    expect(trimLineAgainstRect([0, 0], [10, 0], rect, true)).toEqual({
      segments: [
        { from: [0, 0], to: [4, 0] },
        { from: [6, 0], to: [10, 0] },
      ],
      outsideSide: 0,
    });
  });

  it('keeps one segment when an endpoint lies under the label', () => {
    expect(trimLineAgainstRect([5, 0], [10, 0], rect, true)).toEqual({
      segments: [{ from: [6, 0], to: [10, 0] }],
      outsideSide: 0,
    });
  });

  it('extends toward an outside label and reports its side', () => {
    expect(
      trimLineAgainstRect([0, 0], [3, 0], { x: 5, y: -1, width: 2, height: 2 }, true),
    ).toEqual({
      segments: [{ from: [0, 0], to: [5, 0] }],
      outsideSide: -1,
    });
    expect(
      trimLineAgainstRect([7, 0], [10, 0], { x: 3, y: -1, width: 2, height: 2 }, true),
    ).toEqual({
      segments: [{ from: [5, 0], to: [10, 0] }],
      outsideSide: 1,
    });
  });

  it('emits no segment when the entire line is inside the label', () => {
    expect(trimLineAgainstRect([4.5, 0], [5.5, 0], rect, true)).toEqual({
      segments: [],
      outsideSide: 0,
    });
  });
});
