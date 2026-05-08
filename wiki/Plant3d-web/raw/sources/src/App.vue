<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { authVerifyToken } from '@/api/reviewApi';
import AboutDialog from '@/components/AboutDialog.vue';
import DashboardLayout from '@/components/dashboard/DashboardLayout.vue';
import DockLayout from '@/components/DockLayout.vue';
import OnboardingOverlay from '@/components/onboarding/OnboardingOverlay.vue';
import ReviewGuideCenter from '@/components/onboarding/ReviewGuideCenter.vue';
import ReleaseNotesDialog from '@/components/ReleaseNotesDialog.vue';
import HierarchicalMenuBar from '@/components/ribbon/HierarchicalMenuBar.vue';
import RibbonBar from '@/components/ribbon/RibbonBar.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import LayoutToggleButtons from '@/components/ui/LayoutToggleButtons.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';
import { useMenuMode } from '@/composables/useMenuMode';
import { useModelProjects } from '@/composables/useModelProjects';
import { useOnboardingGuide } from '@/composables/useOnboardingGuide';

const { isRibbonMode, toggleMenuMode } = useMenuMode();
const ribbonBarRef = ref<InstanceType<typeof RibbonBar> | null>(null);
const ribbonCollapsed = computed(() => ribbonBarRef.value?.collapsed ?? false);
const extensionHeight = computed(() =>
  isRibbonMode.value ? (ribbonCollapsed.value ? 32 : 120) : 48,
);

const urlParams = new URLSearchParams(window.location.search);
const showBenchmark = urlParams.get('benchmark') === 'true';
const requestedOutputProject = urlParams.get('output_project')?.trim() ?? '';
const hasRequestedOutputProject = requestedOutputProject.length > 0;

const { currentProject, loadProjects, switchProjectById, projects } = useModelProjects();

const onboarding = useOnboardingGuide();
const embedBootstrapPending = ref(false);
const showDashboardLayout = computed(() =>
  !currentProject.value && !embedBootstrapPending.value && !hasRequestedOutputProject,
);

function isCurrentProjectMatched(projectId: string): boolean {
  return currentProject.value?.id === projectId || currentProject.value?.path === projectId;
}

async function bootstrapEmbedProjectFromToken() {
  const token = urlParams.get('user_token')?.trim();
  if (!token) return;

  embedBootstrapPending.value = true;
  try {
    const verifyResponse = await authVerifyToken(token, undefined);
    const claims = verifyResponse.data?.valid ? verifyResponse.data.claims : null;
    const projectId = claims?.projectId?.trim();
    if (!projectId) return;

    await loadProjects();
    const outputProjectAlreadySelected =
      hasRequestedOutputProject && isCurrentProjectMatched(requestedOutputProject);
    if (outputProjectAlreadySelected && requestedOutputProject !== projectId) {
      console.warn('[App] output_project 与 token claims.project_id 不一致，保留 output_project 直达:', {
        outputProject: requestedOutputProject,
        projectId,
      });
      return;
    }

    const matched = switchProjectById(projectId);
    if (!matched && !isCurrentProjectMatched(projectId)) {
      console.warn('[App] 嵌入模式 project_id 未命中项目列表:', {
        projectId,
        availableProjects: projects.value.map((project) => ({
          id: project.id,
          path: project.path,
        })),
      });
    }
  } catch (error) {
    console.warn('[App] 嵌入模式项目预选失败:', error);
  } finally {
    embedBootstrapPending.value = false;
  }
}

watch(currentProject, async (project) => {
  if (project) {
    await nextTick();
    onboarding.autoStartIfNeeded();
  }
});

onMounted(() => {
  void bootstrapEmbedProjectFromToken();
});
</script>

<template>
  <v-app class="h-screen">
    <ConfirmDialog />
    <OnboardingOverlay />
    <ReviewGuideCenter />
    
    <DashboardLayout v-if="showDashboardLayout" />
    <div v-else-if="embedBootstrapPending" class="h-screen w-full" data-testid="embed-bootstrap-loading" />
    
    <template v-else>
      <v-app-bar class="ribbon-app-bar" :class="{ 'hierarchical-app-bar': !isRibbonMode }"
        :height="0"
        :extension-height="extensionHeight">
        <template #extension>
          <RibbonBar v-if="isRibbonMode" ref="ribbonBarRef" class="w-full">
            <template #header-right>
              <div class="flex items-center gap-2 px-2">
                <v-btn size="small" variant="text" title="切换到普通菜单" @click="toggleMenuMode">
                  <v-icon size="18">mdi-menu</v-icon>
                </v-btn>
                <v-btn size="small" variant="text" title="三维校审导航" @click="onboarding.openGuideCenter('currentRole')">
                  <v-icon size="18">mdi-help-circle-outline</v-icon>
                </v-btn>
                <LayoutToggleButtons />
                <AboutDialog />
                <ReleaseNotesDialog />
                <UserAvatar />
              </div>
            </template>
          </RibbonBar>
          <HierarchicalMenuBar v-else class="w-full">
            <template #header-right>
              <div class="flex items-center gap-2 px-2">
                <v-btn size="small" variant="text" title="切换到 Ribbon 菜单" @click="toggleMenuMode">
                  <v-icon size="18">mdi-ribbon</v-icon>
                </v-btn>
                <v-btn size="small" variant="text" title="三维校审导航" @click="onboarding.openGuideCenter('currentRole')">
                  <v-icon size="18">mdi-help-circle-outline</v-icon>
                </v-btn>
                <LayoutToggleButtons />
                <AboutDialog />
                <ReleaseNotesDialog />
                <UserAvatar />
              </div>
            </template>
          </HierarchicalMenuBar>
        </template>
      </v-app-bar>

      <v-main class="flex-1 min-h-0 d-flex flex-row" style="flex: 1 1 auto;">
        <div v-if="showBenchmark" style="width: 400px; border-right: 1px solid #333; overflow: hidden;">
          <BenchmarkView />
        </div>
        <div class="flex-1 min-h-0">
          <DockLayout />
        </div>
      </v-main>
    </template>
  </v-app>
</template>

<style>
.ribbon-app-bar {
  transition: height 0.2s ease;
}

.ribbon-app-bar.hierarchical-app-bar .v-toolbar__extension {
  height: 48px !important;
  min-height: 48px !important;
}
</style>
