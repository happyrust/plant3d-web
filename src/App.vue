<script setup lang="ts">
import { computed, ref } from 'vue';

import AboutDialog from '@/components/AboutDialog.vue';
import DockLayout from '@/components/DockLayout.vue';
import ProjectCardList from '@/components/model-project/ProjectCardList.vue';
import RibbonBar from '@/components/ribbon/RibbonBar.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import LayoutToggleButtons from '@/components/ui/LayoutToggleButtons.vue';
import UserAvatar from '@/components/user/UserAvatar.vue';
import { useModelProjects } from '@/composables/useModelProjects';
import { reviewGetEmbedUrl } from '@/api/reviewApi';

const ribbonBarRef = ref<InstanceType<typeof RibbonBar> | null>(null);
const ribbonCollapsed = computed(() => ribbonBarRef.value?.collapsed ?? false);

const extensionHeight = computed(() => (ribbonCollapsed.value ? 32 : 124));

const urlParams = new URLSearchParams(window.location.search);
const showBenchmark = urlParams.get('benchmark') === 'true';

const { currentProject, selectProject } = useModelProjects();

function handleProjectSelect(projectId: string) {
  selectProject(projectId);
}

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
    
    <ProjectCardList v-if="!currentProject" @select="handleProjectSelect" />
    
    <template v-else>
      <v-app-bar class="ribbon-app-bar"
        :height="0"
        :extension-height="extensionHeight">
        <template #extension>
          <RibbonBar ref="ribbonBarRef" class="w-full">
            <template #header-right>
              <div class="flex items-center gap-2 px-2">
                <v-btn
                  size="small"
                  variant="tonal"
                  color="info"
                  :loading="embedLoading"
                  @click="handleEmbedTest"
                >
                  校审测试
                </v-btn>
                <LayoutToggleButtons />
                <AboutDialog />
                <UserAvatar />
              </div>
            </template>
          </RibbonBar>
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

.ribbon-app-bar.ribbon-collapsed {
  height: 96px !important;
}

.ribbon-app-bar.ribbon-collapsed .v-toolbar__extension {
  height: 32px !important;
  min-height: 32px !important;
}
</style>
