<template>
  <Dialog :open="open"
    title="新建站点"
    panel-class="max-w-[56rem]"
    body-class="space-y-6"
    @update:open="handleUpdateOpen">
    <div class="space-y-6">
      <div class="flex items-center gap-3 overflow-x-auto">
        <div v-for="step in steps"
          :key="step.id"
          class="flex min-w-0 items-center gap-3">
          <button type="button"
            class="flex items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors"
            :class="currentStep === step.id
              ? 'bg-blue-50 text-blue-700'
              : currentStep > step.id
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-500'"
            @click="goToStep(step.id)">
            <span class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
              :class="currentStep >= step.id ? 'bg-white/90' : 'bg-white/60'">
              {{ step.id }}
            </span>
            <span class="whitespace-nowrap text-sm font-medium">{{ step.label }}</span>
          </button>
          <div v-if="step.id < steps.length" class="h-px w-6 bg-slate-200" />
        </div>
      </div>

      <div v-if="currentStep === 1" class="space-y-4">
        <div class="rounded-2xl border border-slate-200 p-4">
          <h3 class="text-base font-semibold text-slate-900">选择创建方式</h3>
          <p class="mt-1 text-sm text-slate-500">先确认是手动创建站点，还是从 DbOption 配置导入。</p>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <button type="button"
            data-testid="site-mode-manual"
            class="rounded-2xl border p-5 text-left transition-colors"
            :class="form.mode === 'manual'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'"
            @click="form.mode = 'manual'">
            <div class="text-base font-semibold">手动创建</div>
            <p class="mt-2 text-sm text-slate-500">适合主站点统一注册新站点，显式填写项目与地址信息。</p>
          </button>

          <button type="button"
            data-testid="site-mode-import"
            class="rounded-2xl border p-5 text-left transition-colors"
            :class="form.mode === 'import'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'"
            @click="form.mode = 'import'">
            <div class="text-base font-semibold">从 DbOption 导入</div>
            <p class="mt-2 text-sm text-slate-500">适合已有后端配置目录，快速导入生成站点注册信息。</p>
          </button>
        </div>
      </div>

      <div v-if="currentStep === 2" class="grid gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <h3 class="text-base font-semibold text-slate-900">基础信息</h3>
          <p class="mt-1 text-sm text-slate-500">这些字段会进入站点注册表，作为主站点控制台的基础标识。</p>
        </div>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">站点名称 *</span>
          <input v-model="form.name"
            data-testid="site-field-name"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="例如：华东主站点" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">site_id *</span>
          <input v-model="form.siteId"
            data-testid="site-field-site-id"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="例如：site-cn-east-01" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">地域</span>
          <input v-model="form.region"
            data-testid="site-field-region"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="例如：cn-east" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">负责人</span>
          <input v-model="form.owner"
            data-testid="site-field-owner"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="例如：alice" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">环境</span>
          <input v-model="form.env"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="例如：prod" />
        </label>

        <label class="space-y-2 md:col-span-2">
          <span class="text-sm font-medium text-slate-700">描述</span>
          <textarea v-model="form.description"
            rows="3"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="补充站点用途、部署说明或备注信息" />
        </label>

        <div v-if="stepErrors.length > 0" class="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <p v-for="message in stepErrors" :key="message">{{ message }}</p>
        </div>
      </div>

      <div v-if="currentStep === 3" class="grid gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <h3 class="text-base font-semibold text-slate-900">{{ form.mode === 'manual' ? '项目与地址' : '导入路径与地址' }}</h3>
          <p class="mt-1 text-sm text-slate-500">
            {{ form.mode === 'manual'
              ? '手动创建模式下需要填写项目名、项目编码、项目路径与访问地址。'
              : '导入模式下至少提供 DbOption 路径，地址信息可一并补齐。' }}
          </p>
        </div>

        <template v-if="form.mode === 'manual'">
          <label class="space-y-2">
            <span class="text-sm font-medium text-slate-700">项目名称 *</span>
            <input v-model="form.projectName"
              data-testid="site-field-project-name"
              type="text"
              class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
              placeholder="例如：ProjectAlpha" />
          </label>

          <label class="space-y-2">
            <span class="text-sm font-medium text-slate-700">项目编码 *</span>
            <input v-model="form.projectCode"
              data-testid="site-field-project-code"
              type="number"
              class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
              placeholder="例如：1001" />
          </label>

          <label class="space-y-2 md:col-span-2">
            <span class="text-sm font-medium text-slate-700">项目路径 *</span>
            <input v-model="form.projectPath"
              data-testid="site-field-project-path"
              type="text"
              class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
              placeholder="/data/project-alpha" />
          </label>
        </template>

        <template v-else>
          <label class="space-y-2 md:col-span-2">
            <span class="text-sm font-medium text-slate-700">DbOption 路径 *</span>
            <input v-model="form.importPath"
              data-testid="site-field-import-path"
              type="text"
              class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
              placeholder="/tmp/DbOption-zsy" />
          </label>
        </template>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">前端地址</span>
          <input v-model="form.frontendUrl"
            data-testid="site-field-frontend-url"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="http://alpha.example.com" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">后端地址</span>
          <input v-model="form.backendUrl"
            data-testid="site-field-backend-url"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="http://alpha.example.com/api" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">绑定地址</span>
          <input v-model="form.bindHost"
            type="text"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="0.0.0.0" />
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-slate-700">绑定端口</span>
          <input v-model="form.bindPort"
            type="number"
            class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
            placeholder="3100" />
        </label>

        <div v-if="stepErrors.length > 0" class="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <p v-for="message in stepErrors" :key="message">{{ message }}</p>
        </div>
      </div>

      <div v-if="currentStep === 4" class="space-y-4">
        <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 class="text-base font-semibold text-slate-900">配置确认</h3>
          <p class="mt-1 text-sm text-slate-500">确认载荷无误后提交，创建成功后将自动打开新站点详情。</p>
        </div>

        <dl class="grid gap-3 rounded-2xl border border-slate-200 p-4 text-sm md:grid-cols-2">
          <div>
            <dt class="text-slate-500">创建方式</dt>
            <dd class="mt-1 font-medium text-slate-900">{{ form.mode === 'manual' ? '手动创建' : 'DbOption 导入' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">站点</dt>
            <dd class="mt-1 font-medium text-slate-900">{{ form.name }} / {{ form.siteId }}</dd>
          </div>
          <div v-if="form.mode === 'manual'">
            <dt class="text-slate-500">项目</dt>
            <dd class="mt-1 font-medium text-slate-900">{{ form.projectName }} / {{ form.projectCode || '-' }}</dd>
          </div>
          <div v-else>
            <dt class="text-slate-500">导入路径</dt>
            <dd class="mt-1 break-all font-medium text-slate-900">{{ form.importPath || '-' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">前端地址</dt>
            <dd class="mt-1 break-all font-medium text-slate-900">{{ form.frontendUrl || '-' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">后端地址</dt>
            <dd class="mt-1 break-all font-medium text-slate-900">{{ form.backendUrl || '-' }}</dd>
          </div>
        </dl>

        <div class="rounded-2xl border border-slate-200 p-4">
          <h4 class="text-sm font-semibold text-slate-900">默认运行配置</h4>
          <div class="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            <p>module = {{ defaultConfig.module }}</p>
            <p>mdb_name = {{ defaultConfig.mdb_name }}</p>
            <p>db_type = {{ defaultConfig.db_type }}</p>
            <p>bind = {{ normalizedBindHost }}:{{ normalizedBindPort }}</p>
            <p>gen_model = {{ defaultConfig.gen_model }}</p>
            <p>gen_mesh = {{ defaultConfig.gen_mesh }}</p>
            <p>gen_spatial_tree = {{ defaultConfig.gen_spatial_tree }}</p>
            <p>apply_boolean_operation = {{ defaultConfig.apply_boolean_operation }}</p>
          </div>
        </div>

        <div v-if="submitError || deploymentSitesError"
          class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {{ submitError || deploymentSitesError }}
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button"
        class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        @click="handleUpdateOpen(false)">
        取消
      </button>
      <button v-if="currentStep > 1"
        type="button"
        data-testid="site-creation-prev"
        class="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        @click="currentStep -= 1">
        上一步
      </button>
      <button v-if="currentStep < 4"
        type="button"
        data-testid="site-creation-next"
        class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        @click="handleNext">
        下一步
      </button>
      <button v-else
        type="button"
        data-testid="site-creation-submit"
        class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="submitting"
        @click="handleSubmit">
        {{ submitting ? '提交中...' : '创建站点' }}
      </button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import Dialog from '@/components/ui/Dialog.vue';
import { useDeploymentSites } from '@/composables/useDeploymentSites';

type SiteCreateMode = 'manual' | 'import';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  created: [siteId: string];
}>();

const { createSite, importSite, error: deploymentSitesError } = useDeploymentSites();

const steps = [
  { id: 1, label: '创建方式' },
  { id: 2, label: '基础信息' },
  { id: 3, label: '项目与地址' },
  { id: 4, label: '确认提交' },
] as const;

const currentStep = ref(1);
const stepErrors = ref<string[]>([]);
const submitError = ref<string | null>(null);
const submitting = ref(false);

const form = reactive({
  mode: 'manual' as SiteCreateMode,
  name: '',
  siteId: '',
  region: '',
  owner: '',
  env: '',
  description: '',
  projectName: '',
  projectCode: '',
  projectPath: '',
  importPath: '',
  frontendUrl: '',
  backendUrl: '',
  bindHost: '0.0.0.0',
  bindPort: '3100',
});

const normalizedBindHost = computed(() => form.bindHost.trim() || '0.0.0.0');
const normalizedBindPort = computed(() => {
  const parsed = Number(form.bindPort);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3100;
});

const defaultConfig = computed(() => ({
  name: form.name.trim(),
  manual_db_nums: [] as number[],
  manual_refnos: [] as string[],
  project_name: form.projectName.trim(),
  project_path: form.projectPath.trim(),
  project_code: Number(form.projectCode || 0),
  mdb_name: 'ALL',
  module: 'DESI',
  db_type: 'surrealdb',
  surreal_ns: 1,
  db_ip: '',
  db_port: '',
  db_user: '',
  db_password: '',
  gen_model: true,
  gen_mesh: true,
  gen_spatial_tree: true,
  apply_boolean_operation: true,
  mesh_tol_ratio: 0.001,
  room_keyword: '',
  export_json: false,
  export_parquet: false,
}));

watch(() => props.open, (open) => {
  if (open) {
    resetWizard();
  }
});

function resetWizard() {
  currentStep.value = 1;
  stepErrors.value = [];
  submitError.value = null;
  submitting.value = false;
  form.mode = 'manual';
  form.name = '';
  form.siteId = '';
  form.region = '';
  form.owner = '';
  form.env = '';
  form.description = '';
  form.projectName = '';
  form.projectCode = '';
  form.projectPath = '';
  form.importPath = '';
  form.frontendUrl = '';
  form.backendUrl = '';
  form.bindHost = '0.0.0.0';
  form.bindPort = '3100';
}

function handleUpdateOpen(value: boolean) {
  emit('update:open', value);
}

function goToStep(step: number) {
  if (step < currentStep.value) {
    currentStep.value = step;
  }
}

function validateStep(step: number): string[] {
  if (step === 2) {
    const errors: string[] = [];
    if (!form.name.trim()) errors.push('请填写站点名称');
    if (!form.siteId.trim()) errors.push('请填写 site_id');
    return errors;
  }

  if (step === 3) {
    const errors: string[] = [];
    if (form.mode === 'manual') {
      if (!form.projectName.trim()) errors.push('请填写项目名称');
      if (!String(form.projectCode).trim()) errors.push('请填写项目编码');
      if (!form.projectPath.trim()) errors.push('请填写项目路径');
    } else if (!form.importPath.trim()) {
      errors.push('请填写 DbOption 路径');
    }
    return errors;
  }

  return [];
}

function handleNext() {
  stepErrors.value = currentStep.value > 1 ? validateStep(currentStep.value) : [];
  if (stepErrors.value.length > 0) {
    return;
  }
  currentStep.value = Math.min(4, currentStep.value + 1);
}

function buildManualPayload() {
  return {
    site_id: form.siteId.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    region: form.region.trim() || null,
    owner: form.owner.trim() || null,
    env: form.env.trim() || null,
    project_name: form.projectName.trim(),
    project_code: Number(form.projectCode || 0),
    project_path: form.projectPath.trim(),
    frontend_url: form.frontendUrl.trim() || null,
    backend_url: form.backendUrl.trim() || null,
    bind_host: normalizedBindHost.value,
    bind_port: normalizedBindPort.value,
    config: {
      ...defaultConfig.value,
      name: form.name.trim(),
      project_name: form.projectName.trim(),
      project_code: Number(form.projectCode || 0),
      project_path: form.projectPath.trim(),
    },
  };
}

function buildImportPayload() {
  return {
    path: form.importPath.trim(),
    name: form.name.trim(),
    description: form.description.trim() || null,
    env: form.env.trim() || null,
    owner: form.owner.trim() || null,
    region: form.region.trim() || null,
    site_id: form.siteId.trim(),
    frontend_url: form.frontendUrl.trim() || null,
    backend_url: form.backendUrl.trim() || null,
    bind_host: normalizedBindHost.value,
    bind_port: normalizedBindPort.value,
  };
}

async function handleSubmit() {
  stepErrors.value = validateStep(2).concat(validateStep(3));
  submitError.value = null;
  if (stepErrors.value.length > 0) {
    submitError.value = stepErrors.value[0] || '请先完成必填项';
    return;
  }

  submitting.value = true;
  try {
    const createdSite = form.mode === 'manual'
      ? await createSite(buildManualPayload())
      : await importSite(buildImportPayload());

    if (!createdSite?.site_id) {
      submitError.value = '创建站点失败，请检查输入后重试';
      return;
    }

    emit('created', createdSite.site_id);
    emit('update:open', false);
  } catch (error) {
    submitError.value = error instanceof Error ? error.message : '创建站点失败';
  } finally {
    submitting.value = false;
  }
}
</script>
