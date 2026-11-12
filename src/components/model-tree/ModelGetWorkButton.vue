<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';

import { useQueryClient, type QueryClient } from '@tanstack/vue-query';
import { RefreshCw } from 'lucide-vue-next';

import { registerGetWorkDerived, useModelGetWork } from '@/composables/useModelGetWork';

/**
 * 底部状态栏的「取最新」按钮（E3D 的 GETWORK；2026-11-12 用户定：只做手动的这一个，不自动刷新）。
 *
 * 点一下：这个页面碰过的库对一次账——模型树刷新到位、已装的模型换成后台现在的那一版，然后在按钮左边留一句交代
 * （动了什么、哪些库没跟到最新；悬停看逐条细节，同一句也进提示和控制台）。逻辑都在 `useModelGetWork`，这里只管画。
 *
 * 放在状态栏：不依赖哪个面板开着，始终看得到；和「数据已更新」的提示在同一条上，那句交代也有地方常驻。
 * 按钮钉在状态栏的**最右端**、那一句在它左边：全局提示条（`v-snackbar`）画在底部正中、盖在状态栏上，鼠标停在它上面时
 * 它不会自己消失。按钮要是在中间（2026-11-12 真实回放撞到的：「数据已更新」的提示一出来就把它挤到了提示条底下），
 * 取最新自己弹的那一句会盖住按钮，鼠标又正好停在上面——想再点一次就点不到。右端在提示条的范围之外。
 */
const getWork = useModelGetWork();

// 属性面板的 ui-attr 查询走 TanStack Query（缓存 5 分钟）：取最新之后让它重取。
// 单测 / 独立挂载没装 VueQueryPlugin 时没有 client，省掉这一步。
let queryClient: QueryClient | null = null;
try {
  queryClient = useQueryClient();
} catch {
  queryClient = null;
}

let offAttributes: (() => void) | null = null;
onMounted(() => {
  offAttributes = registerGetWorkDerived({
    name: '属性面板',
    run: async () => {
      await queryClient?.invalidateQueries({ queryKey: ['pdms', 'ui-attr'] });
    },
  });
});
onUnmounted(() => {
  offAttributes?.();
});

const running = computed(() => getWork.state.running);
const last = computed(() => getWork.state.last);

const label = computed(() => (running.value ? getWork.state.progress || '正在取最新…' : '取最新'));

const buttonTitle = computed(() => {
  if (running.value) {
    return getWork.state.queued
      ? '正在取最新；这一轮完了会再跑一轮'
      : '正在取最新；现在再点会排成下一轮（两轮不会同时跑）';
  }
  return [
    '取最新：把模型树和已装的三维模型同步到后台现在的状态',
    '· 模型树：新增的出现、删掉的消失、改名和挪位置跟上；展开、勾选、选中留着',
    '· 模型：后台已有新模型的节点重载，库里已删的撤下；不会让后端开工（要后端更新用行上的「更新」）',
    '· 后台还没跟上库文件的库会点名说明',
  ].join('\n');
});

const resultClass = computed(() => {
  switch (last.value?.level) {
    case 'error':
      return 'text-danger';
    case 'warning':
      return 'text-warning';
    case 'success':
      return 'text-foreground';
    default:
      return 'text-muted-foreground';
  }
});

const resultTitle = computed(() => {
  const report = last.value;
  if (!report) return '';
  return [
    report.summary,
    ...report.detail.map((line) => `· ${line}`),
    `（${new Date(report.finishedAt).toLocaleTimeString()}）`,
  ].join('\n');
});

function onClick(): void {
  void getWork.getLatest();
}
</script>

<template>
  <span class="inline-flex min-w-0 items-center justify-end gap-1.5"
    data-testid="model-getwork">
    <span v-if="last && !running"
      data-testid="model-getwork-result"
      :data-level="last.level"
      :data-ok="last.ok ? 'true' : 'false'"
      class="min-w-0 max-w-[560px] truncate text-[11px]"
      :class="resultClass"
      :title="resultTitle">{{ last.summary }}</span>
    <button type="button"
      data-testid="model-getwork-button"
      :data-running="running ? 'true' : 'false'"
      :data-queued="getWork.state.queued ? 'true' : 'false'"
      class="inline-flex h-5 max-w-[360px] shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 text-[11px] text-foreground hover:bg-muted"
      :title="buttonTitle"
      @mousedown.stop
      @click="onClick">
      <RefreshCw class="h-3 w-3 shrink-0"
        :class="running ? 'animate-spin' : ''" />
      <span class="truncate"
        data-testid="model-getwork-label">{{ label }}</span>
    </button>
  </span>
</template>
