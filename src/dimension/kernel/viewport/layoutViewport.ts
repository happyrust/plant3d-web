import { LabelOccupancy } from '../collision/occupancy';
import { resolveLabelCollisions } from '../collision/resolveLabelCollisions';
import { HIT_INDEX_CELL_PX, buildHitIndex, type HitIndex } from '../hit/hitIndex';
import { declutterOverlaps } from '../layout/declutterPolicy';
import { layoutDimension } from '../layout/layoutDimension';
import { emptyLayout } from '../layout/linear';
import { markOcclusion } from '../layout/occlusionPolicy';
import { mbdTextLen } from '../layout/polar/numeric/mbdTextLen';
import { polarPlace } from '../layout/polar/place/place';
import { cameraReference } from '../layout/polar/reference/camera';
import { screenGuard, registerChosen } from '../layout/polar/screenGuard';
import {
  collectTagObstacles,
  isTagBillboardPlan,
  placeTagBillboards,
  planTagBillboard,
  type PlannedTag,
} from '../layout/tagBillboard';

import type { LayoutContext } from '../layout/context';
import type { PolarCandidate } from '../layout/polar/place/types';
import type { PolarReference, PolarElement } from '../layout/polar/reference/types';
import type {
  DimensionDisplayMode,
  ExplicitLayoutInput,
  InteractionState,
  LayoutObstacleSource,
  LayoutResult,
  NormalizedDimensionInput,
  OcclusionSource,
  ScreenRect,
  Vec3,
} from '../types';

export type ViewportLayoutBatch = Readonly<{
  layouts: readonly LayoutResult[];
  hitIndex: HitIndex;
  /**
   * Cross-frame polar placement state (T3.6a): feed back as
   * `ViewportLayoutOptions.polarPrevious` on the next call so
   * `cameraReference`'s hysteresis and `screenGuard`'s previous-candidate
   * stability both carry over. Empty when nothing in this batch opted into
   * `ExplicitLayoutInput.polar`.
   */
  polarNext: ReadonlyMap<string, PolarFrameState>;
  /**
   * Count of polar-opted records that fell back to their solver anchor this
   * frame (degenerate reference, or every screen candidate rejected) — a
   * diagnostic signal, not drawn or thrown; 0 when nothing opted in.
   */
  polarFallbacks: number;
}>;

/** One record's polar state carried from this frame into the next. */
export type PolarFrameState = Readonly<{
  reference: PolarReference;
  candidate: PolarCandidate;
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
  /**
   * Last frame's polar state (T3.6a), keyed by record id; omitted or missing
   * entry = first frame for that record (no hysteresis, no previous
   * candidate to prefer).
   */
  polarPrevious?: ReadonlyMap<string, PolarFrameState>;
}>;

/** PML `needangle` (`polarsystem.pmlobj:1157` et al.): fixed, not a per-call tunable. */
const POLAR_NEED_ANGLE_DEG = 30;

/** The pipe body as a single full-circle obstacle (Lead v1 scope: no other same-pipe records yet). */
function polarPipeBodyElement(basicRadiusM: number, disRange: readonly [number, number]): PolarElement {
  return {
    id: 'pipe-body',
    type: 'POLARCYLI',
    dis: disRange,
    angle: [0, 360],
    radius: [0, basicRadiusM],
    basic: true,
  };
}

/**
 * Builds the polar reference + placement + screen guard for one record and
 * returns the anchor/along override to draw with, or `null` when the input
 * did not opt in, the reference is degenerate, or every candidate was
 * rejected on screen — all of which keep the solver's original anchor
 * (point 6 of the plan: never hide a label over a failed polar placement).
 */
