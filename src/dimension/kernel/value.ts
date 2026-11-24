import { snapAngleToRightAngle } from '../domain/angularPlane';

import { clamp, dot3, EPSILON, length3, normalize3, sub3 } from './vec';

import type { NormalizedDimensionInput } from './types';

export type DerivedDimensionValue =
  | Readonly<{ ok: true; valueM: number; valueRad?: never }>
  | Readonly<{ ok: true; valueRad: number; valueM?: never }>
  | Readonly<{ ok: false; reason: 'degenerate' | 'invalid-axis' }>;

export function deriveDimensionValue(input: NormalizedDimensionInput): DerivedDimensionValue {
  switch (input.kind) {
    case 'linear': {
      const distance = length3(sub3(input.b, input.a));
      return distance <= EPSILON
        ? { ok: false, reason: 'degenerate' }
        : { ok: true, valueM: distance };
    }
    case 'projected': {
      const displacement = sub3(input.b, input.a);
      if (length3(displacement) <= EPSILON) return { ok: false, reason: 'degenerate' };
      if (length3(input.axis) <= EPSILON) return { ok: false, reason: 'invalid-axis' };
      return {
        ok: true,
        valueM: Math.abs(dot3(displacement, normalize3(input.axis))),
      };
    }
    case 'angular': {
      const rayA = sub3(input.rayA, input.vertex);
      const rayB = sub3(input.rayB, input.vertex);
      if (length3(rayA) <= EPSILON || length3(rayB) <= EPSILON) {
        return { ok: false, reason: 'degenerate' };
      }
      const minor = Math.acos(clamp(dot3(normalize3(rayA), normalize3(rayB)), -1, 1));
      const snapped = input.placement.orthogonalSnap === true
        ? snapAngleToRightAngle(minor)
        : minor;
      return {
        ok: true,
        valueRad: input.placement.arcChoice === 'minor' ? snapped : 2 * Math.PI - snapped,
      };
    }
    case 'chain': {
      if (input.anchors.length < 2) return { ok: false, reason: 'degenerate' };
      const origin = input.anchors[0]!;
      const last = input.anchors[input.anchors.length - 1]!;
      const rawDirection = input.directions?.dimensionDirection ?? sub3(last, origin);
      if (length3(rawDirection) <= EPSILON) return { ok: false, reason: 'degenerate' };
      const direction = normalize3(rawDirection);
      let sum = 0;
      for (let index = 0; index < input.anchors.length - 1; index += 1) {
        const span = Math.abs(dot3(sub3(input.anchors[index + 1]!, input.anchors[index]!), direction));
        if (span <= EPSILON) return { ok: false, reason: 'degenerate' };
        sum += span;
      }
      return { ok: true, valueM: sum };
    }
    case 'radial': {
      const radius = length3(sub3(input.rim, input.center));
      if (radius <= EPSILON) return { ok: false, reason: 'degenerate' };
      if (length3(input.normal) <= EPSILON) return { ok: false, reason: 'invalid-axis' };
      return {
        ok: true,
        valueM: input.display === 'diameter' ? radius * 2 : radius,
      };
    }
  }
}
