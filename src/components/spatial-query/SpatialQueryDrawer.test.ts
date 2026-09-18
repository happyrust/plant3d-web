import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, ref, type Ref } from 'vue';

import SpatialQueryDrawer from './SpatialQueryDrawer.vue';

import type {
  SpatialQueryCapabilities,
  SpatialQueryDraft,
  SpatialQueryResultItem,
  SpatialQueryResultSet,
  SpatialQueryStatus,
} from '@/types/spatialQuery';

type DraftState = SpatialQueryDraft;

const applyCurrentSelection = vi.fn();
const startPickCenter = vi.fn();
const submitQuery = vi.fn();
/** 翻页 / 改排序：沿用上一次结果的请求重查，不重解中心 */
const requeryResults = vi.fn();
const clearResults = vi.fn();
const activateResult = vi.fn();
const countLoadTargets = vi.fn((_options?: unknown) => 0);
const loadResults = vi.fn();
const showOnlySpecGroup = vi.fn();
/** 全局确认框（`useConfirmDialogStore().open`）：缺省点「确认」 */
const confirmOpen = vi.fn(async (_options: { title?: string; message: string; confirmText?: string }) => true);
const showOnlyDbnumGroup = vi.fn();
const toggleResultVisible = vi.fn();
const setAllResultsVisible = vi.fn();
const isolateResults = vi.fn();
const restoreScene = vi.fn();
const setMode = vi.fn((mode: SpatialQueryDraft['mode']) => {
  stubState.draft.mode = mode;
});

const stubState = {
  draft: reactive<DraftState>({
    mode: 'distance',
    rangeCenterSource: 'selected',
    distanceCenterSource: 'refno',
    refno: '',
    center: { x: 0, y: 0, z: 0 },
    radius: 1000,
    shape: 'sphere',
    nounText: '',
    keyword: '',
    onlyLoaded: false,
    onlyVisible: false,
    includeNegative: false,
    specValues: [],
    limit: 200,
    sortBy: 'distanceAsc',
  }) as DraftState,
  status: ref<SpatialQueryStatus>('idle') as Ref<SpatialQueryStatus>,
  error: ref<string | null>(null) as Ref<string | null>,
  resultSet: ref<SpatialQueryResultSet | null>(null) as Ref<SpatialQueryResultSet | null>,
  activeResultRefno: ref<string | null>(null) as Ref<string | null>,
  /** 「当前选中」没盒时待服务端解中心的 refno */
  selectedCenterRefno: ref<string | null>(null) as Ref<string | null>,
  canSubmit: ref(true) as Ref<boolean>,
  /** legacy 源有专业维度；gen-model-v1 的用例把它翻成 false */
  spatialCapabilities: ref<SpatialQueryCapabilities>({ specValues: true, branCenterline: true }) as Ref<SpatialQueryCapabilities>,
};

vi.mock('@/composables/useSpatialQuery', () => ({
  useSpatialQuery: () => ({
    ...stubState,
    setMode,
    applyCurrentSelection,
    startPickCenter,
    submitQuery,
    requeryResults,
    clearResults,
    activateResult,
    countLoadTargets,
    loadResults,
    showOnlySpecGroup,
    showOnlyDbnumGroup,
    toggleResultVisible,
    setAllResultsVisible,
    isolateResults,
    restoreScene,
  }),
}));

vi.mock('@/composables/useConfirmDialogStore', () => ({
  useConfirmDialogStore: () => ({
    open: (options: { title?: string; message: string; confirmText?: string }) => confirmOpen(options),
  }),
}));

/** 让 `confirmDialog.open(...).then(run)` 那条链跑完（mock 的 async 函数要几拍微任务）。 */
const flushMicrotasks = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

/** 房间列表的两条取数：归属解析（每个条目一发）与房间属性（每个房间一发） */
const roomMocks = vi.hoisted(() => ({
  resolveContainingRoomInfo: vi.fn(async (_refno: string, _options?: { includeAttrs?: boolean }): Promise<unknown> => null),
  pdmsGetUiAttr: vi.fn(async (refno: string) => ({ success: true, refno, attrs: { TYPE: 'ROOM', NAME: `房间 ${refno}` }, full_name: null })),
}));

