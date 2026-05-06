import { describe, expect, it, vi } from 'vitest';

import {
  resolveEmbedRestoreResult,
  restoreEmbedWorkbenchContext,
} from './embedContextRestore';

import type { ReviewTask } from '@/types/auth';

function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
  return {
    id: 'task-1',
    formId: 'FORM-1',
    title: '任务 1',
    description: 'desc',
    modelName: 'Model',
    status: 'submitted',
    priority: 'medium',
    requesterId: 'designer_001',
    requesterName: '王设计师',
    checkerId: 'checker_001',
    checkerName: '张校核',
    approverId: 'approver_001',
    approverName: '李审核',
    reviewerId: 'checker_001',
    reviewerName: '张校核',
    components: [],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    currentNode: 'jd',
    workflowHistory: [],
    ...overrides,
  };
}

describe('resolveEmbedRestoreResult', () => {
  it('returns no_form when form id is empty', () => {
    expect(resolveEmbedRestoreResult({
      target: 'reviewer',
      formId: null,
      reviewerTasks: [createTask()],
      designerTasks: [],
      allTasks: [],
    })).toEqual({
      restoreStatus: 'no_form',
      restoredTask: null,
      restoredTaskDraft: null,
      restoredTaskId: null,
      restoredTaskSummary: null,
      target: 'reviewer',
    });
  });

  it('prefers reviewer inbox matches by form id before falling back to all tasks', () => {
    const pending = createTask({ id: 'task-pending', formId: 'FORM-R' });
    const fallback = createTask({ id: 'task-fallback', formId: 'FORM-R' });

    const result = resolveEmbedRestoreResult({
      target: 'reviewer',
      formId: 'FORM-R',
      reviewerTasks: [pending],
      designerTasks: [],
      allTasks: [fallback],
    });

    expect(result.restoreStatus).toBe('matched');
    expect(result.restoredTask?.id).toBe('task-pending');
    expect(result.restoredTaskId).toBe('task-pending');
  });

  it('returns matched designer summary when the initiator slice contains the form id', () => {
    const task = createTask({
      id: 'task-designer',
      formId: 'FORM-D',
      status: 'draft',
      currentNode: 'sj',
      title: '设计侧任务',
    });

    const result = resolveEmbedRestoreResult({
      target: 'designer',
      formId: 'FORM-D',
      reviewerTasks: [],
      designerTasks: [task],
      allTasks: [],
    });

    expect(result).toMatchObject({
      restoreStatus: 'matched',
      restoredTaskId: 'task-designer',
      restoredTaskSummary: {
        title: '设计侧任务',
        status: 'draft',
        currentNode: 'sj',
      },
      restoredTaskDraft: {
        title: '设计侧任务',
        description: 'desc',
        taskId: 'task-designer',
        formId: 'FORM-D',
        components: [],
        draftComponents: [],
        attachments: [],
      },
    });
  });

  it('normalizes restored draft component refnos for designer side reuse', () => {
    const task = createTask({
      id: 'task-designer',
      formId: 'FORM-N',
      components: [
        { id: 'comp-1', name: '支管', refNo: '24381/145018', type: 'BRAN' },
      ],
    });

    const result = resolveEmbedRestoreResult({
      target: 'designer',
      formId: 'FORM-N',
      reviewerTasks: [],
      designerTasks: [task],
      allTasks: [],
    });

    expect(result.restoredTaskDraft?.components).toEqual([]);
    expect(result.restoredTaskDraft?.draftComponents).toEqual([
      { id: 'comp-1', name: '支管', refNo: '24381_145018', type: 'BRAN' },
    ]);
  });

  it('falls back to all tasks when the designer slice is temporarily empty for the same form id', () => {
    const task = createTask({
      id: 'task-designer-fallback',
      formId: 'FORM-D-FALLBACK',
      status: 'draft',
      currentNode: 'sj',
      title: '设计侧回填兜底',
      components: [
        { id: 'comp-1', name: '支管', refNo: '24381/145018', type: 'BRAN' },
      ],
    });

    const result = resolveEmbedRestoreResult({
      target: 'designer',
      formId: 'FORM-D-FALLBACK',
      reviewerTasks: [],
      designerTasks: [],
      allTasks: [task],
    });

    expect(result).toMatchObject({
      restoreStatus: 'matched',
      restoredTaskId: 'task-designer-fallback',
      restoredTaskSummary: {
        title: '设计侧回填兜底',
        status: 'draft',
        currentNode: 'sj',
      },
      restoredTaskDraft: {
        title: '设计侧回填兜底',
        taskId: 'task-designer-fallback',
        formId: 'FORM-D-FALLBACK',
        components: [],
        draftComponents: [
          { id: 'comp-1', name: '支管', refNo: '24381_145018', type: 'BRAN' },
        ],
      },
    });
  });
});

