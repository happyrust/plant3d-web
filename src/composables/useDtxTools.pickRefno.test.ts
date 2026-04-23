import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

import { Vector3 } from 'three';

import {
  computeCloudLayout,
  createRectAnnotationRecordFromObb,
  buildCloudBillboardPolyline,
  isDtxInteractionReady,
  resolvePickedRefnoForFilter,
  resolveTextAnnotationMarkerClickAction,
  useDtxTools,
} from './useDtxTools';
import { useToolStore } from './useToolStore';

import type { Obb } from './useToolStore';

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: ref<string | null>(null),
    selectedRefnos: ref<string[]>([]),
    propertiesLoading: ref(false),
    propertiesError: ref(null),
    propertiesData: ref(null),
    fullName: ref(null),
    loadProperties: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedRefno: vi.fn(),
    setSelectedRefnos: vi.fn(),
  }),
}));

describe('resolvePickedRefnoForFilter', () => {
  beforeEach(() => {
    // no-op: pure function tests only
  });

  it('点到 TUBI 且 noun 缺失时，仍尝试回溯 owner BRAN', () => {
    const findNoun = () => null;
    const findOwner = (refno: string) => refno === 'tubi_1' ? 'bran_1' : null;

    expect(resolvePickedRefnoForFilter('tubi_1', ['BRAN'], findNoun, findOwner)).toBe('bran_1');
  });

  it('owner refno 可解析但 owner noun 缺失时，仍应通过 BRAN 过滤', () => {
    const findNoun = (refno: string) => refno === 'tubi_3' ? 'TUBI' : null;
    const findOwner = (refno: string) => refno === 'tubi_3' ? 'bran_4' : null;

    expect(resolvePickedRefnoForFilter('tubi_3', ['BRAN'], findNoun, findOwner)).toBe('bran_4');
  });

  it('点到 TUBI 且无法回溯 owner BRAN 时，返回 null', () => {
    const findNoun = () => null;
    const findOwner = () => null;

    expect(resolvePickedRefnoForFilter('tubi_2', ['BRAN'], findNoun, findOwner)).toBeNull();
  });

  it('直接点到 BRAN 时，应保留当前 refno', () => {
    const findNoun = (refno: string) => refno === 'bran_3' ? 'BRAN' : null;
    const findOwner = () => 'bran_should_not_be_used';

    expect(resolvePickedRefnoForFilter('bran_3', ['BRAN'], findNoun, findOwner)).toBe('bran_3');
  });
});

describe('createRectAnnotationRecordFromObb', () => {
  it('creates an OBB-backed rectangle annotation anchored at the OBB center', () => {
    const obb: Obb = {
      center: [5, 6, 7],
      axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      halfSize: [2, 3, 4],
      corners: [
        [3, 3, 3], [7, 3, 3], [7, 9, 3], [3, 9, 3],
        [3, 3, 11], [7, 3, 11], [7, 9, 11], [3, 9, 11],
      ],
    };

    const record = createRectAnnotationRecordFromObb({
      id: 'rect-1',
      objectIds: ['bran_1'],
      refnos: ['bran_1'],
      obb,
      title: '矩形批注 1',
      description: 'demo',
      createdAt: 123,
    });

    expect(record.objectIds).toEqual(['bran_1']);
    expect(record.refnos).toEqual(['bran_1']);
    expect(record.obb).toEqual(obb);
    expect(record.anchorWorldPos).toEqual([5, 6, 7]);
    expect(record.leaderEndWorldPos?.[0]).toBeCloseTo(8.500357124637429);
    expect(record.leaderEndWorldPos?.[1]).toBeCloseTo(9.500357124637429);
    expect(record.leaderEndWorldPos?.[2]).toBeCloseTo(9.423324163210527);
    expect(record.visible).toBe(true);
    expect(record.title).toBe('矩形批注 1');
  });
});

