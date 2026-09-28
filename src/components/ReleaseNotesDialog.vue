<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import CHANGELOG_RAW from '../../CHANGELOG.md?raw';

import Dialog from '@/components/ui/Dialog.vue';
import { onCommand } from '@/ribbon/commandBus';
import {
  findReleaseNotesByVersion,
  getReleaseNotesSectionLabel,
  parseReleaseNotes,
} from '@/utils/releaseNotes';
import { displayVersionText, getDefaultFrontendVersion } from '@/utils/versionInfo';

const dialog = ref(false);
const currentVersion = ref(getDefaultFrontendVersion().version);
const releaseNotes = parseReleaseNotes(CHANGELOG_RAW);

let offHelpReleaseNotes: (() => void) | null = null;

const currentVersionText = computed(() => displayVersionText(currentVersion.value));
const matchedVersion = computed(() => findReleaseNotesByVersion(releaseNotes, currentVersion.value));

onMounted(() => {
  offHelpReleaseNotes = onCommand((commandId) => {
    if (commandId === 'help.releaseNotes') {
      dialog.value = true;
    }
  });
});

onUnmounted(() => {
  offHelpReleaseNotes?.();
  offHelpReleaseNotes = null;
});
</script>

<template>
  <Dialog :open="dialog"
    title="更新说明"
    panel-class="max-w-[64rem]"
    body-class="max-h-[78vh] overflow-y-auto px-6 py-5 text-sm leading-6 text-[#1F2937]"
    @update:open="dialog = $event">
    <div class="space-y-5">
      <section class="rounded-[10px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
        <div class="text-sm font-semibold text-[#111827]">
          当前版本：{{ currentVersionText }}
        </div>
        <div v-if="matchedVersion" class="mt-1 text-xs text-[#475569]">
          已在下方高亮当前版本对应的更新记录。
        </div>
        <div v-else class="mt-1 text-xs text-[#475569]">
          当前版本尚未在 changelog 中单独归档，以下展示全部更新记录。
        </div>
      </section>

      <section v-for="entry in releaseNotes"
        :key="entry.version"
        class="rounded-[12px] border px-4 py-4"
        :class="matchedVersion?.version === entry.version
          ? 'border-[#2563EB] bg-[#EFF6FF]'
          : 'border-[#E5E7EB] bg-white'">
        <div class="flex items-center justify-between gap-3 border-b border-[#E5E7EB] pb-3">
          <div class="text-base font-semibold text-[#111827]">
            {{ entry.version }}
          </div>
          <span v-if="matchedVersion?.version === entry.version"
            class="rounded-full bg-[#DBEAFE] px-2.5 py-1 text-xs font-medium text-[#1D4ED8]">
            当前版本
          </span>
        </div>

        <div class="mt-4 space-y-4">
          <section v-for="section in entry.sections" :key="`${entry.version}-${section.title}`" class="space-y-2">
            <div class="text-sm font-medium text-[#334155]">
              {{ getReleaseNotesSectionLabel(section.title) }}
            </div>
            <ul class="space-y-2 pl-5 text-sm text-[#1F2937]">
              <li v-for="item in section.items" :key="item" class="list-disc">
                {{ item }}
              </li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  </Dialog>
</template>
