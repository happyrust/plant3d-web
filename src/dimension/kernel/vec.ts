import type { Vec2, Vec3 } from './types';

export const EPSILON = 1e-9;

export function add2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function scale2(a: Vec2, scalar: number): Vec2 {
  return [a[0] * scalar, a[1] * scalar];
}

export function dot2(a: Vec2, b: Vec2): number {
  return a[0] * b[0] + a[1] * b[1];
}

export function length2(a: Vec2): number {
  return Math.hypot(a[0], a[1]);
}

export function normalize2(a: Vec2): Vec2 {
  const length = length2(a);
  if (length <= EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector');
  }
  return scale2(a, 1 / length);
}

export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return add2(a, scale2(sub2(b, a), t));
}

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(a: Vec3, scalar: number): Vec3 {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize3(a: Vec3): Vec3 {
  const length = length3(a);
  if (length <= EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector');
  }
  return scale3(a, 1 / length);
}

/**
 * Non-throwing normalization for callers that treat degenerate vectors as
 * "no result" (adapters, arc projection). Single zero-length policy: EPSILON.
 */
export function tryNormalize3(a: Vec3): Vec3 | null {
  const length = length3(a);
  if (!Number.isFinite(length) || length <= EPSILON) return null;
  return scale3(a, 1 / length);
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return add3(a, scale3(sub3(b, a), t));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
