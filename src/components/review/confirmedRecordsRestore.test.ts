import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';
import { buildReviewRecordReplayPayload } from './reviewRecordReplay';

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

describe('createConfirmedRecordsRestorer', () => {
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
      measurements: [],
      xeokitDistanceMeasurements: [
        expect.objectContaining({ id: 'measure-1', approximate: false }),
      ],
    }));
  });
});
