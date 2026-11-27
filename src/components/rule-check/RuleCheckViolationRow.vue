<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import { ArrowLeftRight, Check, Copy, Crosshair, Funnel, ScanEye } from 'lucide-vue-next';

import type { UnifiedRuleViolation } from '@/api/ruleCheckApi';

import { violationGapLabel, violationGaugeRatio } from '@/utils/ruleCheckResultView';

const props = defineProps<{
  violation: UnifiedRuleViolation;
  active: boolean;
  expanded: boolean;
  /** 平铺列表第一行写规则号与标题；分组里组头已经写了，改写严重度。 */
  showRule: boolean;
  /** 本次开了精确复核：估算行要标出来。 */
  preciseRun: boolean;
}>();

const emit = defineEmits<{
  select: [violation: UnifiedRuleViolation];
  focus: [violation: UnifiedRuleViolation];
  isolate: [violation: UnifiedRuleViolation];
  onlyRule: [violation: UnifiedRuleViolation];
}>();

const COPY_BADGE_TITLE = '源或目标（或其所在 BRAN / PIPE）叫 E3D 复制名 Copy-of-…：多半是复制后没挪开、与原件重叠的副本';

const v = computed(() => props.violation);

const severity = computed(() => {
  const x = v.value;
  if (x.highlightColor === 'red') {
    return { label: '扩散性火灾', badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-600' };
  }
  if (x.highlightColor === 'yellow') {
    return { label: '局部性火灾', badge: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500' };
  }
  if (x.severity === 'reminder') {
    return { label: '提醒', badge: 'border-sky-200 bg-sky-50 text-sky-800', dot: 'bg-sky-600' };
  }
  if (x.severity === 'semi_auto') {
    return { label: '半自动复核', badge: 'border-violet-200 bg-violet-50 text-violet-800', dot: 'bg-violet-600' };
  }
  return { label: '违规', badge: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-600' };
});

/** 平铺列表里普通违规只靠行首的红点区分（另有给读屏的文字），不再重复写「违规」。 */
const showSeverityBadge = computed(() => !props.showRule || severity.value.label !== '违规');

const accuracyBadge = computed(() => {
  if (v.value.accuracy === 'exact') {
    return { label: '精算', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', title: '三维网格外表面距离' };
  }
  if (v.value.accuracy === 'aabb' && props.preciseRun) {
    return { label: '估算', cls: 'border-amber-200 bg-amber-50 text-amber-800', title: '包围盒距离：缺网格或规则不参与精算' };
  }
  return null;
});

function withUnit(n: number): string {
  return `${n.toFixed(1)}${v.value.unit ? ` ${v.value.unit}` : ''}`;
}

/** 空间与 BRAN 规则第二行写构件对；房间与属性规则写后端给的说明。 */
const showPair = computed(
  () => (v.value.engine === 'spatial' || v.value.engine === 'bran') && v.value.targetLabel !== '',
);

const exactSurfaceNote = computed(() => {
  const x = v.value;
  if (x.exactSurfaceMm === undefined || x.measuredMm === undefined) return null;
  if (Math.abs(x.exactSurfaceMm - x.measuredMm) < 0.05) return null;
  return `外表面 ${withUnit(x.exactSurfaceMm)}`;
});

const gap = computed(() => violationGapLabel(v.value));
const gauge = computed(() => violationGaugeRatio(v.value));

const accuracyText = computed(() => {
  const x = v.value;
  if (x.accuracy === 'exact') {
    return x.exactSurfaceMm !== undefined ? `网格精算 · 外表面距离 ${withUnit(x.exactSurfaceMm)}` : '网格精算';
  }
  if (x.accuracy === 'aabb') return props.preciseRun ? '包围盒估算（缺网格或该规则不参与精算）' : '包围盒估算';
  if (x.engine === 'spatial') return '包围盒估算';
  return null;
});

const whereText = computed(() => {
  const parts: string[] = [];
  if (v.value.branchRefno) parts.push(`BRAN ${v.value.branchRefno}`);
  if (v.value.roomNum) parts.push(`房 ${v.value.roomNum}`);
  if (v.value.hasColumn) parts.push('有柱');
  return parts.join(' · ');
});

const copiedField = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

async function copyText(field: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedField.value = field;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedField.value = null;
  }, 1200);
}

onBeforeUnmount(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div data-testid="rule-check-violation-row"
    :data-violation-key="violation.key"
    :data-active="active ? 'true' : undefined"
    class="scroll-mt-28 cursor-pointer border-b border-border/60 transition-colors"
    :class="active ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : 'hover:bg-muted/40'"
    :aria-expanded="expanded"
    @click="emit('select', violation)">
    <div class="space-y-1 py-2 pr-3" :class="showRule ? 'pl-3' : 'pl-6'">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="h-2 w-2 shrink-0 rounded-full" :class="severity.dot" aria-hidden="true" />
        <span v-if="!showSeverityBadge" class="sr-only">{{ severity.label }}</span>
        <template v-if="showRule">
          <span class="shrink-0 font-mono text-[12px] font-semibold text-foreground">{{ violation.ruleId }}</span>
          <span class="min-w-0 truncate text-[12px] text-muted-foreground" :title="violation.title">{{ violation.title }}</span>
        </template>
        <span v-if="showSeverityBadge"
          class="shrink-0 rounded border px-1.5 text-[11px] font-medium"
          :class="severity.badge">{{ severity.label }}</span>
        <span class="flex-1" />
        <span v-if="accuracyBadge"
          data-testid="rule-check-accuracy-badge"
          class="shrink-0 rounded border px-1.5 text-[11px] font-medium"
          :class="accuracyBadge.cls"
          :title="accuracyBadge.title">{{ accuracyBadge.label }}</span>
        <span v-if="violation.copyNamed"
          data-testid="rule-check-copy-badge"
          class="shrink-0 rounded border border-border bg-muted px-1.5 text-[11px] text-foreground/70"
          :title="COPY_BADGE_TITLE">Copy-of 副本</span>
        <span v-if="violation.hasColumn" class="shrink-0 rounded bg-amber-50 px-1 text-[11px] text-amber-800">有柱</span>
        <button type="button"
          data-testid="rule-check-focus-btn"
          title="定位高亮：三维飞到涉事构件"
          aria-label="定位高亮"
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
          :disabled="violation.highlightRefnos.length === 0"
          @click.stop="emit('focus', violation)">
          <Crosshair class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div v-if="showPair" class="flex flex-wrap items-center gap-x-1.5 pl-3.5 font-mono text-[12px] text-foreground">
        <span>{{ violation.sourceLabel }}</span>
        <ArrowLeftRight class="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">与</span>
        <span>{{ violation.targetLabel }}</span>
      </div>
      <div v-else class="pl-3.5 text-[12px] leading-snug text-foreground">{{ violation.detail }}</div>

      <div v-if="violation.roomNum || violation.branchRefno" class="flex flex-wrap gap-x-2 pl-3.5 font-mono text-[11px] text-foreground/70">
        <span v-if="violation.roomNum">房 {{ violation.roomNum }}</span>
        <span v-if="violation.branchRefno">BRAN {{ violation.branchRefno }}</span>
      </div>

      <div v-if="violation.measuredMm !== undefined" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-3.5 font-mono text-[11px] tabular-nums">
        <span class="whitespace-nowrap" :class="gap ? 'font-semibold text-red-700' : 'text-foreground'">实测 {{ withUnit(violation.measuredMm) }}</span>
        <span v-if="violation.thresholdMm !== undefined" class="whitespace-nowrap text-foreground/70">/ 阈值 {{ withUnit(violation.thresholdMm) }}</span>
        <span v-if="gauge !== null"
          class="flex h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted"
          :title="`实测只有阈值的 ${Math.round(gauge * 100)}%`"
          aria-hidden="true">
          <span class="h-full bg-foreground/30" :style="{ width: `${gauge * 100}%` }" />
          <span class="h-full flex-1 bg-red-500" />
        </span>
        <span v-if="gap" class="ml-auto shrink-0 whitespace-nowrap text-[12px] font-semibold text-red-700">{{ gap }}</span>
      </div>
      <div v-if="exactSurfaceNote" class="pl-3.5 font-mono text-[11px] tabular-nums text-foreground/70">{{ exactSurfaceNote }}</div>

      <div v-if="expanded"
        data-testid="rule-check-violation-details"
        class="ml-3.5 mt-1.5 space-y-1 border-t border-primary/20 pt-2 text-[12px]"
        @click.stop>
        <div class="flex gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">规范要求</span>
          <span class="min-w-0 text-foreground">
            {{ violation.title }}（{{ violation.requirement }}）
            <span class="font-mono text-[11px] text-muted-foreground">#{{ violation.issue }}</span>
          </span>
        </div>
        <div v-if="violation.sourceLabel" class="flex items-center gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">源</span>
          <span class="min-w-0 flex-1 truncate font-mono">{{ violation.sourceLabel }}</span>
          <button type="button"
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary"
            title="复制源构件"
            aria-label="复制源构件"
            @click="copyText('source', violation.sourceLabel)">
            <component :is="copiedField === 'source' ? Check : Copy" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div v-if="violation.targetLabel" class="flex items-center gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">目标</span>
          <span class="min-w-0 flex-1 truncate font-mono">{{ violation.targetLabel }}</span>
          <button type="button"
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary"
            title="复制目标构件"
            aria-label="复制目标构件"
            @click="copyText('target', violation.targetLabel)">
            <component :is="copiedField === 'target' ? Check : Copy" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div v-if="accuracyText" class="flex gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">口径</span>
          <span class="min-w-0 text-foreground">{{ accuracyText }}</span>
        </div>
        <div v-if="whereText" class="flex gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">所在</span>
          <span class="min-w-0 font-mono text-foreground">{{ whereText }}</span>
        </div>
        <div v-if="violation.engine === 'bran' && violation.detail" class="flex gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">说明</span>
          <span class="min-w-0 leading-snug text-foreground">{{ violation.detail }}</span>
        </div>
        <div v-if="violation.highlightRefnos.length > 0" class="flex items-center gap-2">
          <span class="w-14 shrink-0 text-[11px] text-muted-foreground">refno</span>
          <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/70">{{ violation.highlightRefnos.join(', ') }}</span>
          <button type="button"
            class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary"
            title="复制全部 refno"
            aria-label="复制全部 refno"
            @click="copyText('refnos', violation.highlightRefnos.join(','))">
            <component :is="copiedField === 'refnos' ? Check : Copy" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5 pt-1">
          <button type="button"
            data-testid="rule-check-detail-focus"
            class="inline-flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            :disabled="violation.highlightRefnos.length === 0"
            @click="emit('focus', violation)">
            <Crosshair class="h-3.5 w-3.5" aria-hidden="true" />
            定位
          </button>
          <button type="button"
            data-testid="rule-check-detail-isolate"
            class="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[12px] hover:bg-muted disabled:opacity-50"
            title="只给这条违规的构件着色，其余透视"
            :disabled="violation.highlightRefnos.length === 0"
            @click="emit('isolate', violation)">
            <ScanEye class="h-3.5 w-3.5" aria-hidden="true" />
            隔离显示
          </button>
          <button type="button"
            data-testid="rule-check-detail-only-rule"
            class="inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 text-[12px] hover:bg-muted"
            @click="emit('onlyRule', violation)">
            <Funnel class="h-3.5 w-3.5" aria-hidden="true" />
            只看本规则
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
