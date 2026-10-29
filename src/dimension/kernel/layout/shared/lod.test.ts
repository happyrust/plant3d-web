import { describe, expect, it } from 'vitest';

import { SOLVESPACE_DIMENSION_THEME } from '../../theme';

import {
  lodDetailFar,
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

  it('elides a line shorter than the label-width ratio', () => {
    const ratio = theme.lodMinLineToLabelRatio;
    expect(lodShortLine(20 * ratio - 0.01, 20, theme)).toBe(true);
    expect(lodShortLine(20 * ratio, 20, theme)).toBe(false);
    expect(lodShortLine(0, 0, theme)).toBe(false);
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
});
