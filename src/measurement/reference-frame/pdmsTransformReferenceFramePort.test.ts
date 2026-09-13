import { describe, expect, it, vi } from 'vitest';

import {
  adaptPdmsTransformResponse,
  createPdmsTransformReferenceFramePort,
} from './pdmsTransformReferenceFramePort';
import { ReferenceFrameResolver } from './referenceFrameResolver';

import type { TransformResponse } from '@/api/genModelPdmsAttrApi';

const ROTATED_TRANSLATED_MATRIX = [
  0, 1, 0, 0,
  -1, 0, 0, 0,
  0, 0, 1, 0,
  1000, 2000, 3000, 1,
];

function response(
  overrides: Partial<TransformResponse> = {},
): TransformResponse {
  return {
    success: true,
    refno: '24381_100',
    world_transform: ROTATED_TRANSLATED_MATRIX,
    owner: '24381/10',
    ...overrides,
  };
}

describe('PDMS transform reference-frame adapter', () => {
  it('adapts a column-major mm transform into design-world metre frame data', () => {
    const result = adaptPdmsTransformResponse(response(), {
      requestedRefno: '24381/100',
    });

    expect(result).toEqual({
      ok: true,
      element: {
        refno: '24381_100',
        ownerRefno: '24381_10',
        coordinateSpace: 'design-world',
        lengthUnit: 'm',
        origin: [1, 2, 3],
        basis: {
          u: [0, 1, 0],
          v: [-1, 0, 0],
          w: [0, 0, 1],
        },
        axisLabels: ['U', 'V', 'W'],
        provenance: {
          source: 'pdms-transform-api',
          sourceCoordinateUnit: 'mm',
          lengthScaleToM: 0.001,
        },
      },
    });
  });

  it('supplies CE lazily and fetches canonical refnos for resolver use', async () => {
    const currentElementRefno = vi.fn(() => 'pe:<24381/100>');
    const fetchTransform = vi.fn(async (refno: string) => response({ refno }));
    const dataPort = createPdmsTransformReferenceFramePort({
      currentElementRefno,
      fetchTransform,
    });

    const result = await new ReferenceFrameResolver(dataPort).resolve('CE');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.origin).toEqual([1, 2, 3]);
    expect(currentElementRefno).toHaveBeenCalledOnce();
    expect(fetchTransform).toHaveBeenCalledWith('24381_100');
  });

  it.each([
    [
      response({ world_transform: [1, 0, 0] }),
      'invalid-data',
    ],
    [
      response({
        world_transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, Number.NaN, 0,
          0, 0, 0, 1,
        ],
      }),
      'invalid-data',
    ],
    [
      response({
        world_transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 1,
          0, 0, 0, 1,
        ],
      }),
      'invalid-data',
    ],
    [
      response({ owner: 'not-a-refno' }),
      'invalid-data',
    ],
    [
      response({ refno: '24381_101' }),
      'invalid-data',
    ],
  ] as const)('rejects malformed transform responses', (input, reason) => {
    const result = adaptPdmsTransformResponse(input, {
      requestedRefno: '24381_100',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected adapter failure');
    expect(result.reason).toBe(reason);
  });

  it('distinguishes not-found responses from transport failures', async () => {
    const notFound = adaptPdmsTransformResponse(response({
      success: false,
      world_transform: null,
      error_message: 'element not found',
    }), {
      requestedRefno: '24381_100',
    });
    expect(notFound).toMatchObject({ ok: false, reason: 'not-found' });

    const dataPort = createPdmsTransformReferenceFramePort({
      currentElementRefno: () => null,
      fetchTransform: async () => {
        throw new Error('network offline');
      },
    });
    const unavailable = await dataPort.elementByRefno('24381/100');
    expect(unavailable).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
    if (!unavailable.ok) expect(unavailable.message).toContain('network offline');
  });
});
