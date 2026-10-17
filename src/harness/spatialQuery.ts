/**
 * Visual harness · 空间查询家族运行时视觉证据（#44 / 已迁移面板）
 *
 * 挂载真实的 SpatialQueryDrawer（完整 + 迷你两档）与 SpatialComputePanel，
 * 通过 useSpatialQuery / useSpatialCompute 模块级单例注入 mock 结果集，
 * 不发任何后端请求。挂载后用组件自带 testid 自动展开「更多条件 / 查询结果」，
 * 让 token 化的结果行、专业 chip、警告条都出现在单张截图里。
 *
 * 仅供 visual-baseline runner（端口 5195）访问 /harness/spatial-query.html 使用，
 * 不参与生产构建入口。
 */
import { createApp, defineComponent, h } from 'vue';

import { VueQueryPlugin } from '@tanstack/vue-query';

import '@/assets/tailwind.css';

import type { SpatialQueryResultItem, SpatialQueryResultSet } from '@/types/spatialQuery';

import { surfaceClearanceToRecord } from '@/clearance/services/clearanceService';
import { useClearanceStore } from '@/clearance/stores/useClearanceStore';
import SpatialComputePanel from '@/components/spatial-query/SpatialComputePanel.vue';
import SpatialQueryDrawer from '@/components/spatial-query/SpatialQueryDrawer.vue';
import { useSpatialCompute } from '@/composables/useSpatialCompute';
import { useSpatialQuery } from '@/composables/useSpatialQuery';
import { SiteSpecValue } from '@/types/spec';

// ---------------------------------------------------------------------------
// mock 结果集：2 个专业分组 × 已加载/未加载/带距离/隐藏 组合
// ---------------------------------------------------------------------------

function makeItem(partial: Partial<SpatialQueryResultItem> & { refno: string; noun: string; specValue: number }): SpatialQueryResultItem {
  return {
    specName: partial.specValue === SiteSpecValue.Pipe ? '管道系统' : '电气系统',
    distance: null,
    loaded: true,
    visible: true,
    matchedBy: 'server-spatial-index',
    sourceModel: 'AvevaMarineSample',
    name: null,
    position: { x: 12450, y: 8200, z: 3600 },
    bbox: null,
    ...partial,
  };
}

const pipeItems: SpatialQueryResultItem[] = [
  makeItem({ refno: '24381/145018', noun: 'BRAN', specValue: SiteSpecValue.Pipe, name: '主蒸汽管段 A', distance: 842, matchedBy: 'merged' }),
  makeItem({ refno: '24381/145022', noun: 'PIPE', specValue: SiteSpecValue.Pipe, name: '冷却水支管', distance: 1560, loaded: false }),
  makeItem({ refno: '24381/145025', noun: 'PIPE', specValue: SiteSpecValue.Pipe, distance: 2380, visible: false }),
];

const elecItems: SpatialQueryResultItem[] = [
  makeItem({ refno: '24381/220401', noun: 'CABLE', specValue: SiteSpecValue.Elec, name: '动力电缆桥架段', distance: 940 }),
  makeItem({ refno: '24381/220407', noun: 'EQUI', specValue: SiteSpecValue.Elec, distance: 4120, loaded: false }),
];

const allItems = [...pipeItems, ...elecItems];

const resultSet: SpatialQueryResultSet = {
  request: {
    mode: 'range',
    centerSource: 'coordinates',
    center: { x: 12450, y: 8200, z: 3600 },
    radius: 5000,
    shape: 'sphere',
    filters: {
      nouns: ['PIPE', 'EQUI', 'BRAN'],
      keyword: '',
      onlyLoaded: false,
      onlyVisible: false,
      includeNegative: false,
      specValues: [SiteSpecValue.Pipe, SiteSpecValue.Elec],
      rooms: [],
    },
    limit: 50,
    sortBy: 'specThenDistance',
  },
  items: allItems,
  filterOptions: {
    nouns: [
      { value: 'PIPE', count: 2, isNegative: false },
      { value: 'BRAN', count: 1, isNegative: false },
      { value: 'CABLE', count: 1, isNegative: false },
      { value: 'EQUI', count: 1, isNegative: false },
    ],
    specValues: [
      { value: SiteSpecValue.Pipe, count: 3, label: '管道系统' },
      { value: SiteSpecValue.Elec, count: 2, label: '电气系统' },
    ],
    includeNegative: false,
  },
  center: { x: 12450, y: 8200, z: 3600, source: 'coordinates' },
  queryBBox: null,
  serverRadius: 5000,
  serverShape: 'sphere',
  truncatedCandidates: false,
  truncatedResults: true,
  candidateCount: 187,
  candidateCap: 2000,
  resultCap: 200,
  page: 1,
  perPage: 50,
  returnedCount: allItems.length,
  totalPages: 4,
  hasMore: true,
  total: 187,
  loadedCount: 3,
  unloadedCount: 2,
  truncated: true,
  warnings: ['服务端候选 187 项超出单页上限，仅返回前 50 项，可翻页查看其余结果。'],
  groups: [
    { specValue: SiteSpecValue.Pipe, specName: '管道系统', count: pipeItems.length, items: pipeItems },
    { specValue: SiteSpecValue.Elec, specName: '电气系统', count: elecItems.length, items: elecItems },
  ],
};

