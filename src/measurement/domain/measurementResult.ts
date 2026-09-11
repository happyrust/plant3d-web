import {
  isComputationProvenance,
  type ComputationProvenance,
} from './computationProvenance';

export type ComputationPoint = readonly [number, number, number];

export type DistanceComputationResult = Readonly<{
  distanceM: number;
  sourcePoint: ComputationPoint;
  targetPoint: ComputationPoint;
  provenance: ComputationProvenance;
}>;

export type DistanceComputationResultInput = Readonly<{
  distanceM: number;
  sourcePoint: ComputationPoint;
  targetPoint: ComputationPoint;
  provenance: ComputationProvenance;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizePoint(value: unknown, field: string): ComputationPoint {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || !value.every(component => (
      typeof component === 'number' && Number.isFinite(component)
    ))
  ) {
    throw new TypeError(`${field} must be a finite three-component point`);
  }
  return Object.freeze([value[0], value[1], value[2]]) as ComputationPoint;
}

function normalizeDistance(value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
  ) {
    throw new TypeError('distanceM must be a finite non-negative number');
  }
  return value;
}

export function createDistanceComputationResult(
  input: DistanceComputationResultInput,
): DistanceComputationResult {
  if (!isRecord(input)) {
    throw new TypeError('distance computation result input must be an object');
  }
  if (!isComputationProvenance(input.provenance)) {
    throw new TypeError('provenance must satisfy the computation provenance contract');
  }

  return Object.freeze({
    distanceM: normalizeDistance(input.distanceM),
    sourcePoint: normalizePoint(input.sourcePoint, 'sourcePoint'),
    targetPoint: normalizePoint(input.targetPoint, 'targetPoint'),
    provenance: input.provenance,
  });
}

export function isDistanceComputationResult(
  value: unknown,
): value is DistanceComputationResult {
  if (!isRecord(value) || !isComputationProvenance(value.provenance)) {
    return false;
  }
  try {
    normalizeDistance(value.distanceM);
    normalizePoint(value.sourcePoint, 'sourcePoint');
    normalizePoint(value.targetPoint, 'targetPoint');
    return true;
  } catch {
    return false;
  }
}
