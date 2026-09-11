export const ACCURACY_CLASSES = Object.freeze([
  'exact-semantic',
  'exact-surface',
  'approximate-bounds',
  'approximate-sampled',
  'approximate-axis',
  'legacy-unknown',
] as const);

export type AccuracyClass = typeof ACCURACY_CLASSES[number];

export const COMPUTATION_METHODS = Object.freeze([
  'semantic-point-pair',
  'point-to-triangle-mesh',
  'surface-to-surface',
  'pipe-surface-clearance',
  'centerline-to-aabb',
  'aabb-to-aabb',
  'sampled-object',
  'pca-axis',
  'legacy-unknown',
] as const);

export type ComputationMethod = typeof COMPUTATION_METHODS[number];

export const COMPUTATION_COORDINATE_SPACES = Object.freeze([
  'design-world',
  'scene-world',
  'model-local',
] as const);

export type ComputationCoordinateSpace =
  typeof COMPUTATION_COORDINATE_SPACES[number];

export type ComputationOperandRef = Readonly<{
  entityId: string;
  refno?: string;
  objectId?: string;
  segmentRefno?: string;
  candidateId?: string;
}>;

export type ComputationWarning = Readonly<{
  code: string;
  message: string;
}>;

/**
 * Evidence attached to one computed distance-like result.
 *
 * Domain values are normalized to metres. `sourceModelVersion = null` is an
 * explicit statement that the producer cannot prove a model version; it must
 * never be interpreted as current or exact by itself.
 */
export type ComputationProvenance = Readonly<{
  method: ComputationMethod;
  accuracyClass: AccuracyClass;
  coordinateSpace: ComputationCoordinateSpace;
  lengthUnit: 'm';
  sourceModelVersion: string | null;
  source: ComputationOperandRef;
  target: ComputationOperandRef;
  warnings: readonly ComputationWarning[];
  errorBoundM: number | null;
}>;

export type ComputationProvenanceInput = Readonly<{
  method: ComputationMethod;
  accuracyClass: AccuracyClass;
  coordinateSpace: ComputationCoordinateSpace;
  source: ComputationOperandRef;
  target: ComputationOperandRef;
  lengthUnit?: 'm';
  sourceModelVersion?: string | null;
  warnings?: readonly ComputationWarning[];
  errorBoundM?: number | null;
}>;

const ACCURACY_CLASS_SET: ReadonlySet<string> = new Set(ACCURACY_CLASSES);
const COMPUTATION_METHOD_SET: ReadonlySet<string> = new Set(COMPUTATION_METHODS);
const COORDINATE_SPACE_SET: ReadonlySet<string> = new Set(
  COMPUTATION_COORDINATE_SPACES,
);

function assertNever(value: never): never {
  throw new TypeError(`Unsupported computation contract value: ${String(value)}`);
}

export function isAccuracyClass(value: unknown): value is AccuracyClass {
  return typeof value === 'string' && ACCURACY_CLASS_SET.has(value);
}

export function isComputationMethod(value: unknown): value is ComputationMethod {
  return typeof value === 'string' && COMPUTATION_METHOD_SET.has(value);
}

export function isComputationCoordinateSpace(
  value: unknown,
): value is ComputationCoordinateSpace {
  return typeof value === 'string' && COORDINATE_SPACE_SET.has(value);
}

export function accuracyClassForMethod(
  method: ComputationMethod,
): AccuracyClass {
  switch (method) {
    case 'semantic-point-pair':
      return 'exact-semantic';
    case 'point-to-triangle-mesh':
    case 'surface-to-surface':
    case 'pipe-surface-clearance':
      return 'exact-surface';
    case 'centerline-to-aabb':
    case 'aabb-to-aabb':
      return 'approximate-bounds';
    case 'sampled-object':
      return 'approximate-sampled';
    case 'pca-axis':
      return 'approximate-axis';
    case 'legacy-unknown':
      return 'legacy-unknown';
    default:
      return assertNever(method);
  }
}

/**
 * Compatibility projection only. Unknown legacy evidence is deliberately
 * treated as approximate so old records cannot acquire an unsupported exact
 * claim.
 */
