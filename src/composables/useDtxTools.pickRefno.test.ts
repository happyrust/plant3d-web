import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { Vector3 } from 'three';

const findNounByRefnoAcrossAllDbnos = vi.fn();
const findOwnerRefnoByTubi = vi.fn();

vi.mock('@/composables/useDbnoInstancesDtxLoader', () => ({
  findNounByRefnoAcrossAllDbnos,
  findOwnerRefnoByTubi,
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: { value: null },
    propertiesLoading: { value: false },
    propertiesError: { value: null },
    propertiesData: { value: null },
    fullName: { value: '' },
    loadProperties: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedRefno: vi.fn(),
  }),
}));

describe('pick_refno BRAN fallback', () => {
  beforeEach(() => {
    findNounByRefnoAcrossAllDbnos.mockReset();
    findOwnerRefnoByTubi.mockReset();
  });

  function createCanvas() {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    return canvas;
  }

  async function createTools(toolStore: any, pickPoint: () => any, compatViewerValue: any = null) {
    const { useDtxTools } = await import('./useDtxTools');
    return useDtxTools({
      dtxViewerRef: { value: null } as any,
      dtxLayerRef: { value: null } as any,
      selectionRef: { value: { pickPoint } } as any,
      overlayContainerRef: { value: document.createElement('div') } as any,
      store: toolStore,
      compatViewerRef: { value: compatViewerValue } as any,
    });
  }

  it('点到 TUBI 且 noun 缺失时，仍尝试回溯 owner BRAN 并加入 pickedRefnos', async () => {
    const { useToolStore } = await import('./useToolStore');
    const toolStore = useToolStore();
    toolStore.startPickRefno(['BRAN']);

    findNounByRefnoAcrossAllDbnos.mockImplementation((refno: string) => refno === 'bran_1' ? 'BRAN' : null);
    findOwnerRefnoByTubi.mockImplementation((refno: string) => refno === 'tubi_1' ? 'bran_1' : null);

    const ensureRefnos = vi.fn();
    const setObjectsSelected = vi.fn();
    const tools = await createTools(
      toolStore,
      () => ({ objectId: 'o:tubi_1:0', point: new Vector3(1, 2, 3), distance: 1, triangle: [] as any }),
      { scene: { ensureRefnos, setObjectsSelected, selectedObjectIds: [] } },
    );

    tools.onCanvasPointerUp(createCanvas(), { button: 0, clientX: 10, clientY: 10 } as PointerEvent);
    await nextTick();

    expect(findOwnerRefnoByTubi).toHaveBeenCalledWith('tubi_1');
    expect(toolStore.pickedRefnos.value).toEqual(['bran_1']);
    expect(ensureRefnos).toHaveBeenCalledWith(['bran_1']);
    expect(setObjectsSelected).toHaveBeenCalledWith(['bran_1'], true);
  });

  it('点到 TUBI 且无法回溯 owner BRAN 时，不加入 pickedRefnos', async () => {
    const { useToolStore } = await import('./useToolStore');
    const toolStore = useToolStore();
    toolStore.startPickRefno(['BRAN']);

    findNounByRefnoAcrossAllDbnos.mockReturnValue(null);
    findOwnerRefnoByTubi.mockReturnValue(null);

    const tools = await createTools(
      toolStore,
      () => ({ objectId: 'o:tubi_2:0', point: new Vector3(1, 2, 3), distance: 1, triangle: [] as any }),
    );

    tools.onCanvasPointerUp(createCanvas(), { button: 0, clientX: 20, clientY: 20 } as PointerEvent);
    await nextTick();

    expect(findOwnerRefnoByTubi).toHaveBeenCalledWith('tubi_2');
    expect(toolStore.pickedRefnos.value).toEqual([]);
  });
});

