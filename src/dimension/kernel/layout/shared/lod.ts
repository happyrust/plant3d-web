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

/** A `secondary` input disappears while its source text projects below the theme floor. */
export function lodSecondaryFar(
  lod: ExplicitLodInput | undefined,
  projectedPx: number | null,
  theme: DimensionTheme,
): boolean {
  return lod?.tier === 'secondary'
    && projectedPx !== null
    && projectedPx < theme.sourceTextHeightMinPx;
}

/** A `detail` input (slope marks, skew aids, branch name) is a close-up only. */
export function lodDetailFar(
  lod: ExplicitLodInput | undefined,
  projectedPx: number | null,
  theme: DimensionTheme,
): boolean {
  return lod?.tier === 'detail'
    && projectedPx !== null
    && projectedPx < theme.sourceTextHeightMaxPx;
}

/** A dimension line shorter than `lodMinLineToLabelRatio` label widths cannot carry its value. */
export function lodShortLine(
  lineLengthPx: number,
  labelWidthPx: number,
  theme: DimensionTheme,
): boolean {
  return lineLengthPx < labelWidthPx * theme.lodMinLineToLabelRatio;
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
