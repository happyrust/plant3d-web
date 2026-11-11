/**
 * 向后端问节点模型状态（`GET node/model-status`）：回执翻成事实；旧服务端没有这条路由时回 null 并且五分钟内不再问。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NODE_MODEL_STATUS_ROUTE_RECHECK_MS,
  __resetNodeModelFactsForTests,
  backendMeshPurgeKeepsShared,
  fetchGenerationFacts,
  fetchNodeModelFacts,
} from './nodeModelFacts';

const statusMock = vi.hoisted(() => vi.fn());
/** `/health` 的 capabilities（`useGenModelV1Health().state.capabilities`）：还没取到是 null */
const health = vi.hoisted(() => ({ capabilities: null as Record<string, unknown> | null }));

vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1NodeModelStatus: statusMock,
}));
vi.mock('@/composables/useGenModelV1Health', () => ({
  useGenModelV1Health: () => ({ state: health }),
}));

/** 2026-11-11 本机新后端对 7997 的 SITE 24381/535 的原样回执 */
const SITE_535 = {
  refno: '24381/535', noun: 'SITE', dbnum: 7997, unit_root: null, verdict: 'not_generated', verdict_reason: null,
  library: {
    file_latest_sesno: 447, file_latest_time: '2026-11-07T19:43:00+08:00', applied_sesno: 0, model_sesno: 0, model_sesno_time: null,
    initialized: true, model_verdict: 'not_judged', model_verdict_reason: 'data_watermark_unestablished',
    model_source: 'memory', model_source_reason: 'data_watermark_unestablished',
    data_batch_running: false, model_task_running: false, in_watch_scope: true,
  },
  units: { total: 21, generated: 0, missing: 21, failed: 0, lagging: 0, exact: true },
  generated_at: null, changes: null,
  precheck: { units_to_generate: 21, needs_confirm: true, confirm_threshold_units: 20 },
  cached: true, elapsed_ms: 6,
};

async function apiError(status: number, hasEnvelope: boolean, code = 'not_found') {
  const { GenModelV1ApiError } = await import('@/api/genModelV1Api');
  return new GenModelV1ApiError({ code, status, path: '/api/v1/node/model-status', message: `HTTP ${status}`, hasEnvelope });
}

