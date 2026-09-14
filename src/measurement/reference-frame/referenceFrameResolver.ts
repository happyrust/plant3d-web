import type { ReferenceFrameDataPort, ReferenceFrameElementLookup } from './ports';
import type {
  ReferenceFrameAxisLabels,
  ReferenceFrameBasis,
  ReferenceFrameBasisPolicy,
  ReferenceFrameBasisProvenance,
  ReferenceFrameElementData,
  ReferenceFrameErrorCode,
  ReferenceFrameInput,
  ReferenceFrameResolution,
  ReferenceFrameResolverOptions,
  ReferenceFrameResult,
  ReferenceFrameSelector,
  ReferenceFrameVector3,
  ResolvedReferenceFrame,
} from './types';

type NormalizedResolverOptions = Readonly<{
  basisPolicy: ReferenceFrameBasisPolicy;
  orthogonalityTolerance: number;
  singularityTolerance: number;
}>;

type ErrorDetails = Readonly<{
  refno?: string;
  field?: string;
  operation?: string;
}>;

const WORLD_AXIS_LABELS = Object.freeze(['X', 'Y', 'Z'] as const);
const ELEMENT_AXIS_LABELS = Object.freeze(['U', 'V', 'W'] as const);
const WORLD_ORIGIN = vector(0, 0, 0);
const WORLD_BASIS: ReferenceFrameBasis = Object.freeze({
  u: vector(1, 0, 0),
  v: vector(0, 1, 0),
  w: vector(0, 0, 1),
});

function vector(x: number, y: number, z: number): ReferenceFrameVector3 {
  return Object.freeze([x, y, z] as const);
}

function success<T>(value: T): ReferenceFrameResult<T> {
  return Object.freeze({ ok: true, value });
}

