import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, ref, type Ref } from 'vue';

import SpatialQueryDrawer from './SpatialQueryDrawer.vue';

import type { SpatialTreeResult } from '@/api/genModelSpatialApi';
import type {
  SpatialQueryCapabilities,
  SpatialQueryDraft,
  SpatialQueryGroupDimension,
  SpatialQueryResultItem,
  SpatialQueryResultSet,
  SpatialQueryRoomOption,
  SpatialQueryRoomsStatus,
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
/** 房间过滤（ADR 0067）：清单拉取 / 增删 / 「当前选中所在房间」/ 归属解析 / 房间属性，全部由 store 给，抽屉只画 */
const roomStoreMocks = {
  setGroupDimension: vi.fn((dimension: SpatialQueryGroupDimension) => {
    stubState.groupDimension.value = dimension;
  }),
  loadRoomOptions: vi.fn(async () => stubState.roomsStatus.value),
  addRooms: vi.fn((selections: { refno: string; roomNum: string; name: string | null }[]) => {
    const added: typeof selections = [];
    for (const selection of selections) {
      if (stubState.draft.rooms.some((room) => room.refno === selection.refno)) continue;
      stubState.draft.rooms.push(selection);
      added.push(selection);
    }
    return added;
  }),
  removeRoom: vi.fn((refno: string) => {
    stubState.draft.rooms = stubState.draft.rooms.filter((room) => room.refno !== refno);
  }),
  clearRooms: vi.fn(() => {
    stubState.draft.rooms = [];
  }),
  addRoomsByNumber: vi.fn(async (_text: string) => ({ added: [] as { refno: string; roomNum: string; name: string | null }[], missing: [] as string[], duplicated: [] as string[] })),
  applySelectedRefnoRooms: vi.fn(async () => ({ refno: null as string | null, added: [] as { refno: string; roomNum: string; name: string | null }[], error: null as string | null })),
  /** 结果区「房间列表」：每个条目一发归属（回房间 refno 列表） */
  roomsOf: vi.fn(async (_refno: string): Promise<string[]> => []),
  /** 每个房间一发属性 */
  roomAttributes: vi.fn(async (refno: string): Promise<{ success: boolean; refno: string; attrs: Record<string, unknown>; full_name: string | null }> => (
    { success: true, refno, attrs: { TYPE: 'ROOM', NAME: `房间 ${refno}` }, full_name: null }
  )),
};

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
    rooms: [],
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
  /** 「每页数量」是否为正整数（store 算，抽屉据此标红输入框） */
  hasValidPageLimit: ref(true) as Ref<boolean>,
  /** legacy 源有专业维度、没有房间过滤；gen-model-v1 的用例按需翻 */
  spatialCapabilities: ref<SpatialQueryCapabilities>({ specValues: true, branCenterline: true, keywordMatchesName: true, nameSortExact: true, rooms: false, tree: false }) as Ref<SpatialQueryCapabilities>,
  /** 在册房间清单与房间体制状态（store 的 `loadRoomOptions` 填） */
  roomOptions: ref<SpatialQueryRoomOption[]>([]) as Ref<SpatialQueryRoomOption[]>,
  roomsStatus: ref<SpatialQueryRoomsStatus>({ status: 'idle', reason: null }) as Ref<SpatialQueryRoomsStatus>,
  /** 结果分组维度（Q11）：缺省按专业 */
  groupDimension: ref<SpatialQueryGroupDimension>('spec') as Ref<SpatialQueryGroupDimension>,
};

