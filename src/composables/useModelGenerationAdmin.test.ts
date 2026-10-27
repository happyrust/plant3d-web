/**
 * K06：模型生成对话框「按库」水位行跟着非本会话的数据批次刷新（增量更新案例集合 K 组，
 * gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）。任务流换成手送信封，只看 `/dbnums` 请求什么时候发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listeners: new Set<(envelope: unknown) => void>(),
  dbnums: vi.fn(),
  connect: vi.fn(),
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
  genModelV1TaskGet: vi.fn(),
}));
vi.mock('@/api/genModelV1AdminApi', () => ({ genModelV1UpdateExecute: vi.fn() }));
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
