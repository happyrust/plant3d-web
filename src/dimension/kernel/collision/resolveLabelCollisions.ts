import { translateRect } from '../geometry/screenGeometry';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { LabelOccupancy } from './occupancy';

import type { DimensionTheme } from '../theme';
import type {
  HitRegion,
  LayoutPrimitive,
  LayoutResult,
  SceneGlyphRun,
  ScenePrimitive,
  SceneVertex,
  ScreenLine,
  ScreenRect,
  Vec2,
} from '../types';

// Candidate step / count and the extended-search batch size live in
// `theme.declutter` (T1.5); the occupancy grid (moved to `occupancy.ts` so the
// polar screen guard can share it) and the direction cycle are algorithm
// structure and stay here.
const DIRECTIONS: readonly Vec2[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pointInRect(point: Vec2, rect: ScreenRect): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.width &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.height
  );
}

function movePoint(point: Vec2, offset: Vec2): Vec2 {
  return [point[0] + offset[0], point[1] + offset[1]];
}

function moveSceneVertex(vertex: SceneVertex, offset: Vec2): SceneVertex {
  return {
    ...vertex,
    offsetPx: movePoint(vertex.offsetPx, offset),
  };
}

function moveSceneLabel(
  result: LayoutResult,
  originalBounds: ScreenRect,
  offset: Vec2,
): readonly ScenePrimitive[] {
  const source = result.scenePrimitives ?? [];
  let projectedIndex = 0;
  let connectedLeader = false;
  // Collected into an array rather than a `let … ??=` inside the callback: the
  // control-flow analysis does not see assignments made in the closure, and
  // would narrow the variable to `never` after the guard below.
  const primaryGlyphs: SceneGlyphRun[] = [];
  const moved = source.map((primitive): ScenePrimitive => {
    if (primitive.kind === 'scene-triangle') {
      projectedIndex += 3;
      return primitive;
    }
    const projected = result.primitives[projectedIndex];
    projectedIndex += 1;
    if (primitive.kind === 'scene-glyph-run') {
      if (primaryGlyphs.length === 0) primaryGlyphs.push(primitive);
      return { ...primitive, at: moveSceneVertex(primitive.at, offset) };
    }
    if (
      primitive.kind === 'scene-line'
      && primitive.part === 'leader'
      && projected?.kind === 'line'
    ) {
      const moveFrom = pointInRect(projected.from, originalBounds);
      const moveTo = pointInRect(projected.to, originalBounds);
      if (moveFrom || moveTo) connectedLeader = true;
      return {
        ...primitive,
        from: moveFrom ? moveSceneVertex(primitive.from, offset) : primitive.from,
        to: moveTo ? moveSceneVertex(primitive.to, offset) : primitive.to,
      };
    }
    return primitive;
  });
  const primaryGlyph = primaryGlyphs[0];
  if (connectedLeader || primaryGlyph === undefined) return moved;
  const glyphIndex = moved.findIndex(
    primitive => primitive.kind === 'scene-glyph-run',
  );
  moved.splice(glyphIndex < 0 ? moved.length : glyphIndex, 0, {
    kind: 'scene-line',
    from: primaryGlyph.at,
    to: moveSceneVertex(primaryGlyph.at, offset),
    part: 'leader',
    styleRole: primaryGlyph.styleRole,
  });
  return moved;
}

function moveConnectedLine(line: ScreenLine, originalBounds: ScreenRect, offset: Vec2): ScreenLine {
  return {
    ...line,
    from: pointInRect(line.from, originalBounds) ? movePoint(line.from, offset) : line.from,
    to: pointInRect(line.to, originalBounds) ? movePoint(line.to, offset) : line.to,
  };
}

function moveConnectedHitRegion(
  region: HitRegion,
  originalBounds: ScreenRect,
  offset: Vec2,
): HitRegion {
  if (region.kind === 'rect' && region.part === 'label') {
    return { ...region, rect: translateRect(region.rect, offset) };
  }
  if (region.kind === 'segment' && region.part === 'leader') {
    return {
      ...region,
      from: pointInRect(region.from, originalBounds)
        ? movePoint(region.from, offset)
        : region.from,
      to: pointInRect(region.to, originalBounds) ? movePoint(region.to, offset) : region.to,
    };
  }
  return region;
}

