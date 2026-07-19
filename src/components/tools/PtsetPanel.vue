<script setup lang="ts">
import { computed } from 'vue';

import { ArrowRight, Eye, EyeOff, Focus, MapPin, RefreshCcw, Tag, X } from 'lucide-vue-next';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';

import Badge from '@/components/ui/Badge.vue';
import ScrollArea from '@/components/ui/ScrollArea.vue';
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore';
import { formatLengthMeters, formatNumber, formatVec3Meters } from '@/utils/unitFormat';

type BranchPtsetItem = {
  refno: string;
  noun: string;
  name: string;
  success: boolean;
  ptCount: number;
  errorMessage?: string | null;
};

const props = defineProps<{
  contextRefno: string | null;
  currentRefno: string | null;
  response: PtsetResponse | null;
  isVisible: boolean;
  showCrosses: boolean;
  showLabels: boolean;
  showArrows: boolean;
  branchItems: BranchPtsetItem[];
  branchLoading: boolean;
  branchError: string | null;
  branchSelectedRefno: string | null;
  branchRenderedAll: boolean;
}>();

const emit = defineEmits<{
  close: [];
  toggleVisible: [visible: boolean];
  toggleCrosses: [visible: boolean];
  toggleLabels: [visible: boolean];
  toggleArrows: [visible: boolean];
  refreshBranch: [];
  renderBranchChild: [refno: string];
  renderBranchAll: [];
  flyTo: [];
}>();

const points = computed(() => {
  if (!props.response?.success) return [];
  return props.response.ptset;
});

const unitInfo = computed(() => {
  return props.response?.unit_info;
});

const unitSettings = useUnitSettingsStore();

const unitLabel = computed(() => {
  const policy = unitSettings.ptsetDisplayPolicy.value;
  if (policy === 'follow_backend') {
    return unitInfo.value?.target_unit || '';
  }
  return unitSettings.displayUnit.value;
});

const hasBranchInspector = computed(() => {
  return props.branchLoading || props.branchItems.length > 0 || !!props.branchError;
});

const successfulBranchItems = computed(() => {
  return props.branchItems.filter((item) => item.success && item.ptCount > 0);
});

function formatCoord(pt: [number, number, number]): string {
  const factorToMeters = unitInfo.value?.conversion_factor || 1;
  const policy = unitSettings.ptsetDisplayPolicy.value;

  if (policy === 'follow_backend' && unitInfo.value) {
    const p = Math.max(0, Math.min(6, unitSettings.precision.value));
    const suffix = unitInfo.value.target_unit || '';
    return `(${formatNumber(pt[0] * factorToMeters, p)}, ${formatNumber(pt[1] * factorToMeters, p)}, ${formatNumber(pt[2] * factorToMeters, p)})${suffix}`;
  }

  const meters: [number, number, number] = [
    pt[0] * factorToMeters,
    pt[1] * factorToMeters,
    pt[2] * factorToMeters,
  ];
  return formatVec3Meters(meters, unitSettings.displayUnit.value, unitSettings.precision.value);
}

function formatDir(dir: [number, number, number] | null): string {
  if (!dir) return '-';
  return `(${dir[0].toFixed(2)}, ${dir[1].toFixed(2)}, ${dir[2].toFixed(2)})`;
}

