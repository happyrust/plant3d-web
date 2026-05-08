import { computed, nextTick, ref, watch } from 'vue';

import { useMenuMode } from './useMenuMode';
import { useUserStore } from './useUserStore';

import type { GuideContext, GuideDefinition, GuideStep, OnboardingPersistedState, WorkflowMode, WorkflowRole } from '@/components/onboarding/types';

import { buildDesignerGuide, designerGuide } from '@/components/onboarding/roleGuides/designerGuide';
import {
  buildManagerGuide,
  buildProofreaderGuide,
  buildReviewerGuide,
  managerGuide,
  proofreaderGuide,
  reviewerGuide,
} from '@/components/onboarding/roleGuides/reviewerGuide';
import { resolveWorkflowMode } from '@/components/review/workflowMode';

const STORAGE_KEY = 'plant3d-onboarding-v1';

export type GuideRole = 'designer' | 'proofreader' | 'reviewer' | 'manager';
export type GuideCenterTopic = 'currentRole' | 'designer' | 'proofreader' | 'reviewer' | 'manager' | 'initiateReview' | 'reviewerTasks' | 'reviewPanel';

const ROLE_TO_WORKFLOW_ROLE: Record<GuideRole, WorkflowRole> = {
  designer: 'sj',
  proofreader: 'jd',
  reviewer: 'sh',
  manager: 'pz',
};

const WORKFLOW_ROLE_TO_GUIDE_ROLE: Record<WorkflowRole, GuideRole> = {
  sj: 'designer',
  jd: 'proofreader',
  sh: 'reviewer',
  pz: 'manager',
};

type StartGuideOptions = {
  stepId?: string;
};

const allGuides: Record<GuideRole, GuideDefinition> = {
  designer: designerGuide,
  proofreader: proofreaderGuide,
  reviewer: reviewerGuide,
  manager: managerGuide,
};

function loadState(): OnboardingPersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { completedGuides: {} };
}

