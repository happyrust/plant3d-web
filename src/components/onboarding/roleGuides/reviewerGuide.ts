import type { GuideContext, GuideDefinition, GuideStep } from '../types';

import { ensurePanelAndActivate } from '@/composables/useDockApi';

function buildRibbonEntrySteps(description: string): GuideStep[] {
  return [
    {
      id: 'ribbon-review-tab',
      targetSelector: '[data-ribbon-tab="review"]',
      title: '校审功能区',
      description,
      placement: 'bottom',
      menuMode: 'ribbon',
      actionHint: '请在顶部 Ribbon 栏中找到「校审」标签页并点击。',
    },
  ];
}

function buildReviewStartStep(isRibbon: boolean): GuideStep {
  return isRibbon
    ? {
      id: 'review-start-btn',
      targetSelector: '[data-command="review.start"]',
      title: '查看待处理任务',
      description: '点击「开始校审」进入待处理任务列表，查看分配给你的任务。',
      placement: 'bottom',
      menuMode: 'ribbon',
      actionHint: '请先点击「校审」标签页，找到「开始校审」按钮并点击。',
    }
    : {
      id: 'reviewer-task-list',
      targetSelector: '[data-panel="reviewerTasks"]',
      targetPanelId: 'reviewerTasks',
      title: '查看待处理任务',
      description: '打开待处理任务列表，查看分配给你的任务。',
      placement: 'left',
      actionHint: '请通过菜单「校审 → 待审核」打开任务列表面板。',
      onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
    };
}

