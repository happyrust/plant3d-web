export type ReferenceFrameVector3 = readonly [number, number, number];

export type ReferenceFrameBasis = Readonly<{
  u: ReferenceFrameVector3;
  v: ReferenceFrameVector3;
  w: ReferenceFrameVector3;
}>;

export type ReferenceFrameAxisLabels =
  | readonly ['X', 'Y', 'Z']
  | readonly ['E', 'N', 'U']
  | readonly ['U', 'V', 'W'];

export type ReferenceFrameSelector =
  | Readonly<{ kind: 'world' }>
  | Readonly<{ kind: 'current-element' }>
  | Readonly<{ kind: 'owner' }>
  | Readonly<{ kind: 'refno'; refno: string }>;

export type ReferenceFrameInput = string | ReferenceFrameSelector;

export type ReferenceFrameBasisPolicy = 'orthonormalize' | 'reject';

export type ReferenceFrameBasisAction =
  | 'identity'
  | 'accepted'
  | 'normalized'
  | 'orthonormalized';

export type ReferenceFrameBasisProvenance = Readonly<{
  policy: ReferenceFrameBasisPolicy;
  action: ReferenceFrameBasisAction;
  rawNorms: ReferenceFrameVector3;
  maxOrthogonalityError: number;
  rawHandedness: number;
  tolerance: number;
}>;

/**
 * Adapter evidence for one element frame.
 *
 * A data port must normalize the origin into design-world metres before the
 * resolver sees it. Basis vectors are directions and may still carry scale or
 * small non-orthogonal drift; the resolver validates or orthonormalizes them.
 */
export type ReferenceFrameElementProvenance = Readonly<{
  source: string;
  sourceCoordinateUnit?: string;
  lengthScaleToM?: number;
}>;

export type ReferenceFrameElementData = Readonly<{
  refno: string;
  ownerRefno: string | null;
  coordinateSpace: 'design-world';
  lengthUnit: 'm';
  origin: ReferenceFrameVector3;
  basis: ReferenceFrameBasis;
  axisLabels?: ReferenceFrameAxisLabels;
  provenance: ReferenceFrameElementProvenance;
}>;

export type ReferenceFrameResolution =
  | 'world'
  | 'current-element'
  | 'owner'
  | 'explicit-refno';

export type ReferenceFrameProvenance = Readonly<{
  resolution: ReferenceFrameResolution;
  selector: ReferenceFrameSelector;
  currentElementRefno: string | null;
  resolvedRefno: string | null;
  resolvedOwnerRefno: string | null;
  element: ReferenceFrameElementProvenance | null;
  basis: ReferenceFrameBasisProvenance;
}>;

export type ResolvedReferenceFrame = Readonly<{
  kind: 'world' | 'element';
  refno: string | null;
  origin: ReferenceFrameVector3;
  basis: ReferenceFrameBasis;
  axisLabels: ReferenceFrameAxisLabels;
  provenance: ReferenceFrameProvenance;
}>;

export type ReferenceFrameErrorCode =
  | 'INVALID_WRT_INPUT'
  | 'CURRENT_ELEMENT_UNSET'
  | 'CURRENT_ELEMENT_REFNO_INVALID'
  | 'REFERENCE_ELEMENT_NOT_FOUND'
  | 'OWNER_UNAVAILABLE'
  | 'FRAME_DATA_UNAVAILABLE'
  | 'INVALID_FRAME_DATA'
  | 'NON_FINITE_FRAME_DATA'
  | 'SINGULAR_FRAME_BASIS'
  | 'LEFT_HANDED_FRAME_BASIS'
  | 'NON_ORTHOGONAL_FRAME_BASIS'
  | 'INVALID_TRANSFORM_INPUT'
  | 'NON_FINITE_TRANSFORM_INPUT';

export type ReferenceFrameError = Readonly<{
  code: ReferenceFrameErrorCode;
  message: string;
  refno?: string;
  field?: string;
  operation?: string;
}>;

export type ReferenceFrameResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: ReferenceFrameError }>;

export type ReferenceFrameResolverOptions = Readonly<{
  basisPolicy?: ReferenceFrameBasisPolicy;
  orthogonalityTolerance?: number;
  singularityTolerance?: number;
}>;
