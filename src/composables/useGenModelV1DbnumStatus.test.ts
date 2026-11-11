import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DBNUM_STATUS_PENDING_RETRY_DELAYS_MS, useGenModelV1DbnumStatus } from './useGenModelV1DbnumStatus';

import type { DbnumRow } from '@/api/genModelV1Api';

import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';

const rootsMock = vi.hoisted(() => vi.fn());
const refreshVerdictMock = vi.hoisted(() => vi.fn(async () => {}));
const healthState = vi.hoisted(() => ({
  verdict: {
    rows: {} as Record<number, DbnumRow>,
    error: null as string | null,
    lastCheckedAt: null as number | null,
  },
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1DbnumModelRoots: rootsMock,
}));

vi.mock('@/composables/useGenModelV1Health', () => ({
  useGenModelV1Health: () => ({ state: healthState, refreshVerdict: refreshVerdictMock }),
}));

function setRow(dbnum: number, row: Partial<DbnumRow>) {
  healthState.verdict.rows[dbnum] = { dbnum, db_type: 'DESI', ...row };
  healthState.verdict.lastCheckedAt = Date.now();
}

describe('useGenModelV1DbnumStatus：库状态只读 /dbnums 那一行，不做整库根枚举', () => {
  afterEach(() => {
    useGenModelV1DbnumStatus().__reset();
    __resetGenModelV1ServiceLifecycleForTests();
    healthState.verdict.rows = {};
    healthState.verdict.error = null;
    healthState.verdict.lastCheckedAt = null;
    rootsMock.mockReset();
    refreshVerdictMock.mockClear();
    vi.useRealTimers();
  });

  it('verdict in_sync / lagging 直接给 current / stale', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(8000, { model_verdict: 'in_sync', initialized: true });
    setRow(7998, { model_verdict: 'lagging', initialized: true });
    expect(store.view(8000)).toEqual({ kind: 'current', title: 'DB 8000 · 模型已生成且为最新' });
    expect(store.view(7998).kind).toBe('stale');
  });

  it('未初始化的库是 empty，提示写明按需生成；行还没取到是 unknown 并带上取数错误', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(7997, { model_verdict: 'not_judged', initialized: false, applied_sesno: 0, model_sesno: 0 });
    expect(store.view(7997).kind).toBe('empty');
    expect(store.view(7997).title).toContain('库未初始化，模型按需生成');

    healthState.verdict.error = 'timeout: /dbnums';
    expect(store.view(6890).kind).toBe('unknown');
    expect(store.view(6890).title).toContain('timeout: /dbnums');
  });

  it('挂载、在看、过了很久：一次 model/roots 都不发', async () => {
    vi.useFakeTimers();
    const store = useGenModelV1DbnumStatus();
    setRow(7997, { model_verdict: 'not_judged', initialized: false });
    const release = store.acquire(7997);
    store.view(7997);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    release();
    expect(rootsMock).not.toHaveBeenCalled();
    expect(refreshVerdictMock).not.toHaveBeenCalled();
  });

  it('源码钉：库状态仓不引用整库根枚举接口', () => {
    const source = readFileSync(resolve(__dirname, 'useGenModelV1DbnumStatus.ts'), 'utf8');
    const code = source.slice(source.indexOf('import { reactive }'));
    expect(code).not.toMatch(/genModelV1DbnumModelRoots|model\/roots/);
  });

  it('noteGenerated / reconcile 只在提示里补一句本页面的证据，不改未初始化这个结论；已记「刚生成」的不被 records 降级', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(7997, { model_verdict: 'not_judged', initialized: false });

    store.reconcile(7997);
    expect(store.view(7997)).toMatchObject({ kind: 'empty' });
    expect(store.view(7997).title).toContain('本页面已查到模型记录');

    store.noteGenerated(7997);
    expect(store.view(7997).title).toContain('本页面已按需生成过模型');
    store.reconcile(7997);
    expect(store.view(7997).title).toContain('本页面已按需生成过模型');
  });

  it('人点圆点（refresh）与 invalidate 都是重拉 /dbnums；invalidate 另外丢掉本页面的证据', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(7997, { model_verdict: 'not_judged', initialized: false });
    store.noteGenerated(7997);

    store.refresh(7997);
    expect(refreshVerdictMock).toHaveBeenCalledTimes(1);
    expect(store.view(7997).title).toContain('本页面已按需生成过模型');

    store.invalidate(7997);
    expect(refreshVerdictMock).toHaveBeenCalledTimes(2);
    expect(store.view(7997).title).not.toContain('本页面');
    expect(rootsMock).not.toHaveBeenCalled();
  });

  it('scheduleReprobe：按 10 s / 30 s / 60 s 各重拉一次 /dbnums，三次为止', async () => {
    vi.useFakeTimers();
    const store = useGenModelV1DbnumStatus();
    store.scheduleReprobe(7997);
    for (const [index, delay] of DBNUM_STATUS_PENDING_RETRY_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay);
      expect(refreshVerdictMock).toHaveBeenCalledTimes(index + 1);
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refreshVerdictMock).toHaveBeenCalledTimes(DBNUM_STATUS_PENDING_RETRY_DELAYS_MS.length);
  });

  it('服务换代后本页面的证据作废（未初始化库按需生成的结果随后端重启就没了）', async () => {
    const { observeGenModelV1Health } = await import('@/model-source/genModelV1/serviceLifecycle');
    const { getGenModelV1BaseUrl } = await import('@/utils/apiBase');
    const baseUrl = getGenModelV1BaseUrl();
    // 先建立 started_at 基线（第一次观察不换代）
    observeGenModelV1Health({ status: 'ok', started_at: 'instance-a' }, baseUrl);

    const store = useGenModelV1DbnumStatus();
    setRow(7997, { model_verdict: 'not_judged', initialized: false });
    store.noteGenerated(7997);
    expect(store.view(7997).title).toContain('本页面已按需生成过模型');

    // 服务重启 → started_at 变 → 换代
    observeGenModelV1Health({ status: 'ok', started_at: 'instance-b' }, baseUrl);
    expect(store.view(7997).title).not.toContain('本页面');
  });
});
