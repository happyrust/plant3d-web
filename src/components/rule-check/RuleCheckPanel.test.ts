import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

const {
  fetchAllRuleCatalogsMock,
  runSpatialRuleCheckMock,
  runBranRuleCheckMock,
  runBranRuleCheckAllMock,
  runRoomRuleCheckMock,
  runAttrRuleCheckMock,
} = vi.hoisted(() => ({
  fetchAllRuleCatalogsMock: vi.fn(),
  runSpatialRuleCheckMock: vi.fn(),
  runBranRuleCheckMock: vi.fn(),
  runBranRuleCheckAllMock: vi.fn(),
  runRoomRuleCheckMock: vi.fn(),
  runAttrRuleCheckMock: vi.fn(),
}));

vi.mock('@/api/ruleCheckApi', async () => {
  const actual = await vi.importActual<typeof import('@/api/ruleCheckApi')>('@/api/ruleCheckApi');
  return {
    ...actual,
    fetchAllRuleCatalogs: fetchAllRuleCatalogsMock,
    runSpatialRuleCheck: runSpatialRuleCheckMock,
    runBranRuleCheck: runBranRuleCheckMock,
    runBranRuleCheckAll: runBranRuleCheckAllMock,
    runRoomRuleCheck: runRoomRuleCheckMock,
    runAttrRuleCheck: runAttrRuleCheckMock,
  };
});

const viewerContextStub = vi.hoisted(() => ({
  viewerRef: { value: null as unknown },
}));

vi.mock('@/composables/useViewerContext', () => ({
  useViewerContext: () => viewerContextStub,
}));

const selectionStub = vi.hoisted(() => ({
  selectedRefno: { value: '24381_777' },
  setSelectedRefno: vi.fn(),
}));

vi.mock('@/composables/useSelectionStore', () => ({
  useSelectionStore: () => selectionStub,
}));

const spatialQueryStub = vi.hoisted(() => ({
  ensureRefnosLoaded: vi.fn(async () => ({ ok: [], fail: [] })),
}));

vi.mock('@/composables/useSpatialQuery', () => ({
  useSpatialQuery: () => spatialQueryStub,
}));

import RuleCheckPanel from './RuleCheckPanel.vue';

import { resetRuleCheckStore } from '@/composables/useRuleCheck';
import { resetRuleCheckOverlayStore } from '@/composables/useRuleCheckOverlay';

