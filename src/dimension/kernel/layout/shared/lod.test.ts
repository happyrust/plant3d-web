import { describe, expect, it } from 'vitest';

import { SOLVESPACE_DIMENSION_THEME } from '../../theme';

import {
  LOD_CLOSEUP_SHORT_LINE_REF_TEXT_M,
  LOD_EFFECTIVE_SOURCE_TEXT_MIN_M,
  lodCloseUpLineScale,
  lodDetailFar,
  lodProjectedSourceTextHeightPx,
  lodSecondaryFar,
  lodShortLine,
  lodTierHiddenReason,
  projectedSourceTextHeightPx,
} from './lod';

const theme = SOLVESPACE_DIMENSION_THEME;
const between = (theme.lodSecondaryMinPx + theme.lodDetailMinPx) / 2;
const above = theme.lodDetailMinPx + 0.5;
/** A theme that still gates secondary by projection height, for the predicate's own test. */
const gated = { ...theme, lodSecondaryMinPx: 11 };

describe('projectedSourceTextHeightPx', () => {
  it('divides the source height by the metres-per-pixel', () => {
    expect(projectedSourceTextHeightPx(0.027, 0.002)).toBeCloseTo(13.5, 9);
  });

  it('is null without a positive source height or a usable scale', () => {
    expect(projectedSourceTextHeightPx(undefined, 0.002)).toBeNull();
    expect(projectedSourceTextHeightPx(0, 0.002)).toBeNull();
    expect(projectedSourceTextHeightPx(-1, 0.002)).toBeNull();
    expect(projectedSourceTextHeightPx(0.027, 0)).toBeNull();
    expect(projectedSourceTextHeightPx(0.027, Number.NaN)).toBeNull();
    expect(projectedSourceTextHeightPx(0.027, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('tier predicates', () => {
  it('hides a secondary input only below the display gate', () => {
    expect(lodSecondaryFar({ tier: 'secondary' }, 10.5, gated)).toBe(true);
    expect(lodSecondaryFar({ tier: 'secondary' }, gated.lodSecondaryMinPx, gated)).toBe(false);
    expect(lodSecondaryFar({ tier: 'secondary' }, null, gated)).toBe(false);
    expect(lodSecondaryFar({ tier: 'primary' }, 10.5, gated)).toBe(false);
    expect(lodSecondaryFar(undefined, 10.5, gated)).toBe(false);
  });

  it('does not gate secondary on the legibility floor', () => {
    // 2026-10-29：cheight 跨 BRAN 差 13 倍（实测 0.12 px ~ 1.5 px 投影），
    // 任何正数下限都会让整条 BRAN 消失，所以显示门槛与字号钳制必须分离。
    expect(theme.lodSecondaryMinPx).toBeLessThan(theme.sourceTextHeightMinPx);
    const tinyProjection = 0.12;
    expect(lodSecondaryFar({ tier: 'secondary' }, tinyProjection, theme)).toBe(false);
    // 字号仍被钳到可读区间，不因显示放开而变小。
    expect(tinyProjection).toBeLessThan(theme.sourceTextHeightMinPx);
  });

  it('hides a detail input until the close-up gate', () => {
    expect(lodDetailFar({ tier: 'detail' }, between, theme)).toBe(true);
    expect(lodDetailFar({ tier: 'detail' }, theme.lodDetailMinPx, theme)).toBe(false);
    expect(lodDetailFar({ tier: 'detail' }, null, theme)).toBe(false);
    expect(lodDetailFar({ tier: 'secondary' }, between, theme)).toBe(false);
    expect(lodDetailFar(undefined, between, theme)).toBe(false);
  });

  it('applies the per-tier short-line ratio instead of one flat ratio', () => {
    const ratios = theme.lodMinLineToLabelRatio;
    // A smaller ratio is more permissive: 0.5 < 0.8 < 1.5.
    expect(ratios.secondary).toBeLessThan(ratios.primary);
    expect(ratios.primary).toBeLessThan(ratios.detail);

    // The same 15 px line under a 20 px label: 0.75 label widths.
    for (const tier of ['primary', 'secondary', 'detail'] as const) {
      const threshold = 20 * ratios[tier];
      expect(lodShortLine(threshold - 0.01, 20, theme, tier)).toBe(true);
      expect(lodShortLine(threshold, 20, theme, tier)).toBe(false);
    }

    // 18 px of line under a 20 px label = 0.9 label widths. The old flat 1.0
    // elided it; primary's 0.8 keeps it — that is Q5's "the mid view keeps one
    // more tier". secondary's 0.5 keeps it too; detail's 1.5 still elides it.
    expect(lodShortLine(18, 20, theme, 'secondary')).toBe(false);
    expect(lodShortLine(18, 20, theme, 'primary')).toBe(false);
    expect(lodShortLine(18, 20, theme, 'detail')).toBe(true);
    // A flat 1.0 would have dropped it, so primary really did loosen.
    expect(lodShortLine(18, 20, { ...theme, lodMinLineToLabelRatio: { primary: 1, secondary: 1, detail: 1 } }, 'primary'))
      .toBe(true);

    // A source that never declared a tier keeps the mid-range behaviour.
    expect(lodShortLine(18, 20, theme)).toBe(lodShortLine(18, 20, theme, 'primary'));

    // A zero-width label never hides anything, whatever the tier.
    expect(lodShortLine(0, 0, theme, 'detail')).toBe(false);
  });

  it('reports the tiers in order: secondary, then detail, else nothing', () => {
    expect(lodTierHiddenReason({ tier: 'secondary' }, 10.5, gated)).toBe('secondary-far');
    expect(lodTierHiddenReason({ tier: 'secondary' }, above, gated)).toBeNull();
    expect(lodTierHiddenReason({ tier: 'detail' }, between, theme)).toBe('detail-far');
    expect(lodTierHiddenReason({ tier: 'detail' }, above, theme)).toBeNull();
    expect(lodTierHiddenReason({ tier: 'primary', hideShort: true }, 10.5, gated)).toBeNull();
    expect(lodTierHiddenReason({ tier: 'secondary' }, null, gated)).toBeNull();
    expect(lodTierHiddenReason(undefined, 10.5, gated)).toBeNull();
  });

  it('#138 caps the close-up LOD floor at 2 mm without inflating mid/far views or drawn heights', () => {
    expect(LOD_EFFECTIVE_SOURCE_TEXT_MIN_M).toBe(0.002);
    expect(LOD_CLOSEUP_SHORT_LINE_REF_TEXT_M).toBe(0.006);

    // Raw geometric projection stays untouched for text sizing:
    expect(projectedSourceTextHeightPx(0.00059, 0.0001)).toBeCloseTo(5.9, 6);

    // Close-up outside camera.near=0.1m (0.1 mm/px): 0.59 mm lifts to 2 mm -> 20 px >= 18 px
    const closeUpPx = lodProjectedSourceTextHeightPx(0.00059, 0.0001);
    expect(closeUpPx).toBeCloseTo(20, 6);
    expect(lodDetailFar({ tier: 'detail' }, closeUpPx, theme)).toBe(false);

    // Mid / whole-object view (1 mm/px): 2 mm -> 2 px < 18 px, still hidden!
    const midPx = lodProjectedSourceTextHeightPx(0.00059, 0.001);
    expect(midPx).toBeCloseTo(2, 6);
    expect(lodDetailFar({ tier: 'detail' }, midPx, theme)).toBe(true);

    // Heights >= 2 mm are completely unchanged at every scale:
    expect(lodProjectedSourceTextHeightPx(0.027, 0.002)).toBeCloseTo(13.5, 9);
    expect(lodProjectedSourceTextHeightPx(undefined, 0.0001)).toBeNull();
    expect(lodProjectedSourceTextHeightPx(0, 0.0001)).toBeNull();

    // Short-line close-up scale only activates for < 2 mm text AFTER reaching close-up:
    expect(lodCloseUpLineScale(0.00042, midPx, theme)).toBe(1);
    expect(lodCloseUpLineScale(0.00042, closeUpPx, theme)).toBeCloseTo(0.006 / 0.00042, 6);
    expect(lodCloseUpLineScale(0.002, closeUpPx, theme)).toBe(1);
    expect(lodCloseUpLineScale(0.027, 270, theme)).toBe(1);
  });
});
