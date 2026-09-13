import { describe, expect, it, vi } from 'vitest';

import {
  ReferenceFrameResolver,
  designPointToFrame,
  designVectorToFrame,
  framePointToDesign,
  frameVectorToDesign,
  normalizeReferenceFrameRefno,
  normalizeReferenceFrameSelector,
} from './referenceFrameResolver';

import type { ReferenceFrameDataPort } from './ports';
import type {
  ReferenceFrameElementData,
  ReferenceFrameResult,
  ResolvedReferenceFrame,
} from './types';

const IDENTITY_BASIS = Object.freeze({
  u: Object.freeze([1, 0, 0] as const),
  v: Object.freeze([0, 1, 0] as const),
  w: Object.freeze([0, 0, 1] as const),
});

function element(
  refno: string,
  overrides: Partial<ReferenceFrameElementData> = {},
): ReferenceFrameElementData {
  return {
    refno,
    ownerRefno: null,
    coordinateSpace: 'design-world',
    lengthUnit: 'm',
    origin: [0, 0, 0],
    basis: IDENTITY_BASIS,
    provenance: { source: 'test' },
    ...overrides,
  };
}

function port(
  elements: readonly ReferenceFrameElementData[] = [],
  currentElementRefno: string | null = null,
): ReferenceFrameDataPort {
  const byRefno = new Map(elements.map(item => [item.refno, item]));
  return {
    currentElementRefno: () => currentElementRefno,
    elementByRefno: refno => {
      const item = byRefno.get(refno);
      return item
        ? { ok: true, element: item }
        : { ok: false, reason: 'not-found', message: `missing ${refno}` };
    },
  };
}

function valueOf<T>(result: ReferenceFrameResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function errorCodeOf<T>(result: ReferenceFrameResult<T>): string {
  expect(result.ok).toBe(false);
  return result.ok ? 'unexpected-success' : result.error.code;
}

function expectVectorClose(actual: readonly number[], expected: readonly number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 10));
}

describe('reference-frame WRT normalization', () => {
  it.each([
    ['World', { kind: 'world' }],
    ['WRT /*', { kind: 'world' }],
    ['CE', { kind: 'current-element' }],
    ['current element', { kind: 'current-element' }],
    ['WRT OWNER', { kind: 'owner' }],
    ['24381/145018', { kind: 'refno', refno: '24381_145018' }],
    ['=24381_145018', { kind: 'refno', refno: '24381_145018' }],
    ['pe:<24381/145018>', { kind: 'refno', refno: '24381_145018' }],
    ['WRT DBREF = 24381/145018', { kind: 'refno', refno: '24381_145018' }],
  ])('normalizes %s', (input, expected) => {
    expect(valueOf(normalizeReferenceFrameSelector(input))).toEqual(expected);
  });

  it('canonicalizes refnos without Number precision loss', () => {
    expect(normalizeReferenceFrameRefno('pe:⟨00024381/99999999999999999999⟩'))
      .toBe('24381_99999999999999999999');
  });

  it.each(['', 'WRT', 'some element', 'pe:<bad>'])(
    'rejects unsupported WRT input %j without falling back to World',
    (input) => {
      expect(errorCodeOf(normalizeReferenceFrameSelector(input))).toBe('INVALID_WRT_INPUT');
    },
  );
});

