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
const below = theme.sourceTextHeightMinPx - 0.5;
const between = (theme.sourceTextHeightMinPx + theme.sourceTextHeightMaxPx) / 2;
const above = theme.sourceTextHeightMaxPx + 0.5;

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
  it('hides a secondary input only below the floor', () => {
    expect(lodSecondaryFar({ tier: 'secondary' }, below, theme)).toBe(true);
    expect(lodSecondaryFar({ tier: 'secondary' }, theme.sourceTextHeightMinPx, theme)).toBe(false);
    expect(lodSecondaryFar({ tier: 'secondary' }, null, theme)).toBe(false);
    expect(lodSecondaryFar({ tier: 'primary' }, below, theme)).toBe(false);
    expect(lodSecondaryFar(undefined, below, theme)).toBe(false);
  });

  it('hides a detail input until the ceiling', () => {
    expect(lodDetailFar({ tier: 'detail' }, between, theme)).toBe(true);
    expect(lodDetailFar({ tier: 'detail' }, theme.sourceTextHeightMaxPx, theme)).toBe(false);
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
    expect(lodTierHiddenReason({ tier: 'secondary' }, below, theme)).toBe('secondary-far');
    expect(lodTierHiddenReason({ tier: 'secondary' }, above, theme)).toBeNull();
    expect(lodTierHiddenReason({ tier: 'detail' }, between, theme)).toBe('detail-far');
    expect(lodTierHiddenReason({ tier: 'detail' }, above, theme)).toBeNull();
    expect(lodTierHiddenReason({ tier: 'primary', hideShort: true }, below, theme)).toBeNull();
    expect(lodTierHiddenReason({ tier: 'secondary' }, null, theme)).toBeNull();
    expect(lodTierHiddenReason(undefined, below, theme)).toBeNull();
  });
});
