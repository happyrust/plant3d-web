<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-vue-next';

import Dialog from '@/components/ui/Dialog.vue';
import { useRvmCheckStore } from '@/composables/useRvmCheckStore';

/**
 * 「项目 → E3D 连接」：E3D TTY 登录信息。与 RVM 核对共用 `useRvmCheckStore` 的配置与密码，
 * 布局与 RVM 登录表单不同，字段单独写。
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const store = useRvmCheckStore();
const { config, password, rememberPassword, defaults, checking, preflight, formError } = store;

/** 本次打开后点过「测试连接」才显示结果横幅，避免带出 RVM 面板上一次的检查结果 */
const tested = ref(false);
const projectCodes = computed(() => defaults.value?.e3d_projects ?? []);

const testing = computed(() => checking.value === 'login');
const loginOk = computed(() => tested.value && !testing.value && preflight.value?.login_ok === true);
const loginFailed = computed(
  () => tested.value && !testing.value && (formError.value !== null || preflight.value?.login_ok === false),
);
const failureDetail = computed(() => {
  if (formError.value) return formError.value;
  const report = preflight.value;
  if (!report) return '';
  const failedChecks = report.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? `：${c.detail}` : ''}`);
  return [...failedChecks, ...report.notes].join('；');
});

function isDefaultValue(field: 'projectsDir' | 'projectName' | 'e3dProject' | 'e3dMdb'): boolean {
  const d = defaults.value;
  if (!d) return false;
  const map = { projectsDir: d.projects_dir, projectName: d.project_name, e3dProject: d.e3d_project ?? '', e3dMdb: d.mdb };
  return !!map[field] && config[field] === map[field];
}

function restoreDefaults(): void {
  const d = defaults.value;
  if (!d) return;
  config.projectsDir = d.projects_dir;
  config.projectName = d.project_name;
  config.e3dProject = d.e3d_project ?? '';
  config.e3dMdb = d.mdb;
}

async function testConnection(): Promise<void> {
  tested.value = true;
  await store.runPreflight(true);
}

function save(): void {
  store.persist();
  emit('update:open', false);
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    tested.value = false;
    void store.loadDefaults();
  },
  { immediate: true },
);

const inputClass = 'w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-xs text-zinc-800 focus:border-blue-400 focus:outline-none';
const defaultClass = 'bg-zinc-50 text-zinc-500';
</script>

<template>
  <Dialog :open="open"
    :persistent="testing"
    panel-class="max-w-[520px]"
    body-class="max-h-[72vh] overflow-y-auto px-4 py-4 text-[11px] text-zinc-700"
    @update:open="emit('update:open', $event)">
    <template #title>
      <div class="min-w-0">
        <div class="font-ui text-sm font-semibold text-zinc-900">项目设置 · E3D TTY 登录信息</div>
        <div class="mt-0.5 text-[11px] font-normal leading-relaxed text-zinc-500">
          用于在 E3D TTY 中执行解析 / RVM 导出等操作。配置保存在本机浏览器，和 RVM 核对共用。
        </div>
      </div>
    </template>

    <form class="flex flex-col gap-2.5" data-testid="project-settings-dialog" @submit.prevent>
      <div class="flex items-center justify-between rounded-md bg-zinc-50 px-2.5 py-1.5 text-zinc-500">
        <span>{{ defaults ? '已从后端 rvm_check defaults 预填（灰底字段）' : '正在读取后端默认值…' }}</span>
        <button type="button"
          class="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-0.5 text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          :disabled="!defaults"
          data-testid="project-settings-restore"
          @click="restoreDefaults">
          <RotateCcw class="h-3 w-3" />
          恢复默认
        </button>
      </div>

      <label class="flex flex-col gap-1">
        <span class="text-zinc-600">安装目录 <span class="font-mono text-[10px] text-zinc-400">install_dir</span></span>
        <input v-model="config.installDir" :class="inputClass" placeholder="例如 E:\AVEVA\Everything3D3.1" data-testid="project-settings-install-dir" />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-zinc-600">项目目录 <span class="font-mono text-[10px] text-zinc-400">projects_dir</span></span>
          <input v-model="config.projectsDir" :class="[inputClass, isDefaultValue('projectsDir') ? defaultClass : '']" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-zinc-600">项目目录名 <span class="font-mono text-[10px] text-zinc-400">project_name</span></span>
          <input v-model="config.projectName" :class="[inputClass, isDefaultValue('projectName') ? defaultClass : '']" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-zinc-600">项目代号 <span class="font-mono text-[10px] text-zinc-400">e3d_project</span></span>
          <input v-model="config.e3dProject" :class="[inputClass, 'uppercase', isDefaultValue('e3dProject') ? defaultClass : '']" list="project-settings-codes" />
          <datalist id="project-settings-codes">
            <option v-for="code in projectCodes" :key="code" :value="code" />
          </datalist>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-zinc-600">MDB <span class="font-mono text-[10px] text-zinc-400">e3d_mdb</span></span>
          <input v-model="config.e3dMdb" :class="[inputClass, isDefaultValue('e3dMdb') ? defaultClass : '']" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-1">
          <span class="text-zinc-600">用户名 <span class="font-mono text-[10px] text-zinc-400">username</span></span>
          <input v-model="config.username" :class="inputClass" autocomplete="username" data-testid="project-settings-username" />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-zinc-600">密码 <span class="font-mono text-[10px] text-zinc-400">password</span></span>
          <input v-model="password"
            type="password"
            :class="[inputClass, loginFailed ? 'border-red-400 bg-red-50' : '']"
            :aria-invalid="loginFailed"
            autocomplete="current-password"
            data-testid="project-settings-password"
            @input="store.loggedIn.value = false" />
        </label>
      </div>

      <label class="inline-flex items-start gap-1.5 text-zinc-600">
        <input v-model="rememberPassword" type="checkbox" class="mt-0.5 h-3 w-3 rounded border-zinc-300" data-testid="project-settings-remember" />
        <span>
          在本机记住密码（localStorage）
          <span class="block text-[10px] text-zinc-400">密码会以明文保存在本机浏览器，不上传后端；公用电脑请勿勾选。</span>
        </span>
      </label>

      <div v-if="testing" class="flex items-start gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800" data-testid="project-settings-testing">
        <Loader2 class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
        <div>
          <div class="font-medium">正在测试连接…</div>
          <div class="leading-relaxed">启动 TTY 并尝试登录 {{ config.e3dProject || '—' }} {{ config.e3dMdb }}，首次约 1–2 分钟。</div>
        </div>
      </div>
      <div v-else-if="loginOk" class="flex items-start gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800" data-testid="project-settings-ok">
        <CheckCircle2 class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div class="font-medium">连接成功</div>
          <div class="font-mono">{{ config.e3dProject.toUpperCase() }} · {{ config.username.toUpperCase() }} · {{ config.e3dMdb }}</div>
        </div>
      </div>
      <div v-else-if="loginFailed" class="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800" data-testid="project-settings-failed">
        <XCircle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div class="min-w-0">
          <div class="font-medium">连接失败</div>
          <div class="break-words leading-relaxed">{{ failureDetail || '登录没有走完' }}</div>
        </div>
      </div>
    </form>

    <template #footer>
      <button type="button"
        class="mr-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        :disabled="checking !== null"
        data-testid="project-settings-test"
        @click="testConnection">
        <Loader2 v-if="testing" class="h-3.5 w-3.5 animate-spin" />
        {{ testing ? '测试中…' : loginFailed ? '重新测试' : '测试连接' }}
      </button>
      <button type="button" class="rounded-md border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50" @click="emit('update:open', false)">取消</button>
      <button type="button" class="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800"
        data-testid="project-settings-save"
        @click="save">
        保存
      </button>
    </template>
  </Dialog>
</template>
