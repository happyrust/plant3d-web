import type {
  MaybePromise,
  ReferenceFrameDataPort,
  ReferenceFrameElementLookup,
} from '@/measurement/reference-frame/ports';
import type {
  ReferenceFrameAxisLabels,
  ReferenceFrameBasis,
  ReferenceFrameElementData,
} from '@/measurement/reference-frame/types';

import { pdmsGetTransform, type TransformResponse } from '@/api/genModelPdmsAttrApi';
import {
  deriveSectionBasisFromPlines,
  type SectionPlineSample,
} from '@/measurement/reference-frame/gensecSectionBasis';
import { normalizeReferenceFrameRefno } from '@/measurement/reference-frame/referenceFrameResolver';

export type PdmsTransformReferenceFramePortOptions = Readonly<{
  currentElementRefno: () => MaybePromise<string | null>;
  fetchTransform?: (refno: string) => Promise<TransformResponse>;
  /**
   * Element type lookup (E3D `hardtype`, e.g. `GENSEC`). Defaults to the active model source's
   * tree node; any failure resolves to `null` so the frame still resolves as an ordinary element.
   */
  fetchNoun?: (refno: string) => Promise<string | null>;
  /**
   * GENSEC only: the element's catalogue p-lines (`element/plines`), from which the section frame
   * E3D projects the Offset rows on is derived. Defaults to the gen-model-v1 endpoint; failures → `null`.
   */
  fetchPlines?: (refno: string) => Promise<readonly SectionPlineSample[] | null>;
  /** Source transform translation units to design-world metres. PDMS defaults to mm. */
  lengthScaleToM?: number;
  source?: string;
  axisLabels?: ReferenceFrameAxisLabels;
}>;

type TransformAdaptOptions = Readonly<{
  requestedRefno: string;
  lengthScaleToM?: number;
  source?: string;
  axisLabels?: ReferenceFrameAxisLabels;
  /** Element type when already known; omitted / null keeps the frame an ordinary element. */
  noun?: string | null;
  /** GENSEC section frame when derivable; omitted / null leaves the Offset rows on the ORI frame. */
  sectionBasis?: ReferenceFrameBasis | null;
}>;

/**
 * Default p-line lookup: gen-model-v1 `element/plines`. Only that source has section offsets
 * (legacy p-lines come from parquet without them), so under `legacy` this resolves to `null`.
 */
async function fetchPlinesFromGenModel(refno: string): Promise<readonly SectionPlineSample[] | null> {
  try {
    const { getModelSourceKind } = await import('@/model-source/kind');
    if (getModelSourceKind() !== 'gen-model-v1') return null;
    const { genModelV1ElementPlines } = await import('@/api/genModelV1Api');
    const response = await genModelV1ElementPlines({ refno });
    return Array.isArray(response?.plines) ? response.plines : null;
  } catch {
    return null;
  }
}

/**
 * Default element-type lookup: the active model source's tree node (the noun lives on the tree
 * node under both `legacy` and `gen-model-v1`). Loaded lazily so the measurement chain does not
 * statically depend on the model-source bundle (DuckDB-WASM under legacy).
 */
async function fetchNounFromModelSource(refno: string): Promise<string | null> {
  try {
    const { getModelSource } = await import('@/model-source');
    const response = await getModelSource().tree.node(refno);
    const noun = response?.node?.noun;
    return typeof noun === 'string' && noun.trim() !== '' ? noun.trim() : null;
  } catch {
    return null;
  }
}

function lookupFailure(
  reason: 'not-found' | 'unavailable' | 'invalid-data',
  message: string,
): ReferenceFrameElementLookup {
  return Object.freeze({ ok: false, reason, message });
}

function responseFailureReason(message: string): 'not-found' | 'unavailable' {
  return /not[\s_-]*found|不存在|找不到/i.test(message) ? 'not-found' : 'unavailable';
}

