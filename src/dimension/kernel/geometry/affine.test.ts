import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  isMat4ColumnMajor,
  transformDirection,
  transformLength,
  transformPoint,
} from './affine';

import type { Mat4ColumnMajor } from './affine';

const IDENTITY: Mat4ColumnMajor = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

/**
 * T(10,20,30)·Rz(90°)·S(0.001) serialised column-major — the very matrix
 * `fixtures/mbd-v2/source-to-design-translation.json` pins for the cross-repo
 * convention (translation in elements 12–14).
 */
const TRANSLATION_PIN: Mat4ColumnMajor = [
  0, 0.001, 0, 0,
  -0.001, 0, 0, 0,
  0, 0, 0.001, 0,
  10, 20, 30, 1,
];

/** What a row-major producer would effectively send: the transpose. */
function transposed(m: Mat4ColumnMajor): Mat4ColumnMajor {
  return Array.from({ length: 16 }, (_, index) => m[(index % 4) * 4 + Math.floor(index / 4)]!);
}

function expectVec3Close(
  actual: readonly [number, number, number],
  expected: readonly [number, number, number],
): void {
  expect(actual[0]).toBeCloseTo(expected[0], 9);
  expect(actual[1]).toBeCloseTo(expected[1], 9);
  expect(actual[2]).toBeCloseTo(expected[2], 9);
}

describe('affine', () => {
  describe('identity', () => {
    it('leaves points, directions and lengths unchanged', () => {
      expect(transformPoint(IDENTITY, [1.5, -2, 3])).toEqual([1.5, -2, 3]);
      expect(transformDirection(IDENTITY, [0, 0, 1])).toEqual([0, 0, 1]);
      expect(transformLength(IDENTITY, 27)).toBe(27);
    });
  });

  describe('column-major convention pin', () => {
    it('applies translation from elements 12-14 to points', () => {
      expectVec3Close(transformPoint(TRANSLATION_PIN, [1000, 0, 0]), [10, 21, 30]);
      // The fixture's `trans-1` start point, as the adapter test expects it.
      expectVec3Close(transformPoint(TRANSLATION_PIN, [1000, 2000, 3000]), [8, 21, 33]);
    });

    it('rotates and scales directions but never translates them', () => {
      expectVec3Close(transformDirection(TRANSLATION_PIN, [1, 0, 0]), [0, 0.001, 0]);
      expect(transformDirection(TRANSLATION_PIN, [0, 0, 0])).toEqual([0, 0, 0]);
    });

    it('scales a source length by the matrix scale only', () => {
      expect(transformLength(TRANSLATION_PIN, 27)).toBeCloseTo(0.027, 9);
      expect(transformLength(TRANSLATION_PIN, 27, [0, 0, 1])).toBeCloseTo(0.027, 9);
    });

    it('lands elsewhere for the transposed (row-major) matrix', () => {
      const point = transformPoint(transposed(TRANSLATION_PIN), [1000, 0, 0]);
      expect(point[0]).not.toBeCloseTo(10, 9);
      expect(point[1]).not.toBeCloseTo(21, 9);
      expect(point[2]).not.toBeCloseTo(30, 9);
      const direction = transformDirection(transposed(TRANSLATION_PIN), [1, 0, 0]);
      expect(direction[1]).not.toBeCloseTo(0.001, 9);
    });

    it('divides points by w like THREE applyMatrix4', () => {
      const projective: Mat4ColumnMajor = [...TRANSLATION_PIN.slice(0, 15), 2];
      expectVec3Close(transformPoint(projective, [1000, 0, 0]), [5, 10.5, 15]);
      // Directions ignore the projective row entirely.
      expectVec3Close(transformDirection(projective, [1, 0, 0]), [0, 0.001, 0]);
    });
  });

  describe('isMat4ColumnMajor', () => {
    it('accepts exactly 16 finite numbers', () => {
      expect(isMat4ColumnMajor(IDENTITY)).toBe(true);
      expect(isMat4ColumnMajor(TRANSLATION_PIN)).toBe(true);
    });

    it('rejects wrong lengths, non-finite entries and non-arrays', () => {
      expect(isMat4ColumnMajor(TRANSLATION_PIN.slice(0, 15))).toBe(false);
      expect(isMat4ColumnMajor([...TRANSLATION_PIN, 0])).toBe(false);
      expect(isMat4ColumnMajor([...TRANSLATION_PIN.slice(0, 15), Number.NaN])).toBe(false);
      expect(isMat4ColumnMajor([...TRANSLATION_PIN.slice(0, 15), Number.POSITIVE_INFINITY])).toBe(false);
      expect(isMat4ColumnMajor([...TRANSLATION_PIN.slice(0, 15), '1'])).toBe(false);
      expect(isMat4ColumnMajor(null)).toBe(false);
      expect(isMat4ColumnMajor({ length: 16 })).toBe(false);
    });
  });

  describe('kernel purity', () => {
    it('keeps the MBD v2 adapter free of three', () => {
      // Relative cwd path (vitest runs from the repo root), same convention as
      // `DimensionPanelDock.test.ts:210` — `import.meta.url` is not a `file:`
      // URL under this project's vite-node transform.
      const source = readFileSync(
        'src/dimension/adapters/mbdV2ExternalAnnotations.ts',
        'utf8',
      );
      expect(source).not.toMatch(/from 'three'/);
    });
  });
});
