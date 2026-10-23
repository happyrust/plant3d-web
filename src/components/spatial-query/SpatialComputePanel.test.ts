import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import SpatialComputePanel from './SpatialComputePanel.vue';

import { resetSpatialComputeStore, useSpatialCompute } from '@/composables/useSpatialCompute';

/** viewerContext 桩：行悬停/跳转测试往里塞 viewport 与场景间谍。 */
const viewerContextStub = vi.hoisted(() => ({
  viewerRef: { value: null as unknown },
  dimensionSystem: { value: null as { viewport: { setHover: (id: string | null) => void } } | null },
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => viewerContextStub,
}));

const selectionStub = vi.hoisted(() => ({
  selectedRefno: { value: '' },
  setSelectedRefno: vi.fn(),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => selectionStub,
}));

/** 「范围显示」驱动的空间查询 store 桩：draft 真可变，四个动作记调用；结果集/错误可控。 */
const spatialQueryStub = vi.hoisted(() => {
  const draft = {
    mode: '',
    distanceCenterSource: '',
    refno: '',
    radius: 0,
    nounText: 'stale-noun',
    keyword: 'stale-kw',
    rooms: ['stale-room'],
    specValues: [7],
    includeNegative: true,
    onlyLoaded: true,
    onlyVisible: true,
  };
  return {
    draft,
    resultSet: { value: { items: [{ refno: '24381_9' }] } },
    error: { value: '' },
    setMode: vi.fn((mode: string) => { draft.mode = mode; }),
    submitQuery: vi.fn(async () => {}),
    loadResults: vi.fn(async () => {}),
    isolateResults: vi.fn(),
    isolateRefnos: vi.fn(),
    showOnlySceneObjects: vi.fn(),
    restoreScene: vi.fn(),
    ensureRefnosLoaded: vi.fn(async () => ({ ok: [], fail: [] })),
  };
});

vi.mock('@/composables/useSpatialQuery', () => ({
  useSpatialQuery: () => spatialQueryStub,
  // 恒等场景变换：跳转测试里 mm 端点原样进 aabb
  resolveSceneWorldTransform: () => ({ identity: true, aabbToScene: (aabb: number[]) => aabb }),
}));

function candidate(refno: string, noun: string, distance: number) {
  return {
    refno,
    noun,
    distance_mm: distance,
    intersects: false,
    nearest: {
      source_segment_refno: '24381_145019',
      source_segment_order: 3,
      source_point: { x: 1, y: 2, z: 3 },
      target_point: { x: 4, y: 5, z: 6 },
      vector: { dx: 3, dy: 3, dz: 3 },
    },
    annotation: { start_point: { x: 1, y: 2, z: 3 }, end_point: { x: 4, y: 5, z: 6 }, label_mm: distance },
  };
}

const nounGroupedResponse = {
  success: true,
  nearest_by_group: [
    { group: 'WALL', nouns: ['WALL'], candidates: [candidate('24381_1', 'WALL', 1200), candidate('24381_11', 'WALL', 2600)] },
    { group: 'SCTN', nouns: ['SCTN'], candidates: [candidate('24381_3', 'SCTN', 830)] },
  ],
  noun_counts: { WALL: 3, SCTN: 7 },
  excluded_self_members: 37,
};

function mountPanel() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(SpatialComputePanel) });
  app.mount(host);
  return {
    host,
    unmount: () => {
      app.unmount();
      host.remove();
    },
  };
}

/** `NOUN count|pressed`：noun 与计数是两个相邻 span（模板换行被 Vue 压掉，不能整段读 textContent）。 */
function chipTexts(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid^="bran-noun-chip-"]'))
    .map((chip) => {
      const spans = Array.from(chip.querySelectorAll('span')).map((span) => span.textContent?.trim() ?? '');
      return `${spans.join(' ')}|${chip.getAttribute('aria-pressed')}`;
    });
}

function rowStates(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll<HTMLElement>('[data-testid="bran-result-row"]'))
    .map((row) => `${row.querySelector('.font-mono')?.textContent?.trim()}|${row.dataset.drawn}`);
}

