import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';

import TaskReviewDetail from './TaskReviewDetail.vue';

import type { ReviewTask, WorkflowStep } from '@/types/auth';

const reviewTaskGetWorkflowMock = vi.fn();

vi.mock('@/api/reviewApi', () => ({
  reviewTaskGetWorkflow: (...args: unknown[]) => reviewTaskGetWorkflowMock(...args),
}));

describe('TaskReviewDetail', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    reviewTaskGetWorkflowMock.mockReset();
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

    await mountComponent(createTask());

    expect(reviewTaskGetWorkflowMock).toHaveBeenCalledWith('task-1');
    expect(document.body.textContent).toContain('B1 管线复核任务');
    expect(document.body.textContent).toContain('完整任务信息');
    expect(document.body.textContent).toContain('王设计师');
    expect(document.body.textContent).toContain('李校核');
    expect(document.body.textContent).toContain('周审核');
    expect(document.body.textContent).toContain('P-101');
    expect(document.body.textContent).toContain('BRAN-001');
    expect(document.body.textContent).toContain('collision-report.pdf');
    expect(document.body.textContent).toContain('工作流历史时间线');
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
});
