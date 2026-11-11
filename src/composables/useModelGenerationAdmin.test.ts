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
  updateExecute: vi.fn(),
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
  genModelV1UpdateExecute: h.updateExecute,
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
  h.updateExecute.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('executeUpdate：面板「更新所选」和模型树行上的「更新到最新」共用（方案 2026-11-10 C3）', () => {
  it('点名这些库发一次 update/execute；回执里新排上的和并进去的批次都登记轮询；回执原样交回', async () => {
    const admin = await loadAdmin();
    const receipt = {
      enqueued: [{ task_id: 'batch-1', dbnum: 1112, intent: 'apply_window', start_sesno: 738, end_sesno: 748 }],
      merged: [{ task_id: 'batch-0', dbnum: 1112 }],
    };
    h.updateExecute.mockResolvedValue(receipt);
    h.taskGet.mockResolvedValue({ state: 'running', current_stage: 'model_generate', units_done: 1, total_units: 4 });

    await expect(admin.executeUpdate([1112])).resolves.toBe(receipt);
    expect(h.updateExecute).toHaveBeenCalledTimes(1);
    expect(h.updateExecute).toHaveBeenCalledWith([1112], expect.objectContaining({ identity: { project: 'AvevaMarineSample' } }));
    expect(admin.lastReceipt.value).toEqual(receipt);
    await flushMicrotasks();
    expect([...admin.tasks.value.keys()].sort()).toEqual(['batch-0', 'batch-1']);
    expect(admin.tasks.value.get('batch-1')).toMatchObject({ dbnum: 1112, state: 'running', currentStage: 'model_generate', unitsDone: 1, totalUnits: 4 });
    // 2 秒一拍接着轮询
    h.taskGet.mockResolvedValue({ state: 'succeeded', current_stage: 'task_end', units_done: 4, total_units: 4 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(admin.tasks.value.get('batch-1')).toMatchObject({ state: 'succeeded' });
  });

  it('请求失败原样抛出，不登记任务', async () => {
    const admin = await loadAdmin();
    h.updateExecute.mockRejectedValue(new Error('HTTP 503'));
    await expect(admin.executeUpdate([1112])).rejects.toThrow('HTTP 503');
    expect(admin.tasks.value.size).toBe(0);
  });

  it('面板「更新所选」照旧：勾选的库排好序走同一条路，失败写到 executeError、不抛', async () => {
    const admin = await loadAdmin();
    admin.toggleDbnum(7997);
    admin.toggleDbnum(1112);
    h.updateExecute.mockResolvedValue({ up_to_date: 2 });
    await admin.executeSelected();
    expect(h.updateExecute).toHaveBeenCalledWith([1112, 7997], expect.anything());
    expect(admin.executeError.value).toBeNull();
    expect(admin.executeBusy.value).toBe(false);

    h.updateExecute.mockRejectedValue(new Error('HTTP 500'));
    await admin.executeSelected();
    expect(admin.executeError.value).toBe('HTTP 500');
    expect(admin.executeBusy.value).toBe(false);
  });
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

describe('库状态徽标：与模型树圆点同一个判定函数（方案 2026-11-10 C1）', () => {
  const base = { dbnum: 8000, db_type: 'DESI', initialized: true, model_verdict: 'in_sync' };

  it('各种行落到哪个徽标', async () => {
    const { dbnumPanelStatus } = await import('./useModelGenerationAdmin');
    expect(dbnumPanelStatus({ ...base, file_latest_sesno: 9, applied_sesno: 9, model_sesno: 9 })).toBe('synced');
    // 库文件有新会话、数据没入库：待更新（模型树圆点同一行说「库有 2 个新会话未更新」）
    expect(dbnumPanelStatus({ ...base, file_latest_sesno: 9, applied_sesno: 7, model_sesno: 7 })).toBe('pending');
    expect(dbnumPanelStatus({ ...base, model_verdict: 'lagging', file_latest_sesno: 9, applied_sesno: 9, model_sesno: 7 })).toBe('pending');
    expect(dbnumPanelStatus({ ...base, initialized: false, model_verdict: 'not_judged', file_latest_sesno: 9, applied_sesno: 0, model_sesno: 0 }))
      .toBe('uninitialized');
    expect(dbnumPanelStatus({ ...base, initialized: false, awaiting_manual_initialization: true })).toBe('awaiting');
    expect(dbnumPanelStatus({ ...base, blocked: true })).toBe('blocked');
    expect(dbnumPanelStatus({ ...base, excluded: true })).toBe('excluded');
    expect(dbnumPanelStatus({ ...base, not_in_project: true })).toBe('excluded');
    // 目录库不生成模型：只比数据与库文件
    expect(dbnumPanelStatus({ dbnum: 1, db_type: 'CATA', initialized: true, file_latest_sesno: 9, applied_sesno: 9 })).toBe('synced');
    expect(dbnumPanelStatus({ dbnum: 1, db_type: 'CATA', initialized: true, file_latest_sesno: 9, applied_sesno: 7 })).toBe('pending');
  });

  it('库正在被写是「进行中」：后端写的是 write_state.status = writing', async () => {
    const { dbnumPanelStatus } = await import('./useModelGenerationAdmin');
    const row = { ...base, file_latest_sesno: 9, applied_sesno: 7, model_sesno: 7 };
    expect(dbnumPanelStatus({ ...row, write_state: { status: 'writing', intent: 'apply_window' } })).toBe('running');
    expect(dbnumPanelStatus({ ...row, write_state: { status: 'finished' } })).toBe('pending');
  });

  it('徽标的提示文字与模型树圆点是同一句话，并带三枚水位', async () => {
    const { dbnumStatusTitle } = await import('./useModelGenerationAdmin');
    expect(dbnumStatusTitle({ ...base, file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738 })).toBe([
      '库有 10 个新会话未更新',
      '有新会话，尚未核对是否影响模型（只登录不修改也会多一个会话）',
      '模型 738 · 数据 738 · 库文件最新 748',
    ].join('\n'));
    expect(dbnumStatusTitle({ ...base, model_verdict: 'lagging', file_latest_sesno: 9, applied_sesno: 9, model_sesno: 7 }))
      .toContain('模型落后于已入库数据');
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
