import type { GuideDefinition } from '../types';

import { ensurePanelAndActivate } from '@/composables/useDockApi';

export const proofreaderGuide: GuideDefinition = {
  role: 'proofreader',
  title: '校核员校审向导',
  description: '了解如何接收并校核设计师的提资',
  steps: [
    {
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description: '所有校审相关操作都在「校审」标签页中，点击切换到此标签页。',
      placement: 'bottom',
    },
    {
      id: 'review-start-btn',
      targetSelector: '[data-command="review.start"]',
      title: '查看待审核任务',
      description: '点击「开始校审」进入待审核任务列表，查看分配给你的校核任务。',
      placement: 'bottom',
    },
    {
      id: 'reviewer-task-list',
      targetSelector: '[data-panel="reviewerTasks"]',
      targetPanelId: 'reviewerTasks',
      title: '待校核任务列表',
      description: '这里列出了所有分配给你的待校核任务。点击任务可以进入校审面板查看详情。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
    },
    {
      id: 'workflow-step-bar',
      targetSelector: '[data-guide="workflow-step-bar"]',
      targetPanelId: 'review',
      title: '工作流进度',
      description: '步骤条显示当前任务所处的审批阶段：编制 → 校核 → 审核 → 批准。当前高亮的是你需要处理的节点。',
      placement: 'bottom',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'confirm-data-btn',
      targetSelector: '[data-command="review.confirm"]',
      title: '确认三维数据',
      description: '在三维视图中检查构件数据，确认无误后点击「确认数据」记录校核结果。',
      placement: 'bottom',
    },
    {
      id: 'submit-or-return',
      targetSelector: '[data-guide="workflow-actions"]',
      targetPanelId: 'review',
      title: '提交或驳回',
      description: '校核完成后，可以「提交到审核」让审核员接手，或「驳回到编制」要求设计师修改。这是校核员的核心操作。',
      placement: 'top',
    },
  ],
};

export const reviewerGuide: GuideDefinition = {
  role: 'reviewer',
  title: '审核员校审向导',
  description: '了解如何审核校核结果并做出决策',
  steps: [
    {
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description: '审核功能在「校审」标签页中，点击切换到此标签页。',
      placement: 'bottom',
    },
    {
      id: 'reviewer-task-list',
      targetSelector: '[data-panel="reviewerTasks"]',
      targetPanelId: 'reviewerTasks',
      title: '待审核任务',
      description: '这里列出了经过校核后提交给你审核的任务。点击可进入详情。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
    },
    {
      id: 'review-panel',
      targetSelector: '[data-panel="review"]',
      targetPanelId: 'review',
      title: '审核面板',
      description: '在审核面板中查看确认记录、批注评论和附件。综合判断后做出审核决策。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'submit-or-return',
      targetSelector: '[data-guide="workflow-actions"]',
      targetPanelId: 'review',
      title: '审核决策',
      description: '审核通过可「提交到批准」，发现问题可「驳回到编制」或「驳回到校核」，要求相关人员修改。',
      placement: 'top',
    },
  ],
};

export const managerGuide: GuideDefinition = {
  role: 'manager',
  title: '批准人校审向导',
  description: '了解如何做出最终审批决策',
  steps: [
    {
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description: '批准操作在「校审」标签页中，点击切换到此标签页。',
      placement: 'bottom',
    },
    {
      id: 'reviewer-task-list',
      targetSelector: '[data-panel="reviewerTasks"]',
      targetPanelId: 'reviewerTasks',
      title: '待批准任务',
      description: '经过校核和审核后的任务会出现在这里，等待你的最终批准。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
    },
    {
      id: 'review-panel',
      targetSelector: '[data-panel="review"]',
      targetPanelId: 'review',
      title: '审批面板',
      description: '查看完整的工作流历史、确认记录和批注意见，综合评估后做出最终决策。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'finalize-decision',
      targetSelector: '[data-guide="workflow-actions"]',
      targetPanelId: 'review',
      title: '最终决策',
      description: '你可以「最终批准」完成审批流程，或「驳回」要求相关环节修改。批准后流程完结。',
      placement: 'top',
    },
  ],
};
