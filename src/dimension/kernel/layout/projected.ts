import { makeScreenLine } from '../geometry/screenGeometry';
import { resolveDimensionStyleRole } from '../theme';
import { dot3, EPSILON, length3, normalize3, scale3, add3, sub3 } from '../vec';

import { emptyLayout, layoutLinearBetween } from './linear';

import type {
  LayoutResult,
  NormalizedDimensionInput,
  Vec2,
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
  const project = (point: typeof input.a): Vec2 => {
    const screen = context.projector.project(point);
    return [screen.x, screen.y];
  };
  const projectedBScreen = project(projectedB);
  const projectionLines = [
    makeScreenLine(project(input.a), projectedBScreen, 'projection', styleRole),
    makeScreenLine(project(input.b), projectedBScreen, 'projection', styleRole),
  ] as const;

  return layoutLinearBetween(
    input,
    { a: input.a, b: projectedB, placement: input.placement },
    context,
    projectionLines,
  );
}