vi.mock('@/composables/useSpatialQuery', () => ({
  useSpatialQuery: () => ({
    ...stubState,
    ...roomStoreMocks,
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

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: vi.fn(),
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
    rooms: [],
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
  stubState.hasValidPageLimit.value = true;
  stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: true, nameSortExact: true, rooms: false, tree: false };
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
        rooms: [],
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
    roomStoreMocks.roomsOf.mockReset();
    roomStoreMocks.roomsOf.mockResolvedValue([]);
    roomStoreMocks.roomAttributes.mockClear();
    roomStoreMocks.loadRoomOptions.mockClear();
    roomStoreMocks.addRooms.mockClear();
    roomStoreMocks.removeRoom.mockClear();
    roomStoreMocks.clearRooms.mockClear();
    roomStoreMocks.addRoomsByNumber.mockClear();
    roomStoreMocks.applySelectedRefnoRooms.mockClear();
    roomStoreMocks.setGroupDimension.mockClear();
    stubState.roomOptions.value = [];
    stubState.roomsStatus.value = { status: 'idle', reason: null };
    stubState.groupDimension.value = 'spec';
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
    // 中心线档不画「量到整个包围盒」提示（那句只针对普通 refno 档）
    expect(host.querySelector('[data-testid="distance-refno-box-hint"]')).toBeNull();

    // 回到「通过 Refno」：给出「半径量到整个包围盒表面、不是到一个点」的口径提示
    stubState.draft.distanceCenterSource = 'refno';
    await nextTick();
    const boxHint = host.querySelector('[data-testid="distance-refno-box-hint"]');
    expect(boxHint).toBeTruthy();
    expect(boxHint?.textContent).toContain('整个包围盒');

    // gen-model-v1 没有中心线：按钮消失，已选的那一档退回「通过 Refno」
    stubState.spatialCapabilities.value = { specValues: false, branCenterline: false, keywordMatchesName: false, nameSortExact: false, rooms: false, tree: false };
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

  it('更多条件：关键字文案随源切（legacy 含名称、v1 只 Refno / Noun）；「每页数量」无效时输入框标红并提示', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();
    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();

    expect(host.querySelector('[data-testid="spatial-keyword-label"]')?.textContent).toContain('关键字（Refno / Noun / 名称）');
    expect((host.querySelector('[data-testid="spatial-keyword-input"]') as HTMLInputElement).placeholder).toContain('名称');

    // gen-model-v1：服务端不按名称匹配，文案不再许诺「名称」（改前写死「Refno / 名称」）
    stubState.spatialCapabilities.value = { specValues: false, branCenterline: false, keywordMatchesName: false, nameSortExact: false, rooms: false, tree: false };
    await nextTick();
    expect(host.querySelector('[data-testid="spatial-keyword-label"]')?.textContent).toContain('关键字（Refno / Noun）');
    expect(host.querySelector('[data-testid="spatial-keyword-label"]')?.textContent).not.toContain('名称');
    expect((host.querySelector('[data-testid="spatial-keyword-input"]') as HTMLInputElement).placeholder).toContain('不按名称匹配');

    // 每页数量清空：store 判无效 → 输入框标红 + 提示；有效时没有提示
    expect(host.querySelector('[data-testid="spatial-page-limit-hint"]')).toBeNull();
    stubState.hasValidPageLimit.value = false;
    await nextTick();
    expect(host.querySelector('[data-testid="spatial-page-limit-hint"]')?.textContent).toContain('请填 ≥ 1 的整数');
    expect(host.querySelector('[data-testid="spatial-page-limit"]')?.className).toContain('border-danger');
    stubState.hasValidPageLimit.value = true;
    await nextTick();
    expect(host.querySelector('[data-testid="spatial-page-limit-hint"]')).toBeNull();

    unmount();
  });

  it('更多条件：「按名称」在不按名称排全集的源（v1）下选中时给出提示并换 tooltip；legacy 或换别的排序都不提示', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();
    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();

    const byName = () => host.querySelector('[data-testid="spatial-sort-nameAsc"]') as HTMLButtonElement;
    const hint = () => host.querySelector('[data-testid="spatial-sort-name-hint"]');

    // legacy：服务端真按名称排全集，选中「按名称」也不提示
    stubState.draft.sortBy = 'nameAsc';
    await nextTick();
    expect(hint()).toBeNull();
    expect(byName().title).toBe('按构件名称升序');

    // gen-model-v1：只为本页补名字、全集按 Noun / Refno 近似排 → 按钮下方提示 + tooltip 说明
    stubState.spatialCapabilities.value = { specValues: false, branCenterline: false, keywordMatchesName: false, nameSortExact: false, rooms: false, tree: false };
    await nextTick();
    expect(hint()?.textContent).toContain('当前源不按名称排整个命中集合');
    expect(byName().title).toContain('近似');

    // 没选「按名称」就不提示
    stubState.draft.sortBy = 'distanceAsc';
    await nextTick();
    expect(hint()).toBeNull();

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

    // 「当前选中」档给出「以包围盒中心点量距、未加载几何则按整个包围盒解」的口径提示；切到手输坐标即消失
    const selectedHint = host.querySelector('[data-testid="range-selected-center-hint"]');
    expect(selectedHint).toBeTruthy();
    expect(selectedHint?.textContent).toContain('包围盒');
    stubState.draft.rangeCenterSource = 'coordinates';
    await nextTick();
    expect(host.querySelector('[data-testid="range-selected-center-hint"]')).toBeNull();

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

  it('房间列表：结果区收起时不解析；展开后每个条目只解一次归属（经 store 的 roomsOf，不取属性），按房间去重后每个房间只取一次属性（经 store 的 roomAttributes）', async () => {
    // 3 个条目落在 2 个房间：前两条 room_a，第三条 room_b
    roomStoreMocks.roomsOf.mockImplementation(async (refno: string) => [refno === '24381_100003' ? 'room_b' : 'room_a']);
    stubState.resultSet.value = makeResultSet(3);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await flushMicrotasks();

    // 改前结果一变就解析、收起着也打请求
    expect(roomStoreMocks.roomsOf).not.toHaveBeenCalled();
    expect(roomStoreMocks.roomAttributes).not.toHaveBeenCalled();

    await expandResults(host);
    await flushMicrotasks();
    await nextTick();

    // 归属：每个条目一发、不取属性；属性：每个房间一发（改前每个条目各打一发 ancestors + 一发属性，且打的是旧后端）
    expect(roomStoreMocks.roomsOf).toHaveBeenCalledTimes(3);
    expect(roomStoreMocks.roomAttributes).toHaveBeenCalledTimes(2);
    expect(roomStoreMocks.roomAttributes.mock.calls.map((call) => call[0]).sort()).toEqual(['room_a', 'room_b']);
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
    expect(roomStoreMocks.roomsOf).toHaveBeenCalledTimes(3);

    // 结果换了（翻到第 2 页）：旧列表作废，展开着就按新条目重解
    stubState.resultSet.value = makeResultSet(2, { page: 2, perPage: 3, total: 5, startIndex: 3 });
    await nextTick();
    await flushMicrotasks();
    await nextTick();
    expect(roomStoreMocks.roomsOf).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain('当前页涉及 1 个房间');

    unmount();
  });

  it('房间列表：一个构件横跨两间房就在两间房里各计一次；归属取数失败的条目跳过；在册清单里有的房间先用清单的名字', async () => {
    stubState.roomOptions.value = [{ refno: 'room_a', roomNum: 'A101', name: '/A101-RM', dbnum: 17496, panelCount: 4 }];
    roomStoreMocks.roomsOf.mockImplementation(async (refno: string) => {
      if (refno === '24381_100001') return ['room_a', 'room_b'];
      if (refno === '24381_100002') throw new Error('lookup failed');
      return ['room_b'];
    });
    roomStoreMocks.roomAttributes.mockImplementation(async (refno: string) => ({ success: refno === 'room_b', refno, attrs: { TYPE: 'ROOM', DESC: '走廊' }, full_name: null }));
    stubState.resultSet.value = makeResultSet(3);

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);
    await flushMicrotasks();
    await nextTick();

    expect(host.textContent).toContain('当前页涉及 2 个房间');
    // room_a：属性取不到（success:false）→ 名字来自在册清单
    expect(host.textContent).toContain('/A101-RM');
    // room_b：两条（100001 横跨 + 100003）
    const rows = Array.from(host.querySelectorAll('[data-testid="spatial-room-row"]')).map((row) => row.textContent ?? '');
    expect(rows.some((row) => row.includes('room_b') && row.includes('2 项'))).toBe(true);
    expect(rows.some((row) => row.includes('/A101-RM') && row.includes('1 项'))).toBe(true);

    unmount();
  });

  // ---- 房间过滤（ADR 0067）----

  it('房间过滤：legacy 源（capabilities.rooms=false）不画房间块、也不拉清单', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();
    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();
    expect(host.querySelector('[data-testid="room-filter"]')).toBeNull();
    expect(roomStoreMocks.loadRoomOptions).not.toHaveBeenCalled();
    unmount();
  });

  it('房间过滤：v1 源打开抽屉就拉清单；服务端 disabled 时整块换成一句原因；error 时给「重试」', async () => {
    stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true };
    stubState.roomsStatus.value = { status: 'disabled', reason: 'room_membership=false：服务端未开启房间归属计算' };

    const { host, unmount } = mountDrawer();
    await nextTick();
    expect(roomStoreMocks.loadRoomOptions).toHaveBeenCalledTimes(1);
    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();

    const block = host.querySelector('[data-testid="room-filter"]');
    expect(block).not.toBeNull();
    const unavailable = host.querySelector('[data-testid="room-filter-unavailable"]');
    expect(unavailable?.textContent).toContain('服务端未开启房间归属计算');
    expect(unavailable?.textContent).toContain('room_membership=false');
    expect(host.querySelector('[data-testid="room-search-input"]')).toBeNull();
    expect(host.querySelector('[data-testid="room-filter-retry"]')).toBeNull();

    stubState.roomsStatus.value = { status: 'error', reason: 'HTTP 500' };
    await nextTick();
    expect(host.querySelector('[data-testid="room-filter-unavailable"]')?.textContent).toContain('房间清单取不到');
    (host.querySelector('[data-testid="room-filter-retry"]') as HTMLButtonElement).click();
    expect(roomStoreMocks.loadRoomOptions).toHaveBeenLastCalledWith({ force: true });

    unmount();
  });

  it('房间过滤：ready 时可搜索下拉按房间号 / 名称过滤、点选加进已选 chip、× 移除、「当前选中所在房间」走 store', async () => {
    stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true };
    stubState.roomsStatus.value = { status: 'ready', reason: null };
    stubState.roomOptions.value = [
      { refno: '17496_1', roomNum: 'A101', name: '/A101-RM', dbnum: 17496, panelCount: 4 },
      { refno: '17496_2', roomNum: 'A102', name: '/A102-RM', dbnum: 17496, panelCount: 3 },
      { refno: '17496_3', roomNum: 'B201', name: '/B201-RM 泵房', dbnum: 17496, panelCount: 6 },
    ];

    const { host, unmount } = mountDrawer();
    await nextTick();
    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();

    const input = host.querySelector('[data-testid="room-search-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toContain('在册 3 间');
    input.dispatchEvent(new Event('focus'));
    await nextTick();
    expect(host.querySelectorAll('[data-testid="room-option"]')).toHaveLength(3);

    input.value = '泵房';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    const options = host.querySelectorAll('[data-testid="room-option"]');
    expect(options).toHaveLength(1);
    expect(options[0]?.getAttribute('data-room-refno')).toBe('17496_3');
    options[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();
    expect(roomStoreMocks.addRooms).toHaveBeenCalledWith([{ refno: '17496_3', roomNum: 'B201', name: '/B201-RM 泵房' }]);
    const chips = host.querySelectorAll('[data-testid="room-chip"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain('B201');
    expect(chips[0]?.textContent).toContain('/B201-RM 泵房');
    expect(input.value).toBe('');

    // 已选的不再出现在下拉里
    input.dispatchEvent(new Event('focus'));
    await nextTick();
    expect(Array.from(host.querySelectorAll('[data-testid="room-option"]')).map((el) => el.getAttribute('data-room-refno'))).toEqual(['17496_1', '17496_2']);

    (host.querySelector('[data-testid="room-use-selected"]') as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(roomStoreMocks.applySelectedRefnoRooms).toHaveBeenCalledTimes(1);

    (chips[0]!.querySelector('button') as HTMLButtonElement).click();
    await nextTick();
    expect(roomStoreMocks.removeRoom).toHaveBeenCalledWith('17496_3');
    expect(host.querySelectorAll('[data-testid="room-chip"]')).toHaveLength(0);

    unmount();
  });

  it('房间过滤：回车按房间号精确加入（走 store 的 addRoomsByNumber），同号多间 / 没匹配到各提示一句', async () => {
    const { emitToast } = await import('@/ribbon/toastBus');
    stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true };
    stubState.roomsStatus.value = { status: 'ready', reason: null };
    stubState.roomOptions.value = [{ refno: '17496_1', roomNum: 'A101', name: null, dbnum: 17496, panelCount: 4 }];
    roomStoreMocks.addRoomsByNumber.mockImplementation(async (text: string) => {
      if (text === 'A101') {
        const added = [{ refno: '17496_1', roomNum: 'A101', name: null }, { refno: '17497_1', roomNum: 'A101', name: null }];
        stubState.draft.rooms.push(...added);
        return { added, missing: [], duplicated: ['A101'] };
      }
      return { added: [], missing: [text], duplicated: [] };
    });

    const { host, unmount } = mountDrawer();
    await nextTick();
    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement).click();
    await nextTick();
    const input = host.querySelector('[data-testid="room-search-input"]') as HTMLInputElement;

    input.value = 'A101';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flushMicrotasks();
    await nextTick();
    expect(roomStoreMocks.addRoomsByNumber).toHaveBeenCalledWith('A101');
    expect(host.querySelectorAll('[data-testid="room-chip"]')).toHaveLength(2);
    expect(vi.mocked(emitToast)).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', message: expect.stringContaining('对应多间房') }));
    expect(input.value).toBe('');

    input.value = 'Z999';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flushMicrotasks();
    expect(vi.mocked(emitToast)).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning', message: expect.stringContaining('Z999') }));

    unmount();
  });

  it('结果分组维度（Q11）：两维都在时画「按专业 | 按库」切换，切到按库后组头按库、按钮改「加载本库」；legacy 没有库分组就不画切换', async () => {
    stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true };
    const set = makeResultSet(2);
    set.items[0]!.specValue = 1;
    set.items[0]!.specName = '管道系统';
    set.items[0]!.dbnum = 24381;
    set.items[1]!.specValue = 6;
    set.items[1]!.specName = '结构系统';
    set.items[1]!.dbnum = 7997;
    set.groups = [
      { specValue: 1, specName: '管道系统', count: 1, items: [set.items[0]!] },
      { specValue: 6, specName: '结构系统', count: 1, items: [set.items[1]!] },
    ];
    set.dbnumGroups = [{ dbnum: 24381, count: 1 }, { dbnum: 7997, count: 1 }];
    stubState.resultSet.value = set;

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);
    await nextTick();

    expect(host.querySelector('[data-testid="spatial-group-dimension"]')).not.toBeNull();
    let titles = Array.from(host.querySelectorAll('[data-testid="spatial-result-group-title"]')).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['管道系统', '结构系统']);
    expect(host.querySelector('[data-testid="spatial-result-group-load"]')?.textContent).toContain('加载本专业');

    (host.querySelector('[data-testid="spatial-group-dimension-dbnum"]') as HTMLButtonElement).click();
    await nextTick();
    expect(roomStoreMocks.setGroupDimension).toHaveBeenCalledWith('dbnum');
    titles = Array.from(host.querySelectorAll('[data-testid="spatial-result-group-title"]')).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['库 7997', '库 24381']);
    expect(host.querySelector('[data-testid="spatial-result-group-load"]')?.textContent).toContain('加载本库');

    // legacy：没有 dbnumGroups → 不画切换、按专业
    stubState.groupDimension.value = 'spec';
    stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: true, nameSortExact: true, rooms: false, tree: false };
    const legacySet = makeResultSet(1);
    legacySet.dbnumGroups = null;
    stubState.resultSet.value = legacySet;
    await nextTick();
    expect(host.querySelector('[data-testid="spatial-group-dimension"]')).toBeNull();

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

  /** 结果动作那一排（PR-B2 剪辑后全是图标，靠 `aria-label` / `title` 找） */
  function actionButton(host: HTMLElement, label: string): HTMLButtonElement | null {
    return host.querySelector(`[data-testid="spatial-result-actions"] button[aria-label="${label}"]`) as HTMLButtonElement | null;
  }

  /** 「复制 Refno」是一个按钮点开二选：返回打开后的两个选项（树态 / 没有页时 `currentPage` 为 null） */
  async function openCopyMenu(host: HTMLElement) {
    const menu = host.querySelector('[data-testid="copy-refnos-menu"]') as HTMLButtonElement | null;
    expect(menu).toBeTruthy();
    expect(host.querySelector('[data-testid="copy-refnos-options"]')).toBeNull();
    menu?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="copy-refnos-options"]')).toBeTruthy();
    return {
      currentPage: host.querySelector('[data-testid="copy-current-page-refnos"]') as HTMLButtonElement | null,
      all: host.querySelector('[data-testid="copy-all-returned-refnos"]') as HTMLButtonElement | null,
    };
  }

  it('PR-B2 剪辑：结果动作收成一排图标——旧的九个文字按钮不再出现，动作行不必展开结果就在标题区', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();

    const texts = (Array.from(host.querySelectorAll('button')) as HTMLButtonElement[]).map((button) => button.textContent?.trim() ?? '');
    for (const gone of ['加载当前页', '只加载未加载', '全部显示', '全部隐藏', '隔离结果', '恢复场景', '复制当前页 Refno', '复制已返回 Refno', '清空']) {
      expect(texts, `旧按钮「${gone}」不该再以文字出现`).not.toContain(gone);
    }
    const actions = host.querySelector('[data-testid="spatial-result-actions"]');
    expect(actions).toBeTruthy();
    expect(Array.from(actions!.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual([
      '加载未加载（本页）', '全部显示', '全部隐藏', '隔离结果', '恢复场景', '复制 Refno', '清空',
    ]);
    // 每个图标都带 title（悬停可读）
    for (const button of Array.from(actions!.querySelectorAll('button'))) {
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
    }

    actionButton(host, '清空')?.click();
    await nextTick();
    expect(clearResults).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('复制 Refno 点开二选：「本页」按当前展示顺序输出；菜单缺省收起、复制后收起', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubState.resultSet.value = makeResultSet(3);

    const { host, unmount } = mountDrawer();
    await nextTick();

    const { currentPage } = await openCopyMenu(host);
    expect(currentPage).toBeTruthy();
    expect(currentPage?.textContent).toContain('本页');
    expect(currentPage?.textContent).toContain('3');
    currentPage?.click();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith('24381_100001\n24381_100002\n24381_100003');
    expect(host.querySelector('[data-testid="copy-refnos-options"]')).toBeNull();
    await flushMicrotasks();
    expect(host.textContent).toContain('已复制 3 个当前页 Refno');

    unmount();
  });

  it('复制 Refno「全部命中」：取回了全集就复制整个命中集合（跨页）；没有全集时退回已返回条目去重后保持结果顺序', async () => {
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

    let menu = await openCopyMenu(host);
    expect(menu.all?.textContent).toContain('全部命中');
    expect(menu.all?.textContent).toContain('3');
    menu.all?.click();
    await nextTick();
    expect(writeText).toHaveBeenLastCalledWith('24381_100001\n24381_100002\n24381_100003');

    // 有全集（翻页时 store 取回的 `fullMatches`）：复制的是全集，条数按全集算
    stubState.resultSet.value = {
      ...makeResultSet(3, { perPage: 3, total: 5 }),
      fullMatches: { refnos: ['24381_100001', '24381_100002', '24381_100003', '24381_100004', '24381_100005'], byDbnum: {}, bySpecValue: {}, total: 5, truncated: false },
    };
    await nextTick();
    menu = await openCopyMenu(host);
    expect(menu.all?.textContent).toContain('5');
    menu.all?.click();
    await nextTick();
    expect(writeText).toHaveBeenLastCalledWith('24381_100001\n24381_100002\n24381_100003\n24381_100004\n24381_100005');
    await flushMicrotasks();
    expect(host.textContent).toContain('已复制 5 个命中 Refno');

    unmount();
  });

  it('「加载未加载」平铺态只补本页（pages: current + onlyUnloaded），title 标「本页」；「加载当前页」已并进它', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();

    const button = host.querySelector('[data-testid="spatial-load-unloaded"]') as HTMLButtonElement | null;
    expect(button).toBeTruthy();
    expect(button?.getAttribute('title')).toBe('加载未加载（本页）');
    button?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledTimes(1);
    expect(loadResults).toHaveBeenCalledWith({ pages: 'current', onlyUnloaded: true, flyTo: true });

    unmount();
  });

  it('「加载未加载」超过 200 项先弹确认并显示数量：不超过直接加载，取消不加载，确认才加载', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();
    const clickUnloaded = () => {
      (host.querySelector('[data-testid="spatial-load-unloaded"]') as HTMLButtonElement | null)?.click();
    };
    const expectedOptions = { pages: 'current', onlyUnloaded: true, flyTo: true };

    // 正好 200：不弹框，直接加载；数量按 loadResults 同一套取法算
    countLoadTargets.mockReturnValue(200);
    clickUnloaded();
    await nextTick();
    expect(countLoadTargets).toHaveBeenCalledWith(expectedOptions);
    expect(confirmOpen).not.toHaveBeenCalled();
    expect(loadResults).toHaveBeenCalledWith(expectedOptions);

    // 1367：弹框、显示数量；取消 → 不加载
    loadResults.mockClear();
    countLoadTargets.mockReturnValue(1367);
    confirmOpen.mockResolvedValueOnce(false);
    clickUnloaded();
    await flushMicrotasks();
    expect(confirmOpen).toHaveBeenCalledTimes(1);
    const dialog = confirmOpen.mock.calls[0]![0];
    expect(dialog.title).toBe('加载数量较多');
    expect(dialog.message).toContain('「加载未加载」将加载 1367 个模型');
    expect(dialog.message).toContain('超过 200 个');
    expect(dialog.confirmText).toBe('加载 1367 个');
    expect(loadResults).not.toHaveBeenCalled();

    // 确认 → 加载
    clickUnloaded();
    await flushMicrotasks();
    expect(confirmOpen).toHaveBeenCalledTimes(2);
    expect(loadResults).toHaveBeenCalledTimes(1);
    expect(loadResults).toHaveBeenCalledWith(expectedOptions);

    unmount();
  });

  it('查看器动作图标可显示、隐藏、隔离、恢复当前结果集', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();

    actionButton(host, '全部显示')?.click();
    actionButton(host, '全部隐藏')?.click();
    actionButton(host, '隔离结果')?.click();
    actionButton(host, '恢复场景')?.click();
    await nextTick();

    expect(setAllResultsVisible).toHaveBeenCalledWith(true);
    expect(setAllResultsVisible).toHaveBeenCalledWith(false);
    expect(isolateResults).toHaveBeenCalledTimes(1);
    expect(restoreScene).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('构件行单行（PR-B2 剪辑）：有名字显名字、refno 进 title；没名字显 refno；未加载灰字；title = 名字 · refno · noun · 距离 · 未加载', async () => {
    const resultSet = makeResultSet(2);
    resultSet.items[0] = { ...resultSet.items[0]!, name: '/C-IY-1R330-B', loaded: true, distance: 1234 };
    resultSet.groups[0]!.items = resultSet.items;
    stubState.resultSet.value = resultSet;

    const { host, unmount } = mountDrawer();
    await nextTick();
    await expandResults(host);

    const rows = Array.from(host.querySelectorAll('[data-testid="spatial-result-row"]')) as HTMLElement[];
    expect(rows.map((row) => row.dataset.refno)).toEqual(['24381_100001', '24381_100002']);

    const named = rows[0]!.querySelector('button[title]') as HTMLButtonElement;
    expect(named.textContent).toContain('/C-IY-1R330-B');
    expect(named.textContent).not.toContain('24381_100001');
    expect(named.getAttribute('title')).toBe('/C-IY-1R330-B · 24381_100001 · PIPE · 1.234 m');
    expect(named.className).toContain('text-gray-800');

    // store 把没名字的构件 `name` 填成 refno 本身：行上显 refno（等宽），title 不重复名字、尾巴带「未加载」
    const unnamed = rows[1]!.querySelector('button[title]') as HTMLButtonElement;
    expect(unnamed.textContent).toContain('24381_100002');
    expect(unnamed.getAttribute('title')).toBe('24381_100002 · PIPE · 0.001 m · 未加载');
    expect(unnamed.className).toContain('text-gray-400');

    // 旧卡片的三个 chip（「已加载 / 未加载」字样）不再画在行上
    expect(rows[1]!.textContent).not.toContain('未加载');

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
    stubState.spatialCapabilities.value = { specValues: false, branCenterline: false, keywordMatchesName: false, nameSortExact: false, rooms: false, tree: false };
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

    // PR-B2 剪辑：摘要第二行只放小计（「共 N 项」在第一行），整行进 title
    expect(host.textContent).toContain('5 库24381 · 3 库24383 · 1 库24390');
    expect(host.textContent).not.toContain('共 9 项 · 5 库24381');
    expect(host.querySelector('[title="5 库24381 · 3 库24383 · 1 库24390"]')).toBeTruthy();
    expect(host.textContent).not.toContain('按专业分组');

    (host.querySelector('[data-testid="spatial-advanced-toggle"]') as HTMLButtonElement | null)?.click();
    await nextTick();
    expect(host.querySelector('[data-testid="spec-filter"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-sort-specThenDistance"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-sort-distanceAsc"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="spatial-sort-nameAsc"]')).toBeTruthy();

    await expandResults(host);
    // PR-B2 剪辑：覆盖面缩成一句，全文在 title
    const coverageHint = host.querySelector('[data-testid="spatial-coverage-hint"]');
    expect(coverageHint?.textContent?.trim()).toBe('只含已生成过模型的构件');
    expect(coverageHint?.getAttribute('title')).toContain('空间索引只收已生成的包围盒');
    expect(coverageHint?.getAttribute('title')).toContain('先显示它们再查会被纳入');
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

  it('树态（ADR 0068，选了房间）：结果区是层级树，房间列表 / 分页 / 分组开关不出现；「加载未加载」补整棵树（无 pages）；复制只给「全部（去重）」', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubState.spatialCapabilities.value = { specValues: true, branCenterline: true, keywordMatchesName: false, nameSortExact: false, rooms: true, tree: true };
    stubState.draft.rooms = [{ refno: '24381_35580', roomNum: 'R432', name: '/1RX-RM04-R432' }];

    const tree: SpatialTreeResult = {
      success: true,
      total_count: 3,
      candidate_count: 9,
      truncated_candidates: false,
      candidate_cap: 200000,
      leaves_inline: true,
      leaf_cap: 5000,
      leaf_count: 3,
      inlined: null,
      delivery_unit_types: ['BRAN', 'HANG', 'SUPPO', 'EQUI'],
      center: { x: 1, y: 2, z: 3, source: 'refno_aabb_center' },
      radius: 3000,
      shape: 'sphere',
      warnings: [],
      coverage: 'global-tree',
      spatial_state: 'ready',
      rooms: [{
        refno: '24381_35580',
        room_num: 'R432',
        name: '/1RX-RM04-R432',
        count: 3,
        specs: [
          { spec_value: 0, count: 1, unit_types: [], others: { count: 1, by_noun: [{ noun: 'PANE', count: 1, min_distance: 900, elements: [{ refno: '24381_100003', noun: 'PANE', distance: 900 }] }] } },
          {
            spec_value: 3,
            count: 2,
            unit_types: [{ noun: 'BRAN', count: 2, units: [{ refno: '24381_1200', noun: 'BRAN', name: '/C-IY-1R330-B', count: 2, min_distance: 100, elements: [{ refno: '24381_100001', noun: 'TUBI', distance: 100 }, { refno: '24381_100002', noun: 'ELBO', distance: 200 }] }] }],
            others: { count: 0, by_noun: [] },
          },
        ],
      }],
    };
    const base = makeResultSet(3, { perPage: 3, total: 3 });
    stubState.resultSet.value = {
      ...base,
      tree,
      fullMatches: { refnos: ['24381_100001', '24381_100002', '24381_100003'], byDbnum: {}, bySpecValue: {}, total: 3, truncated: false },
      coverage: 'global-tree',
    };

    const { host, unmount } = mountDrawer();
    await nextTick();

    // 「加载未加载」：树态没有页，补整棵树里没加载的
    const loadUnloaded = host.querySelector('[data-testid="spatial-load-unloaded"]') as HTMLButtonElement | null;
    expect(loadUnloaded?.getAttribute('title')).toBe('加载未加载（整棵树）');
    loadUnloaded?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });

    // 复制：没有「本页」，只有「全部（去重）」= 整棵树去重后的 refno
    const menu = await openCopyMenu(host);
    expect(menu.currentPage).toBeNull();
    expect(menu.all?.textContent).toContain('全部（去重）');
    expect(menu.all?.textContent).toContain('3');
    menu.all?.click();
    await nextTick();
    expect(writeText).toHaveBeenCalledWith('24381_100001\n24381_100002\n24381_100003');
    await flushMicrotasks();
    expect(host.textContent).toContain('已复制 3 个 Refno');

    await expandResults(host);
    expect(host.querySelector('[data-testid="spatial-tree-panel"]')).toBeTruthy();
    expect(host.textContent).toContain('R432');
    expect(host.querySelector('[data-testid="spatial-result-group"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-group-dimension"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-result-page-prev"]')).toBeNull();
    expect(host.querySelector('[data-testid="spatial-room-row"]')).toBeNull();
    expect(host.textContent).not.toContain('房间列表');

    unmount();
  });
});
