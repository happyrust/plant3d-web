<script setup lang="ts">
import { onMounted, ref } from 'vue';

import RvmCheckConfigForm from './RvmCheckConfigForm.vue';
import { rvmRefnoKey } from './rvmCheckFormat';
import RvmCheckLoginDialog from './RvmCheckLoginDialog.vue';
import RvmCheckPanel from './RvmCheckPanel.vue';
import RvmCheckTree from './RvmCheckTree.vue';

import { useRvmCheckStore } from '@/composables/useRvmCheckStore';

const store = useRvmCheckStore();
const selected = ref<{ refno: string; name: string; noun: string } | null>(null);

function choose(node: { refno: string; name: string; noun: string }): void {
  selected.value = node;
  const taskId = store.statusByRefno.value[rvmRefnoKey(node.refno)]?.taskId;
  if (taskId) void store.openRun(taskId);
}

async function compare(): Promise<void> {
  const target = selected.value;
  if (!target) return;
  const ok = await store.ensureLogin();
  if (ok) store.enqueue([target]);
}

function backToWorkbench(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('page');
  window.location.assign(url.toString());
}

onMounted(() => {
  void store.restoreFromHistory();
});
</script>

<template>
  <div class="flex h-screen flex-col bg-background text-foreground">
    <RvmCheckLoginDialog />
    <header class="flex items-center justify-between border-b border-border px-4 py-2">
      <div>
        <div class="text-sm font-semibold">RVM 核对</div>
        <div class="text-[11px] text-muted-foreground">我们生成的 RVM 与 E3D TTY 导出的 RVM</div>
      </div>
      <button type="button" class="rounded border border-border px-2 py-1 text-xs" @click="backToWorkbench">返回工作台</button>
    </header>
    <div class="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col gap-3 overflow-auto border-r border-border p-3">
        <RvmCheckConfigForm />
        <RvmCheckTree @select="choose" />
        <div class="text-[11px] leading-relaxed text-muted-foreground">
          <p>登录会给打开的库追加一条只含 DBMDAT 的尾会话，增量监听可能因此空转一轮。宏本身不保存。</p>
          <p class="mt-1">本机若已开着 E3D 图形界面，TTY 会再占一份许可证，图形界面里没保存的修改这里看不到。</p>
          <p class="mt-1">默认的 e3d31-runtime 安装在 TTY 下会崩溃，安装目录请填实际能跑 des.exe -tty 的那一份。</p>
        </div>
      </aside>
      <main class="flex min-h-0 flex-col">
        <div class="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div class="min-w-0 text-sm">
            <template v-if="selected">
              <span class="text-muted-foreground">{{ selected.noun }}</span>
              {{ selected.name }}
              <span class="text-muted-foreground">{{ selected.refno }}</span>
            </template>
            <span v-else class="text-muted-foreground">先在左边选一个节点</span>
          </div>
          <button type="button"
            class="rounded bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40"
            :disabled="!selected"
            @click="compare">
            核对这个节点
          </button>
        </div>
        <RvmCheckPanel class="min-h-0 flex-1" :locatable="false" />
      </main>
    </div>
  </div>
</template>