function moveLabel(result: LayoutResult, offset: Vec2): LayoutResult {
  const originalBounds = result.labelBounds;
  const originalCenter: Vec2 = [
    originalBounds.x + originalBounds.width / 2,
    originalBounds.y + originalBounds.height / 2,
  ];
  const movedCenter = movePoint(originalCenter, offset);
  let hasConnectedLeader = false;
  const primitives: LayoutPrimitive[] = result.primitives.map((primitive) => {
    if (primitive.kind === 'glyph-run') {
      return {
        ...primitive,
        origin: movePoint(primitive.origin, offset),
        bounds: translateRect(primitive.bounds, offset),
      };
    }
    if (
      primitive.kind === 'line' &&
      primitive.part === 'leader' &&
      (pointInRect(primitive.from, originalBounds) || pointInRect(primitive.to, originalBounds))
    ) {
      hasConnectedLeader = true;
      return moveConnectedLine(primitive, originalBounds, offset);
    }
    return primitive;
  });
  const hitRegions = result.hitRegions.map((region) =>
    moveConnectedHitRegion(region, originalBounds, offset),
  );

  if (!hasConnectedLeader) {
    const glyphIndex = primitives.findIndex((primitive) => primitive.kind === 'glyph-run');
    const glyph = primitives[glyphIndex];
    const leader: ScreenLine = {
      kind: 'line',
      from: originalCenter,
      to: movedCenter,
      part: 'leader',
      styleRole: glyph?.styleRole ?? 'normal',
    };
    primitives.splice(glyphIndex < 0 ? primitives.length : glyphIndex, 0, leader);
    const labelHitIndex = hitRegions.findIndex(
      (region) => region.kind === 'rect' && region.part === 'label',
    );
    hitRegions.splice(labelHitIndex < 0 ? hitRegions.length : labelHitIndex, 0, {
      kind: 'segment',
      from: leader.from,
      to: leader.to,
      widthPx: 1,
      part: 'leader',
    });
  }

  return {
    ...result,
    scenePrimitives: moveSceneLabel(result, originalBounds, offset),
    primitives,
    hitRegions,
    labelBounds: translateRect(originalBounds, offset),
  };
}

/**
 * Label-less layouts (weld marks, leader lines, aid points) still carry an
 * empty glyph run whose padded bounds are a few pixels wide. They must not
 * reserve or compete for label space, or a weld-dense branch pushes every
 * real dimension label around for nothing.
 */
function hasLabelText(result: LayoutResult): boolean {
  return result.derived.formattedLabel.length > 0;
}

/**
 * Move automatic labels off pinned labels and off each other (stable id
 * order). `bounds` is the viewport: labels beyond it are left alone (see
 * `LabelOccupancy`); omitted = every label takes part wherever it projects.
 * `rules` (default: the SolveSpace theme's `declutter`) sets the probe step
 * and count, and the batch size above which the extra probe is dropped.
 */
export function resolveLabelCollisions(
  inputs: readonly LayoutResult[],
  bounds?: ScreenRect,
  rules: DimensionTheme['declutter'] = SOLVESPACE_DIMENSION_THEME.declutter,
): readonly LayoutResult[] {
  // ponytail: one extra probe for small overlays; use adaptive search if large
  // MBD batches need the same density without exceeding the performance budget.
  const candidateCount = inputs.length <= rules.extendedSearchMaxLabels
    ? rules.candidateCount + 1
    : rules.candidateCount;
  const occupancy = new LabelOccupancy(bounds);
  const results = [...inputs];
  for (const result of inputs) {
    if (result.labelPinned && hasLabelText(result)) {
      occupancy.insert(result.labelBounds);
    }
  }

  const automatic = inputs
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => !result.labelPinned && hasLabelText(result))
    .sort((a, b) => compareIds(a.result.dimensionId, b.result.dimensionId) || a.index - b.index);

  for (const { result, index } of automatic) {
    if (!occupancy.overlaps(result.labelBounds)) {
      occupancy.insert(result.labelBounds);
      continue;
    }

    let resolved: LayoutResult | undefined;
    for (let candidate = 0; candidate < candidateCount; candidate += 1) {
      const direction = DIRECTIONS[candidate % DIRECTIONS.length];
      if (direction === undefined) continue;
      const distance = (candidate + 1) * rules.candidateStepPx;
      const offset = [direction[0] * distance, direction[1] * distance] as const;
      if (occupancy.overlapsAt(result.labelBounds, offset[0], offset[1])) continue;
      resolved = moveLabel(result, offset);
      break;
    }

    if (resolved) {
      results[index] = resolved;
      occupancy.insert(resolved.labelBounds);
    } else {
      occupancy.insert(result.labelBounds);
    }
  }

  return results;
}
