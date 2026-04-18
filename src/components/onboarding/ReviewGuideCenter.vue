<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { BookOpen, Compass, HelpCircle, PlayCircle, Sparkles } from 'lucide-vue-next';

import type { GuideContext, WorkflowRole } from './types';

import Dialog from '@/components/ui/Dialog.vue';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useOnboardingGuide, type GuideCenterTopic, type GuideRole } from '@/composables/useOnboardingGuide';
import { useUserStore } from '@/composables/useUserStore';
import { onCommand } from '@/ribbon/commandBus';
import { UserRole } from '@/types/auth';

function guideRoleFromUserRole(role: string | undefined): GuideRole | null {
  if (!role) return null;
  if (role === UserRole.DESIGNER) return 'designer';
  if (role === UserRole.PROOFREADER) return 'proofreader';
  if (role === UserRole.REVIEWER) return 'reviewer';
  if (role === UserRole.MANAGER) return 'manager';
  if (role === UserRole.ADMIN) return 'manager';
  return null;
}

const ROLE_TO_WORKFLOW_ROLE: Record<GuideRole, WorkflowRole> = {
  designer: 'sj',
  proofreader: 'jd',
  reviewer: 'sh',
  manager: 'pz',
};

const onboarding = useOnboardingGuide();
const userStore = useUserStore();
const showAllGuideOperations = ref(false);

watch(
  () => onboarding.guideCenterOpen.value,
  (open) => {
    if (!open) showAllGuideOperations.value = false;
  },
);

const currentGuideCtx = computed<GuideContext | null>(() => onboarding.resolveCurrentGuideContext());
const showMyTasksEntry = computed(() => currentGuideCtx.value?.workflowMode !== 'external');

const ROLE_LABELS: Record<GuideRole, string> = {
  designer: '设计师',
  proofreader: '校核员',
  reviewer: '审核员',
  manager: '批准人',
};

const ROLE_SUMMARIES: Record<GuideRole, string> = {
  designer: '负责选择构件、整理编校审内容并跟踪驳回与复审任务。',
  proofreader: '负责进入待办任务、做批注与测量、确认当前数据并提交下一节点。',
  reviewer: '负责读取校核结果、复核三维内容、查看确认记录后做审核决策。',
  manager: '负责查看完整校审链路、确认记录与附件，并做最终批准决策。',
};

/** 外部流程（如 PMS）：平台驱动流转，向导不强调退回/节点提交类操作 */
const ROLE_SUMMARIES_PASSIVE: Record<GuideRole, string> = {
  designer: '负责选择构件、整理编校审内容；后续环节由外部平台驱动。',
  proofreader: '负责进入待办任务、做批注与测量、确认当前三维校核数据。',
  reviewer: '负责读取校核结果、复核三维内容并查看确认记录。',
  manager: '负责查看完整校审链路、确认记录与附件。',
};

const roleOrder: GuideRole[] = ['designer', 'proofreader', 'reviewer', 'manager'];

const currentGuideRole = computed(() => guideRoleFromUserRole(userStore.currentUser.value?.role));
const currentRoleLabel = computed(() =>
  (currentGuideRole.value ? ROLE_LABELS[currentGuideRole.value] : '当前角色'));
const currentRoleSummary = computed(() => {
  if (!currentGuideRole.value) return '请选择角色教程开始浏览。';
  const passive = currentGuideCtx.value?.workflowMode === 'external';
  return passive
    ? ROLE_SUMMARIES_PASSIVE[currentGuideRole.value]
    : ROLE_SUMMARIES[currentGuideRole.value];
});

