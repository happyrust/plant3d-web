<template>
  <div class="task-creation-wizard">
    <!-- 头部 -->
    <div class="wizard-header">
      <div class="header-title-block">
        <div class="header-title">
          <v-icon size="20" class="mr-2">mdi-plus-circle</v-icon>
          <span>{{ wizardHeaderTitle }}</span>
        </div>
        <div v-if="showModelGenContext" class="header-meta">
          <v-chip size="x-small" variant="tonal" color="primary" class="header-chip">
            后台批任务
          </v-chip>
          <span class="header-caption">对接 gen-model /api/tasks</span>
        </div>
      </div>
      <v-btn icon size="small" variant="text" @click="handleClose">
        <v-icon size="18">mdi-close</v-icon>
      </v-btn>
    </div>

    <div v-if="siteContext" class="site-context-banner">
      <v-icon size="16" class="mr-2">mdi-server</v-icon>
      <span>当前站点：{{ siteContext.siteName || siteContext.siteId }}</span>
      <span v-if="siteContext.isCurrentSite" class="site-context-tag">当前站点执行</span>
    </div>

    <!-- 步骤指示器 -->
    <div class="step-indicator">
      <div v-for="step in 3"
        :key="step"
        class="step-item"
        :class="{
          active: currentStep === step,
          completed: currentStep > step,
        }"
        @click="goToStep(step)">
        <div class="step-number">
          <v-icon v-if="currentStep > step" size="14">mdi-check</v-icon>
          <span v-else>{{ step }}</span>
        </div>
        <span class="step-label">{{ stepLabels[step - 1] }}</span>
      </div>
    </div>

    <div v-if="currentStep === 1 && formData.type === 'DataGeneration'" class="wizard-context-alert">
      <v-alert type="info" variant="tonal" density="compact" class="mb-0">
        此处创建的是<strong>后台批处理任务</strong>（创建后将调用 /api/tasks 并自动启动）。在模型树或 Viewer
        中按节点按需加载模型属于<strong>即时加载</strong>，无需在此创建任务；批任务进度请在「任务监视」面板查看。
      </v-alert>
    </div>

    <!-- 步骤内容 -->
    <div class="wizard-content">
      <!-- 步骤 1: 基础信息 -->
      <div v-show="currentStep === 1" class="step-content">
        <div class="form-group">
          <label class="form-label required">任务名称</label>
          <v-text-field v-model="formData.name"
            placeholder="请输入任务名称"
            variant="outlined"
            density="compact"
            :error-messages="errors.name"
            :loading="validatingName"
            @blur="validateName">
            <template #append-inner>
              <v-icon v-if="nameAvailable === true" color="success" size="18">
                mdi-check-circle
              </v-icon>
              <v-icon v-else-if="nameAvailable === false" color="error" size="18">
                mdi-close-circle
              </v-icon>
            </template>
          </v-text-field>
        </div>

        <div class="form-group">
          <label class="form-label required">任务类型</label>
          <v-radio-group v-model="formData.type" inline :error-messages="errors.type">
            <v-radio label="数据解析" value="DataParsingWizard">
              <template #label>
                <div class="radio-label">
                  <v-icon size="18" class="mr-1">mdi-database-search</v-icon>
                  数据解析
                </div>
              </template>
            </v-radio>
            <v-radio label="模型生成" value="DataGeneration">
              <template #label>
                <div class="radio-label">
                  <v-icon size="18" class="mr-1">mdi-cube-outline</v-icon>
                  模型生成
                </div>
              </template>
            </v-radio>
          </v-radio-group>
        </div>

        <div class="form-group">
          <label class="form-label">优先级</label>
          <v-select v-model="formData.priority"
            :items="priorityOptions"
            item-title="label"
            item-value="value"
            variant="outlined"
            density="compact" />
        </div>

        <div class="form-group">
          <label class="form-label">描述</label>
          <v-textarea v-model="formData.description"
            placeholder="请输入任务描述（可选）"
            variant="outlined"
            density="compact"
            rows="2"
            auto-grow />
        </div>
      </div>

      <!-- 步骤 2: 参数配置 -->
      <div v-show="currentStep === 2" class="step-content">
        <!-- 数据解析参数 -->
        <template v-if="formData.type === 'DataParsingWizard'">
          <div class="form-group">
            <label class="form-label required">解析模式</label>
            <v-radio-group v-model="formData.parseMode">
              <v-radio label="全量解析" value="all">
                <template #label>
                  <div class="radio-label">
                    <span>全量解析</span>
                    <span class="radio-hint">解析所有数据</span>
                  </div>
                </template>
              </v-radio>
              <v-radio label="按数据库编号" value="dbnum">
                <template #label>
                  <div class="radio-label">
                    <span>按数据库编号</span>
                    <span class="radio-hint">解析指定数据库</span>
                  </div>
                </template>
              </v-radio>
              <v-radio label="按参考号" value="refno">
                <template #label>
                  <div class="radio-label">
                    <span>按参考号</span>
                    <span class="radio-hint">解析指定元件</span>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
          </div>

          <div v-if="formData.parseMode === 'dbnum'" class="form-group">
            <label class="form-label required">数据库编号</label>
            <v-text-field v-model="formData.dbnum"
              placeholder="输入数据库编号，多个用逗号分隔，如: 7999,8000,1112"
              variant="outlined"
              density="compact"
              :error-messages="errors.dbnum" />
            <div v-if="parsedDbnums.length > 1" class="form-hint mt-1">
              <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
              将创建 {{ parsedDbnums.length }} 个子任务，按顺序逐个执行
            </div>
          </div>

          <div v-if="formData.parseMode === 'refno'" class="form-group">
            <label class="form-label required">参考号</label>
            <v-text-field v-model="formData.refno"
              placeholder="请输入参考号，格式如: 12345_67890"
              variant="outlined"
              density="compact"
              :error-messages="errors.refno" />
          </div>
        </template>

        <!-- 模型生成参数（范围 → 生成内容 → 高级） -->
        <template v-if="formData.type === 'DataGeneration'">
          <h4 class="section-heading">生成范围</h4>
          <p class="section-lead">
            与任务配置一致：可选 dbnum 或 refno，二者勿同时填写；留空表示全部数据库。多个 dbnum 请用英文逗号分隔（解析任务会拆子任务；模型生成按单字段规则校验）。
          </p>

          <div class="form-group">
            <label class="form-label">数据库编号</label>
            <v-text-field v-model="formData.dbnum"
              placeholder="例如：1516 或 7999,8000"
              variant="outlined"
              density="compact"
              :error-messages="errors.dbnum" />
          </div>

          <div class="form-group">
            <label class="form-label">参考号（可选）</label>
            <v-text-field v-model="formData.refno"
              placeholder="例如：24381_145018"
              variant="outlined"
              density="compact"
              :error-messages="errors.refno" />
          </div>

          <div class="form-hint">
            <v-icon size="14" color="info" class="mr-1">mdi-information-outline</v-icon>
            dbnum 与 refno 二选一；均留空则处理全部数据库
          </div>

          <h4 class="section-heading section-heading-spaced">生成内容</h4>
          <div class="form-group">
            <label class="form-label required">至少选一</label>
            <div class="checkbox-group">
              <v-checkbox v-model="formData.generateModels"
                label="生成模型"
                density="compact"
                hide-details />
              <v-checkbox v-model="formData.generateMesh"
                label="生成网格"
                density="compact"
                hide-details />
              <v-checkbox v-model="formData.generateSpatialTree"
                label="生成空间树"
                density="compact"
                hide-details />
            </div>
            <div v-if="errors.generateModels" class="error-message">
              {{ errors.generateModels }}
            </div>
          </div>

          <v-btn variant="text"
            size="small"
            class="advanced-toggle px-0"
            :append-icon="modelGenAdvancedOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'"
            @click="modelGenAdvancedOpen = !modelGenAdvancedOpen">
            高级：布尔运算、Web 数据包、网格容差、并发、Noun 过滤…
          </v-btn>

          <v-expand-transition>
            <div v-show="modelGenAdvancedOpen" class="advanced-block">
              <div class="form-group">
                <v-checkbox v-model="formData.applyBooleanOperation"
                  label="应用布尔运算"
                  density="compact"
                  hide-details />
              </div>

              <div class="form-group">
                <v-checkbox v-model="formData.exportWebBundle"
                  label="导出 Web 数据包"
                  density="compact"
                  hide-details
                  hint="自动生成 export-all-relates 数据包用于 Web 查看器" />
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label class="form-label">网格容差比例</label>
                  <v-text-field v-model.number="formData.meshTolRatio"
                    variant="outlined"
                    density="compact"
                    type="number"
                    step="0.001"
                    min="0.001"
                    max="1"
                    :error-messages="errors.meshTolRatio" />
                </div>
                <div class="form-group flex-1">
                  <label class="form-label">最大并发数</label>
                  <v-text-field v-model.number="formData.maxConcurrent"
                    variant="outlined"
                    density="compact"
                    type="number"
                    min="1"
                    max="16"
                    :error-messages="errors.maxConcurrent" />
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Noun 过滤</label>
                <v-combobox :model-value="formData.enabledNouns"
                  :search="formData.nounInput"
                  :error="nounInputInvalid"
                  :error-messages="nounInputError ? [nounInputError] : []"
                  multiple
                  chips
                  closable-chips
                  clear-on-select
                  hide-selected
                  hint="输入 noun 后按 Enter 添加；留空表示不过滤，生成全部类型"
                  persistent-hint
                  placeholder="例如：BRAN、HANG、PANE"
                  variant="outlined"
                  density="compact"
                  @update:search="handleNounSearch"
                  @update:model-value="handleNounListChange"
                  @keydown.enter.prevent="handleNounEnter"
                  @click:clear="clearNounInput">
                  <template #chip="{ props: chipProps, item }">
                    <v-chip v-bind="chipProps"
                      size="small"
                      closable
                      @click:close="removeNoun(String(item.raw))">
                      {{ String(item.raw) }}
                    </v-chip>
                  </template>
                </v-combobox>
              </div>

              <div class="form-group">
                <label class="form-label">Limit instances per noun type (optional, for testing)</label>
                <v-text-field v-model="formData.limitPerNounType"
                  placeholder="Leave empty for no limit"
                  variant="outlined"
                  density="compact"
                  type="number"
                  min="1"
                  step="1"
                  :error-messages="errors.limitPerNounType" />
              </div>
            </div>
          </v-expand-transition>
        </template>
      </div>

      <!-- 步骤 3: 预览确认 -->
      <div v-show="currentStep === 3" class="step-content">
        <v-alert v-if="formData.type === 'DataGeneration' && !createdTaskId"
          type="warning"
          variant="tonal"
          density="comfortable"
          class="mb-2">
          提交后将<strong>创建任务并自动启动</strong>。运行中或失败时，请在<strong>任务监视</strong>面板查看状态与日志；与模型树中按需「显示模型」不是同一条链路。
        </v-alert>

        <div class="preview-section">
          <h4 class="preview-title">基础信息</h4>
          <div class="preview-item">
            <span class="preview-label">任务名称</span>
            <span class="preview-value">{{ formData.name }}</span>
          </div>
          <div class="preview-item">
            <span class="preview-label">任务类型</span>
            <span class="preview-value">
              {{ formData.type === 'DataParsingWizard' ? '数据解析' : '模型生成' }}
            </span>
          </div>
          <div class="preview-item">
            <span class="preview-label">优先级</span>
            <v-chip :color="getPriorityColor(formData.priority)" size="small" variant="tonal">
              {{ getPriorityLabel(formData.priority) }}
            </v-chip>
          </div>
          <div v-if="formData.description" class="preview-item">
            <span class="preview-label">描述</span>
            <span class="preview-value">{{ formData.description }}</span>
          </div>
        </div>

        <div class="preview-section">
          <h4 class="preview-title">任务参数</h4>
          <template v-if="formData.type === 'DataParsingWizard'">
            <div class="preview-item">
              <span class="preview-label">解析模式</span>
              <span class="preview-value">{{ parseModeLabels[formData.parseMode] }}</span>
            </div>
            <div v-if="formData.parseMode === 'dbnum'" class="preview-item">
              <span class="preview-label">数据库编号</span>
              <span class="preview-value">
                {{ formData.dbnum }}
                <span v-if="parsedDbnums.length > 1" class="ml-1" style="color: rgb(var(--v-theme-info));">
                  ({{ parsedDbnums.length }} 个子任务)
                </span>
              </span>
            </div>
            <div v-if="formData.parseMode === 'refno'" class="preview-item">
              <span class="preview-label">参考号</span>
              <span class="preview-value">{{ formData.refno }}</span>
            </div>
          </template>
          <template v-if="formData.type === 'DataGeneration'">
            <div class="preview-item">
              <span class="preview-label">数据库编号</span>
              <span class="preview-value">{{ dataGenerationDbnumPreviewText }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">参考号</span>
              <span class="preview-value">{{ dataGenerationRefnoPreviewText }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">生成内容</span>
              <span class="preview-value">{{ generateContentText }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">布尔运算</span>
              <span class="preview-value">{{ formData.applyBooleanOperation ? '启用' : '禁用' }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">网格容差</span>
              <span class="preview-value">{{ formData.meshTolRatio }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">并发数</span>
              <span class="preview-value">{{ formData.maxConcurrent }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">Noun 过滤</span>
              <span class="preview-value">{{ enabledNounsPreviewText }}</span>
            </div>
            <div class="preview-item">
              <span class="preview-label">实例限制</span>
              <span class="preview-value">{{ limitPerNounTypePreviewText }}</span>
            </div>
          </template>
        </div>

        <!-- 提交错误 -->
        <v-alert v-if="submitError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4">
          {{ submitError }}
        </v-alert>

        <!-- 提交成功 -->
        <v-alert v-if="createdTaskId"
          type="success"
          variant="tonal"
          density="compact"
          class="mt-4">
          任务创建成功！任务ID: {{ createdTaskId }}
        </v-alert>
      </div>
    </div>

    <!-- 底部按钮 -->
    <div class="wizard-footer">
      <v-btn v-if="currentStep > 1"
        variant="text"
        @click="prevStep">
        上一步
      </v-btn>
      <v-spacer />
      <v-btn v-if="currentStep < 3"
        color="primary"
        :disabled="!isCurrentStepValid"
        :loading="stepProcessing"
        @click="nextStep">
        下一步
      </v-btn>
      <v-btn v-if="currentStep === 3 && !createdTaskId"
        color="primary"
        :loading="loading"
        :disabled="!canSubmit"
        @click="handleSubmit">
        {{ formData.type === 'DataGeneration' ? '创建并启动' : '创建任务' }}
      </v-btn>
      <v-btn v-if="createdTaskId"
        color="primary"
        @click="handleCreateAnother">
        继续创建
      </v-btn>
    </div>
  </div>
</template>

<!-- @ts-nocheck -->
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { DatabaseConfig } from '@/api/genModelTaskApi';
import type { TaskCreationSiteContext } from '@/composables/useTaskCreationStore';
import type { TaskPriority } from '@/types/task';

import { useTaskCreation } from '@/composables/useTaskCreation';

const DEFAULT_TASK_TYPE = 'DataParsingWizard';

const props = withDefaults(defineProps<{
  initialConfig?: DatabaseConfig | null;
  siteContext?: TaskCreationSiteContext | null;
}>(), {
  initialConfig: null,
  siteContext: null,
});

// ============ Emits ============
const emit = defineEmits<{
  close: [];
  created: [taskId: string];
}>();

// ============ 任务创建 ============
const {
  currentStep,
  formData,
  errors,
  loading,
  validatingName,
  nameAvailable,
  submitError,
  createdTaskId,
  stepProcessing,
  isCurrentStepValid,
  canSubmit,
  nextStep,
  prevStep,
  goToStep,
  validateName,
  submitTask,
  resetForm,
  applyPresetType,
  serverConfig,
  siteContext,
  addNoun,
  removeNoun,
  setEnabledNouns,
  nounInputInvalid,
  nounInputError,
} = useTaskCreation({
  initialConfig: props.initialConfig,
  siteContext: props.siteContext,
});

// 组件挂载时应用预设类型
onMounted(() => {
  applyPresetType();
});

// 模型生成：高级参数默认折叠（对齐设计稿渐进披露）
const modelGenAdvancedOpen = ref(false);

// ============ 常量 ============
const stepLabelsDefault = ['基础信息', '参数配置', '预览确认'];
const stepLabelsModelGen = ['基础信息', '范围与选项', '确认并启动'];

const priorityOptions = [
  { label: '低', value: 'low' },
  { label: '普通', value: 'normal' },
  { label: '高', value: 'high' },
  { label: '紧急', value: 'critical' },
];

const parseModeLabels: Record<string, string> = {
  all: '全量解析',
  dbnum: '按数据库编号',
  refno: '按参考号',
};

// ============ 计算属性 ============

const wizardHeaderTitle = computed(() =>
  formData.type === 'DataGeneration' ? '模型生成' : '创建任务'
);

const showModelGenContext = computed(() => formData.type === 'DataGeneration');

const stepLabels = computed(() =>
  formData.type === 'DataGeneration' ? stepLabelsModelGen : stepLabelsDefault
);

/** 解析逗号分隔的 dbnum 输入为数字数组 */
const parsedDbnums = computed<number[]>(() => {
  if (formData.parseMode !== 'dbnum' || !formData.dbnum.trim()) return [];
  return formData.dbnum
    .split(/[,，\s]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !isNaN(Number(s)))
    .map(Number);
});

const generateContentText = computed(() => {
  const items: string[] = [];
  if (formData.generateModels) items.push('模型');
  if (formData.generateMesh) items.push('网格');
  if (formData.generateSpatialTree) items.push('空间树');
  return items.length > 0 ? items.join('、') : '无';
});

const enabledNounsPreviewText = computed(() => {
  return formData.enabledNouns.length > 0 ? formData.enabledNouns.join('、') : '全部类型';
});

const limitPerNounTypePreviewText = computed(() => {
  const value = formData.limitPerNounType.trim();
  return value ? value : '无限制';
});

const dataGenerationDbnumPreviewText = computed(() => {
  const value = formData.dbnum.trim();
  return value ? value : '全部数据库';
});

const dataGenerationRefnoPreviewText = computed(() => {
  const value = formData.refno.trim();
  return value ? value : '未指定';
});

// ============ 辅助函数 ============
function getPriorityColor(priority: TaskPriority): string {
  const colors: Record<TaskPriority, string> = {
    low: 'grey',
    normal: 'blue',
    high: 'orange',
    critical: 'red',
  };
  return colors[priority] || 'grey';
}

function getPriorityLabel(priority: TaskPriority): string {
  const labels: Record<TaskPriority, string> = {
    low: '低',
    normal: '普通',
    high: '高',
    critical: '紧急',
  };
  return labels[priority] || priority;
}

function handleNounSearch(value: string) {
  formData.nounInput = value;
}

function handleNounEnter() {
  if (!nounInputInvalid.value) {
    addNoun(formData.nounInput);
  }
}

function clearNounInput() {
  formData.nounInput = '';
}

function handleNounListChange(values: unknown[]) {
  const normalizedValues = values
    .map(value => {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && 'value' in value) {
        return String((value as { value?: unknown }).value ?? '');
      }
      return String(value ?? '');
    });
  setEnabledNouns(normalizedValues);
}

// ============ 事件处理 ============
function handleClose() {
  emit('close');
}

async function handleSubmit() {
  // 多 dbnum 时走批量创建
  if (formData.parseMode === 'dbnum' && parsedDbnums.value.length > 1) {
    await handleBatchSubmit();
    return;
  }
  const success = await submitTask();
  if (success && createdTaskId.value) {
    emit('created', createdTaskId.value);
  }
}

/** 批量创建：为每个 dbnum 创建独立子任务（共享 batch_id） */
async function handleBatchSubmit() {
  const { taskCreate, taskStart } = await import('@/api/genModelTaskApi');
  loading.value = true;
  submitError.value = null;

  const cfg = serverConfig.value;
  const batchId = crypto.randomUUID ? crypto.randomUUID() : `batch-${Date.now()}`;
  const dbnums = parsedDbnums.value;
  const createdIds: string[] = [];

  try {
    for (let i = 0; i < dbnums.length; i++) {
      const dbnum = dbnums[i];
      const taskName = `${formData.name.trim()} - DB${dbnum}`;
      const request: any = {
        name: taskName,
        task_type: formData.type === 'DataParsingWizard' ? 'DataParsingWizard' : 'DataGeneration',
        config: {
          name: taskName,
          manual_db_nums: [dbnum],
          manual_refnos: [],
          project_name: cfg?.project_name ?? 'AvevaMarineSample',
          project_path: cfg?.project_path ?? '',
          project_code: cfg?.project_code ?? 1516,
          mdb_name: cfg?.mdb_name ?? 'ALL',
          module: cfg?.module ?? 'DESI',
          db_type: cfg?.db_type ?? 'surrealdb',
          surreal_ns: cfg?.surreal_ns ?? 1516,
          db_ip: cfg?.db_ip ?? 'localhost',
          db_port: cfg?.db_port ?? '8020',
          db_user: cfg?.db_user ?? 'root',
          db_password: cfg?.db_password ?? 'root',
          gen_model: formData.type === 'DataGeneration' ? formData.generateModels : true,
          gen_mesh: formData.type === 'DataGeneration' ? formData.generateMesh : false,
          gen_spatial_tree: formData.type === 'DataGeneration' ? formData.generateSpatialTree : true,
          apply_boolean_operation: formData.type === 'DataGeneration' ? formData.applyBooleanOperation : true,
          mesh_tol_ratio: formData.type === 'DataGeneration' ? formData.meshTolRatio : 3.0,
          room_keyword: cfg?.room_keyword ?? '-RM',
        },
        metadata: {
          batch_id: batchId,
          batch_index: i + 1,
          batch_total: dbnums.length,
          db_num: dbnum,
        },
      };

      const resp = await taskCreate(request);
      if (resp.success && resp.taskId) {
        createdIds.push(resp.taskId);
        // 自动启动子任务
        try {
          await taskStart(resp.taskId);
        } catch (e) {
          console.warn(`自动启动子任务 DB${dbnum} 失败:`, e);
        }
      } else {
        submitError.value = `创建子任务 DB${dbnum} 失败: ${resp.error_message || '未知错误'}`;
        break;
      }
    }

    if (createdIds.length === dbnums.length) {
      createdTaskId.value = createdIds[0];
      submitError.value = null;
    }
  } catch (e) {
    submitError.value = `批量创建失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    loading.value = false;
  }

  if (createdTaskId.value) {
    emit('created', createdTaskId.value);
  }
}

function handleCreateAnother() {
  resetForm();
  formData.type = DEFAULT_TASK_TYPE;
  modelGenAdvancedOpen.value = false;
}
</script>

<style scoped lang="scss">
.task-creation-wizard {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-surface));
}

.wizard-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .header-title-block {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .header-title {
    display: flex;
    align-items: center;
    font-size: 15px;
    font-weight: 500;
  }

  .header-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding-left: 28px;
  }

  .header-chip {
    font-weight: 600;
  }

  .header-caption {
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.55);
  }
}

.wizard-context-alert {
  padding: 0 16px 12px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.section-heading {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.section-heading-spaced {
  margin-top: 8px;
}

.section-lead {
  margin: -8px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.advanced-toggle {
  align-self: flex-start;
  margin-top: -4px;
  font-size: 12px;
}

.advanced-block {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}

.site-context-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
  font-size: 13px;
  font-weight: 500;

  .site-context-tag {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(var(--v-theme-primary), 0.12);
    font-size: 11px;
    font-weight: 600;
  }
}

.step-indicator {
  display: flex;
  padding: 16px;
  gap: 8px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  .step-item {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.2s;

    &.active,
    &.completed {
      opacity: 1;
    }

    &.completed .step-number {
      background: rgb(var(--v-theme-success));
      color: white;
    }

    &.active .step-number {
      background: rgb(var(--v-theme-primary));
      color: white;
    }
  }

  .step-number {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(var(--v-theme-on-surface), 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 500;
  }

  .step-label {
    font-size: 11px;
  }
}

.wizard-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 16px;
}

.step-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.8);

  &.required::after {
    content: ' *';
    color: rgb(var(--v-theme-error));
  }
}

.form-hint {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.form-row {
  display: flex;
  gap: 16px;

  .flex-1 {
    flex: 1;
  }
}

.radio-label {
  display: flex;
  flex-direction: column;

  .radio-hint {
    font-size: 11px;
    color: rgba(var(--v-theme-on-surface), 0.5);
  }
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-message {
  font-size: 12px;
  color: rgb(var(--v-theme-error));
  margin-top: 4px;
}

.preview-section {
  padding: 12px;
  background: rgba(var(--v-theme-surface-variant), 0.3);
  border-radius: 8px;
  margin-bottom: 12px;

  .preview-title {
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  }

  .preview-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 0;

    .preview-label {
      font-size: 12px;
      color: rgba(var(--v-theme-on-surface), 0.6);
    }

    .preview-value {
      font-size: 13px;
      font-weight: 500;
    }
  }
}

.wizard-footer {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  flex-shrink: 0; /* 防止被压缩 */
  background: rgb(var(--v-theme-surface)); /* 防止透明 */
  z-index: 10;
}
</style>