describe('SpatialComputePanel · BRAN 净距的类型 facet', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  beforeEach(() => {
    resetSpatialComputeStore();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(nounGroupedResponse), { status: 200 })));
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
    resetSpatialComputeStore();
  });

  it('offers wall/column/beam/slab choices and shows classification and query warnings', async () => {
    mounted = mountPanel();
    const select = mounted.host.querySelector<HTMLSelectElement>('[data-testid="structure-category"]')!;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['all', 'wall', 'column', 'beam', 'slab']);
    select.value = 'beam';
    select.dispatchEvent(new Event('change'));
    await nextTick();
    expect(useSpatialCompute().currentScenarioState.value.structureCategory).toBe('beam');
    expect(mounted.host.querySelector('[data-testid="structural-angle"]')).not.toBeNull();
    useSpatialCompute().currentScenarioState.value.warnings = ['缺少可靠轴线'];
    await nextTick();
    expect(mounted.host.querySelector('[data-testid="clearance-warnings"]')?.textContent).toContain('缺少可靠轴线');
  });

  it('计算前没有 facet、有 exclude_nouns 输入；计算后 chips 按桶序出现、带截断前计数、全部勾选，行按「已标注」高亮', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await nextTick();

    expect(host.querySelector('[data-testid="bran-noun-facet"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('[data-testid="bran-exclude-nouns"]')?.value).toBe('WELD,ATTA');
    // 目标组输入框已经不在 BRAN 场景里
    expect(host.textContent).not.toContain('target_groups');

    await store.submitScenario('branNearestClearance');
    await nextTick();

    expect(host.querySelector('[data-testid="bran-noun-facet"]')?.textContent).toContain('半径内 2 类 / 10 个候选');
    expect(host.querySelector('[data-testid="bran-noun-facet"]')?.textContent).toContain('已排除自身成员 37 个');
    expect(chipTexts(host)).toEqual(['WALL 3|true', 'SCTN 7|true']);
    expect(rowStates(host)).toEqual(['24381_1|true', '24381_11|false', '24381_3|true']);
    expect(host.querySelector('[data-testid="bran-draw-toggle-WALL:24381_1"]')?.textContent?.trim()).toBe('已标注');
    expect(host.querySelector('[data-testid="bran-draw-toggle-WALL:24381_11"]')?.textContent?.trim()).toBe('标注');
  });

  it('点 chip 只在前端过滤：行与标注候选跟着桶进出，fetch 不重发；清空后给出提示；行上的「标注」开关逐条切', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await store.submitScenario('branNearestClearance');
    await nextTick();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-chip-WALL"]')!.click();
    await nextTick();
    expect(chipTexts(host)).toEqual(['WALL 3|false', 'SCTN 7|true']);
    expect(rowStates(host)).toEqual(['24381_3|true']);
    expect(store.scenarios.branNearestClearance.annotationCandidates.map((item) => item.candidate.refno)).toEqual(['24381_3']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-facet-none"]')!.click();
    await nextTick();
    expect(rowStates(host)).toEqual([]);
    expect(host.textContent).toContain('所有类型都已取消勾选');

    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-facet-all"]')!.click();
    await nextTick();
    expect(rowStates(host)).toEqual(['24381_1|true', '24381_11|false', '24381_3|true']);

    host.querySelector<HTMLButtonElement>('[data-testid="bran-draw-toggle-WALL:24381_11"]')!.click();
    await nextTick();
    expect(rowStates(host)).toEqual(['24381_1|true', '24381_11|true', '24381_3|true']);
    expect(store.scenarios.branNearestClearance.annotationCandidates.map((item) => item.candidate.refno)).toEqual(['24381_1', '24381_11', '24381_3']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('SpatialComputePanel · BRAN 中心线范围显示', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  beforeEach(() => {
    resetSpatialComputeStore();
    vi.clearAllMocks();
    spatialQueryStub.error.value = '';
    spatialQueryStub.resultSet.value = { items: [{ refno: '24381_9' }] };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(nounGroupedResponse), { status: 200 })));
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
    resetSpatialComputeStore();
  });

  it('填范围点「显示范围内模型」：沿 BRAN 中心线查、清掉抽屉残留过滤、加载未加载并隔离（源 BRAN 保实体）', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.scenarios.branNearestClearance.suppoRefno = '24381/145018';
    store.scenarios.branNearestClearance.queriedSourceRefno = '24381_145018';

    const distance = host.querySelector<HTMLInputElement>('[data-testid="bran-range-distance"]')!;
    distance.value = '3200';
    distance.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('[data-testid="bran-range-show"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateResults).toHaveBeenCalledTimes(1));

    expect(spatialQueryStub.setMode).toHaveBeenCalledWith('distance');
    expect(spatialQueryStub.draft.distanceCenterSource).toBe('bran_centerline');
    expect(spatialQueryStub.draft.refno).toBe('24381_145018');
    expect(spatialQueryStub.draft.radius).toBe(3200);
    // 抽屉里残留的过滤不能漏进来
    expect(spatialQueryStub.draft.nounText).toBe('');
    expect(spatialQueryStub.draft.rooms).toEqual([]);
    expect(spatialQueryStub.draft.specValues).toEqual([]);
    expect(spatialQueryStub.draft.onlyLoaded).toBe(false);
    expect(spatialQueryStub.submitQuery).toHaveBeenCalledTimes(1);
    expect(spatialQueryStub.loadResults).toHaveBeenCalledWith({ onlyUnloaded: true, flyTo: true });
    expect(spatialQueryStub.isolateResults).toHaveBeenCalledWith(['24381_145018']);
  });

  it('没有 BRAN / 非法范围：内联报错且不发查询', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.scenarios.branNearestClearance.suppoRefno = '';
    store.scenarios.branNearestClearance.queriedSourceRefno = '';

    host.querySelector<HTMLButtonElement>('[data-testid="bran-range-show"]')!.click();
    await nextTick();
    expect(host.querySelector('[data-testid="bran-range-error"]')?.textContent).toContain('先选中一个 BRAN');
    expect(spatialQueryStub.submitQuery).not.toHaveBeenCalled();

    store.scenarios.branNearestClearance.suppoRefno = '24381_145018';
    const distance = host.querySelector<HTMLInputElement>('[data-testid="bran-range-distance"]')!;
    distance.value = '0';
    distance.dispatchEvent(new Event('input'));
    host.querySelector<HTMLButtonElement>('[data-testid="bran-range-show"]')!.click();
    await nextTick();
    expect(host.querySelector('[data-testid="bran-range-error"]')?.textContent).toContain('1–100000');
    expect(spatialQueryStub.submitQuery).not.toHaveBeenCalled();
  });

  it('查询报错 / 范围内无构件：显示错误且不加载不隔离；「恢复」调 restoreScene', async () => {
    spatialQueryStub.error.value = '';
    spatialQueryStub.resultSet.value = { items: [] };
    mounted = mountPanel();
    const { host } = mounted;
    useSpatialCompute().scenarios.branNearestClearance.suppoRefno = '24381_145018';

    host.querySelector<HTMLButtonElement>('[data-testid="bran-range-show"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.submitQuery).toHaveBeenCalledTimes(1));
    await nextTick();
    expect(host.querySelector('[data-testid="bran-range-error"]')?.textContent).toContain('范围内没有构件');
    expect(spatialQueryStub.loadResults).not.toHaveBeenCalled();
    expect(spatialQueryStub.isolateResults).not.toHaveBeenCalled();

    host.querySelector<HTMLButtonElement>('[data-testid="bran-range-restore"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.restoreScene).toHaveBeenCalledTimes(1));
  });
});

describe('SpatialComputePanel · BRAN 净距 X 光查看', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  beforeEach(() => {
    resetSpatialComputeStore();
    vi.clearAllMocks();
    spatialQueryStub.error.value = '';
    spatialQueryStub.resultSet.value = { items: [{ refno: '24381_9' }] };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(nounGroupedResponse), { status: 200 })));
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
    resetSpatialComputeStore();
  });

  it('开 X 光：源 BRAN + 已标注目标保实体；标注集变化自动重隔离；再点退出恢复场景', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await store.submitScenario('branNearestClearance');
    await nextTick();

    // 默认每类标注最近 1 条：24381_1(WALL) + 24381_3(SCTN)
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="bran-xray-toggle"]')!;
    expect(toggle.textContent?.trim()).toBe('X 光查看');
    toggle.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(1));
    expect(spatialQueryStub.isolateRefnos).toHaveBeenLastCalledWith(['24381_145018', '24381_1', '24381_3']);
    await nextTick();
    expect(toggle.textContent?.trim()).toBe('退出 X 光');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    // 取消 SCTN chip → 标注集变小 → 自动按新集重隔离
    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-chip-SCTN"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(2));
    expect(spatialQueryStub.isolateRefnos).toHaveBeenLastCalledWith(['24381_145018', '24381_1']);

    // 再点退出 → 恢复场景
    toggle.click();
    await vi.waitFor(() => expect(spatialQueryStub.restoreScene).toHaveBeenCalledTimes(1));
    await nextTick();
    expect(toggle.textContent?.trim()).toBe('X 光查看');
  });

  it('X 光开着时标注集清空 → 恢复场景但保留模式；候选回填自动重放；无候选且无模式时按钮禁用', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');

    // 没算过 → 按钮常驻但禁用（显眼位置可发现）
    expect(host.querySelector<HTMLButtonElement>('[data-testid="bran-xray-toggle"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="bran-only-toggle"]')!.disabled).toBe(true);

    await store.submitScenario('branNearestClearance');
    await nextTick();
    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="bran-xray-toggle"]')!;
    expect(toggle.disabled).toBe(false);
    toggle.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(1));

    // 清空全部 facet → 标注集为 0 → 恢复场景，但模式保留（补装几何触发的自动重查会先清再回填）
    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-facet-none"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.restoreScene).toHaveBeenCalledTimes(1));
    await nextTick();
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.disabled).toBe(false);

    // 勾回一类 → 候选回填 → 按当前模式自动重放（SCTN 桶的画出候选是 24381_3）
    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-chip-SCTN"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(2));
    expect(spatialQueryStub.isolateRefnos).toHaveBeenLastCalledWith(['24381_145018', '24381_3']);
  });

  it('仅显示：同集隐藏其余；从 X 光切过来先恢复再仅显示；再点退出', async () => {
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await store.submitScenario('branNearestClearance');
    await nextTick();

    const xrayBtn = host.querySelector<HTMLButtonElement>('[data-testid="bran-xray-toggle"]')!;
    const onlyBtn = host.querySelector<HTMLButtonElement>('[data-testid="bran-only-toggle"]')!;

    // 先开 X 光，再点「仅显示」→ 先 restoreScene 再按同集仅显示
    xrayBtn.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(1));
    onlyBtn.click();
    await vi.waitFor(() => expect(spatialQueryStub.showOnlySceneObjects).toHaveBeenCalledTimes(1));
    expect(spatialQueryStub.restoreScene).toHaveBeenCalledTimes(1);
    expect(spatialQueryStub.showOnlySceneObjects).toHaveBeenLastCalledWith(['24381_145018', '24381_1', '24381_3']);
    await nextTick();
    expect(onlyBtn.textContent?.trim()).toBe('退出仅显示');
    expect(onlyBtn.getAttribute('aria-pressed')).toBe('true');
    expect(xrayBtn.getAttribute('aria-pressed')).toBe('false');

    // 标注集变化 → 按仅显示模式重放（不是 isolateRefnos）
    host.querySelector<HTMLButtonElement>('[data-testid="bran-noun-chip-SCTN"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.showOnlySceneObjects).toHaveBeenCalledTimes(2));
    expect(spatialQueryStub.showOnlySceneObjects).toHaveBeenLastCalledWith(['24381_145018', '24381_1']);
    expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(1);

    // 再点「退出仅显示」→ 恢复场景
    onlyBtn.click();
    await vi.waitFor(() => expect(spatialQueryStub.restoreScene).toHaveBeenCalledTimes(2));
    await nextTick();
    expect(onlyBtn.textContent?.trim()).toBe('仅显示');
  });
});

