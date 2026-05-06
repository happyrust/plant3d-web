import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import TaskReviewDetail from './TaskReviewDetail.vue';

import type { ReviewTask, WorkflowStep } from '@/types/auth';

const reviewTaskGetWorkflowMock = vi.fn();
const reviewRecordGetByTaskIdMock = vi.fn();
const submitTaskToNextNodeMock = vi.fn();
const notifyParentWorkflowActionMock = vi.fn(() => false);
const emitToastMock = vi.fn();
const reviewTasksRef = { value: [] as ReviewTask[] };

vi.mock('@/api/reviewApi', () => ({
  reviewTaskGetWorkflow: (...args: unknown[]) => reviewTaskGetWorkflowMock(...args),
  reviewRecordGetByTaskId: (...args: unknown[]) => reviewRecordGetByTaskIdMock(...args),
}));

vi.mock('@/composables/useUserStore', () => ({
  useUserStore: () => ({
    reviewTasks: reviewTasksRef,
    submitTaskToNextNode: (...args: unknown[]) => submitTaskToNextNodeMock(...args),
  }),
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: (...args: unknown[]) => emitToastMock(...args),
}));

vi.mock('./workflowBridge', () => ({
  notifyParentWorkflowAction: (...args: unknown[]) => notifyParentWorkflowActionMock(...args),
}));

