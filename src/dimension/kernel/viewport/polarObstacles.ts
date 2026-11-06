/**
 * T3.6b: same-pipe cross-record polar obstacles.
 *
 * `resolvePolarAnchor` (`layoutViewport.ts`) already feeds `polarPlace` one
 * obstacle — the pipe body (`polarPipeBodyElement`) — so every record in a
 * frame picks a candidate clear of the pipe itself, but independently of
 * every other record: two labels on the same pipe can both win the same
 * (dis, angle, radius) box and only get separated afterwards, in screen
 * space, by `screenGuard`'s `LabelOccupancy`. That is a weaker guarantee
 * than PML's own `this.polarsystem.add(...)` (`isoline.pmlobj:611/633/862` et
 * al.): PML accumulates every already-drawn item — dimensions, tags, the
 * pipe itself — into one `polarsystem.elements` array, so a later item's
 * `getBestPosAndOri` never even scores a box a former item already claimed.
 *
 * This module is that accumulator for the kernel: a `groupKey`-scoped set of
 * `PolarElement`s built from records already resolved earlier in the same
 * `layoutViewport` call (same frame, input order), consumed by
 * `resolvePolarAnchor` as extra `elements` alongside the pipe body.
 *
 * Two kinds of obstacle, both PML `type: 'AIDTEX'` — real estate already
 * spoken for, not the pipe body, so a leader may still cross it
 * (`basic: false`; see `place/place.ts`'s `classifyByRadiusBand`, which only
 * excludes `basic` elements from a lead candidate):
 *
 * 1. {@link polarCandidateObstacle} — a same-group record that *did* opt into
 *    `polar` and got a chosen candidate this frame: its footprint box, built
 *    from the same `(needDis, needAngle, needRadius)` triple `resolvePolarAnchor`
 *    fed `polarPlace` for it (point 1 of the T3.6b plan).
 * 2. {@link siblingAnchorObstacle} — a same-group record that did *not* opt
 *    into `polar` (e.g. a `linear_dim`'s own `labelAnchor`, placed by the
 *    solver, never touched by this layer): its anchor point converted into
 *    the group's polar coordinates and padded into a small box, so later
 *    polar records in the group steer clear of it too (point 1's second
 *    bullet). The conversion is {@link pointToPolarCoords}, the exact inverse
 *    of `place/result.ts`'s `getResult` (same `PolarReference`, same angle
 *    convention — round-tripped in `polarObstacles.test.ts`).
 */

import { angleOfDirection } from '../layout/polar/place/result';
import { dot3, sub3, tryNormalize3 } from '../vec';

import type { PolarCandidate } from '../layout/polar/place/types';
import type { PolarCoords, PolarElement, PolarReference } from '../layout/polar/reference/types';
import type { Vec3 } from '../types';

/**
 * PML `getpolarelement.getOnePointData` (`getpolarelement.pmlobj:206-221`): a point's
 * `(dis, angle, radius)` against `reference`'s axis — the exact inverse of
 * `place/result.ts`'s `getResult`. `dis` is signed (PML `suidirdis` is unsigned,
 * but every PML call site measures from a point already known to sit ahead of
 * `pos` along the axis; a polar group's obstacles have no such guarantee, so
 * this keeps the sign — consistent with `ExplicitPolarInput.disRange` and the
 * mapper's own `polarInputForLabel`, which both allow negative `dis`).
 *
 * Returns `null` when `point` sits on the axis itself (`radius` underflows
 * `EPSILON`): there the radial direction, and hence `angle`, is undefined, so
 * there is no angular footprint to steer around.
 */
export function pointToPolarCoords(reference: PolarReference, point: Vec3): PolarCoords | null {
  const toPoint = sub3(point, reference.origin);
  const dis = dot3(toPoint, reference.axis);
  const radial = sub3(toPoint, [
    reference.axis[0] * dis,
    reference.axis[1] * dis,
    reference.axis[2] * dis,
  ]);
  const radialDir = tryNormalize3(radial);
  if (!radialDir) return null;
  const angle = angleOfDirection(reference, radialDir);
  if (angle === null) return null;
  const radius = Math.hypot(radial[0], radial[1], radial[2]);
  return { dis, angle, radius };
}

/**
 * Padded angle interval around `angle`, degrees — the only one of the three
 * axes where PML elements routinely wrap through 0 (`reference/types.ts`'s
 * `PolarElement.angle` docstring: "allowed to cross the boundary"). Matches
 * `getDisEles` / `classifyByRadiusBand`'s own interval semantics: neither
 * reads this wrapped, both compare `[start, end]` as given, so an obstacle
 * whose padded window crosses 0/360 (e.g. `angle: [-5, 5]`) is deliberately
 * left unwrapped rather than forced into `[0, 360)` — wrapping it would
 * split one obstacle into two disjoint ranges that `polarPlace` cannot
 * express as a single `PolarElement`.
 */
function paddedAngle(angle: number, halfSpanDeg: number): readonly [number, number] {
  return [angle - halfSpanDeg, angle + halfSpanDeg];
}

/**
 * A same-group record's chosen polar candidate, as an obstacle for records
 * later in input order (T3.6b plan point 1, first bullet).
 *
 * Box half-spans mirror `resolvePolarAnchor`'s own `needs` triple: half the
 * text length along the axis, half `POLAR_NEED_ANGLE_DEG` around the chosen
 * angle, half the text height radially — i.e. the same footprint
 * `screenGuard` already protects on screen, now also fenced off in polar
 * space so `polarPlace` does not even offer a later record that box.
 */
export function polarCandidateObstacle(
  id: string,
  candidate: PolarCandidate,
  needDisM: number,
  needAngleDeg: number,
  needRadiusM: number,
): PolarElement {
  return {
    id,
    type: 'AIDTEX',
    dis: [candidate.dis - needDisM / 2, candidate.dis + needDisM / 2],
    angle: paddedAngle(candidate.angle, needAngleDeg / 2),
    radius: [candidate.radius - needRadiusM / 2, candidate.radius + needRadiusM / 2],
    basic: false,
  };
}

/**
 * A same-group record that did not opt into `polar` — its solver-placed
 * anchor, converted into the group's polar coordinates and padded into a
 * small box (T3.6b plan point 1, second bullet). `null` when the anchor
 * sits on the axis itself ({@link pointToPolarCoords}): no angular footprint
 * to protect, so no obstacle to add — later records fall back to the pipe
 * body alone for that one, same as v1.
 *
 * The padding is deliberately small and fixed rather than derived from the
 * sibling's own text size: a non-polar record's `formattedLabel` / line
 * geometry do not feed this layer (that would mean re-deriving a text
 * footprint for a record this layer never lays out), so the box is sized
 * off `textHeightM` alone — the one length every polar group input already
 * carries — on all three axes, a deliberately conservative square footprint
 * around the point rather than a claim about the sibling's real extent.
 */
export function siblingAnchorObstacle(
  id: string,
  reference: PolarReference,
  anchor: Vec3,
  textHeightM: number,
  needAngleDeg: number,
): PolarElement | null {
  const coords = pointToPolarCoords(reference, anchor);
  if (!coords) return null;
  const halfRadius = textHeightM / 2;
  return {
    id,
    type: 'AIDTEX',
    dis: [coords.dis - halfRadius, coords.dis + halfRadius],
    angle: paddedAngle(coords.angle, needAngleDeg / 2),
    radius: [Math.max(0, coords.radius - halfRadius), coords.radius + halfRadius],
    basic: false,
  };
}
