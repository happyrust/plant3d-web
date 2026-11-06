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
import { screenGuard } from '../layout/polar/screenGuard';
import {
  collectTagObstacles,
  isTagBillboardPlan,
  placeTagBillboards,
  planTagBillboard,
  type PlannedTag,
} from '../layout/tagBillboard';

import { polarCandidateObstacle, siblingAnchorObstacle } from './polarObstacles';

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
 * T3.6b: seeds `groupObstacles` with every non-polar sibling's anchor
 * (`ExplicitLayoutInput.polarObstacle`, plan point 1's second bullet) before
 * the main loop runs, so a sibling's position in `inputs` relative to its
 * group's polar records does not matter — unlike the polar-candidate
 * obstacles the main loop adds as it goes (those are genuinely
 * input-order-dependent: a record can only avoid what was placed before
 * it), a sibling's anchor is a fact the solver already settled, independent
 * of where in the array it happens to sort.
 *
 * One `PolarReference` per `groupKey`, built once from the group's first
 * `polar`-opted input (every member of a group shares the same
 * `origin`/`axis` by `ExplicitPolarInput.groupKey`'s own contract, so the
 * `plane`/`showDir` {@link siblingAnchorObstacle} needs are the same
 * regardless of which member's `polar` fields built it); a group with no
 * polar-opted input yet this frame contributes nothing (nothing to avoid
 * relative to — v1 behaviour for that group this frame).
 */
function seedSiblingObstacles(
  inputs: readonly (NormalizedDimensionInput | ExplicitLayoutInput)[],
  baseContext: Omit<LayoutContext, 'interaction'>,
  polarPrevious: ReadonlyMap<string, PolarFrameState> | undefined,
  groupObstacles: Map<string, PolarElement[]>,
): void {
  const referenceByGroup = new Map<string, PolarReference>();
  const defaultTextHeightByGroup = new Map<string, number>();
  for (const input of inputs) {
    if (!('polar' in input) || !input.polar?.groupKey) continue;
    const { groupKey, origin, axis, disRange, basicRadiusM, textHeightM } = input.polar;
    if (referenceByGroup.has(groupKey)) continue;
    try {
      // Hysteresis consistency: this representative's own previous-frame
      // reference, same as `resolvePolarAnchor` will use for it a few lines
      // down in the main loop — so the seed reference's `showDir` matches
      // what that record resolves with, not an independent `previous: null`
      // recompute that could disagree with it by up to the hysteresis band.
      referenceByGroup.set(groupKey, cameraReference({
        projector: baseContext.projector,
        origin,
        axis,
        disRange,
        basicRadius: basicRadiusM,
        isInstPipe: false,
        previous: polarPrevious?.get(input.id)?.reference ?? null,
      }));
      defaultTextHeightByGroup.set(groupKey, textHeightM);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // Degenerate axis: `resolvePolarAnchor` will hit the same RangeError
      // for every polar-opted member of this group and fall back to its
      // solver anchor, so there is nothing to seed obstacles against either.
    }
  }
  if (referenceByGroup.size === 0) return;

  for (const input of inputs) {
    if (!('polarObstacle' in input) || !input.polarObstacle) continue;
    const { groupKey } = input.polarObstacle;
    const reference = referenceByGroup.get(groupKey);
    if (!reference) continue;
    const textHeightM = input.textHeightM ?? defaultTextHeightByGroup.get(groupKey)!;
    const obstacle = siblingAnchorObstacle(
      input.id,
      reference,
      input.labelAnchor,
      textHeightM,
      POLAR_NEED_ANGLE_DEG,
    );
    if (!obstacle) continue;
    const existing = groupObstacles.get(groupKey);
    if (existing) existing.push(obstacle);
    else groupObstacles.set(groupKey, [obstacle]);
  }
}

function usableBox(box: ScreenRect): boolean {
  return [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.width > 0 && box.height > 0;
}

/** Claims a laid-out record's text box in the polar grid; an empty or non-finite box claims nothing. */
function occupyLabel(occupancy: LabelOccupancy, layout: LayoutResult): void {
  if (usableBox(layout.labelBounds)) occupancy.insert(layout.labelBounds);
}

/** The box a moved polar label is drawn with touches no claim but its own solver box. */
function drawnBoxIsClear(occupancy: LabelOccupancy, moved: LayoutResult, solverBox: ScreenRect): boolean {
  return usableBox(moved.labelBounds) && !occupancy.overlapsExcluding(moved.labelBounds, solverBox);
}

/**
 * Builds the polar reference + placement + screen guard for one record and
 * returns the anchor override to draw with plus the reference and
 * obstacle the caller should feed forward within the record's `groupKey`
 * (T3.6b), or `null` when the input did not opt in, the reference is
 * degenerate, or every candidate was rejected on screen — all of which keep
 * the solver's original anchor (point 6 of the plan: never hide a label
 * over a failed polar placement).
 *
 * `groupElements` (T3.6b plan point 1): extra `PolarElement`s ahead of the
 * pipe body, built by the caller from records earlier in input order that
 * share this record's `polar.groupKey` — both already-placed polar
 * candidates ({@link polarCandidateObstacle}) and non-polar siblings'
 * anchors ({@link siblingAnchorObstacle}). Empty when the record has no
 * `groupKey` (v1 behaviour: only the pipe body) or is the first in its
 * group this frame.
 */
function resolvePolarAnchor(
  input: ExplicitLayoutInput,
  context: LayoutContext,
  occupancy: LabelOccupancy,
  previous: PolarFrameState | undefined,
  diagnostics: { fallbacks: number },
  groupElements: readonly PolarElement[],
  solverBox: ScreenRect | undefined,
): Readonly<{
  labelAnchor: Vec3;
  reference: PolarReference;
  candidate: PolarCandidate;
  needDis: number;
}> | null {
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
      elements: [polarPipeBodyElement(polar.basicRadiusM, polar.disRange), ...groupElements],
      needs: [needDis, POLAR_NEED_ANGLE_DEG, polar.textHeightM],
      isDim: false,
    });
    const guard = screenGuard({
      result,
      projector: context.projector,
      textSize: { widthM: needDis, heightM: polar.textHeightM },
      occupancy,
      previous: previous?.candidate ?? null,
      ...(solverBox ? { exclude: solverBox } : {}),
    });
    if (guard.allRejected) {
      diagnostics.fallbacks += 1;
      return null;
    }
    return { labelAnchor: guard.chosen.pos, reference, candidate: guard.chosen, needDis };
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
  // Both screen grids (label occupancy, hit index) and the polar grid only
  // cover the viewport: what projects beyond it — a vertex near the camera
  // plane lands at 1e5–1e9 px — is neither registered nor queried, so a
  // close-up or a not-yet-framed camera cannot blow the grids up (all-pipes
  // sweep, 2026-09-14).
  const viewport: ScreenRect = {
    x: 0,
    y: 0,
    width: baseContext.projector.widthCssPx,
    height: baseContext.projector.heightCssPx,
  };
  // The polar records' own grid, kept apart from the label/tag declutter
  // passes below. Every record — polar ones at their solver anchor — is laid
  // out first and its text box claimed, then the polar records look for a
  // better spot: a polar label used to see only the pipe body and land on
  // the same-pipe lengths' value text (real BRAN, 2026-11-06: 71 -> 93
  // overlapping pairs far away). A move is kept only when the box actually
  // drawn there is clear of every claim but the record's own solver box;
  // otherwise the record stays where the solver put it. So a moved label
  // never lands on anything, and a label that stays is exactly where it is
  // without polar.
  const polarOccupancy = new LabelOccupancy(viewport);
  const polarIndices: number[] = [];
  const polarDiagnostics = { fallbacks: 0 };
  const polarNext = new Map<string, PolarFrameState>();
  // T3.6b: same-pipe obstacles accumulated per `groupKey`, seeded below with
  // every non-polar sibling's anchor before the main loop runs (so a
  // `linear_dim` that happens to sort after its `label` in `inputs` still
  // fences off its own anchor), then grown in input order as each polar
  // record in the loop below resolves its own candidate.
  const groupObstacles = new Map<string, PolarElement[]>();
  seedSiblingObstacles(inputs, baseContext, options.polarPrevious, groupObstacles);
  const contextOf = (input: NormalizedDimensionInput | ExplicitLayoutInput): LayoutContext => {
    const interaction = interactionById.get(input.id) ?? 'normal';
    return interaction === 'normal' ? normalContext : { ...normalContext, interaction };
  };
  for (const [index, input] of inputs.entries()) {
    const context = contextOf(input);
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
    if ('polar' in input && input.polar) polarIndices.push(index);
    raw[index] = layoutDimension(input, context);
  }
  if (polarIndices.length > 0) {
    for (const layout of raw) {
      if (layout && layout.primitives.length > 0) occupyLabel(polarOccupancy, layout);
    }
  }
  for (const index of polarIndices) {
    const input = inputs[index] as ExplicitLayoutInput;
    const context = contextOf(input);
    const polar = input.polar!;
    const groupKey = polar.groupKey;
    const solverBox = raw[index]!.labelBounds;
    const polarAnchor = resolvePolarAnchor(
      input,
      context,
      polarOccupancy,
      options.polarPrevious?.get(input.id),
      polarDiagnostics,
      groupKey ? groupObstacles.get(groupKey) ?? [] : [],
      raw[index]!.primitives.length > 0 ? solverBox : undefined,
    );
    if (!polarAnchor) continue;
    // Only the anchor moves. The text keeps its own baseline: turning it to
    // the candidate's `textOri` stacked multi-line tags along the screen
    // vertical while their rows ran along the rotated baseline, so the rows
    // landed on each other.
    const moved = layoutDimension({ ...input, labelAnchor: polarAnchor.labelAnchor }, context);
    if (moved.primitives.length === 0 || !drawnBoxIsClear(polarOccupancy, moved, solverBox)) {
      polarDiagnostics.fallbacks += 1;
      continue;
    }
    raw[index] = moved;
    occupyLabel(polarOccupancy, moved);
    polarNext.set(input.id, { reference: polarAnchor.reference, candidate: polarAnchor.candidate });
    if (groupKey) {
      const obstacle = polarCandidateObstacle(
        input.id,
        polarAnchor.candidate,
        polarAnchor.needDis,
        POLAR_NEED_ANGLE_DEG,
        polar.textHeightM,
      );
      const existing = groupObstacles.get(groupKey);
      if (existing) existing.push(obstacle);
      else groupObstacles.set(groupKey, [obstacle]);
    }
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
