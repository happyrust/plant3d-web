import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGenModelV1DbnumStatus } from './useGenModelV1DbnumStatus';

import { GenModelV1ApiError } from '@/api/genModelV1Api';
import { __resetGenModelV1ServiceLifecycleForTests } from '@/model-source/genModelV1/serviceLifecycle';

const rootsMock = vi.hoisted(() => vi.fn());
const healthState = vi.hoisted(() => ({
  verdict: { byDbnum: {} as Record<number, string>, lastCheckedAt: null as number | null },
}));

vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1DbnumModelRoots: rootsMock,
}));

vi.mock('@/composables/useGenModelV1Health', () => ({
  useGenModelV1Health: () => ({ state: healthState }),
}));

function rootsReply(ready: number, total = 10) {
  return { source: 'direct', dbnum: 7997, total, ready_total: ready, roots: [] };
}

function setVerdict(dbnum: number, verdict: string) {
  healthState.verdict.byDbnum[dbnum] = verdict;
  healthState.verdict.lastCheckedAt = Date.now();
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useGenModelV1DbnumStatus：verdict 表态优先，not_judged 落到 model/roots 探测', () => {
  afterEach(() => {
    useGenModelV1DbnumStatus().__reset();
    __resetGenModelV1ServiceLifecycleForTests();
    healthState.verdict.byDbnum = {};
    healthState.verdict.lastCheckedAt = null;
    rootsMock.mockReset();
    vi.useRealTimers();
  });

  it('verdict in_sync / lagging 直接给 current / stale，不发 roots 探测', async () => {
    const store = useGenModelV1DbnumStatus();
    setVerdict(7997, 'in_sync');
    setVerdict(7998, 'lagging');
    const releaseA = store.acquire(7997);
    const releaseB = store.acquire(7998);
    await flush();
    expect(store.view(7997).kind).toBe('current');
    expect(store.view(7998).kind).toBe('stale');
    expect(rootsMock).not.toHaveBeenCalled();
    releaseA();
    releaseB();
  });

  it('not_judged 时探测 roots：ready_total>0 → current（title 带就绪根数），=0 → empty', async () => {
    const store = useGenModelV1DbnumStatus();
    rootsMock.mockImplementation(async (dbnum: number) => (
      dbnum === 7999 ? rootsReply(0, 4435) : rootsReply(1, 6772)
    ));
    const releaseA = store.acquire(7997);
    const releaseB = store.acquire(7999);
    await flush();
    expect(rootsMock).toHaveBeenCalledTimes(2);
    expect(store.view(7997)).toMatchObject({ kind: 'current' });
    expect(store.view(7997).title).toContain('就绪根 1/6772');
    expect(store.view(7999).kind).toBe('empty');
    releaseA();
    releaseB();
  });

  it('旧构建没有 ready_total：逐根数 ready', async () => {
    const store = useGenModelV1DbnumStatus();
    rootsMock.mockResolvedValue({
      source: 'direct', dbnum: 1, total: 2,
      roots: [{ generation_root: '1/1', ready: true }, { generation_root: '1/2', ready: false }],
    });
    const release = store.acquire(1);
    await flush();
    expect(store.view(1).kind).toBe('current');
    release();
  });

  it('探测失败 → unknown，title 带错误；30 s 内不自动重打', async () => {
    vi.useFakeTimers();
    const store = useGenModelV1DbnumStatus();
    rootsMock.mockRejectedValue(new GenModelV1ApiError({ code: 'network', status: 0, path: '/x', message: 'ECONNREFUSED' }));
    const release = store.acquire(6890);
    await vi.advanceTimersByTimeAsync(0);
    const view = store.view(6890);
    expect(view.kind).toBe('unknown');
    expect(view.title).toContain('ECONNREFUSED');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(rootsMock).toHaveBeenCalledTimes(1);
    release();
  });

  it('在飞期间显示 probing；同库重复 acquire 只发一发', async () => {
    const store = useGenModelV1DbnumStatus();
    let resolve!: (v: unknown) => void;
    rootsMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const releaseA = store.acquire(7997);
    const releaseB = store.acquire(7997);
    expect(store.view(7997).kind).toBe('probing');
    resolve(rootsReply(3, 9));
    await flush();
    expect(rootsMock).toHaveBeenCalledTimes(1);
    expect(store.view(7997).kind).toBe('current');
    releaseA();
    releaseB();
  });

  it('TTL 内重复 acquire 不重探；过期后 tick 自动补探在看的库', async () => {
    vi.useFakeTimers();
    const store = useGenModelV1DbnumStatus();
    rootsMock.mockResolvedValue(rootsReply(1, 10));
    const release = store.acquire(7997);
    await vi.advanceTimersByTimeAsync(0);
    expect(rootsMock).toHaveBeenCalledTimes(1);

    // 60 s TTL 内再来一遍：不发
    const release2 = store.acquire(7997);
    release2();
    await vi.advanceTimersByTimeAsync(0);
    expect(rootsMock).toHaveBeenCalledTimes(1);

    // 过期后由 tick（15 s）发现该库仍被看 → 重探
    await vi.advanceTimersByTimeAsync(61_000);
    expect(rootsMock).toHaveBeenCalledTimes(2);
    release();
  });

  it('invalidate：还在看的库立刻丢结论重探；noteGenerated 乐观记绿', async () => {
    const store = useGenModelV1DbnumStatus();
    rootsMock.mockResolvedValue(rootsReply(0, 10));
    const release = store.acquire(7999);
    await flush();
    expect(store.view(7999).kind).toBe('empty');

    store.noteGenerated(7999);
    expect(store.view(7999)).toMatchObject({ kind: 'current' });
    expect(store.view(7999).title).toContain('模型刚生成');

    rootsMock.mockResolvedValue(rootsReply(4, 10));
    store.invalidate(7999);
    await flush();
    expect(rootsMock).toHaveBeenCalledTimes(2);
    expect(store.view(7999).title).toContain('就绪根 4/10');
    release();
  });

  it('reconcile：records 证据推翻 empty 结论时重探；已是 current 就不动', async () => {
    const store = useGenModelV1DbnumStatus();
    rootsMock.mockResolvedValueOnce(rootsReply(0, 10));
    const release = store.acquire(7998);
    await flush();
    expect(store.view(7998).kind).toBe('empty');

    rootsMock.mockResolvedValueOnce(rootsReply(2, 10));
    store.reconcile(7998);
    await flush();
    expect(store.view(7998).kind).toBe('current');

    store.reconcile(7998);
    await flush();
    expect(rootsMock).toHaveBeenCalledTimes(2);
    release();
  });

  it('服务换代后旧探测结论作废，再看会重探', async () => {
    const { observeGenModelV1Health } = await import('@/model-source/genModelV1/serviceLifecycle');
    const { getGenModelV1BaseUrl } = await import('@/utils/apiBase');
    const baseUrl = getGenModelV1BaseUrl();
    // 先建立 started_at 基线（第一次观察不换代）
    observeGenModelV1Health({ status: 'ok', started_at: 'instance-a' }, baseUrl);

    const store = useGenModelV1DbnumStatus();
    rootsMock.mockResolvedValue(rootsReply(0, 10));
    const release = store.acquire(7999);
    await flush();
    expect(store.view(7999).kind).toBe('empty');

    // 服务重启 → started_at 变 → 换代：旧结论立刻不认
    observeGenModelV1Health({ status: 'ok', started_at: 'instance-b' }, baseUrl);
    expect(store.view(7999).kind).toBe('unknown');

    rootsMock.mockResolvedValue(rootsReply(2, 10));
    store.refresh(7999);
    await flush();
    expect(rootsMock).toHaveBeenCalledTimes(2);
    expect(store.view(7999).kind).toBe('current');
    release();
  });
});
