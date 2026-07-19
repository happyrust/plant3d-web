import { resolveLabelCollisions } from '../collision/resolveLabelCollisions';
import { buildHitIndex, type HitIndex } from '../hit/hitIndex';
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
  const raw = inputs.map((input) =>
    layoutDimension(input, {
      ...baseContext,
      interaction: interactionById.get(input.id) ?? 'normal',
    }),
  );
  const layouts = resolveLabelCollisions(raw);
  return { layouts, hitIndex: buildHitIndex(layouts) };
}