describe('computeCloudLayout', () => {
  it('keeps cloud size fixed in screen space and positions label off the cloud body', () => {
    const layout = computeCloudLayout(
      { x: 100, y: 80, visible: true, ndcZ: 0.2 },
      { x: 40, y: -10 },
      { width: 120, height: 60 },
    );

    expect(layout.markerX).toBe(140);
    expect(layout.markerY).toBe(70);
    expect(layout.cloudCenterX).toBe(140);
    expect(layout.cloudCenterY).toBe(70);
    expect(layout.labelX).toBe(218);
    expect(layout.labelY).toBe(70);
    expect(layout.labelAlign).toBe('left');
    expect(layout.cloudPath).toContain('M');
    expect(layout.cloudPath).toContain('Z');
    expect(layout.cloudPath).toContain('L');
  });

  it('falls back to a stable default offset and clamps oversized marquee dimensions', () => {
    const layout = computeCloudLayout(
      { x: 160, y: 90, visible: true, ndcZ: 0.3 },
      undefined,
      { width: 400, height: 12 },
    );

    expect(layout.markerX).toBe(296);
    expect(layout.markerY).toBe(48);
    expect(layout.cloudCenterX).toBe(296);
    expect(layout.cloudCenterY).toBe(48);
    expect(layout.labelX).toBe(424);
    expect(layout.labelY).toBe(48);
    expect(layout.labelAlign).toBe('left');
    expect(layout.cloudPath).toContain('L');
    expect(layout.cloudPath).toContain('Z');
  });

  it('supports left-side labels when the cloud is offset left of the anchor', () => {
    const layout = computeCloudLayout(
      { x: 200, y: 120, visible: true, ndcZ: 0.1 },
      { x: -50, y: 20 },
      { width: 100, height: 50 },
    );

    expect(layout.labelAlign).toBe('right');
    expect(layout.cloudCenterX).toBe(150);
    expect(layout.cloudCenterY).toBe(140);
    expect(layout.labelX).toBe(82);
    expect(layout.labelY).toBe(140);
  });

  it('buildCloudBillboardPolyline produces a closed rect-like wavy polygon', () => {
    const anchor = new Vector3(0, 0, 0);
    const right = new Vector3(1, 0, 0);
    const up = new Vector3(0, 1, 0);
    const points = buildCloudBillboardPolyline(anchor, right, up, 120, 60, 16);

    expect(points.length).toBe((16 * 4 + 2) * 3);
    expect(points.length % 3).toBe(0);

    const first = [points[0], points[1], points[2]];
    const last = [points[points.length - 3], points[points.length - 2], points[points.length - 1]];
    expect(last[0]).toBeCloseTo(first[0]);
    expect(last[1]).toBeCloseTo(first[1]);
    expect(last[2]).toBeCloseTo(first[2]);

    const xs = points.filter((_, index) => index % 3 === 0);
    const ys = points.filter((_, index) => index % 3 === 1);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    expect(minX).toBeLessThan(-58);
    expect(maxX).toBeGreaterThan(58);
    expect(minY).toBeLessThan(-28);
    expect(maxY).toBeGreaterThan(28);
    expect(maxX - minX).toBeGreaterThan(120);
    expect(maxY - minY).toBeGreaterThan(60);
  });

  it('buildCloudBillboardPolyline applies minimum rectangle size protection in fallback scenarios', () => {
    const anchor = new Vector3(0, 0, 0);
    const right = new Vector3(1, 0, 0);
    const up = new Vector3(0, 1, 0);
    const points = buildCloudBillboardPolyline(anchor, right, up, 1, 1, 16);

    const xs = points.filter((_, index) => index % 3 === 0);
    const ys = points.filter((_, index) => index % 3 === 1);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);

    expect(spanX).toBeGreaterThanOrEqual(12);
    expect(spanY).toBeGreaterThanOrEqual(12);
  });

  it('createCloudPath produces a wave rectangle cloud SVG path in screen space', () => {
    const layout = computeCloudLayout(
      { x: 100, y: 80, visible: true, ndcZ: 0.2 },
      { x: 40, y: -10 },
      { width: 120, height: 60 },
    );

    const tokens = layout.cloudPath
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    expect(tokens[0]).toBe('M');
    expect(tokens[tokens.length - 1]).toBe('Z');
    expect(tokens.filter((t) => t === 'L').length).toBeGreaterThan(60);
    expect(tokens.some((token) => token.includes('.'))).toBe(true);
  });
});

