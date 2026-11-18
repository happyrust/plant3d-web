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
 * declares none (or the projector cannot say): the true geometric projection
 * used when sizing drawn text.
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
 * Design-space source text height floor (`2 mm`) for close-up LOD visibility
 * gates (#138).
 *
 * At the room / floor-slab camera near clipping plane (`near = 0.1 m`),
 * `metresPerPixel` bottoms out around `0.09–0.105 mm/px`, so any source text
 * `>= 2 mm` already reaches `lodDetailMinPx` (`18 px`) naturally outside `near`,
 * whereas `< 2 mm` text (`0.4–1 mm` on 1 mm civil/arch clearances, `1–2 mm` on
 * EM9 pipe slope marks) can never reach `18 px` before clipping.
 *
 * Clamping the LOD gate's effective source height at `2 mm` (`0.002 m`) —
 * without altering drawn geometry — guarantees a reachable close-up distance
 * outside `camera.near` while keeping `100%` of whole-object / fit-to-bounds
 * views identical to baseline.
 */
export const LOD_EFFECTIVE_SOURCE_TEXT_MIN_M = 0.002;

/**
 * Effective line-length scale factor applied to `< 2 mm`-text dimensions once
 * the camera has already entered the close-up gate (`lodProjectedPx >= lodDetailMinPx`),
 * so `~1.2 mm` clearance runs whose text height was shrunk with the gap are not
 * permanently deleted by `lodShortLine` against the `13 px`-floored label width.
 */
export const LOD_CLOSEUP_SHORT_LINE_REF_TEXT_M = 0.006;

export function lodCloseUpLineScale(
  textHeightM: number | undefined,
  lodProjectedPx: number | null,
  theme: DimensionTheme,
): number {
  if (
    textHeightM === undefined
    || !(textHeightM > 0)
    || textHeightM >= LOD_EFFECTIVE_SOURCE_TEXT_MIN_M
    || lodProjectedPx === null
    || lodProjectedPx < theme.lodDetailMinPx
  ) {
    return 1;
  }
  return LOD_CLOSEUP_SHORT_LINE_REF_TEXT_M / textHeightM;
}

export function lodProjectedSourceTextHeightPx(
  textHeightM: number | undefined,
  metresPerPixel: number,
): number | null {
  return textHeightM !== undefined && textHeightM > 0
    ? projectedSourceTextHeightPx(
      Math.max(textHeightM, LOD_EFFECTIVE_SOURCE_TEXT_MIN_M),
      metresPerPixel,
    )
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
