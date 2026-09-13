import type { ViewportProjector } from '../projector';
import type { DimensionTheme } from '../theme';
import type { LayoutResult, OcclusionSource, Vec3 } from '../types';

/**
 * The point the inspection pass tests a drawn layout at: the 3D anchor of
 * its first glyph run (the value text of a dimension, the anchor a billboard
 * tag hangs off), else its first scene vertex. Null for an elided layout —
 * there is nothing to fade.
 */
export function occlusionProbe(layout: LayoutResult): Vec3 | null {
  if (layout.primitives.length === 0) return null;
  for (const primitive of layout.scenePrimitives) {
    if (primitive.kind === 'scene-glyph-run') return primitive.at.anchor;
  }
  for (const primitive of layout.scenePrimitives) {
    switch (primitive.kind) {
      case 'scene-line':
        return primitive.from.anchor;
      case 'scene-path':
      case 'scene-fill':
        return primitive.points[0]?.anchor ?? null;
      case 'scene-triangle':
        return primitive.points[0].anchor;
      case 'scene-marker':
        return primitive.at.anchor;
      default:
        return null;
    }
  }
  return null;
}

/**
 * Where the view ray through `probe` enters the frustum (its pixel's
 * near-plane point): the cast starts there rather than at the camera, so
 * geometry the renderer clips anyway does not count as an occluder.
 */
function rayOrigin(probe: Vec3, projector: ViewportProjector): Vec3 | null {
  const screen = projector.project(probe);
  const near = projector.unproject({ x: screen.x, y: screen.y, depth: -1 });
  return near.every(Number.isFinite) ? near : null;
}

/**
 * Occlusion tolerance at the probe's depth: the larger of the theme's model
 * distance (mm) and screen distance (px), so a hit on the very surface the
 * probe sits on never counts and the outcome is stable to float noise.
 */
export function occlusionToleranceM(
  probe: Vec3,
  projector: ViewportProjector,
  theme: DimensionTheme,
): number {
  const perPixel = projector.worldPerPixelAt(probe);
  return Math.max(
    theme.inspection.toleranceMm / 1000,
    Number.isFinite(perPixel) ? theme.inspection.tolerancePx * perPixel : 0,
  );
}

/**
 * Inspection pass (S4, 2026-09-13): every drawn layout is tested with one
 * ray cast from its probe's near-plane point to the probe; the host answers
 * whether visible model geometry stands in between. The result is written
 * to `derived.occluded` for the painter to fade the whole record — nothing
 * is hidden or moved, and the same camera / model state yields the same
 * flags. Elided layouts and layouts without a probe are passed through.
 */
export function markOcclusion(
  layouts: readonly LayoutResult[],
  projector: ViewportProjector,
  source: OcclusionSource,
  theme: DimensionTheme,
): LayoutResult[] {
  return layouts.map((layout) => {
    const probe = occlusionProbe(layout);
    if (!probe) return layout;
    const origin = rayOrigin(probe, projector);
    if (!origin) return layout;
    const occluded = source.isSegmentBlocked(
      origin,
      probe,
      occlusionToleranceM(probe, projector, theme),
    );
    return { ...layout, derived: { ...layout.derived, occluded } };
  });
}
