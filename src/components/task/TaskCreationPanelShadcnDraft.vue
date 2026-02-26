<script setup lang="ts">
import { computed, reactive } from 'vue';

import Badge from '@/components/ui/Badge.vue';
import Input from '@/components/ui/Input.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';

type TaskType = 'DataParsingWizard' | 'DataGeneration';
type ParseMode = 'all' | 'dbnum' | 'refno';

type ActionKey =
  | 'generateModels'
  | 'generateMesh'
  | 'generateSpatialTree'
  | 'applyBooleanOperation'
  | 'regenModel'
  | 'genIndextree'
  | 'rebuildTreeIndex'
  | 'genAllDesiIndextree';

const form = reactive({
  name: '',
  taskType: 'DataParsingWizard' as TaskType,
  parseMode: 'all' as ParseMode,
  targets: '',
  meshTolRatio: 0.01,
  maxConcurrent: 4,
  actions: {
    generateModels: true,
    generateMesh: true,
    generateSpatialTree: false,
    applyBooleanOperation: false,
    regenModel: false,
    genIndextree: true,
    rebuildTreeIndex: false,
    genAllDesiIndextree: false,
  },
});

const taskTypeOptions: Array<{ label: string; value: TaskType }> = [
  { label: 'DataParsingWizard', value: 'DataParsingWizard' },
  { label: 'DataGeneration', value: 'DataGeneration' },
];

const parseModeOptions: Array<{ label: string; value: ParseMode }> = [
  { label: 'All', value: 'all' },
  { label: 'DBNum', value: 'dbnum' },
  { label: 'RefNo', value: 'refno' },
];

const actionGroups: Array<{ key: ActionKey; label: string }> = [
  { key: 'generateModels', label: 'Generate Models' },
  { key: 'generateMesh', label: 'Generate Mesh' },
  { key: 'generateSpatialTree', label: 'Generate SpatialTree' },
  { key: 'applyBooleanOperation', label: 'Boolean Operation' },
  { key: 'regenModel', label: 'Regen Model' },
  { key: 'genIndextree', label: 'Gen Indextree' },
  { key: 'rebuildTreeIndex', label: 'Rebuild Tree Index' },
  { key: 'genAllDesiIndextree', label: 'Gen All DESI Tree' },
];

const parsedTargets = computed(() =>
  form.targets
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const estimatedSubtasks = computed(() => {
  if (form.parseMode === 'all') return 1;
  return Math.max(parsedTargets.value.length, 1);
});

const canStart = computed(() => form.name.trim().length > 0);

function setTaskType(taskType: TaskType) {
  form.taskType = taskType;
}

function setParseMode(mode: ParseMode) {
  form.parseMode = mode;
  if (mode === 'all') form.targets = '';
}

function toggleAction(key: ActionKey) {
  form.actions[key] = !form.actions[key];
}

function updateMeshTolRatio(raw: string) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;
  form.meshTolRatio = Math.max(0.001, Math.min(0.2, parsed));
}

function updateMaxConcurrent(raw: string) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return;
  form.maxConcurrent = Math.max(1, Math.min(32, Math.round(parsed)));
}

function handleStartTask() {
  if (!canStart.value) return;
  // 结构草稿：后续接 useTaskCreation.submitTask()
  console.log('[TaskCreationPanelShadcnDraft] start task payload draft', {
    ...form,
    parsedTargets: parsedTargets.value,
  });
}
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-border bg-background text-foreground">
    <div class="border-b border-border px-3 py-2">
      <div class="text-sm font-semibold">创建解析任务</div>
      <div class="mt-0.5 text-xs text-muted-foreground">平铺式控制面板 · 工程控制台风格（结构草稿）</div>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="space-y-3 p-3">
        <section class="space-y-2 rounded-md border border-border bg-card p-3">
          <h3 class="text-xs font-semibold tracking-wide">全局基础配置</h3>
          <div class="space-y-1">
            <label class="text-[11px] text-muted-foreground">任务名称</label>
            <Input v-model="form.name" placeholder="例如：PARSE-BATCH-20260223" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="typeOption in taskTypeOptions"
              :key="typeOption.value"
              type="button"
              class="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors"
              :class="
                form.taskType === typeOption.value
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              "
              @click="setTaskType(typeOption.value)"
            >
              {{ typeOption.label }}
            </button>
          </div>
        </section>

        <section class="space-y-2 rounded-md border border-border bg-card p-3">
          <h3 class="text-xs font-semibold tracking-wide">解析目标区</h3>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="modeOption in parseModeOptions"
              :key="modeOption.value"
              type="button"
              class="rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors"
              :class="
                form.parseMode === modeOption.value
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              "
              @click="setParseMode(modeOption.value)"
            >
              {{ modeOption.label }}
            </button>
          </div>
          <Input
            v-if="form.parseMode !== 'all'"
            v-model="form.targets"
            :placeholder="form.parseMode === 'dbnum' ? '输入 DBNum，逗号分隔' : '输入 RefNo，逗号分隔'"
          />
          <p class="text-[11px] text-emerald-700">将创建 {{ estimatedSubtasks }} 个子任务（预估）</p>
        </section>

        <section class="space-y-2 rounded-md border border-border bg-card p-3">
          <h3 class="text-xs font-semibold tracking-wide">解析动作区</h3>
          <p class="text-[11px] text-muted-foreground">基础解析 + 高级重构（高密度开关矩阵）</p>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="action in actionGroups"
              :key="action.key"
              type="button"
              class="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent"
              @click="toggleAction(action.key)"
            >
              <span class="truncate pr-2">{{ action.label }}</span>
              <Badge :variant="form.actions[action.key] ? 'default' : 'secondary'" class="text-[10px]">
                {{ form.actions[action.key] ? 'ON' : 'OFF' }}
              </Badge>
            </button>
          </div>
        </section>

        <section class="space-y-2 rounded-md border border-border bg-card p-3">
          <h3 class="text-xs font-semibold tracking-wide">性能调节区</h3>

          <div class="space-y-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-muted-foreground">Mesh Tol Ratio</span>
              <span class="font-medium">{{ form.meshTolRatio.toFixed(3) }}</span>
            </div>
            <input
              :value="form.meshTolRatio"
              type="range"
              min="0.001"
              max="0.2"
              step="0.001"
              class="w-full"
              @input="updateMeshTolRatio(($event.target as HTMLInputElement).value)"
            />
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between text-[11px]">
              <span class="text-muted-foreground">Max Concurrent</span>
              <span class="font-medium">{{ form.maxConcurrent }}</span>
            </div>
            <input
              :value="form.maxConcurrent"
              type="range"
              min="1"
              max="32"
              step="1"
              class="w-full"
              @input="updateMaxConcurrent(($event.target as HTMLInputElement).value)"
            />
          </div>
        </section>
      </div>
    </ScrollArea>

    <div class="border-t border-border bg-muted/30 p-3">
      <p class="mb-2 text-[11px] text-muted-foreground">
        {{ canStart ? '配置检查通过，可直接启动任务' : '请至少填写任务名称' }}
      </p>
      <button
        type="button"
        class="w-full rounded-md px-3 py-2 text-sm font-semibold transition-opacity"
        :class="
          canStart
            ? 'bg-foreground text-background hover:opacity-90'
            : 'cursor-not-allowed bg-muted text-muted-foreground opacity-60'
        "
        :disabled="!canStart"
        @click="handleStartTask"
      >
        启动任务 (Start Task)
      </button>
    </div>
  </div>
</template>
