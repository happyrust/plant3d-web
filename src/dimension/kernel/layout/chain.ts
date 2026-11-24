import { add3, dot3, EPSILON, length3, normalize3, scale3, sub3 } from '../vec';

import { emptyLayout, layoutLinearBetween } from './linear';

import type { LayoutContext } from './context';
import type {
  LayoutResult,
  NormalizedDimensionInput,
  ScreenGlyphRun,
  Vec3,
} from '../types';

function projectOnto(origin: Vec3, direction: Vec3, point: Vec3): Vec3 {
  return add3(origin, scale3(direction, dot3(sub3(point, origin), direction)));
}

function unionBounds(results: readonly LayoutResult[]): LayoutResult['labelBounds'] {
  const boxes = results.filter(result => result.labelBounds.width > 0 || result.labelBounds.height > 0);
  const source = boxes.length > 0 ? boxes : results;
  const left = Math.min(...source.map(result => result.labelBounds.x));
  const top = Math.min(...source.map(result => result.labelBounds.y));
  const right = Math.max(...source.map(result => result.labelBounds.x + result.labelBounds.width));
  const bottom = Math.max(...source.map(result => result.labelBounds.y + result.labelBounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * 一条链是同一条基线上的相邻尺寸，再加可选的首尾总长（#74）。
 * 各段沿同一个尺寸方向投影，所以转相机不改每一段的设计长度。
 */
export function layoutChain(
  input: Extract<NormalizedDimensionInput, { kind: 'chain' }>,
  context: LayoutContext,
): LayoutResult {
  if (input.anchors.length < 2) {
    return emptyLayout(input.id, input.labelPinned, '', undefined, ['CHAIN_TOO_SHORT']);
  }
  const origin = input.anchors[0]!;
  const last = input.anchors[input.anchors.length - 1]!;
  const rawDirection = input.directions?.dimensionDirection ?? sub3(last, origin);
  if (length3(rawDirection) <= EPSILON) {
    return emptyLayout(input.id, input.labelPinned, '', undefined, ['DEGENERATE_DIMENSION_DIRECTION']);
  }
  const direction = normalize3(rawDirection);
  const projected = input.anchors.map(anchor => projectOnto(origin, direction, anchor));
  const errors: string[] = [];
  const segments: LayoutResult[] = [];
  let overall: LayoutResult | null = null;

  const placeSegment = (
    index: string,
    a: Vec3,
    b: Vec3,
    placement: typeof input.placement,
  ): LayoutResult | null => {
    if (length3(sub3(b, a)) <= EPSILON) {
      errors.push('DEGENERATE_DIMENSION_DIRECTION');
      return null;
    }
    const linear: Extract<NormalizedDimensionInput, { kind: 'linear' }> = {
      id: `${input.id}:${index}`,
      role: input.role,
      labelPinned: input.labelPinned,
      kind: 'linear',
      a,
      b,
      placement,
      ...(input.directions ? { directions: input.directions } : {}),
    };
    return layoutLinearBetween(linear, linear, context, [], {
      dimensionDirection: direction,
      offsetDirection: input.directions?.offsetDirection ?? null,
    });
  };

  for (let index = 0; index < projected.length - 1; index += 1) {
    const segment = placeSegment(String(index), projected[index]!, projected[index + 1]!, input.placement);
    if (segment) segments.push(segment);
  }
  if (input.showOverall && projected.length > 2) {
    overall = placeSegment('overall', projected[0]!, projected[projected.length - 1]!, {
      ...input.placement,
      offsetM: input.placement.offsetM + 0.2,
    });
  }
  const parts = overall ? [...segments, overall] : segments;
  if (parts.length === 0) {
    return emptyLayout(input.id, input.labelPinned, '', undefined, errors);
  }

  const labels = parts.flatMap(part =>
    part.primitives
      .filter((primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run')
      .map(glyph => glyph.text));
  const valueM = segments.reduce((sum, part) => sum + (part.derived.valueM ?? 0), 0);
  return {
    dimensionId: input.id,
    scenePrimitives: parts.flatMap(part => part.scenePrimitives),
    primitives: parts.flatMap(part => part.primitives),
    hitRegions: parts.flatMap(part => part.hitRegions),
    labelBounds: unionBounds(parts),
    labelPinned: input.labelPinned,
    derived: {
      valueM,
      formattedLabel: labels.join(' · '),
      ...(errors.length > 0 ? { validationErrors: errors } : {}),
    },
  };
}