async function flushUi() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('RuleCheckPanel', () => {
  let host: HTMLDivElement;
  let app: ReturnType<typeof createApp> | null = null;

  beforeEach(() => {
    resetRuleCheckStore();
    resetRuleCheckOverlayStore();
    host = document.createElement('div');
    document.body.appendChild(host);
    selectionStub.setSelectedRefno.mockReset();
    spatialQueryStub.ensureRefnosLoaded.mockReset().mockResolvedValue({ ok: [], fail: [] });

    fetchAllRuleCatalogsMock.mockReset().mockResolvedValue({
      rules: [
        { engine: 'spatial', id: 'LAY-189', issue: 189, discipline: '布置', title: '净距规则', requirement: '>=500mm' },
        { engine: 'attrs', id: 'ELEC-282', issue: 282, discipline: '电气', title: '火灾分区', requirement: '红黄高亮' },
      ],
      warnings: [],
    });
    runSpatialRuleCheckMock.mockReset().mockResolvedValue({
      tree_state: 'ready',
      rules_run: 1,
      elapsed_ms: 9,
      warnings: [],
      results: [
        {
          id: 'LAY-189',
          issue: 189,
          discipline: '布置',
          title: '净距规则',
          requirement: '>=500mm',
          unit: 'mm',
          source_items: 2,
          target_items: 2,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              source: { refno: '24381_10', noun: 'PIPE' },
              target: { refno: '24381_20', noun: 'WALL' },
              measured_mm: 240,
              threshold_mm: 500,
              margin_mm: -260,
              highlight_refnos: ['24381_10', '24381_20'],
            },
          ],
        },
      ],
    });
    runRoomRuleCheckMock.mockReset().mockResolvedValue({
      tree_state: 'ready',
      room_count: 1,
      rules_run: 0,
      elapsed_ms: 2,
      warnings: [],
      results: [],
    });
    runAttrRuleCheckMock.mockReset().mockResolvedValue({
      tree_state: 'ready',
      rules_run: 1,
      elapsed_ms: 3,
      warnings: [],
      results: [
        {
          id: 'ELEC-282',
          issue: 282,
          discipline: '电气',
          title: '火灾分区',
          requirement: '红黄高亮',
          checked_items: 1,
          violation_total: 1,
          truncated: false,
          violations: [
            {
              source_refno: '24381_500',
              source_noun: 'CTRAY',
              highlight_color: 'red',
              highlight_refnos: ['24381_500', '24381_501'],
              detail: '扩散性火灾分区',
            },
          ],
        },
      ],
    });
    runBranRuleCheckMock.mockReset();
    runBranRuleCheckAllMock.mockReset();
    viewerContextStub.viewerRef.value = null;
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    host.remove();
  });

  it('loads catalogs on mount, executes rule check, renders badges, and focuses 3D viewer on click', async () => {
    const ensureRefnos = vi.fn();
    const setObjectsVisible = vi.fn();
    const setObjectsSelected = vi.fn();
    const getAABB = vi.fn(() => [0, 0, 0, 10, 10, 10]);
    const flyTo = vi.fn();
    viewerContextStub.viewerRef.value = {
      scene: { ensureRefnos, setObjectsVisible, setObjectsSelected, getAABB },
      cameraFlight: { flyTo },
    };

    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();

    expect(host.querySelector('[data-testid="rule-check-total-count"]')?.textContent?.trim()).toBe('2 条');

    const runBtn = host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]');
    expect(runBtn).not.toBeNull();
    runBtn!.click();
    await flushUi();

    const rows = host.querySelectorAll('[data-testid="rule-check-violation-row"]');
    expect(rows.length).toBe(2);
    expect(host.textContent).toContain('扩散性火灾');
    expect(host.textContent).toContain('实测 240.0 mm');

    const focusBtns = host.querySelectorAll<HTMLButtonElement>('[data-testid="rule-check-focus-btn"]');
    focusBtns[0]!.click();
    await flushUi();

    expect(selectionStub.setSelectedRefno).toHaveBeenCalledWith('24381_10');
    expect(spatialQueryStub.ensureRefnosLoaded).toHaveBeenCalledWith(['24381_10', '24381_20']);
    expect(ensureRefnos).toHaveBeenCalledWith(['24381_10', '24381_20']);
    expect(setObjectsVisible).toHaveBeenCalledWith(['24381_10', '24381_20'], true);
    expect(setObjectsSelected).toHaveBeenCalledWith(['24381_10', '24381_20'], true);
    expect(flyTo).toHaveBeenCalledWith({ aabb: [0, 0, 0, 10, 10, 10], fit: true, duration: 0.8 });
  });

  it('applies and restores firezone 3D overlay and exports CSV/JSON reports', async () => {
    const setObjectColor = vi.fn();
    const resetObjectColor = vi.fn();
    const setObjectsXRayed = vi.fn();
    const requestRender = vi.fn();

    viewerContextStub.viewerRef.value = {
      __dtxLayer: {
        getAllObjectIds: () => ['o:24381_500:0', 'o:24381_501:0', 'o:24381_10:0'],
        setObjectColor,
        resetObjectColor,
      },
      requestRender,
      scene: {
        getLoadedRefnos: () => ['24381_500', '24381_501', '24381_10'],
        ensureRefnos: vi.fn(),
        setObjectsVisible: vi.fn(),
        setObjectsSelected: vi.fn(),
        setObjectsXRayed,
        getAABB: vi.fn(() => null),
      },
      cameraFlight: { flyTo: vi.fn() },
    };

    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]')!.click();
    await flushUi();

    const fireBtn = host.querySelector<HTMLButtonElement>('[data-testid="rule-check-firezone-overlay-btn"]');
    expect(fireBtn).not.toBeNull();
    fireBtn!.click();
    await flushUi();

    expect(setObjectColor).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="rule-check-overlay-legend"]')?.textContent).toContain('已着色 2 构件 / 2 图元');

    const clearBtn = host.querySelector<HTMLButtonElement>('[data-testid="rule-check-clear-overlay-btn"]');
    expect(clearBtn).not.toBeNull();
    clearBtn!.click();
    await flushUi();
    expect(resetObjectColor).toHaveBeenCalledTimes(2);

    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-export-csv-btn"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-export-json-btn"]')!.click();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    createSpy.mockRestore();
    revokeSpy.mockRestore();
    clickSpy.mockRestore();
  });

  it('filters results by severity/keyword, toggles rule grouping with collapse, and focuses group refnos', async () => {
    const setObjectsSelected = vi.fn();
    const flyTo = vi.fn();
    viewerContextStub.viewerRef.value = {
      scene: {
        ensureRefnos: vi.fn(),
        setObjectsVisible: vi.fn(),
        setObjectsSelected,
        getAABB: vi.fn(() => [1, 2, 3, 4, 5, 6]),
      },
      cameraFlight: { flyTo },
    };

    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]')!.click();
    await flushUi();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(2);

    // 切到「火灾分区」结果快筛 → 仅剩 1 条，并展示 1/2 过滤计数
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-result-filter-firezone"]')!.click();
    await flushUi();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(1);
    expect(host.querySelector('[data-testid="rule-check-result-filtered-count"]')?.textContent?.trim()).toBe('1/2');

    // 切到「按规则分组」→ 展开/折叠组，点击「定位本组」聚焦该组全部 refno
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-group-toggle-btn"]')!.click();
    await flushUi();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-group"]').length).toBe(1);

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-focus-group-btn"]')!.click();
    await flushUi();
    expect(setObjectsSelected).toHaveBeenCalledWith(['24381_500', '24381_501'], true);
    expect(flyTo).toHaveBeenCalledWith({ aabb: [1, 2, 3, 4, 5, 6], fit: true, duration: 0.8 });

    // 折叠组头后子违规行隐藏
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-group-header"]')!.click();
    await flushUi();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(0);
  });

  it('requests precise review and labels exact and estimated rows with an accuracy filter', async () => {
    runSpatialRuleCheckMock.mockResolvedValue({
      tree_state: 'ready',
      precise: true,
      rules_run: 1,
      elapsed_ms: 9,
      warnings: [],
      results: [
        {
          id: 'LAY-189',
          issue: 189,
          discipline: '布置',
          title: '净距规则',
          requirement: '>=500mm',
          unit: 'mm',
          source_items: 3,
          target_items: 3,
          violation_total: 2,
          truncated: false,
          precise: { refinable: true, aabb_findings: 5, candidates: 7, exact: 6, unavailable: 1, cleared: 3 },
          violations: [
            {
              source: { refno: '24381_10', noun: 'PIPE' },
              target: { refno: '24381_20', noun: 'WALL' },
              measured_mm: 240,
              threshold_mm: 500,
              margin_mm: -260,
              highlight_refnos: ['24381_10', '24381_20'],
              accuracy: 'exact-surface',
              exact_surface_mm: 290,
            },
            {
              source: { refno: '24381_11', noun: 'PIPE' },
              target: { refno: '24381_21', noun: 'WALL' },
              measured_mm: 0,
              threshold_mm: 500,
              margin_mm: -500,
              highlight_refnos: ['24381_11', '24381_21'],
              accuracy: 'aabb',
              copy_named: true,
            },
          ],
        },
      ],
    });

    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();

    const preciseInput = host.querySelector<HTMLInputElement>('[data-testid="rule-check-precise-input"]');
    expect(preciseInput).not.toBeNull();
    preciseInput!.checked = true;
    preciseInput!.dispatchEvent(new Event('change'));
    await flushUi();

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]')!.click();
    await flushUi();

    expect(runSpatialRuleCheckMock).toHaveBeenCalledWith(undefined, expect.anything(), { precise: true });
    expect(host.querySelector('[data-testid="rule-check-precise-summary"]')?.textContent).toContain('精算剔除');
    const badges = Array.from(host.querySelectorAll('[data-testid="rule-check-accuracy-badge"]')).map((el) =>
      el.textContent?.trim(),
    );
    expect(badges).toEqual(['精算', '估算']);
    expect(host.querySelectorAll('[data-testid="rule-check-copy-badge"]').length).toBe(1);
    expect(host.textContent).toContain('外表面 290.0 mm');

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-filter-toggle"]')!.click();
    await flushUi();
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-accuracy-filter-aabb"]')!.click();
    await flushUi();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(1);
    expect(host.querySelector('[data-testid="rule-check-active-filter"]')?.textContent).toContain('口径：估算');
    expect(host.querySelector('[data-testid="rule-check-result-filtered-count"]')?.textContent?.trim()).toBe('1/3');
  });

  it('folds the run settings into a one-line summary after a run and reopens them on demand', async () => {
    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();
    expect(host.querySelector('[data-testid="rule-check-settings"]')).not.toBeNull();

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]')!.click();
    await flushUi();

    expect(host.querySelector('[data-testid="rule-check-settings"]')).toBeNull();
    const summary = host.querySelector<HTMLButtonElement>('[data-testid="rule-check-settings-summary"]');
    expect(summary?.textContent).toContain('全部引擎 · 全专业');
    expect(summary?.textContent).toContain('BRAN 未填');
    expect(host.querySelector('[data-testid="rule-check-run-meta"]')?.textContent).toMatch(/用时 \d+ ms/);

    summary!.click();
    await flushUi();
    expect(host.querySelector('[data-testid="rule-check-settings"]')).not.toBeNull();
  });

  it('shows per-engine progress, lists finished engines first, and retries a failed engine alone', async () => {
    const attrResponse = await runAttrRuleCheckMock();
    runAttrRuleCheckMock.mockClear();
    const attrs = deferred<unknown>();
    runAttrRuleCheckMock.mockReturnValueOnce(attrs.promise);
    runRoomRuleCheckMock.mockRejectedValueOnce(new Error('gen-model 请求失败 GET /api/v1/rule-check/rooms/run: Failed to fetch'));

    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]')!.click();
    await flushUi();

    const runStatus = (engine: string) =>
      host.querySelector(`[data-testid="rule-check-engine-run-${engine}"]`)?.getAttribute('data-status');
    expect(host.querySelector('[data-testid="rule-check-progress"]')).not.toBeNull();
    expect(runStatus('spatial')).toBe('done');
    expect(runStatus('rooms')).toBe('failed');
    expect(runStatus('attrs')).toBe('running');
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(1);

    attrs.resolve(attrResponse);
    await flushUi();

    expect(host.querySelector('[data-testid="rule-check-progress"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(2);
    const roomsChip = () => host.querySelector('[data-testid="rule-check-engine-chip-rooms"]');
    expect(roomsChip()?.getAttribute('data-status')).toBe('failed');

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-engine-retry-rooms"]')!.click();
    await flushUi();

    expect(runRoomRuleCheckMock).toHaveBeenCalledTimes(2);
    expect(runSpatialRuleCheckMock).toHaveBeenCalledTimes(1);
    expect(roomsChip()?.getAttribute('data-status')).toBe('done');
  });

  it('expands a row into details, isolates it in 3D, and narrows the list to its rule', async () => {
    const setObjectColor = vi.fn();
    const setObjectsXRayed = vi.fn();
    viewerContextStub.viewerRef.value = {
      __dtxLayer: {
        getAllObjectIds: () => ['o:24381_10:0', 'o:24381_20:0', 'o:24381_500:0'],
        setObjectColor,
        resetObjectColor: vi.fn(),
      },
      requestRender: vi.fn(),
      scene: {
        getLoadedRefnos: () => ['24381_10', '24381_20', '24381_500'],
        ensureRefnos: vi.fn(),
        setObjectsVisible: vi.fn(),
        setObjectsSelected: vi.fn(),
        setObjectsXRayed,
        getAABB: vi.fn(() => null),
      },
      cameraFlight: { flyTo: vi.fn() },
    };

    app = createApp({ render: () => h(RuleCheckPanel) });
    app.mount(host);
    await flushUi();
    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-run-btn"]')!.click();
    await flushUi();

    host.querySelectorAll<HTMLElement>('[data-testid="rule-check-violation-row"]')[0]!.click();
    await flushUi();
    const details = host.querySelector('[data-testid="rule-check-violation-details"]');
    expect(details?.textContent).toContain('规范要求');
    expect(details?.textContent).toContain('24381_10, 24381_20');

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-detail-isolate"]')!.click();
    await flushUi();
    expect(setObjectColor).toHaveBeenCalledTimes(2);
    expect(setObjectsXRayed).toHaveBeenCalledWith(['24381_500'], true);
    expect(host.textContent).toContain('隔离显示中');

    host.querySelector<HTMLButtonElement>('[data-testid="rule-check-detail-only-rule"]')!.click();
    await flushUi();
    expect(host.querySelectorAll('[data-testid="rule-check-violation-row"]').length).toBe(1);
    expect(host.querySelector('[data-testid="rule-check-active-filter"]')?.textContent).toContain('规则：LAY-189');
    expect(host.querySelector('[data-testid="rule-check-result-filtered-count"]')?.textContent?.trim()).toBe('1/2');
  });
});
