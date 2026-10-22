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
/** refno → 已加载 DTX objectId 表（`resolveDtxObjectIdsByRefno` 桩）。 */
const objectIdsByRefno = new Map<string, string[]>();
/** refno → 16 位变换矩阵（`getDtxRefnoTransform` 桩；不给回 null）。 */
const refnoTransformByRefno = new Map<string, number[] | null>();
vi.mock('@/composables/useDbnoInstancesDtxLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useDbnoInstancesDtxLoader')>()),
  findOwnerBranRefnoAcrossAllDbnos: (refno: string) => ownerBranByRefno.get(refno) ?? null,
  resolveDtxObjectIdsByRefno: (_dbnum: number, refno: string) => objectIdsByRefno.get(refno) ?? [],
  getDtxRefnoTransform: (_dbnum: number, refno: string) => refnoTransformByRefno.get(refno) ?? null,
}));

/** 两条 BRAN 的中心线（`GET /api/v1/spatial/centerline`）按 refno 给。 */
const centerlineByRefno = new Map<string, unknown>();
const genModelV1SpatialCenterline = vi.fn(async (refno: string) => {
  const line = centerlineByRefno.get(refno.replace('/', '_'));
  if (!line) throw new Error(`no centerline fixture for ${refno}`);
  return line;
});
/** 管-墙/柱的最近候选（`GET /api/v1/spatial/nearest-clearance`）。 */
const genModelV1SpatialNearestClearance = vi.fn(async (_input?: unknown) => ({
  nearest_by_group: [] as { noun: string; candidates: { refno: string; noun: string; distance_mm: number }[] }[],
}));
vi.mock('@/api/genModelV1Api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/genModelV1Api')>()),
  genModelV1SpatialCenterline: (refno: string) => genModelV1SpatialCenterline(refno),
  genModelV1SpatialNearestClearance: (...args: unknown[]) => genModelV1SpatialNearestClearance(...args),
}));

import {
  computeApproxNearestBetweenObjects,
  useDtxTools,
} from './useDtxTools';
import { useToolStore } from './useToolStore';

