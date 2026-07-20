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
  const normalContext: LayoutContext = {
    ...baseContext,
    interaction: 'normal',
  };
  const raw = new Array<LayoutResult>(inputs.length);
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    const interaction = interactionById.get(input.id) ?? 'normal';
    raw[index] = layoutDimension(
      input,
      interaction === 'normal'
        ? normalContext
        : { ...normalContext, interaction },
    );
  }
  const layouts = resolveLabelCollisions(raw);
  return { layouts, hitIndex: buildHitIndex(layouts) };
}