const roleCards = computed(() =>
  roleOrder.map((role) => {
    const ctx = currentGuideCtx.value;
    const guide = ctx
      ? onboarding.resolveGuideForUser({ ...ctx, workflowRole: ROLE_TO_WORKFLOW_ROLE[role] })
      : onboarding.allGuides[role];
    const passive = ctx?.workflowMode === 'external';
    return {
      role,
      label: ROLE_LABELS[role],
      guide: guide ?? onboarding.allGuides[role],
      active: currentGuideRole.value === role,
      stepCount: (guide ?? onboarding.allGuides[role]).steps.length,
      summary: passive ? ROLE_SUMMARIES_PASSIVE[role] : ROLE_SUMMARIES[role],
    };
  }),
);

const displayRoleCards = computed(() => {
  if (showAllGuideOperations.value) return roleCards.value;
  const gr = currentGuideRole.value;
  if (!gr) return roleCards.value;
  return roleCards.value.filter((c) => c.role === gr);
});

const quickActions = computed(() => {
  const role = currentGuideRole.value;
  const list: {
    id: string;
    title: string;
    description: string;
    topic: GuideCenterTopic;
    actionLabel: string;
    stepsHint: string;
    run: () => Promise<void> | void;
  }[] = [];

  list.push({
    id: 'role-guide',
    title: '从当前角色教程开始',
    description: role
      ? `按${ROLE_LABELS[role]}视角，完整走一遍当前角色最常见的操作路径。`
      : '当前未识别角色时，可先从角色教程开始。',
    topic: 'currentRole',
    actionLabel: '开始角色教程',
    stepsHint: role
      ? `约 ${(currentGuideCtx.value ? onboarding.resolveGuideForUser({ ...currentGuideCtx.value, workflowRole: ROLE_TO_WORKFLOW_ROLE[role] }) : onboarding.allGuides[role])?.steps.length ?? '?'} 步`
      : '完整教程',
    run: () => onboarding.startGuideForCurrentRole(),
  });

  if (role === 'designer') {
    list.push({
      id: 'initiate-review',
      title: '学习如何发起编校审',
      description: '从选择构件、填写编校审信息到提交，适合第一次发起三维校审。',
      topic: 'initiateReview',
      actionLabel: '打开编校审指南',
      stepsHint: '从编校审面板开始',
      run: async () => {
        ensurePanelAndActivate('initiateReview');
        await onboarding.startGuideForRole('designer', { stepId: 'initiate-review-panel' });
      },
    });

    if (showMyTasksEntry.value) {
      list.push({
        id: 'designer-my-tasks',
        title: '查看我的编校审进度',
        description: '快速定位自己发起的编校审单，检查当前状态、附件和流转进度。',
        topic: 'designer',
        actionLabel: '打开我的编校审',
        stepsHint: '进度追踪',
        run: async () => {
          ensurePanelAndActivate('myTasks');
          await onboarding.startGuideForRole('designer', { stepId: 'my-tasks-panel' });
        },
      });

      list.push({
        id: 'designer-resubmission',
        title: '学习如何处理驳回与复审',
        description: '当编校审单被退回时，查看复审任务、修改内容并重新提交。',
        topic: 'designer',
        actionLabel: '打开复审指南',
        stepsHint: '驳回闭环',
        run: async () => {
          ensurePanelAndActivate('resubmissionTasks');
          await onboarding.startGuideForRole('designer', { stepId: 'resubmission-panel' });
        },
      });
    }
  } else {
    const targetRole: GuideRole = role === 'manager' ? 'manager' : role === 'reviewer' ? 'reviewer' : 'proofreader';

    if (showMyTasksEntry.value) {
      list.push({
        id: 'reviewer-tasks',
        title: '学习如何处理待办任务',
        description: '从待处理编校审任务列表进入，找到当前应处理的校审 / 审核任务。',
        topic: 'reviewerTasks',
        actionLabel: '打开待办任务指南',
        stepsHint: '从任务列表开始',
        run: async () => {
          ensurePanelAndActivate('reviewerTasks');
          await onboarding.startGuideForRole(targetRole, { stepId: 'reviewer-task-list' });
        },
      });
    }

    list.push({
      id: 'review-panel',
      title: '学习如何使用校审面板',
      description: '重点了解批注、测量、确认当前数据、确认记录与审核动作。',
      topic: 'reviewPanel',
      actionLabel: '打开面板指南',
      stepsHint: showMyTasksEntry.value ? '批注 / 测量 / 提交' : '批注 / 测量 / 确认',
      run: async () => {
        ensurePanelAndActivate('review');
        let stepId: string;
        if (targetRole === 'proofreader') {
          stepId = showMyTasksEntry.value ? 'review-panel-tools' : 'review-panel-header';
        } else {
          stepId = 'review-panel';
        }
        await onboarding.startGuideForRole(targetRole, { stepId });
      },
    });
  }

  return list;
});