import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
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
    useClearanceStore().clearRecords();
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
    useClearanceStore().clearRecords();
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

    // #58：构件最近点归 ClearanceStore（component-to-component / sampled-object），
    // 不再写 classic measurement。
    const clearanceStore = useClearanceStore();
    expect(store.measurements.value).toHaveLength(0);
    expect(clearanceStore.records.value).toHaveLength(1);
    const rec = clearanceStore.records.value[0]!;
    expect(rec.kind).toBe('component-to-component');
    expect(rec.inputs.sourceRefno).toBe('24381_1001');
    expect(rec.inputs.targetRefno).toBe('24381_1002');
    expect(rec.provenance.method).toBe('sampled-object');
    expect(rec.provenance.accuracyClass).toBe('approximate-sampled');
    expect(rec.snapshot?.distanceM).toBeCloseTo(2, 6);
    expect(rec.snapshot?.witness).toBe('closest-points');

    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_1002'], '24381_1002');
    await nextTick();
    expect(clearanceStore.records.value).toHaveLength(1);

    tools.cancelMeasurementInteraction();
    selectionStoreMock.setSelectedRefnos([], null);
    await nextTick();
    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_1002'], '24381_1002');
    await nextTick();

    // 同一对 refno → 同一 clearanceRecordId：重测是重算（upsert），不是再加一条。
    expect(clearanceStore.records.value).toHaveLength(1);
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
    expect(useClearanceStore().records.value).toHaveLength(0);
    expect(tools.statusText.value).toBe('该模式仅支持两个构件');

    selectionStoreMock.setSelectedRefnos(['24381_1001', '24381_9999'], '24381_9999');
    await nextTick();
    expect(useClearanceStore().records.value).toHaveLength(0);
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

  function createPipeMeasureTools(
    mode: 'measure_pipe_to_pipe' | 'measure_pipe_to_structure',
    hits: { objectId: string; point: Vector3 }[],
    layer = createLayerWithBoxes(3),
  ) {
    const store = useToolStore();
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
    });
    tools.refreshReadyState();
    store.setToolMode(mode);
    return tools;
  }

  it('管-管间距：两次点选解到两条 BRAN，取两条中心线，一对平行直段一条 ClearanceRecord（#63）', async () => {
    installTwoParallelBrans();
    const tools = createPipeMeasureTools('measure_pipe_to_pipe', [
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
    ]);
    await nextTick();

    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距：已选第一条 BRAN 24381_1000（点选 24381_1001），请点第二条 BRAN 上的管件');
    expect(genModelV1SpatialCenterline).not.toHaveBeenCalled();

    await clickOnce(tools);
    expect(genModelV1SpatialCenterline.mock.calls.map((call) => call[0])).toEqual(['24381_1000', '24381_2000']);
    const records = useClearanceStore().records.value;
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.kind).toBe('component-to-component');
    // inputs 是两条直段的首段 refno（record id 由 inputs 唯一决定），BRAN refno 在 provenance operand
    expect(record.inputs).toEqual({ sourceRefno: 'Head~24381_1001', targetRefno: 'Head~24381_1002', targetKind: 'any' });
    expect(record.provenance.method).toBe('parallel-centerline');
    expect(record.provenance.accuracyClass).toBe('exact-centerline');
    expect(record.provenance.coordinateSpace).toBe('design-world');
    expect(record.provenance.source).toEqual({ entityId: '24381_1000', refno: '24381_1000', segmentRefno: 'Head~24381_1001' });
    expect(record.provenance.target).toEqual({ entityId: '24381_2000', refno: '24381_2000', segmentRefno: 'Head~24381_1002' });
    expect(record.snapshot?.distanceM).toBeCloseTo(0.6, 9);
    expect(record.snapshot?.intersects).toBe(false);
    expect(record.snapshot?.sourcePoint).toEqual([1.25, 0, 0]);
    expect(record.snapshot?.targetPoint).toEqual([1.25, 0, 0.6]);
    expect(record.snapshot?.vector).toEqual([0, 0, 0.6]);
    expect(record.snapshot?.sourceLeafRefno).toBe('Head~24381_1001');
    expect(record.snapshot?.targetLeafRefno).toBe('Head~24381_1002');
    expect(record.snapshot?.targetLeafNoun).toBe('TUBI');
    expect(record.snapshot?.witness).toBe('closest-points');
    expect(record.derivedDimensionId).toBeNull();
    // 全局默认显示单位为 mm + 0 位小数（E3D 惯例，V2 迁移）；中心线上的中心距是精确值，不标「估算」
    expect(tools.statusText.value).toBe('管-管间距：24381_1000 ↔ 24381_2000 找到 1 对平行直段（1 / 2 条直段），中心距 600mm，已生成 1 条中心距记录');
    expect(tools.statusText.value).not.toContain('估算');
    expect(tools.statusText.value).not.toContain('尺寸');
  });

  it('管-管间距：点到不属于 BRAN 的构件、同一条 BRAN 点两次都只提示；没有平行直段清掉旧记录并直说', async () => {
    installTwoParallelBrans();
    // 第二条 BRAN 改成与第一条垂直：没有平行直段
    centerlineByRefno.set('24381_2000', {
      refno: '24381_2000', dbnum: 24381, segment_count: 1, outside_diameter_mm: null, centerline_bbox: null, warnings: [],
      segments: [centerlineSegment('Head~24381_1002', 0, [1000, -500, 600], [1000, 500, 600])],
    });
    const tools = createPipeMeasureTools('measure_pipe_to_pipe', [
      { objectId: 'o:24381_9999:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1001:0', point: new Vector3(1, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
    ]);
    await nextTick();
    expect(tools.statusText.value).toBe('管-管间距：点第一根管道（量两条 BRAN 平行直段之间的中心距，一对平行直段一条中心距记录）');

    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距：24381_9999 不属于任何 BRAN——只能量两条 BRAN 之间的平行直段，请点管件或直管');

    await clickOnce(tools);
    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距：24381_1001 与第一根同属 BRAN 24381_1000，请点另一条 BRAN 上的管件');
    expect(genModelV1SpatialCenterline).not.toHaveBeenCalled();

    await clickOnce(tools);
    expect(genModelV1SpatialCenterline).toHaveBeenCalledTimes(2);
    expect(tools.statusText.value).toBe('管-管间距：24381_1000 ↔ 24381_2000 没有平行的直段（1 / 1 条直段，夹角容差 0.5°），上一次这一对的中心距记录已清掉');
    expect(tools.statusText.value).not.toContain('暂不创建尺寸');
    expect(useClearanceStore().records.value).toHaveLength(0);
  });

  it('管-管间距：同一对 BRAN 再测整组替换（反着点也认作同一对）', async () => {
    installTwoParallelBrans();
    const tools = createPipeMeasureTools('measure_pipe_to_pipe', [
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
      // 反着点：先 2000 的件、再 1000 的件
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
    ]);
    await nextTick();

    await clickOnce(tools);
    await clickOnce(tools);
    const first = useClearanceStore().records.value;
    expect(first).toHaveLength(1);
    const firstId = first[0]!.id;

    await clickOnce(tools);
    await clickOnce(tools);
    const second = useClearanceStore().records.value;
    // 整组替换：反着量出来的一对（方向互换 → 另一个 record id）顶替掉上一对，不叠加
    expect(second).toHaveLength(1);
    expect(second[0]!.id).not.toBe(firstId);
    expect(second[0]!.inputs).toEqual({ sourceRefno: 'Head~24381_1002', targetRefno: 'Head~24381_1001', targetKind: 'any' });
    expect(second[0]!.provenance.source.refno).toBe('24381_2000');
    expect(second[0]!.provenance.target.refno).toBe('24381_1000');
  });

  it('管-管间距：中心线接口失败只报状态，不落半成品记录', async () => {
    installTwoParallelBrans();
    genModelV1SpatialCenterline.mockRejectedValueOnce(new Error('centerline 503'));
    const tools = createPipeMeasureTools('measure_pipe_to_pipe', [
      { objectId: 'o:24381_1001:0', point: new Vector3(0, 0, 0) },
      { objectId: 'o:24381_1002:0', point: new Vector3(3, 0, 0) },
    ]);
    await nextTick();

    await clickOnce(tools);
    await clickOnce(tools);
    expect(tools.statusText.value).toBe('管-管间距计算失败：centerline 503');
    expect(useClearanceStore().records.value).toHaveLength(0);
  });

  describe('管-墙/柱净距（measure_pipe_to_structure → ClearanceRecord）', () => {
    const PIPE_REFNO = '24381_1001';
    const WALL_REFNO = '24381_5000';

    function createLayerWithWall(): DTXLayer {
      const layer = createLayerWithBoxes(3);
      layer.addGeometry('wall-geo', new BoxGeometry(0.2, 4, 4));
      layer.addObject(`o:${WALL_REFNO}:0`, 'wall-geo', new Matrix4().makeTranslation(4, 0, 0));
      return layer;
    }

    function installPipeToStructure(candidates = [
      { refno: WALL_REFNO, noun: 'WALL', distance_mm: 2000 },
    ]): void {
      objectIdsByRefno.clear();
      refnoTransformByRefno.clear();
      ownerBranByRefno.set(PIPE_REFNO, '24381_1000');
      objectIdsByRefno.set(PIPE_REFNO, [`o:${PIPE_REFNO}:0`]);
      objectIdsByRefno.set(WALL_REFNO, [`o:${WALL_REFNO}:0`]);
      genModelV1SpatialNearestClearance.mockResolvedValue({
        nearest_by_group: [{ noun: 'WALL', candidates }],
      });
    }

    it('成功路径生成 component-to-component 记录（sampled-object / approximate-sampled），不建尺寸', async () => {
      installPipeToStructure();
      const tools = createPipeMeasureTools('measure_pipe_to_structure', [
        { objectId: `o:${PIPE_REFNO}:0`, point: new Vector3(0, 0, 0) },
      ], createLayerWithWall());
      await nextTick();

      await clickOnce(tools);
      expect(genModelV1SpatialNearestClearance).toHaveBeenCalledTimes(1);
      const request = genModelV1SpatialNearestClearance.mock.calls[0]![0] as Record<string, unknown>;
      expect(request.sourceRefno).toBe('24381_1000');
      expect(request.sourceMode).toBe('bran_centerline');
      expect(request.targetNouns).toEqual(['WALL', 'COLUMN']);

      const records = useClearanceStore().records.value;
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record.kind).toBe('component-to-component');
      expect(record.inputs).toEqual({ sourceRefno: PIPE_REFNO, targetRefno: WALL_REFNO, targetKind: 'any' });
      expect(record.provenance.method).toBe('sampled-object');
      expect(record.provenance.accuracyClass).toBe('approximate-sampled');
      expect(record.provenance.warnings).toEqual([
        { code: 'mesh_sampling', message: '源侧参考点/网格采样 + 目标表面最近点，估算距离非外表面净距' },
      ]);
      expect(record.targetNoun).toBe('WALL');
      expect(record.snapshot?.targetLeafNoun).toBe('WALL');
      expect(record.snapshot?.witness).toBe('closest-points');
      expect(record.snapshot?.distanceM).toBeGreaterThan(0);
      expect(record.derivedDimensionId).toBeNull();
      expect(tools.statusText.value).toContain('估算最近距离');
      expect(tools.statusText.value).toContain('已生成净距记录');
      expect(tools.statusText.value).not.toContain('画出尺寸');
    });

    it('候选为空 / 目标未加载 / 最近点失败：不落记录', async () => {
      installPipeToStructure([]);
      const tools = createPipeMeasureTools('measure_pipe_to_structure', [
        { objectId: `o:${PIPE_REFNO}:0`, point: new Vector3(0, 0, 0) },
        { objectId: `o:${PIPE_REFNO}:0`, point: new Vector3(0, 0, 0) },
        { objectId: `o:${PIPE_REFNO}:0`, point: new Vector3(0, 0, 0) },
      ], createLayerWithWall());
      await nextTick();

      await clickOnce(tools);
      expect(tools.statusText.value).toBe('未找到可用墙/柱候选');
      expect(useClearanceStore().records.value).toHaveLength(0);

      // 候选有，但目标没加载到场景（resolveDtxObjectIdsByRefno 空）
      installPipeToStructure();
      objectIdsByRefno.delete(WALL_REFNO);
      await clickOnce(tools);
      expect(tools.statusText.value).toBe('候选对象未加载到当前场景');
      expect(useClearanceStore().records.value).toHaveLength(0);

      // 目标加载了，但 closestPointToObject 全空 → 最近点计算失败
      installPipeToStructure();
      const layerNoClosest = createLayerWithWall();
      vi.spyOn(layerNoClosest, 'closestPointToObject').mockReturnValue(null);
      const toolsNoGeom = createPipeMeasureTools('measure_pipe_to_structure', [
        { objectId: `o:${PIPE_REFNO}:0`, point: new Vector3(0, 0, 0) },
      ], layerNoClosest);
      await clickOnce(toolsNoGeom);
      expect(toolsNoGeom.statusText.value).toBe('最近点计算失败');
      expect(useClearanceStore().records.value).toHaveLength(0);
    });

    it('接口抛错只报状态，不落半成品记录', async () => {
      installPipeToStructure();
      genModelV1SpatialNearestClearance.mockRejectedValue(new Error('nearest-clearance 503'));
      const tools = createPipeMeasureTools('measure_pipe_to_structure', [
        { objectId: `o:${PIPE_REFNO}:0`, point: new Vector3(0, 0, 0) },
      ], createLayerWithWall());
      await nextTick();

      await clickOnce(tools);
      expect(tools.statusText.value).toBe('计算失败：nearest-clearance 503');
      expect(useClearanceStore().records.value).toHaveLength(0);
    });
  });

});
