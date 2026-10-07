import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import {
  createConfirmedRecordsRestorer,
  isLayeredDraftRestoreActive,
  layerConfirmedReplayForStore,
} from './confirmedRecordsRestore';
import { loadReviewModelComparison } from './reviewModelContextRestore';
import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

import type { ReviewModelContext } from './reviewModelContext';
import type { ModelAttributeDiff, ModelVersion, ModelVersionGeometry } from '@/model-source/ports';

import { buildCommentThreadKey } from '@/review/domain/commentThread';
import { getReviewCommentThreadStore } from '@/review/services/sharedStores';

function createRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1',
    taskId: 'task-1',
    confirmedAt: 1,
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    obbAnnotations: [],
    measurements: [],
    ...overrides,
  };
}

describe('saved historical model comparison', () => {
  const context: ReviewModelContext = { schemaVersion: 1, project: 'p', dbnum: 1, taskId: 't', formId: 'f', node: 'sj',
    comparison: { dbnum: 1, refno: '1_100', a: 10, b: 20, units: [], viewMode: 'split', activeSide: 'before', diffOnly: true } };
  const diff = (refno: string, kind: ModelAttributeDiff['kind'] = 'modified'): ModelAttributeDiff => ({
    dbnum: 1, refno, unitRefno: refno, noun: 'BRAN', unitNoun: 'BRAN', a: 10, b: 20,
    kind, impact: null, changedCount: 0, changes: [], members: null, owner: null, attributesUnavailable: null, warnings: [],
  });
  const geometry = (version: ModelVersion): ModelVersionGeometry => ({
    refnos: version.impactKind === 'tombstone' ? [] : [`${version.unitRefno}1`], entries: new Map(),
    handle: `${version.unitRefno}@${version.sesno}`, release: vi.fn(async () => {}),
  });
  function source() {
    return { attributeDiff: vi.fn(async (_dbnum: number, refno: string) => diff(refno)),
      loadVersion: vi.fn(async (version: ModelVersion) => geometry(version)),
      attributesAt: vi.fn(async (_geometry: ModelVersionGeometry, _refno: string) => ({ sesno: 10, exists: true, noun: 'BRAN', attributes: [] })),
    };
  }

  it('按保存的两端会话加载、保留视图模式，属性使用同一历史句柄直到关闭', async () => {
    const backend = source();
    const loaded = await loadReviewModelComparison(context, backend, () => true);
    expect(backend.attributeDiff).toHaveBeenCalledWith(1, '1_100', 10, 20);
    expect(backend.loadVersion.mock.calls.map(([version]) => version.sesno)).toEqual([10, 20]);
    expect(loaded.detail.viewMode).toBe('split');
    await loaded.detail.attributesAt!('before', '1/100');
    const before = await backend.loadVersion.mock.results[0]!.value;
    expect(backend.attributesAt).toHaveBeenCalledWith(before, '1_100', { signal: undefined });
    expect(before.release).not.toHaveBeenCalled();
    await loaded.release();
    await loaded.release();
    expect(before.release).toHaveBeenCalledTimes(1);
    await expect(loaded.detail.attributesAt!('before', '1_100')).rejects.toThrow('已关闭');
  });

  it.each(['created', 'deleted'] as const)('从服务端存在性恢复 %s 单元的空侧，保留删除根树信息', async kind => {
    const backend = source();
    backend.attributeDiff.mockResolvedValue(diff('1_100', kind));
    const loaded = await loadReviewModelComparison(context, backend, () => true);
    const absent = kind === 'created' ? loaded.detail.before : loaded.detail.after;
    expect(absent.version.impactKind).toBe('tombstone');
    expect(absent.refnos).toEqual([]);
    if (kind === 'deleted') expect(loaded.treeContext.models).toContainEqual(expect.objectContaining({ refno: '1_100', status: 'deleted' }));
    await loaded.release();
  });

  it('查询身份不符、会话不存在或单元不是根时不生成任何投影', async () => {
    const backend = source();
    backend.attributeDiff.mockResolvedValue({ ...diff('1_100'), a: 9 });
    await expect(loadReviewModelComparison(context, backend, () => true)).rejects.toThrow('精确 A/B');
    expect(backend.loadVersion).not.toHaveBeenCalled();
    backend.attributeDiff.mockRejectedValue(new Error('SESSION_NOT_FOUND'));
    await expect(loadReviewModelComparison(context, backend, () => true)).rejects.toThrow('SESSION_NOT_FOUND');
    expect(backend.loadVersion).not.toHaveBeenCalled();
  });

  it('一侧失败也等待另一侧落地并释放，不遗留成功的历史快照', async () => {
    const backend = source();
    let finish!: (value: ModelVersionGeometry) => void;
    backend.loadVersion.mockRejectedValueOnce(new Error('投影失败')).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = loadReviewModelComparison(context, backend, () => true);
    const assertion = expect(pending).rejects.toThrow('投影失败');
    await vi.waitFor(() => expect(backend.loadVersion).toHaveBeenCalledTimes(2));
    const held = geometry({ dbnum: 1, unitRefno: '1_100', unitNoun: 'BRAN', sesno: 20, sessionTime: null, impactKind: 'mesh' });
    finish(held);
    await assertion;
    expect(held.release).toHaveBeenCalledTimes(1);
  });

  it('恢复被新任务取代时释放已获取的两份，不返回旧场景', async () => {
    const backend = source();
    let live = true;
    backend.loadVersion.mockImplementation(async version => { live = false; return geometry(version); });
    await expect(loadReviewModelComparison(context, backend, () => live)).rejects.toThrow('已取消');
    for (const result of backend.loadVersion.mock.results) expect((await result.value).release).toHaveBeenCalledTimes(1);
  });

  it('多单元合并保持精确会话和单元根，属性不猜测不存在的构件归属', async () => {
    const backend = source();
    const multi: ReviewModelContext = { ...context, comparison: { ...context.comparison!, refno: '1_999',
      units: [{ refno: '1_100', a: 10, b: 20 }, { refno: '1/200', a: 10, b: 20 }] } };
    const loaded = await loadReviewModelComparison(multi, backend, () => true);
    expect(loaded.detail.unitRefno).toBe('1_999');
    expect(loaded.detail.units?.map(unit => unit.unitRefno)).toEqual(['1_100', '1_200']);
    await loaded.detail.attributesAt!('after', '1_200');
    expect(backend.attributesAt.mock.calls[0]![0].handle).toBe('1_200@20');
    await expect(loaded.detail.attributesAt!('after', '1_888')).rejects.toThrow('无法唯一确定');
    await loaded.release();
    for (const result of backend.loadVersion.mock.results) expect((await result.value).release).toHaveBeenCalledTimes(1);
  });
});

