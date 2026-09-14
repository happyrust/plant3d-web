<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { Info } from 'lucide-vue-next';

import { useToolStore, type UnattributedDraftSummary } from '@/composables/useToolStore';

/**
 * 「未归属草稿」只读提示（U0，方案 2026-09-14 §3.6）：草稿 scope 生效后，旧 `project=…|db=…` 容器里还躺着的批注
 * 只在这里数个数告诉用户它们在哪、为什么现在看不见——不导入、不提供一键导入（那是 d-565 明确否决的「默认导入」）。
 * store mock 里没有这两个成员时静默不显示（双胞胎面板测试用的手写 mock）。
 */

const toolStore = useToolStore() as ReturnType<typeof useToolStore> & {
  getUnattributedDraftSummary?: () => UnattributedDraftSummary | null;
  annotationDraftScope?: { value: unknown };
};

const storageTick = ref(0);

const summary = computed<UnattributedDraftSummary | null>(() => {
  // 依赖：scope 变化 + 别的 tab 写了 localStorage
  void toolStore.annotationDraftScope?.value;
  void storageTick.value;
  try {
    return toolStore.getUnattributedDraftSummary?.() ?? null;
  } catch {
    return null;
  }
});

const TYPE_LABELS: Record<keyof UnattributedDraftSummary['counts'], string> = {
  text: '文字',
  cloud: '云线',
  rect: '矩形',
  obb: '包围盒',
};

const countText = computed(() => {
  const s = summary.value;
  if (!s) return '';
  return (Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[])
    .filter((key) => s.counts[key] > 0)
    .map((key) => `${TYPE_LABELS[key]} ${s.counts[key]}`)
    .join(' · ');
});

function handleStorage(event: StorageEvent) {
  if (!event.key || event.key.startsWith('plant3d-web-tools-')) storageTick.value += 1;
}

onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('storage', handleStorage);
});

onUnmounted(() => {
  if (typeof window !== 'undefined') window.removeEventListener('storage', handleStorage);
});
</script>

<template>
  <div v-if="summary"
    class="mb-2 flex items-start gap-2 rounded border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    data-testid="annotation-unattributed-draft-notice"
    :title="`旧容器作用域：${summary.storageScope}`">
    <Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
    <span>
      <span class="font-medium text-foreground" data-testid="annotation-unattributed-draft-label">{{ summary.label }}</span>
      ：{{ countText }}（共 {{ summary.total }} 条）—— 这是切到任务作用域之前留在旧容器里的批注，本任务下只读、不导入。
    </span>
  </div>
</template>