beforeEach(() => {
  statusMock.mockReset();
  __resetNodeModelFactsForTests();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fetchNodeModelFacts', () => {
  it('按节点问一次，回执翻成事实', async () => {
    statusMock.mockResolvedValue(SITE_535);
    const facts = await fetchNodeModelFacts({ refno: '24381_535' });
    expect(statusMock).toHaveBeenCalledTimes(1);
    expect(statusMock).toHaveBeenCalledWith('24381_535');
    expect(facts).toMatchObject({
      verdict: 'not_generated', dbnum: 7997, noun: 'SITE',
      units: { total: 21, generated: 0, missing: 21 },
      precheck: { unitsToGenerate: 21, needsConfirm: true, thresholdUnits: 20 },
      library: { inWatchScope: true, fileLatestSesno: 447 },
    });
  });

  it('旧服务端没有这条路由（不带信封的 404 / 405）：回 null，五分钟内不再问，之后再试', async () => {
    statusMock.mockRejectedValue(await apiError(404, false));
    expect(await fetchNodeModelFacts({ refno: '1_1' })).toBeNull();
    expect(await fetchNodeModelFacts({ refno: '1_2' })).toBeNull();
    expect(statusMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(NODE_MODEL_STATUS_ROUTE_RECHECK_MS + 1);
    statusMock.mockResolvedValue(SITE_535);
    expect((await fetchNodeModelFacts({ refno: '24381_535' }))?.verdict).toBe('not_generated');
    expect(statusMock).toHaveBeenCalledTimes(2);

    __resetNodeModelFactsForTests();
    statusMock.mockRejectedValue(await apiError(405, false, 'internal'));
    expect(await fetchNodeModelFacts({ refno: '1_1' })).toBeNull();
  });

  it('带信封的业务错误（节点不存在、库文件打不开）和网络错误照常抛，不当成「没有这条路由」', async () => {
    statusMock.mockRejectedValueOnce(await apiError(404, true, 'REFNO_NOT_FOUND'));
    await expect(fetchNodeModelFacts({ refno: '24381_999' })).rejects.toMatchObject({ code: 'REFNO_NOT_FOUND' });
    statusMock.mockRejectedValueOnce(await apiError(503, true, 'SOURCE_NOT_FOUND'));
    await expect(fetchNodeModelFacts({ refno: '24381_535' })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    // 没有被记成「路由不存在」：下一次照样去问
    statusMock.mockResolvedValue(SITE_535);
    expect(await fetchNodeModelFacts({ refno: '24381_535' })).not.toBeNull();
    expect(statusMock).toHaveBeenCalledTimes(3);
  });
});

describe('同一个节点几乎同时被问两次（节点刚装完：行上的状态 + 生成预检）', () => {
  function deferred() {
    let release!: (value: unknown) => void;
    const promise = new Promise((resolve) => { release = resolve; });
    return { promise, release };
  }

  it('生成预检搭行上那一问还在路上的便车：只发一发，两边拿到同一份事实', async () => {
    const gate = deferred();
    statusMock.mockReturnValue(gate.promise);
    const row = fetchNodeModelFacts({ refno: '24381/535' });
    const plan = fetchGenerationFacts('24381_535');
    gate.release(SITE_535);
    expect((await row)?.verdict).toBe('not_generated');
    expect(await plan).toMatchObject({ unitsTotal: 21, unitsToGenerate: 21 });
    expect(statusMock).toHaveBeenCalledTimes(1);

    // 那一问回来之后再问：是新的一发（这里不缓存回执）
    statusMock.mockResolvedValue({ ...SITE_535, verdict: 'latest', precheck: { units_to_generate: 0, needs_confirm: false, confirm_threshold_units: 20 } });
    expect(await fetchGenerationFacts('24381_535')).toMatchObject({ unitsToGenerate: 0 });
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it('行上的状态不搭便车：每次都是此刻新发的一问（生成完、水位变了之后要的是现在的答案）', async () => {
    const first = deferred();
    const second = deferred();
    statusMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const stale = fetchNodeModelFacts({ refno: '24381_535' });
    const fresh = fetchNodeModelFacts({ refno: '24381_535' });
    expect(statusMock).toHaveBeenCalledTimes(2);
    second.release({ ...SITE_535, verdict: 'partial' });
    first.release(SITE_535);
    expect((await fresh)?.verdict).toBe('partial');
    expect((await stale)?.verdict).toBe('not_generated');
  });

  it('调用方取消了：它这边立刻放手；搭着同一问的另一边照常拿到结果', async () => {
    const gate = deferred();
    statusMock.mockReturnValue(gate.promise);
    const controller = new AbortController();
    const row = fetchNodeModelFacts({ refno: '24381_535', signal: controller.signal });
    const plan = fetchGenerationFacts('24381_535');
    controller.abort(new Error('节点被重新登记'));
    await expect(row).rejects.toThrow('节点被重新登记');
    gate.release(SITE_535);
    expect(await plan).toMatchObject({ unitsToGenerate: 21 });
    // 已经取消的信号：不等
    await expect(fetchNodeModelFacts({ refno: '24381_535', signal: controller.signal })).rejects.toThrow('节点被重新登记');
  });

  it('那一问失败：两边都拿到同一个错；下一次照常重发', async () => {
    statusMock.mockRejectedValueOnce(await apiError(503, true, 'SOURCE_NOT_FOUND'));
    const row = fetchNodeModelFacts({ refno: '24381_535' });
    const plan = fetchGenerationFacts('24381_535');
    await expect(row).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(plan).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    statusMock.mockResolvedValue(SITE_535);
    expect(await fetchGenerationFacts('24381_535')).not.toBeNull();
  });
});

describe('fetchGenerationFacts（生成预检用得到的那几格）', () => {
  it('单元总数、要生成几个、要不要确认、阈值、是不是精确；这个库没有模型水位，缺的按需生成', async () => {
    statusMock.mockResolvedValue(SITE_535);
    expect(await fetchGenerationFacts('24381_535')).toEqual({
      unitsTotal: 21, unitsToGenerate: 21, needsConfirm: true, thresholdUnits: 20, exact: true, preferUpdate: false,
    });
  });

  it('库有模型水位、在更新范围里、库文件比水位新：缺的单元归「更新到最新」管', async () => {
    statusMock.mockResolvedValue({
      ...SITE_535, dbnum: 8000, verdict: 'partial',
      library: { ...SITE_535.library, file_latest_sesno: 1146, applied_sesno: 1143, model_sesno: 1143, in_watch_scope: true },
      units: { total: 2, generated: 1, missing: 1, failed: 0, lagging: 0, exact: true },
      precheck: { units_to_generate: 1, needs_confirm: false, confirm_threshold_units: 20 },
    });
    expect(await fetchGenerationFacts('24384_26547')).toMatchObject({ unitsToGenerate: 1, preferUpdate: true });
    // 库不在更新范围里：更新不了，只能按需生成
    statusMock.mockResolvedValue({
      ...SITE_535, library: { ...SITE_535.library, file_latest_sesno: 748, model_sesno: 738, in_watch_scope: false },
    });
    expect(await fetchGenerationFacts('17496_8516')).toMatchObject({ preferUpdate: false });
  });

  it('服务端没有那个接口：回 null', async () => {
    statusMock.mockRejectedValue(await apiError(404, false));
    expect(await fetchGenerationFacts('1_1')).toBeNull();
  });
});

describe('backendMeshPurgeKeepsShared（后端有没有声明清几何不再带走别人共用的东西）', () => {
  afterEach(() => {
    health.capabilities = null;
  });

  it('只有 /health 的 capabilities 里明说 mesh_purge_keeps_shared = true 才算；没取到、没有这一格、不是 true 都按没修算', () => {
    expect(backendMeshPurgeKeepsShared()).toBe(false);
    health.capabilities = { mesh_batch_max_keys: 1024, mesh_batch_max_bytes: 33554432 };
    expect(backendMeshPurgeKeepsShared()).toBe(false);
    health.capabilities = { mesh_purge_keeps_shared: false };
    expect(backendMeshPurgeKeepsShared()).toBe(false);
    health.capabilities = { mesh_purge_keeps_shared: 'true' };
    expect(backendMeshPurgeKeepsShared()).toBe(false);
    health.capabilities = { mesh_batch_max_keys: 1024, mesh_purge_keeps_shared: true };
    expect(backendMeshPurgeKeepsShared()).toBe(true);
  });
});