describe('SpatialComputePanel · 行与三维标注联动', () => {
  let mounted: ReturnType<typeof mountPanel> | null = null;

  beforeEach(() => {
    resetSpatialComputeStore();
    vi.clearAllMocks();
    viewerContextStub.viewerRef.value = null;
    viewerContextStub.dimensionSystem.value = null;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(nounGroupedResponse), { status: 200 })));
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    vi.unstubAllGlobals();
    resetSpatialComputeStore();
  });

  it('悬停已标注行高亮对应净距尺寸，移开清 hover；未标注行不动 viewport', async () => {
    const setHover = vi.fn();
    viewerContextStub.dimensionSystem.value = { viewport: { setHover } };
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await store.submitScenario('branNearestClearance');
    await nextTick();

    const rows = host.querySelectorAll<HTMLElement>('[data-testid="bran-result-row"]');
    // 第一行 24381_1 已标注（WALL 桶 index 0）→ 悬停高亮它的尺寸
    rows[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    expect(setHover).toHaveBeenLastCalledWith('bran-clearance:wall:24381_1:0');
    rows[0]!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(setHover).toHaveBeenLastCalledWith(null);

    // 第二行 24381_11 未标注 → hover 没有任何调用
    setHover.mockClear();
    rows[1]!.dispatchEvent(new MouseEvent('mouseenter'));
    rows[1]!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(setHover).toHaveBeenCalledTimes(2);
    expect(setHover).toHaveBeenNthCalledWith(1, null);
    expect(setHover).toHaveBeenNthCalledWith(2, null);
  });

  it('「跳转」选中目标并飞到整条净距段（两端留 500mm）而不是构件包围盒', async () => {
    const flyTo = vi.fn();
    const scene = {
      ensureRefnos: vi.fn(),
      setObjectsVisible: vi.fn(),
      setObjectsSelected: vi.fn(),
      getAABB: vi.fn(() => [0, 0, 0, 1, 1, 1]),
    };
    viewerContextStub.viewerRef.value = { scene, cameraFlight: { flyTo } };
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await store.submitScenario('branNearestClearance');
    await nextTick();

    host.querySelector<HTMLElement>('[data-testid="bran-result-row"]')!
      .querySelectorAll('button')[2]!.click();  // 第三颗按钮 = 跳转
    await vi.waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));

    // 候选段 (1,2,3)→(4,5,6) mm + 500 裕度，恒等场景变换原样进 aabb
    expect(flyTo).toHaveBeenCalledWith({ aabb: [-499, -498, -497, 504, 505, 506], fit: true, duration: 0.8 });
    expect(selectionStub.setSelectedRefno).toHaveBeenCalledWith('24381_1');
    expect(spatialQueryStub.ensureRefnosLoaded).toHaveBeenCalledWith(['24381_1']);
    expect(scene.setObjectsSelected).toHaveBeenCalledWith(['24381_1'], true);

    // 未画出的候选行（第二行 24381_11，drawn=false）点「跳转」同样从 branGroups 取净距段 AABB 并补装几何
    flyTo.mockClear();
    host.querySelectorAll<HTMLElement>('[data-testid="bran-result-row"]')[1]!
      .querySelectorAll('button')[2]!.click();
    await vi.waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    expect(flyTo).toHaveBeenCalledWith({ aabb: [-499, -498, -497, 504, 505, 506], fit: true, duration: 0.8 });
    expect(spatialQueryStub.ensureRefnosLoaded).toHaveBeenLastCalledWith(['24381_11']);
  });

  describe('SpatialComputePanel · 算完定位（T1）', () => {
    let mounted: ReturnType<typeof mountPanel> | null = null;
    const flyTo = vi.fn();
    const ensureRefnos = vi.fn();
    // DTX 的 getAABB 传多个 refno 只回其中一个对象的盒——面板必须逐个取再合并
    const aabbByRefno: Record<string, number[]> = {
      '24381_145018': [0, 0, 0, 10, 10, 10],
      '24381_1': [-4, -2, 1, 2, 3, 5],
      '24381_3': [6, 1, 0, 12, 4, 2],
    };
    const getAABB = vi.fn((refnos: string[]) => aabbByRefno[refnos[0] ?? ''] ?? null);

    beforeEach(() => {
      resetSpatialComputeStore();
      vi.clearAllMocks();
      viewerContextStub.viewerRef.value = null;
      viewerContextStub.dimensionSystem.value = null;
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(nounGroupedResponse), { status: 200 })));
    });

    afterEach(() => {
      mounted?.unmount();
      mounted = null;
      vi.unstubAllGlobals();
      resetSpatialComputeStore();
    });

    it('算完把相机框到「源管道 + 最近目标」的联合包围盒，并选中原管道', async () => {
      viewerContextStub.viewerRef.value = { scene: { ensureRefnos, getAABB }, cameraFlight: { flyTo } };
      mounted = mountPanel();
      const { host } = mounted;
      const store = useSpatialCompute();
      store.setActiveScenario('branNearestClearance');
      store.scenarios.branNearestClearance.suppoRefno = '24381/145018';

    host.querySelector<HTMLButtonElement>('[data-testid="bran-compute-run"]')!.click();
    await vi.waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));

    // 源 BRAN 整根 + 本次画出的最近目标（WALL 桶第一根、SCTN 桶那根；未画出的 24381_11 不在内）
    // 定位框 = 本次算出的净距段端点（管表面点 + 目标点，E3D 世界 mm，±1500mm 余量）
    expect(flyTo).toHaveBeenCalledWith({ aabb: [-1499, -1498, -1497, 1504, 1505, 1506], fit: true, duration: 0.8 });
    expect(selectionStub.setSelectedRefno).toHaveBeenCalledWith('24381_145018');
    // 几何补装在后台跑，不阻塞定位
    expect(spatialQueryStub.ensureRefnosLoaded).toHaveBeenCalled();
    });

    it('算完自动隔离：源管 + 最近目标实体、其余半透明（按钮变「退出 X 光」，可再点退出）', async () => {
      viewerContextStub.viewerRef.value = { scene: { ensureRefnos, getAABB }, cameraFlight: { flyTo } };
      mounted = mountPanel();
      const { host } = mounted;
      const store = useSpatialCompute();
      store.setActiveScenario('branNearestClearance');
      store.scenarios.branNearestClearance.suppoRefno = '24381/145018';

    host.querySelector<HTMLButtonElement>('[data-testid="bran-compute-run"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledTimes(1));
    // 源 BRAN 整根 + 本次画出的最近目标（未画出的 24381_11 不在内）
    expect(spatialQueryStub.isolateRefnos).toHaveBeenCalledWith(['24381_145018', '24381_1', '24381_3']);
    await nextTick();
    expect(host.querySelector('[data-testid="bran-xray-toggle"]')?.textContent?.trim()).toBe('退出 X 光');

    // 再点一次退出 → 还原场景、按钮回到「X 光查看」
    host.querySelector<HTMLButtonElement>('[data-testid="bran-xray-toggle"]')!.click();
    await vi.waitFor(() => expect(spatialQueryStub.restoreScene).toHaveBeenCalled());
    expect(host.querySelector('[data-testid="bran-xray-toggle"]')?.textContent?.trim()).toBe('X 光查看');
    });

    it('查询失败时不乱动相机', async () => {
      viewerContextStub.viewerRef.value = { scene: { ensureRefnos, getAABB }, cameraFlight: { flyTo } };
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"error":"boom"}', { status: 500 })));
      mounted = mountPanel();
      const { host } = mounted;
      const store = useSpatialCompute();
      store.setActiveScenario('branNearestClearance');
      store.scenarios.branNearestClearance.suppoRefno = '24381/145018';

    host.querySelector<HTMLButtonElement>('[data-testid="bran-compute-run"]')!.click();
    await vi.waitFor(() => expect(store.currentScenarioState.value.error).not.toBe(''));
    expect(flyTo).not.toHaveBeenCalled();
    // 失败就不隔离：场景保持原样
    expect(spatialQueryStub.isolateRefnos).not.toHaveBeenCalled();
    });
  });

  it('包围盒相交的候选给「相交?」徽标和琥珀色距离，行数据带 intersects', async () => {
    const response = {
      ...nounGroupedResponse,
      nearest_by_group: [
        { group: 'WALL', nouns: ['WALL'], candidates: [{ ...candidate('24381_1', 'WALL', 0), intersects: true }] },
      ],
    };
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(response), { status: 200 })));
    mounted = mountPanel();
    const { host } = mounted;
    const store = useSpatialCompute();
    store.setActiveScenario('branNearestClearance');
    await store.submitScenario('branNearestClearance');
    await nextTick();

    expect(store.currentScenarioState.value.resultRows[0]?.intersects).toBe(true);
    const row = host.querySelector<HTMLElement>('[data-testid="bran-result-row"]')!;
    expect(row.textContent).toContain('相交?');
    expect(row.querySelector('.text-amber-600')).not.toBeNull();
  });

  it('D5 双向跳转：点击「去查周边管道净距 →」把当前 BRAN 带入 usePipeDistanceStore 并触发 panel.pipeDistance.open', async () => {
    const { usePipeDistanceStore } = await import('@/composables/usePipeDistanceStore');
    const { onCommand } = await import('@/ribbon/commandBus');
    const commands: string[] = [];
    const off = onCommand((id) => commands.push(id));
    try {
      mounted = mountPanel();
      const { host } = mounted;
      const store = useSpatialCompute();
      store.setActiveScenario('branNearestClearance');
      store.scenarios.branNearestClearance.suppoRefno = '24381/146830';
      await nextTick();

      const jumpBtn = host.querySelector<HTMLButtonElement>('[data-testid="bran-jump-pipe-nearby"]');
      expect(jumpBtn).not.toBeNull();
      jumpBtn!.click();

      const pipeStore = usePipeDistanceStore();
      expect(pipeStore.detectionMode.value).toBe('all-pairs');
      expect(pipeStore.selectedBranRefnos.value).toEqual(['24381_146830']);
      expect(commands).toContain('panel.pipeDistance.open');
    } finally {
      off();
    }
  });
});
