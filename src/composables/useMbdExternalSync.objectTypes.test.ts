import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMbdDiagnosticsStore } from './useMbdDiagnosticsStore';
import { createMbdExternalSync } from './useMbdExternalSync';

import type { MbdExternalSyncDeps } from './useMbdExternalSync';
import type { ExternalDimensionRecord, MbdV2PipeData } from '@/dimension';

/**
 * #103 M7：`mbd_refno` 可以是任意可标注对象。同步层把包的标注类型 / 归属对象带进逐源诊断，
 * 多包同屏时尺寸链 `chainId` 与 id 一样补 `refno:` 前缀。
 */

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function linearDim(id: string, chainId?: string): MbdV2PipeData['primitives'][number] {
  return {
    kind: 'linear_dim',
    id,
    start: [0, 0, 0],
    end: [1, 0, 0],
    text: '1000',
    extension_lines: [
      { from: [0, 0, 0], to: [0, 0.1, 0] },
      { from: [1, 0, 0], to: [1, 0.1, 0] },
    ],
    arrow_lines: [
      { from: [0, 0, 0], to: [0.1, 0.05, 0] },
      { from: [1, 0, 0], to: [0.9, 0.05, 0] },
    ],
    label_anchor: [0.5, 0.1, 0],
    ...(chainId !== undefined ? { chain_id: chainId, chain_seq: 0 } : {}),
  };
}

function payload(overrides: Partial<MbdV2PipeData> = {}): MbdV2PipeData {
  return {
    version: 'v2',
    input_refno: 'fixture',
    branch_refno: 'fixture',
    primitives: [linearDim('dim-1')],
    meta: { geometry_space: 'source_mm', source_to_design: IDENTITY, notes: [] },
    issues: [],
    ...overrides,
  };
}

function createHarness(search: string, fetchPipeData: MbdExternalSyncDeps['fetchPipeData']) {
  const diagnostics = useMbdDiagnosticsStore();
  const sync = createMbdExternalSync({
    fetchPipeData,
    diagnostics,
    getSearch: () => search,
    emitToast: vi.fn(),
  });
  const target = { replaceExternalSource: vi.fn() };
  const committed = (): readonly ExternalDimensionRecord[] =>
    (target.replaceExternalSource as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
  return { sync, target, diagnostics, committed };
}

afterEach(() => {
  useMbdDiagnosticsStore().clear();
});

describe('createMbdExternalSync with object packages', () => {
  it('carries annotation_type and subject onto the per-source diagnostics', async () => {
    const equi = '24381_200001';
    const harness = createHarness(`?mbd_refno=${equi}`, vi.fn(async () => ({
      ok: true as const,
      data: payload({
        annotation_type: 'em4_equi',
        subject: { refno: equi, noun: 'EQUI' },
        input_refno: equi,
        branch_refno: equi,
        primitives: [],
        issues: [{
          id: 'layout.not_implemented',
          severity: 'warning',
          category: 'other',
          message: 'em4_equi 的标注还没有实现',
        }],
      }),
      diagnostics: [],
    })));

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    const snapshot = harness.diagnostics.snapshot.value;
    expect(snapshot.loadError).toBeNull();
    expect(snapshot.sources).toEqual([expect.objectContaining({
      refno: equi,
      annotationType: 'em4_equi',
      subject: { refno: equi, noun: 'EQUI' },
      loadError: null,
    })]);
    expect(snapshot.issues.map(issue => issue.id)).toEqual(['layout.not_implemented']);
  });

  it('reports null for packages from backends that do not declare a type', async () => {
    const harness = createHarness('?mbd_refno=24381_145018', vi.fn(async () => ({
      ok: true as const,
      data: payload(),
      diagnostics: [],
    })));

    await harness.sync.sync(harness.target);

    expect(harness.diagnostics.snapshot.value.sources).toEqual([expect.objectContaining({
      refno: '24381_145018',
      annotationType: null,
      subject: null,
    })]);
  });

  it('leaves the type off a package that failed to load', async () => {
    const harness = createHarness('?mbd_refno=24381_1', vi.fn(async () => ({
      ok: false as const,
      error: 'refno 24381/1（ATTA）不是可出 MBD 标注的对象',
    })));

    await harness.sync.sync(harness.target);

    const [source] = harness.diagnostics.snapshot.value.sources;
    expect(source?.loadError).toBe('refno 24381/1（ATTA）不是可出 MBD 标注的对象');
    expect(source?.annotationType).toBeUndefined();
    expect(source?.subject).toBeUndefined();
  });

  it('qualifies chain ids per package when several packages share the view', async () => {
    const fetchPipeData = vi.fn(async (refno: string) => ({
      ok: true as const,
      data: payload({
        input_refno: refno,
        branch_refno: refno,
        primitives: [
          linearDim('seg-0', 'chain:0'),
          linearDim('seg-1', `${refno}:chain:1`),
          linearDim('loose'),
        ],
      }),
      diagnostics: [],
    }));
    const multi = createHarness('?mbd_refno=A,B', fetchPipeData);

    await multi.sync.sync(multi.target);

    const chains = multi.committed().map(record => [record.id, record.chainId]);
    expect(chains).toEqual([
      ['A:seg-0', 'A:chain:0'],
      ['A:seg-1', 'A:chain:1'],
      ['A:loose', undefined],
      ['B:seg-0', 'B:chain:0'],
      ['B:seg-1', 'B:chain:1'],
      ['B:loose', undefined],
    ]);
    expect(multi.committed().find(record => record.id === 'A:loose')).not.toHaveProperty('chainId');

    const single = createHarness('?mbd_refno=A', fetchPipeData);
    await single.sync.sync(single.target);
    expect(single.committed().map(record => [record.id, record.chainId])).toEqual([
      ['seg-0', 'chain:0'],
      ['seg-1', 'A:chain:1'],
      ['loose', undefined],
    ]);
  });
});
