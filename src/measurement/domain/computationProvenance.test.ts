import { describe, expect, it } from 'vitest';

import {
  ACCURACY_CLASSES,
  COMPUTATION_COORDINATE_SPACES,
  COMPUTATION_METHODS,
  accuracyClassForMethod,
  createComputationProvenance,
  isAccuracyClass,
  isComputationCoordinateSpace,
  isComputationMethod,
  isComputationProvenance,
  toLegacyApproximate,
  type ComputationProvenanceInput,
} from './computationProvenance';
import {
  createDistanceComputationResult,
  isDistanceComputationResult,
} from './measurementResult';

const METHOD_ACCURACY_CASES = [
  ['semantic-point-pair', 'exact-semantic'],
  ['point-to-triangle-mesh', 'exact-surface'],
  ['surface-to-surface', 'exact-surface'],
  ['pipe-surface-clearance', 'exact-surface'],
  ['centerline-to-aabb', 'approximate-bounds'],
  ['aabb-to-aabb', 'approximate-bounds'],
  ['sampled-object', 'approximate-sampled'],
  ['pca-axis', 'approximate-axis'],
  ['legacy-unknown', 'legacy-unknown'],
] as const;

function validInput(
  overrides: Partial<ComputationProvenanceInput> = {},
): ComputationProvenanceInput {
  return {
    method: 'semantic-point-pair',
    accuracyClass: 'exact-semantic',
    coordinateSpace: 'design-world',
    source: { entityId: 'source', refno: '24381_1001' },
    target: { entityId: 'target', refno: '24381_1002' },
    ...overrides,
  };
}

describe('computation provenance contract', () => {
  it('publishes the complete frozen method, accuracy and coordinate-space vocabularies', () => {
    expect(ACCURACY_CLASSES).toEqual([
      'exact-semantic',
      'exact-surface',
      'approximate-bounds',
      'approximate-sampled',
      'approximate-axis',
      'legacy-unknown',
    ]);
    expect(COMPUTATION_METHODS).toEqual(METHOD_ACCURACY_CASES.map(([method]) => method));
    expect(COMPUTATION_COORDINATE_SPACES).toEqual([
      'design-world',
      'scene-world',
      'model-local',
    ]);
    expect(Object.isFrozen(ACCURACY_CLASSES)).toBe(true);
    expect(Object.isFrozen(COMPUTATION_METHODS)).toBe(true);
    expect(Object.isFrozen(COMPUTATION_COORDINATE_SPACES)).toBe(true);
  });

  it.each(METHOD_ACCURACY_CASES)(
    'maps %s exhaustively to %s',
    (method, expectedAccuracy) => {
      expect(accuracyClassForMethod(method)).toBe(expectedAccuracy);
      expect(isComputationMethod(method)).toBe(true);
      expect(isAccuracyClass(expectedAccuracy)).toBe(true);
    },
  );

  it.each([
    ['exact-semantic', false],
    ['exact-surface', false],
    ['approximate-bounds', true],
    ['approximate-sampled', true],
    ['approximate-axis', true],
    ['legacy-unknown', true],
  ] as const)(
    'projects %s to legacy approximate=%s without treating unknown as exact',
    (accuracyClass, expected) => {
      expect(toLegacyApproximate(accuracyClass)).toBe(expected);
    },
  );

  it('normalizes optional evidence fields without hiding unknown model versions', () => {
    const result = createComputationProvenance(validInput({
      sourceModelVersion: null,
      warnings: [{ code: 'FALLBACK', message: 'Used bounded fallback' }],
      errorBoundM: 0.025,
    }));

    expect(result).toEqual({
      method: 'semantic-point-pair',
      accuracyClass: 'exact-semantic',
      coordinateSpace: 'design-world',
      lengthUnit: 'm',
      sourceModelVersion: null,
      source: { entityId: 'source', refno: '24381_1001' },
      target: { entityId: 'target', refno: '24381_1002' },
      warnings: [{ code: 'FALLBACK', message: 'Used bounded fallback' }],
      errorBoundM: 0.025,
    });
    expect(isComputationProvenance(result)).toBe(true);
  });

  it('uses explicit safe defaults for absent optional evidence', () => {
    const result = createComputationProvenance(validInput());

    expect(result.lengthUnit).toBe('m');
    expect(result.sourceModelVersion).toBeNull();
    expect(result.warnings).toEqual([]);
    expect(result.errorBoundM).toBeNull();
  });

  it.each([
    [{ method: 'invented' }, 'method'],
    [{ accuracyClass: 'exact-ish' }, 'accuracyClass'],
    [{ accuracyClass: 'approximate-axis' }, 'does not match'],
    [{ coordinateSpace: 'screen' }, 'coordinateSpace'],
    [{ source: { entityId: ' ' } }, 'source.entityId'],
    [{ target: { entityId: '' } }, 'target.entityId'],
    [{ sourceModelVersion: '' }, 'sourceModelVersion'],
    [{ errorBoundM: Number.NaN }, 'errorBoundM'],
    [{ errorBoundM: Number.POSITIVE_INFINITY }, 'errorBoundM'],
    [{ errorBoundM: -0.01 }, 'errorBoundM'],
    [{ warnings: [{ code: '', message: 'message' }] }, 'warnings[0].code'],
    [{ warnings: [{ code: 'CODE', message: '' }] }, 'warnings[0].message'],
  ])('rejects invalid runtime evidence %j', (patch, expectedMessage) => {
    const input = { ...validInput(), ...patch } as ComputationProvenanceInput;

    expect(() => createComputationProvenance(input)).toThrow(expectedMessage);
    expect(isComputationProvenance(input)).toBe(false);
  });

  it('rejects unknown enum values through the narrow guards', () => {
    expect(isComputationMethod('distance')).toBe(false);
    expect(isAccuracyClass('exact')).toBe(false);
    expect(isComputationCoordinateSpace('screen')).toBe(false);
  });
});

describe('distance computation result contract', () => {
  it('constructs a finite distance result carrying validated provenance', () => {
    const provenance = createComputationProvenance(validInput());
    const result = createDistanceComputationResult({
      distanceM: 5,
      sourcePoint: [0, 0, 0],
      targetPoint: [3, 4, 0],
      provenance,
    });

    expect(result).toEqual({
      distanceM: 5,
      sourcePoint: [0, 0, 0],
      targetPoint: [3, 4, 0],
      provenance,
    });
    expect(isDistanceComputationResult(result)).toBe(true);
  });

  it.each([
    [{ distanceM: -1 }, 'distanceM'],
    [{ distanceM: Number.NaN }, 'distanceM'],
    [{ sourcePoint: [0, Number.POSITIVE_INFINITY, 0] }, 'sourcePoint'],
    [{ targetPoint: [0, 0] }, 'targetPoint'],
    [{ provenance: { method: 'invented' } }, 'provenance'],
  ])('rejects an invalid distance result %j', (patch, expectedMessage) => {
    const input = {
      distanceM: 1,
      sourcePoint: [0, 0, 0],
      targetPoint: [1, 0, 0],
      provenance: createComputationProvenance(validInput()),
      ...patch,
    };

    expect(() => createDistanceComputationResult(input as never)).toThrow(expectedMessage);
    expect(isDistanceComputationResult(input)).toBe(false);
  });
});
