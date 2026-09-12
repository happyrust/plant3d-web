import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyGenModelV1Health,
  dbnumModelCapabilityFromHealth,
  ensureGenModelV1Freshness,
  noteGenModelV1RequestFailure,
  shortGenModelV1Host,
  summarizeVerdicts,
  useGenModelV1Health,
  verdictSummaryText,
} from './useGenModelV1Health';

import { GenModelV1ApiError, type DbnumRow, type GeomInstQuery, type HealthResponse } from '@/api/genModelV1Api';
import { createGenModelV1ModelRecordSource } from '@/model-source/genModelV1/modelRecordSource';
import {
  createGenModelV1GenerationGuard,
  getGenModelV1ServiceSnapshot,
  observeGenModelV1Health,
  subscribeGenModelV1GenerationChange,
} from '@/model-source/genModelV1/serviceLifecycle';
import { getGenModelV1BaseUrl } from '@/utils/apiBase';

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

  it('数据源 owner 存在时，徽标 stop 不会停掉服务代次探针', async () => {
    vi.useFakeTimers();
    const health = useGenModelV1Health();
    health.__reset();
    healthMock.mockResolvedValue({ status: 'ok', started_at: 'one', initialization: {} });
    dbnumsMock.mockResolvedValue({ dbnums: [] });

    const releaseDataSource = health.activateDataSource();
    health.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(healthMock).toHaveBeenCalledTimes(1);
    health.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(healthMock).toHaveBeenCalledTimes(2);
    releaseDataSource();
  });

  it('并发 freshness 检查合并成一发 health', async () => {
    const health = useGenModelV1Health();
    health.__reset();
    let resolve!: (value: { status: string; started_at: string }) => void;
    healthMock.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = ensureGenModelV1Freshness({ force: true });
    const second = ensureGenModelV1Freshness({ force: true });
    expect(healthMock).toHaveBeenCalledTimes(1);
    resolve({ status: 'ok', started_at: 'instance-a' });
    expect(await first).toEqual(await second);
  });

  it('调用方主动取消不污染 legacy 断线账，真实 network 恢复仍会保守换代', () => {
    const health = useGenModelV1Health();
    health.__reset();
    const baseUrl = getGenModelV1BaseUrl();
    observeGenModelV1Health({ status: 'ok' }, baseUrl);
    const otherRead = createGenModelV1GenerationGuard();

    noteGenModelV1RequestFailure(new GenModelV1ApiError({
      code: 'cancelled',
      status: 0,
      path: '/api/v1/model/records',
      message: 'caller cancelled',
      abortSource: 'caller',
    }));
    expect(observeGenModelV1Health({ status: 'ok' }, baseUrl)).toBeNull();
    expect(getGenModelV1ServiceSnapshot().generation).toBe(0);
    expect(otherRead.signal.aborted).toBe(false);

    noteGenModelV1RequestFailure(new GenModelV1ApiError({
      code: 'network',
      status: 0,
      path: '/api/v1/model/records',
      message: 'connection reset',
    }));
    expect(observeGenModelV1Health({ status: 'ok' }, baseUrl)).toMatchObject({
      generation: 1,
      reason: 'legacy_reconnected',
    });
    expect(otherRead.signal.aborted).toBe(true);
    otherRead.dispose();
  });
});