describe('resolveTextAnnotationMarkerClickAction', () => {
  it('已最小化的文字批注水滴图钉，单击后应恢复展开并保持选中', () => {
    const result = resolveTextAnnotationMarkerClickAction(
      null,
      'anno-1',
      1000,
      true,
    );

    expect(result.activate).toBe(true);
    expect(result.nextCollapsed).toBe(false);
    expect(result.nextState).toBeNull();
  });
});

describe('isDtxInteractionReady', () => {
  it('当统计信息里 totalObjects 已大于 0 时，即使 compiled 仍为 false 也应允许交互', () => {
    const layer = {
      objectCount: 0,
      getVisibleObjectIds: () => [],
      getStats: () => ({
        totalVertices: 1024,
        totalIndices: 2048,
        totalObjects: 12,
        uniqueGeometries: 4,
        uniqueMaterials: 2,
        compiled: false,
      }),
    };

    expect(isDtxInteractionReady(layer as any)).toBe(true);
  });

  it('当对象已注册但 compiled 仍为 false 时，仍应允许交互工具进入 ready', () => {
    const layer = {
      objectCount: 3,
      getVisibleObjectIds: () => ['o:demo:0'],
      getStats: () => ({
        totalVertices: 0,
        totalIndices: 0,
        totalObjects: 0,
        uniqueGeometries: 1,
        uniqueMaterials: 1,
        compiled: false,
      }),
    };

    expect(isDtxInteractionReady(layer as any)).toBe(true);
  });

  it('当既未编译也没有任何对象时，应保持 not ready', () => {
    const layer = {
      objectCount: 0,
      getVisibleObjectIds: () => [],
      getStats: () => ({
        totalVertices: 0,
        totalIndices: 0,
        totalObjects: 0,
        uniqueGeometries: 0,
        uniqueMaterials: 0,
        compiled: false,
      }),
    };

    expect(isDtxInteractionReady(layer as any)).toBe(false);
  });
});

describe('useDtxTools.ready', () => {
  it('当 DTXLayer 只发生内部统计变化时，需要显式刷新 ready 状态', async () => {
    const layerState = {
      compiled: false,
      totalObjects: 0,
      objectCount: 0,
      visibleObjectIds: [] as string[],
    };
    const layer = {
      get objectCount() {
        return layerState.objectCount;
      },
      getVisibleObjectIds: () => layerState.visibleObjectIds,
      getStats: () => ({
        totalVertices: 0,
        totalIndices: 0,
        totalObjects: layerState.totalObjects,
        uniqueGeometries: 0,
        uniqueMaterials: 0,
        compiled: layerState.compiled,
      }),
    };
    const store = useToolStore();
    store.clearAll();

    const tools = useDtxTools({
      dtxViewerRef: ref(null),
      dtxLayerRef: ref(layer as any),
      selectionRef: ref(null),
      overlayContainerRef: ref(null),
      store,
      compatViewerRef: ref(null),
      requestRender: null,
    });

    expect(tools.ready.value).toBe(false);

    layerState.totalObjects = 8;
    layerState.objectCount = 8;
    layerState.visibleObjectIds = ['o:7997_demo:0'];

    await nextTick();
    expect(tools.ready.value).toBe(false);

    tools.refreshReadyState();
    await nextTick();

    expect(tools.ready.value).toBe(true);
  });
});
