<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import { BookOpen, Compass, HelpCircle, PlayCircle, Sparkles } from 'lucide-vue-next';

import Dialog from '@/components/ui/Dialog.vue';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useOnboardingGuide, type GuideCenterTopic, type GuideRole } from '@/composables/useOnboardingGuide';
import { useUserStore } from '@/composables/useUserStore';
import { onCommand } from '@/ribbon/commandBus';

const onboarding = useOnboardingGuide();
const userStore = useUserStore();

const ROLE_LABELS: Record<GuideRole, string> = {
  designer: '设计师',
  proofreader: '校核员',
  reviewer: '审核员',
  manager: '批准人',
};

const roleOrder: GuideRole[] = ['designer', 'proofreader', 'reviewer', 'manager'];

const roleCards = computed(() =>
  roleOrder.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    guide: onboarding.allGuides[role],
    active: userStore.currentUser.value?.role === role,
  }))
);

const currentRole = computed(() => userStore.currentUser.value?.role as GuideRole | undefined);


const quickActions = computed(() => {
  const role = currentRole.value;
  const list: Array<{
    id: string;
    title: string;
    description: string;
    topic: GuideCenterTopic;
    actionLabel: string;
    run: () => Promise<void> | void;
  }> = [];

  list.push({
    id: 'role-guide',
    title: '从当前角色教程开始',
    description: role
      ? `按${ROLE_LABELS[role]}视角，快速了解这条校审流程。`
      : '当前未识别角色时，可先从角色教程开始。',
    topic: 'currentRole',
    actionLabel: '开始角色教程',
    run: () => onboarding.startGuideForCurrentRole(),
  });

  if (role === 'designer') {
    list.push({
      id: 'initiate-review',
      title: '学习如何发起提资',
      description: '从选择构件、填写表单到提交提资，适合设计师第一次上手。',
      topic: 'initiateReview',
      actionLabel: '打开提资指南',
      run: async () => {
        ensurePanelAndActivate('initiateReview');
        await onboarding.startGuideForRole('designer', { stepId: 'initiate-review-panel' });
      },
    });
  } else {
    list.push({
      id: 'reviewer-tasks',
      title: '学习如何处理待办任务',
      description: '从待处理提资任务列表进入，并开始你的校审/审核工作。',
      topic: 'reviewerTasks',
      actionLabel: '打开待办任务指南',
      run: async () => {
        ensurePanelAndActivate('reviewerTasks');
        const targetRole: GuideRole = role === 'manager' ? 'manager' : role === 'reviewer' ? 'reviewer' : 'proofreader';
        await onboarding.startGuideForRole(targetRole, { stepId: 'reviewer-task-list' });
      },
    });

    list.push({
      id: 'review-panel',
      title: '学习如何使用校审面板',
      description: '重点了解批注、测量、确认当前数据、确认记录与审核动作。',
      topic: 'reviewPanel',
      actionLabel: '打开面板指南',
      run: async () => {
        ensurePanelAndActivate('review');
        const targetRole: GuideRole = role === 'manager' ? 'manager' : role === 'reviewer' ? 'reviewer' : 'proofreader';
        const stepId = targetRole === 'proofreader' ? 'review-panel-tools' : 'review-panel';
        await onboarding.startGuideForRole(targetRole, { stepId });
      },
    });
  }

  return list;
});

const topicHeadline = computed(() => {
  switch (onboarding.guideCenterTopic.value) {
    case 'initiateReview':
      return '你当前更可能需要“发起提资”的操作说明。';
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
    panel-class="relative w-full max-w-[64rem] overflow-hidden rounded-[16px] bg-white shadow-[0_24px_60px_rgba(17,24,39,0.22)]"
    body-class="px-0 py-0"
    @update:open="(value) => { if (!value) onboarding.closeGuideCenter(); }">
    <div class="grid min-h-[32rem] gap-0 md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside class="border-b border-slate-200 bg-slate-50 p-5 md:border-b-0 md:border-r">
        <div class="flex items-center gap-2 text-slate-900">
          <Compass class="h-5 w-5 text-blue-600" />
          <div>
            <div class="text-sm font-semibold">导航中心</div>
            <div class="text-xs text-slate-500">按角色或任务快速进入教程</div>
          </div>
        </div>

        <div class="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
          <div class="flex items-center gap-2 font-medium">
            <Sparkles class="h-4 w-4" />
            推荐起点
          </div>
          <p class="mt-2 text-xs leading-5 text-blue-800">{{ topicHeadline }}</p>
        </div>

        <div class="mt-5">
          <div class="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            <BookOpen class="h-3.5 w-3.5" />
            角色教程
          </div>
          <div class="mt-3 space-y-2">
            <button v-for="item in roleCards"
              :key="item.role"
              type="button"
              class="w-full rounded-xl border px-3 py-3 text-left transition"
              :class="item.active
                ? 'border-blue-200 bg-blue-50 text-blue-900 shadow-sm'
                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50'"
              @click="openRoleGuide(item.role)">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <div class="text-sm font-semibold">{{ item.label }}</div>
                  <div class="mt-1 text-xs text-slate-500">{{ item.guide.description }}</div>
                </div>
                <span v-if="item.active" class="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">当前角色</span>
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
            <p class="mt-1 text-sm leading-6 text-slate-500">
              这里聚合了三维校审最常见的操作导航：进入待办、使用校审面板、发起提资。
            </p>
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
                {{ item.actionLabel }}
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
            <li>第一次上手时，优先从“当前角色教程”完整走一遍。</li>
            <li>如果你已经在某个面板里卡住，直接点该面板顶部的“操作指南”。</li>
            <li>涉及批注、测量、确认当前数据时，建议优先打开“校审面板”教程。</li>
          </ul>
        </div>
      </section>
    </div>
  </Dialog>
</template>
