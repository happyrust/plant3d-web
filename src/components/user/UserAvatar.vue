<script setup lang="ts">
import { computed, ref } from 'vue';

import { ChevronDown, LogOut, Settings, User } from 'lucide-vue-next';

import { useUserStore } from '@/composables/useUserStore';
import { getRoleDisplayName } from '@/types/auth';

const userStore = useUserStore();
const showDropdown = ref(false);
const showUserCard = ref(false);

const user = computed(() => userStore.currentUser.value);

const userInitial = computed(() => {
  if (!user.value) return '?';
  return user.value.name.charAt(0).toUpperCase();
});

const roleDisplay = computed(() => {
  if (!user.value) return '';
  return getRoleDisplayName(user.value.role);
});

const roleColor = computed(() => {
  if (!user.value) return 'bg-gray-500';
  switch (user.value.role) {
    case 'admin':
      return 'bg-purple-500';
    case 'manager':
      return 'bg-blue-500';
    case 'reviewer':
      return 'bg-green-500';
    case 'proofreader':
      return 'bg-teal-500';
    case 'designer':
      return 'bg-orange-500';
    default:
      return 'bg-gray-500';
  }
});

function toggleDropdown() {
  showDropdown.value = !showDropdown.value;
}

function handleSwitchUser(userId: string) {
  userStore.switchUser(userId);
  showDropdown.value = false;
}

function handleMouseEnter() {
  showUserCard.value = true;
}

function handleMouseLeave() {
  showUserCard.value = false;
}
</script>

<template>
  <div class="relative" @mouseleave="handleMouseLeave">
    <!-- 用户头像按钮 -->
    <button
      class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 transition-colors"
      @click="toggleDropdown"
      @mouseenter="handleMouseEnter"
    >
      <div
        :class="[
          'flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-medium',
          roleColor,
        ]"
      >
        {{ userInitial }}
      </div>
      <span class="text-sm font-medium text-gray-700 hidden sm:inline">{{ user?.name }}</span>
      <ChevronDown class="h-4 w-4 text-gray-500" />
    </button>

    <!-- 用户信息卡片 (hover) -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="showUserCard && !showDropdown && user"
        class="absolute right-0 top-full mt-2 w-72 rounded-lg border bg-white shadow-lg z-50"
      >
        <div class="p-4">
          <div class="flex items-start gap-3">
            <div
              :class="[
                'flex h-12 w-12 items-center justify-center rounded-full text-white text-lg font-medium flex-shrink-0',
                roleColor,
              ]"
            >
              {{ userInitial }}
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-semibold text-gray-900 truncate">{{ user.name }}</h4>
              <p class="text-sm text-gray-500 truncate">{{ user.email }}</p>
              <div class="mt-1 flex items-center gap-2">
                <span
                  :class="[
                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                    roleColor.replace('bg-', 'bg-opacity-20 text-').replace('-500', '-700'),
                  ]"
                  :style="{
                    backgroundColor: roleColor.includes('purple')
                      ? 'rgba(147, 51, 234, 0.15)'
                      : roleColor.includes('blue')
                        ? 'rgba(59, 130, 246, 0.15)'
                        : roleColor.includes('green')
                          ? 'rgba(34, 197, 94, 0.15)'
                          : roleColor.includes('teal')
                            ? 'rgba(20, 184, 166, 0.15)'
                            : roleColor.includes('orange')
                              ? 'rgba(249, 115, 22, 0.15)'
                              : 'rgba(107, 114, 128, 0.15)',
                  }"
                >
                  {{ roleDisplay }}
                </span>
              </div>
            </div>
          </div>
          <div class="mt-3 pt-3 border-t space-y-1 text-sm text-gray-600">
            <div class="flex items-center gap-2">
              <User class="h-4 w-4 text-gray-400" />
              <span>部门：{{ user.department || '未设置' }}</span>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 下拉菜单 (click) -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="showDropdown"
        class="absolute right-0 top-full mt-2 w-56 rounded-lg border bg-white shadow-lg z-50"
      >
        <div class="p-2">
          <div class="px-2 py-1.5 text-xs font-medium text-gray-500 uppercase tracking-wider">
            切换用户
          </div>
          <div class="space-y-0.5">
            <button
              v-for="u in userStore.availableUsers.value"
              :key="u.id"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100 transition-colors"
              :class="{ 'bg-gray-50': u.id === user?.id }"
              @click="handleSwitchUser(u.id)"
            >
              <div
                :class="[
                  'flex h-6 w-6 items-center justify-center rounded-full text-white text-xs font-medium',
                  u.role === 'admin'
                    ? 'bg-purple-500'
                    : u.role === 'manager'
                      ? 'bg-blue-500'
                      : u.role === 'reviewer'
                        ? 'bg-green-500'
                        : u.role === 'proofreader'
                          ? 'bg-teal-500'
                          : u.role === 'designer'
                            ? 'bg-orange-500'
                            : 'bg-gray-500',
                ]"
              >
                {{ u.name.charAt(0) }}
              </div>
              <div class="flex-1 text-left">
                <div class="font-medium text-gray-900">{{ u.name }}</div>
                <div class="text-xs text-gray-500">{{ getRoleDisplayName(u.role) }}</div>
              </div>
              <span
                v-if="u.id === user?.id"
                class="h-2 w-2 rounded-full bg-green-500"
              />
            </button>
          </div>
        </div>
        <div class="border-t p-2">
          <button
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <Settings class="h-4 w-4" />
            设置
          </button>
          <button
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut class="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    </Transition>

    <!-- 点击外部关闭 -->
    <div
      v-if="showDropdown"
      class="fixed inset-0 z-40"
      @click="showDropdown = false"
    />
  </div>
</template>
