import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, shallowRef } from 'vue';

import { BoxGeometry, BufferGeometry, Matrix4, Vector3 } from 'three';

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

/** 管-管间距：点到的构件 → 所属 BRAN，用 DTX 缓存；这里直接给表。 */
const ownerBranByRefno = new Map<string, string>();
vi.mock('@/composables/useDbnoInstancesDtxLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useDbnoInstancesDtxLoader')>()),
  findOwnerBranRefnoAcrossAllDbnos: (refno: string) => ownerBranByRefno.get(refno) ?? null,
}));

/** 两条 BRAN 的中心线（`GET /api/v1/spatial/centerline`）按 refno 给。 */
const centerlineByRefno = new Map<string, unknown>();
const genModelV1SpatialCenterline = vi.fn(async (refno: string) => {
  const line = centerlineByRefno.get(refno.replace('/', '_'));
  if (!line) throw new Error(`no centerline fixture for ${refno}`);
  return line;
});
vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1SpatialCenterline: (refno: string) => genModelV1SpatialCenterline(refno),
}));

const sourceKindState: { kind: 'gen-model-v1' | 'legacy' } = { kind: 'gen-model-v1' };
vi.mock('@/model-source/kind', () => ({
  getModelSourceKind: () => sourceKindState.kind,
}));

import {
  computeApproxNearestBetweenObjects,
  useDtxTools,
} from './useDtxTools';
import { useToolStore } from './useToolStore';

import type { BranParallelSpacingInput } from '@/composables/useSpatialCompute';

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
    camera: null,
  };
}

function createCanvasStub(): HTMLCanvasElement {
  return {
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  } as unknown as HTMLCanvasElement;
}

function createPointerEventStub(): PointerEvent {
  return {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 1,
  } as PointerEvent;
}

