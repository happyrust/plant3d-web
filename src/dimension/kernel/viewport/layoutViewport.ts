import { resolveLabelCollisions } from '../collision/resolveLabelCollisions';
import { buildHitIndex, type HitIndex } from '../hit/hitIndex';
import { declutterOverlaps } from '../layout/declutterPolicy';
import { layoutDimension } from '../layout/layoutDimension';
import { emptyLayout } from '../layout/linear';
import { markOcclusion } from '../layout/occlusionPolicy';
import {
  collectTagObstacles,
  isTagBillboardPlan,
  placeTagBillboards,
  planTagBillboard,
  type PlannedTag,
} from '../layout/tagBillboard';

import type { LayoutContext } from '../layout/context';
import type {
  DimensionDisplayMode,
  ExplicitLayoutInput,
  InteractionState,
  LayoutObstacleSource,
  LayoutResult,
  NormalizedDimensionInput,
  OcclusionSource,
} from '../types';

export type ViewportLayoutBatch = Readonly<{
  layouts: readonly LayoutResult[];
  hitIndex: HitIndex;
}>;

export type ViewportLayoutOptions = Readonly<{
  /**
   * Model component boxes around the billboard tags; omitted = the tags only
   * keep clear of labels and dimension strokes.
   */
  obstacles?: LayoutObstacleSource;
  /**
   * Ray-cast seam for the inspection pass; omitted = nothing is ever flagged
   * occluded (inspection then paints everything at its visible alpha).
   */
  occlusion?: OcclusionSource;
  /** Defaults to `engineering`: no occlusion probing at all. */
  displayMode?: DimensionDisplayMode;
}>;

export function layoutViewport(
  inputs: readonly (NormalizedDimensionInput | ExplicitLayoutInput)[],
  baseContext: Omit<LayoutContext, 'interaction'>,
  interactionById: ReadonlyMap<string, InteractionState>,
  options: ViewportLayoutOptions = {},
): ViewportLayoutBatch {
  const normalContext: LayoutContext = {
    ...baseContext,
    interaction: 'normal',
  };
  const raw = new Array<LayoutResult>(inputs.length);
  const tags: PlannedTag[] = [];
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
  // surviving labels, of the dimension strokes, of the component boxes the
  // host reports around them, and of each other.
  const decluttered = declutterOverlaps(raw);
  const placed = resolveLabelCollisions(
    placeTagBillboards(
      decluttered,
      tags,
      collectTagObstacles(decluttered, tags, baseContext.projector, options.obstacles),
    ),
  );
  // Inspection (S4): once every record has its final geometry, ask the host
  // which of them sit behind model geometry; the painter fades those.
  const layouts = options.displayMode === 'inspection' && options.occlusion
    ? markOcclusion(placed, baseContext.projector, options.occlusion, baseContext.theme)
    : placed;
  return { layouts, hitIndex: buildHitIndex(layouts) };
}
