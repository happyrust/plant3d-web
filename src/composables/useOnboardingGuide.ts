import { computed, nextTick, ref, watch } from 'vue';

import { useUserStore } from './useUserStore';

import type { GuideDefinition, GuideStep, OnboardingPersistedState } from '@/components/onboarding/types';

import { designerGuide } from '@/components/onboarding/roleGuides/designerGuide';
import { managerGuide, proofreaderGuide, reviewerGuide } from '@/components/onboarding/roleGuides/reviewerGuide';

const STORAGE_KEY = 'plant3d-onboarding-v1';

const allGuides: Record<string, GuideDefinition> = {
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

function guideKey(userId: string, role: string): string {
  return `${userId}__${role}`;
}

function isGuideCompleted(userId: string, role: string): boolean {
  return !!persistedState.value.completedGuides[guideKey(userId, role)];
}

function markGuideCompleted(userId: string, role: string) {
  persistedState.value.completedGuides[guideKey(userId, role)] = true;
  saveState(persistedState.value);
}

function resetGuideForUser(userId: string, role: string) {
  delete persistedState.value.completedGuides[guideKey(userId, role)];
  saveState(persistedState.value);
}

async function startGuide(guide: GuideDefinition) {
  currentGuide.value = guide;
  currentStepIndex.value = 0;
  active.value = true;

  await nextTick();
  const step = currentStep.value;
  if (step?.onBeforeShow) {
    await step.onBeforeShow();
    await nextTick();
  }
}

async function goToStep(index: number) {
  if (!currentGuide.value) return;
  if (index < 0 || index >= totalSteps.value) return;

  currentStepIndex.value = index;
  await nextTick();

  const step = currentStep.value;
  if (step?.onBeforeShow) {
    await step.onBeforeShow();
    await nextTick();
  }
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

  if (userId && role) {
    markGuideCompleted(userId, role);
  }

  active.value = false;
  currentGuide.value = null;
  currentStepIndex.value = 0;
}

function dismissGuide() {
  finishGuide();
}

function startGuideForCurrentRole() {
  const userStore = useUserStore();
  const role = userStore.currentUser.value?.role;
  if (!role) return;

  const guide = allGuides[role];
  if (!guide) return;

  startGuide(guide);
}

function shouldShowGuideForCurrentUser(): boolean {
  const userStore = useUserStore();
  const userId = userStore.currentUserId.value;
  const role = userStore.currentUser.value?.role;
  if (!userId || !role) return false;
  return !isGuideCompleted(userId, role);
}

function autoStartIfNeeded() {
  if (active.value) return;
  if (!shouldShowGuideForCurrentUser()) return;
  startGuideForCurrentRole();
}

export function useOnboardingGuide() {
  const userStore = useUserStore();

  watch(
    () => userStore.currentUser.value?.id,
    () => {
      if (active.value) {
        dismissGuide();
      }
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

    startGuide,
    startGuideForCurrentRole,
    nextStep,
    prevStep,
    goToStep,
    finishGuide,
    dismissGuide,

    shouldShowGuideForCurrentUser,
    autoStartIfNeeded,
    resetGuideForUser,
    isGuideCompleted,
    allGuides,
  };
}