describe('restoreEmbedWorkbenchContext', () => {
  it('restores reviewer task context and focuses review panel when form id matches', async () => {
    const task = createTask({ id: 'task-reviewer', formId: 'FORM-R' });
    const openPanel = vi.fn();
    const activatePanel = vi.fn();
    const setCurrentTask = vi.fn(async () => undefined);
    const loadReviewTasks = vi.fn(async () => undefined);

    const result = await restoreEmbedWorkbenchContext({
      target: 'reviewer',
      formId: 'FORM-R',
      loadReviewTasks,
      reviewerTasks: () => [task],
      designerTasks: () => [],
      allTasks: () => [task],
      setCurrentTask,
      openPanel,
      activatePanel,
    });

    expect(loadReviewTasks).toHaveBeenCalledOnce();
    expect(setCurrentTask).toHaveBeenCalledWith(task);
    expect(openPanel).toHaveBeenCalledWith('review');
    expect(openPanel).toHaveBeenCalledTimes(1);
    expect(activatePanel).toHaveBeenCalledWith('review');
    expect(result.restoreStatus).toBe('matched');
  });

  it('keeps reviewer workbench in explicit missing-task state when form id is not found', async () => {
    const openPanel = vi.fn();
    const activatePanel = vi.fn();
    const setCurrentTask = vi.fn(async () => undefined);

    const result = await restoreEmbedWorkbenchContext({
      target: 'reviewer',
      formId: 'FORM-MISSING',
      loadReviewTasks: async () => undefined,
      reviewerTasks: () => [],
      designerTasks: () => [],
      allTasks: () => [],
      setCurrentTask,
      openPanel,
      activatePanel,
    });

    expect(setCurrentTask).toHaveBeenCalledWith(null);
    expect(openPanel).toHaveBeenCalledWith('review');
    expect(openPanel).toHaveBeenCalledTimes(1);
    expect(activatePanel).toHaveBeenCalledWith('review');
    expect(result.restoreStatus).toBe('missing');
  });

  it('keeps reviewer passive embed restore focused on review panel even when task is unresolved', async () => {
    const openPanel = vi.fn();
    const activatePanel = vi.fn();
    const setCurrentTask = vi.fn(async () => undefined);

    const result = await restoreEmbedWorkbenchContext({
      target: 'reviewer',
      formId: 'FORM-MISSING',
      loadReviewTasks: async () => undefined,
      reviewerTasks: () => [],
      designerTasks: () => [],
      allTasks: () => [],
      setCurrentTask,
      openPanel,
      activatePanel,
      passiveWorkflowMode: true,
    });

    expect(openPanel.mock.calls.map(([panelId]) => panelId)).toEqual(['review']);
    expect(activatePanel).toHaveBeenCalledWith('review');
    expect(setCurrentTask).toHaveBeenCalledWith(null);
    expect(result.restoreStatus).toBe('missing');
  });

  it('designer restore switches to designer comment handling when the matched task is already returned to sj', async () => {
    const task = createTask({
      id: 'task-designer-returned',
      formId: 'FORM-D-RETURNED',
      status: 'draft',
      currentNode: 'sj',
      returnReason: '请先处理批注',
    });
    const openPanel = vi.fn();
    const activatePanel = vi.fn();
    const setCurrentTask = vi.fn(async () => undefined);

    const result = await restoreEmbedWorkbenchContext({
      target: 'designer',
      formId: 'FORM-D-RETURNED',
      loadReviewTasks: async () => undefined,
      reviewerTasks: () => [],
      designerTasks: () => [task],
      allTasks: () => [task],
      setCurrentTask,
      openPanel,
      activatePanel,
      passiveWorkflowMode: true,
    });

    expect(setCurrentTask).toHaveBeenCalledWith(task);
    expect(openPanel.mock.calls.map(([panelId]) => panelId)).toEqual(['designerCommentHandling']);
    expect(activatePanel).toHaveBeenLastCalledWith('designerCommentHandling');
    expect(result.restoreStatus).toBe('matched');
  });

  it('designer passive restore keeps designer comment handling for the matched form even before task状态回到 sj', async () => {
    const task = createTask({
      id: 'task-designer-passive',
      formId: 'FORM-D-PASSIVE',
      status: 'submitted',
      currentNode: 'jd',
    });
    const openPanel = vi.fn();
    const activatePanel = vi.fn();
    const setCurrentTask = vi.fn(async () => undefined);

    const result = await restoreEmbedWorkbenchContext({
      target: 'designer',
      formId: 'FORM-D-PASSIVE',
      loadReviewTasks: async () => undefined,
      reviewerTasks: () => [],
      designerTasks: () => [],
      allTasks: () => [task],
      setCurrentTask,
      openPanel,
      activatePanel,
      passiveWorkflowMode: true,
    });

    expect(setCurrentTask).toHaveBeenCalledWith(task);
    expect(openPanel.mock.calls.map(([panelId]) => panelId)).toEqual(['designerCommentHandling']);
    expect(activatePanel).toHaveBeenLastCalledWith('designerCommentHandling');
    expect(result.restoreStatus).toBe('matched');
  });

  it('designer passive restore without matched task falls back to initiate-review workspace', async () => {
    const openPanel = vi.fn();
    const activatePanel = vi.fn();
    const setCurrentTask = vi.fn(async () => undefined);

    const result = await restoreEmbedWorkbenchContext({
      target: 'designer',
      formId: 'FORM-D-MISSING',
      loadReviewTasks: async () => undefined,
      reviewerTasks: () => [],
      designerTasks: () => [],
      allTasks: () => [],
      setCurrentTask,
      openPanel,
      activatePanel,
      passiveWorkflowMode: true,
    });

    expect(setCurrentTask).toHaveBeenCalledWith(null);
    expect(openPanel.mock.calls.map(([panelId]) => panelId)).toEqual(['initiateReview']);
    expect(activatePanel).toHaveBeenLastCalledWith('initiateReview');
    expect(result.restoreStatus).toBe('missing');
  });
});
