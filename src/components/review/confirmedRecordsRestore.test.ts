import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { createConfirmedRecordsRestorer } from './confirmedRecordsRestore';

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
});
