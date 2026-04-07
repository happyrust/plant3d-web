import type { GuideContext, GuideDefinition, GuideStep } from '../types';

import { ensurePanelAndActivate } from '@/composables/useDockApi';

export function buildDesignerGuide(ctx: GuideContext): GuideDefinition {
  const isRibbon = ctx.menuMode === 'ribbon';
  const isActiveWorkflow = ctx.workflowMode !== 'external';

  const steps: GuideStep[] = [];

  // Ribbon 模式：先引导到校审标签页
  if (isRibbon) {
    steps.push({
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description: '设计相关的提资、进度跟踪和复审入口都在「校审」标签页中。',
      placement: 'bottom',
      menuMode: 'ribbon',
      actionHint: '请在顶部 Ribbon 栏中找到「校审」标签页并点击。',
    });
    steps.push({
      id: 'initiate-review-btn',
      targetSelector: '[data-command="panel.initiateReview"]',
      title: '打开提资入口',
      description: '点击「发起提资」进入设计师工作台，开始整理本次需要送审的三维内容。',
      placement: 'bottom',
      menuMode: 'ribbon',
      actionHint: '请先点击顶部「校审」标签页展开功能区，再找到「发起提资」按钮。',
    });
  }

  // 提资面板核心步骤（两种菜单模式通用）
  steps.push(
    {
      id: 'initiate-review-panel',
      targetSelector: '[data-panel="initiateReview"]',
      targetPanelId: 'initiateReview',
      title: '填写提资信息',
      description: '在这里填写提资包名称、说明，并指定校核员与审核员，让流程准确流转。',
      placement: 'left',
      actionHint: '请在右侧面板中找到「发起提资」标签页，或通过菜单「校审 → 发起提资」打开。',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'select-component',
      targetSelector: '[data-guide="add-component-btn"]',
      targetPanelId: 'initiateReview',
      title: '选择送审构件',
      description: '先在三维模型中选中构件，再点击「添加当前选中」，把它们纳入本次提资范围。',
      placement: 'left',
      actionHint: '请先打开「发起提资」面板，在构件明细区域找到「添加构件」按钮。操作步骤：1. 在三维视图中点击选中构件 → 2. 点击「添加构件」。',
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
      actionHint: '请在「发起提资」面板中向下滚动，找到「模型附件」上传区域。此步骤可跳过。',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
    {
      id: 'submit-review',
      targetSelector: '[data-guide="submit-btn"]',
      targetPanelId: 'initiateReview',
      title: '提交提资单',
      description: '确认构件、附件与角色信息无误后，点击主按钮提交，任务将进入后续校审流程。',
      placement: 'top',
      actionHint: '请在「发起提资」面板底部找到「保存提资单数据」按钮。需要先填写数据包名称并添加构件。',
      onBeforeShow: () => ensurePanelAndActivate('initiateReview'),
    },
  );

  // "我的提资" — 仅 active workflow 下可用
  if (isActiveWorkflow) {
    steps.push({
      id: 'my-tasks-panel',
      targetSelector: isRibbon ? '[data-command="panel.myTasks"]' : '[data-panel="myTasks"]',
      title: '查看我的提资',
      description: '在「我的提资」里跟踪已发起任务的状态、附件和流转进度。',
      placement: isRibbon ? 'bottom' : 'left',
      requiresActiveWorkflow: true,
      actionHint: isRibbon ? '请点击「校审」标签页，找到「我的提资」按钮。' : '请在右侧面板中找到「我的提资」标签页。',
      onBeforeShow: () => ensurePanelAndActivate('myTasks'),
    });
  }

  // 驳回与复审：仅内部工作流；PMS 等外部驱动下退回/复审在平台侧处理
  if (isActiveWorkflow) {
    steps.push({
      id: 'resubmission-panel',
      targetSelector: isRibbon ? '[data-command="panel.resubmissionTasks"]' : '[data-panel="resubmissionTasks"]',
      title: '处理驳回与复审',
      description: '若任务被驳回，复审任务会出现在这里。根据意见修改后，可继续重新提交。',
      placement: isRibbon ? 'bottom' : 'left',
      actionHint: isRibbon ? '请点击「校审」标签页，找到「复审任务」按钮。' : '请在右侧面板中找到「复审任务」标签页。',
      onBeforeShow: () => ensurePanelAndActivate('resubmissionTasks'),
    });
  }

  return {
    role: 'designer',
    title: '设计师校审向导',
    description: ctx.workflowMode === 'external'
      ? '了解如何在外部流程模式下发起提资并跟踪进度。'
      : '了解如何发起提资、跟踪进度，并在驳回后完成修改与复提。',
    steps,
  };
}

// 兼容旧代码：提供默认上下文的静态导出
export const designerGuide: GuideDefinition = buildDesignerGuide({
  workflowRole: 'sj',
  workflowMode: 'manual',
  menuMode: 'hierarchical',
});