function failure<T>(
  code: ReferenceFrameErrorCode,
  message: string,
  details: ErrorDetails = {},
): ReferenceFrameResult<T> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message, ...details }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveFiniteOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite positive number`);
  }
  return value;
}

function normalizeOptions(options: ReferenceFrameResolverOptions): NormalizedResolverOptions {
  const basisPolicy = options.basisPolicy ?? 'orthonormalize';
  if (basisPolicy !== 'orthonormalize' && basisPolicy !== 'reject') {
    throw new TypeError(`basisPolicy is invalid: ${String(basisPolicy)}`);
  }
  const orthogonalityTolerance = positiveFiniteOption(
    options.orthogonalityTolerance,
    1e-6,
    'orthogonalityTolerance',
  );
  const singularityTolerance = positiveFiniteOption(
    options.singularityTolerance,
    1e-12,
    'singularityTolerance',
  );
  if (singularityTolerance >= orthogonalityTolerance) {
    throw new TypeError('singularityTolerance must be smaller than orthogonalityTolerance');
  }
  return Object.freeze({
    basisPolicy,
    orthogonalityTolerance,
    singularityTolerance,
  });
}

/**
 * Normalize an E3D/PDMS refno or DBREF spelling into the repository's
 * canonical `dbnum_seqno` form.
 */
export function normalizeReferenceFrameRefno(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let candidate = value.trim();
  if (!candidate) return null;

  candidate = candidate.replace(/^wrt\b\s*/i, '').trim();
  candidate = candidate.replace(/^dbref\b\s*[:=]?\s*/i, '').trim();
  candidate = candidate.replace(/^pe\s*:\s*/i, '').trim();
  candidate = candidate.replace(/^=\s*/, '').trim();

  const wrapped = /^(?:<([^<>]+)>|⟨([^⟨⟩]+)⟩)$/.exec(candidate);
  if (wrapped) candidate = String(wrapped[1] ?? wrapped[2] ?? '').trim();

  const match = /^(\d+)\s*[/_,]\s*(\d+)$/.exec(candidate);
  if (!match) return null;
  return `${BigInt(match[1]!).toString()}_${BigInt(match[2]!).toString()}`;
}

/** Normalize World, CE, Owner and explicit DBREF/refno WRT selectors. */
export function normalizeReferenceFrameSelector(
  input: ReferenceFrameInput,
): ReferenceFrameResult<ReferenceFrameSelector> {
  if (typeof input === 'string') {
    const withoutPrefix = input.trim().replace(/^wrt\b\s*/i, '').trim();
    if (!withoutPrefix) {
      return failure('INVALID_WRT_INPUT', 'WRT input must not be empty');
    }
    const keyword = withoutPrefix.toLowerCase().replace(/[\s_-]+/g, ' ');
    if (withoutPrefix === '/*' || keyword === 'world') {
      return success(Object.freeze({ kind: 'world' as const }));
    }
    if (keyword === 'ce' || keyword === 'current' || keyword === 'current element') {
      return success(Object.freeze({ kind: 'current-element' as const }));
    }
    if (keyword === 'owner') {
      return success(Object.freeze({ kind: 'owner' as const }));
    }
    const refno = normalizeReferenceFrameRefno(withoutPrefix);
    if (refno) {
      return success(Object.freeze({ kind: 'refno' as const, refno }));
    }
    return failure(
      'INVALID_WRT_INPUT',
      `Unsupported WRT input: ${withoutPrefix}`,
    );
  }

  if (!isRecord(input)) {
    return failure('INVALID_WRT_INPUT', 'WRT input must be a string or selector object');
  }
  const kind: unknown = input.kind;
  switch (kind) {
    case 'world':
      return success(Object.freeze({ kind: 'world' as const }));
    case 'current-element':
      return success(Object.freeze({ kind: 'current-element' as const }));
    case 'owner':
      return success(Object.freeze({ kind: 'owner' as const }));
    case 'refno': {
      const refno = normalizeReferenceFrameRefno(
        (input as Record<string, unknown>).refno,
      );
      return refno
        ? success(Object.freeze({ kind: 'refno' as const, refno }))
        : failure('INVALID_WRT_INPUT', 'The explicit WRT refno/DBREF is invalid');
    }
    default:
      return failure(
        'INVALID_WRT_INPUT',
        `Unsupported WRT selector kind: ${String(kind)}`,
      );
  }
}

function readFiniteVector(
  value: unknown,
  field: string,
  errorCode: Extract<
    ReferenceFrameErrorCode,
    'INVALID_FRAME_DATA' | 'NON_FINITE_FRAME_DATA'
      | 'INVALID_TRANSFORM_INPUT' | 'NON_FINITE_TRANSFORM_INPUT'
  >,
  nonFiniteCode: Extract<
    ReferenceFrameErrorCode,
    'NON_FINITE_FRAME_DATA' | 'NON_FINITE_TRANSFORM_INPUT'
  >,
  details: ErrorDetails = {},
): ReferenceFrameResult<ReferenceFrameVector3> {
  if (!Array.isArray(value) || value.length !== 3) {
    return failure(errorCode, `${field} must contain exactly three numbers`, {
      ...details,
      field,
    });
  }
  const [x, y, z] = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
    return failure(errorCode, `${field} must contain exactly three numbers`, {
      ...details,
      field,
    });
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return failure(nonFiniteCode, `${field} must contain only finite numbers`, {
      ...details,
      field,
    });
  }
  return success(vector(x, y, z));
}

function dot(a: ReferenceFrameVector3, b: ReferenceFrameVector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: ReferenceFrameVector3, b: ReferenceFrameVector3): ReferenceFrameVector3 {
  return vector(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function scale(value: ReferenceFrameVector3, scalar: number): ReferenceFrameVector3 {
  return vector(value[0] * scalar, value[1] * scalar, value[2] * scalar);
}

function cross(a: ReferenceFrameVector3, b: ReferenceFrameVector3): ReferenceFrameVector3 {
  return vector(
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
}

function norm(value: ReferenceFrameVector3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function normalize(
  value: ReferenceFrameVector3,
  length: number,
): ReferenceFrameVector3 {
  return vector(value[0] / length, value[1] / length, value[2] / length);
}

function normalizeBasis(
  raw: ReferenceFrameBasis,
  options: NormalizedResolverOptions,
  refno: string,
): ReferenceFrameResult<Readonly<{
  basis: ReferenceFrameBasis;
  provenance: ReferenceFrameBasisProvenance;
}>> {
  const rawNorms = vector(norm(raw.u), norm(raw.v), norm(raw.w));
  if (rawNorms.some(value => value <= options.singularityTolerance)) {
    return failure(
      'SINGULAR_FRAME_BASIS',
      `Reference frame ${refno} has a zero or degenerate basis axis`,
      { refno, field: 'basis' },
    );
  }

  const u = normalize(raw.u, rawNorms[0]);
  const rawVUnit = normalize(raw.v, rawNorms[1]);
  const rawWUnit = normalize(raw.w, rawNorms[2]);
  const vRemainder = subtract(rawVUnit, scale(u, dot(rawVUnit, u)));
  const vRemainderNorm = norm(vRemainder);
  if (vRemainderNorm <= options.singularityTolerance) {
    return failure(
      'SINGULAR_FRAME_BASIS',
      `Reference frame ${refno} has parallel U and V axes`,
      { refno, field: 'basis' },
    );
  }
  const v = normalize(vRemainder, vRemainderNorm);
  const w = normalize(cross(u, v), 1);
  const rawHandedness = dot(w, rawWUnit);
  if (Math.abs(rawHandedness) <= options.singularityTolerance) {
    return failure(
      'SINGULAR_FRAME_BASIS',
      `Reference frame ${refno} has an inconsistent W axis`,
      { refno, field: 'basis' },
    );
  }
  if (rawHandedness < 0) {
    return failure(
      'LEFT_HANDED_FRAME_BASIS',
      `Reference frame ${refno} is left-handed`,
      { refno, field: 'basis' },
    );
  }

  const maxOrthogonalityError = Math.max(
    Math.abs(dot(u, rawVUnit)),
    Math.abs(dot(u, rawWUnit)),
    Math.abs(dot(rawVUnit, rawWUnit)),
  );
  const handednessError = Math.abs(1 - rawHandedness);
  if (
    options.basisPolicy === 'reject'
    && Math.max(maxOrthogonalityError, handednessError) > options.orthogonalityTolerance
  ) {
    return failure(
      'NON_ORTHOGONAL_FRAME_BASIS',
      `Reference frame ${refno} exceeds the orthogonality tolerance`,
      { refno, field: 'basis' },
    );
  }

  const maxLengthError = Math.max(
    Math.abs(rawNorms[0] - 1),
    Math.abs(rawNorms[1] - 1),
    Math.abs(rawNorms[2] - 1),
  );
  const action = Math.max(maxOrthogonalityError, handednessError)
    > options.orthogonalityTolerance
    ? 'orthonormalized'
    : maxLengthError > options.orthogonalityTolerance
      ? 'normalized'
      : 'accepted';

  return success(Object.freeze({
    basis: Object.freeze({ u, v, w }),
    provenance: Object.freeze({
      policy: options.basisPolicy,
      action,
      rawNorms,
      maxOrthogonalityError,
      rawHandedness,
      tolerance: options.orthogonalityTolerance,
    }),
  }));
}

function readAxisLabels(value: unknown, refno: string): ReferenceFrameResult<ReferenceFrameAxisLabels> {
  if (value === undefined) return success(ELEMENT_AXIS_LABELS);
  if (!Array.isArray(value) || value.length !== 3) {
    return failure(
      'INVALID_FRAME_DATA',
      `Reference frame ${refno} axis labels are invalid`,
      { refno, field: 'axisLabels' },
    );
  }
  const key = value.join('/');
  if (key === 'X/Y/Z') return success(WORLD_AXIS_LABELS);
  if (key === 'E/N/U') return success(Object.freeze(['E', 'N', 'U'] as const));
  if (key === 'U/V/W') return success(ELEMENT_AXIS_LABELS);
  return failure(
    'INVALID_FRAME_DATA',
    `Reference frame ${refno} axis labels are unsupported`,
    { refno, field: 'axisLabels' },
  );
}

function resolutionFor(selector: ReferenceFrameSelector): ReferenceFrameResolution {
  switch (selector.kind) {
    case 'world':
      return 'world';
    case 'current-element':
      return 'current-element';
    case 'owner':
      return 'owner';
    case 'refno':
      return 'explicit-refno';
  }
}

function errorForLookup(
  lookup: Exclude<ReferenceFrameElementLookup, { ok: true }>,
  refno: string,
): ReferenceFrameResult<never> {
  switch (lookup.reason) {
    case 'not-found':
      return failure('REFERENCE_ELEMENT_NOT_FOUND', lookup.message, { refno });
    case 'unavailable':
      return failure('FRAME_DATA_UNAVAILABLE', lookup.message, { refno });
    case 'invalid-data':
      return failure('INVALID_FRAME_DATA', lookup.message, { refno });
  }
}

export class ReferenceFrameResolver {
  private readonly options: NormalizedResolverOptions;

  constructor(
    private readonly port: ReferenceFrameDataPort,
    options: ReferenceFrameResolverOptions = {},
  ) {
    this.options = normalizeOptions(options);
  }

  async resolve(input: ReferenceFrameInput): Promise<ReferenceFrameResult<ResolvedReferenceFrame>> {
    const selectorResult = normalizeReferenceFrameSelector(input);
    if (!selectorResult.ok) return selectorResult;
    const selector = selectorResult.value;
    if (selector.kind === 'world') return success(this.worldFrame(selector));

    let currentElementRefno: string | null = null;
    let targetRefno: string;
    if (selector.kind === 'refno') {
      targetRefno = selector.refno;
    } else {
      const currentResult = await this.readCurrentElementRefno();
      if (!currentResult.ok) return currentResult;
      currentElementRefno = currentResult.value;
      targetRefno = currentElementRefno;
    }

    if (selector.kind === 'owner') {
      const currentResult = await this.readElement(targetRefno);
      if (!currentResult.ok) return currentResult;
      const ownerValue = currentResult.value.ownerRefno;
      if (!ownerValue) {
        return failure(
          'OWNER_UNAVAILABLE',
          `Current element ${targetRefno} has no owner`,
          { refno: targetRefno, field: 'ownerRefno' },
        );
      }
      const ownerRefno = normalizeReferenceFrameRefno(ownerValue);
      if (!ownerRefno) {
        return failure(
          'INVALID_FRAME_DATA',
          `Current element ${targetRefno} has an invalid owner refno`,
          { refno: targetRefno, field: 'ownerRefno' },
        );
      }
      if (ownerRefno === targetRefno) {
        return failure(
          'OWNER_UNAVAILABLE',
          `Current element ${targetRefno} cannot own itself`,
          { refno: targetRefno, field: 'ownerRefno' },
        );
      }
      targetRefno = ownerRefno;
    }

    const elementResult = await this.readElement(targetRefno);
    if (!elementResult.ok) return elementResult;
    return this.frameFromElement(
      elementResult.value,
      selector,
      currentElementRefno,
      targetRefno,
    );
  }

  private worldFrame(selector: ReferenceFrameSelector): ResolvedReferenceFrame {
    return Object.freeze({
      kind: 'world',
      refno: null,
      origin: WORLD_ORIGIN,
      basis: WORLD_BASIS,
      axisLabels: WORLD_AXIS_LABELS,
      provenance: Object.freeze({
        resolution: 'world',
        selector,
        currentElementRefno: null,
        resolvedRefno: null,
        resolvedOwnerRefno: null,
        element: null,
        basis: Object.freeze({
          policy: this.options.basisPolicy,
          action: 'identity',
          rawNorms: vector(1, 1, 1),
          maxOrthogonalityError: 0,
          rawHandedness: 1,
          tolerance: this.options.orthogonalityTolerance,
        }),
      }),
    });
  }

  private async readCurrentElementRefno(): Promise<ReferenceFrameResult<string>> {
    let value: string | null;
    try {
      value = await this.port.currentElementRefno();
    } catch (error) {
      return failure(
        'FRAME_DATA_UNAVAILABLE',
        `Failed to read the current element: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (value === null || String(value).trim() === '') {
      return failure('CURRENT_ELEMENT_UNSET', 'CE/current element is not set');
    }
    const refno = normalizeReferenceFrameRefno(value);
    return refno
      ? success(refno)
      : failure(
        'CURRENT_ELEMENT_REFNO_INVALID',
        `CE/current element refno is invalid: ${String(value)}`,
      );
  }

  private async readElement(
    refno: string,
  ): Promise<ReferenceFrameResult<ReferenceFrameElementData>> {
    let lookup: ReferenceFrameElementLookup;
    try {
      lookup = await this.port.elementByRefno(refno);
    } catch (error) {
      return failure(
        'FRAME_DATA_UNAVAILABLE',
        `Failed to read reference frame ${refno}: ${error instanceof Error ? error.message : String(error)}`,
        { refno },
      );
    }
    return lookup.ok ? success(lookup.element) : errorForLookup(lookup, refno);
  }

  /**
   * GENSEC section frame (E3D `yDir` / `zDir`, golden G3-04). It only steers the Offset rows, so a
   * missing or degenerate value is dropped instead of failing the frame; a usable one is normalised
   * with the same basis policy as the main frame.
   */
  private readSectionBasis(
    raw: ReferenceFrameElementData['sectionBasis'],
    refno: string,
  ): ReferenceFrameBasis | null {
    if (!isRecord(raw)) return null;
    const read = (name: 'u' | 'v' | 'w') => readFiniteVector(
      raw[name],
      `sectionBasis.${name}`,
      'INVALID_FRAME_DATA',
      'NON_FINITE_FRAME_DATA',
      { refno },
    );
    const u = read('u');
    const v = read('v');
    const w = read('w');
    if (!u.ok || !v.ok || !w.ok) return null;
    const normalized = normalizeBasis(Object.freeze({ u: u.value, v: v.value, w: w.value }), this.options, refno);
    return normalized.ok ? normalized.value.basis : null;
  }

  private frameFromElement(
    element: ReferenceFrameElementData,
    selector: ReferenceFrameSelector,
    currentElementRefno: string | null,
    expectedRefno: string,
  ): ReferenceFrameResult<ResolvedReferenceFrame> {
    const refno = normalizeReferenceFrameRefno(element.refno);
    if (!refno || refno !== expectedRefno) {
      return failure(
        'INVALID_FRAME_DATA',
        `Reference-frame data returned the wrong refno for ${expectedRefno}`,
        { refno: expectedRefno, field: 'refno' },
      );
    }
    if (element.coordinateSpace !== 'design-world' || element.lengthUnit !== 'm') {
      return failure(
        'INVALID_FRAME_DATA',
        `Reference frame ${refno} must be expressed in design-world metres`,
        { refno, field: 'coordinateSpace' },
      );
    }
    const originResult = readFiniteVector(
      element.origin,
      'origin',
      'INVALID_FRAME_DATA',
      'NON_FINITE_FRAME_DATA',
      { refno },
    );
    if (!originResult.ok) return originResult;
    if (!isRecord(element.basis)) {
      return failure(
        'INVALID_FRAME_DATA',
        `Reference frame ${refno} basis is missing`,
        { refno, field: 'basis' },
      );
    }
    const uResult = readFiniteVector(
      element.basis.u,
      'basis.u',
      'INVALID_FRAME_DATA',
      'NON_FINITE_FRAME_DATA',
      { refno },
    );
    if (!uResult.ok) return uResult;
    const vResult = readFiniteVector(
      element.basis.v,
      'basis.v',
      'INVALID_FRAME_DATA',
      'NON_FINITE_FRAME_DATA',
      { refno },
    );
    if (!vResult.ok) return vResult;
    const wResult = readFiniteVector(
      element.basis.w,
      'basis.w',
      'INVALID_FRAME_DATA',
      'NON_FINITE_FRAME_DATA',
      { refno },
    );
    if (!wResult.ok) return wResult;
    const basisResult = normalizeBasis(Object.freeze({
      u: uResult.value,
      v: vResult.value,
      w: wResult.value,
    }), this.options, refno);
    if (!basisResult.ok) return basisResult;
    const labelsResult = readAxisLabels(element.axisLabels, refno);
    if (!labelsResult.ok) return labelsResult;
    if (!isRecord(element.provenance) || typeof element.provenance.source !== 'string'
      || element.provenance.source.trim() === '') {
      return failure(
        'INVALID_FRAME_DATA',
        `Reference frame ${refno} provenance source is missing`,
        { refno, field: 'provenance.source' },
      );
    }

    let ownerRefno: string | null = null;
    if (element.ownerRefno !== null) {
      ownerRefno = normalizeReferenceFrameRefno(element.ownerRefno);
      if (!ownerRefno) {
        return failure(
          'INVALID_FRAME_DATA',
          `Reference frame ${refno} owner refno is invalid`,
          { refno, field: 'ownerRefno' },
        );
      }
    }

    // The element type is a hint, not frame data: a missing / malformed value must not fail the frame.
    const noun = typeof element.noun === 'string' && element.noun.trim() !== ''
      ? element.noun.trim().toUpperCase()
      : null;
    // Same for the GENSEC section frame: keep it only when it is a usable orthonormal basis.
    const sectionBasis = this.readSectionBasis(element.sectionBasis, refno);

    return success(Object.freeze({
      kind: 'element',
      refno,
      origin: originResult.value,
      basis: basisResult.value.basis,
      axisLabels: labelsResult.value,
      noun,
      sectionBasis,
      provenance: Object.freeze({
        resolution: resolutionFor(selector),
        selector,
        currentElementRefno,
        resolvedRefno: refno,
        resolvedOwnerRefno: ownerRefno,
        element: Object.freeze({ ...element.provenance, source: element.provenance.source.trim() }),
        basis: basisResult.value.provenance,
      }),
    }));
  }
}

