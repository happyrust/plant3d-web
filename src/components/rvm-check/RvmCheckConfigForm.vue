<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { useRvmCheckStore } from '@/composables/useRvmCheckStore';

/**
 * 登录弹窗自己出主按钮，`embedded` 时这里只留字段和检查结果。
 * `compact` 时项目父目录、项目目录名收进「更多设置」：平时用服务端默认值，缺了才自动展开。
 */
const props = defineProps<{ embedded?: boolean; compact?: boolean }>();

const store = useRvmCheckStore();
const { config, password, defaults, checking, preflight, formError, loggedIn } = store;
const projectCodes = computed(() => defaults.value?.e3d_projects ?? []);

const PROJECT_DIR_CHECK = /projects?_dir|project_name|项目父目录|项目目录/i;
const projectDirsMissing = computed(() => !config.projectsDir.trim()
  || !config.projectName.trim()
  || !!preflight.value?.checks.some((check) => !check.ok && PROJECT_DIR_CHECK.test(`${check.name} ${check.detail}`)));
const moreOpen = ref(false);
watch(
  () => props.compact && defaults.value !== null && projectDirsMissing.value,
  (missing) => {
    if (missing) moreOpen.value = true;
  },
  { immediate: true },
);

function onMoreToggle(event: Event): void {
  moreOpen.value = (event.target as HTMLDetailsElement).open;
}

onMounted(() => {
  void store.loadDefaults();
});
</script>

<template>
  <form class="flex flex-col gap-2" @submit.prevent>
    <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      E3D 安装目录
      <input v-model="config.installDir" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" placeholder="例如 E:\AVEVA\E3D3.1" @change="store.persist()" />
    </label>
    <template v-if="!compact">
      <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
        项目父目录
        <input v-model="config.projectsDir" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" @change="store.persist()" />
      </label>
      <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
        项目目录名
        <input v-model="config.projectName" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" @change="store.persist()" />
      </label>
    </template>
    <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      E3D 项目码
      <input v-model="config.e3dProject" class="rounded border border-border bg-background px-2 py-1 text-xs uppercase text-foreground" list="rvm-check-codes" @change="store.persist()" />
      <datalist id="rvm-check-codes">
        <option v-for="code in projectCodes" :key="code" :value="code" />
      </datalist>
    </label>
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
        用户名
        <input v-model="config.username" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" autocomplete="username" @change="store.persist()" />
      </label>
      <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
        密码
        <input v-model="password"
          type="password"
          class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
          autocomplete="current-password"
          data-testid="rvm-check-password"
          @input="store.loggedIn.value = false" />
      </label>
    </div>
    <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      MDB
      <input v-model="config.e3dMdb" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" @change="store.persist()" />
    </label>
    <details v-if="compact" class="rounded border border-border px-2 py-1.5 text-[11px]" :open="moreOpen" data-testid="rvm-check-more-settings" @toggle="onMoreToggle">
      <summary class="cursor-pointer select-none text-muted-foreground">
        更多设置
        <span v-if="!moreOpen && !projectDirsMissing" class="ml-1 font-mono text-[10px]">{{ config.projectsDir }}\{{ config.projectName }}</span>
      </summary>
      <div class="mt-2 flex flex-col gap-2">
        <label class="flex flex-col gap-1 text-muted-foreground">
          项目父目录
          <input v-model="config.projectsDir" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" @change="store.persist()" />
        </label>
        <label class="flex flex-col gap-1 text-muted-foreground">
          项目目录名
          <input v-model="config.projectName" class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground" @change="store.persist()" />
        </label>
        <p class="leading-relaxed text-muted-foreground">
          试登录会给打开的库追加一条只含 DBMDAT 的尾会话，最长可能要几分钟。
        </p>
      </div>
    </details>
    <div v-if="!embedded" class="flex items-center gap-2">
      <button type="button" class="rounded border border-border px-2 py-1 text-xs" :disabled="checking !== null" @click="store.runPreflight(false)">
        {{ checking === 'env' ? '检测中…' : '检测环境' }}
      </button>
      <button type="button" class="rounded border border-border px-2 py-1 text-xs" :disabled="checking !== null" @click="store.runPreflight(true)">
        {{ checking === 'login' ? '登录中…' : '试登录' }}
      </button>
      <span v-if="loggedIn" class="text-[11px] text-emerald-700">已登录</span>
    </div>
    <p v-if="formError" class="text-[11px] text-red-700">{{ formError }}</p>
    <div v-if="preflight" class="rounded border border-border p-2 text-[11px]">
      <div :class="preflight.ok ? 'text-emerald-700' : 'text-red-700'">
        {{ preflight.ok ? '环境可用' : '环境还没备齐' }}
        <span v-if="preflight.login_ok === true">，登录成功</span>
        <span v-else-if="preflight.login_ok === false">，登录没有走完</span>
      </div>
      <ul class="mt-1 space-y-0.5">
        <li v-for="check in preflight.checks" :key="check.name" :class="check.ok ? 'text-emerald-700' : 'text-red-700'">
          {{ check.ok ? '有' : '缺' }} {{ check.name }}
          <span v-if="!check.ok && check.detail" class="text-muted-foreground">：{{ check.detail }}</span>
        </li>
      </ul>
      <p v-for="(note, index) in preflight.notes" :key="index" class="mt-1 text-muted-foreground">{{ note }}</p>
    </div>
    <p v-if="defaults && (!defaults.gen_ams_found || !defaults.rvm_compare_found || !defaults.launcher_found)" class="text-[11px] text-amber-700">
      服务端还没找到
      <span v-if="!defaults.gen_ams_found"> gen_ams.exe</span>
      <span v-if="!defaults.rvm_compare_found"> rvm_compare.exe</span>
      <span v-if="!defaults.launcher_found"> 启动脚本</span>
    </p>
  </form>
</template>