describe('ReferenceFrameResolver', () => {
  it('resolves World as deterministic identity without consulting the data port', async () => {
    const dataPort: ReferenceFrameDataPort = {
      currentElementRefno: vi.fn(() => {
        throw new Error('must not be called');
      }),
      elementByRefno: vi.fn(() => {
        throw new Error('must not be called');
      }),
    };
    const resolver = new ReferenceFrameResolver(dataPort);

    const frame = valueOf(await resolver.resolve('World'));

    expect(frame).toMatchObject({
      kind: 'world',
      refno: null,
      origin: [0, 0, 0],
      basis: IDENTITY_BASIS,
      axisLabels: ['X', 'Y', 'Z'],
      provenance: {
        resolution: 'world',
        basis: { action: 'identity' },
      },
    });
    expect(dataPort.currentElementRefno).not.toHaveBeenCalled();
    expect(dataPort.elementByRefno).not.toHaveBeenCalled();
    expect(valueOf(designPointToFrame(frame, [4, -2, 9]))).toEqual([4, -2, 9]);
    expect(valueOf(frameVectorToDesign(frame, [0.5, 1, -3]))).toEqual([0.5, 1, -3]);
  });

  it('round-trips points and vectors through a rotated, translated element frame', async () => {
    const rotated = element('24381_100', {
      origin: [10, 20, 30],
      basis: {
        u: [0, 1, 0],
        v: [-1, 0, 0],
        w: [0, 0, 1],
      },
    });
    const frame = valueOf(await new ReferenceFrameResolver(port([rotated]))
      .resolve('DBREF 24381/100'));

    const localPoint = valueOf(designPointToFrame(frame, [8, 23, 34]));
    expectVectorClose(localPoint, [3, 2, 4]);
    expectVectorClose(valueOf(framePointToDesign(frame, localPoint)), [8, 23, 34]);

    const localVector = valueOf(designVectorToFrame(frame, [-2, 3, 4]));
    expectVectorClose(localVector, [3, 2, 4]);
    expectVectorClose(valueOf(frameVectorToDesign(frame, localVector)), [-2, 3, 4]);
  });

  it('resolves CE, Owner and an explicit DBREF through canonical refnos', async () => {
    const owner = element('24381_10', {
      origin: [1, 2, 3],
      ownerRefno: '24381_1',
    });
    const current = element('24381_100', {
      ownerRefno: '24381/10',
      origin: [4, 5, 6],
    });
    const dataPort = port([owner, current], 'pe:<24381/100>');
    const resolver = new ReferenceFrameResolver(dataPort);

    const ce = valueOf(await resolver.resolve('CE'));
    expect(ce.refno).toBe('24381_100');
    expect(ce.provenance).toMatchObject({
      resolution: 'current-element',
      currentElementRefno: '24381_100',
    });

    const ownerFrame = valueOf(await resolver.resolve('Owner'));
    expect(ownerFrame.refno).toBe('24381_10');
    expect(ownerFrame.provenance).toMatchObject({
      resolution: 'owner',
      currentElementRefno: '24381_100',
      resolvedRefno: '24381_10',
    });

    const explicit = valueOf(await resolver.resolve('pe:<24381/10>'));
    expect(explicit.refno).toBe('24381_10');
    expect(explicit.provenance.resolution).toBe('explicit-refno');
  });

  it('orthonormalizes right-handed drift and records the correction provenance', async () => {
    const drifted = element('1_2', {
      basis: {
        u: [2, 0, 0],
        v: [0.2, 3, 0],
        w: [0, 0.1, 4],
      },
    });
    const frame = valueOf(await new ReferenceFrameResolver(port([drifted]))
      .resolve('1/2'));

    expectVectorClose(frame.basis.u, [1, 0, 0]);
    expectVectorClose(frame.basis.v, [0, 1, 0]);
    expectVectorClose(frame.basis.w, [0, 0, 1]);
    expect(frame.provenance.basis).toMatchObject({
      policy: 'orthonormalize',
      action: 'orthonormalized',
    });
    expect(frame.provenance.basis.maxOrthogonalityError).toBeGreaterThan(0);
  });

  it('can reject the same non-orthogonal source under the strict policy', async () => {
    const drifted = element('1_2', {
      basis: {
        u: [1, 0, 0],
        v: [0.2, 1, 0],
        w: [0, 0, 1],
      },
    });
    const result = await new ReferenceFrameResolver(port([drifted]), {
      basisPolicy: 'reject',
    }).resolve('1/2');

    expect(errorCodeOf(result)).toBe('NON_ORTHOGONAL_FRAME_BASIS');
  });

  it.each([
    [
      element('1_2', { origin: [0, Number.NaN, 0] }),
      'NON_FINITE_FRAME_DATA',
    ],
    [
      element('1_2', {
        basis: { u: [1, 0, 0], v: [2, 0, 0], w: [0, 0, 1] },
      }),
      'SINGULAR_FRAME_BASIS',
    ],
    [
      element('1_2', {
        basis: { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, -1] },
      }),
      'LEFT_HANDED_FRAME_BASIS',
    ],
  ] as const)('returns a stable typed error for malformed frame data', async (item, code) => {
    const result = await new ReferenceFrameResolver(port([item])).resolve('1/2');
    expect(errorCodeOf(result)).toBe(code);
  });

  it('reports missing CE, missing Owner, missing refno and source failure explicitly', async () => {
    expect(errorCodeOf(await new ReferenceFrameResolver(port()).resolve('CE')))
      .toBe('CURRENT_ELEMENT_UNSET');

    const ownerless = element('1_2');
    expect(errorCodeOf(await new ReferenceFrameResolver(port([ownerless], '1_2'))
      .resolve('Owner'))).toBe('OWNER_UNAVAILABLE');

    expect(errorCodeOf(await new ReferenceFrameResolver(port()).resolve('9/9')))
      .toBe('REFERENCE_ELEMENT_NOT_FOUND');

    const failingPort: ReferenceFrameDataPort = {
      currentElementRefno: () => '1_2',
      elementByRefno: async () => {
        throw new Error('offline');
      },
    };
    expect(errorCodeOf(await new ReferenceFrameResolver(failingPort).resolve('CE')))
      .toBe('FRAME_DATA_UNAVAILABLE');
  });

  it('returns typed errors for invalid and non-finite transform operands', async () => {
    const frame: ResolvedReferenceFrame = valueOf(
      await new ReferenceFrameResolver(port()).resolve('World'),
    );

    expect(errorCodeOf(designPointToFrame(frame, [1, 2])))
      .toBe('INVALID_TRANSFORM_INPUT');
    expect(errorCodeOf(framePointToDesign(frame, [1, Number.POSITIVE_INFINITY, 3])))
      .toBe('NON_FINITE_TRANSFORM_INPUT');
  });
});
