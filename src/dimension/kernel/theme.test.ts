import { describe, expect, it } from 'vitest';

import {
  resolveDimensionStyleRole,
  SOLVESPACE_DIMENSION_THEME,
} from './theme';

describe('dimension theme', () => {
  it('pins the SolveSpace layout constants', () => {
    expect(SOLVESPACE_DIMENSION_THEME).toMatchObject({
      textHeightPx: 11.5,
      arrowLengthPx: 13,
      arrowHalfAngleDeg: 18,
      extensionOvershootPx: 10,
      labelPaddingPx: 8,
      outsideExtensionPx: 18,
      minArcRadiusPx: 15,
      lineWidthPx: 1,
    });
  });

  it('maps semantic and interaction roles through one theme', () => {
    expect(resolveDimensionStyleRole('invalid', 'normal')).toBe('invalid');
    expect(resolveDimensionStyleRole('approximate', 'normal')).toBe('approximate');
    expect(resolveDimensionStyleRole('external-reference', 'normal')).toBe('external-reference');
    expect(resolveDimensionStyleRole('invalid', 'hovered')).toBe('hovered');
    expect(resolveDimensionStyleRole('external', 'selected')).toBe('selected');
  });
});
