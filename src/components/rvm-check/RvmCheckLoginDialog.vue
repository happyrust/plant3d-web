<script setup lang="ts">
import { KeyRound, LogIn, X } from 'lucide-vue-next';

import RvmCheckConfigForm from './RvmCheckConfigForm.vue';

import { useRvmCheckStore } from '@/composables/useRvmCheckStore';

const store = useRvmCheckStore();
const { loginDialogOpen, checking, loggedIn, config } = store;

async function login(): Promise<void> {
  await store.runPreflight(true);
  if (loggedIn.value) store.resolveLogin(true);
}

function cancel(): void {
  if (checking.value === 'login') return;
  store.resolveLogin(false);
}
</script>

<template>
  <v-dialog :model-value="loginDialogOpen"
    max-width="440"
    persistent
    scrollable
    @keydown.esc="cancel">
    <div class="flex max-h-[85vh] flex-col rounded-md border border-border bg-background text-foreground shadow-xl" data-testid="rvm-check-login-dialog">
      <header class="flex items-start gap-2 border-b border-border px-4 py-3">
        <KeyRound class="mt-0.5 h-4 w-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold">登录 E3D 后台</div>
          <div class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            核对要在 E3D TTY 里导出 RVM。密码只留在本页内存里，刷新后需要重新输入。
          </div>
        </div>
        <button type="button"
          class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
          :disabled="checking === 'login'"
          aria-label="关闭"
          @click="cancel">
          <X class="h-4 w-4" />
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
        <RvmCheckConfigForm embedded compact />
      </div>
      <footer class="flex items-center gap-2 border-t border-border px-4 py-3">
        <span class="mr-auto text-[11px] text-muted-foreground">首次登录约 2 分钟</span>
        <button type="button" class="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40" :disabled="checking === 'login'" @click="cancel">
          取消
        </button>
        <button type="button"
          class="inline-flex items-center gap-1 rounded bg-foreground px-3 py-1.5 text-xs text-background disabled:opacity-40"
          :disabled="checking !== null || !config.username.trim() || !store.password.value"
          data-testid="rvm-check-login-submit"
          @click="login">
          <LogIn class="h-3.5 w-3.5" />
          {{ checking === 'login' ? '登录中…' : '登录并开始核对' }}
        </button>
      </footer>
    </div>
  </v-dialog>
</template>
