export type StepPlacement = 'top' | 'bottom' | 'left' | 'right';

export type GuideStep = {
  id: string;
  targetSelector: string;
  targetPanelId?: string;
  title: string;
  description: string;
  placement: StepPlacement;
  canSkip?: boolean;
  /** 步骤显示前的异步前置操作（如打开面板） */
  onBeforeShow?: () => Promise<void> | void;
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