export function toLegacyApproximate(accuracyClass: AccuracyClass): boolean {
  switch (accuracyClass) {
    case 'exact-semantic':
    case 'exact-surface':
      return false;
    case 'approximate-bounds':
    case 'approximate-sampled':
    case 'approximate-axis':
    case 'legacy-unknown':
      return true;
    default:
      return assertNever(accuracyClass);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field);
}

function normalizeOperand(
  value: unknown,
  field: 'source' | 'target',
): ComputationOperandRef {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const entityId = requiredText(value.entityId, `${field}.entityId`);
  const refno = optionalText(value.refno, `${field}.refno`);
  const objectId = optionalText(value.objectId, `${field}.objectId`);
  const segmentRefno = optionalText(value.segmentRefno, `${field}.segmentRefno`);
  const candidateId = optionalText(value.candidateId, `${field}.candidateId`);

  return Object.freeze({
    entityId,
    ...(refno ? { refno } : {}),
    ...(objectId ? { objectId } : {}),
    ...(segmentRefno ? { segmentRefno } : {}),
    ...(candidateId ? { candidateId } : {}),
  });
}

function normalizeWarnings(value: unknown): readonly ComputationWarning[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new TypeError('warnings must be an array');
  }
  return Object.freeze(value.map((warning, index) => {
    if (!isRecord(warning)) {
      throw new TypeError(`warnings[${index}] must be an object`);
    }
    return Object.freeze({
      code: requiredText(warning.code, `warnings[${index}].code`),
      message: requiredText(warning.message, `warnings[${index}].message`),
    });
  }));
}

function normalizeModelVersion(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requiredText(value, 'sourceModelVersion');
}

function normalizeErrorBound(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
  ) {
    throw new TypeError('errorBoundM must be a finite non-negative number or null');
  }
  return value;
}

export function createComputationProvenance(
  input: ComputationProvenanceInput,
): ComputationProvenance {
  if (!isRecord(input)) {
    throw new TypeError('computation provenance input must be an object');
  }
  if (!isComputationMethod(input.method)) {
    throw new TypeError(`method is invalid: ${String(input.method)}`);
  }
  if (!isAccuracyClass(input.accuracyClass)) {
    throw new TypeError(`accuracyClass is invalid: ${String(input.accuracyClass)}`);
  }
  const expectedAccuracy = accuracyClassForMethod(input.method);
  if (input.accuracyClass !== expectedAccuracy) {
    throw new TypeError(
      `method ${input.method} does not match accuracyClass ${input.accuracyClass}; `
      + `expected ${expectedAccuracy}`,
    );
  }
  if (!isComputationCoordinateSpace(input.coordinateSpace)) {
    throw new TypeError(
      `coordinateSpace is invalid: ${String(input.coordinateSpace)}`,
    );
  }
  if (input.lengthUnit !== undefined && input.lengthUnit !== 'm') {
    throw new TypeError('lengthUnit must be m');
  }

  return Object.freeze({
    method: input.method,
    accuracyClass: input.accuracyClass,
    coordinateSpace: input.coordinateSpace,
    lengthUnit: 'm',
    sourceModelVersion: normalizeModelVersion(input.sourceModelVersion),
    source: normalizeOperand(input.source, 'source'),
    target: normalizeOperand(input.target, 'target'),
    warnings: normalizeWarnings(input.warnings),
    errorBoundM: normalizeErrorBound(input.errorBoundM),
  });
}

export function isComputationProvenance(
  value: unknown,
): value is ComputationProvenance {
  if (!isRecord(value)) return false;
  if (
    !isComputationMethod(value.method)
    || !isAccuracyClass(value.accuracyClass)
    || accuracyClassForMethod(value.method) !== value.accuracyClass
    || !isComputationCoordinateSpace(value.coordinateSpace)
    || value.lengthUnit !== 'm'
  ) {
    return false;
  }

  try {
    normalizeModelVersion(value.sourceModelVersion);
    normalizeOperand(value.source, 'source');
    normalizeOperand(value.target, 'target');
    normalizeWarnings(value.warnings);
    normalizeErrorBound(value.errorBoundM);
    return value.sourceModelVersion !== undefined
      && value.warnings !== undefined
      && value.errorBoundM !== undefined;
  } catch {
    return false;
  }
}
