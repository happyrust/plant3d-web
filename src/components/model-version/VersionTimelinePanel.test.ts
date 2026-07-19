/**
 * VersionTimelinePanel 组件测试（specs/004-model-version-timeline T009/T010，含 T012 操作区）。
 *
 * mock 策略：
 * - `@/api/modelVersionApi` 全量 mock（参考 useVersionTimelineStore.test.ts 的写法）；
 * - `useVersionTimelineStore` 每次挂载返回全新 store，隔离用例间单例状态；
 * - `@tanstack/vue-virtual` 在 happy-dom 无真实布局，mock 为渲染全部行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import VersionTimelinePanel from './VersionTimelinePanel.vue';

import type { ModelHistoryAnchor, ModelReleaseRecord } from '@/api/modelVersionApi';

import { toDayKey } from '@/composables/useVersionTimelineStore';

vi.mock('@/api/modelVersionApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/modelVersionApi')>();
  return {
    ...actual,
    listReleases: vi.fn(),
    listAnchors: vi.fn(),
    getReleaseDiff: vi.fn(),
    getCompareReadiness: vi.fn(),
  };
});

vi.mock('@/composables/useVersionTimelineStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useVersionTimelineStore')>();
  return {
    ...actual,
    // 组件生产态用单例；测试里每次挂载给全新实例，避免用例间状态泄漏
    useVersionTimelineStore: vi.fn(() => actual.createVersionTimelineStore()),
  };
});

vi.mock('@tanstack/vue-virtual', async () => {
  const { computed, toValue } = await import('vue');
  return {
    useVirtualizer: (options: unknown) => computed(() => {
      const opts = toValue(options as never) as { count: number };
      return {
        getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({
          index,
          key: index,
          start: index * 100,
          size: 100,
          end: (index + 1) * 100,
          lane: 0,
        })),
        getTotalSize: () => opts.count * 100,
        measure: () => {},
        measureElement: () => {},
        scrollToIndex: () => {},
        options: opts,
      };
    }),
  };
});

const api = vi.mocked(await import('@/api/modelVersionApi'));

function release(overrides: Partial<ModelReleaseRecord> & { release_id: string }): ModelReleaseRecord {
  return {
    project_name: 'AvevaMarineSample',
    dbnum: 1112,
    release_lifecycle: 'published',
    release_quality: 'complete_visual',
    ...overrides,
  };
}

function anchor(sesno: number, anchoredAt: string): ModelHistoryAnchor {
  return { dbnum: 1112, sesno, anchored_at: anchoredAt };
}

/** 本地时区时间，避免 dayKey 跨时区歧义（2026-07-{day}） */
function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 6, day, hour, minute, 0).toISOString();
}

const R_OLD = release({ release_id: 'codex-ams1112-physical-791', registered_at: at(16, 12) });
const R_MID = release({ release_id: 'codex-ams1112-physical-896', registered_at: at(17, 9) });
const R_NEW = release({ release_id: 'codex-ams1112-physical-897', registered_at: at(17, 15) });

let host: HTMLElement | null = null;
let app: ReturnType<typeof createApp> | null = null;

function mountPanel(): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  app = createApp(VersionTimelinePanel);
  app.mount(host);
  return host;
}

async function flushUi(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
}

