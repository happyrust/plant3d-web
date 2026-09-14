import { isSceneVertexVisible, sceneVertex } from '../geometry/sceneGeometry';

import type { ViewportProjector } from '../projector';
import type { DimensionTheme } from '../theme';
import type {
  LayoutResult,
  OcclusionProbeHints,
  OcclusionSource,
  Vec3,
} from '../types';

/**
 * Where the inspection pass tests a drawn layout, and what the host has to
 * know to answer fairly (`hints.subject`: the object the probe sits on;
 * `hints.onModel`: it sits on the model without naming an object).
 */
export type OcclusionProbe = Readonly<{
  point: Vec3;
  hints?: OcclusionProbeHints;
}>;

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
 * probed at its value text (the 3D anchor above), which stands in free
 * space off the pipe. A billboard tag's anchor sits on or inside the object
 * it names (an elbow's corner point, a valve's origin, a connection at the
 * bore centre), and a weld mark's anchor is the weld point on the bore axis
 * — inside the WELD component's own bead and the pipe wall — so a plain ray
 * to either would hit that very object from every direction and the record
 * would always fade (BRAN 24381_145018, 2026-09-13; 27 / 27 weld marks of
 * BRAN 24381_146979, 2026-09-14):
 *
 * - a record that knows its object (`derived.tag.subject`, or
 *   `derived.subject` for a weld mark) is probed at the anchor with the
 *   subject as a hint — the host leaves out that object and any body the
 *   anchor lies inside, so the record fades exactly when *other* geometry
 *   hides the thing it names (user's call, 2026-09-13 22:1x);
 * - a tag without one (branch head / tail cards, the branch name) is still
 *   probed at its anchor, as a point on the model (`onModel`): the host
 *   leaves out the bodies the anchor lies inside — the tube whose end it
 *   is, the fitting bolted to it — and anything else in front hides it.
 *   (Until 2026-09-14 such a tag was probed where its body is, at the
 *   anchor's depth; on a 20 mm branch drawn 100 px wide that point lies
 *   inside the very component from both sides — BRAN 24381_104746 — and
 *   the card was always faded.)
 *
 * Null for an elided layout.
 */
export function occlusionProbe(layout: LayoutResult): OcclusionProbe | null {
  const anchor = layoutAnchor(layout);
  if (!anchor) return null;
  const tag = layout.derived.tag;
  const subject = tag?.subject ?? layout.derived.subject;
  if (subject) return { point: anchor, hints: { subject } };
  if (tag) return { point: anchor, hints: { onModel: true } };
  return { point: anchor };
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
 * whether visible model geometry stands in between (for a tag, other than
 * the object it names — see `occlusionProbe`). The result is written
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
    // A probe outside the frustum (behind the camera on a close-up) has no
    // pixel to cast through — the painter clips what hangs off it — so the
    // record is not hidden by geometry; it is simply not in view.
    if (!isSceneVertexVisible(sceneVertex(probe.point), projector)) {
      return { ...layout, derived: { ...layout.derived, occluded: false } };
    }
    const origin = rayOrigin(probe.point, projector);
    if (!origin) return layout;
    const toleranceM = occlusionToleranceM(probe.point, projector, theme);
    const occluded = probe.hints
      ? source.isSegmentBlocked(origin, probe.point, toleranceM, probe.hints)
      : source.isSegmentBlocked(origin, probe.point, toleranceM);
    return { ...layout, derived: { ...layout.derived, occluded } };
  });
}
