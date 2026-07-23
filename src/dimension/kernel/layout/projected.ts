import { makeSceneLine, sceneVertex } from '../geometry/sceneGeometry';
import { resolveDimensionStyleRole } from '../theme';
import { dot3, EPSILON, length3, normalize3, scale3, add3, sub3 } from '../vec';

import { emptyLayout, layoutLinearBetween } from './linear';

import type {
  LayoutResult,
  NormalizedDimensionInput,
} from '../types';
import type { LayoutContext } from './context';

export function layoutProjected(
  input: Extract<NormalizedDimensionInput, { kind: 'projected' }>,
  context: LayoutContext,
): LayoutResult {
  if (length3(input.axis) <= EPSILON) return emptyLayout(input.id, input.labelPinned);

  const axis = normalize3(input.axis);
  const signedProjection = dot3(sub3(input.b, input.a), axis);
  const projectedB = add3(input.a, scale3(axis, signedProjection));
  const styleRole = resolveDimensionStyleRole(input.role, context.interaction);
  const projectionLines = [
    makeSceneLine(
      sceneVertex(input.a),
      sceneVertex(projectedB),
      'projection',
      styleRole,
    ),
    makeSceneLine(
      sceneVertex(input.b),
      sceneVertex(projectedB),
      'projection',
      styleRole,
    ),
  ] as const;

  return layoutLinearBetween(
    input,
    { a: input.a, b: projectedB, placement: input.placement },
    context,
    projectionLines,
  );
}
