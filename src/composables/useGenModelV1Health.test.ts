import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyGenModelV1Health, shortGenModelV1Host, summarizeVerdicts, useGenModelV1Health, verdictSummaryText } from './useGenModelV1Health';

import type { DbnumRow } from '@/api/genModelV1Api';

const healthMock = vi.hoisted(() => vi.fn());
const dbnumsMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1Health: healthMock,
}));

vi.mock('@/composables/useGenModelV1Dbnums', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useGenModelV1Dbnums')>()),
  getGenModelV1Dbnums: dbnumsMock,
}));

function row(dbnum: number, verdict: string | undefined, extra: Partial<DbnumRow> = {}): DbnumRow {
  return { dbnum, db_type: 'DESI', model_verdict: verdict, ...extra };
}

describe('summarizeVerdicts（/dbnums model_verdict 三态）', () => {
  it('只数本 MDB 内未排除的 DESI；认不出的归 not_judged；滞后库列出来', () => {
    const summary = summarizeVerdicts([
      row(7997, 'in_sync'),
      row(7998, 'lagging'),
      row(7999, 'not_judged'),
      row(8000, undefined),
      row(8001, 'weird'),
      row(1112, 'in_sync', { not_in_project: true }),
      row(1113, 'lagging', { excluded: true }),
      { dbnum: 7000, db_type: 'CATA', model_verdict: 'lagging' },
    ], 123);
    expect(summary).toMatchObject({ inSync: 1, lagging: 1, notJudged: 3, total: 5, laggingDbnums: [7998], lastCheckedAt: 123, error: null });
    expect(summary.byDbnum[8001]).toBe('weird');
    expect(verdictSummaryText(summary)).toBe('库 同步 1 · 滞后 1 · 未判 3');
  });

  it('本 MDB 内一行都不剩时退回全部 DESI 行；没有 DESI 行给空串', () => {
    const summary = summarizeVerdicts([row(1112, 'in_sync', { not_in_project: true }), row(1113, 'not_judged', { not_in_project: true })]);
    expect(summary.total).toBe(2);
    expect(summary.inSync).toBe(1);
    expect(verdictSummaryText(summarizeVerdicts([]))).toBe('');
    expect(verdictSummaryText({ ...summarizeVerdicts([]), error: 'timeout' })).toBe('库状态未取到');
  });
});

describe('start()：/health 每分钟、/dbnums 三态每五分钟；首屏那次不 force（与 useDbMetaInfo 共用一次请求）', () => {
  afterEach(() => {
    useGenModelV1Health().__reset();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('节拍与 force 标志', async () => {
    vi.useFakeTimers();
    const health = useGenModelV1Health();
    health.__reset();
    healthMock.mockResolvedValue({
      status: 'ok', project: 'AvevaMarineSample', mdb: '/ALL',
      initialization: { status: 'model_ready', data_ready: true, model_ready: true, model_phase_open: true },
    });
    dbnumsMock.mockResolvedValue({ dbnums: [row(7997, 'in_sync'), row(7998, 'lagging')] });

    health.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(healthMock).toHaveBeenCalledTimes(1);
    expect(dbnumsMock).toHaveBeenCalledTimes(1);
    expect(dbnumsMock).toHaveBeenLastCalledWith({ timeoutMs: 60_000, force: false });
    expect(health.state.status).toBe('ok');
    expect(health.verdictText.value).toBe('库 同步 1 · 滞后 1 · 未判 0');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthMock).toHaveBeenCalledTimes(2);
    expect(dbnumsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(healthMock).toHaveBeenCalledTimes(5);
    expect(dbnumsMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthMock).toHaveBeenCalledTimes(6);
    expect(dbnumsMock).toHaveBeenCalledTimes(2);
    expect(dbnumsMock).toHaveBeenLastCalledWith({ timeoutMs: 60_000, force: true });

    // 人点「重探」：身份与三态都强制
    await health.refresh();
    expect(healthMock).toHaveBeenCalledTimes(7);
    expect(dbnumsMock).toHaveBeenCalledTimes(3);
    expect(dbnumsMock).toHaveBeenLastCalledWith({ timeoutMs: 60_000, force: true });
    health.stop();
  });

  it('/health 没通就不问 /dbnums；通了之后下一拍立刻补一次三态', async () => {
    vi.useFakeTimers();
    const health = useGenModelV1Health();
    health.__reset();
    healthMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    healthMock.mockResolvedValue({ status: 'ok', project: 'P', mdb: '/ALL', initialization: {} });
    dbnumsMock.mockResolvedValue({ dbnums: [row(7997, 'in_sync')] });

    health.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(health.state.status).toBe('error');
    expect(dbnumsMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(health.state.status).toBe('ok');
    expect(dbnumsMock).toHaveBeenCalledTimes(1);
    health.stop();
  });
});

describe('applyGenModelV1Health / shortGenModelV1Host', () => {
  it('把 /health 摊平进 state；base URL 压成 :8022 / /gm', () => {
    const health = useGenModelV1Health();
    health.__reset();
    const target = { ...health.state } as Parameters<typeof applyGenModelV1Health>[0];
    applyGenModelV1Health(target, {
      status: 'ok', project: 'AvevaMarineSample', mdb: '/ALL', namespace: 'ns', version: '0.1.18', data_face: 'ingest',
      delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
      initialization: { status: 'model_ready', data_ready: true, model_ready: true, model_phase_open: true },
      static_assets: true,
    }, 'http://localhost:8022', 5);
    expect(target).toMatchObject({
      status: 'ok', project: 'AvevaMarineSample', mdb: '/ALL', namespace: 'ns', version: '0.1.18', dataFace: 'ingest',
      deliveryUnitTypes: ['BRAN', 'HANG', 'SUPPO', 'EQUI'], initializationStatus: 'model_ready',
      dataReady: true, modelReady: true, modelPhaseOpen: true, staticAssets: true, lastCheckedAt: 5, lastOkAt: 5, error: null,
    });
    expect(shortGenModelV1Host('http://localhost:8022')).toBe(':8022');
    expect(shortGenModelV1Host('http://10.0.0.5:8022')).toBe('10.0.0.5:8022');
    expect(shortGenModelV1Host('/gm')).toBe('/gm');
  });
});
