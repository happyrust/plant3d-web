/**
 * 「更新到最新」（方案 2026-11-10 C3）。`update/execute` 会写库，这里全部用假接口：
 * 假的回执、假的任务表、假的 `/dbnums` 行。真机上的验收不在这一轮。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive, ref, type Ref } from 'vue';

import type { UpdateExecuteReceipt } from '@/api/genModelV1AdminApi';
import type { DbnumRow } from '@/api/genModelV1Api';

type TaskStub = { taskId: string; state: string; currentStage: string | null; unitsDone: number | null; totalUnits: number | null; lastUnitFailure?: string | null };

const h = vi.hoisted(() => ({
  executeUpdate: vi.fn<(dbnums: number[]) => Promise<unknown>>(),
  refreshVerdict: vi.fn(async () => {}),
  emitToast: vi.fn(),
  tasks: null as unknown,
  healthState: null as unknown,
}));

// 阶段名到面板五段叫法的映射用真的；发请求和任务表用假的
vi.mock('@/composables/useModelGenerationAdmin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useModelGenerationAdmin')>()),
  useModelGenerationAdmin: () => ({ executeUpdate: h.executeUpdate, tasks: h.tasks }),
}));
vi.mock('@/composables/useGenModelV1Health', () => ({
  useGenModelV1Health: () => ({ state: h.healthState, refreshVerdict: h.refreshVerdict }),
}));
vi.mock('@/ribbon/toastBus', () => ({ emitToast: h.emitToast }));

const tasks = () => h.tasks as Ref<Map<string, TaskStub>>;
const health = () => h.healthState as { verdict: { rows: Record<number, DbnumRow>; lastCheckedAt: number | null } };

const ROW_1112: DbnumRow = {
  dbnum: 1112, db_type: 'DESI', initialized: true, file_latest_sesno: 748, applied_sesno: 738, model_sesno: 738, model_verdict: 'in_sync',
};

function setRow(row: DbnumRow): void {
  health().verdict = { rows: { ...health().verdict.rows, [row.dbnum]: row }, lastCheckedAt: (health().verdict.lastCheckedAt ?? 0) + 1 };
}

function setTask(task: TaskStub): void {
  const next = new Map(tasks().value);
  next.set(task.taskId, task);
  tasks().value = next;
}

const ENQUEUED: UpdateExecuteReceipt = {
  enqueued: [{ task_id: 'batch-1', dbnum: 1112, intent: 'apply_window', start_sesno: 738, end_sesno: 748 }],
};

/** 让监听回调、重拉库状态之后的收尾都跑完（假时钟下也能用：只转微任务） */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await nextTick();
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  }
}

async function load() {
  const mod = await import('./useUpdateToLatest');
  const state = await import('./updateToLatestState');
  return { ...mod, ...state };
}

