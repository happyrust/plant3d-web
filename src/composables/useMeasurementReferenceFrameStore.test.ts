import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MEASUREMENT_WORLD_FRAME,
  createMeasurementReferenceFrameSession,
  type MeasurementReferenceFrameResolver,
} from './useMeasurementReferenceFrameStore';

import type {
  ReferenceFrameInput,
  ReferenceFrameResult,
  ResolvedReferenceFrame,
} from '@/measurement/reference-frame';

function elementFrame(
  refno: string,
  resolution: 'current-element' | 'owner' | 'explicit-refno',
): ResolvedReferenceFrame {
  return {
    kind: 'element',
    refno,
    origin: [1, 2, 3],
    basis: {
      u: [0, 1, 0],
      v: [-1, 0, 0],
      w: [0, 0, 1],
    },
    axisLabels: ['U', 'V', 'W'],
    provenance: {
      resolution,
      selector: resolution === 'current-element'
        ? { kind: 'current-element' }
        : resolution === 'owner'
          ? { kind: 'owner' }
          : { kind: 'refno', refno },
      currentElementRefno: resolution === 'explicit-refno' ? null : '1_2',
      resolvedRefno: refno,
      resolvedOwnerRefno: null,
      element: { source: 'test' },
      basis: {
        policy: 'orthonormalize',
        action: 'accepted',
        rawNorms: [1, 1, 1],
        maxOrthogonalityError: 0,
        rawHandedness: 1,
        tolerance: 1e-6,
      },
    },
  };
}

function resolverFrom(
  resolve: (
    input: ReferenceFrameInput,
  ) => Promise<ReferenceFrameResult<ResolvedReferenceFrame>>,
): MeasurementReferenceFrameResolver {
  return { resolve };
}

describe('measurement reference-frame session', () => {
  it('starts with a usable World frame and resolves every supported selector', async () => {
    const resolve = vi.fn(async (input: ReferenceFrameInput) => {
      if (input === 'CE') return { ok: true, value: elementFrame('1_2', 'current-element') } as const;
      if (input === 'Owner') return { ok: true, value: elementFrame('1_1', 'owner') } as const;
      if (input === 'DBREF =2/3') {
        return { ok: true, value: elementFrame('2_3', 'explicit-refno') } as const;
      }
      return { ok: true, value: DEFAULT_MEASUREMENT_WORLD_FRAME } as const;
    });
    const session = createMeasurementReferenceFrameSession(resolverFrom(resolve));

    expect(session.resolvedLabel.value).toBe('World');
    expect(session.axisLabels.value).toEqual(['X', 'Y', 'Z']);

    await session.setMode('current-element');
    expect(resolve).toHaveBeenLastCalledWith('CE');
    expect(session.resolvedLabel.value).toBe('CE 1/2');

    await session.setMode('owner');
    expect(resolve).toHaveBeenLastCalledWith('Owner');
    expect(session.resolvedLabel.value).toBe('Owner 1/1');

    await session.setMode('explicit-refno');
    session.setExplicitRefno('DBREF =2/3');
    await session.resolveCurrent();
    expect(resolve).toHaveBeenLastCalledWith('DBREF =2/3');
    expect(session.resolvedLabel.value).toBe('DBREF 2/3');
  });

  it('keeps the last successfully applied frame when resolution fails', async () => {
    const good = elementFrame('1_2', 'current-element');
    const session = createMeasurementReferenceFrameSession(resolverFrom(async input => (
      input === 'CE'
        ? { ok: true, value: good }
        : {
          ok: false,
          error: { code: 'INVALID_WRT_INPUT', message: 'bad refno' },
        }
    )));

    await session.setMode('current-element');
    await session.setMode('explicit-refno');
    session.setExplicitRefno('bad');
    expect(await session.resolveCurrent()).toBe(false);

    expect(session.resolvedFrame.value).toBe(good);
    expect(session.resolvedLabel.value).toBe('CE 1/2');
    expect(session.resolutionError.value?.code).toBe('INVALID_WRT_INPUT');
  });

  it('ignores a stale asynchronous response after a newer WRT wins', async () => {
    let releaseCe!: (value: ReferenceFrameResult<ResolvedReferenceFrame>) => void;
    const ce = new Promise<ReferenceFrameResult<ResolvedReferenceFrame>>((resolve) => {
      releaseCe = resolve;
    });
    const owner = elementFrame('1_1', 'owner');
    const session = createMeasurementReferenceFrameSession(resolverFrom(input => (
      input === 'CE' ? ce : Promise.resolve({ ok: true, value: owner })
    )));

    const ceRequest = session.setMode('current-element');
    await session.setMode('owner');
    releaseCe({ ok: true, value: elementFrame('1_2', 'current-element') });
    await ceRequest;

    expect(session.resolvedFrame.value).toBe(owner);
    expect(session.resolvedLabel.value).toBe('Owner 1/1');
    expect(session.isResolving.value).toBe(false);
  });
});
