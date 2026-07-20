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
    }],
    meta: { notes: [] },
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
