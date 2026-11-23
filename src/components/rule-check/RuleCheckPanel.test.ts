import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

const {
  fetchAllRuleCatalogsMock,
  runSpatialRuleCheckMock,
  runBranRuleCheckMock,
  runRoomRuleCheckMock,
  runAttrRuleCheckMock,
} = vi.hoisted(() => ({
  fetchAllRuleCatalogsMock: vi.fn(),
  runSpatialRuleCheckMock: vi.fn(),
  runBranRuleCheckMock: vi.fn(),
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

async function flushUi() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe('RuleCheckPanel', () => {
  let host: HTMLDivElement;
  let app: ReturnType<typeof createApp> | null = null;

  beforeEach(() => {
    resetRuleCheckStore();
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
});
