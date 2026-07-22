import { describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';

import { createMbdExternalSync } from './useMbdExternalSync';

import type {
  MbdDiagnosticsSnapshot,
  MbdDiagnosticsStore,
} from './useMbdDiagnosticsStore';
import type { MbdExternalSyncDeps } from './useMbdExternalSync';
import type { MbdDimensionDto, MbdV2PipeData } from '@/dimension';

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function contractPayload(
  overrides: Partial<MbdV2PipeData> = {},
): MbdV2PipeData {
  return {
    version: 'v2',
    input_refno: 'fixture',
    branch_refno: 'fixture',
    primitives: [{
      kind: 'linear_dim',
      id: 'dim-1',
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
    }],
    meta: {
      geometry_space: 'source_mm',
      source_to_design: IDENTITY,
      notes: [],
    },
    issues: [],
    ...overrides,
  };
}

function parquetDto(): MbdDimensionDto {
  return {
    id: 'parquet-1',
    formattedLabel: '500',
    dimensionLine: { from: [0, 0, 0], to: [0.5, 0, 0] },
    labelAnchor: [0.25, 0.1, 0],
    sourceToDesign: IDENTITY,
  };
}

function createDiagnostics(): MbdDiagnosticsStore {
  return {
    snapshot: shallowRef<MbdDiagnosticsSnapshot>({
      loadedAt: null,
      channel: null,
      sourceId: null,
      issues: [],
      skipped: [],
      loadError: null,
    }),
    set: vi.fn(),
    clear: vi.fn(),
  };
}

function createHarness(input: {
  search: string;
  fetchPipeData?: MbdExternalSyncDeps['fetchPipeData'];
  queryParquetDimensions?: MbdExternalSyncDeps['queryParquetDimensions'];
}) {
  const diagnostics = createDiagnostics();
  const emitToast = vi.fn();
  const fetchPipeData = input.fetchPipeData
    ?? vi.fn(async () => ({
      ok: true as const,
      data: contractPayload(),
      diagnostics: [],
    }));
  const queryParquetDimensions = input.queryParquetDimensions
    ?? vi.fn(async () => ({ dimensions: [parquetDto()], skipped: [] }));
  const sync = createMbdExternalSync({
    fetchPipeData,
    queryParquetDimensions,
    diagnostics,
    getSearch: () => input.search,
    emitToast,
  });
  const target = { replaceExternalSource: vi.fn() };
  return {
    sync,
    target,
    diagnostics,
    emitToast,
    fetchPipeData,
    queryParquetDimensions,
  };
}

describe('createMbdExternalSync', () => {
  it('prefers the API channel when mbd_refno is present', async () => {
    const harness = createHarness({ search: '?mbd_refno=24381_145712&show_dbnum=250160' });

    await harness.sync.sync(harness.target);

    expect(harness.queryParquetDimensions).not.toHaveBeenCalled();
    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [source, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(source).toBe('mbd');
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-1']);
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'api',
      sourceId: '24381_145712',
    }));
  });

  it('falls back to the parquet channel by show_dbnum', async () => {
    const harness = createHarness({ search: '?show_dbnum=250160' });

    await harness.sync.sync(harness.target, { forceRefresh: true });

    expect(harness.queryParquetDimensions).toHaveBeenCalledWith(
      250160,
      { forceRefresh: true },
    );
    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['parquet-1']);
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'parquet',
      sourceId: '250160',
    }));
  });

  it('clears the source and diagnostics when no channel params exist', async () => {
    const harness = createHarness({ search: '' });

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    expect(harness.diagnostics.clear).toHaveBeenCalledTimes(1);
    expect(harness.diagnostics.set).not.toHaveBeenCalled();
  });

  it('discards stale results when a newer sync has started', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>) => void;
    let resolveSecond!: (value: Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>) => void;
    const responses = [
      new Promise<Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>>((resolve) => {
        resolveFirst = resolve;
      }),
      new Promise<Awaited<ReturnType<MbdExternalSyncDeps['fetchPipeData']>>>((resolve) => {
        resolveSecond = resolve;
      }),
    ];
    let call = 0;
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(() => responses[call++]!),
    });

    const first = harness.sync.sync(harness.target);
    const second = harness.sync.sync(harness.target);
    resolveSecond({
      ok: true,
      data: contractPayload({
        primitives: [{
          kind: 'linear_dim',
          id: 'dim-latest',
          start: [0, 0, 0],
          end: [2, 0, 0],
          text: '2000',
          extension_lines: [
            { from: [0, 0, 0], to: [0, 0.1, 0] },
            { from: [2, 0, 0], to: [2, 0.1, 0] },
          ],
          arrow_lines: [
            { from: [0, 0, 0], to: [0.1, 0.05, 0] },
            { from: [2, 0, 0], to: [1.9, 0.05, 0] },
          ],
          label_anchor: [1, 0.1, 0],
        }],
      }),
      diagnostics: [],
    });
    await second;
    resolveFirst({ ok: true, data: contractPayload(), diagnostics: [] });
    await first;

    expect(harness.target.replaceExternalSource).toHaveBeenCalledTimes(1);
    const [, records] = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['dim-latest']);
  });

  it('records channel failures in diagnostics instead of clearing them', async () => {
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => {
        throw new Error('MBD V2 API responded with status 404');
      }),
    });

    await harness.sync.sync(harness.target);

    expect(harness.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    expect(harness.diagnostics.clear).not.toHaveBeenCalled();
    expect(harness.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'api',
      sourceId: 'A',
      loadError: 'MBD V2 API responded with status 404',
    }));
  });

  it('drops results after invalidate() and honours host cancellation', async () => {
    const harness = createHarness({ search: '?mbd_refno=A' });

    const pending = harness.sync.sync(harness.target);
    harness.sync.invalidate();
    await pending;
    expect(harness.target.replaceExternalSource).not.toHaveBeenCalled();

    await harness.sync.sync(harness.target, { isCancelled: () => true });
    expect(harness.target.replaceExternalSource).not.toHaveBeenCalled();
  });

  it('rejects an API payload atomically when any primitive fails to map', async () => {
    const goodPayload = contractPayload();
    const duplicated = contractPayload({
      primitives: [goodPayload.primitives[0]!, goodPayload.primitives[0]!],
      issues: [{
        id: 'issue-1',
        severity: 'warning' as const,
        category: 'split' as const,
        message: 'upstream warning kept for diagnostics',
      }],
    });
    const responses = [
      { ok: true as const, data: goodPayload, diagnostics: [] },
      { ok: true as const, data: duplicated, diagnostics: [] },
    ];
    let call = 0;
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => responses[call++]!),
    });

    await harness.sync.sync(harness.target);
    await harness.sync.sync(harness.target);

    const replaceCalls = (harness.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls;
    expect(replaceCalls).toHaveLength(2);
    expect(replaceCalls[0]![1].map((record: { id: string }) => record.id))
      .toEqual(['dim-1']);
    expect(replaceCalls[1]!).toEqual(['mbd', []]);

    const lastDiagnostics = (harness.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(lastDiagnostics.loadError).toContain('整包拒绝');
    expect(lastDiagnostics.loadError).toContain('dim-1');
    expect(lastDiagnostics.skipped).toEqual([{
      id: 'dim-1',
      reason: 'Duplicate primitive id within MBD payload',
    }]);
    expect(lastDiagnostics.issues).toEqual(duplicated.issues);
  });

  it('tolerates parquet row-level skips but rejects mapping failures atomically', async () => {
    const tolerated = createHarness({
      search: '?show_dbnum=1',
      queryParquetDimensions: vi.fn(async () => ({
        dimensions: [parquetDto()],
        skipped: [{ id: 'row-bad', reason: 'invalid parquet row' }],
      })),
    });
    await tolerated.sync.sync(tolerated.target);
    const [, records] = (tolerated.target.replaceExternalSource as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
    expect(records.map((record: { id: string }) => record.id)).toEqual(['parquet-1']);
    expect(tolerated.diagnostics.set).toHaveBeenCalledWith(expect.objectContaining({
      skipped: [{ id: 'row-bad', reason: 'invalid parquet row' }],
    }));

    const rejected = createHarness({
      search: '?show_dbnum=1',
      queryParquetDimensions: vi.fn(async () => ({
        dimensions: [parquetDto(), parquetDto()],
        skipped: [],
      })),
    });
    await rejected.sync.sync(rejected.target);
    expect(rejected.target.replaceExternalSource).toHaveBeenCalledWith('mbd', []);
    const diagnostics = (rejected.diagnostics.set as ReturnType<typeof vi.fn>)
      .mock.calls.at(-1)![0];
    expect(diagnostics.loadError).toContain('整包拒绝');
    expect(diagnostics.skipped).toEqual([{
      id: 'parquet-1',
      reason: 'Duplicate primitive id within MBD payload',
    }]);
  });

  it('emits one error toast when backend issues contain error severity', async () => {
    const harness = createHarness({
      search: '?mbd_refno=A',
      fetchPipeData: vi.fn(async () => ({
        ok: true as const,
        data: contractPayload({
          issues: [
            {
              id: 'issue-1',
              severity: 'error' as const,
              category: 'data' as const,
              message: 'missing tubi geometry',
            },
            {
              id: 'issue-2',
              severity: 'warning' as const,
              category: 'avoidance' as const,
              message: 'lane overflow',
            },
          ],
        }),
        diagnostics: [],
      })),
    });

    await harness.sync.sync(harness.target);

    expect(harness.emitToast).toHaveBeenCalledTimes(1);
    expect(harness.emitToast).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
    }));
  });
});
