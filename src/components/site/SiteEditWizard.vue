<template>
  <Dialog :open="open"
    title="编辑站点"
    panel-class="max-w-[48rem]"
    body-class="space-y-6"
    @update:open="emit('update:open', $event)">
    <div class="space-y-6">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <h3 class="text-base font-semibold text-slate-900">站点基础信息</h3>
        <p class="mt-1 text-sm text-slate-500">更新站点基础字段、项目路径和访问地址，提交后会刷新站点详情。</p>
      </div>

      <div class="grid gap-4 md:grid-cols-2">
        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">站点名称 *</span>
          <input v-model="form.name"
            data-testid="site-edit-field-name"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">site_id</span>
          <input :value="site?.site_id || ''"
            disabled
            type="text"
            class="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">地域</span>
          <input v-model="form.region"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">负责人</span>
          <input v-model="form.owner"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">环境</span>
          <input v-model="form.env"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2 md:col-span-2">
          <span class="text-sm font-medium text-slate-700">描述</span>
          <textarea v-model="form.description"
            rows="3"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">项目名称 *</span>
          <input v-model="form.projectName"
            data-testid="site-edit-field-project-name"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">项目编码 *</span>
          <input v-model="form.projectCode"
            data-testid="site-edit-field-project-code"
            type="number"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2 md:col-span-2">
          <span class="text-sm font-medium text-slate-700">项目路径 *</span>
          <input v-model="form.projectPath"
            data-testid="site-edit-field-project-path"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">前端地址</span>
          <input v-model="form.frontendUrl"
            data-testid="site-edit-field-frontend-url"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">后端地址</span>
          <input v-model="form.backendUrl"
            data-testid="site-edit-field-backend-url"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">绑定地址</span>
          <input v-model="form.bindHost"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">绑定端口</span>
          <input v-model="form.bindPort"
            type="number"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400" />
        </label>

        <div v-if="errors.length > 0" class="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <p v-for="message in errors" :key="message">{{ message }}</p>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button"
        class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        @click="emit('update:open', false)">
        取消
      </button>
      <button type="button"
        data-testid="site-edit-submit"
        class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="submitting"
        @click="handleSubmit">
        {{ submitting ? '保存中...' : '保存修改' }}
      </button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue';

import type { DeploymentSite } from '@/types/site';

import Dialog from '@/components/ui/Dialog.vue';
import { useDeploymentSites } from '@/composables/useDeploymentSites';

const props = defineProps<{
  open: boolean;
  site: DeploymentSite | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  saved: [siteId: string];
}>();

const { updateSite } = useDeploymentSites();

const errors = ref<string[]>([]);
const submitting = ref(false);

const form = reactive({
  name: '',
  region: '',
  owner: '',
  env: '',
  description: '',
  projectName: '',
  projectCode: '',
  projectPath: '',
  frontendUrl: '',
  backendUrl: '',
  bindHost: '0.0.0.0',
  bindPort: '3100',
});

watch(
  () => props.open,
  (open) => {
    if (!open || !props.site) return;
    fillForm(props.site);
  },
  { immediate: true }
);

function fillForm(site: DeploymentSite) {
  errors.value = [];
  submitting.value = false;
  form.name = site.name || '';
  form.region = site.region || '';
  form.owner = String(site.owner || '');
  form.env = String(site.env || '');
  form.description = String(site.description || '');
  form.projectName = site.project_name || site.config?.project_name || '';
  form.projectCode = String(site.project_code || site.config?.project_code || '');
  form.projectPath = site.project_path || site.config?.project_path || '';
  form.frontendUrl = String(site.frontend_url || '');
  form.backendUrl = String(site.backend_url || '');
  form.bindHost = site.bind_host || '0.0.0.0';
  form.bindPort = String(site.bind_port || 3100);
}

function validate(): string[] {
  const messages: string[] = [];
  if (!form.name.trim()) messages.push('请填写站点名称');
  if (!form.projectName.trim()) messages.push('请填写项目名称');
  if (!String(form.projectCode).trim()) messages.push('请填写项目编码');
  if (!form.projectPath.trim()) messages.push('请填写项目路径');
  return messages;
}

async function handleSubmit() {
  if (!props.site) return;

  errors.value = validate();
  if (errors.value.length > 0) return;

  submitting.value = true;
  try {
    const result = await updateSite(props.site.site_id, {
      name: form.name.trim(),
      region: form.region.trim() || null,
      owner: form.owner.trim() || null,
      env: form.env.trim() || null,
      description: form.description.trim() || null,
      project_name: form.projectName.trim(),
      project_code: Number(form.projectCode || 0),
      project_path: form.projectPath.trim(),
      frontend_url: form.frontendUrl.trim() || null,
      backend_url: form.backendUrl.trim() || null,
      bind_host: form.bindHost.trim() || '0.0.0.0',
      bind_port: Number(form.bindPort || 3100),
      config: {
        ...(props.site.config || {}),
        name: form.name.trim(),
        project_name: form.projectName.trim(),
        project_code: Number(form.projectCode || 0),
        project_path: form.projectPath.trim(),
      },
    });

    if (!result?.site_id) {
      errors.value = ['保存站点失败，请稍后重试'];
      return;
    }

    emit('saved', result.site_id);
    emit('update:open', false);
  } finally {
    submitting.value = false;
  }
}
</script>