const mainSectionDescription = computed(() => {
  const passive = currentGuideCtx.value?.workflowMode === 'external';
  if (showAllGuideOperations.value || !currentGuideRole.value) {
    return passive
      ? '这里聚合了三维校审最常见的操作导航：使用校审面板、发起编校审等。外部流程下通常从平台表单列表进入当前单据，无需在应用内打开待办任务。'
      : '这里聚合了三维校审最常见的操作导航：进入待办、使用校审面板、发起编校审、查看复审与进度。';
  }
  return `以下仅展示与「${ROLE_LABELS[currentGuideRole.value]}」工作流角色相关的教程入口。勾选侧栏「显示所有操作」可浏览全部角色教程。`;
});

const usageTips = computed(() => {
  const base = [
    '第一次上手时，优先从“当前角色教程”完整走一遍。',
    '如果你已经在某个面板里卡住，直接点该面板顶部的“操作指南”。',
  ];
  if (currentGuideRole.value === null && !showAllGuideOperations.value) {
    return base;
  }
  const showDesigner = showAllGuideOperations.value || currentGuideRole.value === 'designer';
  const showReviewer = showAllGuideOperations.value || (currentGuideRole.value != null && currentGuideRole.value !== 'designer');
  const out = [...base];
  if (showDesigner) {
    if (showMyTasksEntry.value) {
      out.push('设计师建议先完成“发起编校审”，再查看“我的编校审”或“复审任务”。');
    } else {
      out.push('设计师建议先完成“发起编校审”；进度与退回处理通常在外部平台完成。');
    }
  }
  if (showReviewer) {
    out.push('涉及批注、测量、确认当前数据时，建议优先打开“校审面板”教程。');
  }
  return out;
});

const topicHeadline = computed(() => {
  switch (onboarding.guideCenterTopic.value) {
    case 'initiateReview':
      return '你当前更可能需要“发起编校审”的操作说明。';
    case 'reviewerTasks':
      return '你当前更可能需要“待办任务处理”的操作说明。';
    case 'reviewPanel':
      return '你当前更可能需要“校审面板”的操作说明。';
    case 'designer':
    case 'proofreader':
    case 'reviewer':
    case 'manager':
      return `当前推荐先查看${ROLE_LABELS[onboarding.guideCenterTopic.value]}教程。`;
    default:
      return '从角色教程或任务教程开始，快速熟悉三维校审流程。';
  }
});

function openRoleGuide(role: GuideRole) {
  void onboarding.startGuideForRole(role);
}

let offHelpReviewGuide: (() => void) | null = null;

onMounted(() => {
  offHelpReviewGuide = onCommand((commandId) => {
    if (commandId === 'help.reviewGuide') {
      onboarding.openGuideCenter('currentRole');
    }
  });
});

onUnmounted(() => {
  offHelpReviewGuide?.();
  offHelpReviewGuide = null;
});
</script>

