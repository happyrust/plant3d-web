import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import SpatialComputePanel from './SpatialComputePanel.vue';

import { resetSpatialComputeStore, useSpatialCompute } from '@/composables/useSpatialCompute';

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => ({ viewerRef: { value: null } }),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => ({ selectedRefno: { value: '' } }),
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
    expect(host.querySelector('[data-testid="bran-noun-facet"]')?.textContent).toContain('已排除 BRAN 自身成员 37 个');
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
