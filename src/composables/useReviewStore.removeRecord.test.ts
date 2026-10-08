import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReviewTask } from '@/types/auth';

const reviewRecordDeleteMock = vi.fn();
const reviewRecordClearMock = vi.fn();
const reviewRecordGetMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(),
  reviewRecordDelete: reviewRecordDeleteMock,
  reviewRecordGetByTaskId: reviewRecordGetMock,
  reviewRecordClearByTaskId: reviewRecordClearMock,
  reviewTaskGetHistory: vi.fn(),
  getReviewUserWebSocketUrl: vi.fn(() => 'ws://localhost/ws/review/user/tester'),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: { value: { id: 'tester' } },
  }),
}));

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function makeRecord(id: string) {
  return {
    id,
    taskId: 'task-1',
    formId: 'FORM-1',
    type: 'batch' as const,
    annotations: [],
    cloudAnnotations: [],
    rectAnnotations: [],
    measurements: [],
    confirmedAt: Date.now(),
    note: '',
  };
}

function makeTask(status: ReviewTask['status'] = 'in_review'): ReviewTask {
  return {
    id: 'task-1', formId: 'FORM-1', title: 'Task', description: '', modelName: 'Demo',
    status, priority: 'medium', requesterId: 'SJ', requesterName: 'SJ',
    reviewerId: 'tester', reviewerName: 'Tester', components: [],
    createdAt: 1, updatedAt: 1, currentNode: 'jd',
  };
}

describe('useReviewStore.removeConfirmedRecord', () => {
  beforeEach(() => {
    reviewRecordDeleteMock.mockReset();
    reviewRecordClearMock.mockReset();
    reviewRecordGetMock.mockReset();
    vi.resetModules();
    (globalThis as unknown as { localStorage: Storage }).localStorage =
      createLocalStorageMock() as unknown as Storage;
  });

  it('后端删除失败时不应删除本地记录', async () => {
    reviewRecordDeleteMock.mockResolvedValue({
      success: false,
      error_message: 'delete failed',
    });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    store.confirmedRecords.value = [makeRecord('r-1')];

    await store.removeConfirmedRecord('r-1');

    expect(store.confirmedRecords.value).toHaveLength(1);
    expect(store.confirmedRecords.value[0]?.id).toBe('r-1');
  });

  it('后端删除成功时应删除本地记录', async () => {
    reviewRecordDeleteMock.mockResolvedValue({ success: true });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    store.confirmedRecords.value = [makeRecord('r-2')];

    await store.removeConfirmedRecord('r-2');

    expect(store.confirmedRecords.value).toHaveLength(0);
  });

  it('清空后重读服务器，保留其他节点历史', async () => {
    reviewRecordClearMock.mockResolvedValue({ success: true });
    reviewRecordGetMock.mockResolvedValue({ success: true, records: [makeRecord('previous-node')] });
    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    store.currentTask.value = makeTask();
    store.confirmedRecords.value = [makeRecord('own-node'), makeRecord('previous-node')];
    expect(await store.clearConfirmedRecords()).toBe(true);
    expect(reviewRecordGetMock).toHaveBeenCalledWith('task-1', { formId: 'FORM-1' });
    expect(store.confirmedRecords.value.map(record => record.id)).toEqual(['previous-node']);
  });

  it('终态保存删除清空均拒绝且保留确认记录', async () => {
    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    for (const status of ['approved', 'cancelled'] as const) {
      store.currentTask.value = makeTask(status);
      store.confirmedRecords.value = [makeRecord('history')];
      await store.removeConfirmedRecord('history');
      expect(await store.clearConfirmedRecords()).toBe(false);
      await expect(store.addConfirmedRecord(makeRecord('new'))).rejects.toThrow('只读');
      expect(store.confirmedRecords.value.map(record => record.id)).toEqual(['history']);
    }
    expect(reviewRecordDeleteMock).not.toHaveBeenCalled();
    expect(reviewRecordClearMock).not.toHaveBeenCalled();
  });

  it.each(['delete-success', 'delete-error', 'clear-success', 'clear-error'])('切任务后迟到的 %s 不污染新任务', async scenario => {
    let resolve!: (value: { success: boolean; error_message?: string }) => void;
    const pending = new Promise<{ success: boolean; error_message?: string }>(done => { resolve = done; });
    reviewRecordDeleteMock.mockReturnValue(pending);
    reviewRecordClearMock.mockReturnValue(pending);
    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();
    store.currentTask.value = makeTask();
    store.confirmedRecords.value = [makeRecord('same-id')];
    const operation = scenario.startsWith('delete') ? store.removeConfirmedRecord('same-id') : store.clearConfirmedRecords();
    store.clearCurrentTask();
    store.currentTask.value = { ...makeTask(), id: 'task-2', formId: 'FORM-2' };
    store.confirmedRecords.value = [{ ...makeRecord('same-id'), taskId: 'task-2', formId: 'FORM-2' }];
    store.error.value = 'new-task-error';
    store.loading.value = true;
    resolve({ success: scenario.endsWith('success'), error_message: 'old-task-error' });
    await operation;
    expect(store.confirmedRecords.value).toHaveLength(1);
    expect(store.confirmedRecords.value[0]?.taskId).toBe('task-2');
    expect(store.error.value).toBe('new-task-error');
    expect(store.loading.value).toBe(true);
    expect(reviewRecordGetMock).not.toHaveBeenCalled();
  });
});