// ---------------------------------------------------------------------------
// 注入模块级单例状态。
// useSpatialQuery / useSpatialCompute 内部会经 useSelectionStore 调 vue-query 的
// useQuery，必须在「装了 VueQueryPlugin 的组件 setup」里首跑，因此把 seeding
// 放进 Bootstrap 组件 setup（幂等，仅首个实例执行）。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 净距记录种子：按 2026-10-17 副本库实测的 5 组真实 surface-clearance 响应复刻
// （证据存 docs/verification/pipe-to-structure-clearance-2026-10-17/api-*.json），
// 让「已保存的构件净距」区带上墙 / 柱 / 楼板的真实 noun 与距离、面与垂距口径。
// ---------------------------------------------------------------------------

type RawResp = Parameters<typeof surfaceClearanceToRecord>[0];

function clearanceResp(target: { refno: string; noun: string }, result: RawResp['result'], targetKind: 'wall' | 'any', targetSesno = 357): RawResp {
  return {
    success: true,
    unit: 'mm',
    method: 'surface_to_surface',
    accuracy_class: 'exact-surface',
    error_bound_mm: 0.5,
    target_kind: targetKind,
    source: { refno: '24384/22726', noun: 'BRAN', leaf_count: 8, triangle_count: 1056 },
    target: { ...target, leaf_count: 24, triangle_count: 3316 },
    result,
    model: { source_sesno: 650, target_sesno: targetSesno },
    timing_ms: { load: 4, query: 0, total: 30 },
    warnings: [],
  } as unknown as RawResp;
}

const SEEDED_CLEARANCE_INPUTS = {
  sourceRefno: '24384_22726',
} as const;

let storesSeeded = false;

function seedClearanceRecords() {
  const clearance = useClearanceStore();
  const pt = (x: number, y: number, z: number) => ({ x, y, z });
  const base = { intersects: false, source_leaf_refno: '24384/22726', witness: 'closest-points' } as const;
  const seeds: { target: { refno: string; noun: string }; targetKind: 'wall' | 'any'; result: NonNullable<RawResp['result']> }[] = [
    // 实测：BRAN 24384/22726 → WALL 24381/1776 = 607.03mm（outer + ray 垂距）
    {
      target: { refno: '24381/1776', noun: 'WALL' }, targetKind: 'wall',
      result: { ...base, distance_mm: 607.0304, source_point: pt(-15591.471, 8225.277, 2200), target_point: pt(-15026.684, 8002.788, 2200), vector: { dx: 564.787, dy: -222.489, dz: 0 }, target_leaf_refno: '24381/1776', target_leaf_noun: 'WALL', target_face: { kind: 'outer', normal: { x: -0.9304102, y: 0.36651996, z: 0 }, confidence: 'geometric' }, perpendicular: { distance_mm: 607.03064, from: pt(-15591.471, 8225.277, 2200), to: pt(-15026.684, 8002.7886, 2200), method: 'ray' } },
    },
    // → STWALL 24381/1774 = 392.09mm（bottom 面，无垂距）
    {
      target: { refno: '24381/1774', noun: 'STWALL' }, targetKind: 'wall',
      result: { ...base, distance_mm: 392.08508, source_point: pt(-15596.2, 8195.5, 2200), target_point: pt(-15596.2, 8195.5, 2592.09), vector: { dx: 0, dy: 0, dz: 392.09 }, target_leaf_refno: '24381/1774', target_leaf_noun: 'STWALL', target_face: { kind: 'bottom', normal: { x: 0, y: 0, z: -1 }, confidence: 'normal-only' }, perpendicular: null },
    },
    // → PANE 24381/3014 = 169.66mm（end 面）
    {
      target: { refno: '24381/3014', noun: 'PANE' }, targetKind: 'wall',
      result: { ...base, distance_mm: 169.66101, source_point: pt(-15590.5, 8201.3, 2200), target_point: pt(-15590.5, 8370.96, 2200), vector: { dx: 0, dy: 169.66, dz: 0 }, target_leaf_refno: '24381/3014', target_leaf_noun: 'PANE', target_face: { kind: 'end', normal: { x: 0, y: -1, z: 0 }, confidence: 'normal-only' }, perpendicular: null },
    },
    // → FLOOR 17496/72729 = 587.5mm（bottom 面，target_kind=any）
    {
      target: { refno: '17496/72729', noun: 'FLOOR' }, targetKind: 'any',
      result: { ...base, distance_mm: 587.5, source_point: pt(-15611.46, 8211.995, 2212.5), target_point: pt(-15611.461, 8211.995, 2800), vector: { dx: -0.001, dy: 0, dz: 587.5 }, target_leaf_refno: '17496/72729', target_leaf_noun: 'FLOOR', target_face: { kind: 'bottom', normal: { x: 0, y: 0, z: -1 }, confidence: 'normal-only' }, perpendicular: null },
    },
    // → SCTN 24381/2306 = 5935.3mm（outer + edge 垂距：最近点在柱棱上）
    {
      target: { refno: '24381/2306', noun: 'SCTN' }, targetKind: 'any',
      result: { ...base, distance_mm: 5935.2974, source_point: pt(-15634.951, 8191.212, 2200), target_point: pt(-21547.23, 8713.424, 2199.26), vector: { dx: -5912.28, dy: 522.21, dz: -0.74 }, target_leaf_refno: '24381/2306', target_leaf_noun: 'SCTN', target_face: { kind: 'outer', normal: { x: 0.9988047, y: -0.04887981, z: 0.0001 }, confidence: 'geometric' }, perpendicular: { distance_mm: 5935.2974, from: pt(-15634.951, 8191.212, 2200), to: pt(-21547.23, 8713.424, 2199.2598), method: 'edge' } },
    },
  ];
  const now = new Date('2026-10-17T23:00:00+08:00');
  seeds.forEach(({ target, targetKind, result }) => {
    const inputs = { ...SEEDED_CLEARANCE_INPUTS, targetRefno: target.refno.replace('/', '_'), targetKind } as Parameters<typeof surfaceClearanceToRecord>[1];
    clearance.upsertRecord(surfaceClearanceToRecord(clearanceResp(target, result, targetKind), inputs, now));
  });
  clearance.showAnnotations.value = true;
}

