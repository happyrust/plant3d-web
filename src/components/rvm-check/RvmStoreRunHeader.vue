<script setup lang="ts">
/**
 * 一次运行（一个整根，或一个 ZONE 单元）的结论横幅：终态、那句结论、计数、各阶段耗时和生成峰值。
 * 没跑完的把停在哪一类、原始报错摆出来；产物目录和生成侧账本收在下面。
 */
import { computed } from 'vue';

import { bannerCounts, formatAt, stageLabel, verdictTone } from './rvmCheckFormat';
import RvmStatusIcon from './RvmStatusIcon.vue';
import {
  elementName,
  failureClassOfStatus,
  FAILURE_CLASSES,
  formatPeakMb,
  formatSeconds,
  ledgerEntries,
  runStatusKey,
  storeStatusInfo,
  sumSeconds,
  unitKindHint,
  unitKindLabel,
  UNNAMED,
} from './rvmStoreFormat';

import type { RvmStoreRun } from '@/api/rvmCheckStoreApi';

const props = defineProps<{ run: RvmStoreRun }>();

const status = computed(() => storeStatusInfo(runStatusKey(props.run)));
const tone = computed(() => verdictTone(status.value.tone));
const failure = computed(() => {
  const kind = failureClassOfStatus(status.value.status);
  return kind ? FAILURE_CLASSES[kind] : null;
});
const counts = computed(() => bannerCounts(props.run.counts));
const ledger = computed(() => ledgerEntries(props.run.gen_ledger));

const facts = computed(() => {
  const run = props.run;
  const seconds = run.seconds;
  return [
    { label: '库', value: run.dbnum != null ? String(run.dbnum) : '' },
    { label: '来源', value: run.source === 'page' ? '页面单根' : run.batch_id ? `批次 ${run.batch_id}` : '批量' },
    { label: '完成', value: run.finished_at ? formatAt(run.finished_at) : '' },
    { label: '停在', value: run.stage ? stageLabel(run.stage) : '' },
    { label: '用时', value: sumSeconds(seconds) > 0 ? formatSeconds(sumSeconds(seconds)) : '' },
    { label: '生成', value: seconds?.generate ? formatSeconds(seconds.generate) : '' },
    { label: 'E3D 导出', value: seconds?.e3d_export ? formatSeconds(seconds.e3d_export) : '' },
    { label: '比对', value: seconds?.compare ? formatSeconds(seconds.compare) : '' },
    { label: '生成峰值内存', value: run.gen_peak_private_mb ? formatPeakMb(run.gen_peak_private_mb) : '' },
    { label: '会话', value: run.sesno != null ? String(run.sesno) : '' },
    { label: '基准导出方式', value: run.e3d_export_by ?? '' },
  ].filter((item) => item.value);
});
</script>

<template>
  <header class="flex flex-col gap-2" data-testid="rvm-store-run-header">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border px-3 py-2" :class="tone.banner" data-testid="rvm-store-run-banner">
      <span class="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full" :class="tone.iconBg">
        <RvmStatusIcon :verdict="status.tone" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <h2 class="text-sm font-semibold" :title="status.hint" data-testid="rvm-store-run-status">{{ status.label }}</h2>
          <span class="text-[11px] opacity-80">{{ run.noun }}</span>
          <span class="break-all text-xs font-medium">{{ elementName(run.name, run.noun) ?? UNNAMED }}</span>
          <span class="font-mono text-[11px] opacity-80">{{ run.refno }}</span>
          <span class="rounded border border-current px-1 text-[10px] leading-4 opacity-70" :title="unitKindHint(run.unit)">{{ unitKindLabel(run.unit) }}</span>
        </div>
        <p v-if="run.message && !failure" class="break-all text-[11px] opacity-90" data-testid="rvm-store-run-message">{{ run.message }}</p>
      </div>
      <dl v-if="counts.length" class="flex shrink-0 flex-wrap items-end gap-x-4 gap-y-1" data-testid="rvm-store-run-counts">
        <div v-for="item in counts" :key="item.label" class="flex flex-col items-end leading-tight">
          <dd class="font-mono text-base font-semibold">{{ item.value.toLocaleString('zh-CN') }}</dd>
          <dt class="text-[10px] opacity-80">{{ item.label }}</dt>
        </div>
      </dl>
      <div v-if="failure" class="basis-full rounded border border-stone-300 bg-background/70 px-2 py-1.5 text-[11px] text-stone-800" data-testid="rvm-store-run-failure">
        <span class="font-semibold">{{ failure.label }}</span>
        <span class="ml-1">{{ failure.hint }}</span>
        <span class="mt-1 block whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed">{{ run.message || '库里没有留下报错文本' }}</span>
      </div>
    </div>

    <dl class="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]" data-testid="rvm-store-run-facts">
      <div v-for="item in facts" :key="item.label" class="flex items-baseline gap-1">
        <dt class="text-muted-foreground">{{ item.label }}</dt>
        <dd class="font-mono">{{ item.value }}</dd>
      </div>
    </dl>

    <details v-if="run.artifact_dir || ledger.length" class="rounded border border-border px-2 py-1 text-[11px]" data-testid="rvm-store-run-more">
      <summary class="cursor-pointer select-none text-muted-foreground">产物目录与生成侧账本</summary>
      <dl class="mt-1 flex flex-col gap-1">
        <div v-if="run.artifact_dir">
          <dt class="text-[10px] text-muted-foreground">产物目录（在跑这一批的那台机器上）</dt>
          <dd class="break-all font-mono text-[10.5px]">{{ run.artifact_dir }}</dd>
        </div>
        <div v-if="run.files?.length">
          <dt class="text-[10px] text-muted-foreground">文件</dt>
          <dd class="break-all font-mono text-[10.5px]">{{ run.files.join('、') }}</dd>
        </div>
        <div v-if="ledger.length">
          <dt class="text-[10px] text-muted-foreground">生成侧账本（只列非零的格；解释生成侧为什么没有某一件）</dt>
          <dd class="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
            <span v-for="entry in ledger" :key="entry.key" :title="entry.detail ? `${entry.key}：${entry.detail}` : entry.key">
              {{ entry.label }} {{ entry.value.toLocaleString('zh-CN') }}<template v-if="entry.detail">（{{ entry.detail }}）</template>
            </span>
          </dd>
        </div>
      </dl>
    </details>
  </header>
</template>