function buildReviewPanelSteps(isPassive: boolean): GuideStep[] {
  const steps: GuideStep[] = [
    {
      id: 'review-panel-header',
      targetSelector: '[data-guide="review-panel-header"]',
      targetPanelId: 'review',
      title: '进入校审面板',
      description: isPassive
        ? '从外部平台进入本单据后，任务标题、当前流程节点与构件范围等上下文集中在这里。'
        : '打开任务后，你会在这里看到任务标题、当前流程节点、任务构件过滤等核心上下文。',
      placement: 'bottom',
      actionHint: isPassive
        ? '请确保已打开「校审」面板；若未显示，可通过右侧标签页或菜单「校审」进入。'
        : '请先在「待审核任务」列表中点击选择一个任务，点击「开始校审」按钮进入校审面板。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'workflow-step-bar',
      targetSelector: '[data-guide="workflow-step-bar"]',
      targetPanelId: 'review',
      title: '工作流进度',
      description: '步骤条显示当前任务所处的审批阶段：编制 → 校核 → 审核 → 批准。当前高亮的是你需要处理的节点。',
      placement: 'bottom',
      actionHint: isPassive
        ? '进入校审面板后即可在本区域上方看到流程步骤条。'
        : '请先选择一个任务并点击「开始校审」，进入校审面板后即可看到流程步骤条。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'review-panel-tools',
      targetSelector: '[data-guide="review-panel-tools"]',
      targetPanelId: 'review',
      title: '批注与测量工具',
      description: '在这里可以直接启动文字批注、云线批注、矩形批注和测量，用于记录发现的问题。',
      placement: 'top',
      actionHint: isPassive
        ? '工具栏在「校审」面板中部，可点击「文字批注」「云线批注」等进行标注。'
        : '请先选择一个任务并进入校审面板，工具栏在面板中部。可以点击「文字批注」、「云线批注」等按钮开始标注。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'confirm-data-btn',
      targetSelector: '[data-command="review.confirm"]',
      targetPanelId: 'review',
      title: '确认当前数据',
      description: '完成批注与测量后，点击这里将当前这批三维校核数据保存到确认记录。',
      placement: 'top',
      actionHint: '请先进入校审面板，「确认数据」按钮在 Ribbon 校审标签页或校审面板上方。完成批注后点击即可保存。',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'confirmed-records',
      targetSelector: '[data-testid="review-workbench-confirmed-records-zone"]',
      targetPanelId: 'review',
      title: '查看确认记录',
      description: '保存后的记录会出现在这里，你可以回看每一批已确认的批注数量、测量数量和备注。',
      placement: 'top',
      actionHint: '请先进入校审面板并完成「确认数据」操作，确认记录区域会在面板下方出现。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
  ];

  if (!isPassive) {
    steps.push({
      id: 'submit-or-return',
      targetSelector: '[data-guide="workflow-actions"]',
      targetPanelId: 'review',
      title: '提交或驳回',
      description: '校核完成后，可以提交到下一节点，也可以驳回到前置节点要求修改。',
      placement: 'top',
      requiresActiveWorkflow: true,
      actionHint: '请先选择任务并进入校审面板，在面板标题区域下方找到「提交」或「驳回」按钮。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    });
  }

  return steps;
}

export function buildProofreaderGuide(ctx: GuideContext): GuideDefinition {
  const isRibbon = ctx.menuMode === 'ribbon';
  const isPassive = ctx.workflowMode === 'external';

  const steps: GuideStep[] = [];

  if (isRibbon) {
    steps.push(...buildRibbonEntrySteps('所有校审相关操作都在「校审」标签页中，先从这里进入工作区。'));
  }

  // 外部流程：入口在外部表单列表，不引导应用内「待办任务」列表
  if (!isPassive) {
    steps.push(buildReviewStartStep(isRibbon));
    if (isRibbon) {
      steps.push({
        id: 'reviewer-task-list',
        targetSelector: '[data-panel="reviewerTasks"]',
        targetPanelId: 'reviewerTasks',
        title: '待校核任务列表',
        description: '这里列出了所有分配给你的待校核任务。点击任务即可进入校审面板。',
        placement: 'left',
        actionHint: '请通过菜单「校审 → 待审核」打开任务列表面板。',
        onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
      });
    }
  }

  steps.push(...buildReviewPanelSteps(isPassive));

  return {
    role: 'proofreader',
    title: '校核员校审向导',
    description: isPassive
      ? '了解如何在外部流程模式下接收设计提资、完成三维校核。'
      : '了解如何接收设计提资、完成三维校核并提交下一节点。',
    steps,
  };
}

export function buildReviewerGuide(ctx: GuideContext): GuideDefinition {
  const isRibbon = ctx.menuMode === 'ribbon';
  const isPassive = ctx.workflowMode === 'external';

  const steps: GuideStep[] = [];

  if (isRibbon) {
    steps.push(...buildRibbonEntrySteps('审核功能在「校审」标签页中，点击切换到此标签页。'));
  }

  if (!isPassive) {
    steps.push({
      id: 'reviewer-task-list',
      targetSelector: '[data-panel="reviewerTasks"]',
      targetPanelId: 'reviewerTasks',
      title: '待审核任务',
      description: '这里列出了经过校核后提交给你审核的任务。点击任务可进入详情。',
      placement: 'left',
      actionHint: '请通过菜单「校审 → 待审核」打开任务列表面板。',
      onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
    });
  }

  steps.push(
    {
      id: 'review-panel',
      targetSelector: '[data-panel="review"]',
      targetPanelId: 'review',
      title: '审核面板',
      description: isPassive
        ? '从外部平台进入后，在此查看本单据的任务上下文、当前节点与三维校审内容。'
        : '在审核面板中查看任务上下文、当前节点与核心审核动作。',
      placement: 'left',
      actionHint: isPassive
        ? '请通过右侧「校审」面板或菜单进入；若已打开嵌入上下文，面板中应显示当前单据。'
        : '请先在任务列表中点击选择一个任务，点击「开始校审」进入校审面板。',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'confirmed-records',
      targetSelector: '[data-testid="review-workbench-confirmed-records-zone"]',
      targetPanelId: 'review',
      title: '确认记录与三维数据',
      description: '这里集中展示校核人已确认保存的批注、测量和备注，是审核时首先需要关注的内容。',
      placement: 'top',
      actionHint: '请先进入校审面板，确认记录区域在面板下方。如果没有记录，请先点击「确认数据」保存一次。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'annotation-list',
      targetSelector: '[data-guide="annotation-list-zone"]',
      targetPanelId: 'review',
      title: '批注列表与评论',
      description: '展开具体批注后，可以查看批注详情、评论线程以及定位操作。',
      placement: 'top',
      actionHint: '批注列表在校审面板中部。如果当前没有批注，请先使用批注工具创建一个。可以跳过此步。',
      canSkip: true,
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'review-panel-tools',
      targetSelector: '[data-guide="review-panel-tools"]',
      targetPanelId: 'review',
      title: '继续补充批注或测量',
      description: '如果审核过程中发现新的问题，也可以在这里直接继续发起批注、云线或测量。',
      placement: 'top',
      actionHint: isPassive
        ? '批注工具栏在「校审」面板中部。'
        : '请先进入校审面板，批注工具栏在面板中部。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
  );

  if (!isPassive) {
    steps.push({
      id: 'submit-or-return',
      targetSelector: '[data-guide="workflow-actions"]',
      targetPanelId: 'review',
      title: '审核决策',
      description: '审核通过可提交到批准，发现问题可驳回到设计或校核节点，要求相关人员修改。',
      placement: 'top',
      requiresActiveWorkflow: true,
      actionHint: '请先选择任务并进入校审面板，在面板标题区下方找到「提交」或「驳回」按钮。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    });
  }

  return {
    role: 'reviewer',
    title: '审核员校审向导',
    description: isPassive
      ? '了解如何在外部流程模式下读取校核结果并复核三维内容。'
      : '了解如何读取校核结果、复核三维内容并做出审核决策。',
    steps,
  };
}

export function buildManagerGuide(ctx: GuideContext): GuideDefinition {
  const isRibbon = ctx.menuMode === 'ribbon';
  const isPassive = ctx.workflowMode === 'external';

  const steps: GuideStep[] = [];

  if (isRibbon) {
    steps.push(...buildRibbonEntrySteps('批准操作在「校审」标签页中，点击切换到此标签页。'));
  }

  if (!isPassive) {
    steps.push({
      id: 'reviewer-task-list',
      targetSelector: '[data-panel="reviewerTasks"]',
      targetPanelId: 'reviewerTasks',
      title: '待批准任务',
      description: '经过校核和审核后的任务会出现在这里，等待你的最终批准。',
      placement: 'left',
      actionHint: '请通过菜单「校审 → 待审核」打开任务列表面板。',
      onBeforeShow: () => ensurePanelAndActivate('reviewerTasks'),
    });
  }

  steps.push(
    {
      id: 'review-panel',
      targetSelector: '[data-panel="review"]',
      targetPanelId: 'review',
      title: '审批面板',
      description: isPassive
        ? '从外部平台进入后，在此查看完整流程、确认记录、批注与附件。'
        : '在这里查看完整流程、确认记录、批注意见和附件，再做最终判断。',
      placement: 'left',
      actionHint: isPassive
        ? '请通过右侧「校审」面板或菜单进入当前单据的校审视图。'
        : '请先在任务列表中点击选择一个任务，点击「开始校审」进入校审面板。',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
    {
      id: 'confirmed-records',
      targetSelector: '[data-testid="review-workbench-confirmed-records-zone"]',
      targetPanelId: 'review',
      title: '已确认记录',
      description: '批准前建议重点复查确认记录，确认批注、测量和备注都已经闭环。',
      placement: 'top',
      actionHint: '请先进入校审面板，确认记录区域在面板下方。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    },
  );

  if (!isPassive) {
    steps.push({
      id: 'finalize-decision',
      targetSelector: '[data-guide="workflow-actions"]',
      targetPanelId: 'review',
      title: '最终决策',
      description: '你可以最终批准完成流程，也可以驳回要求相关环节继续修改。',
      placement: 'top',
      requiresActiveWorkflow: true,
      actionHint: '请先选择任务并进入校审面板，在面板标题区下方找到「批准」或「驳回」按钮。',
      fallbackSelector: '[data-panel="review"]',
      onBeforeShow: () => ensurePanelAndActivate('review'),
    });
  }

  return {
    role: 'manager',
    title: '批准人校审向导',
    description: isPassive
      ? '了解如何在外部流程模式下查看完整校审链路。'
      : '了解如何查看完整校审链路并做出最终批准决策。',
    steps,
  };
}

// 兼容旧代码：提供默认上下文的静态导出
const defaultCtx: GuideContext = { workflowRole: 'jd', workflowMode: 'manual', menuMode: 'hierarchical' };
export const proofreaderGuide: GuideDefinition = buildProofreaderGuide(defaultCtx);
export const reviewerGuide: GuideDefinition = buildReviewerGuide({ ...defaultCtx, workflowRole: 'sh' });
export const managerGuide: GuideDefinition = buildManagerGuide({ ...defaultCtx, workflowRole: 'pz' });
