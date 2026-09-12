import { resolveLabelCollisions } from '../collision/resolveLabelCollisions';
import { buildHitIndex, type HitIndex } from '../hit/hitIndex';
import { declutterOverlaps } from '../layout/declutterPolicy';
import { layoutDimension } from '../layout/layoutDimension';

import type { LayoutContext } from '../layout/context';
import type {
  ExplicitLayoutInput,
  InteractionState,
  LayoutResult,
  NormalizedDimensionInput,
} from '../types';

export type ViewportLayoutBatch = Readonly<{
  layouts: readonly LayoutResult[];
  hitIndex: HitIndex;
}>;

export function layoutViewport(
  inputs: readonly (NormalizedDimensionInput | ExplicitLayoutInput)[],
  baseContext: Omit<LayoutContext, 'interaction'>,
  interactionById: ReadonlyMap<string, InteractionState>,
): ViewportLayoutBatch {
  const normalContext: LayoutContext = {
    ...baseContext,
    interaction: 'normal',
  };
  const raw = new Array<LayoutResult>(inputs.length);
  for (const [index, input] of inputs.entries()) {
    const interaction = interactionById.get(input.id) ?? 'normal';
    raw[index] = layoutDimension(
      input,
      interaction === 'normal'
        ? normalContext
        : { ...normalContext, interaction },
    );
  }
  // Solver-placed 3D dimension labels are elided pairwise before the moving
  // declutter runs, so a hidden label neither moves anyone nor claims space.
  const layouts = resolveLabelCollisions(declutterOverlaps(raw));
  return { layouts, hitIndex: buildHitIndex(layouts) };
}
