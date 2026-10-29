import type { DimensionTheme } from '../../theme';
import type { ExplicitLodHiddenReason, ExplicitLodInput } from '../../types';

/**
 * Level-of-detail predicates shared by the explicit, 3D-dimension and
 * billboard-tag layouts (S3, T1.3). Pure comparisons lifted verbatim from the
 * three modules; each caller still measures its own line length and label
 * width, because those differ per presentation.
 */

/**
 * Source text height projected to screen pixels, or null when the source
 * declares none (or the projector cannot say): the camera-dependent number
 * every tier rule compares against.
 */
export function projectedSourceTextHeightPx(
  textHeightM: number | undefined,
  metresPerPixel: number,
): number | null {
  return textHeightM !== undefined
    && textHeightM > 0
    && Number.isFinite(metresPerPixel)
    && metresPerPixel > 0
    ? textHeightM / metresPerPixel
    : null;
}

/**
 * A `secondary` input disappears while its source text projects below
 * `theme.lodSecondaryMinPx`. That threshold is a display gate, separate from
 * the `sourceTextHeightMinPx` legibility floor that clamps the drawn cap
 * height (2026-10-29): a branch whose `cheight` projects to 0.12 px must still
 * be able to show its sub-dimensions at a readable size.
 */
export function lodSecondaryFar(
  lod: ExplicitLodInput | undefined,
  projectedPx: number | null,
  theme: DimensionTheme,
): boolean {
  return lod?.tier === 'secondary'
    && projectedPx !== null
    && projectedPx < theme.lodSecondaryMinPx;
}

/**
 * A `detail` input (slope marks, skew aids, branch name) is a close-up only
 * tier: it appears once its source text reaches `theme.lodDetailMinPx`.
 */
export function lodDetailFar(
  lod: ExplicitLodInput | undefined,
  projectedPx: number | null,
  theme: DimensionTheme,
): boolean {
  return lod?.tier === 'detail'
    && projectedPx !== null
    && projectedPx < theme.lodDetailMinPx;
}

/**
 * A dimension line shorter than its tier's label-width ratio cannot carry its
 * value (Q5, per tier since 2026-10-30). A smaller ratio is more permissive;
 * an input with no `tier` counts as `primary`, so a source that never declared
 * a tier keeps the mid-range behaviour rather than silently tightening.
 */
export function lodShortLine(
  lineLengthPx: number,
  labelWidthPx: number,
  theme: DimensionTheme,
  tier: ExplicitLodInput['tier'] = 'primary',
): boolean {
  const ratio = theme.lodMinLineToLabelRatio[tier ?? 'primary'];
  return lineLengthPx < labelWidthPx * ratio;
}

/** The tier rules in their fixed order: secondary first, then detail. */
export function lodTierHiddenReason(
  lod: ExplicitLodInput | undefined,
  projectedPx: number | null,
  theme: DimensionTheme,
): Extract<ExplicitLodHiddenReason, 'secondary-far' | 'detail-far'> | null {
  if (lodSecondaryFar(lod, projectedPx, theme)) return 'secondary-far';
  if (lodDetailFar(lod, projectedPx, theme)) return 'detail-far';
  return null;
}
