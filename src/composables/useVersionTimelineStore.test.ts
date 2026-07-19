import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  anchorNodeKey,
  createVersionTimelineStore,
  lifecycleBadge,
  qualityBadge,
  releaseNodeKey,
  toDayKey,
} from './useVersionTimelineStore';

import type { ModelHistoryAnchor, ModelReleaseRecord } from '@/api/modelVersionApi';

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

// 用本地时区正午时间构造，避免 dayKey 跨时区歧义
const R_OLD = release({
  release_id: 'codex-ams1112-physical-791-quarantine',
  release_quality: 'quarantined_visual',
  registered_at: new Date(2026, 6, 16, 12, 0, 0).toISOString(),
});
const R_MID = release({
  release_id: 'codex-ams1112-physical-896',
  registered_at: new Date(2026, 6, 17, 9, 0, 0).toISOString(),
});
const R_NEW = release({
  release_id: 'codex-ams1112-physical-897',
  registered_at: new Date(2026, 6, 17, 15, 0, 0).toISOString(),
});

describe('useVersionTimelineStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('加载与分组排序（data-model 时间线节点规则）', () => {
    it('releases 应按 dayKey 组间倒序、组内 timestamp 倒序', async () => {
      api.listReleases.mockResolvedValue([R_OLD, R_NEW, R_MID]);
      const store = createVersionTimelineStore();
      await store.loadTimeline();

      expect(store.error.value).toBeNull();
      const groups = store.dayGroups.value;
      expect(groups).toHaveLength(2);
      // 组间倒序：07-17 在 07-16 前
      expect(groups[0]?.dayKey).toBe(toDayKey(new Date(2026, 6, 17, 12).getTime()));
      expect(groups[1]?.dayKey).toBe(toDayKey(new Date(2026, 6, 16, 12).getTime()));
      // 组内倒序：897(15:00) 在 896(09:00) 前
      expect(groups[0]?.nodes.map((n) => n.key)).toEqual([
        releaseNodeKey('codex-ams1112-physical-897'),
        releaseNodeKey('codex-ams1112-physical-896'),
      ]);
    });

    it('加载失败应记录错误并清空列表；后发请求覆盖先发（竞态防护）', async () => {
      api.listReleases.mockRejectedValueOnce(new Error('backend down'));
      const store = createVersionTimelineStore();
      await store.loadTimeline();
      expect(store.error.value).toBe('backend down');
      expect(store.releases.value).toEqual([]);

      // 先发请求挂起，后发请求先返回：先发结果不得覆盖
      let resolveFirst: (value: ModelReleaseRecord[]) => void = () => {};
      const first = new Promise<ModelReleaseRecord[]>((resolve) => { resolveFirst = resolve; });
      api.listReleases.mockReturnValueOnce(first as never);
      api.listReleases.mockResolvedValueOnce([R_NEW]);

      const firstLoad = store.loadTimeline();
      const secondLoad = store.loadTimeline();
      await secondLoad;
      resolveFirst([R_OLD]);
      await firstLoad;

      expect(store.releases.value).toEqual([R_NEW]);
      expect(store.error.value).toBeNull();
    });

    it('displayLabel 缺省回退 release_id，sesnoHint 从 release_id 提取', async () => {
      api.listReleases.mockResolvedValue([
        release({ release_id: 'codex-ams1112-physical-897', release_label: '  ' }),
      ]);
      const store = createVersionTimelineStore();
      await store.loadTimeline();
      const view = store.releaseViews.value[0]!;
      expect(view.displayLabel).toBe('codex-ams1112-physical-897');
      expect(view.sesnoHint).toBe('897');
    });
  });

  describe('粒度切换（FR-007）', () => {
    it('releases 粒度只含 release 节点；with-anchors 混排锚点并去重已覆盖 sesno', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      api.listAnchors.mockResolvedValue({
        dbnum: 1112,
        count: 2,
        // 897 已被 release sesnoHint 覆盖，不应重复出现；900 应出现
        anchors: [anchor(897, new Date(2026, 6, 17, 15, 0, 0).toISOString()),
          anchor(900, new Date(2026, 6, 18, 8, 0, 0).toISOString())],
      });

      const store = createVersionTimelineStore();
      store.setFilters({ dbnum: 1112 });
      await store.loadTimeline();

      expect(store.timelineNodes.value.every((n) => n.kind === 'release')).toBe(true);

      await store.setGranularity('with-anchors');
      const keys = store.timelineNodes.value.map((n) => n.key);
      expect(keys).toContain(anchorNodeKey(1112, 900));
      expect(keys).not.toContain(anchorNodeKey(1112, 897));
      // 锚点节点按时间参与排序：900(07-18) 在最前
      expect(keys[0]).toBe(anchorNodeKey(1112, 900));
    });

    it('branchId 过滤只影响 release 节点集合', async () => {
      api.listReleases.mockResolvedValue([
        release({ release_id: 'r-main', branch_id: 'main', registered_at: new Date(2026, 6, 17, 10).toISOString() }),
        release({ release_id: 'r-dev', branch_id: 'dev', registered_at: new Date(2026, 6, 17, 11).toISOString() }),
      ]);
      const store = createVersionTimelineStore();
      await store.loadTimeline();
      expect(store.timelineNodes.value).toHaveLength(2);

      store.setFilters({ branchId: 'main' });
      expect(store.timelineNodes.value.map((n) => n.key)).toEqual([releaseNodeKey('r-main')]);
    });
  });

  describe('diff 摘要懒加载缓存', () => {
    it('应对上一版本（同 dbnum 更早 release）请求 diff 并缓存 summary', async () => {
      api.listReleases.mockResolvedValue([R_OLD, R_MID, R_NEW]);
      api.getReleaseDiff.mockResolvedValue({
        rows: [],
        summary: { added: 5, changed: 7, deleted: 2 },
      });

      const store = createVersionTimelineStore();
      await store.loadTimeline();
      await store.ensureDiffSummary('codex-ams1112-physical-897');

      expect(api.getReleaseDiff).toHaveBeenCalledTimes(1);
      expect(api.getReleaseDiff.mock.calls[0]?.[0]).toMatchObject({
        project: 'AvevaMarineSample',
        fromReleaseId: 'codex-ams1112-physical-896',
        toReleaseId: 'codex-ams1112-physical-897',
      });
      expect(store.diffSummaries.value.get('codex-ams1112-physical-897')).toMatchObject({
        status: 'ready', added: 5, changed: 7, deleted: 2,
      });

      // 二次请求命中缓存，不再发请求
      await store.ensureDiffSummary('codex-ams1112-physical-897');
      expect(api.getReleaseDiff).toHaveBeenCalledTimes(1);
    });

    it('无上一版本时标记 none；请求失败标记 error 并可重试', async () => {
      api.listReleases.mockResolvedValue([R_OLD, R_MID]);
      const store = createVersionTimelineStore();
      await store.loadTimeline();

      await store.ensureDiffSummary('codex-ams1112-physical-791-quarantine');
      expect(store.diffSummaries.value.get('codex-ams1112-physical-791-quarantine')?.status).toBe('none');

      api.getReleaseDiff.mockRejectedValueOnce(new Error('diff failed'));
      await store.ensureDiffSummary('codex-ams1112-physical-896');
      expect(store.diffSummaries.value.get('codex-ams1112-physical-896')).toMatchObject({
        status: 'error', error: 'diff failed',
      });

      api.getReleaseDiff.mockResolvedValueOnce({ rows: [], summary: { added: 1, changed: 0, deleted: 0 } });
      await store.ensureDiffSummary('codex-ams1112-physical-896');
      expect(store.diffSummaries.value.get('codex-ams1112-physical-896')?.status).toBe('ready');
    });
  });

  describe('A/B 钉选状态机（data-model：empty→onlyA→ready→comparing）', () => {
    async function readyStore() {
      api.listReleases.mockResolvedValue([R_OLD, R_MID, R_NEW]);
      const store = createVersionTimelineStore();
      await store.loadTimeline();
      return store;
    }

    it('canonical 迁移路径与 clearA 回退', async () => {
      const store = await readyStore();
      expect(store.stage.value).toBe('empty');

      expect(store.pinA(releaseNodeKey('codex-ams1112-physical-896'))).toBe(true);
      expect(store.stage.value).toBe('onlyA');

      expect(store.pinB(releaseNodeKey('codex-ams1112-physical-897'))).toBe(true);
      expect(store.stage.value).toBe('ready');

      expect(store.enterCompare()).toBe(true);
      expect(store.stage.value).toBe('comparing');

      store.closeCompare();
      expect(store.stage.value).toBe('ready');

      store.clearB();
      store.clearA();
      expect(store.stage.value).toBe('empty');
    });

    it('锚点节点不可钉选；非 ready 不可进入对比', async () => {
      api.listReleases.mockResolvedValue([R_MID]);
      api.listAnchors.mockResolvedValue({
        dbnum: 1112, count: 1, anchors: [anchor(900, new Date(2026, 6, 18, 8).toISOString())],
      });
      const store = createVersionTimelineStore();
      store.setFilters({ dbnum: 1112 });
      await store.loadTimeline();
      await store.setGranularity('with-anchors');

      expect(store.pinA(anchorNodeKey(1112, 900))).toBe(false);
      expect(store.stage.value).toBe('empty');
      expect(store.enterCompare()).toBe(false);

      store.pinA(releaseNodeKey('codex-ams1112-physical-896'));
      expect(store.enterCompare()).toBe(false);
      expect(store.stage.value).toBe('onlyA');
    });

    it('同一版本设为另一侧时应从原侧移除（不允许 A=B）', async () => {
      const store = await readyStore();
      const key = releaseNodeKey('codex-ams1112-physical-896');
      store.pinA(key);
      store.pinB(key);
      expect(store.pinnedA.value).toBeNull();
      expect(store.pinnedB.value?.releaseId).toBe('codex-ams1112-physical-896');
      expect(store.stage.value).toBe('onlyB');
    });
  });

  describe('readiness 缓存与失效', () => {
    it('ready 后 ensureReadiness 缓存；替换钉选使缓存失效并重查', async () => {
      api.listReleases.mockResolvedValue([R_OLD, R_MID, R_NEW]);
      api.getCompareReadiness.mockResolvedValue({
        classification: 'ok', production_ready: true, problems: [], warnings: [],
      });

      const store = createVersionTimelineStore();
      await store.loadTimeline();
      store.pinA(releaseNodeKey('codex-ams1112-physical-896'));
      store.pinB(releaseNodeKey('codex-ams1112-physical-897'));

      await store.ensureReadiness();
      expect(api.getCompareReadiness).toHaveBeenCalledTimes(1);
      expect(api.getCompareReadiness.mock.calls[0]?.[0]).toMatchObject({
        fromReleaseId: 'codex-ams1112-physical-896',
        toReleaseId: 'codex-ams1112-physical-897',
      });
      expect(store.currentReadiness.value?.status).toBe('ready');

      // 同一 pair 二次请求命中缓存
      await store.ensureReadiness();
      expect(api.getCompareReadiness).toHaveBeenCalledTimes(1);

      // 替换 A：ready 保持，但 readiness 缓存失效 → 重查（data-model「替换A/B」循环）
      store.pinA(releaseNodeKey('codex-ams1112-physical-791-quarantine'));
      expect(store.stage.value).toBe('ready');
      expect(store.currentReadiness.value).toBeNull();
      await store.ensureReadiness();
      expect(api.getCompareReadiness).toHaveBeenCalledTimes(2);
      expect(api.getCompareReadiness.mock.calls[1]?.[0]).toMatchObject({
        fromReleaseId: 'codex-ams1112-physical-791-quarantine',
      });
    });

    it('readiness 失败应记录 error 状态且不缓存为 ready', async () => {
      api.listReleases.mockResolvedValue([R_MID, R_NEW]);
      api.getCompareReadiness.mockRejectedValueOnce(new Error('readiness failed'));

      const store = createVersionTimelineStore();
      await store.loadTimeline();
      store.pinA(releaseNodeKey('codex-ams1112-physical-896'));
      store.pinB(releaseNodeKey('codex-ams1112-physical-897'));

      const result = await store.ensureReadiness();
      expect(result).toBeNull();
      expect(store.currentReadiness.value).toMatchObject({ status: 'error', error: 'readiness failed' });
    });
  });

  describe('双轴徽章映射（data-model 徽章表逐值）', () => {
    it('lifecycle 轴', () => {
      expect(lifecycleBadge('published')).toEqual({ label: '已发布', tone: 'green' });
      expect(lifecycleBadge('failed')).toEqual({ label: '失败', tone: 'red' });
      for (const stagedLike of ['staged', 'validating', 'assets_materialized', 'indexed']) {
        expect(lifecycleBadge(stagedLike)).toEqual({ label: '未发布', tone: 'gray', detail: stagedLike });
      }
    });

    it('quality 轴', () => {
      expect(qualityBadge('complete_visual')).toEqual({ label: '完整', tone: 'green' });
      expect(qualityBadge('degraded_visual')).toEqual({ label: '降级', tone: 'amber' });
      expect(qualityBadge('quarantined_visual')).toEqual({ label: '隔离', tone: 'red' });
      expect(qualityBadge('patch_only')).toEqual({ label: '补丁', tone: 'gray' });
      expect(qualityBadge('non_visual')).toEqual({ label: '非可视', tone: 'gray' });
    });
  });
});