function q(root: Element, testid: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

function qa(root: Element, testid: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`));
}

function cardOf(root: Element, releaseId: string): HTMLElement {
  const card = root.querySelector<HTMLElement>(`[data-testid="version-card"][data-release-id="${releaseId}"]`);
  if (!card) throw new Error(`version-card ${releaseId} not found`);
  return card;
}

function granularityButton(root: Element, label: string): HTMLButtonElement {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-testid="version-timeline-granularity"] button'));
  const target = buttons.find((button) => (button.textContent || '').includes(label));
  if (!target) throw new Error(`granularity button ${label} not found`);
  return target;
}

describe('VersionTimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/?project=AvevaMarineSample&dbnum=1112');
    api.listReleases.mockResolvedValue([]);
    api.listAnchors.mockResolvedValue({ dbnum: 1112, count: 0, anchors: [] });
    api.getReleaseDiff.mockResolvedValue({ rows: [], summary: {} });
    api.getCompareReadiness.mockResolvedValue({
      classification: 'ok',
      production_ready: true,
      problems: [],
      warnings: [],
    });
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    host = null;
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  describe('渲染与分组（T009）', () => {
    it('onMounted 按 URL 参数 setFilters 后加载，按天分组倒序渲染 version-card', async () => {
      api.listReleases.mockResolvedValue([R_OLD, R_NEW, R_MID]);
      const root = mountPanel();
      await flushUi();

      expect(q(root, 'version-timeline-panel')).not.toBeNull();
      expect(api.listReleases.mock.calls[0]?.[0]).toMatchObject({
        project: 'AvevaMarineSample',
        dbnum: 1112,
      });

      // 筛选行按 URL 回填
      const projectInput = q(root, 'version-timeline-filter-project') as HTMLInputElement;
      const dbnumInput = q(root, 'version-timeline-filter-dbnum') as HTMLInputElement;
      expect(q(root, 'version-timeline-filter')).not.toBeNull();
      expect(projectInput.value).toBe('AvevaMarineSample');
      expect(dbnumInput.value).toBe('1112');

      // 卡片数量与顺序：组间 dayKey 倒序、组内 timestamp 倒序
      const cards = qa(root, 'version-card');
      expect(cards).toHaveLength(3);
      expect(cards.map((card) => card.getAttribute('data-release-id'))).toEqual([
        'codex-ams1112-physical-897',
        'codex-ams1112-physical-896',
        'codex-ams1112-physical-791',
      ]);

      const days = qa(root, 'version-timeline-day');
      expect(days).toHaveLength(2);
      expect(days[0]?.textContent).toContain(toDayKey(new Date(2026, 6, 17, 12).getTime()));
      expect(days[1]?.textContent).toContain(toDayKey(new Date(2026, 6, 16, 12).getTime()));
    });

    it('分支筛选只保留匹配 branch_id 的版本（FR-006）', async () => {
      api.listReleases.mockResolvedValue([
        release({ release_id: 'r-main', branch_id: 'main', registered_at: at(17, 10) }),
        release({ release_id: 'r-dev', branch_id: 'dev', registered_at: at(17, 11) }),
      ]);
      const root = mountPanel();
      await flushUi();
      expect(qa(root, 'version-card')).toHaveLength(2);

      const branchInput = q(root, 'version-timeline-filter-branch') as HTMLInputElement;
      branchInput.value = 'main';
      branchInput.dispatchEvent(new Event('input'));
      branchInput.dispatchEvent(new Event('change'));
      await flushUi();

      const cards = qa(root, 'version-card');
      expect(cards).toHaveLength(1);
      expect(cards[0]?.getAttribute('data-release-id')).toBe('r-main');
      // 纯前端过滤，不应重新请求
      expect(api.listReleases).toHaveBeenCalledTimes(1);
    });
  });

  describe('双轴徽章（T009·data-model 徽章表逐值断言）', () => {
    it('lifecycle 轴与 quality 轴按映射渲染文案与色调，不合并为单徽章（FR-004）', async () => {
      const matrix = [
        { id: 'r-published', lifecycle: 'published', quality: 'complete_visual', lifeLabel: '已发布', lifeTone: 'green', qualityLabel: '完整', qualityTone: 'green' },
        { id: 'r-failed', lifecycle: 'failed', quality: 'degraded_visual', lifeLabel: '失败', lifeTone: 'red', qualityLabel: '降级', qualityTone: 'amber' },
        { id: 'r-staged', lifecycle: 'staged', quality: 'quarantined_visual', lifeLabel: '未发布', lifeTone: 'gray', qualityLabel: '隔离', qualityTone: 'red' },
        { id: 'r-validating', lifecycle: 'validating', quality: 'patch_only', lifeLabel: '未发布', lifeTone: 'gray', qualityLabel: '补丁', qualityTone: 'gray' },
        { id: 'r-assets', lifecycle: 'assets_materialized', quality: 'non_visual', lifeLabel: '未发布', lifeTone: 'gray', qualityLabel: '非可视', qualityTone: 'gray' },
        { id: 'r-indexed', lifecycle: 'indexed', quality: 'complete_visual', lifeLabel: '未发布', lifeTone: 'gray', qualityLabel: '完整', qualityTone: 'green' },
      ] as const;
      api.listReleases.mockResolvedValue(matrix.map((item, index) => release({
        release_id: item.id,
        release_lifecycle: item.lifecycle,
        release_quality: item.quality,
        registered_at: at(17, 8 + index),
      })));

      const root = mountPanel();
      await flushUi();

      for (const item of matrix) {
        const card = cardOf(root, item.id);
        const lifecycleBadge = q(card, 'version-card-lifecycle-badge');
        const qualityBadge = q(card, 'version-card-quality-badge');
        expect(lifecycleBadge?.textContent?.trim()).toBe(item.lifeLabel);
        expect(lifecycleBadge?.getAttribute('data-tone')).toBe(item.lifeTone);
        expect(qualityBadge?.textContent?.trim()).toBe(item.qualityLabel);
        expect(qualityBadge?.getAttribute('data-tone')).toBe(item.qualityTone);
      }
      // 未发布徽章悬浮显示具体阶段
      expect(q(cardOf(root, 'r-staged'), 'version-card-lifecycle-badge')?.getAttribute('title')).toBe('staged');
    });

    it('quarantined_visual 版本必须红色「隔离」警示（FR-004/FR-031、SC-007）', async () => {
      api.listReleases.mockResolvedValue([
        release({
          release_id: 'r-quarantine',
          release_quality: 'quarantined_visual',
          release_quality_reason: 'geometry mismatch',
          registered_at: at(17, 10),
        }),
      ]);
      const root = mountPanel();
      await flushUi();

      const card = cardOf(root, 'r-quarantine');
      const badge = q(card, 'version-card-quality-badge');
      expect(badge?.textContent?.trim()).toBe('隔离');
      expect(badge?.getAttribute('data-tone')).toBe('red');
      const warning = q(card, 'version-card-quarantine-warning');
      expect(warning).not.toBeNull();
      expect(warning?.textContent).toContain('质量隔离');
    });
  });

  describe('空态/加载中/失败重试三态（T010·FR-008/FR-033）', () => {
    it('空数据渲染空态', async () => {
      api.listReleases.mockResolvedValue([]);
      const root = mountPanel();
      await flushUi();

      expect(q(root, 'version-timeline-empty')?.textContent).toContain('暂无版本数据');
      expect(qa(root, 'version-card')).toHaveLength(0);
    });

    it('加载中渲染 loading 态，完成后切换为列表', async () => {
      let resolveList!: (value: ModelReleaseRecord[]) => void;
      api.listReleases.mockReturnValueOnce(new Promise<ModelReleaseRecord[]>((resolve) => {
        resolveList = resolve;
      }));
      const root = mountPanel();
      await nextTick();

      expect(q(root, 'version-timeline-loading')?.textContent).toContain('正在加载版本列表');

      resolveList([R_NEW]);
      await flushUi();
      expect(q(root, 'version-timeline-loading')).toBeNull();
      expect(qa(root, 'version-card')).toHaveLength(1);
    });

    it('加载失败渲染中文错误与重试入口，重试成功后恢复列表', async () => {
      api.listReleases.mockRejectedValueOnce(new Error('backend down'));
      const root = mountPanel();
      await flushUi();

      const errorState = q(root, 'version-timeline-error');
      expect(errorState?.textContent).toContain('版本列表加载失败');
      expect(errorState?.textContent).toContain('backend down');

      api.listReleases.mockResolvedValueOnce([R_NEW]);
      q(root, 'version-timeline-retry')?.click();
      await flushUi();

      expect(api.listReleases).toHaveBeenCalledTimes(2);
      expect(q(root, 'version-timeline-error')).toBeNull();
      expect(qa(root, 'version-card')).toHaveLength(1);
    });
  });

  describe('diff 摘要懒加载（T010·FR-005/SC-002）', () => {
    it('摘要请求挂起时列表不被阻塞；无上一版本显示「初始版本」，返回后渲染 chips', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      let resolveDiff!: (value: { rows: never[]; summary: { added: number; changed: number; deleted: number } }) => void;
      api.getReleaseDiff.mockReturnValueOnce(new Promise((resolve) => {
        resolveDiff = resolve;
      }));

      const root = mountPanel();
      await flushUi();

      // 摘要仍在挂起，但两张卡片已渲染（不阻塞列表）
      expect(qa(root, 'version-card')).toHaveLength(2);
      expect(q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-diff-summary')?.textContent)
        .toContain('摘要加载中');
      expect(q(cardOf(root, 'codex-ams1112-physical-896'), 'version-card-diff-summary')?.textContent)
        .toContain('初始版本');

      resolveDiff({ rows: [], summary: { added: 5, changed: 7, deleted: 2 } });
      await flushUi();

      const summary = q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-diff-summary');
      expect(summary?.textContent).toContain('+5');
      expect(summary?.textContent).toContain('~7');
      expect(summary?.textContent).toContain('-2');
      expect(summary?.textContent).toContain('较上一版');

      expect(api.getReleaseDiff).toHaveBeenCalledTimes(1);
      expect(api.getReleaseDiff.mock.calls[0]?.[0]).toMatchObject({
        project: 'AvevaMarineSample',
        fromReleaseId: 'codex-ams1112-physical-896',
        toReleaseId: 'codex-ams1112-physical-897',
      });
    });

    it('摘要加载失败显示错误并可重试', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      api.getReleaseDiff.mockRejectedValueOnce(new Error('diff boom'));

      const root = mountPanel();
      await flushUi();

      const card = cardOf(root, 'codex-ams1112-physical-897');
      expect(q(card, 'version-card-diff-summary')?.textContent).toContain('摘要加载失败');
      expect(api.getReleaseDiff).toHaveBeenCalledTimes(1);

      api.getReleaseDiff.mockResolvedValueOnce({ rows: [], summary: { added: 1, changed: 0, deleted: 0 } });
      q(card, 'version-card-diff-retry')?.click();
      await flushUi();

      expect(q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-diff-summary')?.textContent).toContain('+1');
    });
  });

  describe('粒度切换与锚点节点（T010·FR-007）', () => {
    it('含会话锚点渲染 anchor-node 小刻度（去重已覆盖 sesno），快照入口 disabled，可切回', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      api.listAnchors.mockResolvedValue({
        dbnum: 1112,
        count: 2,
        anchors: [
          anchor(897, at(17, 15)),
          anchor(900, at(18, 8)),
        ],
      });

      const root = mountPanel();
      await flushUi();
      expect(qa(root, 'anchor-node')).toHaveLength(0);

      granularityButton(root, '含会话锚点').click();
      await flushUi();

      expect(api.listAnchors.mock.calls[0]?.[0]).toBe(1112);
      const anchors = qa(root, 'anchor-node');
      expect(anchors).toHaveLength(1);
      expect(anchors[0]?.textContent).toContain('900');
      // 锚点节点仅保留快照入口（Phase 2 占位），无 A/B 钉选
      const snapshotButton = anchors[0]?.querySelector<HTMLButtonElement>('[data-testid="anchor-node-snapshot"]');
      expect(snapshotButton?.disabled).toBe(true);
      expect(snapshotButton?.getAttribute('title')).toBe('Phase 2 历史快照');
      expect(anchors[0]?.querySelector('[data-testid="version-card-pin-a"]')).toBeNull();
      expect(anchors[0]?.querySelector('[data-testid="version-card-pin-b"]')).toBeNull();

      granularityButton(root, '仅发布版本').click();
      await flushUi();
      expect(qa(root, 'anchor-node')).toHaveLength(0);
    });
  });

  describe('钉选与进入对比（T012·FR-027）', () => {
    it('设为 A/B 后展示底部钉选栏，production_ready=true 直接进入对比并可关闭', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      const root = mountPanel();
      await flushUi();

      expect(q(root, 'version-timeline-compare-bar')).toBeNull();

      q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-pin-a')?.click();
      await flushUi();
      const bar = q(root, 'version-timeline-compare-bar');
      expect(bar).not.toBeNull();
      expect(bar?.textContent).toContain('codex-ams1112-physical-897');
      expect((q(root, 'version-timeline-enter-compare') as HTMLButtonElement).disabled).toBe(true);

      q(cardOf(root, 'codex-ams1112-physical-896'), 'version-card-pin-b')?.click();
      await flushUi();
      expect((q(root, 'version-timeline-enter-compare') as HTMLButtonElement).disabled).toBe(false);

      q(root, 'version-timeline-enter-compare')?.click();
      await flushUi();

      expect(api.getCompareReadiness).toHaveBeenCalledTimes(1);
      expect(api.getCompareReadiness.mock.calls[0]?.[0]).toMatchObject({
        project: 'AvevaMarineSample',
        fromReleaseId: 'codex-ams1112-physical-897',
        toReleaseId: 'codex-ams1112-physical-896',
      });
      expect(q(root, 'version-timeline-compare-bar')?.textContent).toContain('已进入对比');

      q(root, 'version-timeline-close-compare')?.click();
      await flushUi();
      expect(q(root, 'version-timeline-compare-bar')?.textContent).not.toContain('已进入对比');
      expect(q(root, 'version-timeline-enter-compare')).not.toBeNull();
    });

    it('production_ready=false 展示 readiness 详情并要求显式「诊断查看」确认（FR-027）', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      api.getCompareReadiness.mockResolvedValue({
        classification: 'quarantined_visual',
        production_ready: false,
        problems: ['from release quality quarantined_visual'],
        warnings: [],
        recommended_action: 're-export',
      });

      const root = mountPanel();
      await flushUi();
      q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-pin-a')?.click();
      q(cardOf(root, 'codex-ams1112-physical-896'), 'version-card-pin-b')?.click();
      await flushUi();

      q(root, 'version-timeline-enter-compare')?.click();
      await flushUi();

      const readiness = q(root, 'version-timeline-readiness');
      expect(readiness?.textContent).toContain('quarantined_visual');
      expect(readiness?.textContent).toContain('re-export');
      expect(readiness?.textContent).toContain('from release quality quarantined_visual');
      // 未确认前不得进入对比
      expect(q(root, 'version-timeline-compare-bar')?.textContent).not.toContain('已进入对比');
      expect(q(root, 'version-timeline-close-compare')).toBeNull();

      q(root, 'version-timeline-confirm-diagnostic')?.click();
      await flushUi();
      expect(q(root, 'version-timeline-compare-bar')?.textContent).toContain('已进入对比');
    });

    it('清除 A 退回 onlyB，进入对比不可用', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      const root = mountPanel();
      await flushUi();
      q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-pin-a')?.click();
      q(cardOf(root, 'codex-ams1112-physical-896'), 'version-card-pin-b')?.click();
      await flushUi();

      q(root, 'version-timeline-clear-a')?.click();
      await flushUi();

      const bar = q(root, 'version-timeline-compare-bar');
      expect(bar).not.toBeNull();
      expect(bar?.textContent).not.toContain('codex-ams1112-physical-897');
      expect(bar?.textContent).toContain('codex-ams1112-physical-896');
      expect((q(root, 'version-timeline-enter-compare') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('未发布版本守护（T012·FR-032）', () => {
    it('非 published 版本钉选默认置灰并悬浮说明，诊断模式开启后放开', async () => {
      api.listReleases.mockResolvedValue([
        R_NEW,
        release({ release_id: 'r-staged', release_lifecycle: 'staged', registered_at: at(17, 8) }),
      ]);
      const root = mountPanel();
      await flushUi();

      const stagedPinA = q(cardOf(root, 'r-staged'), 'version-card-pin-a') as HTMLButtonElement;
      const stagedPinB = q(cardOf(root, 'r-staged'), 'version-card-pin-b') as HTMLButtonElement;
      const publishedPinA = q(cardOf(root, 'codex-ams1112-physical-897'), 'version-card-pin-a') as HTMLButtonElement;
      expect(stagedPinA.disabled).toBe(true);
      expect(stagedPinB.disabled).toBe(true);
      expect(stagedPinA.getAttribute('title')).toContain('诊断模式');
      expect(publishedPinA.disabled).toBe(false);

      const toggle = q(root, 'version-timeline-diagnostic-toggle') as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      await flushUi();

      const stagedPinAAfter = q(cardOf(root, 'r-staged'), 'version-card-pin-a') as HTMLButtonElement;
      expect(stagedPinAAfter.disabled).toBe(false);
      stagedPinAAfter.click();
      await flushUi();
      expect(q(root, 'version-timeline-compare-bar')?.textContent).toContain('r-staged');
    });
  });
});
