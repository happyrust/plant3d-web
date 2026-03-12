<script setup lang="ts">
import { computed, ref } from 'vue';

import { ChevronDown, User } from 'lucide-vue-next';

import { useUserStore } from '@/composables/useUserStore';
import { getRoleDisplayName } from '@/types/auth';

const userStore = useUserStore();
const open = ref(false);

const currentUser = computed(() => userStore.currentUser.value);
const availableUsers = computed(() => userStore.availableUsers.value);

const roleColors: Record<string, string> = {
  designer: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  proofreader: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  reviewer: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  manager: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  admin: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

function getRoleColor(role: string): string {
  return roleColors[role] || roleColors.viewer!;
}

function handleSwitch(userId: string) {
  userStore.switchUser(userId);
  open.value = false;
}

function handleClickOutside() {
  open.value = false;
}
</script>

<template>
  <div class="relative">
    <button type="button"
      class="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted transition-colors"
      @click="open = !open">
      <User class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="flex-1 text-left">
        <span class="font-medium">{{ currentUser?.name || '未登录' }}</span>
        <span v-if="currentUser"
          class="ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
          :class="getRoleColor(currentUser.role)">
          {{ getRoleDisplayName(currentUser.role) }}
        </span>
      </span>
      <ChevronDown class="h-3.5 w-3.5 text-muted-foreground transition-transform" :class="{ 'rotate-180': open }" />
    </button>

    <!-- 下拉菜单 -->
    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-40" @click="handleClickOutside" />
    </Teleport>
    <div v-if="open"
      class="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-border bg-background shadow-lg">
      <div class="max-h-48 overflow-y-auto py-1">
        <button v-for="user in availableUsers"
          :key="user.id"
          type="button"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors"
          :class="
            user.id === currentUser?.id
              ? 'bg-blue-50 dark:bg-blue-950'
              : 'hover:bg-muted'
          "
          @click="handleSwitch(user.id)">
          <User class="h-3 w-3 text-muted-foreground" />
          <span class="flex-1 text-left">{{ user.name }}</span>
          <span class="rounded px-1.5 py-0.5 text-[10px] font-medium"
            :class="getRoleColor(user.role)">
            {{ getRoleDisplayName(user.role) }}
          </span>
        </button>
      </div>
      <div class="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        演示用：点击可快速切换角色
      </div>
    </div>
  </div>
</template>
