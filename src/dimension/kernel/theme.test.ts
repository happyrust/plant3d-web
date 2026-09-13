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
      // 来源自报字高（MBD cheight）投影后的夹取区间（2026-09-12 S2）。
      sourceTextHeightMinPx: 11,
      sourceTextHeightMaxPx: 18,
      // 尺寸线投影短于 1 个标签宽的显式尺寸按 LOD 隐藏（2026-09-12 S3）。
      lodMinLineToLabelRatio: 1,
      extensionOvershootPx: 10,
      labelPaddingPx: 8,
      outsideExtensionPx: 18,
      minArcRadiusPx: 15,
      // 文字笔画 1.8 px（2026-09-14 边缘羽化后加重，用户拍板）；尺寸线 1.2 px。
      textStrokeWidthPx: 1.8,
      dimensionStrokeWidthPx: 1.2,
      // 三维长度尺寸（参考图风格，2026-09-12）：以字高 h 为单位的标注比例、字的屏幕下限与描边 / 光晕。
      dimension3d: {
        textFloorPx: 13,
        standoffH: 1.2,
        rowSpacingH: 1.7,
        textGapH: 0.3,
        extensionStartH: 0.15,
        extensionOvershootH: 0.3,
        arrowLengthH: 0.9,
        outsideTailH: 0.4,
        outsideClearancePx: 8,
        foreshortenRatio: 0.35,
        textStrokeWidthPx: 2,
        textHaloWidthPx: 1.4,
        textHaloColor: '#ffffff',
      },
      // 普通/外部标签文字用深色提升可读性；语义/交互角色回落 colors 保持高亮。
      textColors: { normal: '#111827', external: '#111827' },
    });
  });

  it('pins the inspection display mode alphas and occlusion tolerance (S4, 2026-09-13)', () => {
    // 被遮挡尺寸淡化到 0.35、可见 0.65（两态可分且都还能读）；命中要比探测点近至少
    // max(0.5 mm, 2 px) 才算遮挡，标签锚点所在的管面本身不算。
    expect(SOLVESPACE_DIMENSION_THEME.inspection).toEqual({
      visibleAlpha: 0.65,
      occludedAlpha: 0.35,
      toleranceMm: 0.5,
      tolerancePx: 2,
    });
  });

  it('keeps external dimension lines apart from user magenta and the selection highlight', () => {
    // 用户尺寸保持洋红；外部（MBD / 测量）尺寸线用图纸红（参考图风格），与 DTX 选中高亮 0xff4fd8
    // 和默认蓝色管体都拉开（QW2 时曾用深橙 #c2410c）；选中态因此让出纯红、改用绿色。
    expect(SOLVESPACE_DIMENSION_THEME.colors.normal).toBe('#ff1aff');
    expect(SOLVESPACE_DIMENSION_THEME.colors.external).toBe('#c81e1e');
    expect(SOLVESPACE_DIMENSION_THEME.colors['external-reference']).toBe('#c81e1e');
    expect(SOLVESPACE_DIMENSION_THEME.colors.selected).toBe('#16a34a');
    expect(SOLVESPACE_DIMENSION_THEME.colors.selected)
      .not.toBe(SOLVESPACE_DIMENSION_THEME.colors.external);
  });

  it('maps semantic and interaction roles through one theme', () => {
    expect(resolveDimensionStyleRole('invalid', 'normal')).toBe('invalid');
    expect(resolveDimensionStyleRole('approximate', 'normal')).toBe('approximate');
    expect(resolveDimensionStyleRole('external-reference', 'normal')).toBe('external-reference');
    expect(resolveDimensionStyleRole('invalid', 'hovered')).toBe('hovered');
    expect(resolveDimensionStyleRole('external', 'selected')).toBe('selected');
  });
});