describe('TaskReviewDetail', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    reviewTaskGetWorkflowMock.mockReset();
    reviewRecordGetByTaskIdMock.mockReset();
    submitTaskToNextNodeMock.mockReset();
    notifyParentWorkflowActionMock.mockReset();
    notifyParentWorkflowActionMock.mockReturnValue(false);
    emitToastMock.mockReset();
    reviewTasksRef.value = [];
    reviewRecordGetByTaskIdMock.mockResolvedValue({ success: true, records: [] });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function createTask(overrides: Partial<ReviewTask> = {}): ReviewTask {
    return {
      id: 'task-1',
      title: 'B1 管线复核任务',
      description: '需要检查支吊架净高与碰撞问题。',
      modelName: '主装置模型',
      status: 'rejected',
      priority: 'high',
      requesterId: 'designer-1',
      requesterName: '王设计师',
      checkerId: 'checker-1',
      checkerName: '李校核',
      approverId: 'approver-1',
      approverName: '周审核',
      reviewerId: 'checker-1',
      reviewerName: '李校核',
      components: [
        { id: 'comp-1', name: 'P-101', refNo: 'BRAN-001', type: 'pipe' },
        { id: 'comp-2', name: 'P-102', refNo: 'BRAN-002', type: 'pipe' },
      ],
      attachments: [
        {
          id: 'att-1',
          name: 'collision-report.pdf',
          url: '/files/collision-report.pdf',
          mimeType: 'application/pdf',
          uploadedAt: new Date('2026-03-16T08:00:00+08:00').getTime(),
        },
      ],
      reviewComment: '请补充碰撞说明。',
      createdAt: new Date('2026-03-15T10:00:00+08:00').getTime(),
      updatedAt: new Date('2026-03-16T09:00:00+08:00').getTime(),
      dueDate: new Date('2026-03-20T18:00:00+08:00').getTime(),
      currentNode: 'sj',
      returnReason: '支吊架净高不足，请重新调整。',
      workflowHistory: [
        {
          node: 'jd',
          action: 'return',
          operatorId: 'checker-1',
          operatorName: '李校核',
          comment: '支吊架净高不足，请重新调整。',
          timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
        },
      ],
      ...overrides,
    };
  }

  async function mountComponent(task: ReviewTask) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    createApp({
      render: () => h(TaskReviewDetail, { task, onClose: () => undefined }),
    }).mount(host);
    await vi.dynamicImportSettled();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
    return host;
  }

  it('renders complete task information, attachments and workflow history', async () => {
    const history: WorkflowStep[] = [
      {
        node: 'sj',
        action: 'submit',
        operatorId: 'designer-1',
        operatorName: '王设计师',
        comment: '提交校核。',
        timestamp: new Date('2026-03-15T12:00:00+08:00').getTime(),
      },
      {
        node: 'jd',
        action: 'return',
        operatorId: 'checker-1',
        operatorName: '李校核',
        comment: '支吊架净高不足，请重新调整。',
        timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
      },
    ];
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history,
    });
    reviewRecordGetByTaskIdMock.mockResolvedValue({
      success: true,
      records: [
        {
          id: 'record-1',
          taskId: 'task-1',
          formId: 'FORM-DETAIL-1',
          type: 'batch',
          annotations: [],
          cloudAnnotations: [],
          rectAnnotations: [],
          measurements: [
            {
              id: 'measure-distance-1',
              kind: 'distance',
              origin: { entityId: 'o:24381_145018:0', worldPos: [0, 0, 0] },
              target: { entityId: '24381_145019', worldPos: [1, 0, 0] },
              visible: true,
              createdAt: new Date('2026-03-16T07:30:00+08:00').getTime(),
            },
          ],
          note: '保留确认后的测量回放',
          confirmedAt: new Date('2026-03-16T09:30:00+08:00').getTime(),
        },
      ],
    });

    await mountComponent(createTask());

    expect(reviewTaskGetWorkflowMock).toHaveBeenCalledWith('task-1');
    expect(reviewRecordGetByTaskIdMock).toHaveBeenCalledWith('task-1');
    expect(document.body.textContent).toContain('B1 管线复核任务');
    expect(document.body.textContent).toContain('完整任务信息');
    expect(document.body.textContent).toContain('王设计师');
    expect(document.body.textContent).toContain('李校核');
    expect(document.body.textContent).toContain('周审核');
    expect(document.body.textContent).toContain('P-101');
    expect(document.body.textContent).toContain('BRAN-001');
    expect(document.body.textContent).toContain('collision-report.pdf');
    expect(document.body.textContent).toContain('工作流历史时间线');
    expect(document.body.textContent).toContain('已确认测量回放');
    expect(document.body.textContent).toContain('1 条测量');
    expect(document.body.textContent).toContain('距离测量');
    expect(document.body.textContent).toContain('起点 24381/145018 -> 终点 24381/145019');
    expect(document.body.textContent).toContain('保留确认后的测量回放');
    expect(document.body.textContent).toContain('提交');
    expect(document.body.textContent).toContain('驳回');
    expect(document.body.textContent).toContain('备注：提交校核。');

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    const labelledBy = dialog?.getAttribute('aria-labelledby');
    const title = labelledBy ? document.getElementById(labelledBy) : null;
    expect(title?.textContent).toContain('B1 管线复核任务');
  });

  it('shows rejected return node and return reason in detail header', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [
        {
          node: 'jd',
          action: 'return',
          operatorId: 'checker-1',
          operatorName: '李校核',
          comment: '请补充退回原因说明。',
          timestamp: new Date('2026-03-16T11:00:00+08:00').getTime(),
        },
      ],
    });

    await mountComponent(
      createTask({
        returnReason: '旧退回原因',
        currentNode: 'sj',
      })
    );

    expect(document.body.textContent).toContain('退回信息');
    expect(document.body.textContent).toContain('退回节点：');
    expect(document.body.textContent).toContain('校核');
    expect(document.body.textContent).toContain('退回原因：');
    expect(document.body.textContent).toContain('请补充退回原因说明。');
  });

  it('prefers the latest return step metadata over stale task-level return fields', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [
        {
          node: 'jd',
          action: 'return',
          operatorId: 'checker-1',
          operatorName: '李校核',
          comment: '第一次退回原因',
          timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
        },
        {
          node: 'sh',
          action: 'return',
          operatorId: 'approver-1',
          operatorName: '周审核',
          comment: '最新退回原因：请补充审核节点说明。',
          timestamp: new Date('2026-03-16T18:00:00+08:00').getTime(),
        },
      ],
    });

    await mountComponent(
      createTask({
        status: 'draft',
        currentNode: 'sj',
        returnReason: '旧退回原因',
        workflowHistory: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '第一次退回原因',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
        ],
      })
    );

    expect(document.body.textContent).toContain('退回节点：');
    expect(document.body.textContent).toContain('审核');
    expect(document.body.textContent).toContain('最新退回原因：请补充审核节点说明。');
    expect(document.body.textContent).not.toContain('旧退回原因');
  });

  it('refreshes returned header metadata after workflow history reload for the same task id', async () => {
    reviewTaskGetWorkflowMock
      .mockResolvedValueOnce({
        success: true,
        currentNode: 'sj',
        currentNodeName: '编制',
        history: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '旧校核退回原因',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        currentNode: 'sj',
        currentNodeName: '编制',
        history: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '旧校核退回原因',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
          {
            node: 'sh',
            action: 'return',
            operatorId: 'approver-1',
            operatorName: '周审核',
            comment: '刷新后的最新审核退回原因',
            timestamp: new Date('2026-03-16T18:00:00+08:00').getTime(),
          },
        ],
      });

    await mountComponent(
      createTask({
        id: 'same-task-id',
        status: 'draft',
        currentNode: 'sj',
        returnReason: '任务级旧退回原因',
        workflowHistory: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '旧校核退回原因',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
        ],
      })
    );

    expect(document.body.textContent).toContain('校核');
    expect(document.body.textContent).toContain('旧校核退回原因');
    expect(document.body.textContent).not.toContain('任务级旧退回原因');

    const refreshButton = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('刷新'));
    expect(refreshButton).toBeTruthy();

    refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(reviewTaskGetWorkflowMock).toHaveBeenCalledTimes(2);
    expect(reviewTaskGetWorkflowMock).toHaveBeenNthCalledWith(1, 'same-task-id');
    expect(reviewTaskGetWorkflowMock).toHaveBeenNthCalledWith(2, 'same-task-id');
    expect(document.body.textContent).toContain('审核');
    expect(document.body.textContent).toContain('刷新后的最新审核退回原因');
    expect(document.body.textContent).not.toContain('任务级旧退回原因');
  });

  it('falls back to task workflow history and shows load error when workflow request fails', async () => {
    reviewTaskGetWorkflowMock.mockRejectedValue(new Error('网络异常'));

    await mountComponent(
      createTask({
        workflowHistory: [
          {
            node: 'sj',
            action: 'submit',
            operatorId: 'designer-1',
            operatorName: '王设计师',
            comment: '使用本地历史兜底。',
            timestamp: new Date('2026-03-15T12:00:00+08:00').getTime(),
          },
        ],
      })
    );

    expect(document.body.textContent).toContain('网络异常');
    expect(document.body.textContent).toContain('使用本地历史兜底。');
  });

  it('shows resubmit button for rejected task and resubmits successfully', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [],
    });
    reviewRecordGetByTaskIdMock.mockResolvedValue({ success: true, records: [] });
    submitTaskToNextNodeMock.mockResolvedValue(undefined);
    reviewTasksRef.value = [createTask({ status: 'submitted', currentNode: 'jd', returnReason: undefined, reviewComment: undefined })];

    await mountComponent(createTask({ status: 'draft', currentNode: 'sj' }));

    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    expect(button).toBeTruthy();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
    await nextTick();

    expect(submitTaskToNextNodeMock).toHaveBeenCalledWith('task-1');
    expect(reviewTaskGetWorkflowMock).toHaveBeenCalledTimes(2);
    expect(reviewRecordGetByTaskIdMock).toHaveBeenCalledTimes(2);
  });

  it('notifies parent workflow bridge instead of internal submit in external embedded workflow', async () => {
    notifyParentWorkflowActionMock.mockReturnValue(true);
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [],
    });
    reviewRecordGetByTaskIdMock.mockResolvedValue({ success: true, records: [] });

    await mountComponent(createTask({
      status: 'draft',
      currentNode: 'sj',
      formId: 'FORM-DETAIL-1',
    }));

    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(notifyParentWorkflowActionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'active',
      taskId: 'task-1',
      formId: 'FORM-DETAIL-1',
      source: 'task-review-detail',
    }));
    expect(submitTaskToNextNodeMock).not.toHaveBeenCalled();
  });

  it('shows an empty measurement replay state when no confirmed measurements are available', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [],
    });
    reviewRecordGetByTaskIdMock.mockResolvedValue({
      success: true,
      records: [
        {
          id: 'record-without-measurement',
          taskId: 'task-1',
          formId: 'FORM-DETAIL-1',
          type: 'batch',
          annotations: [],
          cloudAnnotations: [],
          rectAnnotations: [],
          measurements: [],
          note: 'no measurement',
          confirmedAt: new Date('2026-03-16T09:30:00+08:00').getTime(),
        },
      ],
    });

    await mountComponent(createTask());

    expect(document.body.textContent).toContain('暂无已确认测量记录');
  });

  it('shows resubmit button for canonical returned draft task', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [
        {
          node: 'jd',
          action: 'return',
          operatorId: 'checker-1',
          operatorName: '李校核',
          comment: '请补充碰撞说明。',
          timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
        },
      ],
    });

    await mountComponent(createTask({ status: 'draft', currentNode: 'sj' }));

    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    expect(button).toBeTruthy();
    expect(document.body.textContent).toContain('当前单据已回到设计节点，可再次提交。');
  });

  it('does not show resubmit button once returned task has re-entered review flow', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'jd',
      currentNodeName: '校核',
      history: [
        {
          node: 'jd',
          action: 'return',
          operatorId: 'checker-1',
          operatorName: '李校核',
          comment: '请补充碰撞说明。',
          timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
        },
      ],
    });

    await mountComponent(createTask({ status: 'submitted', currentNode: 'jd' }));

    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    expect(button).toBeUndefined();
    expect(document.body.textContent).not.toContain('再次提交');
  });

  it('clears stale returned state UI after resubmit reload shows task back in review flow', async () => {
    reviewTaskGetWorkflowMock
      .mockResolvedValueOnce({
        success: true,
        currentNode: 'sj',
        currentNodeName: '编制',
        history: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '请补充碰撞说明。',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        currentNode: 'jd',
        currentNodeName: '校核',
        history: [
          {
            node: 'jd',
            action: 'return',
            operatorId: 'checker-1',
            operatorName: '李校核',
            comment: '请补充碰撞说明。',
            timestamp: new Date('2026-03-16T09:00:00+08:00').getTime(),
          },
          {
            node: 'sj',
            action: 'submit',
            operatorId: 'designer-1',
            operatorName: '王设计师',
            comment: '重新提交',
            timestamp: new Date('2026-03-16T11:00:00+08:00').getTime(),
          },
        ],
      });
    submitTaskToNextNodeMock.mockResolvedValue(undefined);
    reviewTasksRef.value = [createTask({ status: 'submitted', currentNode: 'jd', returnReason: undefined, reviewComment: undefined })];

    await mountComponent(createTask({ status: 'draft', currentNode: 'sj' }));

    expect(document.body.textContent).toContain('退回信息');
    expect(document.body.textContent).toContain('请补充碰撞说明。');

    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    expect(button).toBeTruthy();

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(submitTaskToNextNodeMock).toHaveBeenCalledWith('task-1');
    expect(reviewTaskGetWorkflowMock).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain('退回信息');
    const afterButton = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    expect(afterButton).toBeUndefined();
  });

  it('shows resubmit failure message when resubmit request fails', async () => {
    reviewTaskGetWorkflowMock.mockResolvedValue({
      success: true,
      currentNode: 'sj',
      currentNodeName: '编制',
      history: [],
    });
    submitTaskToNextNodeMock.mockRejectedValue(new Error('提交流转失败'));

    await mountComponent(createTask({ status: 'draft', currentNode: 'sj' }));

    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('再次提交'));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(document.body.textContent).toContain('提交流转失败');
    expect(emitToastMock).not.toHaveBeenCalled();
  });
});