function seedStoresOnce() {
  if (storesSeeded) return;
  storesSeeded = true;

  seedClearanceRecords();

  const sq = useSpatialQuery();
  sq.draft.mode = 'range';
  sq.draft.rangeCenterSource = 'coordinates';
  sq.draft.center.x = 12450;
  sq.draft.center.y = 8200;
  sq.draft.center.z = 3600;
  sq.draft.radius = 5000;
  sq.draft.nounText = 'PIPE,EQUI,BRAN';
  sq.draft.keyword = '';
  sq.draft.specValues = [SiteSpecValue.Pipe, SiteSpecValue.Elec];
  sq.status.value = 'ready';
  sq.error.value = null;
  sq.resultSet.value = resultSet;
  sq.activeResultRefno.value = '24381/145018';

  // 支架空间计算：计算 tab + 结果表，首行高亮
  const compute = useSpatialCompute();
  compute.setPanelMode('compute');
  const computeState = compute.currentScenarioState.value;
  computeState.suppoRefno = '24381/300112';
  computeState.resultRows = [
    { refno: '24381/145018', noun: 'BRAN', distanceMm: 84, label: '最近构件', targetGroup: 'wall', sourceSegmentRefno: '24381/145018-S1', sourceSegmentOrder: 1 },
    { refno: '24381/512207', noun: 'WALL', distanceMm: 356, label: '次近构件', targetGroup: 'wall', sourceSegmentRefno: '24381/145018-S2', sourceSegmentOrder: 2 },
    { refno: '24381/518330', noun: 'COLUMN', distanceMm: 1240, label: '参考构件', targetGroup: 'column', sourceSegmentRefno: null, sourceSegmentOrder: null },
  ];
}

// ---------------------------------------------------------------------------
// 挂载：完整模式 / 迷你模式 / 计算面板
// ---------------------------------------------------------------------------

const SqDrawerHarness = defineComponent({
  setup() {
    seedStoresOnce();
    return () => h(SpatialQueryDrawer, { open: true });
  },
});

const ComputeHarness = defineComponent({
  setup() {
    seedStoresOnce();
    return () => h(SpatialComputePanel);
  },
});

createApp(SqDrawerHarness).use(VueQueryPlugin).mount('#app-sq-full');
createApp(SqDrawerHarness).use(VueQueryPlugin).mount('#app-sq-mini');
createApp(ComputeHarness).use(VueQueryPlugin).mount('#app-compute');

// 展开「更多条件」「查询结果」，把迷你实例切到 mini 档 —— 全部用组件自带 testid
setTimeout(() => {
  const fullHost = document.querySelector('#host-sq-full');
  fullHost?.querySelector<HTMLButtonElement>('[data-testid="spatial-advanced-toggle"]')?.click();
  fullHost?.querySelector<HTMLButtonElement>('[data-testid="spatial-results-toggle"]')?.click();
  document
    .querySelector('#host-sq-mini')
    ?.querySelector<HTMLButtonElement>('[data-testid="spatial-query-mini-toggle"]')
    ?.click();
}, 200);
