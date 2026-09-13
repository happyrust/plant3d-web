import type { ViewportProjector } from '../projector';
import type { DimensionTheme } from '../theme';
import type { LayoutResult, OcclusionSource, Vec3 } from '../types';

/**
 * The 3D anchor a drawn layout hangs off: its first glyph run's anchor (the
 * value text of a dimension, the pipe point a billboard tag's leader points
 * at), else its first scene vertex. Null for an elided layout.
 */
function layoutAnchor(layout: LayoutResult): Vec3 | null {
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
 * The point the inspection pass tests a drawn layout at. A dimension is
 * probed at its value text (the 3D anchor above). A billboard tag is probed
 * where its body is: the body's screen centre unprojected at the anchor's
 * depth — the tag's anchor itself sits on or inside the component it names
 * (a valve's origin, a pipe end's centre), so a ray to the anchor would hit
 * that very component from every direction and the tag would always fade;
 * what matters for a call-out card is whether something nearer than its
 * anchor is drawn where the card is. Null for an elided layout.
 */
export function occlusionProbe(
  layout: LayoutResult,
  projector: ViewportProjector,
): Vec3 | null {
  const anchor = layoutAnchor(layout);
  if (!anchor) return null;
  const tag = layout.derived.tag;
  if (!tag) return anchor;
  const depth = projector.project(anchor).depth;
  const probe = projector.unproject({
    x: tag.body.x + tag.body.width / 2,
    y: tag.body.y + tag.body.height / 2,
    depth,
  });
  return probe.every(Number.isFinite) ? probe : anchor;
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
    const probe = occlusionProbe(layout, projector);
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
