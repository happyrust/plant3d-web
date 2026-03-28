import type { GuideDefinition } from '../types';

import { isMyTasksAvailableInWorkflowMode } from '@/components/review/workflowMode';
import { ensurePanelAndActivate } from '@/composables/useDockApi';

const showMyTasksStep = isMyTasksAvailableInWorkflowMode();

export const designerGuide: GuideDefinition = {
  role: 'designer',
  title: '设计师校审向导',
  description: '了解如何发起提资、跟踪进度，并在驳回后完成修改与复提。',
  steps: [
    {
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description: '设计相关的提资、进度跟踪和复审入口都在「校审」标签页中。',
      placement: 'bottom',
    },
    {
      id: 'initiate-review-btn',
      targetSelector: '[data-command="panel.initiateReview"]',
      title: '打开提资入口',
      description: '点击「发起提资」进入设计师工作台，开始整理本次需要送审的三维内容。',
      placement: 'bottom',
    },
    {
      id: 'initiate-review-panel',
      targetSelector: '[data-panel="initiateReview"]',
      targetPanelId: 'initiateReview',
      title: '填写提资信息',
      description: '在这里填写提资包名称、说明，并指定校核员与审核员，让流程准确流转。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'select-component',
      targetSelector: '[data-guide="add-component-btn"]',
      targetPanelId: 'initiateReview',
      title: '选择送审构件',
      description: '先在三维模型中选中构件，再点击「添加当前选中」，把它们纳入本次提资范围。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'upload-attachment',
      targetSelector: '[data-guide="upload-section"]',
      targetPanelId: 'initiateReview',
      title: '补充附件材料',
      description: '可上传设计说明、计算书或参考图纸，帮助校核员与审核员更快理解设计意图。',
      placement: 'left',
      canSkip: true,
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'submit-review',
      targetSelector: '[data-guide="submit-btn"]',
      targetPanelId: 'initiateReview',
      title: '提交提资单',
      description: '确认构件、附件与角色信息无误后，点击主按钮提交，任务将进入后续校审流程。',
      placement: 'top',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'my-tasks-panel',
      targetSelector: '[data-command="panel.myTasks"]',
      title: '查看我的提资',
      description: '在「我的提资」里跟踪已发起任务的状态、附件和流转进度。',
      placement: 'bottom',
      onBeforeShow: () => ensurePanelAndActivate('myTasks'),
    },
    {
      id: 'resubmission-panel',
      targetSelector: '[data-command="panel.resubmissionTasks"]',
      title: '处理驳回与复审',
      description: '若任务被驳回，复审任务会出现在这里。根据意见修改后，可继续重新提交。',
      placement: 'bottom',
      onBeforeShow: () => ensurePanelAndActivate('resubmissionTasks'),
    },
  ].filter((step) => showMyTasksStep || step.id !== 'my-tasks-panel'),
};
