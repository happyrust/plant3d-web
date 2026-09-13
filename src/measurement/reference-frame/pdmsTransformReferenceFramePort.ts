import type {
  MaybePromise,
  ReferenceFrameDataPort,
  ReferenceFrameElementLookup,
} from '@/measurement/reference-frame/ports';
import type {
  ReferenceFrameAxisLabels,
  ReferenceFrameElementData,
} from '@/measurement/reference-frame/types';

import { pdmsGetTransform, type TransformResponse } from '@/api/genModelPdmsAttrApi';
import { normalizeReferenceFrameRefno } from '@/measurement/reference-frame/referenceFrameResolver';

export type PdmsTransformReferenceFramePortOptions = Readonly<{
  currentElementRefno: () => MaybePromise<string | null>;
  fetchTransform?: (refno: string) => Promise<TransformResponse>;
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
}>;

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
  return Object.freeze({
    currentElementRefno: options.currentElementRefno,
    async elementByRefno(refno): Promise<ReferenceFrameElementLookup> {
      const requestedRefno = normalizeReferenceFrameRefno(refno);
      if (!requestedRefno) {
        return lookupFailure('invalid-data', `Reference-frame refno is invalid: ${refno}`);
      }
      try {
        const response = await fetchTransform(requestedRefno);
        return adaptPdmsTransformResponse(response, {
          requestedRefno,
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
