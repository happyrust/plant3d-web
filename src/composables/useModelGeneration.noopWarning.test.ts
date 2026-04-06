import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitToastMock = vi.fn();
const addLogMock = vi.fn();
const beginMock = vi.fn();
const updateMock = vi.fn();
const finishMock = vi.fn();
const loadInstancesMock = vi.fn();
const getSubtreeRefnosMock = vi.fn();
const isParquetAvailableMock = vi.fn();

vi.mock('@/api/genModelE3dApi', () => ({
  e3dGetSubtreeRefnos: getSubtreeRefnosMock,
}));

vi.mock('@/api/genModelRealtimeApi', () => ({
  enqueueParquetIncremental: vi.fn(),
  getParquetVersion: vi.fn(),
}));

vi.mock('@/api/genModelTaskApi', () => ({
  modelShowByRefno: vi.fn(),
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
}));

vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  loadDbnoInstancesForVisibleRefnosDtx: loadInstancesMock,
}));

vi.mock('@/composables/useDbnoInstancesJsonLoader', () => ({
  triggerBatchGenerateSse: vi.fn(),
}));

vi.mock('@/composables/useDbnoInstancesParquetLoader', () => ({
  useDbnoInstancesParquetLoader: () => ({
    isParquetAvailable: isParquetAvailableMock,
    queryAllRefnoKeys: vi.fn(),
  }),
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
    getSubtreeRefnosMock.mockResolvedValue({
      success: true,
      refnos: ['24381_145018'],
      truncated: false,
    });
    isParquetAvailableMock.mockResolvedValue(true);
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

  it('当模型已在场景中且这次没有新增实例时，不应再弹“未绘制任何实例”的警告', async () => {
    const viewer = {
      scene: {
        objects: {
          '24381_145018': {},
        },
        getAABB: vi.fn(() => ({ min: [0, 0, 0], max: [1, 1, 1] })),
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
    expect(emitToastMock).not.toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
    expect(addLogMock).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('本次未新增实例')
    );
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
});
