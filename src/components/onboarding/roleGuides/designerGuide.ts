import { ensurePanelAndActivate } from '@/composables/useDockApi';

import type { GuideDefinition } from '../types';

export const designerGuide: GuideDefinition = {
  role: 'designer',
  title: '设计师校审向导',
  description: '了解如何发起设计提资并跟踪审批进度',
  steps: [
    {
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description: '这是校审功能的入口区域。所有校审相关操作都在这里，点击切换到「校审」标签页。',
      placement: 'bottom',
    },
    {
      id: 'initiate-review-btn',
      targetSelector: '[data-command="panel.initiateReview"]',
      title: '发起提资',
      description: '点击「发起提资」按钮进入提资表单。设计师从这里填写内容并提交给后续审核流程。',
      placement: 'bottom',
    },
    {
      id: 'initiate-review-panel',
      targetSelector: '[data-panel="initiateReview"]',
      targetPanelId: 'initiateReview',
      title: '填写提资信息',
      description: '在这里填写提资包名称、描述，并选择校核员和审核员。这些信息将帮助审核人员了解提资内容。',
      placement: 'left',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'select-component',
      targetSelector: '[data-guide="add-component-btn"]',
      targetPanelId: 'initiateReview',
      title: '选择构件',
      description: '在三维模型中点击选择需要提资的构件，然后点击「添加当前选中」将其加入提资范围。',
      placement: 'left',
    },
    {
      id: 'upload-attachment',
      targetSelector: '[data-guide="upload-section"]',
      targetPanelId: 'initiateReview',
      title: '上传附件',
      description: '可以上传设计说明、计算书或参考图纸等附件，帮助审核人员全面了解设计意图。',
      placement: 'left',
      canSkip: true,
    },
    {
      id: 'submit-review',
      targetSelector: '[data-guide="submit-btn"]',
      targetPanelId: 'initiateReview',
      title: '提交提资',
      description: '填写完毕后点击「提交」，提资单将发送给校核员进行校核。',
      placement: 'top',
    },
    {
      id: 'my-tasks-panel',
      targetSelector: '[data-command="panel.myTasks"]',
      title: '查看我的提资',
      description: '提交后可以在「我的提资」面板中随时查看提资进度。任务状态会实时更新。',
      placement: 'bottom',
    },
    {
      id: 'resubmission-panel',
      targetSelector: '[data-command="panel.resubmissionTasks"]',
      title: '处理驳回与复审',
      description: '如果提资被驳回，驳回的任务会出现在「复审任务」中。修改后可以重新提交，直到最终通过批准。',
      placement: 'bottom',
    },
  ],
};
