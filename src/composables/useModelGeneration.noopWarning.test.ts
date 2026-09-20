import { beforeEach, describe, expect, it, vi } from 'vitest';

// 占位节点 / DTX 缓存的判定只依赖数据源端口（tree.subtreeRefnos / visibleInsts / attributes.typeInfo）与加载器 mock。
// 「本次未新增实例」与「重新生成」两条 legacy（parquet / backend）语义的用例 2026-09-20 随 legacy 退役删除；
// v1 下同一类行为见 `useModelGeneration.genModelV1.test.ts`。
const emitToastMock = vi.fn();
const addLogMock = vi.fn();
const beginMock = vi.fn();
const updateMock = vi.fn();
const finishMock = vi.fn();
const loadInstancesMock = vi.fn();
const getSubtreeRefnosMock = vi.fn();
const isDtxRefnoLoadedMock = vi.fn();

vi.mock('@/model-source', () => ({
  getModelSource: () => ({
    kind: 'gen-model-v1',
    tree: {
      subtreeRefnos: (refno: string, params?: unknown) => getSubtreeRefnosMock(refno, params),
      visibleInsts: vi.fn(async (refno: string) => ({ success: true, refno, refnos: [refno] })),
    },
    attributes: { typeInfo: vi.fn(async (refno: string) => ({ success: true, refno, noun: 'BRAN' })) },
    records: { subscribeProgress: () => () => {} },
  }),
  getGenModelV1ModelSource: () => null,
  subscribeModelSourceProgress: () => () => {},
}));

vi.mock('@/composables/useConfirmDialogStore', () => ({
  useConfirmDialogStore: () => ({
    confirm: vi.fn(),
  }),
}));

vi.mock('@/composables/useConsoleStore', () => ({
  useConsoleStore: () => ({
    addLog: addLogMock,
  }),
}));

vi.mock('@/composables/useDbMetaInfo', () => ({
  ensureDbMetaInfoLoaded: vi.fn(async () => {}),
  getDbnumByRefno: vi.fn(() => 7997),
  tryGetDbnumByRefno: vi.fn(() => 7997),
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  isDtxRefnoLoaded: isDtxRefnoLoadedMock,
  loadDbnoInstancesForVisibleRefnosDtx: loadInstancesMock,
}));

vi.mock('@/composables/useModelLoadStatus', () => ({
  useModelLoadStatus: () => ({
    begin: beginMock,
    update: updateMock,
    finish: finishMock,
  }),
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: emitToastMock,
}));

describe('useModelGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDtxRefnoLoadedMock.mockReturnValue(false);
    getSubtreeRefnosMock.mockResolvedValue({
      success: true,
      refnos: ['24381_145018'],
      truncated: false,
    });
    loadInstancesMock.mockResolvedValue({
      loadedRefnos: 0,
      skippedRefnos: 1,
      loadedObjects: 0,
      missingRefnos: [],
      missingBreakdown: {
        noGeoRowsRefnos: [],
        mesh404Refnos: [],
        mesh404GeoHashes: [],
      },
      sceneBoundingBox: null,
    });
  });

  it('当场景里只有占位节点时，不应弹出占位重载警告', async () => {
    const viewer = {
      scene: {
        objects: {
          '24381_145018': {},
        },
        getAABB: vi.fn(() => null),
      },
      __dtxLayer: {
        hasObject: vi.fn(() => false),
        getBoundingBox: vi.fn(() => null),
      },
      cameraFlight: {
        flyTo: vi.fn(),
      },
    } as any;

    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({
      viewer,
      db_num: 7997,
    });

    const ok = await gen.showModelByRefno('24381/145018', { flyTo: true });

    expect(gen.error.value).toBeNull();
    expect(ok).toBe(true);
    expect(loadInstancesMock).toHaveBeenCalled();
    expect(emitToastMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        message: expect.stringContaining('仅为占位、尚无几何'),
      })
    );
    expect(addLogMock).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('命中占位节点，转入真实模型加载')
    );
  });

  it('能识别已经通过 DTX refno 缓存加载的子节点', async () => {
    isDtxRefnoLoadedMock.mockImplementation((dbno: number, refno: string) => {
      return dbno === 7997 && refno === '24381_145019';
    });
    const viewer = {
      __dtxLayer: {
        hasObject: vi.fn(() => false),
      },
    } as any;

    const { useModelGeneration } = await import('./useModelGeneration');
    const gen = useModelGeneration({
      viewer,
      db_num: 7997,
    });

    expect(gen.isModelActuallyLoaded('24381/145019')).toBe(true);
    expect(viewer.__dtxLayer.hasObject).not.toHaveBeenCalled();
  });

});