function transformInput(
  value: readonly number[],
  operation: string,
): ReferenceFrameResult<ReferenceFrameVector3> {
  return readFiniteVector(
    value,
    'value',
    'INVALID_TRANSFORM_INPUT',
    'NON_FINITE_TRANSFORM_INPUT',
    { operation },
  );
}

/** Transform a design-world point into frame-local coordinates. */
export function designPointToFrame(
  frame: ResolvedReferenceFrame,
  point: readonly number[],
): ReferenceFrameResult<ReferenceFrameVector3> {
  const pointResult = transformInput(point, 'design-point-to-frame');
  if (!pointResult.ok) return pointResult;
  const relative = subtract(pointResult.value, frame.origin);
  return success(vector(
    dot(relative, frame.basis.u),
    dot(relative, frame.basis.v),
    dot(relative, frame.basis.w),
  ));
}

/** Transform a frame-local point into design-world coordinates. */
export function framePointToDesign(
  frame: ResolvedReferenceFrame,
  point: readonly number[],
): ReferenceFrameResult<ReferenceFrameVector3> {
  const pointResult = transformInput(point, 'frame-point-to-design');
  if (!pointResult.ok) return pointResult;
  const [u, v, w] = pointResult.value;
  return success(vector(
    frame.origin[0] + frame.basis.u[0] * u + frame.basis.v[0] * v + frame.basis.w[0] * w,
    frame.origin[1] + frame.basis.u[1] * u + frame.basis.v[1] * v + frame.basis.w[1] * w,
    frame.origin[2] + frame.basis.u[2] * u + frame.basis.v[2] * v + frame.basis.w[2] * w,
  ));
}

/** Project a design-world vector into frame-local components. */
export function designVectorToFrame(
  frame: ResolvedReferenceFrame,
  value: readonly number[],
): ReferenceFrameResult<ReferenceFrameVector3> {
  const valueResult = transformInput(value, 'design-vector-to-frame');
  if (!valueResult.ok) return valueResult;
  return success(vector(
    dot(valueResult.value, frame.basis.u),
    dot(valueResult.value, frame.basis.v),
    dot(valueResult.value, frame.basis.w),
  ));
}

/** Expand frame-local vector components into a design-world vector. */
export function frameVectorToDesign(
  frame: ResolvedReferenceFrame,
  value: readonly number[],
): ReferenceFrameResult<ReferenceFrameVector3> {
  const valueResult = transformInput(value, 'frame-vector-to-design');
  if (!valueResult.ok) return valueResult;
  const [u, v, w] = valueResult.value;
  return success(vector(
    frame.basis.u[0] * u + frame.basis.v[0] * v + frame.basis.w[0] * w,
    frame.basis.u[1] * u + frame.basis.v[1] * v + frame.basis.w[1] * w,
    frame.basis.u[2] * u + frame.basis.v[2] * v + frame.basis.w[2] * w,
  ));
}
