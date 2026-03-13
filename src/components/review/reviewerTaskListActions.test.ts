import { describe, expect, it, vi } from 'vitest';

import { refreshReviewerTasksSafely, startReviewerTask } from './reviewerTaskListActions';
import { getSubmitActionLabel } from './reviewPanelActions';

import type { ReviewTask } from '@/types/auth';

import { normalizeReviewTask } from '@/api/reviewApi';
import { isApproverRole, isCheckerRole } from '@/composables/useUserStore';

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

vi.stubGlobal('localStorage', createLocalStorageMock());

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task',
    description: overrides.description ?? 'Desc',
    modelName: overrides.modelName ?? 'Model',
    status: overrides.status ?? 'submitted',
    priority: overrides.priority ?? 'medium',
    requesterId: overrides.requesterId ?? 'designer-1',
    requesterName: overrides.requesterName ?? 'Designer',
    checkerId: overrides.checkerId,
    checkerName: overrides.checkerName,
    approverId: overrides.approverId,
    approverName: overrides.approverName,
    reviewerId: overrides.reviewerId ?? overrides.checkerId ?? '',
    reviewerName: overrides.reviewerName ?? overrides.checkerName ?? '',
    components: overrides.components ?? [],
    attachments: overrides.attachments,
    reviewComment: overrides.reviewComment,
    createdAt: overrides.createdAt ?? 1700000000000,
    updatedAt: overrides.updatedAt ?? 1700000000000,
    dueDate: overrides.dueDate,
    currentNode: overrides.currentNode ?? 'jd',
    workflowHistory: overrides.workflowHistory,
    returnReason: overrides.returnReason,
    formId: overrides.formId,
  };
}

function filterPendingReviewTasks(tasks: ReviewTask[], userId: string, role: 'checker' | 'approver') {
  return tasks.filter((task) => {
    const node = task.currentNode ?? 'sj';
    const checkerId = task.checkerId || task.reviewerId;
    const approverId = task.approverId;

    if (role === 'checker') {
      return checkerId === userId
        && node === 'jd'
        && (task.status === 'submitted' || task.status === 'in_review');
    }

    return approverId === userId
      && (node === 'sh' || node === 'pz')
      && (task.status === 'submitted' || task.status === 'in_review');
  });
}

