<script setup lang="ts">
import { ref } from 'vue';

import { reviewGetEmbedUrl } from '@/api/reviewApi';
import AboutDialog from '@/components/AboutDialog.vue';
import DashboardLayout from '@/components/dashboard/DashboardLayout.vue';
import DockLayout from '@/components/DockLayout.vue';
import OnboardingOverlay from '@/components/onboarding/OnboardingOverlay.vue';
import ReviewGuideCenter from '@/components/onboarding/ReviewGuideCenter.vue';
import HierarchicalMenuBar from '@/components/ribbon/HierarchicalMenuBar.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import LayoutToggleButtons from '@/components/ui/LayoutToggleButtons.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';
import { useModelProjects } from '@/composables/useModelProjects';
import { useOnboardingGuide } from '@/composables/useOnboardingGuide';

const extensionHeight = 48;

const urlParams = new URLSearchParams(window.location.search);
const showBenchmark = urlParams.get('benchmark') === 'true';

const { currentProject } = useModelProjects();

const onboarding = useOnboardingGuide();
const embedLoading = ref(false);

async function handleEmbedTest() {
  if (!currentProject.value) return;
  embedLoading.value = true;
  try {
    const { url } = await reviewGetEmbedUrl(currentProject.value.id, 'SJ');
    window.open(url, '_blank');
  } catch (e: unknown) {
    alert('获取校审地址失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    embedLoading.value = false;
  }
}
</script>

<template>
  <v-app class="h-screen">
    <ConfirmDialog />
    <OnboardingOverlay />
    <ReviewGuideCenter />
    
    <DashboardLayout v-if="!currentProject" />
    
    <template v-else>
      <v-app-bar class="ribbon-app-bar hierarchical-app-bar"
        :height="0"
        :extension-height="extensionHeight">
        <template #extension>
          <HierarchicalMenuBar class="w-full">
            <template #header-right>
              <div class="flex items-center gap-2 px-2">
                <v-btn size="small"
                  variant="tonal"
                  color="info"
                  :loading="embedLoading"
                  @click="handleEmbedTest">
                  校审测试
                </v-btn>
                <v-btn size="small"
                  variant="text"
                  title="三维校审导航"
                  @click="onboarding.openGuideCenter('currentRole')">
                  <v-icon size="18">mdi-help-circle-outline</v-icon>
                </v-btn>
                <LayoutToggleButtons />
                <AboutDialog />
                <UserAvatar />
              </div>
            </template>
          </HierarchicalMenuBar>
        </template>
      </v-app-bar>

      <v-main class="flex-1 min-h-0 d-flex flex-row">
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