function finiteMatrix(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === 16
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

/**
 * Adapt the existing `/api/pdms/transform/:refno` contract into the
 * framework-independent resolver port contract.
 */
export function adaptPdmsTransformResponse(
  response: TransformResponse,
  options: TransformAdaptOptions,
): ReferenceFrameElementLookup {
  const requestedRefno = normalizeReferenceFrameRefno(options.requestedRefno);
  if (!requestedRefno) {
    return lookupFailure('invalid-data', 'Requested transform refno is invalid');
  }
  if (!response.success) {
    const message = typeof response.error_message === 'string' && response.error_message.trim()
      ? response.error_message.trim()
      : `Transform ${requestedRefno} is unavailable`;
    return lookupFailure(responseFailureReason(message), message);
  }

  const responseRefno = normalizeReferenceFrameRefno(response.refno);
  if (!responseRefno || responseRefno !== requestedRefno) {
    return lookupFailure(
      'invalid-data',
      `Transform response refno does not match ${requestedRefno}`,
    );
  }
  if (!finiteMatrix(response.world_transform)) {
    return lookupFailure(
      'invalid-data',
      `Transform ${requestedRefno} must be a finite 4x4 column-major matrix`,
    );
  }

  const matrix = response.world_transform;
  const affineTolerance = 1e-9;
  if (
    Math.abs(matrix[3]!) > affineTolerance
    || Math.abs(matrix[7]!) > affineTolerance
    || Math.abs(matrix[11]!) > affineTolerance
    || Math.abs(matrix[15]! - 1) > affineTolerance
  ) {
    return lookupFailure(
      'invalid-data',
      `Transform ${requestedRefno} is not an affine 4x4 matrix`,
    );
  }

  const lengthScaleToM = options.lengthScaleToM ?? 0.001;
  if (!Number.isFinite(lengthScaleToM) || lengthScaleToM <= 0) {
    return lookupFailure('invalid-data', 'Transform lengthScaleToM must be finite and positive');
  }

  let ownerRefno: string | null = null;
  const rawOwner: unknown = response.owner;
  if (rawOwner !== null && rawOwner !== undefined) {
    if (typeof rawOwner !== 'string') {
      return lookupFailure(
        'invalid-data',
        `Transform ${requestedRefno} has a non-string owner refno`,
      );
    }
    if (rawOwner.trim() === '') {
      ownerRefno = null;
    } else {
      ownerRefno = normalizeReferenceFrameRefno(rawOwner);
      if (!ownerRefno) {
        return lookupFailure(
          'invalid-data',
          `Transform ${requestedRefno} has an invalid owner refno`,
        );
      }
    }
  }

  const source = options.source?.trim() || 'pdms-transform-api';
  const element: ReferenceFrameElementData = Object.freeze({
    refno: requestedRefno,
    ownerRefno,
    coordinateSpace: 'design-world',
    lengthUnit: 'm',
    origin: Object.freeze([
      matrix[12]! * lengthScaleToM,
      matrix[13]! * lengthScaleToM,
      matrix[14]! * lengthScaleToM,
    ] as const),
    basis: Object.freeze({
      u: Object.freeze([matrix[0]!, matrix[1]!, matrix[2]!] as const),
      v: Object.freeze([matrix[4]!, matrix[5]!, matrix[6]!] as const),
      w: Object.freeze([matrix[8]!, matrix[9]!, matrix[10]!] as const),
    }),
    axisLabels: options.axisLabels ?? Object.freeze(['U', 'V', 'W'] as const),
    ...(typeof options.noun === 'string' && options.noun.trim() !== '' ? { noun: options.noun.trim() } : {}),
    ...(options.sectionBasis ? { sectionBasis: options.sectionBasis } : {}),
    provenance: Object.freeze({
      source,
      sourceCoordinateUnit: lengthScaleToM === 0.001 ? 'mm' : 'source-unit',
      lengthScaleToM,
    }),
  });
  return Object.freeze({ ok: true, element });
}

/**
 * Thin production adapter around the existing transform API.
 *
 * The caller supplies the current-element getter so this module does not
 * depend on Vue or a store. The API response's `owner` is the direct owner;
 * model-record `owner` must not be substituted because it is a generation root.
 */
export function createPdmsTransformReferenceFramePort(
  options: PdmsTransformReferenceFramePortOptions,
): ReferenceFrameDataPort {
  const fetchTransform = options.fetchTransform ?? pdmsGetTransform;
  const fetchNoun = options.fetchNoun ?? fetchNounFromModelSource;
  const fetchPlines = options.fetchPlines ?? fetchPlinesFromGenModel;
  return Object.freeze({
    currentElementRefno: options.currentElementRefno,
    async elementByRefno(refno): Promise<ReferenceFrameElementLookup> {
      const requestedRefno = normalizeReferenceFrameRefno(refno);
      if (!requestedRefno) {
        return lookupFailure('invalid-data', `Reference-frame refno is invalid: ${refno}`);
      }
      try {
        // The type lookup runs alongside the transform; it is a hint and never fails the frame.
        const [response, noun] = await Promise.all([
          fetchTransform(requestedRefno),
          fetchNoun(requestedRefno).catch(() => null),
        ]);
        // GENSEC: E3D projects the Offset rows on the section frame (yDir / zDir), not ORI —
        // derive it from the catalogue p-lines; unavailable → the ORI frame stands in.
        let sectionBasis: ReferenceFrameBasis | null = null;
        if (typeof noun === 'string' && noun.trim().toUpperCase() === 'GENSEC') {
          const plines = await fetchPlines(requestedRefno).catch(() => null);
          sectionBasis = plines && plines.length > 0 ? deriveSectionBasisFromPlines(plines) : null;
        }
        return adaptPdmsTransformResponse(response, {
          requestedRefno,
          noun,
          sectionBasis,
          ...(options.lengthScaleToM === undefined
            ? {}
            : { lengthScaleToM: options.lengthScaleToM }),
          ...(options.source === undefined ? {} : { source: options.source }),
          ...(options.axisLabels === undefined ? {} : { axisLabels: options.axisLabels }),
        });
      } catch (error) {
        return lookupFailure(
          'unavailable',
          `Failed to fetch transform ${requestedRefno}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
  });
}
