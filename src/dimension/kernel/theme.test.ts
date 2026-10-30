import { describe, expect, it, vi } from 'vitest';

import {
  resolveDimensionLineDash,
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
      // 显示门槛与字号钳制分离（2026-10-29）：secondary 不按投影高度隐藏，
      // detail 仍是近景专属。
      lodSecondaryMinPx: 0,
      lodDetailMinPx: 18,
      // 尺寸线投影短于本档标签宽的显式尺寸按 LOD 隐藏（2026-09-12 S3）；
      // 2026-10-30 起按 tier 分三档（Q5），比值越小越宽松。
      lodMinLineToLabelRatio: { primary: 0.8, secondary: 0.5, detail: 1.5 },
      extensionOvershootPx: 10,
      labelPaddingPx: 8,
      outsideExtensionPx: 18,
      minArcRadiusPx: 15,
      // T1.5 收口：原来散在 layout/explicit.ts（标记半径 4、行距 1.5）与 layout/angular.ts（弧步 4°、射线外伸 5 px）的字面量。
      markerRadiusPx: 4,
      labelLineAdvance: 1.5,
      // Q6 `above` 回落守卫的净空（2026-10-30）：抬起标签的补钉盒与同一布局画出的
      // 其它图元小于此值就退回 interrupted。屏幕像素口径。
      aboveRowClearancePx: 2,
      arcChordMaxStepDeg: 4,
      angularRayOvershootPx: 5,
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

  it('pins the tag candidate geometry and intrusion weights (T1.5, formerly constants in layout/tagBillboard.ts)', () => {
    // 候选角按这个顺序试、环距一环全堵才进下一环；权重里标签 / 叠层最重、笔画次之、包围盒最轻。
    expect(SOLVESPACE_DIMENSION_THEME.tag).toMatchObject({
      candidateAnglesDeg: [0, 30, -30, 60, -60, 90, -90, 135, -135, 180],
      candidateDistanceScales: [1, 1.6, 2.4, 3.4],
      awayProbePx: 50,
      bodyMarginPx: 2,
      intrusionWeights: { label: 4, overlay: 4, stroke: 2, box: 1 },
      strokeBandPx: 4,
      intrusionTiePx2: 1e-6,
    });
  });

  it('pins the moving-label declutter steps (T1.5, formerly constants in collision/resolveLabelCollisions.ts)', () => {
    // 8 个候选、每步 8 px；≤ 64 个标签的批次多试一个候选。
    expect(SOLVESPACE_DIMENSION_THEME.declutter).toEqual({
      candidateStepPx: 8,
      candidateCount: 8,
      extendedSearchMaxLabels: 64,
    });
  });

  it('pins the inspection display mode alphas and occlusion tolerance (S4, 2026-09-13; alphas retuned 2026-09-14 twice)', () => {
    // 叠层在整帧色调映射之后直接画进 sRGB 画布（ADR 0064），淡化系数就是 sRGB 里的混合因子，
    // 留下的不透明对比 = 系数本身：0.65 / 0.35 ≈ 65 % / 35 %，两态可分且都还能读。（此前叠层在
    // 线性光里混合再经 ACES，同样的观感要 0.92 / 0.80，d-417。）
    // 命中要比探测点近至少 max(0.5 mm, 2 px) 才算遮挡，标签锚点所在的管面本身不算。
    expect(SOLVESPACE_DIMENSION_THEME.inspection).toEqual({
      visibleAlpha: 0.65,
      occludedAlpha: 0.35,
      toleranceMm: 0.5,
      tolerancePx: 2,
    });
    expect(SOLVESPACE_DIMENSION_THEME.inspection.occludedAlpha)
      .toBeLessThan(SOLVESPACE_DIMENSION_THEME.inspection.visibleAlpha);
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

describe('resolveDimensionLineDash', () => {
  it('gives each known line style its own pattern, not a shared default', () => {
    // 三个已知样式必须各自不同：把它们全映射成 [] 也能让「不抛」的断言通过，
    // 但那等于把虚线画成实线，画面错而不报错。这条钉住「每个值都真的被用上」。
    expect(resolveDimensionLineDash('normal', 'solid')).toEqual([]);
    expect(resolveDimensionLineDash('normal', 'dashed')).toEqual([6, 4]);
    expect(resolveDimensionLineDash('normal', 'dash-dot')).toEqual([8, 3, 2, 3]);
    expect(new Set([
      JSON.stringify(resolveDimensionLineDash('normal', 'solid')),
      JSON.stringify(resolveDimensionLineDash('normal', 'dashed')),
      JSON.stringify(resolveDimensionLineDash('normal', 'dash-dot')),
    ]).size).toBe(3);
  });

  it('lets an explicit style win over the role, and the role win when it is absent', () => {
    // 显式样式优先（ADR 0042）：`invalid` 角色本身是 [7,3]，但给了 `dashed`
    // 就得画 [6,4]。反过来没有样式时角色必须接上，否则带语义的虚线全变实线。
    expect(resolveDimensionLineDash('invalid', 'dashed')).toEqual([6, 4]);
    expect(resolveDimensionLineDash('invalid', 'solid')).toEqual([]);
    expect(resolveDimensionLineDash('invalid', undefined)).toEqual([7, 3]);
    expect(resolveDimensionLineDash('external-reference', undefined)).toEqual([6, 4]);
    expect(resolveDimensionLineDash('approximate', undefined)).toEqual([2, 2]);
    expect(resolveDimensionLineDash('normal', undefined)).toEqual([]);
  });

  it('falls back to the role instead of throwing on an out-of-band line style', () => {
    // `DimensionLineStyle` 只存在于类型层：`ExplicitArcInput.style` /
    // `ExplicitMarkerInput.style` / `ExplicitLayoutInput.lines[].style` 都没有
    // 运行期校验，MBD 契约的 `AID_LINE_STYLES` 只覆盖 aid 三类图元。所以一个
    // 绕过解析器的布局可以把任意字符串送到这里。
    //
    // 修前：`STYLE_LINE_DASH[lineStyle]` 得 `undefined`，调用方读 `.length`
    // 抛 `TypeError`，抛点在分帧绘制内部 —— 正是 §11.11 的 A1 要降级的那类
    // 「一条坏记录冻住整个尺寸层」。修后：退化成「没有显式样式」，角色决定。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const bogus of ['dotted', 'DASHED', 'dash_dot', 'dash dot', 'solid ', '7']) {
        // 不抛是主断言。
        expect(() => resolveDimensionLineDash('normal', bogus as never)).not.toThrow();
        // 兜底必须是「按角色」，不是「按某个默认虚线」—— 否则画面会凭空多出虚线。
        expect(resolveDimensionLineDash('normal', bogus as never)).toEqual([]);
        expect(resolveDimensionLineDash('invalid', bogus as never)).toEqual([7, 3]);
        expect(resolveDimensionLineDash('external-reference', bogus as never))
          .toEqual([6, 4]);
      }
      // 兜底不能静默：日志里要能认出是哪个值、哪个角色。
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.some(args =>
        String(args[0]).includes('"dotted"') && String(args[0]).includes('"normal"'),
      )).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps a falsy but present line style falling through to the role', () => {
    // `''` / `null` / `0` 是 `if (lineStyle)` 挡住的假值：它们不该进 `STYLE_LINE_DASH`
    // 索引，也不该触发「未知样式」告警。这条钉住修 fallback 时没把假值判断改坏。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const falsy of ['', null, 0, false, undefined]) {
        expect(resolveDimensionLineDash('approximate', falsy as never)).toEqual([2, 2]);
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
