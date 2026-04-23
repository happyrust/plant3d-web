import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { BoxGeometry, BufferGeometry, Matrix4 } from 'three';

const selectedRefno = ref<string | null>(null);
const selectedRefnos = ref<string[]>([]);

function normalizeRefnos(refnos: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const refno of refnos) {
    const normalized = String(refno ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

const selectionStoreMock = {
  selectedRefno,
  selectedRefnos,
  propertiesLoading: ref(false),
  propertiesError: ref<string | null>(null),
  propertiesData: ref(null),
  fullName: ref(null),
  loadProperties: vi.fn(),
  clearSelection: vi.fn(() => {
    selectedRefnos.value = [];
    selectedRefno.value = null;
  }),
  clearSelectedRefnos: vi.fn(() => {
    selectedRefnos.value = [];
    selectedRefno.value = null;
  }),
  setSelectedRefno: vi.fn((refno: string | null) => {
    const normalized = normalizeRefnos(refno ? [refno] : []);
    selectedRefnos.value = normalized;
    selectedRefno.value = normalized[0] ?? null;
  }),
  setSelectedRefnos: vi.fn((refnos: (string | null | undefined)[], activeRefno?: string | null) => {
    const normalized = normalizeRefnos(refnos);
    selectedRefnos.value = normalized;
    const active = String(activeRefno ?? '').trim();
    selectedRefno.value = active && normalized.includes(active) ? active : normalized[normalized.length - 1] ?? null;
  }),
  isSelected: vi.fn((refno: string) => selectedRefnos.value.includes(String(refno ?? '').trim())),
  toggleSelectedRefno: vi.fn(),
};

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => selectionStoreMock,
}));

import {
  computeApproxNearestBetweenObjects,
  useDtxTools,
} from './useDtxTools';
import { useToolStore } from './useToolStore';

import { DTXLayer } from '@/utils/three/dtx';

function createLayerWithBoxes(distance = 3): DTXLayer {
  const layer = new DTXLayer({
    maxVertices: 4096,
    maxIndices: 4096,
    maxObjects: 16,
  });
  layer.addGeometry('box-a', new BoxGeometry(1, 1, 1));
  layer.addGeometry('box-b', new BoxGeometry(1, 1, 1));
  layer.addGeometry('box-c', new BoxGeometry(1, 1, 1));
  layer.addObject('o:24381_1001:0', 'box-a', new Matrix4().makeTranslation(0, 0, 0));
  layer.addObject('o:24381_1002:0', 'box-b', new Matrix4().makeTranslation(distance, 0, 0));
  layer.addObject('o:24381_1003:0', 'box-c', new Matrix4().makeTranslation(6, 0, 0));
  return layer;
}

function createViewerStub() {
  return {
    scene: {
      add: vi.fn(),
      remove: vi.fn(),
    },
    controls: {
      enabled: true,
    },
  };
}

describe('useDtxTools object measure helpers', () => {
  beforeEach(() => {
    selectedRefnos.value = [];
    selectedRefno.value = null;
    vi.clearAllMocks();
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('none');
  });

  it('应对两个盒体返回稳定的最近点与距离', () => {
    const layer = createLayerWithBoxes(3);

    const result = computeApproxNearestBetweenObjects(layer, {
      sourceObjectId: 'o:24381_1001:0',
      targetObjectId: 'o:24381_1002:0',
    });

    expect(result).toBeTruthy();
    expect(result?.distance).toBeCloseTo(2, 6);
    expect(result?.sourcePoint[0]).toBeCloseTo(0.5, 6);
    expect(result?.targetPoint[0]).toBeCloseTo(2.5, 6);
    expect(result?.sourcePoint[1]).toBeCloseTo(result?.targetPoint[1] ?? 0, 6);
    expect(result?.sourcePoint[2]).toBeCloseTo(result?.targetPoint[2] ?? 0, 6);
  });

  it('同对象或空几何时不返回结果', () => {
    const layer = createLayerWithBoxes(3);

    expect(computeApproxNearestBetweenObjects(layer, {
      sourceObjectId: 'o:24381_1001:0',
      targetObjectId: 'o:24381_1001:0',
    })).toBeNull();

    const emptyLayer = {
      getObjectBoundingBox: vi.fn(() => null),
      getObjectGeometryData: vi.fn(() => ({
        geometry: new BufferGeometry(),
        matrix: new Matrix4(),
      })),
      closestPointToObject: vi.fn(() => null),
    } as unknown as DTXLayer;

    expect(computeApproxNearestBetweenObjects(emptyLayer, {
      sourceObjectId: 'o:empty_a:0',
      targetObjectId: 'o:empty_b:0',
    })).toBeNull();
  });
});

describe('useDtxTools object measure tree flow', () => {
  beforeEach(() => {
    selectedRefnos.value = [];
    selectedRefno.value = null;
    vi.clearAllMocks();
    const store = useToolStore();
    store.clearAll();
    store.setToolMode('none');
  });

  it('树双选后应自动生成一次测量，并对同一对 refno 去重；reset 后允许再次生成', async () => {
    const store = useToolStore();
    const layer = createLayerWithBoxes(3);
    const tools = useDtxTools({
      dtxViewerRef: ref(createViewerStub() as any),
      dtxLayerRef: ref(layer),
      selectionRef: ref({} as any),
      overlayContainerRef: ref(null),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.refreshReadyState();
    store.setToolMode('measure_object_to_object');
    await nextTick();

    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_1002'], '24381_1002');
    await nextTick();

    expect(store.measurements.value).toHaveLength(1);
    expect(store.measurements.value[0]?.kind).toBe('distance');
    expect(store.measurements.value[0]?.origin.entityId).toBe('o:24381_1001:0');
    expect(store.measurements.value[0]?.target.entityId).toBe('o:24381_1002:0');

    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_1002'], '24381_1002');
    await nextTick();
    expect(store.measurements.value).toHaveLength(1);

    tools.cancelMeasurementInteraction();
    selectionStoreMock.setSelectedRefnos([], null);
    await nextTick();
    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_1002'], '24381_1002');
    await nextTick();

    expect(store.measurements.value).toHaveLength(2);
  });

  it('超过两个构件或目标未加载时不生成测量，并给出状态提示', async () => {
    const store = useToolStore();
    const layer = createLayerWithBoxes(3);
    const tools = useDtxTools({
      dtxViewerRef: ref(createViewerStub() as any),
      dtxLayerRef: ref(layer),
      selectionRef: ref({} as any),
      overlayContainerRef: ref(null),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    tools.refreshReadyState();
    store.setToolMode('measure_object_to_object');
    await nextTick();

    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_1002', '24381_1003'], '24381_1003');
    await nextTick();
    expect(store.measurements.value).toHaveLength(0);
    expect(tools.statusText.value).toBe('该模式仅支持两个构件');

    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_9999'], '24381_9999');
    await nextTick();
    expect(store.measurements.value).toHaveLength(0);
    expect(tools.statusText.value).toBe('请先显示这两个构件后再测量');
  });
});
