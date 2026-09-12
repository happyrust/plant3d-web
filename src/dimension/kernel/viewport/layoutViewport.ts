import { resolveLabelCollisions } from '../collision/resolveLabelCollisions';
import { buildHitIndex, type HitIndex } from '../hit/hitIndex';
import { declutterOverlaps } from '../layout/declutterPolicy';
import { layoutDimension } from '../layout/layoutDimension';
import { emptyLayout } from '../layout/linear';
import {
  isTagBillboardPlan,
  placeTagBillboards,
  planTagBillboard,
  type TagBillboardPlan,
} from '../layout/tagBillboard';

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
  const tags: { index: number; id: string; plan: TagBillboardPlan }[] = [];
  for (const [index, input] of inputs.entries()) {
    const interaction = interactionById.get(input.id) ?? 'normal';
    const context = interaction === 'normal'
      ? normalContext
      : { ...normalContext, interaction };
    // Billboard tags are placed after everything else is known (see below);
    // until then they hold their slot with an empty layout.
    if ('tag' in input && input.tag) {
      const planned = planTagBillboard(input, input.tag, context);
      if (isTagBillboardPlan(planned)) {
        tags.push({ index, id: input.id, plan: planned });
        raw[index] = emptyLayout(input.id, input.labelPinned, input.formattedLabel);
      } else {
        raw[index] = planned;
      }
      continue;
    }
    raw[index] = layoutDimension(input, context);
  }
  // Solver-placed 3D dimension labels are elided pairwise before the moving
  // declutter runs, so a hidden label neither moves anyone nor claims space;
  // billboard tags then take the first candidate position clear of the
  // surviving labels and of each other.
  const layouts = resolveLabelCollisions(
    placeTagBillboards(declutterOverlaps(raw), tags),
  );
  return { layouts, hitIndex: buildHitIndex(layouts) };
}
