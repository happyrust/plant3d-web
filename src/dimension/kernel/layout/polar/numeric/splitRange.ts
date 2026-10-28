/**
 * Cell splitting ported from PML `polarsystem.pmlobj:2765-3132`
 * (`.splitrange(!inputrange, !need, !inputbests, !isangle)`).
 *
 * What it does: given one or more value ranges and a cell width `need`, produce
 * every cell of width `need` that fits inside a range, ordered by "how good the
 * cell is". Priority 1 is a cell centred on a preferred value; priority 2, 3, …
 * walk outward from it one cell at a time. Cells that would fall outside the
 * range are dropped, except that an interior edge tolerates overlap (that is
 * how neighbouring cells share a boundary) and a range boundary tolerates a
 * sub-0.1 overflow.
 *
 * Behaviour reproduced exactly:
 * - ranges are reordered so that the range containing the first best value
 *   comes first, then the range containing the second, …; ranges containing no
 *   best value get priority 10000 and keep their relative order (`:2775-2795`);
 * - in angle mode every best value is tripled as `b`, `b + 360`, `b - 360`
 *   (`:2799-2808`) and a wrapping range has its start shifted down by 360 so
 *   `end >= start` (`:2814-2817`);
 * - a range narrower than `need` is skipped entirely (`:2818-2821`);
 * - preferred values are kept as given when `best ± need/2` fits, are clamped to
 *   `start + need/2` / `end - need/2` when only the value itself is inside, and
 *   otherwise become the nearest `beforeBest` / `afterBest` outside the range
 *   (`:2829-2848`); with no usable value the range midpoint is used (`:2852-2855`);
 * - the edges between preferred values are their midpoints, with the range ends
 *   as fallbacks (`:2859-2913`);
 * - cells are generated outward from each preferred value (`:2925-3015`);
 * - `beforeBest` / `afterBest` each add one cell pushed in from the range
 *   boundary, priority `x + startNum` where `startNum` counts how many cells fit
 *   between the boundary and the outer edge (`:3028-3089`);
 * - output is ordered by priority ascending, ties keeping generation order
 *   (`:3105-3126`).
 *
 * Deviation from PML (decision D4): the PML loop generating cells outward is
 * unbounded and relies on `left`/`right` flags to stop. It is bounded here by a
 * cell-count guard so a pathological `need` cannot hang the process; the guard
 * is far above any real range so results are unchanged.
 */

import { angleInAngles } from './angleRanges';

import type { AngleRange } from './angleRanges';

/** A range that cannot be resolved to a usable preferred value. */
const NO_BEST = 1_000_000;
const BEFORE_BEST = -1_000_000;
const AFTER_BEST = 1_000_000;
/** PML tolerates a range-boundary overflow smaller than this (`:2966`, `:2995`). */
const BOUNDARY_TOLERANCE = 0.1;
/** Priority assigned to ranges that contain no preferred value (`:2791`). */
const RANGE_WITHOUT_BEST_PRIORITY = 10_000;
/** Safety bound on the outward walk; far above any real range / need ratio. */
const MAX_CELLS_PER_BEST = 100_000;

type Cell = [number, number];

type RangePlan = {
  /** Preferred values, ascending, each with its left and right edge. */
  readonly bests: readonly number[];
  readonly edges: readonly number[];
  readonly beforeBest: number | null;
  readonly afterBest: number | null;
};

/**
 * Split `ranges` into cells of width `need`, ordered by preference.
 *
 * @param ranges Value ranges (degrees when `isAngle`, world units otherwise).
 * @param need   Cell width. A range narrower than this yields nothing.
 * @param bests  Preferred values, most preferred first.
 * @param isAngle Treat the axis as circular, so `0` and `360` coincide.
 */