vi.mock('@/composables/useRoomInfoPanel', () => ({
  resolveContainingRoomInfo: roomMocks.resolveContainingRoomInfo,
  useRoomInfoPanel: () => ({
    openForRefno: vi.fn(async () => null),
    showRoomModel: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/api/genModelPdmsAttrApi', () => ({
  pdmsGetUiAttr: roomMocks.pdmsGetUiAttr,
}));

function mountDrawer() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({
    render: () => h(SpatialQueryDrawer, { open: true, 'onUpdate:open': () => undefined }),
  });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

function resetDraft() {
  const initial: DraftState = {
    mode: 'distance',
    rangeCenterSource: 'selected',
    distanceCenterSource: 'refno',
    refno: '',
    center: { x: 0, y: 0, z: 0 },
    radius: 1000,
    shape: 'sphere',
    nounText: '',
    keyword: '',
    onlyLoaded: false,
    onlyVisible: false,
    includeNegative: false,
    specValues: [],
    limit: 200,
    sortBy: 'distanceAsc',
  };
  Object.assign(stubState.draft, initial);
  stubState.status.value = 'idle';
  stubState.error.value = null;
  stubState.resultSet.value = null;
  stubState.activeResultRefno.value = null;
  stubState.selectedCenterRefno.value = null;
  stubState.canSubmit.value = true;
  stubState.spatialCapabilities.value = { specValues: true, branCenterline: true };
}

function makeResultSet(count: number, options: { page?: number; perPage?: number; total?: number; hasMore?: boolean; startIndex?: number } = {}): SpatialQueryResultSet {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? count;
  const total = options.total ?? count;
  const startIndex = options.startIndex ?? 0;
  const items: SpatialQueryResultItem[] = Array.from({ length: count }, (_, idx) => {
    const refno = `24381_${String(100001 + startIndex + idx)}`;
    return {
      refno,
      noun: 'PIPE',
      specValue: 0,
      specName: '未知',
      distance: idx,
      loaded: false,
      visible: true,
      matchedBy: 'server-spatial-index',
      position: null,
      bbox: null,
      name: refno,
      sourceModel: null,
    };
  });

  return {
    request: {
      mode: 'distance',
      centerSource: 'refno',
      center: { x: 0, y: 0, z: 0 },
      radius: 1000,
      shape: 'sphere',
      filters: {
        nouns: [],
        keyword: '',
        onlyLoaded: false,
        onlyVisible: false,
        includeNegative: false,
        specValues: [],
      },
      limit: perPage,
      sortBy: 'distanceAsc',
      refno: '24381_145018',
    },
    items,
    page,
    perPage,
    returnedCount: count,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    hasMore: options.hasMore ?? page * perPage < total,
    total,
    loadedCount: 0,
    unloadedCount: count,
    truncated: options.hasMore ?? page * perPage < total,
    warnings: [],
    groups: [
      {
        specValue: 0,
        specName: '未知',
        count,
        items,
      },
    ],
  };
}

async function expandResults(host: HTMLElement) {
  const toggle = host.querySelector('[data-testid="spatial-results-toggle"]') as HTMLButtonElement | null;
  expect(toggle).toBeTruthy();
  expect(toggle?.textContent).toContain('查看结果');
  toggle?.click();
  await nextTick();
}

describe('SpatialQueryDrawer (distance 模式)', () => {
  beforeEach(() => {
    applyCurrentSelection.mockReset();
    startPickCenter.mockReset();
    submitQuery.mockReset();
    requeryResults.mockReset();
    roomMocks.resolveContainingRoomInfo.mockReset();
    roomMocks.resolveContainingRoomInfo.mockResolvedValue(null);
    roomMocks.pdmsGetUiAttr.mockClear();
    clearResults.mockReset();
    activateResult.mockReset();
    countLoadTargets.mockReset();
    countLoadTargets.mockReturnValue(0);
    loadResults.mockReset();
    confirmOpen.mockReset();
    confirmOpen.mockResolvedValue(true);
    showOnlySpecGroup.mockReset();
    showOnlyDbnumGroup.mockReset();
    toggleResultVisible.mockReset();
    setAllResultsVisible.mockReset();
    isolateResults.mockReset();
    restoreScene.mockReset();
    setMode.mockClear();
    vi.unstubAllGlobals();
    resetDraft();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('distance 模式下显示"拾取物项"按钮，点击触发 applyCurrentSelection', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const pickButton = host.querySelector('[data-testid="pick-from-selection"]') as HTMLButtonElement | null;
    expect(pickButton).toBeTruthy();
    expect(pickButton?.textContent).toContain('拾取物项');

    pickButton?.click();
    await nextTick();

    expect(applyCurrentSelection).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('distance 模式多一档「沿 BRAN 中心线」：点选后仍用 refno 输入区并给出口径提示；数据源没这一档时按钮不出现、残留选择退回 refno', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const centerlineButton = host.querySelector('[data-testid="distance-source-bran-centerline"]') as HTMLButtonElement | null;
    expect(centerlineButton).toBeTruthy();
    expect(centerlineButton?.textContent).toContain('沿 BRAN 中心线');

    centerlineButton?.click();
    await nextTick();

    expect(stubState.draft.distanceCenterSource).toBe('bran_centerline');
    expect(host.querySelector('[data-testid="pick-from-selection"]')).toBeTruthy();
    expect(host.textContent).toContain('拾取起始 BRAN');
    expect(host.textContent).toContain('走廊外扩距离');
    expect(host.querySelector('[data-testid="distance-source-bran-centerline"]')?.className).toContain('bg-brand-subtle');

    // gen-model-v1 没有中心线：按钮消失，已选的那一档退回「通过 Refno」
    stubState.spatialCapabilities.value = { specValues: false, branCenterline: false };
    await nextTick();

    expect(host.querySelector('[data-testid="distance-source-bran-centerline"]')).toBeNull();
    expect(stubState.draft.distanceCenterSource).toBe('refno');
    expect(host.querySelector('[data-testid="pick-from-selection"]')).toBeTruthy();

    unmount();
  });

  it('已有 refno 时展示绿色状态圆点和 refno 文本；清空时显示"尚未选中物项"', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const dot = host.querySelector('[data-testid="pick-from-selection"]')?.parentElement?.querySelector('span.rounded-full') as HTMLElement | null;
    expect(dot).toBeTruthy();
    expect(dot?.className).toContain('bg-gray-300');
    expect(host.textContent).toContain('尚未选中物项');

    stubState.draft.refno = '24381_100818';
    await nextTick();

    const updatedDot = host.querySelector('[data-testid="pick-from-selection"]')?.parentElement?.querySelector('span.rounded-full') as HTMLElement | null;
    expect(updatedDot?.className).toContain('bg-success');
    expect(host.textContent).toContain('24381_100818');

    unmount();
  });

  it('半径滑动条输入会同步到 draft.radius', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const slider = host.querySelector('[data-testid="radius-slider"]') as HTMLInputElement | null;
    expect(slider).toBeTruthy();
    expect(slider?.min).toBe('0.1');
    expect(slider?.max).toBe('100');

    if (slider) {
      slider.value = '2.5';
      slider.dispatchEvent(new Event('input'));
    }
    await nextTick();

    expect(stubState.draft.radius).toBe(2500);

    unmount();
  });

  it('点击半径预设 Chip 设置 draft.radius 并高亮当前预设', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const presets = Array.from(host.querySelectorAll('[data-testid="radius-preset"]')) as HTMLButtonElement[];
    expect(presets.length).toBe(4);
    expect(presets[0].textContent).toContain('1 m');
    expect(presets[1].textContent).toContain('5 m');

    presets[2].click(); // 10 m
    await nextTick();

    expect(stubState.draft.radius).toBe(10000);
    const reread = Array.from(host.querySelectorAll('[data-testid="radius-preset"]')) as HTMLButtonElement[];
    expect(reread[2].className).toContain('bg-brand-subtle');

    unmount();
  });

  it('迷你模式展示紧凑摘要并可展开恢复完整面板', async () => {
    stubState.resultSet.value = makeResultSet(3);

    const { host, unmount } = mountDrawer();
    await nextTick();

    const miniToggle = host.querySelector('[data-testid="spatial-query-mini-toggle"]') as HTMLButtonElement | null;
    expect(miniToggle).toBeTruthy();
    miniToggle?.click();
    await nextTick();

    expect(host.textContent).toContain('空间查询');
    expect(host.textContent).toContain('距离查询');
    expect(host.textContent).toContain('半径');
    expect(host.textContent).toContain('1 m');
    expect(host.textContent).toContain('3 项');
    expect(host.querySelector('[data-testid="pick-from-selection"]')).toBeNull();

    const expandButton = host.querySelector('[data-testid="spatial-query-mini-expand"]') as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();
    expandButton?.click();
    await nextTick();

    expect(host.querySelector('[data-testid="pick-from-selection"]')).toBeTruthy();

    unmount();
  });

  it('更多条件默认折叠，展开后显示查询形状、每页数量和过滤项', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    expect(host.textContent).toContain('更多条件');
    expect(host.textContent).not.toContain('查询形状');
    expect(host.textContent).not.toContain('每页数量');
    expect(host.textContent).not.toContain('Noun 类型');
    expect(host.textContent).not.toContain('关键字');
    expect(host.textContent).not.toContain('专业过滤');

    const advancedToggle = host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement | null;
    expect(advancedToggle).toBeTruthy();
    expect(advancedToggle?.getAttribute('aria-expanded')).toBe('false');
    advancedToggle?.click();
    await nextTick();

    expect(advancedToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(host.textContent).toContain('查询形状');
    expect(host.textContent).toContain('每页数量');
    expect(host.textContent).toContain('Noun 类型');
    expect(host.textContent).toContain('关键字');
    expect(host.textContent).toContain('专业过滤');
    expect(host.textContent).toContain('显示负实体');
    const includeNegativeCheckbox = host.querySelector('[data-testid="include-negative-checkbox"]') as HTMLInputElement | null;
    expect(includeNegativeCheckbox).toBeTruthy();
    expect(includeNegativeCheckbox?.checked).toBe(false);

    unmount();
  });

  it('排序切换会写入 draft.sortBy，已有结果时回到第一页重查', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();
    expect(host.textContent).toContain('结果排序');

    const byName = host.querySelector('[data-testid="spatial-sort-nameAsc"]') as HTMLButtonElement;
    const byDistance = host.querySelector('[data-testid="spatial-sort-distanceAsc"]') as HTMLButtonElement;
    expect(byName).toBeTruthy();
    // 默认按距离，对应项高亮
    expect(byDistance.className).toContain('border-brand');
    expect(byName.className).not.toContain('border-brand');

    // 尚无结果时只改草稿，不触发查询
    byName.click();
    await nextTick();
    expect(stubState.draft.sortBy).toBe('nameAsc');
    expect(submitQuery).not.toHaveBeenCalled();
    expect(byName.className).toContain('border-brand');

    // 已有结果时切换排序需要重查，且必须回到第一页：沿用上一次结果的请求只换排序（不重解中心，见 P1），不走「执行空间查询」
    stubState.resultSet.value = makeResultSet(2, { page: 2, perPage: 2, total: 6 });
    await nextTick();
    (host.querySelector('[data-testid="spatial-sort-specThenDistance"]') as HTMLButtonElement).click();
    await nextTick();
    expect(stubState.draft.sortBy).toBe('specThenDistance');
    expect(requeryResults).toHaveBeenCalledTimes(1);
    expect(requeryResults).toHaveBeenCalledWith({ sortBy: 'specThenDistance' });
    expect(submitQuery).not.toHaveBeenCalled();

    unmount();
  });

  it('range 模式手输坐标：坐标格清空（v-model.number 写进 \'\'）时中心摘要显示「—」而不是抛错', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    stubState.draft.mode = 'range';
    stubState.draft.rangeCenterSource = 'coordinates';
    stubState.draft.center = { x: 1234, y: 5678, z: 910 };
    await nextTick();
    expect(host.textContent).toContain('1234, 5678, 910');

    // Vue 的 looseToNumber 对空串转不动，原样写回 ''；改前 centerSummary 直接 toFixed → TypeError，整段摘要渲染挂掉
    (stubState.draft.center as unknown as { x: unknown }).x = '';
    stubState.draft.center.z = Number.NaN;
    await nextTick();
    expect(host.textContent).toContain('—, 5678, —');

    unmount();
  });

  it('查询结果数据中的过滤选项会驱动专业过滤项', async () => {
    stubState.resultSet.value = {
      ...makeResultSet(2),
      filterOptions: {
        includeNegative: false,
        nouns: [
          { value: 'PIPE', count: 8, isNegative: false },
        ],
        specValues: [
          { value: 1, count: 8, label: '管道系统' },
          { value: 3, count: 2, label: '仪表系统' },
        ],
      },
    };

    const { host, unmount } = mountDrawer();
    await nextTick();

    const advancedToggle = host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement | null;
    advancedToggle?.click();
    await nextTick();

    expect(host.textContent).toContain('管道(8)');
    expect(host.textContent).toContain('仪表(2)');
    expect(host.textContent).not.toContain('电气');
    expect(host.textContent).not.toContain('暖通');

    unmount();
  });

  it('range 模式「当前选中」选中的是没加载几何的 owner 时，中心摘要显示 refno 与「由服务端解中心」，解出后回到坐标', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    stubState.draft.mode = 'range';
    stubState.draft.rangeCenterSource = 'selected';
    stubState.draft.center = { x: 5964, y: 9972, z: 16552 };
    stubState.selectedCenterRefno.value = '24381_145000';
    await nextTick();
    expect(host.textContent).toContain('24381_145000 · 未加载几何，查询时由服务端解中心');
    expect(host.textContent).not.toContain('5964, 9972, 16552');

    // 服务端 center 回来后 store 清掉 refno → 摘要回到坐标
    stubState.selectedCenterRefno.value = null;
    await nextTick();
    expect(host.textContent).toContain('5964, 9972, 16552');
    expect(host.textContent).not.toContain('由服务端解中心');

    // 只对「当前选中」生效：手输坐标下即使残留 refno 也显示坐标
    stubState.selectedCenterRefno.value = '24381_145000';
    stubState.draft.rangeCenterSource = 'coordinates';
    await nextTick();
    expect(host.textContent).not.toContain('由服务端解中心');

    unmount();
  });

  it('切换到 range 模式后隐藏 distance 专属 UI、显示中心来源三联按钮和半径 input', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    // 触发 range 模式
    stubState.draft.mode = 'range';
    await nextTick();

    const pickButton = host.querySelector('[data-testid="pick-from-selection"]');
    expect(pickButton).toBeNull();

    const slider = host.querySelector('[data-testid="radius-slider"]');
    expect(slider).toBeTruthy();

    const allLabels = Array.from(host.querySelectorAll('label')) as HTMLLabelElement[];
    const radiusLabel = allLabels.find((label) => label.textContent?.includes('查询半径 (m)'));
    expect(radiusLabel).toBeDefined();

    unmount();
  });

  it('查询结果按服务端分页显示，并在翻页时重新查询后端', async () => {
    stubState.resultSet.value = makeResultSet(20, {
      page: 1,
      perPage: 20,
      total: 25,
      hasMore: true,
    });

    const { host, unmount } = mountDrawer();
    await nextTick();

    expect(host.textContent).toContain('共 25 项，当前页 20 项');
    expect(host.textContent).toContain('查看结果');
    expect(host.textContent).not.toContain('每页 20 项');
    expect(host.textContent).not.toContain('24381_100001');

    await expandResults(host);

    expect(host.textContent).toContain('每页 20 项');
    expect(host.textContent).toContain('当前 1-20 / 25');
    expect(host.textContent).toContain('第 1 / 2 页');
    expect(host.textContent).toContain('24381_100001');
    expect(host.textContent).not.toContain('24381_100021');

    const nextButton = host.querySelector('[data-testid="spatial-result-page-next"]') as HTMLButtonElement | null;
    expect(nextButton).toBeTruthy();
    nextButton?.click();
    await nextTick();
    // 翻页沿用上一次结果的请求（不重解中心、失败不清旧页，见 P1 / P4），不走「执行空间查询」
    expect(requeryResults).toHaveBeenCalledWith({ page: 2 });
    expect(submitQuery).not.toHaveBeenCalled();

    stubState.resultSet.value = makeResultSet(5, {
      page: 2,
      perPage: 20,
      total: 25,
      hasMore: false,
      startIndex: 20,
    });
    await nextTick();
    expect(host.textContent).toContain('当前 21-25 / 25');
    expect(host.textContent).toContain('第 2 / 2 页');
    expect(host.textContent).not.toContain('24381_100001');
    expect(host.textContent).toContain('24381_100021');

    unmount();
  });

  it('「仅看已加载 / 仅看当前可见」的纯本地结果（localOnly）：分页行改成「本地扫描 · 不分页」，不画翻页按钮', async () => {
    stubState.resultSet.value = {
      ...makeResultSet(3, { page: 1, perPage: 100, total: 3 }),
      localOnly: true,
    };

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    expect(host.querySelector('[data-testid="spatial-local-only-hint"]')?.textContent).toContain('本地扫描（仅已加载构件）· 共 3 项 · 不分页');
    expect(host.textContent).not.toContain('每页 100 项');
    expect(host.querySelector('[data-testid="spatial-result-page-next"]')).toBeNull();
    expect(host.textContent).toContain('24381_100001');

    unmount();
  });

  it('房间列表：结果区收起时不解析；展开后每个条目只解一次归属（不取属性），按房间去重后每个房间只取一次属性', async () => {
    // 3 个条目落在 2 个房间：前两条 room_a，第三条 room_b
    roomMocks.resolveContainingRoomInfo.mockImplementation(async (refno: string) => ({
      sourceRefno: refno,
      roomRefno: refno === '24381_100003' ? 'room_b' : 'room_a',
      fullName: null,
      attrs: {},
      refFullNames: null,
      ancestorIds: [],
    }));
    stubState.resultSet.value = makeResultSet(3);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await flushMicrotasks();

    // 改前结果一变就解析、收起着也打请求
    expect(roomMocks.resolveContainingRoomInfo).not.toHaveBeenCalled();
    expect(roomMocks.pdmsGetUiAttr).not.toHaveBeenCalled();

    await expandResults(host);
    await flushMicrotasks();
    await nextTick();

    // 归属：每个条目一发、不取属性；属性：每个房间一发（改前每个条目各打一发 ancestors + 一发属性）
    expect(roomMocks.resolveContainingRoomInfo).toHaveBeenCalledTimes(3);
    for (const call of roomMocks.resolveContainingRoomInfo.mock.calls) {
      expect(call[1]).toEqual({ includeAttrs: false });
    }
    expect(roomMocks.pdmsGetUiAttr).toHaveBeenCalledTimes(2);
    expect(roomMocks.pdmsGetUiAttr.mock.calls.map((call) => call[0]).sort()).toEqual(['room_a', 'room_b']);
    expect(host.textContent).toContain('当前页涉及 2 个房间');
    expect(host.textContent).toContain('房间 room_a');
    expect(host.textContent).toContain('2 项');
    expect(host.textContent).toContain('房间 room_b');

    // 收起再展开同一份结果：不重复解析
    (host.querySelector('[data-testid="spatial-results-toggle"]') as HTMLButtonElement).click();
    await nextTick();
    (host.querySelector('[data-testid="spatial-results-toggle"]') as HTMLButtonElement).click();
    await nextTick();
    await flushMicrotasks();
    expect(roomMocks.resolveContainingRoomInfo).toHaveBeenCalledTimes(3);

    // 结果换了（翻到第 2 页）：旧列表作废，展开着就按新条目重解
    stubState.resultSet.value = makeResultSet(2, { page: 2, perPage: 3, total: 5, startIndex: 3 });
    await nextTick();
    await flushMicrotasks();
    await nextTick();
    expect(roomMocks.resolveContainingRoomInfo).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain('当前页涉及 1 个房间');

    unmount();
  });

  it('查询结果展示服务端返回的中心坐标和来源', async () => {
    stubState.resultSet.value = {
      ...makeResultSet(1),
      center: {
        x: 123.4,
        y: 567.8,
        z: 910.1,
        source: 'world_transform',
        refno: '24381_145018',
      },
    };

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    expect(host.textContent).toContain('中心 123, 568, 910');
    expect(host.textContent).toContain('world_transform');
    expect(host.textContent).toContain('24381_145018');

    unmount();
  });

  it('展示总数、当前页数、已加载/未加载统计和截断警告', async () => {
    stubState.resultSet.value = {
      ...makeResultSet(3, { page: 1, perPage: 3, total: 12, hasMore: true }),
      loadedCount: 1,
      unloadedCount: 2,
      truncated: true,
      truncatedCandidates: true,
      warnings: [
        '服务端还有更多结果，请使用分页继续查看',
        '服务端候选集已截断，结果可能只覆盖候选上限范围',
      ],
    };

    const { host, unmount } = mountDrawer();
    await nextTick();

    expect(host.textContent).toContain('共 12 项，当前页 3 项，已加载 1 项，未加载 2 项');
    expect(host.textContent).not.toContain('服务端还有更多结果');

    await expandResults(host);

    expect(host.textContent).toContain('服务端还有更多结果');
    expect(host.textContent).toContain('服务端候选集已截断');

    unmount();
  });

  it('可复制当前页 refno，按当前展示顺序输出', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubState.resultSet.value = makeResultSet(3);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    const copyButton = host.querySelector('[data-testid="copy-current-page-refnos"]') as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();
    copyButton?.click();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith('24381_100001\n24381_100002\n24381_100003');

    unmount();
  });

  it('可复制全部已返回 refno，去重后保持结果顺序', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const resultSet = makeResultSet(3);
    resultSet.items.push({
      ...resultSet.items[1]!,
      distance: 99,
    });
    resultSet.groups[0]!.items = resultSet.items;
    stubState.resultSet.value = resultSet;

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    const copyButton = host.querySelector('[data-testid="copy-all-returned-refnos"]') as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();
    copyButton?.click();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith('24381_100001\n24381_100002\n24381_100003');

    unmount();
  });

  it('加载当前页只动当前页（pages: current）；只加载未加载仍按整个命中集合补加载', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();

    const allButtons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];
    allButtons.find((button) => button.textContent?.includes('加载当前页'))?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ pages: 'current', flyTo: true });

    allButtons.find((button) => button.textContent?.includes('只加载未加载'))?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });

    unmount();
  });

  it('「只加载未加载」超过 200 项先弹确认并显示数量：不超过直接加载，取消不加载，确认才加载', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();
    const clickUnloaded = () => {
      (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[])
        .find((button) => button.textContent?.includes('只加载未加载'))?.click();
    };

    // 正好 200：不弹框，直接加载；数量按 loadResults 同一套取法算
    countLoadTargets.mockReturnValue(200);
    clickUnloaded();
    await nextTick();
    expect(countLoadTargets).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });
    expect(confirmOpen).not.toHaveBeenCalled();
    expect(loadResults).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });

    // 1367：弹框、显示数量；取消 → 不加载
    loadResults.mockClear();
    countLoadTargets.mockReturnValue(1367);
    confirmOpen.mockResolvedValueOnce(false);
    clickUnloaded();
    await flushMicrotasks();
    expect(confirmOpen).toHaveBeenCalledTimes(1);
    const dialog = confirmOpen.mock.calls[0]![0];
    expect(dialog.title).toBe('加载数量较多');
    expect(dialog.message).toContain('「只加载未加载」将加载 1367 个模型');
    expect(dialog.message).toContain('超过 200 个');
    expect(dialog.confirmText).toBe('加载 1367 个');
    expect(loadResults).not.toHaveBeenCalled();

    // 确认 → 加载
    clickUnloaded();
    await flushMicrotasks();
    expect(confirmOpen).toHaveBeenCalledTimes(2);
    expect(loadResults).toHaveBeenCalledTimes(1);
    expect(loadResults).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });

    unmount();
  });

  it('查看器动作按钮可显示、隐藏、隔离、恢复当前结果集', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    const allButtons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];
    allButtons.find((button) => button.textContent?.includes('全部显示'))?.click();
    allButtons.find((button) => button.textContent?.includes('全部隐藏'))?.click();
    allButtons.find((button) => button.textContent?.includes('隔离结果'))?.click();
    allButtons.find((button) => button.textContent?.includes('恢复场景'))?.click();
    await nextTick();

    expect(setAllResultsVisible).toHaveBeenCalledWith(true);
    expect(setAllResultsVisible).toHaveBeenCalledWith(false);
    expect(isolateResults).toHaveBeenCalledTimes(1);
    expect(restoreScene).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('结果行点击和显式定位按钮都会触发加载/选中/飞行定位路径', async () => {
    stubState.resultSet.value = makeResultSet(1);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    const resultRow = Array.from(host.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('24381_100001')) as HTMLButtonElement | undefined;
    expect(resultRow).toBeTruthy();
    resultRow?.click();
    await nextTick();

    const locateButton = host.querySelector('[data-testid="locate-spatial-result"][data-refno="24381_100001"]') as HTMLButtonElement | null;
    expect(locateButton).toBeTruthy();
    locateButton?.click();
    await nextTick();

    expect(activateResult).toHaveBeenCalledTimes(2);
    expect(activateResult).toHaveBeenNthCalledWith(1, stubState.resultSet.value.items[0]);
    expect(activateResult).toHaveBeenNthCalledWith(2, stubState.resultSet.value.items[0]);

    unmount();
  });

  it('单项显示/隐藏按钮调用可见性切换并保留结果集', async () => {
    stubState.resultSet.value = makeResultSet(1);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    const visibilityButton = host.querySelector('button[title="隐藏"]') as HTMLButtonElement | null;
    expect(visibilityButton).toBeTruthy();
    visibilityButton?.click();
    await nextTick();

    expect(toggleResultVisible).toHaveBeenCalledWith(stubState.resultSet.value.items[0]);
    expect(stubState.resultSet.value?.items.map((item) => item.refno)).toEqual(['24381_100001']);

    unmount();
  });

  it('legacy（有专业维度）：专业过滤与「按专业」排序在，结果按专业分组，组按钮走 specValue 路径', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();
    expect(host.textContent).toContain('结果会按专业分组');

    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="spec-filter"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="spatial-sort-specThenDistance"]')).toBeTruthy();

    stubState.resultSet.value = makeResultSet(2);
    await nextTick();
    await expandResults(host);
    expect(host.querySelector('[data-testid="spatial-coverage-hint"]')).toBeNull();
    const titles = Array.from(host.querySelectorAll('[data-testid="spatial-result-group-title"]')).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['未知']);
    expect(host.querySelector('[data-testid="spatial-result-group-load"]')?.textContent).toContain('加载本专业');

    (host.querySelector('[data-testid="spatial-result-group-load"]') as HTMLButtonElement | null)?.click();
    (host.querySelector('[data-testid="spatial-result-group-show-only"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ specValue: 0, flyTo: true });
    expect(showOnlySpecGroup).toHaveBeenCalledWith(0);
    expect(showOnlyDbnumGroup).not.toHaveBeenCalled();

    unmount();
  });

  it('gen-model-v1（无专业维度）：收起专业过滤与「按专业」排序，结果按库分组、组头用服务端全量计数、组按钮走 dbnum 路径，并提示覆盖面', async () => {
    stubState.spatialCapabilities.value = { specValues: false, branCenterline: false };
    const base = makeResultSet(3);
    base.items[0]!.dbnum = 24381;
    base.items[1]!.dbnum = 24383;
    base.items[2]!.dbnum = 24381;
    stubState.resultSet.value = {
      ...base,
      total: 9,
      // 24390 在全集里有命中、当前页没有条目，也要露出组头
      dbnumGroups: [{ dbnum: 24381, count: 5 }, { dbnum: 24383, count: 3 }, { dbnum: 24390, count: 1 }],
      coverage: 'global-tree',
    };

    const { host, unmount } = mountDrawer();
    await nextTick();

    expect(host.textContent).toContain('共 9 项 · 5 库24381 · 3 库24383 · 1 库24390');
    expect(host.textContent).not.toContain('按专业分组');

    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="spec-filter"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-sort-specThenDistance"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-sort-distanceAsc"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="spatial-sort-nameAsc"]')).toBeTruthy();

    await expandResults(host);
    expect(host.querySelector('[data-testid="spatial-coverage-hint"]')?.textContent).toContain('仅含已生成过模型的构件');
    const titles = Array.from(host.querySelectorAll('[data-testid="spatial-result-group-title"]')).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['库 24381', '库 24383', '库 24390']);
    const groups = Array.from(host.querySelectorAll('[data-testid="spatial-result-group"]'));
    expect(groups[0]?.textContent).toContain('5 项');
    expect(groups[1]?.textContent).toContain('3 项');
    expect(groups[2]?.textContent).toContain('1 项');
    expect(groups[0]?.textContent).toContain('24381_100001');
    expect(groups[0]?.textContent).toContain('24381_100003');
    expect(groups[0]?.textContent).not.toContain('24381_100002');
    expect(groups[1]?.textContent).toContain('24381_100002');
    expect(groups[2]?.textContent).not.toContain('24381_1000');

    const loadButtons = Array.from(host.querySelectorAll('[data-testid="spatial-result-group-load"]')) as HTMLButtonElement[];
    expect(loadButtons[1]?.textContent).toContain('加载本库');
    loadButtons[1]?.click();
    (host.querySelectorAll('[data-testid="spatial-result-group-show-only"]')[0] as HTMLButtonElement | undefined)?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ dbnum: 24383, flyTo: true });
    expect(showOnlyDbnumGroup).toHaveBeenCalledWith(24381);
    expect(showOnlySpecGroup).not.toHaveBeenCalled();

    // 分组「加载本库」跨页拿整组：超过 200 项先弹确认（数量按该库的批量作用域算），取消不加载、确认才加载
    loadResults.mockClear();
    countLoadTargets.mockReturnValue(3534);
    confirmOpen.mockResolvedValueOnce(false);
    loadButtons[0]?.click();
    await flushMicrotasks();
    expect(countLoadTargets).toHaveBeenLastCalledWith({ dbnum: 24381, flyTo: true });
    expect(confirmOpen).toHaveBeenCalledTimes(1);
    const dialog = confirmOpen.mock.calls[0]![0];
    expect(dialog.message).toContain('「加载本库」（库 24381）将加载 3534 个模型');
    expect(dialog.confirmText).toBe('加载 3534 个');
    expect(loadResults).not.toHaveBeenCalled();
    loadButtons[0]?.click();
    await flushMicrotasks();
    expect(loadResults).toHaveBeenCalledTimes(1);
    expect(loadResults).toHaveBeenCalledWith({ dbnum: 24381, flyTo: true });

    unmount();
  });
});
