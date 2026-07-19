import {
  expandRect,
  makeCenteredGlyphRun,
  makeGlyphHitRegion,
  makeLineHitRegion,
  makeScreenLine,
} from '../geometry/screenGeometry';
import { resolveDimensionStyleRole } from '../theme';

import type {
  ExplicitLayoutInput,
  LayoutResult,
  ScreenLine,
  Vec2,
  Vec3,
} from '../types';
import type { LayoutContext } from './context';

function toScreen(point: Vec3, context: LayoutContext): Vec2 {
  const projected = context.projector.project(point);
  return [projected.x, projected.y];
}

export function layoutExplicit(
  input: ExplicitLayoutInput,
  context: LayoutContext,
): LayoutResult {
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const lines: ScreenLine[] = [
    ...input.lines.map((line) =>
      makeScreenLine(
        toScreen(line.from, context),
        toScreen(line.to, context),
        line.part,
        styleRole,
      ),
    ),
    ...input.arrowLines.map((line) =>
      makeScreenLine(
        toScreen(line.from, context),
        toScreen(line.to, context),
        'arrow',
        styleRole,
      ),
    ),
  ];
  const glyph = makeCenteredGlyphRun(
    context.font,
    input.formattedLabel,
    toScreen(input.labelAnchor, context),
    context.theme.textHeightPx,
    styleRole,
  );
  const labelBounds = expandRect(glyph.bounds, context.theme.labelPaddingPx / 2);
  const primitives = [...lines, glyph];

  return {
    dimensionId: input.id,
    primitives,
    hitRegions: [
      ...lines.map((line) => makeLineHitRegion(line, context.theme.lineWidthPx)),
      makeGlyphHitRegion(glyph),
    ],
    labelBounds,
    labelPinned: true,
    derived: { formattedLabel: input.formattedLabel },
  };
}