async function flushAsyncToolWork(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  /** 点一下（pointer down + up），等异步工具流程跑完。 */
  async function clickOnce(tools: ReturnType<typeof useDtxTools>): Promise<void> {
    const canvas = createCanvasStub();
    const event = createPointerEventStub();
    tools.onCanvasPointerDown(canvas, event);
    tools.onCanvasPointerUp(canvas, event);
    await flushAsyncToolWork();
  }

  /** 两次点选（先第一根管、再第二根），走到 `completePipeToPipeSpacing`。 */
  async function clickTwoPipes(tools: ReturnType<typeof useDtxTools>): Promise<void> {
    await clickOnce(tools);
    await clickOnce(tools);
  }

  function centerlineSegment(refno: string, order: number, start: [number, number, number], end: [number, number, number], noun = 'TUBI') {
    return {
      refno,
      order,
      noun,
      implicit: refno.includes('~'),
      start: { x: start[0], y: start[1], z: start[2] },
      end: { x: end[0], y: end[1], z: end[2] },
      length_mm: Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]),
      outside_diameter_mm: null,
    };
  }

  /** 两条 BRAN：`24381_1000` 沿 x 直跑 2000；`24381_2000` 与它平行、抬高 600，再拐个弯（那一截配不上）。 */
  function installTwoParallelBrans(): void {
    ownerBranByRefno.clear();
    ownerBranByRefno.set('24381_1001', '24381_1000');
    ownerBranByRefno.set('24381_1002', '24381_2000');
    ownerBranByRefno.set('24381_1003', '24381_2000');
    centerlineByRefno.clear();
    centerlineByRefno.set('24381_1000', {
      refno: '24381_1000', dbnum: 24381, segment_count: 1, outside_diameter_mm: 114.3, centerline_bbox: null, warnings: [],
      segments: [centerlineSegment('Head~24381_1001', 0, [0, 0, 0], [2000, 0, 0])],
    });
    centerlineByRefno.set('24381_2000', {
      refno: '24381_2000', dbnum: 24381, segment_count: 3, outside_diameter_mm: 168.3, centerline_bbox: null, warnings: [],
      segments: [
        centerlineSegment('Head~24381_1002', 0, [500, 0, 600], [2500, 0, 600]),
        centerlineSegment('24381_1002', 1, [2500, 0, 600], [2600, 100, 600], 'ELBO'),
        centerlineSegment('24381_1002~24381_1003', 2, [2600, 100, 600], [2600, 1100, 600]),
      ],
    });
  }

  function createPipeToPipeTools(
    hits: { objectId: string; point: Vector3 }[],
    recordBranParallelSpacing?: (input: BranParallelSpacingInput) => void,
  ) {
    const store = useToolStore();
    const layer = createLayerWithBoxes(3);
    const tools = useDtxTools({
      dtxViewerRef: ref(createViewerStub() as any),
      dtxLayerRef: shallowRef<DTXLayer | null>(layer),
      selectionRef: ref({
        pickPoint: vi.fn(() => hits.shift() ?? null),
      } as any),
      overlayContainerRef: ref(null),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
      recordBranParallelSpacing: recordBranParallelSpacing ?? null,
    });
    tools.refreshReadyState();
    store.setToolMode('measure_pipe_to_pipe');
    return tools;
  }

  it('管-管间距：两次点选解到两条 BRAN，取两条中心线，平行直段的中心距写进结果落点（一对一条），状态报「已写入」（plan 2026-09-16 §3.3 ④）', async () => {
    installTwoParallelBrans();
    sourceKindState.kind = 'gen-model-v1';
    const recordBranParallelSpacing = vi.fn();
    const tools = createPipeToPipeTools([
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
    ], recordBranParallelSpacing);
    await nextTick();

    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距：已选第一条 BRAN 24381_1000（点选 24381_1001），请点第二条 BRAN 上的管件');
    expect(genModelV1SpatialCenterline).not.toHaveBeenCalled();

    await clickOnce(tools);
    expect(genModelV1SpatialCenterline.mock.calls.map((call) => call[0])).toEqual(['24381_1000', '24381_2000']);
    expect(recordBranParallelSpacing).toHaveBeenCalledTimes(1);
    const input = recordBranParallelSpacing.mock.calls[0]![0];
    expect(input.sourceBranRefno).toBe('24381_1000');
    expect(input.targetBranRefno).toBe('24381_2000');
    expect(input.pairs).toHaveLength(1);
    const [pair] = input.pairs;
    expect(pair.axisDistanceMm).toBeCloseTo(600, 9);
    expect(pair.overlapMm).toBeCloseTo(1500, 9);
    expect(pair.sourcePointMm).toEqual({ x: 1250, y: 0, z: 0 });
    expect(pair.targetPointMm).toEqual({ x: 1250, y: 0, z: 600 });
    expect(pair.clearanceMm).toBeCloseTo(600 - (114.3 + 168.3) / 2, 9);
    expect(pair.source.segments[0].refno).toBe('Head~24381_1001');
    expect(pair.target.segments[0].refno).toBe('Head~24381_1002');
    // 全局默认显示单位为 mm + 0 位小数（E3D 惯例，V2 迁移）；中心线上的中心距是精确值，不标「估算」
    expect(tools.statusText.value).toBe('管-管间距：24381_1000 ↔ 24381_2000 找到 1 对平行直段（1 / 2 条直段），中心距 600mm，已写入 Dock「BRAN 中心线最近清距」结果并画出尺寸');
    expect(tools.statusText.value).not.toContain('估算');
  });

  it('管-管间距：点到不属于 BRAN 的构件、同一条 BRAN 点两次都只提示；没接落点时只报状态不写；没有平行直段直说', async () => {
    installTwoParallelBrans();
    sourceKindState.kind = 'gen-model-v1';
    // 第二条 BRAN 改成与第一条垂直：没有平行直段
    centerlineByRefno.set('24381_2000', {
      refno: '24381_2000', dbnum: 24381, segment_count: 1, outside_diameter_mm: null, centerline_bbox: null, warnings: [],
      segments: [centerlineSegment('Head~24381_1002', 0, [1000, -500, 600], [1000, 500, 600])],
    });
    const tools = createPipeToPipeTools([
      { objectId: 'o:24381_9999:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1001:0', point: new Vector3(1, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
    ]);
    await nextTick();
    expect(tools.statusText.value).toBe('管-管间距：点第一根管道（量两条 BRAN 平行直段之间的中心距，结果写入 Dock「BRAN 中心线最近清距」并画出尺寸）');

    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距：24381_9999 不属于任何 BRAN——只能量两条 BRAN 之间的平行直段，请点管件或直管');

    await clickOnce(tools);
    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距：24381_1001 与第一根同属 BRAN 24381_1000，请点另一条 BRAN 上的管件');
    expect(genModelV1SpatialCenterline).not.toHaveBeenCalled();

    await clickOnce(tools);
    expect(genModelV1SpatialCenterline).toHaveBeenCalledTimes(2);
    expect(tools.statusText.value).toBe('管-管间距：24381_1000 ↔ 24381_2000 没有平行的直段（1 / 1 条直段，夹角容差 0.5°）');
    expect(tools.statusText.value).not.toContain('暂不创建尺寸');
  });

  it('管-管间距：legacy 数据源没有中心线接口，第二次点选只提示、不请求、不写', async () => {
    installTwoParallelBrans();
    sourceKindState.kind = 'legacy';
    const recordBranParallelSpacing = vi.fn();
    const tools = createPipeToPipeTools([
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
    ], recordBranParallelSpacing);
    await nextTick();
    await clickTwoPipes(tools);

    expect(genModelV1SpatialCenterline).not.toHaveBeenCalled();
    expect(recordBranParallelSpacing).not.toHaveBeenCalled();
    expect(tools.statusText.value).toBe('管-管间距：当前数据源没有 BRAN 中心线接口（/api/v1/spatial/centerline），请切到 gen-model-v1 数据源');
    sourceKindState.kind = 'gen-model-v1';
  });
});