<template>
  <Dialog :open="onboarding.guideCenterOpen.value"
    title="三维校审使用导航"
    panel-class="relative w-full max-w-[68rem] overflow-hidden rounded-[16px] bg-white shadow-[0_24px_60px_rgba(17,24,39,0.22)]"
    body-class="px-0 py-0"
    @update:open="(value) => { if (!value) onboarding.closeGuideCenter(); }">
    <div class="grid min-h-[34rem] gap-0 md:grid-cols-[20rem_minmax(0,1fr)]">
      <aside class="border-b border-slate-200 bg-slate-50 p-5 md:border-b-0 md:border-r">
        <div class="flex items-center gap-2 text-slate-900">
          <Compass class="h-5 w-5 text-blue-600" />
          <div>
            <div class="text-sm font-semibold">导航中心</div>
            <div class="text-xs text-slate-500">按角色或任务快速进入教程</div>
          </div>
        </div>

        <div class="mt-5 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 font-medium">
              <Sparkles class="h-4 w-4" />
              推荐起点
            </div>
            <span v-if="currentGuideRole"
              class="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              {{ currentRoleLabel }}
            </span>
          </div>
          <p class="mt-2 text-xs leading-5 text-blue-800">{{ topicHeadline }}</p>
          <p class="mt-2 text-xs leading-5 text-blue-700/90">{{ currentRoleSummary }}</p>
        </div>

        <div class="mt-5">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <span class="flex items-center gap-2">
              <BookOpen class="h-3.5 w-3.5" />
              角色教程
            </span>
          </div>
          <label v-if="currentGuideRole"
            class="mt-3 flex cursor-pointer items-center gap-2 text-sm font-normal normal-case tracking-normal text-slate-700">
            <input v-model="showAllGuideOperations" type="checkbox"
              class="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
            显示所有操作
          </label>
          <div class="mt-3 space-y-2">
            <button v-for="item in displayRoleCards"
              :key="item.role"
              type="button"
              class="w-full rounded-xl border px-3 py-3 text-left transition"
              :class="item.active
                ? 'border-blue-200 bg-blue-50 text-blue-900 shadow-sm'
                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'"
              @click="openRoleGuide(item.role)">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold">{{ item.label }}</div>
                  <div class="mt-1 text-xs leading-5 text-slate-500">{{ item.summary }}</div>
                </div>
                <div class="flex flex-col items-end gap-1">
                  <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{{ item.stepCount }} 步</span>
                  <span v-if="item.active" class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">当前角色</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </aside>

      <section class="flex min-h-0 flex-col p-5">
        <div class="flex items-start justify-between gap-4">
          <div>
            <div class="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">任务教程</div>
            <h3 class="mt-2 text-lg font-semibold text-slate-950">从当前工作开始</h3>
            <p class="mt-1 text-sm leading-6 text-slate-500">{{ mainSectionDescription }}</p>
          </div>
          <button type="button"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
            @click="onboarding.startGuideForCurrentRole()">
            <PlayCircle class="h-4 w-4" />
            播放当前角色教程
          </button>
        </div>

        <div class="mt-5 grid gap-3 lg:grid-cols-2">
          <article v-for="item in quickActions"
            :key="item.id"
            class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h4 class="text-sm font-semibold text-slate-900">{{ item.title }}</h4>
                <p class="mt-2 text-sm leading-6 text-slate-500">{{ item.description }}</p>
              </div>
              <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                {{ item.stepsHint }}
              </span>
            </div>
            <div class="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <span class="inline-flex items-center gap-1.5 text-xs text-slate-400">
                <HelpCircle class="h-3.5 w-3.5" />
                适合当前页面快速上手
              </span>
              <button type="button"
                class="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                @click="item.run()">
                <PlayCircle class="h-4 w-4" />
                {{ item.actionLabel }}
              </button>
            </div>
          </article>
        </div>

        <div class="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <div class="font-medium text-slate-900">使用建议</div>
          <ul class="mt-2 list-disc space-y-1 pl-5 leading-6">
            <li v-for="(tip, i) in usageTips" :key="i">{{ tip }}</li>
          </ul>
        </div>
      </section>
    </div>
  </Dialog>
</template>
