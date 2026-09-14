import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref, shallowRef } from 'vue';

import { BoxGeometry, Matrix4, PerspectiveCamera, Vector3 } from 'three';

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({
    selectedRefno: ref<string | null>(null),
    selectedRefnos: ref<string[]>([]),
    propertiesLoading: ref(false),
    propertiesError: ref<string | null>(null),
    propertiesData: ref(null),
    fullName: ref(null),
    loadProperties: vi.fn(),
    clearSelection: vi.fn(),
    clearSelectedRefnos: vi.fn(),
    setSelectedRefno: vi.fn(),
    setSelectedRefnos: vi.fn(),
    isSelected: vi.fn(() => false),
    toggleSelectedRefno: vi.fn(),
  }),
}));

import { useAnnotationStyleStore } from './useAnnotationStyleStore';
import { resetCloudRenderFlagCache, setCloudRenderFlag } from './useCloudRenderFlags';
import { createDefaultCloudLabelLayoutV1, useDtxTools } from './useDtxTools';
import { useToolStore, type CloudAnnotationRecord } from './useToolStore';

import { DEFAULT_CLOUD_LOD_BUDGET, DEFAULT_CLOUD_LOD_SLACK } from '@/review/domain/annotationProjection/lod';
import { createRegionCloudPresentationV1, type RegionV1 } from '@/review/domain/cloudRegion';
import { DTXLayer } from '@/utils/three/dtx';

/**
 * P4 LOD 验收（2026-09-14 方案 §9.3 / §11 P4，开关 `cloudAdaptiveLod`）：
 * - ≤ 64 条：全部全轮廓，行为与 P2/P3 完全一致，零开销（不排序、不计 lodPlans）。
 * - > 64 条：只有激活 / 拖动 / 悬停 / 待编辑 + 视口中心附近的 64 条算凸包、`setPoints`、挂文字框 DOM；其余只留 DOM 图钉，
 *   轮廓 / 盒边 / 引线藏起、**没有文字框 DOM**。
 * - 运行时决策：记录 `visible` 一律不改；滞回：小幅相机摆动集合不抖；静止 120 帧零重算；悬停临时升档、移开回落；开关关全部 full。
 */

const TARGET_REFNO = '24381_145019';
const IDENTITY = new Matrix4().elements.slice();
const BUDGET = DEFAULT_CLOUD_LOD_BUDGET;
const SLACK = DEFAULT_CLOUD_LOD_SLACK;
const COUNT = BUDGET + SLACK + 10; // 90：最远的 10 条在滞回带之外

function createReadyLayer(): DTXLayer {
  const layer = new DTXLayer({ maxVertices: 4096, maxIndices: 4096, maxObjects: 16 });
  layer.addGeometry('box', new BoxGeometry(1, 1, 1));
  layer.addObject(`o:${TARGET_REFNO}:0`, 'box', new Matrix4());
  return layer;
}