describe('freshness 与 gen-model 基址（?gm_backend= 切服务）', () => {
  const IDENTITY = { translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };
  function item(refno: string, owner: string): GeomInstQuery {
    return {
      refno, old_refno: null, owner, world_aabb: null, world_trans: IDENTITY,
      insts: [{ geo_hash: 'g', transform: IDENTITY, is_tubi: false, is_invalid_tubi: false }],
      has_neg: false, generic: 'ELBO', pts: null, date: null,
    };
  }
  /** 假 /health：按请求基址回不同的 started_at，谁被探到一眼可见 */
  function healthByBase() {
    healthMock.mockImplementation(async ({ baseUrl }: { baseUrl?: string } = {}) => ({
      status: 'ok', started_at: baseUrl === '/gm-b' ? 'b' : 'a',
    }));
  }

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    useGenModelV1Health().__reset();
    healthMock.mockReset();
  });

  it('10 秒窗口内切换 ?gm_backend=：不认旧基址的观察，重新探当前基址并按 base_url_changed 换代', async () => {
    const health = useGenModelV1Health();
    health.__reset();
    healthByBase();
    window.history.replaceState({}, '', '?gm_backend=/gm-a');

    expect(await ensureGenModelV1Freshness()).toMatchObject({ baseUrl: '/gm-a', startedAt: 'a', generation: 0 });
    expect(healthMock).toHaveBeenCalledTimes(1);
    expect(healthMock).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: '/gm-a' }));
    // 同基址、窗口内：不再探
    await ensureGenModelV1Freshness();
    expect(healthMock).toHaveBeenCalledTimes(1);

    window.history.replaceState({}, '', '?gm_backend=/gm-b');
    const listener = vi.fn();
    const unsubscribe = subscribeGenModelV1GenerationChange(listener);
    expect(await ensureGenModelV1Freshness()).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b', generation: 1 });
    expect(healthMock).toHaveBeenCalledTimes(2);
    expect(healthMock).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: '/gm-b' }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ reason: 'base_url_changed' }));
    expect(health.state).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b' });
    unsubscribe();
  });

  it('A 的 health 还在飞就切到 B：B 不复用 A 的在飞 Promise；A 迟到的响应不写成当前观察，等 A 的人也拿到 B 的代次', async () => {
    const health = useGenModelV1Health();
    health.__reset();
    let resolveA!: (value: HealthResponse) => void;
    healthMock.mockImplementation(({ baseUrl }: { baseUrl?: string } = {}) => (baseUrl === '/gm-a'
      ? new Promise<HealthResponse>((resolve) => { resolveA = resolve; })
      : Promise.resolve({ status: 'ok', started_at: 'b' })));
    window.history.replaceState({}, '', '?gm_backend=/gm-a');

    const waitingOnA = ensureGenModelV1Freshness();
    expect(healthMock).toHaveBeenCalledTimes(1);
    window.history.replaceState({}, '', '?gm_backend=/gm-b');
    expect(await ensureGenModelV1Freshness()).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b' });
    expect(healthMock).toHaveBeenCalledTimes(2);
    expect(healthMock).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: '/gm-b' }));

    resolveA({ status: 'ok', started_at: 'a' });
    expect(await waitingOnA).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b' });
    expect(health.state).toMatchObject({ status: 'ok', baseUrl: '/gm-b', startedAt: 'b' });
    expect(getGenModelV1ServiceSnapshot()).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b' });
    // B 的观察还新鲜：A 迟到那一发不再多探
    expect(healthMock).toHaveBeenCalledTimes(2);
  });

  it('A→B→A 快速来回切：A 的旧响应迟到时不覆盖 A 的新观察、不伪造 started_at_changed，等它的人拿到最新快照', async () => {
    const health = useGenModelV1Health();
    health.__reset();
    const requested: string[] = [];
    let resolveOldA!: (value: HealthResponse) => void;
    let aCalls = 0;
    healthMock.mockImplementation(({ baseUrl }: { baseUrl?: string } = {}) => {
      requested.push(baseUrl ?? '?');
      if (baseUrl === '/gm-a') {
        aCalls += 1;
        if (aCalls === 1) return new Promise<HealthResponse>((resolve) => { resolveOldA = resolve; });
        return Promise.resolve({ status: 'ok', started_at: 'a2' });
      }
      return Promise.resolve({ status: 'ok', started_at: 'b' });
    });
    window.history.replaceState({}, '', '?gm_backend=/gm-a');
    const waitingOnOldA = ensureGenModelV1Freshness();
    window.history.replaceState({}, '', '?gm_backend=/gm-b');
    expect(await ensureGenModelV1Freshness()).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b', generation: 0 });
    window.history.replaceState({}, '', '?gm_backend=/gm-a');
    expect(await ensureGenModelV1Freshness()).toMatchObject({ baseUrl: '/gm-a', startedAt: 'a2', generation: 1 });
    expect(requested).toEqual(['/gm-a', '/gm-b', '/gm-a']);

    const changes: string[] = [];
    const unsubscribe = subscribeGenModelV1GenerationChange((event) => changes.push(event.reason));
    resolveOldA({ status: 'ok', started_at: 'a' });
    expect(await waitingOnOldA).toMatchObject({ baseUrl: '/gm-a', startedAt: 'a2', generation: 1 });
    expect(changes).toEqual([]);
    expect(health.state).toMatchObject({ status: 'ok', baseUrl: '/gm-a', startedAt: 'a2' });
    expect(getGenModelV1ServiceSnapshot()).toMatchObject({ baseUrl: '/gm-a', startedAt: 'a2', generation: 1 });
    expect(healthMock).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('普通网络失败原样到达调用方并记进断线账，不会被分型成取消', async () => {
    const health = useGenModelV1Health();
    health.__reset();
    window.history.replaceState({}, '', '?gm_backend=/gm-a');
    const boom = new GenModelV1ApiError({ code: 'network', status: 0, path: '/api/v1/health', message: 'ECONNREFUSED' });
    healthMock.mockRejectedValueOnce(boom);
    await expect(ensureGenModelV1Freshness()).rejects.toBe(boom);
    expect(health.state).toMatchObject({ status: 'error', baseUrl: '/gm-a', error: expect.stringContaining('network') });
    expect(getGenModelV1ServiceSnapshot()).toMatchObject({ hasSuccessfulObservation: false, failureSinceSuccess: true });
    // 同基址恢复：legacy（无 started_at）第一次成功观察不换代，之后断线再恢复才保守换代
    healthMock.mockResolvedValue({ status: 'ok' });
    expect(await ensureGenModelV1Freshness()).toMatchObject({ baseUrl: '/gm-a', generation: 0 });
    healthMock.mockRejectedValueOnce(boom);
    await expect(ensureGenModelV1Freshness({ force: true })).rejects.toBe(boom);
    expect(await ensureGenModelV1Freshness({ force: true })).toMatchObject({ baseUrl: '/gm-a', generation: 1 });
  });

  it('跨层：窗口内切换基址后，记录源对同一节点不再命中旧服务的备忘结果，重新 ensure 且换代', async () => {
    const health = useGenModelV1Health();
    health.__reset();
    healthByBase();
    const ensure = vi.fn(async () => ({ status: 'AlreadyAvailable', generation_root: '1/1' }));
    const records = vi.fn(async () => ({ source: 'model-memory', items: [item('1_10', '1_1')], total: 1, truncated: false, next_cursor: null }));
    const source = createGenModelV1ModelRecordSource({
      api: { ensure: ensure as never, records: records as never, children: vi.fn() as never },
      ensureFreshness: () => ensureGenModelV1Freshness(),
      noteRequestFailure: noteGenModelV1RequestFailure,
    });
    // 与 createGenModelV1ModelSource().activate() 同一根线：换代 → 清记录缓存
    const unsubscribe = subscribeGenModelV1GenerationChange(() => source.invalidate());
    window.history.replaceState({}, '', '?gm_backend=/gm-a');
    try {
      const viaA = await source.ensureAndCollect('1_1');
      expect(await source.ensureAndCollect('1_1')).toBe(viaA);
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(source.peek('1_10')).toHaveLength(1);

      window.history.replaceState({}, '', '?gm_backend=/gm-b');
      const viaB = await source.ensureAndCollect('1_1');
      expect(viaB).not.toBe(viaA);
      expect(ensure).toHaveBeenCalledTimes(2);
      expect(getGenModelV1ServiceSnapshot()).toMatchObject({ baseUrl: '/gm-b', startedAt: 'b', generation: 1 });
    } finally {
      unsubscribe();
    }
  });
});

