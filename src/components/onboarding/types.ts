import type { MenuMode } from '@/composables/useMenuMode';

export type StepPlacement = 'top' | 'bottom' | 'left' | 'right';

/** 工作流角色（对应后端 workflow 节点） */
export type WorkflowRole = 'sj' | 'jd' | 'sh' | 'pz';

/** 工作流模式 */
export type WorkflowMode = 'external' | 'manual' | 'internal';

/** 向导步骤构建上下文 */
export type GuideContext = {
  workflowRole: WorkflowRole;
  workflowMode: WorkflowMode;
  menuMode: MenuMode;
};

export type GuideStep = {
  id: string;
  targetSelector: string;
  targetPanelId?: string;
  title: string;
  description: string;
  placement: StepPlacement;
  canSkip?: boolean;
  /** 仅在指定菜单模式下显示此步骤 */
  menuMode?: MenuMode;
  /** 仅在非 passive（即 manual/internal）workflow 模式下显示此步骤 */
  requiresActiveWorkflow?: boolean;
  /** 步骤显示前的异步前置操作（如打开面板） */
  onBeforeShow?: () => Promise<void> | void;
  /** 当目标元素不存在时，显示的操作提示（告诉用户该做什么才能看到目标元素） */
  actionHint?: string;
  /** 当主 targetSelector 找不到时，尝试使用备选选择器定位 */
  fallbackSelector?: string;
};

export type GuideDefinition = {
  role: string;
  title: string;
  description: string;
  steps: GuideStep[];
};

export type OnboardingPersistedState = {
  completedGuides: Record<string, boolean>;
};
