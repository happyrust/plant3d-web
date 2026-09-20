import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPdmsTransformReferenceFramePort } from './pdmsTransformReferenceFramePort';
import { ReferenceFrameResolver } from './referenceFrameResolver';

import { GenModelV1ApiError } from '@/api/genModelV1Api';

/**
 * The port's **default** lookups: world placement from gen-model-v1 `element/ptset` (`world_transform`,
 * column-major mm), owner + noun from the tree node (one shared request per refno).
 * (The `legacy` `:3100 /api/pdms/transform` branch was retired on 2026-09-20.)
 */
const state = vi.hoisted(() => ({
  ptset: vi.fn<(req: { refno: string }) => Promise<unknown>>(),
  node: vi.fn<(refno: string) => Promise<unknown>>(),
}));

vi.mock('@/model-source', () => ({
  getModelSource: () => ({ tree: { node: state.node } }),
}));
vi.mock('@/api/genModelV1Api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/genModelV1Api')>();
  return { ...actual, genModelV1ElementPtset: state.ptset };
});

/** EQUI 24381/109581 on gen-model `:8024`: ORI 0,0,-25 composed with its ZONE → 25° about Z, mm translation. */
const EQUI_WORLD_TRANSFORM = [
  0.90630778703665, -0.422618261740699, 0, 0,
  0.422618261740699, 0.90630778703665, 0, 0,
  0, 0, 1, 0,
  6241.68, -4737.41, 5347.89, 1,
];

function ptsetResponse(refno: string, worldTransform: number[] = EQUI_WORLD_TRANSFORM) {
  return {
    source: 'e3d-model',
    refno,
    dbnum: 7997,
    noun: 'EQUI',
    name: null,
    catalogue: null,
    world_transform: worldTransform,
    unit: 'mm',
    points: [],
    unresolved: [],
  };
}

function nodeResponse(refno: string, noun: string, owner: string | null) {
  return { success: true, node: { refno, name: noun, noun, owner } };
}

describe('reference-frame port · default lookups follow the model source', () => {
  beforeEach(() => {
    state.ptset.mockReset();
    state.node.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('gen-model-v1: element/ptset world_transform + tree-node owner / noun, one node request per frame', async () => {
    state.ptset.mockImplementation(async ({ refno }) => ptsetResponse(refno.replace('_', '/')));
    state.node.mockImplementation(async (refno) => nodeResponse(refno, 'EQUI', '24381_109499'));
    const port = createPdmsTransformReferenceFramePort({ currentElementRefno: () => null });

    const frame = await new ReferenceFrameResolver(port).resolve('=24381/109581');
    expect(frame.ok).toBe(true);
    if (!frame.ok) throw new Error(frame.error.message);
    expect(frame.value.kind).toBe('element');
    expect(frame.value.refno).toBe('24381_109581');
    expect(frame.value.noun).toBe('EQUI');
    expect(frame.value.origin.map(v => Number(v.toFixed(6)))).toEqual([6.24168, -4.73741, 5.34789]);
    expect(frame.value.basis.u[0]).toBeCloseTo(0.90630778703665, 12);
    expect(frame.value.basis.u[1]).toBeCloseTo(-0.422618261740699, 12);
    expect(frame.value.basis.v[0]).toBeCloseTo(0.422618261740699, 12);
    [0, 0, 1].forEach((value, index) => expect(frame.value.basis.w[index]).toBeCloseTo(value, 12));
    expect(frame.value.provenance.resolvedOwnerRefno).toBe('24381_109499');
    expect(frame.value.provenance.element?.source).toBe('gen-model-v1-element-ptset');
    expect(frame.value.provenance.element?.sourceCoordinateUnit).toBe('mm');

    expect(state.ptset).toHaveBeenCalledTimes(1);
    expect(state.ptset).toHaveBeenCalledWith({ refno: '24381_109581' });
    // The transform lookup (owner) and the type lookup (noun) share one tree-node request.
    expect(state.node).toHaveBeenCalledTimes(1);
    expect(state.node).toHaveBeenCalledWith('24381_109581');
  });

  it('gen-model-v1: Owner mode walks CE → tree-node owner → that element\'s ptset placement', async () => {
    state.ptset.mockImplementation(async ({ refno }) => ptsetResponse(
      refno.replace('_', '/'),
      refno === '24381_109499' ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, 200, 300, 1] : EQUI_WORLD_TRANSFORM,
    ));
    state.node.mockImplementation(async (refno) => (
      refno === '24381_109581'
        ? nodeResponse(refno, 'EQUI', '24381_109499')
        : nodeResponse(refno, 'ZONE', '24381_101405')
    ));
    const port = createPdmsTransformReferenceFramePort({ currentElementRefno: () => '24381_109581' });

    const owner = await new ReferenceFrameResolver(port).resolve('Owner');
    expect(owner.ok).toBe(true);
    if (!owner.ok) throw new Error(owner.error.message);
    expect(owner.value.refno).toBe('24381_109499');
    expect(owner.value.noun).toBe('ZONE');
    expect(owner.value.origin).toEqual([0.1, 0.2, 0.3]);
    expect(owner.value.provenance.currentElementRefno).toBe('24381_109581');
    expect(state.ptset.mock.calls.map(([req]) => req.refno)).toEqual(['24381_109581', '24381_109499']);
  });

  it('gen-model-v1: a 404 from element/ptset is "not found"; other failures are "unavailable"', async () => {
    state.node.mockImplementation(async (refno) => nodeResponse(refno, 'EQUI', null));
    state.ptset.mockRejectedValueOnce(new GenModelV1ApiError({
      code: 'not_found',
      status: 404,
      path: '/api/v1/element/ptset',
      message: 'no such element',
    }));
    const port = createPdmsTransformReferenceFramePort({ currentElementRefno: () => null });
    const missing = await port.elementByRefno('24381_999999999');
    expect(missing).toMatchObject({ ok: false, reason: 'not-found' });
    const resolved = await new ReferenceFrameResolver(port).resolve('=24381/999999999');
    expect(resolved.ok).toBe(false);

    state.ptset.mockRejectedValueOnce(new Error('gen-model offline'));
    const offline = await port.elementByRefno('24381_109581');
    expect(offline).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('gen-model-v1: a missing tree node only costs the owner / noun, not the frame', async () => {
    state.ptset.mockImplementation(async ({ refno }) => ptsetResponse(refno.replace('_', '/')));
    state.node.mockResolvedValue({ success: false, node: null, error_message: 'tree offline' });
    const port = createPdmsTransformReferenceFramePort({ currentElementRefno: () => null });
    const frame = await new ReferenceFrameResolver(port).resolve('=24381/109581');
    expect(frame.ok).toBe(true);
    if (!frame.ok) throw new Error(frame.error.message);
    expect(frame.value.noun).toBeNull();
    expect(frame.value.provenance.resolvedOwnerRefno).toBeNull();
  });

});