describe('applyGenModelV1Health / shortGenModelV1Host', () => {
  it('把 /health 摊平进 state；base URL 压成 :8022 / /gm', () => {
    const health = useGenModelV1Health();
    health.__reset();
    const target = { ...health.state } as Parameters<typeof applyGenModelV1Health>[0];
    applyGenModelV1Health(target, {
      status: 'ok', project: 'AvevaMarineSample', mdb: '/ALL', namespace: 'ns', version: '0.1.18',
      started_at: '2026-09-11T01:02:03Z', data_face: 'ingest',
      sul_db: { medium: 'spawned-mem', durable: false },
      capabilities: { dbnum_model_ensure: true, dbnum_model_ready_roots: true },
      delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
      initialization: { status: 'model_ready', data_ready: true, model_ready: true, model_phase_open: true },
      static_assets: true,
    }, 'http://localhost:8022', 5);
    expect(target).toMatchObject({
      status: 'ok', project: 'AvevaMarineSample', mdb: '/ALL', namespace: 'ns', version: '0.1.18', dataFace: 'ingest',
      startedAt: '2026-09-11T01:02:03Z', sulDbMedium: 'spawned-mem', sulDbDurable: false,
      capabilities: { dbnum_model_ensure: true, dbnum_model_ready_roots: true },
      deliveryUnitTypes: ['BRAN', 'HANG', 'SUPPO', 'EQUI'], initializationStatus: 'model_ready',
      dataReady: true, modelReady: true, modelPhaseOpen: true, staticAssets: true, lastCheckedAt: 5, lastOkAt: 5, error: null,
    });
    expect(shortGenModelV1Host('http://localhost:8022')).toBe(':8022');
    expect(shortGenModelV1Host('http://10.0.0.5:8022')).toBe('10.0.0.5:8022');
    expect(shortGenModelV1Host('/gm')).toBe('/gm');
  });

  it('整库能力是 true / false / 缺失三态', () => {
    expect(dbnumModelCapabilityFromHealth(null)).toBe('unknown');
    expect(dbnumModelCapabilityFromHealth({ status: 'ok' })).toBe('unknown');
    expect(dbnumModelCapabilityFromHealth({
      status: 'ok',
      capabilities: { dbnum_model_ensure: true, dbnum_model_ready_roots: true },
    })).toBe('supported');
    expect(dbnumModelCapabilityFromHealth({
      status: 'ok',
      capabilities: { dbnum_model_ensure: true, dbnum_model_ready_roots: false },
    })).toBe('unsupported');
    expect(dbnumModelCapabilityFromHealth({
      status: 'ok',
      capabilities: { dbnum_model_ensure: true },
    })).toBe('unknown');
  });
});
