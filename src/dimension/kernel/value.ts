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
      return {
        ok: true,
        valueRad: input.placement.arcChoice === 'minor' ? minor : 2 * Math.PI - minor,
      };
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