function createCanvasStub(): HTMLCanvasElement {
  return {
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
    getBoundingClientRect: () => ({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLCanvasElement;
}

function createTools() {
  const store = useToolStore();
  const canvas = createCanvasStub();
  const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 1000);
  camera.position.set(0, 0, 60);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  const overlay = document.createElement('div');
  overlay.getBoundingClientRect = () => ({
    left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(overlay);

  const getAABB = vi.fn((_refnos: string[]) => [-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
  const flyTo = vi.fn();
  const tools = useDtxTools({
    dtxViewerRef: ref({
      scene: { add: vi.fn(), remove: vi.fn() },
      controls: { enabled: true, target: new Vector3(0, 0, 0) },
      camera,
      canvas,
    } as any),
    dtxLayerRef: shallowRef<DTXLayer | null>(createReadyLayer()),
    selectionRef: ref({ pickPoint: vi.fn(() => null) } as any),
    overlayContainerRef: ref(overlay),
    store,
    compatViewerRef: ref({ scene: { getAABB }, cameraFlight: { flyTo } } as any),
    requestRender: null,
  });
  tools.refreshReadyState();
  return { tools, store, canvas, overlay, camera, getAABB, flyTo };
}

/** 第 i 条云线：锚点与范围体都在 x = i - COUNT/2 的位置（沿 x 轴一排），越靠近 0 越靠视口中心 */
function anchorX(i: number): number {
  return i - COUNT / 2;
}
/** 范围体半边长：相机 z=60、fov 60° 下投影约 21 px，高于 12/18 px 的小目标图标阈值，full 档一定画轮廓 */
const HALF = 1.2;

function makeCloud(i: number): CloudAnnotationRecord {
  const x = anchorX(i);
  const region: RegionV1 = {
    version: 1,
    space: 'world',
    source: { projectKey: null, modelSnapshotId: null, globalModelMatrix: IDENTITY, coordinateFrameId: null },
    origin: 'members',
    kind: 'obb-union',
    boxes: [{ id: `o${i}`, memberRefno: TARGET_REFNO, center: [x, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], halfSize: [HALF, HALF, HALF] }],
  };
  return {
    id: `cloud-${String(i).padStart(3, '0')}`,
    objectIds: [TARGET_REFNO],
    refnos: [TARGET_REFNO],
    anchorWorldPos: [x, 0, 0],
    leaderEndWorldPos: [x + 1, 1, 0],
    selectionBbox: { min: [x - HALF, -HALF, -HALF], max: [x + HALF, HALF, HALF] },
    visible: true,
    title: `云线 ${i}`,
    description: '',
    createdAt: 1_700_000_000_000 + i,
    regionV1: region,
    presentationV1: createRegionCloudPresentationV1(),
    labelLayoutV1: createDefaultCloudLabelLayoutV1(),
  };
}

function seed(store: ReturnType<typeof useToolStore>, count: number): void {
  for (let i = 0; i < count; i++) store.addCloudAnnotation(makeCloud(i));
  // addCloudAnnotation 会把最后一条设成激活 + 待编辑；测试里显式清掉，交互态由各用例自己设
  store.activeCloudAnnotationId.value = null;
  store.pendingCloudAnnotationEditId.value = null;
}

function levelOf(tools: ReturnType<typeof createTools>['tools'], recordId: string) {
  return tools.debugCloudLod().items.find((it) => it.id === `cloud:${recordId}`)!;
}

function fullIds(tools: ReturnType<typeof createTools>['tools']): string[] {
  return tools.debugCloudLod().items.filter((it) => it.level === 'full').map((it) => it.id).sort();
}

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMemoryStorage());
  resetCloudRenderFlagCache();
  const store = useToolStore();
  store.clearAll();
  store.clearCloudTargetRefnos();
  store.setToolMode('none');
  useAnnotationStyleStore().setCloudDrawMode('screen2d');
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetCloudRenderFlagCache();
  document.body.innerHTML = '';
});

describe('cloudAdaptiveLod · 不超预算', () => {
  it('64 条：全部 full、全部挂文字框、overBudget=false、lodPlans 不计；每条都走范围体管线', () => {
    const { tools, store, overlay } = createTools();
    seed(store, BUDGET);
    tools.syncFromStore();
    tools.resetCloudRenderStats();
    tools.updateOverlayPositions();

    const lod = tools.debugCloudLod();
    expect(lod).toMatchObject({ budget: BUDGET, slack: SLACK, overBudget: false, fullCount: BUDGET, pinCount: 0 });
    expect(lod.items.every((it) => it.level === 'full' && it.applied === 'full' && it.labelMounted)).toBe(true);
    expect(overlay.querySelectorAll('.dtx-anno-label')).toHaveLength(BUDGET);
    expect(tools.debugCloudRenderStats().lodPlans).toBe(0);
    expect(tools.debugCloudRegionRender().filter((r) => r.regionState !== null)).toHaveLength(BUDGET);
  });
});

describe('cloudAdaptiveLod · 超预算', () => {
  it('90 条：视口中心最近的 64 条 full（算凸包 / setPoints / 挂文字框），其余 26 条 pin（只剩图钉、无文字 DOM、不解析 AABB）；记录 visible 不改', () => {
    const { tools, store, overlay, getAABB } = createTools();
    seed(store, COUNT);
    // syncFromStore 末尾就跑一帧（文字框在那一帧按计划挂载）；计数从它之前起算
    tools.resetCloudRenderStats();
    tools.syncFromStore();

    const lod = tools.debugCloudLod();
    expect(lod).toMatchObject({ overBudget: true, fullCount: BUDGET, pinCount: COUNT - BUDGET });
    // 沿 x 排开的锚点：|x| 最小的 64 条 full；最远的两端 pin
    const fulls = fullIds(tools);
    expect(fulls).toHaveLength(BUDGET);
    const sortedByCenter = [...Array(COUNT).keys()].sort((a, b) => Math.abs(anchorX(a)) - Math.abs(anchorX(b)) || a - b);
    const expectedFull = sortedByCenter.slice(0, BUDGET).map((i) => `cloud:cloud-${String(i).padStart(3, '0')}`).sort();
    expect(fulls).toEqual(expectedFull);
    expect(levelOf(tools, 'cloud-000').level).toBe('pin');
    expect(levelOf(tools, `cloud-${String(COUNT - 1).padStart(3, '0')}`).level).toBe('pin');

    // full 档：轮廓可见、文字框挂着；pin 档：轮廓 / 盒边 / 引线藏、没有文字框
    const region = new Map(tools.debugCloudRegionRender().map((r) => [r.id, r]));
    const labels = new Map(tools.debugCloudLabelLayouts().map((l) => [l.id, l]));
    for (const it of lod.items) {
      const r = region.get(it.id)!;
      const l = labels.get(it.id)!;
      if (it.level === 'full') {
        expect(r.regionState, it.id).toBe('complete');
        expect(r.outlineVisible, it.id).toBe(true);
        expect(it.labelMounted, it.id).toBe(true);
        expect(l.layoutMode, it.id).toBe('v1');
      } else {
        expect(r.outlineVisible, it.id).toBe(false);
        expect(r.bboxEdgesVisible, it.id).toBe(false);
        expect(it.labelMounted, it.id).toBe(false);
        expect(l.leaderVisible, it.id).toBe(false);
        expect(l.frame, it.id).toBeNull();
      }
    }
    expect(overlay.querySelectorAll('.dtx-anno-label')).toHaveLength(BUDGET);
    // 图钉一条一枚，pin 档也在
    expect(overlay.querySelectorAll('.dtx-anno-marker')).toHaveLength(COUNT);

    // 只有 64 条做了轮廓构建 / setPoints；pin 档连目标 AABB 都不解析（范围体记录本来也不解析）
    const stats = tools.debugCloudRenderStats();
    expect(stats.frames).toBe(1);
    expect(stats.contourBuilds).toBe(BUDGET);
    expect(stats.setPoints).toBe(BUDGET);
    expect(stats.labelLayouts).toBe(BUDGET);
    expect(stats.lodPlans).toBe(1);
    expect(getAABB).not.toHaveBeenCalled();

    // LOD 是运行时决策：记录一律没被改成 visible=false
    expect(store.cloudAnnotations.value.every((c) => c.visible)).toBe(true);
  });

  it('激活 / 待编辑 / 悬停的云线固定 full，即便在最远端；悬停移开后按预算回落（滞回带外）', () => {
    const { tools, store } = createTools();
    seed(store, COUNT);
    const farId = 'cloud-000';
    const farId2 = `cloud-${String(COUNT - 1).padStart(3, '0')}`;
    store.activeCloudAnnotationId.value = farId;
    tools.syncFromStore();
    tools.updateOverlayPositions();

    expect(levelOf(tools, farId)).toMatchObject({ level: 'full', pinnedHigh: true, labelMounted: true });
    // 固定高档占预算：普通 full 只剩 63 条
    expect(tools.debugCloudLod().fullCount).toBe(BUDGET);

    // 悬停最远的另一端
    tools.setHoveredCloudAnnotation(farId2);
    expect(tools.debugCloudLod().hoveredId).toBe(farId2);
    expect(levelOf(tools, farId2)).toMatchObject({ level: 'full', applied: 'full', pinnedHigh: true, labelMounted: true });
    expect(tools.debugCloudRegionRender().find((r) => r.id === `cloud:${farId2}`)!.outlineVisible).toBe(true);

    // 移开：它排在滞回带之外（rank ≥ 64 + 16）→ 回到 pin，文字框卸掉
    tools.setHoveredCloudAnnotation(null);
    expect(levelOf(tools, farId2)).toMatchObject({ level: 'pin', applied: 'pin', pinnedHigh: false, labelMounted: false });
    expect(tools.debugCloudRegionRender().find((r) => r.id === `cloud:${farId2}`)!.outlineVisible).toBe(false);
    // 激活的那条不受影响
    expect(levelOf(tools, farId).level).toBe('full');

    // 待编辑同样固定高档
    store.activeCloudAnnotationId.value = null;
    store.pendingCloudAnnotationEditId.value = farId2;
    tools.updateOverlayPositions();
    expect(levelOf(tools, farId2)).toMatchObject({ level: 'full', pinnedHigh: true });
  });

  it('滞回：相机小幅摆动，已 full 的不掉档、边界条目不来回抖（集合只单调补进、总数 ≤ 预算 + 滞回）；大幅移动集合才换', () => {
    const { tools, store, camera } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const before = fullIds(tools);
    expect(before).toHaveLength(BUDGET);

    const lookFrom = (x: number) => {
      camera.position.x = x;
      camera.lookAt(x, 0, 0);
      camera.updateMatrixWorld(true);
      tools.updateOverlayPositions();
    };

    // 视口中心向 +x 挪半个锚点间距：边界上 x=32 排进预算 → 升档；原边界 x=-32 掉到 rank 64 仍在滞回带内 → 不降
    lookFrom(0.5);
    expect(tools.debugCloudRenderStats().lodPlans).toBeGreaterThan(0);
    const shifted = fullIds(tools);
    for (const id of before) expect(shifted, `${id} 不该掉档`).toContain(id);
    expect(shifted.length - before.length).toBeLessThanOrEqual(1);

    // 来回摆动若干次：集合不再变化（没有条目在 full / pin 间抖）
    for (const x of [0, 0.5, 0, 0.5, 0]) {
      lookFrom(x);
      expect(fullIds(tools), `x=${x}`).toEqual(shifted);
    }
    expect(shifted.length).toBeLessThanOrEqual(BUDGET + SLACK);

    // 大幅移动到 +x 端：集合换掉，负端最远的降为 pin，正端补进来
    lookFrom(30);
    const after = fullIds(tools);
    expect(after).not.toEqual(shifted);
    expect(after.length).toBeLessThanOrEqual(BUDGET + SLACK);
    expect(levelOf(tools, 'cloud-000').level).toBe('pin');
    expect(levelOf(tools, `cloud-${String(COUNT - 1).padStart(3, '0')}`).level).toBe('full');
    // 升回 full 的条目重新挂了文字框、轮廓重建
    expect(levelOf(tools, `cloud-${String(COUNT - 1).padStart(3, '0')}`).labelMounted).toBe(true);
    expect(tools.debugCloudRegionRender().find((r) => r.id === `cloud:cloud-${String(COUNT - 1).padStart(3, '0')}`)!.regionState).toBe('complete');
  });

  it('静止 120 帧：LOD 不重算、轮廓不重建；pin 档不产生任何构建计数', () => {
    const { tools, store } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    tools.resetCloudRenderStats();
    for (let i = 0; i < 120; i++) tools.updateOverlayPositions();
    expect(tools.debugCloudRenderStats()).toEqual({ frames: 120, contourBuilds: 0, setPoints: 0, labelLayouts: 0, paintUpdates: 0, lodPlans: 0 });
  });

  it('syncFromStore 重建后滞回记忆保留：同一机位重建，集合与重建前一致；删掉的记录不占名额', () => {
    const { tools, store } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const before = fullIds(tools);

    tools.syncFromStore();
    tools.updateOverlayPositions();
    expect(fullIds(tools)).toEqual(before);

    // 删掉 30 条：剩 60 ≤ 预算 → 全部 full，overBudget=false
    for (let i = 0; i < 30; i++) store.removeCloudAnnotation(`cloud-${String(i).padStart(3, '0')}`);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const lod = tools.debugCloudLod();
    expect(lod.overBudget).toBe(false);
    expect(lod.items).toHaveLength(COUNT - 30);
    expect(lod.items.every((it) => it.level === 'full' && it.labelMounted)).toBe(true);
  });

  it('旧记录（legacy-v0）同样受 LOD 约束：pin 档不解析目标 AABB、不建轮廓；full 档照旧按世界点布局文字框 + 引线', () => {
    const { tools, store, overlay, getAABB } = createTools();
    for (let i = 0; i < COUNT; i++) {
      store.addCloudAnnotation({ ...makeCloud(i), regionV1: undefined, presentationV1: undefined, labelLayoutV1: undefined });
    }
    store.activeCloudAnnotationId.value = null;
    store.pendingCloudAnnotationEditId.value = null;
    tools.resetCloudRenderStats();
    tools.syncFromStore();

    const lod = tools.debugCloudLod();
    expect(lod).toMatchObject({ overBudget: true, fullCount: BUDGET, pinCount: COUNT - BUDGET });
    // 旧管线每条 full 解析一次目标 AABB（TTL 缓存内不重查）；pin 档一次都不查
    expect(getAABB).toHaveBeenCalledTimes(BUDGET);
    expect(tools.debugCloudRenderStats().contourBuilds).toBe(BUDGET);
    expect(overlay.querySelectorAll('.dtx-anno-label')).toHaveLength(BUDGET);
    const labels = new Map(tools.debugCloudLabelLayouts().map((l) => [l.id, l]));
    for (const it of lod.items) {
      const l = labels.get(it.id)!;
      if (it.level === 'full') {
        expect(l.layoutMode, it.id).toBe('legacy');
        expect(l.leaderVisible, it.id).toBe(true);
        expect(l.labelLeft, it.id).not.toBe('');
      } else {
        expect(l.leaderVisible, it.id).toBe(false);
        expect(it.labelMounted, it.id).toBe(false);
      }
    }
    // 旧记录的漏斗字段照常补齐，visible 不改
    expect(store.cloudAnnotations.value.every((c) => c.visible && c.presentationV1?.algorithm === 'legacy-v0')).toBe(true);
  });

  it('关掉 cloudAdaptiveLod：90 条全部 full，全部挂文字框，也没有聚合', () => {
    setCloudRenderFlag('cloudAdaptiveLod', false);
    const { tools, store, overlay } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();
    tools.updateOverlayPositions();
    const lod = tools.debugCloudLod();
    expect(lod.overBudget).toBe(false);
    expect(lod.items.every((it) => it.level === 'full' && it.labelMounted)).toBe(true);
    expect(overlay.querySelectorAll('.dtx-anno-label')).toHaveLength(COUNT);
    // 90 条全走范围体管线并画出轮廓（两端贴着视口边的可能是 viewport-cut）
    expect(tools.debugCloudRegionRender().every((r) => (r.regionState === 'complete' || r.regionState === 'viewport-cut') && r.outlineVisible)).toBe(true);
    // 没有 LOD 就没有聚合
    expect(tools.debugCloudClusters()).toEqual({ clusters: [], hiddenMarkerIds: [], badgeSeedIds: [], popoverSeedId: null });
    expect(overlay.querySelectorAll('.dtx-anno-cluster')).toHaveLength(0);
  });
});

describe('cloudAdaptiveLod · pin 档图钉的屏幕聚合', () => {
  function pinIds(tools: ReturnType<typeof createTools>['tools']): string[] {
    return tools.debugCloudLod().items.filter((it) => it.level === 'pin').map((it) => it.id).sort();
  }

  it('90 条：两端 pin 档图钉（相邻约 8.7 px）合成带计数的聚合徽标，被合并的图钉藏起、full 档与未合并的图钉照常；记录 visible 不改', () => {
    const { tools, store, overlay } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();

    const pins = pinIds(tools);
    expect(pins).toHaveLength(COUNT - BUDGET);
    const snap = tools.debugCloudClusters();
    expect(snap.clusters.length).toBeGreaterThanOrEqual(2);
    let merged = 0;
    for (const cluster of snap.clusters) {
      expect(cluster.memberIds.length).toBeGreaterThanOrEqual(2);
      // 成员只能是 pin 档；种子是成员之一
      for (const id of cluster.memberIds) expect(pins, id).toContain(id);
      expect(cluster.memberIds).toContain(cluster.seedId);
      merged += cluster.memberIds.length;
      // 徽标 DOM：计数 = 成员数，位置在成员质心
      const badge = overlay.querySelector(`.dtx-anno-cluster[data-cluster-seed="${cluster.seedId}"]`) as HTMLElement;
      expect(badge, cluster.seedId).not.toBeNull();
      expect(badge.textContent).toBe(String(cluster.memberIds.length));
      expect(parseFloat(badge.style.left)).toBeCloseTo(cluster.x, 3);
      expect(parseFloat(badge.style.top)).toBeCloseTo(cluster.y, 3);
      expect(badge.title).toContain(`${cluster.memberIds.length} 条云线批注`);
    }
    expect(snap.hiddenMarkerIds).toHaveLength(merged);
    expect(snap.badgeSeedIds).toEqual(snap.clusters.map((c) => c.seedId).sort());
    expect(overlay.querySelectorAll('.dtx-anno-cluster')).toHaveLength(snap.clusters.length);

    // 被合并的图钉 display:none；其它（full 档 + 没合并的 pin）都还在
    const markerEls = [...overlay.querySelectorAll<HTMLElement>('.dtx-anno-marker')];
    expect(markerEls).toHaveLength(COUNT);
    const hidden = markerEls.filter((el) => el.style.display === 'none');
    expect(hidden).toHaveLength(merged);
    const fullIdsSet = new Set(tools.debugCloudLod().items.filter((it) => it.level === 'full').map((it) => it.id));
    // 藏起来的必须全是 pin 档
    for (const id of snap.hiddenMarkerIds) expect(fullIdsSet.has(id), id).toBe(false);

    // 聚合不改业务数量
    expect(store.cloudAnnotations.value).toHaveLength(COUNT);
    expect(store.cloudAnnotations.value.every((c) => c.visible)).toBe(true);
  });

  it('点徽标弹出成员列表；点一行 = 选中那条（升 full、文字框补回、退出聚合）；「放大到这些」飞到全部成员的合并范围；再点徽标 / 点外面 / Esc 关掉', () => {
    const { tools, store, overlay, flyTo } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();
    const cluster = tools.debugCloudClusters().clusters[0]!;
    const badge = overlay.querySelector(`.dtx-anno-cluster[data-cluster-seed="${cluster.seedId}"]`) as HTMLElement;

    badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tools.debugCloudClusters().popoverSeedId).toBe(cluster.seedId);
    const popover = overlay.querySelector('.dtx-anno-cluster-popover') as HTMLElement;
    expect(popover).not.toBeNull();
    expect(popover.textContent).toContain(`${cluster.memberIds.length} 条云线批注`);
    const rows = [...popover.querySelectorAll<HTMLElement>('[data-role="cluster-member"]')];
    expect(rows.map((r) => `cloud:${r.dataset.annotationId}`)).toEqual(cluster.memberIds);
    expect(rows[0]!.textContent).toBe(store.cloudAnnotations.value.find((c) => `cloud:${c.id}` === cluster.memberIds[0])!.title);

    // 再点徽标：收起
    badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(tools.debugCloudClusters().popoverSeedId).toBeNull();
    expect(overlay.querySelectorAll('.dtx-anno-cluster-popover')).toHaveLength(0);

    // 放大：相机飞到成员锚点 ∪ 快照 AABB 的合并范围
    tools.openClusterPopover(cluster.seedId);
    (overlay.querySelector('[data-role="cluster-zoom"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(flyTo).toHaveBeenCalledTimes(1);
    const { aabb } = flyTo.mock.calls[0]![0] as { aabb: number[] };
    const xs = cluster.memberIds.map((id) => store.cloudAnnotations.value.find((c) => `cloud:${c.id}` === id)!.anchorWorldPos[0]);
    expect(aabb[0]).toBeLessThanOrEqual(Math.min(...xs) - HALF + 1e-9);
    expect(aabb[3]).toBeGreaterThanOrEqual(Math.max(...xs) + HALF - 1e-9);
    expect(tools.debugCloudClusters().popoverSeedId).toBeNull();

    // 点外面关掉
    tools.openClusterPopover(cluster.seedId);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(tools.debugCloudClusters().popoverSeedId).toBeNull();
    // Esc 关掉
    tools.openClusterPopover(cluster.seedId);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tools.debugCloudClusters().popoverSeedId).toBeNull();

    // 点一行：选中那条 → 激活即固定高档；store 变化经 watch 重建（这里手动 sync 模拟）
    tools.openClusterPopover(cluster.seedId);
    const pickedId = cluster.memberIds[1]!.replace(/^cloud:/, '');
    const row = overlay.querySelector(`[data-role="cluster-member"][data-annotation-id="${pickedId}"]`) as HTMLElement;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(store.activeCloudAnnotationId.value).toBe(pickedId);
    expect(tools.debugCloudClusters().popoverSeedId).toBeNull();
    tools.syncFromStore();
    expect(levelOf(tools, pickedId)).toMatchObject({ level: 'full', pinnedHigh: true, labelMounted: true });
    const after = tools.debugCloudClusters();
    expect(after.hiddenMarkerIds).not.toContain(`cloud:${pickedId}`);
    // 它所在的簇少了一名成员（或散掉）
    const sameSeed = after.clusters.find((c) => c.seedId === cluster.seedId);
    expect(sameSeed?.memberIds ?? []).not.toContain(`cloud:${pickedId}`);
    // 图钉只藏被合并的：藏起的数量 = 各簇成员之和
    const hiddenEls = [...overlay.querySelectorAll<HTMLElement>('.dtx-anno-marker')].filter((el) => el.style.display === 'none');
    expect(hiddenEls).toHaveLength(after.clusters.reduce((n, c) => n + c.memberIds.length, 0));
  });

  it('簇身份跨帧稳定：相机小幅摆动种子不换；syncFromStore 重建后徽标照旧；删到 ≤ 预算后徽标全拆、图钉全放回', () => {
    const { tools, store, overlay, camera } = createTools();
    seed(store, COUNT);
    tools.syncFromStore();
    const seeds = tools.debugCloudClusters().badgeSeedIds;
    expect(seeds.length).toBeGreaterThan(0);
    const fullBefore = fullIds(tools);

    // 向 -x 挪 0.3：LOD 集合不变（边界 tie 仍由 id 定给 x=-32），图钉整体平移约 2.6 px → 簇与种子都不换
    camera.position.x = -0.3;
    camera.lookAt(-0.3, 0, 0);
    camera.updateMatrixWorld(true);
    tools.updateOverlayPositions();
    expect(fullIds(tools)).toEqual(fullBefore);
    expect(tools.debugCloudClusters().badgeSeedIds).toEqual(seeds);

    tools.syncFromStore();
    expect(tools.debugCloudClusters().badgeSeedIds).toEqual(seeds);
    expect(overlay.querySelectorAll('.dtx-anno-cluster')).toHaveLength(seeds.length);

    for (let i = 0; i < 30; i++) store.removeCloudAnnotation(`cloud-${String(i).padStart(3, '0')}`);
    tools.syncFromStore();
    expect(tools.debugCloudLod().overBudget).toBe(false);
    expect(tools.debugCloudClusters()).toEqual({ clusters: [], hiddenMarkerIds: [], badgeSeedIds: [], popoverSeedId: null });
    expect(overlay.querySelectorAll('.dtx-anno-cluster')).toHaveLength(0);
    expect([...overlay.querySelectorAll<HTMLElement>('.dtx-anno-marker')].every((el) => el.style.display !== 'none')).toBe(true);
  });
});
