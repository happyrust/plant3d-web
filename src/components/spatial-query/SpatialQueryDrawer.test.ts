import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, ref, type Ref } from 'vue';

import SpatialQueryDrawer from './SpatialQueryDrawer.vue';

import type {
  SpatialQueryDraft,
  SpatialQueryResultItem,
  SpatialQueryResultSet,
  SpatialQueryStatus,
} from '@/types/spatialQuery';

type DraftState = SpatialQueryDraft;

const applyCurrentSelection = vi.fn();
const startPickCenter = vi.fn();
const submitQuery = vi.fn();
const clearResults = vi.fn();
const activateResult = vi.fn();
const loadResults = vi.fn();
const showOnlySpecGroup = vi.fn();
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
    specValues: [],
    limit: 200,
  }) as DraftState,
  status: ref<SpatialQueryStatus>('idle') as Ref<SpatialQueryStatus>,
  error: ref<string | null>(null) as Ref<string | null>,
  resultSet: ref<SpatialQueryResultSet | null>(null) as Ref<SpatialQueryResultSet | null>,
  activeResultRefno: ref<string | null>(null) as Ref<string | null>,
  canSubmit: ref(true) as Ref<boolean>,
};

vi.mock('@/composables/useSpatialQuery', () => ({
  useSpatialQuery: () => ({
    ...stubState,
    setMode,
    applyCurrentSelection,
    startPickCenter,
    submitQuery,
    clearResults,
    activateResult,
    loadResults,
    showOnlySpecGroup,
    toggleResultVisible,
    setAllResultsVisible,
    isolateResults,
    restoreScene,
  }),
}));

vi.mock('@/composables/useRoomInfoPanel', () => ({
  resolveContainingRoomInfo: vi.fn(async () => null),
  useRoomInfoPanel: () => ({
    openForRefno: vi.fn(async () => null),
    showRoomModel: vi.fn(async () => undefined),
  }),
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
    specValues: [],
    limit: 200,
  };
  Object.assign(stubState.draft, initial);
  stubState.status.value = 'idle';
  stubState.error.value = null;
  stubState.resultSet.value = null;
  stubState.activeResultRefno.value = null;
  stubState.canSubmit.value = true;
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

describe('SpatialQueryDrawer (distance 模式)', () => {
  beforeEach(() => {
    applyCurrentSelection.mockReset();
    startPickCenter.mockReset();
    submitQuery.mockReset();
    clearResults.mockReset();
    activateResult.mockReset();
    loadResults.mockReset();
    showOnlySpecGroup.mockReset();
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
    expect(updatedDot?.className).toContain('bg-emerald-500');
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
    expect(reread[2].className).toContain('bg-[#FFF1E8]');

    unmount();
  });

  it('distance 模式下不显示半径 number input（只留每页数量）', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const allLabels = Array.from(host.querySelectorAll('label')) as HTMLLabelElement[];
    const radiusLabel = allLabels.find((label) => label.textContent?.includes('查询半径 (m)'));
    expect(radiusLabel).toBeUndefined();
    const limitLabel = allLabels.find((label) => label.textContent?.includes('每页数量'));
    expect(limitLabel).toBeDefined();

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
    expect(slider).toBeNull();

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

    expect(host.textContent).toContain('每页 20 项');
    expect(host.textContent).toContain('当前 1-20 / 25');
    expect(host.textContent).toContain('第 1 / 2 页');
    expect(host.textContent).toContain('24381_100001');
    expect(host.textContent).not.toContain('24381_100021');

    const nextButton = host.querySelector('[data-testid="spatial-result-page-next"]') as HTMLButtonElement | null;
    expect(nextButton).toBeTruthy();
    nextButton?.click();
    await nextTick();
    expect(submitQuery).toHaveBeenCalledWith(2);

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

    const copyButton = host.querySelector('[data-testid="copy-all-returned-refnos"]') as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();
    copyButton?.click();
    await nextTick();

    expect(writeText).toHaveBeenCalledWith('24381_100001\n24381_100002\n24381_100003');

    unmount();
  });

  it('加载当前页与只加载未加载结果按钮传递正确参数', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();

    const allButtons = Array.from(host.querySelectorAll('button')) as HTMLButtonElement[];
    allButtons.find((button) => button.textContent?.includes('加载当前页模型'))?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ flyTo: true });

    allButtons.find((button) => button.textContent?.includes('只加载当前页未加载'))?.click();
    await nextTick();
    expect(loadResults).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });

    unmount();
  });

  it('查看器动作按钮可显示、隐藏、隔离、恢复当前结果集', async () => {
    stubState.resultSet.value = makeResultSet(2);

    const { host, unmount } = mountDrawer();
    await nextTick();

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

    const visibilityButton = host.querySelector('button[title="隐藏"]') as HTMLButtonElement | null;
    expect(visibilityButton).toBeTruthy();
    visibilityButton?.click();
    await nextTick();

    expect(toggleResultVisible).toHaveBeenCalledWith(stubState.resultSet.value.items[0]);
    expect(stubState.resultSet.value?.items.map((item) => item.refno)).toEqual(['24381_100001']);

    unmount();
  });
});
