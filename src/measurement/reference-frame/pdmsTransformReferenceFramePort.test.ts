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
      fetchNoun: async () => null,
    });

    const result = await new ReferenceFrameResolver(dataPort).resolve('CE');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.origin).toEqual([1, 2, 3]);
    expect(result.value.noun).toBeNull();
    expect(currentElementRefno).toHaveBeenCalledOnce();
    expect(fetchTransform).toHaveBeenCalledWith('24381_100');
  });

  it('carries the element type (hardtype) as a hint: adapter option, port lookup, resolver upper-cases it', async () => {
    // Adapter: a known type lands on the element; blank / null types leave the key out.
    const typed = adaptPdmsTransformResponse(response(), { requestedRefno: '24381_100', noun: 'gensec' });
    expect(typed.ok && typed.element.noun).toBe('gensec');
    const blank = adaptPdmsTransformResponse(response(), { requestedRefno: '24381_100', noun: '  ' });
    expect(blank.ok && 'noun' in blank.element).toBe(false);
    const missing = adaptPdmsTransformResponse(response(), { requestedRefno: '24381_100', noun: null });
    expect(missing.ok && 'noun' in missing.element).toBe(false);

    // Port: the type lookup runs alongside the transform and is normalised by the resolver (GENSEC rule key).
    const fetchNoun = vi.fn(async (refno: string) => (refno === '24381_100' ? 'Gensec' : null));
    const dataPort = createPdmsTransformReferenceFramePort({
      currentElementRefno: () => null,
      fetchTransform: async (refno) => response({ refno }),
      fetchNoun,
    });
    const frame = await new ReferenceFrameResolver(dataPort).resolve('=24381/100');
    expect(frame.ok && frame.value.noun).toBe('GENSEC');
    expect(fetchNoun).toHaveBeenCalledWith('24381_100');

    // A failing type lookup must not fail the frame: it just stays an ordinary element.
    const failingPort = createPdmsTransformReferenceFramePort({
      currentElementRefno: () => null,
      fetchTransform: async (refno) => response({ refno }),
      fetchNoun: async () => {
        throw new Error('model tree offline');
      },
    });
    const untyped = await new ReferenceFrameResolver(failingPort).resolve('=24381/100');
    expect(untyped.ok).toBe(true);
    expect(untyped.ok && untyped.value.noun).toBeNull();
  });

  it('derives the GENSEC section frame from the p-lines; other types never ask for them', async () => {
    // G3-04 section frame X = W / Y = S / Z = U laid out as p-line offsets (mm) + world starts.
    const plines = [
      { key: 'NA', offset: [0, 0] as const, start: [15666.93, 4150, 6133] as const, dir: [0, 0, 1] as const },
      { key: 'TOS', offset: [0, 50] as const, start: [15666.93, 4100, 6133] as const, dir: [0, 0, 1] as const },
      { key: 'LTOS', offset: [-50, 100] as const, start: [15716.93, 4050, 6133] as const, dir: [0, 0, 1] as const },
    ];
    const fetchPlines = vi.fn(async () => plines);
    const nouns: Record<string, string> = { '24381_100': 'GENSEC', '24381_101': 'SCTN' };
    const dataPort = createPdmsTransformReferenceFramePort({
      currentElementRefno: () => null,
      fetchTransform: async (refno) => response({ refno }),
      fetchNoun: async (refno) => nouns[refno] ?? null,
      fetchPlines,
    });
    const resolver = new ReferenceFrameResolver(dataPort);

    const gensec = await resolver.resolve('=24381/100');
    expect(gensec.ok).toBe(true);
    if (!gensec.ok) throw new Error(gensec.error.message);
    expect(fetchPlines).toHaveBeenCalledWith('24381_100');
    const expectBasis = (actual: { u: readonly number[]; v: readonly number[]; w: readonly number[] } | null | undefined, expected: number[][]) => {
      expect(actual).toBeTruthy();
      [actual!.u, actual!.v, actual!.w].forEach((axis, index) => {
        expected[index]!.forEach((value, component) => expect(axis[component]).toBeCloseTo(value, 9));
      });
    };
    // The ORI frame from the transform (X = N / Y = W) is kept for the frame itself…
    expectBasis(gensec.value.basis, [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]);
    // …while the section frame rides along for the Offset rows.
    expectBasis(gensec.value.sectionBasis, [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]);

    const sctn = await resolver.resolve('=24381/101');
    expect(sctn.ok && sctn.value.noun).toBe('SCTN');
    expect(sctn.ok && sctn.value.sectionBasis).toBeNull();
    expect(fetchPlines).toHaveBeenCalledTimes(1);

    // A failing / empty p-line lookup keeps the GENSEC frame and just drops the section frame.
    const noPlines = createPdmsTransformReferenceFramePort({
      currentElementRefno: () => null,
      fetchTransform: async (refno) => response({ refno }),
      fetchNoun: async () => 'GENSEC',
      fetchPlines: async () => {
        throw new Error('plines offline');
      },
    });
    const fallback = await new ReferenceFrameResolver(noPlines).resolve('=24381/100');
    expect(fallback.ok && fallback.value.noun).toBe('GENSEC');
    expect(fallback.ok && fallback.value.sectionBasis).toBeNull();
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
      fetchNoun: async () => null,
    });
    const unavailable = await dataPort.elementByRefno('24381/100');
    expect(unavailable).toMatchObject({
      ok: false,
      reason: 'unavailable',
    });
    if (!unavailable.ok) expect(unavailable.message).toContain('network offline');
  });
});
