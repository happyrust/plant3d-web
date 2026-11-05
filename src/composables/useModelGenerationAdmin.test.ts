/**
 * K06：模型生成对话框「按库」水位行跟着非本会话的数据批次刷新（增量更新案例集合 K 组，
 * gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）。任务流换成手送信封，只看 `/dbnums` 请求什么时候发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listeners: new Set<(envelope: unknown) => void>(),
  dbnums: vi.fn(),
  connect: vi.fn(),
  health: vi.fn(),
  taskGet: vi.fn(),
  upgrade: vi.fn(),
  reinit: vi.fn(),
}));

vi.mock('@/composables/useGenModelV1TaskFeed', async () => {
  const { ref } = await import('vue');
  return {
    useGenModelV1TaskFeed: () => ({ feedStatus: ref('idle'), missedEvents: ref(0) }),
    subscribeGenModelV1TaskEvents: (listener: (envelope: unknown) => void) => {
      h.listeners.add(listener);
      return () => { h.listeners.delete(listener); };
    },
    connectGenModelV1TaskFeed: h.connect,
  };
});
vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1Dbnums: h.dbnums,
  genModelV1TaskGet: h.taskGet,
  genModelV1Health: h.health,
}));
vi.mock('@/api/genModelV1AdminApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1AdminApi')>()),
  genModelV1UpdateExecute: vi.fn(),
  genModelV1StorageVersionUpgrade: h.upgrade,
  genModelV1DbnumReinitialize: h.reinit,
}));
vi.mock('@/lib/currentProject', () => ({ getOutputProjectFromUrl: () => 'AvevaMarineSample' }));
vi.mock('@/composables/useDbMetaInfo', () => ({ tryGetDbnumByRefno: () => 8000 }));
vi.mock('@/composables/useGenModelV1DbnumStatus', () => ({
  invalidateDbnumModelStatus: vi.fn(),
  noteDbnumModelGenerated: vi.fn(),
  scheduleDbnumModelReprobe: vi.fn(),
}));
vi.mock('@/model-source', () => ({ getGenModelV1ModelSource: () => null }));
vi.mock('@/model-source/genModelV1/collectDbnum', () => ({ listSitesOfDbnum: vi.fn() }));

function row(sesno: number) {
  return { dbnum: 8000, db_type: 'DESI', applied_sesno: sesno, model_sesno: sesno, file_latest_sesno: sesno };
}

function envelope(type: string, taskId: string) {
  return { type, seq: 1, task_id: taskId, payload: { task_id: taskId, state: 'succeeded', result: { batch: { dbnum: 8000 } } } };
}

function emit(message: unknown): void {
  for (const listener of h.listeners) listener(message);
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function loadAdmin() {
  vi.resetModules();
  h.listeners.clear();
  const mod = await import('./useModelGenerationAdmin');
  return mod.useModelGenerationAdmin();
}

beforeEach(() => {
  vi.useFakeTimers();
  h.dbnums.mockReset();
  h.dbnums.mockResolvedValue({ dbnums: [row(727)], warnings: [] });
  h.connect.mockReset();
  h.health.mockReset();
  h.taskGet.mockReset();
  h.upgrade.mockReset();
  h.reinit.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('K06 按库水位行跟着非本会话的批次刷新', () => {
  it('对话框没请求过 /dbnums 时不听任务流，也不刷', async () => {
    await loadAdmin();
    expect(h.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.dbnums).not.toHaveBeenCalled();
  });

  it('请求过 /dbnums 就拉起任务流（不等本会话登记任务）', async () => {
    const admin = await loadAdmin();
    await admin.refreshDbnums();
    expect(h.dbnums).toHaveBeenCalledTimes(1);
    expect(h.dbnums).toHaveBeenCalledWith(expect.objectContaining({ identity: { project: 'AvevaMarineSample' } }));
    expect(h.listeners.size).toBe(1);
    expect(h.connect).toHaveBeenCalled();

    await admin.refreshDbnums();
    expect(h.listeners.size).toBe(1);
  });

  it('非本会话的 task_finished：800 ms 后刷一拍，窗口内连发合并成一次，新水位落到行上', async () => {
    const admin = await loadAdmin();
    await admin.refreshDbnums();
    expect(admin.dbRows.value[0]?.applied_sesno).toBe(727);
    h.dbnums.mockResolvedValue({ dbnums: [row(730)], warnings: [] });

    emit(envelope('task_finished', 'db-a'));
    emit(envelope('task_finished', 'db-b'));
    await vi.advanceTimersByTimeAsync(400);
    emit(envelope('task_finished', 'db-c'));
    await vi.advanceTimersByTimeAsync(399);
    expect(h.dbnums).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.dbnums).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(admin.dbRows.value[0]?.applied_sesno).toBe(730);

    emit(envelope('task_finished', 'db-d'));
    await vi.advanceTimersByTimeAsync(800);
    expect(h.dbnums).toHaveBeenCalledTimes(3);
  });

  it('非本会话的 started / progress 不刷水位行；没带 task_id 的 task_finished 也当别人的批次刷一拍', async () => {
    const admin = await loadAdmin();
    await admin.refreshDbnums();
    emit(envelope('task_started', 'db-a'));
    emit({ type: 'task_progress', seq: 2, task_id: 'db-a', payload: { kind: 'data_batch_started', dbnum: 8000, start_sesno: 728, end_sesno: 730 } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.dbnums).toHaveBeenCalledTimes(1);

    emit({ type: 'task_finished' });
    await vi.advanceTimersByTimeAsync(800);
    expect(h.dbnums).toHaveBeenCalledTimes(2);
  });
});

describe('一键完全重新部署', () => {
  it('redeploy：全选不传 dbnums，回执 task 登记轮询，并轮询 health 直到升级结束', async () => {
    const admin = await loadAdmin();
    h.upgrade.mockResolvedValue({
      target_version: 8,
      requested: [8000, 8001],
      full_scope: true,
      upgrade: { state: 'running', started_at: '2026-11-05T00:00:00Z' },
      receipt: {
        enqueued: [{ task_id: 't-8000', dbnum: 8000, intent: 'reinitialize' }],
        merged: [{ task_id: 't-8001', dbnum: 8001, intent: 'reinitialize' }],
      },
    });
    h.taskGet.mockResolvedValue({ task_id: 'x', state: 'running', current_stage: 'wipe_reinit' });
    h.health
      .mockResolvedValueOnce({ status: 'ok', storage_version: { expected: 8, stored: 7, upgrade: { state: 'running', requested: [8000, 8001], done_dbnums: [8000] } } })
      .mockResolvedValue({ status: 'ok', storage_version: { expected: 8, stored: 8, upgrade: { state: 'done', requested: [8000, 8001], done_dbnums: [8000, 8001] } } });

    const outcome = await admin.redeploy([8000, 8001], { all: true });
    expect(outcome).toBe('accepted');
    expect(h.upgrade).toHaveBeenCalledWith(undefined, expect.objectContaining({ identity: { project: 'AvevaMarineSample' } }));
    expect(admin.redeployTaskIds.value).toEqual(['t-8000', 't-8001']);
    expect(admin.tasks.value.has('t-8000')).toBe(true);
    await flushMicrotasks();
    expect(h.taskGet).toHaveBeenCalled();
    expect(admin.upgradeProgress.value?.done_dbnums).toEqual([8000]);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(admin.upgradeProgress.value?.state).toBe('done');
    const calls = h.health.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.health.mock.calls.length).toBe(calls);
  });

  it('redeploy：子集传排好序的 dbnums；409 映射成友好文案并返回 conflict', async () => {
    const admin = await loadAdmin();
    const { GenModelV1ApiError } = await import('@/api/genModelV1Api');
    h.upgrade.mockRejectedValue(new GenModelV1ApiError({ code: 'conflict', status: 409, message: '已有存储架构升级在进行中', path: '/x' }));
    h.health.mockResolvedValue({ status: 'ok', storage_version: { upgrade: { state: 'running' } } });

    const outcome = await admin.redeploy([8001, 8000]);
    expect(outcome).toBe('conflict');
    expect(h.upgrade).toHaveBeenCalledWith([8000, 8001], expect.anything());
    expect(admin.redeployError.value).toBe('已有重新部署在运行');
    admin.stopUpgradeHealthPolling();
  });

  it('probeRedeploySupport：health 没有 storage_version → outdated；升级在跑 → running', async () => {
    const admin = await loadAdmin();
    h.health.mockResolvedValueOnce({ status: 'ok', version: '0.9.0' });
    expect(await admin.probeRedeploySupport()).toBe('outdated');
    expect(admin.backendVersion.value).toBe('0.9.0');

    h.health.mockResolvedValueOnce({ status: 'ok', storage_version: null });
    expect(await admin.probeRedeploySupport()).toBe('ok');

    h.health.mockResolvedValueOnce({ status: 'ok', storage_version: { upgrade: { state: 'running', requested: [8000] } } });
    expect(await admin.probeRedeploySupport()).toBe('running');
    expect(admin.upgradeProgress.value?.requested).toEqual([8000]);
    admin.stopUpgradeHealthPolling();
  });
});