describe('createConfirmedRecordsRestorer', () => {
  const modelContext = { schemaVersion: 1 as const, project: 'project-1', dbnum: 1,
    taskId: 'task-1', formId: 'form-1', node: 'sj', comparison: null };

  function contextRestorer(records = ref([createRecord({ modelContext })]),
    ensureModelContext?: (context: ReviewModelContext, shouldApply: () => boolean) => Promise<void>) {
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();
    const restorer = createConfirmedRecordsRestorer({ currentTaskId: () => 'task-1', currentFormId: () => 'form-1',
      confirmedRecords: () => records.value.map(record => ({ ...record, note: '', type: 'batch' as const })), toolStore: { clearAll: vi.fn(), importJSON },
      waitForViewerReady: async () => true, getViewerTools: () => ({ syncFromStore }), ensureModelContext });
    return { records, importJSON, syncFromStore, restorer };
  }

  it('模型版本检查成功后才导入标注，修订变化即使时间不变也重新恢复', async () => {
    const order: string[] = [];
    const ensure = vi.fn(async () => { order.push('model'); });
    const fixture = contextRestorer(undefined, ensure);
    fixture.importJSON.mockImplementation(() => { order.push('annotations'); });
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(order).toEqual(['model', 'annotations']);
    fixture.records.value = [createRecord({ modelContext, recordRevision: 'revision-2' })];
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(fixture.restorer.restoreError.value).toBeNull();
  });

  it('版本入口缺失或加载失败时不导入标注、不缓存成功状态，允许重试', async () => {
    const missing = contextRestorer();
    await missing.restorer.restoreConfirmedRecordsIntoScene();
    expect(missing.importJSON).not.toHaveBeenCalled();
    expect(missing.restorer.restoreError.value).toContain('尚未就绪');
    const ensure = vi.fn().mockRejectedValueOnce(new Error('历史投影不可用')).mockResolvedValue(undefined);
    const fixture = contextRestorer(undefined, ensure);
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(fixture.importJSON).not.toHaveBeenCalled();
    expect(fixture.restorer.lastRestoredSceneKey.value).toBeNull();
    expect(fixture.restorer.restoring.value).toBe(false);
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(fixture.importJSON).toHaveBeenCalledTimes(1);
  });

  it('混合模型版本或混合无版本旧记录时拒绝整批回放，但前序节点同模型可回放', async () => {
    const ensure = vi.fn(async () => {});
    const fixture = contextRestorer(ref([createRecord({ modelContext }), createRecord({ id: 'record-2' })]), ensure);
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(ensure).not.toHaveBeenCalled();
    fixture.records.value = [createRecord({ modelContext }), createRecord({ id: 'record-2', modelContext: { ...modelContext, dbnum: 2 } })];
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(fixture.importJSON).not.toHaveBeenCalled();
    fixture.records.value = [createRecord({ modelContext }), createRecord({ id: 'record-2', modelContext: { ...modelContext, node: 'jd' } })];
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(fixture.importJSON).toHaveBeenCalledTimes(1);
  });

  it('迟到的版本恢复回执不能覆盖更新后的记录或错误提示', async () => {
    let finish!: () => void;
    let oldShouldApply!: () => boolean;
    const ensure = vi.fn().mockImplementationOnce((_context, shouldApply) => {
      oldShouldApply = shouldApply;
      return new Promise<void>(resolve => { finish = resolve; });
    }).mockRejectedValueOnce(new Error('新版本加载失败'));
    const fixture = contextRestorer(undefined, ensure);
    const old = fixture.restorer.restoreConfirmedRecordsIntoScene();
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    fixture.records.value = [createRecord({ modelContext, recordRevision: 'revision-2' })];
    await fixture.restorer.restoreConfirmedRecordsIntoScene();
    expect(oldShouldApply()).toBe(false);
    finish();
    await old;
    expect(fixture.importJSON).not.toHaveBeenCalled();
    expect(fixture.restorer.restoreError.value).toBe('新版本加载失败');
  });

  it('面板卸载取消待处理回放，版本恢复落地后不再写场景', async () => {
    let finish!: () => void;
    const ensure = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const fixture = contextRestorer(undefined, ensure);
    const pending = fixture.restorer.restoreConfirmedRecordsIntoScene();
    await vi.waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    fixture.restorer.cancelPendingRestore();
    finish();
    await pending;
    expect(fixture.importJSON).not.toHaveBeenCalled();
    expect(fixture.syncFromStore).not.toHaveBeenCalled();
    expect(fixture.restorer.restoring.value).toBe(false);
  });

  beforeEach(() => {
    getReviewCommentThreadStore().clear();
  });

  it('首次进入空记录任务且启用 skipClearOnEmpty 时，不清空外部已恢复场景', async () => {
    const clearAll = vi.fn();
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();

    const currentTaskId = ref<string | null>('task-empty');
    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => currentTaskId.value,
      confirmedRecords: () => [],
      toolStore: { clearAll, importJSON },
      waitForViewerReady: async () => true,
      getViewerTools: () => ({ syncFromStore }),
      skipClearOnEmpty: true,
    });

    await restorer.restoreConfirmedRecordsIntoScene();

    expect(clearAll).not.toHaveBeenCalled();
    expect(importJSON).not.toHaveBeenCalled();
    expect(syncFromStore).not.toHaveBeenCalled();
  });

  it('从有确认记录的任务切到空记录任务时，即使启用 skipClearOnEmpty 也会清空旧场景', async () => {
    const clearAll = vi.fn();
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();

    const currentTaskId = ref<string | null>('task-with-records');
    const confirmedRecords = ref([createRecord({ taskId: 'task-with-records' })]);
    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => currentTaskId.value,
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll, importJSON },
      waitForViewerReady: async () => true,
      getViewerTools: () => ({ syncFromStore }),
      skipClearOnEmpty: true,
    });

    await restorer.restoreConfirmedRecordsIntoScene();
    expect(importJSON).toHaveBeenCalledTimes(1);

    currentTaskId.value = 'task-empty';
    confirmedRecords.value = [];
    await restorer.restoreConfirmedRecordsIntoScene();

    expect(clearAll).toHaveBeenCalledTimes(1);
    expect(syncFromStore).toHaveBeenCalledTimes(2);
  });

  it('viewer 未就绪时跳过恢复且不写入陈旧状态', async () => {
    const clearAll = vi.fn();
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();

    const currentTaskId = ref<string | null>('task-1');
    const confirmedRecords = ref([createRecord({
      taskId: 'task-1',
      annotations: [{ id: 'anno-1', title: 'anno' }],
    })]);
    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => currentTaskId.value,
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll, importJSON },
      waitForViewerReady: async () => false,
      getViewerTools: () => ({ syncFromStore }),
    });

    await restorer.restoreConfirmedRecordsIntoScene();

    expect(importJSON).not.toHaveBeenCalled();
    expect(clearAll).not.toHaveBeenCalled();
    expect(syncFromStore).not.toHaveBeenCalled();
    expect(restorer.lastRestoredSceneKey.value).toBeNull();
  });

  it('等待 viewer 期间任务切换时中止旧任务导入', async () => {
    const clearAll = vi.fn();
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();

    const currentTaskId = ref<string | null>('task-1');
    const confirmedRecords = ref([createRecord({
      taskId: 'task-1',
      annotations: [{ id: 'anno-1', title: 'anno' }],
    })]);
    let resolveReady: ((value: boolean) => void) | null = null;
    const waitForViewerReady = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    }));

    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => currentTaskId.value,
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll, importJSON },
      waitForViewerReady,
      getViewerTools: () => ({ syncFromStore }),
    });

    const pending = restorer.restoreConfirmedRecordsIntoScene();
    currentTaskId.value = 'task-2';
    resolveReady?.(true);
    await pending;

    expect(waitForViewerReady).toHaveBeenCalledTimes(1);
    expect(importJSON).not.toHaveBeenCalled();
    expect(clearAll).not.toHaveBeenCalled();
    expect(syncFromStore).not.toHaveBeenCalled();
    expect(restorer.lastRestoredSceneKey.value).toBeNull();
  });

  it('恢复时按当前 formId 注入子批注上下文', async () => {
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();
    const confirmedRecords = ref([createRecord({
      taskId: 'task-1',
      formId: 'FORM-RESTORE',
      annotations: [
        {
          id: 'anno-form-restore',
          title: '恢复批注',
        },
      ],
    })]);

    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => 'task-1',
      currentFormId: () => 'FORM-RESTORE',
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll: vi.fn(), importJSON },
      waitForViewerReady: async () => true,
      getViewerTools: () => ({ syncFromStore }),
    });

    await restorer.restoreConfirmedRecordsIntoScene();

    const payload = JSON.parse(importJSON.mock.calls[0][0] as string);
    expect(payload.annotations).toEqual([
      expect.objectContaining({
        id: 'anno-form-restore',
        formId: 'FORM-RESTORE',
        taskId: 'task-1',
      }),
    ]);
  });

  it('确认记录没有 inline 评论时，不清空已通过统一入口加载的评论', async () => {
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();
    const threadKey = buildCommentThreadKey('text', 'anno-existing', 'FORM-RESTORE', 'task-1');
    getReviewCommentThreadStore().setThreadComments(threadKey, [{
      commentId: 'comment-existing',
      annotationId: 'anno-existing',
      annotationType: 'text',
      content: '已加载评论',
      createdAt: 10,
      formId: 'FORM-RESTORE',
      taskId: 'task-1',
    }]);

    const confirmedRecords = ref([createRecord({
      taskId: 'task-1',
      formId: 'FORM-RESTORE',
      annotations: [
        {
          id: 'anno-existing',
          title: '恢复批注',
        },
      ],
    })]);

    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => 'task-1',
      currentFormId: () => 'FORM-RESTORE',
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll: vi.fn(), importJSON },
      waitForViewerReady: async () => true,
      getViewerTools: () => ({ syncFromStore }),
    });

    await restorer.restoreConfirmedRecordsIntoScene();

    expect(getReviewCommentThreadStore().getThread(threadKey)?.entries.map((entry) => entry.content)).toEqual([
      '已加载评论',
    ]);
    expect(importJSON).toHaveBeenCalledTimes(1);
    expect(syncFromStore).toHaveBeenCalledTimes(1);
  });

  it('viewer 已就绪但 tools 延迟 ready 时，后续触发仍能恢复', async () => {
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();
    let tools: { syncFromStore: () => void } | null = null;
    const confirmedRecords = ref([createRecord({
      taskId: 'task-1',
      formId: 'FORM-DELAY',
      annotations: [{ id: 'anno-delay', title: '延迟恢复批注' }],
    })]);

    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => 'task-1',
      currentFormId: () => 'FORM-DELAY',
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll: vi.fn(), importJSON },
      waitForViewerReady: async () => true,
      getViewerTools: () => tools,
    });

    await restorer.restoreConfirmedRecordsIntoScene();
    expect(importJSON).not.toHaveBeenCalled();
    expect(restorer.lastRestoredSceneKey.value).toBeNull();

    tools = { syncFromStore };
    await restorer.restoreConfirmedRecordsIntoScene();

    expect(importJSON).toHaveBeenCalledTimes(1);
    expect(syncFromStore).toHaveBeenCalledTimes(1);
  });

  describe('U0 草稿 / 已确认分层（scope 生效时）', () => {
    function localPayload(parts: Partial<Record<string, unknown[]>>): string {
      return JSON.stringify({
        version: 7,
        measurements: [],
        legacyMeasurements: [],
        annotations: [],
        obbAnnotations: [],
        cloudAnnotations: [],
        rectAnnotations: [],
        ...parts,
      });
    }

    it('分层判定：要 store 能 exportJSON + 有草稿 scope；缺任一项就走旧的整份替换', () => {
      expect(isLayeredDraftRestoreActive({ clearAll: vi.fn(), importJSON: vi.fn() })).toBe(false);
      expect(isLayeredDraftRestoreActive({
        clearAll: vi.fn(), importJSON: vi.fn(), exportJSON: () => localPayload({}), getAnnotationDraftScope: () => null,
      })).toBe(false);
      expect(isLayeredDraftRestoreActive({
        clearAll: vi.fn(), importJSON: vi.fn(), exportJSON: () => localPayload({}), getAnnotationDraftScope: () => ({ taskId: 't' }),
      })).toBe(true);
    });

    it('有确认记录：已确认层按 id 覆盖本机副本，本机草稿保留，不 clearAll', async () => {
      const clearAll = vi.fn();
      const importJSON = vi.fn();
      const syncFromStore = vi.fn();
      const confirmedRecords = ref([createRecord({
        taskId: 'task-1',
        annotations: [{ id: 'anno-1', title: '服务端版本' }],
        cloudAnnotations: [{ id: 'cloud-1', title: '服务端云线' }],
      })] as never[]);

      const restorer = createConfirmedRecordsRestorer({
        currentTaskId: () => 'task-1',
        confirmedRecords: () => confirmedRecords.value,
        toolStore: {
          clearAll,
          importJSON,
          exportJSON: () => localPayload({
            annotations: [{ id: 'anno-1', title: '本机旧副本' }, { id: 'anno-draft', title: '本机草稿' }],
            cloudAnnotations: [{ id: 'cloud-draft' }],
          }),
          getAnnotationDraftScope: () => ({ taskId: 'task-1' }),
        },
        waitForViewerReady: async () => true,
        getViewerTools: () => ({ syncFromStore }),
      });

      await restorer.restoreConfirmedRecordsIntoScene();

      expect(clearAll).not.toHaveBeenCalled();
      expect(importJSON).toHaveBeenCalledTimes(1);
      type Item = { id: string; title?: string };
      const payload = JSON.parse(importJSON.mock.calls[0]?.[0] as string) as { annotations: Item[]; cloudAnnotations: Item[] };
      expect(payload.annotations.map((a) => [a.id, a.title])).toEqual([
        ['anno-1', '服务端版本'],
        ['anno-draft', '本机草稿'],
      ]);
      expect(payload.cloudAnnotations.map((c) => c.id)).toEqual(['cloud-1', 'cloud-draft']);
      expect(syncFromStore).toHaveBeenCalledTimes(1);
    });

    it('空记录任务：不再 clearAll 抹掉本机草稿（容器已按 scope 切好），评论线程照旧清、场景照旧同步', async () => {
      const clearAll = vi.fn();
      const importJSON = vi.fn();
      const syncFromStore = vi.fn();
      const threadKey = buildCommentThreadKey('text', 'anno-old', 'FORM-X', 'task-old');
      getReviewCommentThreadStore().setThreadComments(threadKey, [{
        commentId: 'c-old', annotationId: 'anno-old', annotationType: 'text', content: '旧任务评论', createdAt: 1, formId: 'FORM-X', taskId: 'task-old',
      }]);

      const restorer = createConfirmedRecordsRestorer({
        currentTaskId: () => 'task-empty',
        confirmedRecords: () => [],
        toolStore: {
          clearAll,
          importJSON,
          exportJSON: () => localPayload({ annotations: [{ id: 'anno-draft' }] }),
          getAnnotationDraftScope: () => ({ taskId: 'task-empty' }),
        },
        waitForViewerReady: async () => true,
        getViewerTools: () => ({ syncFromStore }),
      });

      await restorer.restoreConfirmedRecordsIntoScene();

      expect(clearAll).not.toHaveBeenCalled();
      expect(importJSON).not.toHaveBeenCalled();
      expect(syncFromStore).toHaveBeenCalledTimes(1);
      expect(getReviewCommentThreadStore().getThread(threadKey)).toBeFalsy();
      expect(restorer.lastRestoredSceneKey.value).toBe('task-empty:empty');
    });

    it('显式 layeredDrafts 取法优先于缺省判定；关掉就回旧行为', async () => {
      const clearAll = vi.fn();
      const importJSON = vi.fn();
      const confirmedRecords = [createRecord({ taskId: 'task-1', annotations: [{ id: 'anno-1' }] })] as never[];
      const restorer = createConfirmedRecordsRestorer({
        currentTaskId: () => 'task-1',
        confirmedRecords: () => confirmedRecords,
        toolStore: {
          clearAll,
          importJSON,
          exportJSON: () => localPayload({ annotations: [{ id: 'anno-draft' }] }),
          getAnnotationDraftScope: () => ({ taskId: 'task-1' }),
        },
        waitForViewerReady: async () => true,
        getViewerTools: () => ({ syncFromStore: vi.fn() }),
        layeredDrafts: () => false,
      });

      await restorer.restoreConfirmedRecordsIntoScene();
      const payload = JSON.parse(importJSON.mock.calls[0]?.[0] as string) as { annotations: { id: string }[] };
      expect(payload.annotations.map((a) => a.id)).toEqual(['anno-1']);
    });

    it('layerConfirmedReplayForStore：给 embed 快照刷新等入口复用同一套判定与合并', () => {
      const confirmed = localPayload({ annotations: [{ id: 'anno-1' }] });
      const legacyStore = { clearAll: vi.fn(), importJSON: vi.fn() };
      expect(layerConfirmedReplayForStore(legacyStore, confirmed)).toBe(confirmed);

      const scopedStore = {
        clearAll: vi.fn(),
        importJSON: vi.fn(),
        exportJSON: () => localPayload({ annotations: [{ id: 'anno-draft' }] }),
        getAnnotationDraftScope: () => ({ taskId: 'task-1' }),
      };
      const merged = JSON.parse(layerConfirmedReplayForStore(scopedStore, confirmed)) as { annotations: { id: string }[] };
      expect(merged.annotations.map((a) => a.id)).toEqual(['anno-1', 'anno-draft']);
    });
  });

  it('按统一 snapshot 层仍回放 legacy measurement 转换结果', async () => {
    const clearAll = vi.fn();
    const importJSON = vi.fn();
    const syncFromStore = vi.fn();

    const distanceMeasurement = {
      id: 'measure-1',
      kind: 'distance',
      origin: { entityId: 'a', worldPos: [0, 0, 0] },
      target: { entityId: 'b', worldPos: [1, 0, 0] },
      visible: true,
      createdAt: 2,
    };
    const confirmedRecords = ref([createRecord({
      taskId: 'task-1',
      measurements: [distanceMeasurement],
    })]);

    const restorer = createConfirmedRecordsRestorer({
      currentTaskId: () => 'task-1',
      confirmedRecords: () => confirmedRecords.value,
      toolStore: { clearAll, importJSON },
      waitForViewerReady: async () => true,
      getViewerTools: () => ({ syncFromStore }),
    });

    await restorer.restoreConfirmedRecordsIntoScene();

    expect(importJSON).toHaveBeenCalledTimes(1);
    expect(importJSON).toHaveBeenCalledWith(buildReviewRecordReplayPayload(confirmedRecords.value));
    expect(JSON.parse(importJSON.mock.calls[0][0] as string)).toEqual(expect.objectContaining({
      version: 7,
      measurements: [
        expect.objectContaining({
          id: 'measure-1',
          source: 'replay',
          approximate: true,
          provenance: expect.objectContaining({ accuracyClass: 'legacy-unknown' }),
        }),
      ],
    }));
  });
});
