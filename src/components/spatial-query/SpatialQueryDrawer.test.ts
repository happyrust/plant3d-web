import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, ref, type Ref } from 'vue';

import SpatialQueryDrawer from './SpatialQueryDrawer.vue';

import type {
  SpatialQueryDraft,
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

describe('SpatialQueryDrawer (distance 模式)', () => {
  beforeEach(() => {
    applyCurrentSelection.mockReset();
    startPickCenter.mockReset();
    submitQuery.mockReset();
    setMode.mockClear();
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
    expect(slider?.min).toBe('100');
    expect(slider?.max).toBe('10000');

    if (slider) {
      slider.value = '2500';
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
    expect(presets[0].textContent).toContain('100 mm');
    expect(presets[1].textContent).toContain('500 mm');

    presets[2].click(); // 1000 mm
    await nextTick();

    expect(stubState.draft.radius).toBe(1000);
    const reread = Array.from(host.querySelectorAll('[data-testid="radius-preset"]')) as HTMLButtonElement[];
    expect(reread[2].className).toContain('bg-[#FFF1E8]');

    unmount();
  });

  it('distance 模式下不显示半径 number input（只留最大结果数）', async () => {
    const { host, unmount } = mountDrawer();
    await nextTick();

    const allLabels = Array.from(host.querySelectorAll('label')) as HTMLLabelElement[];
    const radiusLabel = allLabels.find((label) => label.textContent?.includes('查询半径 (mm)'));
    expect(radiusLabel).toBeUndefined();
    const limitLabel = allLabels.find((label) => label.textContent?.includes('最大结果数'));
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
    const radiusLabel = allLabels.find((label) => label.textContent?.includes('查询半径 (mm)'));
    expect(radiusLabel).toBeDefined();

    unmount();
  });
});