export function splitRange(
  ranges: readonly AngleRange[],
  need: number,
  bests: readonly number[],
  isAngle: boolean,
): AngleRange[] {
  const ordered = orderRangesByBests(ranges, bests, isAngle);

  // Angle mode works on an unrolled axis: every best value is also available a
  // turn to either side, so a cell near 0 can be centred on a best near 360.
  const unrolledBests = isAngle
    ? bests.flatMap(best => [best, best + 360, best - 360])
    : [...bests];

  const cells: { cell: Cell; priority: number; order: number }[] = [];
  let order = 0;
  const push = (cell: Cell, priority: number): void => {
    cells.push({ cell, priority, order });
    order += 1;
  };

  for (const original of ordered) {
    let range: [number, number] = [original[0], original[1]];
    if (isAngle && range[1] < range[0]) range = [range[0] - 360, range[1]];

    const [low, high] = range;
    if (high - low < need) continue;

    const plan = planRange(low, high, need, unrolledBests);

    for (let index = 0; index < plan.bests.length; index += 1) {
      const best = plan.bests[index]!;
      const edge1 = plan.edges[index]!;
      const edge2 = plan.edges[index + 1]!;
      const isFirst = index === 0;
      const isLast = index === plan.bests.length - 1;

      for (const { cell, priority } of cellsAroundBest(best, edge1, edge2, need, {
        isFirst,
        isLast,
        hasBeforeBest: plan.beforeBest !== null,
        hasAfterBest: plan.afterBest !== null,
      })) {
        push(cell, priority);
      }
    }

    if (plan.beforeBest !== null) {
      const firstEdge = plan.edges[0]!;
      let startNum = (low + need / 2 - plan.beforeBest) / need;
      if (startNum !== Math.trunc(startNum)) startNum = Math.trunc(startNum) + 1;

      for (let x = 1; x <= MAX_CELLS_PER_BEST; x += 1) {
        const cell: Cell = [low + (x - 1) * need, low + x * need];
        if (cell[1] >= firstEdge) {
          push(cell, x + startNum);
          break;
        }
      }
    }

    if (plan.afterBest !== null) {
      const lastEdge = plan.edges[plan.edges.length - 1]!;
      let startNum = (plan.afterBest - (high - need / 2)) / need;
      if (startNum !== Math.trunc(startNum)) startNum = Math.trunc(startNum) + 1;

      for (let x = 1; x <= MAX_CELLS_PER_BEST; x += 1) {
        const cell: Cell = [high - x * need, high - (x - 1) * need];
        if (cell[1] <= lastEdge) {
          push(cell, x + startNum);
          break;
        }
      }
    }
  }

  return cells
    .slice()
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .map(entry => [entry.cell[0], entry.cell[1]] as const);
}

/**
 * Reorder ranges so the one holding the first preferred value leads
 * (`polarsystem.pmlobj:2775-2795`). Each range is claimed by at most one value;
 * unclaimed ranges go last, keeping their original order.
 */
