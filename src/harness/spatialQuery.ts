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

let storesSeeded = false;

function seedStoresOnce() {
  if (storesSeeded) return;
  storesSeeded = true;

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