function saveState(state: OnboardingPersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

const active = ref(false);
const currentStepIndex = ref(0);
const currentGuide = ref<GuideDefinition | null>(null);
const persistedState = ref<OnboardingPersistedState>(loadState());
const guideCenterOpen = ref(false);
const guideCenterTopic = ref<GuideCenterTopic>('currentRole');

const currentStep = computed<GuideStep | null>(() => {
  if (!currentGuide.value) return null;
  return currentGuide.value.steps[currentStepIndex.value] ?? null;
});

const totalSteps = computed(() => currentGuide.value?.steps.length ?? 0);
const isFirstStep = computed(() => currentStepIndex.value === 0);
const isLastStep = computed(() => currentStepIndex.value >= totalSteps.value - 1);

const progress = computed(() => {
  if (totalSteps.value === 0) return 0;
  return ((currentStepIndex.value + 1) / totalSteps.value) * 100;
});

function guideKey(userId: string, role: string, workflowMode?: string): string {
  const mode = workflowMode || 'manual';
  return `${userId}__${role}__${mode}`;
}

function isGuideCompleted(userId: string, role: string, workflowMode?: string): boolean {
  // 同时检查新格式和旧格式 key，兼容已有完成记录
  const newKey = guideKey(userId, role, workflowMode);
  const legacyKey = `${userId}__${role}`;
  return !!persistedState.value.completedGuides[newKey]
    || !!persistedState.value.completedGuides[legacyKey];
}

function markGuideCompleted(userId: string, role: string, workflowMode?: string) {
  persistedState.value.completedGuides[guideKey(userId, role, workflowMode)] = true;
  saveState(persistedState.value);
}

function resetGuideForUser(userId: string, role: string, workflowMode?: string) {
  delete persistedState.value.completedGuides[guideKey(userId, role, workflowMode)];
  // 同时清除旧格式 key
  delete persistedState.value.completedGuides[`${userId}__${role}`];
  saveState(persistedState.value);
}

function resolveGuideStepIndex(guide: GuideDefinition, options?: StartGuideOptions): number {
  if (!options?.stepId) return 0;
  const index = guide.steps.findIndex((step) => step.id === options.stepId);
  return index >= 0 ? index : 0;
}

async function openStep(index: number) {
  currentStepIndex.value = index;
  await nextTick();
  const step = currentStep.value;
  if (step?.onBeforeShow) {
    await step.onBeforeShow();
    await nextTick();
  }
}

async function startGuide(guide: GuideDefinition, options?: StartGuideOptions) {
  guideCenterOpen.value = false;
  currentGuide.value = guide;
  active.value = true;
  await openStep(resolveGuideStepIndex(guide, options));
}

async function goToStep(index: number) {
  if (!currentGuide.value) return;
  if (index < 0 || index >= totalSteps.value) return;
  await openStep(index);
}

async function nextStep() {
  if (isLastStep.value) {
    finishGuide();
    return;
  }
  await goToStep(currentStepIndex.value + 1);
}

async function prevStep() {
  if (isFirstStep.value) return;
  await goToStep(currentStepIndex.value - 1);
}

function finishGuide() {
  const userStore = useUserStore();
  const userId = userStore.currentUserId.value;
  const role = userStore.currentUser.value?.role;
  const workflowMode = resolveWorkflowMode() as WorkflowMode;

  if (userId && role) {
    markGuideCompleted(userId, role, workflowMode);
  }

  active.value = false;
  currentGuide.value = null;
  currentStepIndex.value = 0;
}

function dismissGuide() {
  finishGuide();
}

function openGuideCenter(topic: GuideCenterTopic = 'currentRole') {
  guideCenterTopic.value = topic;
  guideCenterOpen.value = true;
}

function closeGuideCenter() {
  guideCenterOpen.value = false;
}

function resolveCurrentGuideContext(): GuideContext | null {
  const userStore = useUserStore();
  const { menuMode } = useMenuMode();
  const role = userStore.currentUser.value?.role as GuideRole | undefined;
  if (!role) return null;

  const workflowRole = ROLE_TO_WORKFLOW_ROLE[role] ?? 'sj';
  const workflowMode = resolveWorkflowMode() as WorkflowMode;

  return { workflowRole, workflowMode, menuMode: menuMode.value };
}

function resolveGuideForUser(ctx: GuideContext): GuideDefinition | null {
  const guideRole = WORKFLOW_ROLE_TO_GUIDE_ROLE[ctx.workflowRole];
  if (!guideRole) return null;

  switch (guideRole) {
    case 'designer': return buildDesignerGuide(ctx);
    case 'proofreader': return buildProofreaderGuide(ctx);
    case 'reviewer': return buildReviewerGuide(ctx);
    case 'manager': return buildManagerGuide(ctx);
    default: return null;
  }
}

async function startGuideForRole(role: GuideRole, options?: StartGuideOptions) {
  const ctx = resolveCurrentGuideContext();
  const workflowRole = ROLE_TO_WORKFLOW_ROLE[role];
  const guide = ctx
    ? resolveGuideForUser({ ...ctx, workflowRole })
    : allGuides[role];
  if (!guide) return;
  await startGuide(guide, options);
}

async function startGuideForCurrentRole(options?: StartGuideOptions) {
  const ctx = resolveCurrentGuideContext();
  if (!ctx) return;
  const guide = resolveGuideForUser(ctx);
  if (!guide) return;
  await startGuide(guide, options);
}

function shouldShowGuideForCurrentUser(): boolean {
  const userStore = useUserStore();
  const userId = userStore.currentUserId.value;
  const role = userStore.currentUser.value?.role;
  if (!userId || !role) return false;
  const workflowMode = resolveWorkflowMode() as WorkflowMode;
  return !isGuideCompleted(userId, role, workflowMode);
}

function autoStartIfNeeded() {
  if (active.value) return;
  if (!shouldShowGuideForCurrentUser()) return;
  void startGuideForCurrentRole();
}

export function useOnboardingGuide() {
  const userStore = useUserStore();

  watch(
    () => userStore.currentUser.value?.id,
    () => {
      if (active.value) {
        dismissGuide();
      }
      closeGuideCenter();
    },
  );

  return {
    active,
    currentStep,
    currentStepIndex,
    currentGuide,
    totalSteps,
    isFirstStep,
    isLastStep,
    progress,
    guideCenterOpen,
    guideCenterTopic,

    startGuide,
    startGuideForRole,
    startGuideForCurrentRole,
    nextStep,
    prevStep,
    goToStep,
    finishGuide,
    dismissGuide,
    openGuideCenter,
    closeGuideCenter,

    shouldShowGuideForCurrentUser,
    autoStartIfNeeded,
    resetGuideForUser,
    isGuideCompleted,
    resolveGuideForUser,
    resolveCurrentGuideContext,
    allGuides,
  };
}