function orderRangesByBests(
  ranges: readonly AngleRange[],
  bests: readonly number[],
  isAngle: boolean,
): readonly AngleRange[] {
  if (bests.length === 0) return ranges;

  const priorities = new Array<number>(ranges.length).fill(RANGE_WITHOUT_BEST_PRIORITY);
  const claimed = new Array<boolean>(ranges.length).fill(false);

  for (let bestIndex = 0; bestIndex < bests.length; bestIndex += 1) {
    const best = bests[bestIndex]!;
    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
      if (claimed[rangeIndex]) continue;
      const range = ranges[rangeIndex]!;
      const contains = isAngle
        ? angleInAngles(best, range[0], range[1])
        : range[0] <= best && range[1] >= best;
      if (contains) {
        priorities[rangeIndex] = bestIndex;
        claimed[rangeIndex] = true;
        break;
      }
    }
  }

  return ranges
    .map((range, index) => ({ range, priority: priorities[index]!, index }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(entry => entry.range);
}

/** Pick the preferred values and edges for one range (`:2823-2913`). */
function planRange(
  low: number,
  high: number,
  need: number,
  unrolledBests: readonly number[],
): RangePlan {
  let beforeBest = BEFORE_BEST;
  let afterBest = AFTER_BEST;
  const bests: number[] = [];

  for (const best of unrolledBests) {
    if (best - need / 2 >= low && best + need / 2 <= high) {
      bests.push(best);
    } else if (best >= low && best <= high) {
      // The value is inside but a full cell around it is not: clamp it so the
      // cell still fits, which is how a range narrower than the ideal still
      // yields a usable cell.
      bests.push(best - need / 2 < low ? low + need / 2 : high - need / 2);
    } else if (best < low) {
      beforeBest = Math.max(beforeBest, best);
    } else {
      afterBest = Math.min(afterBest, best);
    }
  }

  if (bests.length === 0) {
    bests.push((low + high) / 2);
    bests.sort((left, right) => left - right);
  }

  const midpoint = (low + high) / 2;
  const edges: number[] = [];
  let keepBeforeBest = beforeBest !== BEFORE_BEST;

  const firstBest = bests[0]!;
  if ((beforeBest + firstBest) / 2 > low) {
    const beforeEdge = (beforeBest + firstBest) / 2;
    if (beforeEdge <= midpoint - need / 2) {
      edges.push(beforeEdge);
    } else {
      edges.push(low);
      keepBeforeBest = false;
    }
  } else {
    edges.push(low);
    keepBeforeBest = false;
  }

  for (let index = 0; index < bests.length - 1; index += 1) {
    edges.push((bests[index]! + bests[index + 1]!) / 2);
  }

  let keepAfterBest = afterBest !== AFTER_BEST;
  const lastBest = bests[bests.length - 1]!;
  if ((afterBest + lastBest) / 2 < high) {
    const afterEdge = (afterBest + lastBest) / 2;
    if (afterEdge >= midpoint + need / 2) {
      edges.push(afterEdge);
    } else {
      edges.push(high);
      keepAfterBest = false;
    }
  } else {
    edges.push(high);
    keepAfterBest = false;
  }

  return {
    bests,
    edges,
    beforeBest: keepBeforeBest ? beforeBest : null,
    afterBest: keepAfterBest ? afterBest : null,
  };
}

/**
 * Cells around one preferred value (`:2946-3015`).
 *
 * `x = 1` is the cell centred on the value. `x = 2, 3, …` walk outward on both
 * sides. A side stops once its cell reaches the edge; at a range boundary the
 * cell is kept only if it overflows by less than {@link BOUNDARY_TOLERANCE},
 * while an interior edge keeps partially overlapping cells (neighbouring cells
 * share that boundary by design).
 */
function cellsAroundBest(
  best: number,
  edge1: number,
  edge2: number,
  need: number,
  options: Readonly<{
    isFirst: boolean;
    isLast: boolean;
    hasBeforeBest: boolean;
    hasAfterBest: boolean;
  }>,
): { cell: Cell; priority: number }[] {
  const out: { cell: Cell; priority: number }[] = [];
  let left = true;
  let right = true;

  for (let x = 1; x <= MAX_CELLS_PER_BEST; x += 1) {
    if (x === 1) {
      out.push({ cell: [best - 0.5 * need, best + 0.5 * need], priority: x });
      continue;
    }

    if (left) {
      const cell: Cell = [best - (x - 0.5) * need, best - (x - 1.5) * need];
      let add = true;
      if (cell[0] <= edge1) {
        left = false;
        if (options.isFirst && !options.hasBeforeBest) {
          add = Math.abs(cell[0] - edge1) < BOUNDARY_TOLERANCE;
        } else if (cell[1] <= edge1) {
          add = false;
        }
      }
      if (add) out.push({ cell, priority: x });
    }

    if (right) {
      const cell: Cell = [best + (x - 1.5) * need, best + (x - 0.5) * need];
      let add = true;
      if (cell[1] >= edge2) {
        right = false;
        if (options.isLast && !options.hasAfterBest) {
          add = Math.abs(cell[1] - edge2) < BOUNDARY_TOLERANCE;
        } else if (cell[0] >= edge2) {
          add = false;
        }
      }
      if (add) out.push({ cell, priority: x });
    }

    if (!left && !right) break;
  }

  return out;
}

/** Exposed for tests: the sentinel used when no preferred value is usable. */
export const SPLIT_RANGE_NO_BEST = NO_BEST;