function formatBore(pbore: number): string {
  const factorToMeters = unitInfo.value?.conversion_factor || 1;
  const policy = unitSettings.ptsetDisplayPolicy.value;

  if (policy === 'follow_backend' && unitInfo.value) {
    const p = Math.max(0, Math.min(6, unitSettings.precision.value));
    const suffix = unitInfo.value.target_unit || '';
    return `Ø${formatNumber(pbore * factorToMeters, p)}${suffix}`;
  }

  const meters = pbore * factorToMeters;
  return `Ø${formatLengthMeters(meters, unitSettings.displayUnit.value, unitSettings.precision.value)}`;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex-shrink-0 border-b border-border px-3 py-2">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs font-medium text-foreground">点集数据</div>
          <div class="mt-1 flex flex-wrap items-center gap-1">
            <Badge v-if="contextRefno" variant="outline" class="font-mono text-[10px]">
              上下文 {{ contextRefno }}
            </Badge>
            <Badge v-if="currentRefno && currentRefno !== contextRefno" variant="secondary" class="font-mono text-[10px]">
              当前绘制 {{ currentRefno }}
            </Badge>
          </div>
        </div>
        <button v-if="contextRefno || currentRefno"
          type="button"
          class="rounded p-0.5 hover:bg-muted"
          title="关闭"
          @click="emit('close')">
          <X class="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>
    </div>

    <div v-if="!contextRefno && !response" class="flex flex-1 items-center justify-center">
      <span class="text-xs text-muted-foreground">未加载点集</span>
    </div>

    <template v-else>
      <div v-if="hasBranchInspector"
        class="flex-shrink-0 border-b border-border px-3 py-2">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs font-medium text-foreground">BRAN 子元件点集检查</div>
            <div class="mt-1 text-[10px] text-muted-foreground">
              直子元件 {{ branchItems.length }} 个
              <span v-if="successfulBranchItems.length > 0">| 成功 {{ successfulBranchItems.length }} 个</span>
              <span v-if="branchRenderedAll">| 已叠加显示全部成功项</span>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <button type="button"
              class="inline-flex h-7 items-center gap-1 rounded bg-muted px-2 text-[11px] text-foreground transition-colors hover:bg-accent"
              :disabled="branchLoading"
              @click="emit('refreshBranch')">
              <RefreshCcw class="h-3.5 w-3.5" />
              <span>刷新</span>
            </button>
            <button type="button"
              class="inline-flex h-7 items-center gap-1 rounded bg-primary/10 px-2 text-[11px] text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="branchLoading || successfulBranchItems.length === 0"
              @click="emit('renderBranchAll')">
              <Focus class="h-3.5 w-3.5" />
              <span>显示全部成功项</span>
            </button>
          </div>
        </div>

        <div v-if="branchError"
          class="mt-2 rounded bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
          {{ branchError }}
        </div>
        <div v-else-if="branchLoading"
          class="mt-2 rounded bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
          正在查询直子元件及其点集状态...
        </div>
        <div v-else-if="branchItems.length === 0"
          class="mt-2 rounded bg-muted px-2.5 py-2 text-[11px] text-muted-foreground">
          当前构件没有可检查的直子元件。
        </div>
        <ScrollArea v-else class="mt-2 max-h-56">
          <div class="divide-y divide-border/50 rounded border border-border/60">
            <button v-for="item in branchItems"
              :key="item.refno"
              type="button"
              class="w-full px-3 py-2 text-left transition-colors hover:bg-accent/50"
              :class="branchSelectedRefno === item.refno ? 'bg-primary/5' : ''"
              @click="emit('renderBranchChild', item.refno)">
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate font-mono text-[11px] text-foreground">{{ item.refno }}</span>
                  <Badge variant="outline" class="text-[10px]">{{ item.noun || '-' }}</Badge>
                </div>
                <span class="rounded px-1.5 py-0.5 text-[10px]"
                  :class="item.success ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'">
                  {{ item.success ? `${item.ptCount} 点` : '无 ptset' }}
                </span>
              </div>
              <div class="mt-1 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                <span class="truncate">{{ item.name || '未命名' }}</span>
                <span v-if="!item.success && item.errorMessage" class="truncate">{{ item.errorMessage }}</span>
              </div>
            </button>
          </div>
        </ScrollArea>
      </div>

      <div v-if="response && !response.success && hasBranchInspector"
        class="flex-shrink-0 border-b border-border bg-warning/10 px-3 py-2 text-[11px] text-warning">
        {{ response.error_message || '当前构件自身无 ptset，可从上方子元件列表选择绘制。' }}
      </div>

      <div v-else-if="response && !response.success"
        class="flex flex-1 items-center justify-center p-3">
        <div class="rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {{ response.error_message || '加载失败' }}
        </div>
      </div>

      <template v-else-if="response?.success">
        <div class="flex-shrink-0 border-b border-border px-2 py-1.5">
          <div class="mb-1 text-[10px] text-muted-foreground">
            当前明细: {{ currentRefno || contextRefno }}
          </div>
          <div class="flex items-center gap-1">
            <button type="button"
              class="inline-flex h-7 items-center gap-1 rounded px-2 text-xs transition-colors"
              :class="isVisible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'"
              :title="isVisible ? '隐藏点集' : '显示点集'"
              @click="emit('toggleVisible', !isVisible)">
              <component :is="isVisible ? Eye : EyeOff" class="h-3.5 w-3.5" />
              <span>{{ isVisible ? '显示' : '隐藏' }}</span>
            </button>

            <div class="mx-1 h-4 w-px bg-border" />

            <button type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
              :class="showCrosses ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'"
              :disabled="!isVisible"
              title="显示/隐藏标记点"
              @click="emit('toggleCrosses', !showCrosses)">
              <MapPin class="h-3.5 w-3.5" />
            </button>

            <button type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
              :class="showLabels ? 'bg-brand/10 text-brand' : 'bg-muted text-muted-foreground'"
              :disabled="!isVisible"
              title="显示/隐藏坐标标签"
              @click="emit('toggleLabels', !showLabels)">
              <Tag class="h-3.5 w-3.5" />
            </button>

            <button type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded transition-colors"
              :class="showArrows ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'"
              :disabled="!isVisible"
              title="显示/隐藏方向箭头"
              @click="emit('toggleArrows', !showArrows)">
              <ArrowRight class="h-3.5 w-3.5" />
            </button>

            <div class="mx-1 h-4 w-px bg-border" />

            <button type="button"
              class="inline-flex h-7 w-7 items-center justify-center rounded bg-muted transition-colors hover:bg-accent"
              title="飞行到点集视图"
              @click="emit('flyTo')">
              <Focus class="h-3.5 w-3.5" />
            </button>
          </div>

          <div class="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>{{ points.length }} 个连接点</span>
            <span v-if="unitLabel">| 单位: {{ unitLabel }}</span>
          </div>
        </div>

        <ScrollArea class="min-h-0 flex-1">
          <div class="divide-y divide-border/50">
            <div v-for="point in points"
              :key="point.number"
              class="px-3 py-2 hover:bg-accent/50">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-success">#{{ point.number }}</span>
                <Badge v-if="point.pbore > 0" variant="secondary" class="text-[10px]">
                  {{ formatBore(point.pbore) }}
                </Badge>
              </div>

              <div class="mt-1 text-[11px] text-muted-foreground">
                <span class="text-foreground/70">位置:</span>
                {{ formatCoord(point.pt) }}
              </div>

              <div v-if="point.dir" class="mt-0.5 text-[11px] text-muted-foreground">
                <span class="text-foreground/70">方向:</span>
                {{ formatDir(point.dir) }}
              </div>
            </div>
          </div>
        </ScrollArea>
      </template>

      <div v-else
        class="flex flex-1 items-center justify-center p-3 text-xs text-muted-foreground">
        选择一个成功样本即可在正式 Viewer 中绘制其点集。
      </div>
    </template>
  </div>
</template>