describe('reviewerTaskListActions', () => {
  it('refreshReviewerTasksSafely 应调用后端刷新并正确切换 loading', async () => {
    const loadingTrace: boolean[] = [];
    const loadReviewTasks = vi.fn(async () => {});

    await refreshReviewerTasksSafely({
      loadReviewTasks,
      setLoading: (loading) => {
        loadingTrace.push(loading);
      },
    });

    expect(loadReviewTasks).toHaveBeenCalledTimes(1);
    expect(loadingTrace).toEqual([true, false]);
  });

  it('refreshReviewerTasksSafely 刷新失败时也应关闭 loading', async () => {
    const loadingTrace: boolean[] = [];
    const loadReviewTasks = vi.fn(async () => {
      throw new Error('refresh failed');
    });

    await expect(
      refreshReviewerTasksSafely({
        loadReviewTasks,
        setLoading: (loading) => {
          loadingTrace.push(loading);
        },
      })
    ).rejects.toThrow('refresh failed');

    expect(loadingTrace).toEqual([true, false]);
  });

  it('checker inbox 仅显示 jd 节点且兼容 legacy reviewerId 的任务', () => {
    const tasks = [
      createTask({ id: 'legacy-checker', checkerId: undefined, reviewerId: 'checker-1', currentNode: 'jd', status: 'submitted' }),
      createTask({ id: 'checker-in-review', checkerId: 'checker-1', reviewerId: 'checker-1', currentNode: 'jd', status: 'in_review' }),
      createTask({ id: 'wrong-node', checkerId: 'checker-1', reviewerId: 'checker-1', currentNode: 'sh', status: 'submitted' }),
      createTask({ id: 'wrong-status', checkerId: 'checker-1', reviewerId: 'checker-1', currentNode: 'jd', status: 'approved' }),
      createTask({ id: 'different-checker', checkerId: 'checker-2', reviewerId: 'checker-2', currentNode: 'jd', status: 'submitted' }),
    ];

    const visible = filterPendingReviewTasks(tasks, 'checker-1', 'checker');

    expect(visible.map((task) => task.id)).toEqual(['legacy-checker', 'checker-in-review']);
    expect(isCheckerRole('proofreader' as never)).toBe(true);
  });

  it('approver inbox 仅显示 sh/pz 节点且状态仍处于 reviewer 生命周期内的任务', () => {
    const tasks = [
      createTask({ id: 'approver-sh', approverId: 'approver-1', currentNode: 'sh', status: 'submitted' }),
      createTask({ id: 'approver-pz', approverId: 'approver-1', currentNode: 'pz', status: 'in_review' }),
      createTask({ id: 'checker-node', approverId: 'approver-1', currentNode: 'jd', status: 'submitted' }),
      createTask({ id: 'done-task', approverId: 'approver-1', currentNode: 'sh', status: 'approved' }),
      createTask({ id: 'other-approver', approverId: 'approver-2', currentNode: 'sh', status: 'submitted' }),
    ];

    const visible = filterPendingReviewTasks(tasks, 'approver-1', 'approver');

    expect(visible.map((task) => task.id)).toEqual(['approver-sh', 'approver-pz']);
    expect(isApproverRole('reviewer' as never)).toBe(true);
  });

  it('legacy reviewer payload normalizes into explicit checker semantics', () => {
    const task = normalizeReviewTask({
      id: 'legacy-task',
      title: 'Legacy task',
      reviewer_id: 'checker-legacy',
      reviewer_name: 'Legacy Checker',
      approver_id: 'approver-1',
      approver_name: 'Approver One',
      status: 'submitted',
      current_node: 'jd',
      components: [],
    });

    expect(task.checkerId).toBe('checker-legacy');
    expect(task.checkerName).toBe('Legacy Checker');
    expect(task.reviewerId).toBe('checker-legacy');
    expect(task.currentNode).toBe('jd');
  });

  it('task selection hydrates reviewer workspace and preserves node-derived submit label', async () => {
    const task = createTask({
      id: 'task-hydrate',
      title: 'Hydrate me',
      requesterName: 'Designer One',
      checkerName: 'Checker One',
      approverName: 'Approver One',
      currentNode: 'sh',
      components: [
        { id: 'comp-1', name: 'Pipe-100', refNo: '100_1', type: 'Pipe' },
        { id: 'comp-2', name: 'Valve-200', refNo: '200_1', type: 'Valve' },
      ],
    });
    const setCurrentTask = vi.fn(async () => {});
    const emitCommand = vi.fn();
    const selected: ReviewTask[] = [];
    const scheduled: (() => void)[] = [];

    await startReviewerTask({
      task,
      setCurrentTask,
      emitCommand,
      scheduleOpenReviewPanel: (callback) => {
        scheduled.push(callback);
      },
      onTaskSelected: (selectedTask) => {
        selected.push(selectedTask);
      },
    });

    expect(setCurrentTask).toHaveBeenCalledWith(task);
    expect(selected).toEqual([task]);
    expect(emitCommand).toHaveBeenCalledWith('panel.reviewerTasks');
    expect(scheduled).toHaveLength(1);

    scheduled[0]?.();

    expect(emitCommand).toHaveBeenLastCalledWith('panel.review');
    expect(getSubmitActionLabel(task.currentNode)).toBe('提交到批准');
    expect(task.requesterName).toBe('Designer One');
    expect(task.checkerName).toBe('Checker One');
    expect(task.approverName).toBe('Approver One');
    expect(task.components).toHaveLength(2);
  });

  it('reviewer primary forward labels stay on the standard submit path for each workflow node', () => {
    expect(getSubmitActionLabel('sj')).toBe('提交到校核');
    expect(getSubmitActionLabel('jd')).toBe('提交到审核');
    expect(getSubmitActionLabel('sh')).toBe('提交到批准');
    expect(getSubmitActionLabel('pz')).toBe('最终批准');
  });
});
