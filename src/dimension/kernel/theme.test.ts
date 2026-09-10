import { describe, expect, it } from 'vitest';

import {
  resolveDimensionStyleRole,
  SOLVESPACE_DIMENSION_THEME,
} from './theme';

describe('dimension theme', () => {
  it('pins the SolveSpace layout constants', () => {
    expect(SOLVESPACE_DIMENSION_THEME).toMatchObject({
      textHeightPx: 13,
      arrowLengthPx: 13,
      arrowHalfAngleDeg: 18,
      // 外部箭头笔画的可读下限与用户尺寸实心头同长（ADR 0056）。
      arrowLineMinLengthPx: 13,
      extensionOvershootPx: 10,
      labelPaddingPx: 8,
      outsideExtensionPx: 18,
      minArcRadiusPx: 15,
      textStrokeWidthPx: 1.5,
      dimensionStrokeWidthPx: 1.2,
      // 普通/外部标签文字用深色提升可读性；语义/交互角色回落 colors 保持高亮。
      textColors: { normal: '#111827', external: '#111827' },
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
