import { afterEach, describe, expect, it, vi } from 'vitest';

const currentUser = vi.hoisted(() => ({
  value: { id: 'user-1', role: 'designer' as string } as { id: string; role: string } | null,
}));
const workflowMode = vi.hoisted(() => ({
  value: 'manual' as 'external' | 'manual' | 'internal',
}));
const dockMocks = vi.hoisted(() => ({
  ensurePanelAndActivate: vi.fn(),
}));
const toastMocks = vi.hoisted(() => ({
  emitToast: vi.fn(),
}));

vi.mock('./useUserStore', () => ({
  useUserStore: () => ({
    currentUser,
    currentUserId: { value: currentUser.value?.id ?? null },
  }),
}));

vi.mock('./useMenuMode', () => ({
  useMenuMode: () => ({
    menuMode: { value: 'hierarchical' },
  }),
}));

vi.mock('@/components/review/workflowMode', () => ({
  isInternalWorkflowModeFeatureEnabled: () => true,
  isMyTasksAvailableInWorkflowMode: () => workflowMode.value !== 'external',
  resolvePassiveWorkflowMode: () => workflowMode.value === 'external',
  resolveWorkflowMode: () => workflowMode.value,
}));

vi.mock('@/composables/useDockApi', () => ({
  ensurePanelAndActivate: dockMocks.ensurePanelAndActivate,
}));

vi.mock('@/ribbon/toastBus', () => ({
  emitToast: toastMocks.emitToast,
}));

import { useOnboardingGuide } from './useOnboardingGuide';

afterEach(() => {
  useOnboardingGuide().dismissGuide();
  workflowMode.value = 'manual';
  dockMocks.ensurePanelAndActivate.mockReset();
  toastMocks.emitToast.mockReset();
});

describe('useOnboardingGuide current role resolution', () => {
  it('根据登录工作流码 sh 启动审核员向导', async () => {
    currentUser.value = { id: 'sh-user', role: 'sh' };

    const guide = useOnboardingGuide();
    await guide.startGuideForCurrentRole();

    expect(guide.currentGuide.value?.role).toBe('reviewer');
  });

  it('根据管理员登录角色启动批准人向导', async () => {
    currentUser.value = { id: 'admin-user', role: 'admin' };

    const guide = useOnboardingGuide();
    await guide.startGuideForCurrentRole();

    expect(guide.currentGuide.value?.role).toBe('manager');
  });
});

describe('useOnboardingGuide contextual entries', () => {
  it('从发起编校审操作指南直达设计师发起步骤', async () => {
    currentUser.value = { id: 'designer-user', role: 'designer' };

    const guide = useOnboardingGuide();
    const started = await guide.startContextualGuide('initiateReview');

    expect(started).toBe(true);
    expect(guide.currentGuide.value?.role).toBe('designer');
    expect(guide.currentStep.value?.id).toBe('initiate-review-panel');
    expect(dockMocks.ensurePanelAndActivate).toHaveBeenCalledWith('initiateReview');
  });

  it('从待办任务操作指南按当前审核角色直达待办步骤', async () => {
    currentUser.value = { id: 'reviewer-user', role: 'sh' };

    const guide = useOnboardingGuide();
    const started = await guide.startContextualGuide('reviewerTasks');

    expect(started).toBe(true);
    expect(guide.currentGuide.value?.role).toBe('reviewer');
    expect(guide.currentStep.value?.id).toBe('reviewer-task-list');
    expect(dockMocks.ensurePanelAndActivate).toHaveBeenCalledWith('reviewerTasks');
  });

  it('外部流程下从校审面板操作指南进入校审面板头部步骤', async () => {
    currentUser.value = { id: 'proofreader-user', role: 'jd' };
    workflowMode.value = 'external';

    const guide = useOnboardingGuide();
    const started = await guide.startContextualGuide('reviewPanel');

    expect(started).toBe(true);
    expect(guide.currentGuide.value?.role).toBe('proofreader');
    expect(guide.currentStep.value?.id).toBe('review-panel-header');
    expect(dockMocks.ensurePanelAndActivate).toHaveBeenCalledWith('review');
  });

  it('未识别角色不会默认落到设计师向导', async () => {
    currentUser.value = { id: 'viewer-user', role: 'viewer' };

    const guide = useOnboardingGuide();
    const started = await guide.startContextualGuide('reviewPanel');

    expect(started).toBe(false);
    expect(guide.currentGuide.value).toBeNull();
    expect(guide.guideCenterOpen.value).toBe(true);
    expect(guide.guideCenterTopic.value).toBe('reviewPanel');
    expect(toastMocks.emitToast).toHaveBeenCalledWith({
      message: '暂未识别当前工作流角色，请从导航中心选择教程',
      level: 'warning',
    });
  });

  it('播放其他角色教程不会误标记当前登录角色已完成', async () => {
    currentUser.value = { id: 'cross-role-user', role: 'sh' };

    const guide = useOnboardingGuide();
    await guide.startGuideForRole('designer');
    guide.finishGuide();

    expect(guide.isGuideCompleted('cross-role-user', 'sh', 'manual')).toBe(false);
    expect(guide.isGuideCompleted('cross-role-user', 'designer', 'manual')).toBe(true);
  });
});
