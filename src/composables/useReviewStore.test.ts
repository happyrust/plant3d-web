import { beforeEach, describe, expect, it, vi } from 'vitest';

const reviewRecordGetByTaskIdMock = vi.fn();
const reviewTaskGetByIdMock = vi.fn();
const reviewTaskGetHistoryMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewRecordCreate: vi.fn(),
  reviewRecordDelete: vi.fn(),
  reviewRecordGetByTaskId: (...args: unknown[]) => reviewRecordGetByTaskIdMock(...args),
  reviewRecordClearByTaskId: vi.fn(),
  reviewTaskGetById: (...args: unknown[]) => reviewTaskGetByIdMock(...args),
  reviewTaskGetHistory: (...args: unknown[]) => reviewTaskGetHistoryMock(...args),
  getReviewUserWebSocketUrl: vi.fn(() => null),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    currentUser: { value: { id: 'checker-1' } },
  }),
}));

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
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

describe('useReviewStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createLocalStorageMock());
    reviewRecordGetByTaskIdMock.mockReset();
    reviewTaskGetByIdMock.mockReset();
    reviewTaskGetHistoryMock.mockReset();
    reviewTaskGetByIdMock.mockResolvedValue({ success: false });
    reviewRecordGetByTaskIdMock.mockResolvedValue({ success: true, records: [] });
    reviewTaskGetHistoryMock.mockResolvedValue({ success: true, history: [] });
  });

  it('loadConfirmedRecords 会带当前 formId 查询确认记录', async () => {
    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    await store.setCurrentTask({
      id: 'task-form-scope',
      formId: 'FORM-SCOPE',
      title: '带 formId 的任务',
      description: 'desc',
      modelName: 'Demo',
      status: 'in_review',
      priority: 'medium',
      requesterId: 'SJ',
      requesterName: 'SJ',
      checkerId: 'JH',
      checkerName: 'JH',
      approverId: 'SH',
      approverName: 'SH',
      components: [],
      attachments: [],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
      currentNode: 'jd',
    } as never);

    expect(reviewRecordGetByTaskIdMock).toHaveBeenCalledWith('task-form-scope', {
      formId: 'FORM-SCOPE',
    });
  });

  it('scoped 查询为空时会回退到 task 级确认记录以兼容历史数据', async () => {
    reviewRecordGetByTaskIdMock
      .mockResolvedValueOnce({ success: true, records: [] })
      .mockResolvedValueOnce({
        success: true,
        records: [
          {
            id: 'record-unbound',
            taskId: 'task-form-fallback',
            formId: '',
            type: 'batch',
            annotations: [{ id: 'anno-unbound', title: '历史批注' }],
            cloudAnnotations: [],
            rectAnnotations: [],
            obbAnnotations: [],
            measurements: [
              {
                id: 'measure-unbound',
                kind: 'distance',
                origin: { entityId: 'o:24381_145018:0', worldPos: [0, 0, 0] },
                target: { entityId: '24381_145019', worldPos: [1, 0, 0] },
                visible: true,
                createdAt: 1710000000100,
              },
            ],
            confirmedAt: 1710000000100,
            note: '历史无 formId 记录',
          },
          {
            id: 'record-other-form',
            taskId: 'task-form-fallback',
            formId: 'FORM-OTHER',
            type: 'batch',
            annotations: [{ id: 'anno-other', title: '其他表单批注' }],
            cloudAnnotations: [],
            rectAnnotations: [],
            obbAnnotations: [],
            measurements: [],
            confirmedAt: 1710000000200,
            note: '其他表单记录',
          },
        ],
      });

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    await store.setCurrentTask({
      id: 'task-form-fallback',
      formId: 'FORM-CURRENT',
      title: '需要兼容历史记录的任务',
      description: 'desc',
      modelName: 'Demo',
      status: 'in_review',
      priority: 'medium',
      requesterId: 'SJ',
      requesterName: 'SJ',
      checkerId: 'JH',
      checkerName: 'JH',
      approverId: 'SH',
      approverName: 'SH',
      components: [],
      attachments: [],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
      currentNode: 'jd',
    } as never);

    expect(reviewRecordGetByTaskIdMock).toHaveBeenNthCalledWith(1, 'task-form-fallback', {
      formId: 'FORM-CURRENT',
    });
    expect(reviewRecordGetByTaskIdMock).toHaveBeenNthCalledWith(2, 'task-form-fallback', {
      formId: undefined,
    });
    expect(store.sortedConfirmedRecords.value).toHaveLength(1);
    expect(store.sortedConfirmedRecords.value[0]).toEqual(expect.objectContaining({
      id: 'record-unbound',
      measurements: [
        expect.objectContaining({ id: 'measure-unbound' }),
      ],
    }));
    expect(store.sortedConfirmedRecords.value.map((record) => record.id)).not.toContain('record-other-form');
  });

  it('/history 失败不会清空已恢复的确认记录', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    reviewRecordGetByTaskIdMock.mockResolvedValueOnce({
      success: true,
      records: [
        {
          id: 'record-1',
          taskId: 'task-history-timeout',
          formId: 'FORM-HISTORY-TIMEOUT',
          type: 'batch',
          annotations: [{ id: 'anno-1', title: '确认批注' }],
          cloudAnnotations: [],
          rectAnnotations: [],
          obbAnnotations: [],
          measurements: [],
          confirmedAt: 1710000000100,
          note: 'history timeout should not clear this',
        },
      ],
    });
    reviewTaskGetHistoryMock.mockRejectedValueOnce(new Error('GET /history 超时'));

    const { useReviewStore } = await import('./useReviewStore');
    const store = useReviewStore();

    await store.setCurrentTask({
      id: 'task-history-timeout',
      formId: 'FORM-HISTORY-TIMEOUT',
      title: '历史超时任务',
      description: 'desc',
      modelName: 'Demo',
      status: 'in_review',
      priority: 'medium',
      requesterId: 'SJ',
      requesterName: 'SJ',
      checkerId: 'JH',
      checkerName: 'JH',
      approverId: 'SH',
      approverName: 'SH',
      components: [],
      attachments: [],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
      currentNode: 'jd',
    } as never);
    await Promise.resolve();

    expect(store.confirmedRecordCount.value).toBe(1);
    expect(store.sortedConfirmedRecords.value[0]).toEqual(expect.objectContaining({
      id: 'record-1',
      formId: 'FORM-HISTORY-TIMEOUT',
    }));
    expect(warnSpy).toHaveBeenCalledWith(
      '[ReviewStore] Failed to load review history:',
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
