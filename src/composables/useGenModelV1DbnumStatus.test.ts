import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DBNUM_STATUS_BATCH_REFRESH_DELAY_MS,
  DBNUM_STATUS_PENDING_RETRY_DELAYS_MS,
  useGenModelV1DbnumStatus,
} from './useGenModelV1DbnumStatus';

import type { DbnumRow } from '@/api/genModelV1Api';

import {
  __resetGenModelV1UpdateNoticeForTests,
  handleGenModelV1TaskEnvelopeForNotice,
} from '@/composables/useGenModelV1UpdateNotice';
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

let batchSeq = 0;

/** 别处收口了一个数据批次（任务流的 `task_finished`）。任务号每次换一个：同一个任务只处理一次。 */
async function landBatch(dbnum: number) {
  batchSeq += 1;
  await handleGenModelV1TaskEnvelopeForNotice({
    type: 'task_finished',
    task_id: `db-${batchSeq}`,
    payload: {
      state: 'succeeded',
      result: { batch: { dbnum, db_type: 'DESI', end_sesno: 12, changed_elements: 1 }, units: [] },
    },
  });
}

describe('useGenModelV1DbnumStatus：库状态只读 /dbnums 那一行，不做整库根枚举', () => {
  afterEach(() => {
    useGenModelV1DbnumStatus().__reset();
    __resetGenModelV1UpdateNoticeForTests();
    __resetGenModelV1ServiceLifecycleForTests();
    healthState.verdict.rows = {};
    healthState.verdict.error = null;
    healthState.verdict.lastCheckedAt = null;
    rootsMock.mockReset();
    refreshVerdictMock.mockClear();
    vi.useRealTimers();
  });

  it('三枚水位对齐才是 current；后端判 lagging 是 stale', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(8000, { model_verdict: 'in_sync', initialized: true, file_latest_sesno: 1143, applied_sesno: 1143, model_sesno: 1143 });
    setRow(7998, { model_verdict: 'lagging', initialized: true, file_latest_sesno: 645, applied_sesno: 645, model_sesno: 640 });
    expect(store.view(8000)).toEqual({
      kind: 'current',
      title: 'DB 8000 · 模型已是最新\n模型 1143 · 数据 1143 · 库文件最新 1143',
    });
    expect(store.view(7998).kind).toBe('stale');
    expect(store.view(7998).title).toContain('DB 7998 · 模型落后于已入库数据');
  });

  it('模型与已入库数据一致、库文件还有新会话：不再是 current，写明差几个会话和三枚水位（本机 1112 / 7999 / 7333 的实际数）', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(1112, {
      model_verdict: 'in_sync', initialized: true, file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738,
      model_sesno_time: '2026-09-23T15:19:54',
    });
    setRow(7999, { model_verdict: 'in_sync', initialized: true, file_latest_sesno: 236, applied_sesno: 213, model_sesno: 213 });
    setRow(7333, { model_verdict: 'in_sync', initialized: true, file_latest_sesno: 1732, applied_sesno: 1724, model_sesno: 1724 });

    expect(store.view(1112)).toEqual({
      kind: 'file_ahead',
      title: [
        'DB 1112 · 库有 10 个新会话未更新',
        '有新会话，尚未核对是否影响模型（只登录不修改也会多一个会话）',
        '模型 738（2026-09-23 15:19 保存） · 数据 738 · 库文件最新 748',
      ].join('\n'),
    });
    expect(store.view(7999)).toMatchObject({ kind: 'file_ahead' });
    expect(store.view(7999).title).toContain('DB 7999 · 库有 23 个新会话未更新');
    expect(store.view(7333).title).toContain('DB 7333 · 库有 8 个新会话未更新');
  });

  it('库正在被写是 updating（轻量行靠 model_source_reason 认）', () => {
    const store = useGenModelV1DbnumStatus();
    setRow(8000, {
      model_verdict: 'lagging', initialized: true, file_latest_sesno: 1144, applied_sesno: 1143, model_sesno: 1143,
      model_source: 'memory', model_source_reason: 'initialization_publishing',
    });
    expect(store.view(8000).kind).toBe('updating');
    expect(store.view(8000).title).toContain('DB 8000 · 库正在更新');
  });

  it('源码钉：圆点的判定只走 judgeDbnumFreshness（与「模型生成」面板同一个函数），自己不再读 model_verdict', () => {
    const source = readFileSync(resolve(__dirname, 'useGenModelV1DbnumStatus.ts'), 'utf8');
    const code = source.slice(source.indexOf('import { reactive }'));
    expect(code).toMatch(/judgeDbnumFreshness\(row\)/);
    expect(code).not.toMatch(/model_verdict|applied_sesno|file_latest_sesno/);
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

  it('别处的数据批次落地：隔 2 s 重拉一次 /dbnums，落在哪个库都拉（一次请求带回全部库）；连着落几批只拉一次', async () => {
    vi.useFakeTimers();
    const store = useGenModelV1DbnumStatus();
    store.acquire(8000);

    await landBatch(7998);
    await vi.advanceTimersByTimeAsync(DBNUM_STATUS_BATCH_REFRESH_DELAY_MS - 1);
    expect(refreshVerdictMock).not.toHaveBeenCalled();
    // 还没到点又落一批：从这一批起重新等
    await landBatch(8000);
    await vi.advanceTimersByTimeAsync(DBNUM_STATUS_BATCH_REFRESH_DELAY_MS - 1);
    expect(refreshVerdictMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshVerdictMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refreshVerdictMock).toHaveBeenCalledTimes(1);

    await landBatch(8000);
    await vi.advanceTimersByTimeAsync(DBNUM_STATUS_BATCH_REFRESH_DELAY_MS);
    expect(refreshVerdictMock).toHaveBeenCalledTimes(2);
  });

  it('没有圆点挂载过就不订阅批次；__reset 之后退订，在等的那一次也作废', async () => {
    vi.useFakeTimers();
    const store = useGenModelV1DbnumStatus();
    await landBatch(8000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refreshVerdictMock).not.toHaveBeenCalled();

    store.acquire(8000);
    await landBatch(8000);
    store.__reset();
    await landBatch(8000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(refreshVerdictMock).not.toHaveBeenCalled();
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