beforeEach(() => {
  vi.resetModules();
  h.tasks = ref(new Map());
  h.healthState = reactive({ verdict: { rows: {}, lastCheckedAt: null } });
  h.executeUpdate.mockReset();
  h.refreshVerdict.mockClear();
  h.emitToast.mockClear();
  setRow(ROW_1112);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestUpdateToLatest', () => {
  it('点一下：对这个库发一次 update/execute，排上之后跟着任务走——排队、运行（带阶段和进度）、完成', async () => {
    const { requestUpdateToLatest, getUpdateToLatestState, isUpdateToLatestBusy } = await load();
    h.executeUpdate.mockImplementation(async () => {
      setTask({ taskId: 'batch-1', state: 'queued', currentStage: null, unitsDone: null, totalUnits: null });
      return ENQUEUED;
    });

    const state = await requestUpdateToLatest(1112);
    expect(h.executeUpdate).toHaveBeenCalledTimes(1);
    expect(h.executeUpdate).toHaveBeenCalledWith([1112]);
    expect(state).toMatchObject({ dbnum: 1112, phase: 'queued', taskIds: ['batch-1'], message: '已排队：会话 738→748' });

    // 后端给的是细粒度阶段名：归到面板那五段的叫法上
    setTask({ taskId: 'batch-1', state: 'running', currentStage: 'collect_window', unitsDone: null, totalUnits: null });
    await nextTick();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'running', message: '数据摄入' });
    setTask({ taskId: 'batch-1', state: 'running', currentStage: 'model_generate', unitsDone: 3, totalUnits: 10 });
    await nextTick();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'running', message: '模型生成 3/10' });
    // 任务流的事件是就地改任务对象的（不换表）：同样要跟得上
    tasks().value.get('batch-1')!.unitsDone = 7;
    await nextTick();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'running', message: '模型生成 7/10' });

    // 任务做完：先重拉库状态（已加载节点表据此重查这个节点是不是真被改到）。重拉回来之前仍算在忙——
    // 这一小段里行上还是「落后 + 更新」，放开了会被再点一次
    let releaseRefresh!: () => void;
    h.refreshVerdict.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseRefresh = resolve; }));
    setTask({ taskId: 'batch-1', state: 'succeeded', currentStage: 'task_end', unitsDone: 10, totalUnits: 10 });
    await settle();
    expect(h.refreshVerdict).toHaveBeenCalledTimes(1);
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'running', message: '后端已更新完，正在核对哪些节点被改到…' });
    expect(isUpdateToLatestBusy(getUpdateToLatestState(1112)!)).toBe(true);
    expect(h.emitToast).not.toHaveBeenCalled();
    await requestUpdateToLatest(1112);
    expect(h.executeUpdate).toHaveBeenCalledTimes(1);

    releaseRefresh();
    await settle();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'done' });
    expect(getUpdateToLatestState(1112)!.message).toContain('更新完成');
    expect(getUpdateToLatestState(1112)!.finishedAt).not.toBeNull();
    // 这里不替用户换场景：只提示，真被改到的节点由已加载节点表标成「有更新可重载」
    expect(h.emitToast).toHaveBeenCalledWith(expect.objectContaining({ level: 'success', message: expect.stringContaining('重载') }));
  });

  it('已经在排队 / 在跑：再点不重复触发，只回当前的进度', async () => {
    const { requestUpdateToLatest } = await load();
    h.executeUpdate.mockImplementation(async () => {
      setTask({ taskId: 'batch-1', state: 'running', currentStage: 'data_parse', unitsDone: null, totalUnits: null });
      return ENQUEUED;
    });
    await requestUpdateToLatest(1112);
    const again = await requestUpdateToLatest(1112);
    expect(h.executeUpdate).toHaveBeenCalledTimes(1);
    expect(again).toMatchObject({ phase: 'running', message: '数据摄入' });
  });

  it('请求还在路上时又点：不发第二次', async () => {
    const { requestUpdateToLatest, getUpdateToLatestState } = await load();
    let release!: (receipt: UpdateExecuteReceipt) => void;
    h.executeUpdate.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const first = requestUpdateToLatest(1112);
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'requesting' });
    const second = await requestUpdateToLatest(1112);
    expect(second.phase).toBe('requesting');
    expect(h.executeUpdate).toHaveBeenCalledTimes(1);
    release({ up_to_date: 1 });
    await first;
  });

  it('后端已经在写这个库（库状态是更新中）：不发请求，只跟着看；写完算完成', async () => {
    const { requestUpdateToLatest, getUpdateToLatestState } = await load();
    setRow({ ...ROW_1112, model_source: 'memory', model_source_reason: 'initialization_publishing' });
    const state = await requestUpdateToLatest(1112);
    expect(h.executeUpdate).not.toHaveBeenCalled();
    expect(state).toMatchObject({ phase: 'running', message: '后端正在更新这个库，做完会提示' });

    setRow({ ...ROW_1112, applied_sesno: 748, model_sesno: 748 });
    await settle();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'done' });
  });

  it('后端拒绝（库不在更新范围里 / 被阻断）：把后端给的原因显示出来，不跟任务', async () => {
    const { requestUpdateToLatest } = await load();
    h.executeUpdate.mockResolvedValue({ warnings: ['dbnum=1112: 在执行范围内，但本次扫描没有找到它的候选文件'] });
    const state = await requestUpdateToLatest(1112);
    expect(state).toMatchObject({ phase: 'rejected', message: '后端没有受理：dbnum=1112: 在执行范围内，但本次扫描没有找到它的候选文件' });
    expect(h.emitToast).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning', message: expect.stringContaining('在执行范围内，但本次扫描没有找到它的候选文件'),
    }));
  });

  it('请求失败：记失败和原因；之后可以再点', async () => {
    const { requestUpdateToLatest } = await load();
    h.executeUpdate.mockRejectedValueOnce(new Error('HTTP 503 model_dependency_unavailable'));
    const failed = await requestUpdateToLatest(1112);
    expect(failed).toMatchObject({ phase: 'failed', message: '更新请求失败：HTTP 503 model_dependency_unavailable' });
    h.executeUpdate.mockResolvedValueOnce({ up_to_date: 1 });
    const retried = await requestUpdateToLatest(1112);
    expect(h.executeUpdate).toHaveBeenCalledTimes(2);
    expect(retried.phase).toBe('up_to_date');
    expect(h.refreshVerdict).toHaveBeenCalled();
  });

  it.each([
    ['failed', 'failed', '批次失败'],
    ['partial', 'done', '有单元生成失败'],
    ['yielded', 'failed', '让出'],
  ] as const)('任务终态 %s → %s', async (taskState, phase, text) => {
    const { requestUpdateToLatest, getUpdateToLatestState } = await load();
    h.executeUpdate.mockImplementation(async () => {
      setTask({ taskId: 'batch-1', state: 'queued', currentStage: null, unitsDone: null, totalUnits: null });
      return ENQUEUED;
    });
    await requestUpdateToLatest(1112);
    setTask({ taskId: 'batch-1', state: taskState, currentStage: null, unitsDone: null, totalUnits: null, lastUnitFailure: 'BRAN 24381/1: 网格生成失败' });
    await settle();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase });
    expect(getUpdateToLatestState(1112)!.message).toContain(text);
  });

  it('这个库本来就在后端队列里（回执没有任务号）：跟着库的水位看，模型水位前进了算完成', async () => {
    vi.useFakeTimers();
    const { requestUpdateToLatest, getUpdateToLatestState } = await load();
    h.executeUpdate.mockResolvedValue({ already_covered: [1112] });
    const state = await requestUpdateToLatest(1112);
    expect(state).toMatchObject({ phase: 'queued', taskIds: [], message: '这个库已经在后端的队列里，做完会提示' });

    // 没有任务可跟：隔几秒重拉一次库状态
    h.refreshVerdict.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.refreshVerdict).toHaveBeenCalledTimes(1);
    setRow({ ...ROW_1112, applied_sesno: 748, model_sesno: 748 });
    await settle();
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'done' });

    // 完成之后不再重拉
    h.refreshVerdict.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.refreshVerdict).not.toHaveBeenCalled();
  });

  it('跟着水位看的那种，十分钟没等到就不再等（状态改成失败并说明）', async () => {
    vi.useFakeTimers();
    const { requestUpdateToLatest, getUpdateToLatestState } = await load();
    h.executeUpdate.mockResolvedValue({ status: 'model_refresh_queued' });
    await requestUpdateToLatest(1112);
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 5_000);
    expect(getUpdateToLatestState(1112)).toMatchObject({ phase: 'failed' });
    expect(getUpdateToLatestState(1112)!.message).toContain('没等到');
  });
});