function resolvePolarAnchor(
  input: ExplicitLayoutInput,
  context: LayoutContext,
  occupancy: LabelOccupancy,
  previous: PolarFrameState | undefined,
  diagnostics: { fallbacks: number },
  nextState: Map<string, PolarFrameState>,
): Readonly<{ labelAnchor: Vec3; labelAlong: Vec3 }> | null {
  const polar = input.polar;
  if (!polar) return null;
  try {
    const reference = cameraReference({
      projector: context.projector,
      origin: polar.origin,
      axis: polar.axis,
      disRange: polar.disRange,
      basicRadius: polar.basicRadiusM,
      isInstPipe: false,
      previous: previous?.reference ?? null,
    });
    const needDis = mbdTextLen(input.formattedLabel) * polar.textHeightM;
    const result = polarPlace({
      reference,
      elements: [polarPipeBodyElement(polar.basicRadiusM, polar.disRange)],
      needs: [needDis, POLAR_NEED_ANGLE_DEG, polar.textHeightM],
      isDim: false,
    });
    const guard = screenGuard({
      result,
      projector: context.projector,
      textSize: { widthM: needDis, heightM: polar.textHeightM },
      occupancy,
      previous: previous?.candidate ?? null,
    });
    if (guard.allRejected) {
      diagnostics.fallbacks += 1;
      return null;
    }
    registerChosen(occupancy, guard);
    nextState.set(input.id, { reference, candidate: guard.chosen });
    return { labelAnchor: guard.chosen.pos, labelAlong: guard.chosen.textOri.x };
  } catch (error) {
    if (error instanceof RangeError) {
      diagnostics.fallbacks += 1;
      return null;
    }
    throw error;
  }
}

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
  // T3.6a: one occupancy grid for this frame's polar candidates only, kept
  // apart from the label/tag declutter passes below — those run after every
  // layout already has its final anchor, polar just decides what that
  // anchor is for records that opted in. Records are resolved in input
  // order, each `registerChosen` claiming its spot before the next looks.
  const polarOccupancy = new LabelOccupancy();
  const polarDiagnostics = { fallbacks: 0 };
  const polarNext = new Map<string, PolarFrameState>();
  for (const [index, input] of inputs.entries()) {
    const interaction = interactionById.get(input.id) ?? 'normal';
    const context = interaction === 'normal'
      ? normalContext
      : { ...normalContext, interaction };
    // Billboard tags are placed after everything else is known (see below);
    // until then they hold their slot with an empty layout. Polar placement
    // does not reach a tag-presented label (T3.6a v1 scope): the billboard
    // pass below places its body independently of `labelAnchor`.
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
    const polarAnchor = 'polar' in input && input.polar
      ? resolvePolarAnchor(
        input,
        context,
        polarOccupancy,
        options.polarPrevious?.get(input.id),
        polarDiagnostics,
        polarNext,
      )
      : null;
    const resolvedInput = polarAnchor
      ? { ...input, labelAnchor: polarAnchor.labelAnchor, labelAlong: polarAnchor.labelAlong }
      : input;
    raw[index] = layoutDimension(resolvedInput, context);
  }
  // Solver-placed 3D dimension labels are elided pairwise before the moving
  // declutter runs, so a hidden label neither moves anyone nor claims space;
  // billboard tags then take the first candidate position clear of the
  // surviving labels, of the dimension strokes, of the component boxes the
  // host reports around them, and of each other. Both screen grids (label
  // occupancy, hit index) only cover the viewport: what projects beyond it
  // — a vertex near the camera plane lands at 1e5–1e9 px — is neither
  // registered nor queried, so a close-up or a not-yet-framed camera cannot
  // blow the grids up (all-pipes sweep, 2026-09-14).
  const viewport: ScreenRect = {
    x: 0,
    y: 0,
    width: baseContext.projector.widthCssPx,
    height: baseContext.projector.heightCssPx,
  };
  const decluttered = declutterOverlaps(raw);
  const placed = resolveLabelCollisions(
    placeTagBillboards(
      decluttered,
      tags,
      collectTagObstacles(decluttered, tags, baseContext.projector, options.obstacles),
      baseContext.theme.tag,
    ),
    viewport,
    baseContext.theme.declutter,
  );
  // Inspection (S4): once every record has its final geometry, ask the host
  // which of them sit behind model geometry; the painter fades those.
  const layouts = options.displayMode === 'inspection' && options.occlusion
    ? markOcclusion(placed, baseContext.projector, options.occlusion, baseContext.theme)
    : placed;
  return {
    layouts,
    hitIndex: buildHitIndex(layouts, HIT_INDEX_CELL_PX, viewport),
    polarNext,
    polarFallbacks: polarDiagnostics.fallbacks,
  };
}
