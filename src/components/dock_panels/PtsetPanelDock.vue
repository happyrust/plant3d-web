<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { PtsetResponse } from '@/api/genModelPdmsAttrApi';

import PtsetPanel from '@/components/tools/PtsetPanel.vue';
import { getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { useDbnoInstancesParquetLoader, type ParquetPtsetChildSummary } from '@/composables/useDbnoInstancesParquetLoader';
import { useViewerContext } from '@/composables/useViewerContext';

const props = defineProps<{
  params: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const ctx = useViewerContext();
const parquetLoader = useDbnoInstancesParquetLoader();

const ptsetVis = computed(() => ctx.ptsetVis.value);
const currentRefno = computed(() => ptsetVis.value?.currentRefno.value ?? null);
const contextRefno = computed(() => ptsetVis.value?.panelContextRefno.value ?? currentRefno.value ?? null);
const response = computed(() => ptsetVis.value?.currentResponse.value ?? null);
const isVisible = computed(() => ptsetVis.value?.isVisible.value ?? false);
const showCrosses = computed(() => ptsetVis.value?.showCrosses.value ?? true);
const showLabels = computed(() => ptsetVis.value?.showLabels.value ?? true);
const showArrows = computed(() => ptsetVis.value?.showArrows.value ?? true);

type BranchPtsetItem = {
  refno: string;
  noun: string;
  name: string;
  success: boolean;
  ptCount: number;
  errorMessage?: string | null;
};

const branchItems = ref<BranchPtsetItem[]>([]);
const branchLoading = ref(false);
const branchError = ref<string | null>(null);
const branchSelectedRefno = ref<string | null>(null);
const branchRenderedAll = ref(false);
let branchLoadSeq = 0;

function normalizeRefnoKey(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  return value.replace(/\//g, '_');
}

function resolveDbno(refno: string): number | null {
  try {
    return getDbnumByRefno(refno);
  } catch {
    return null;
  }
}

function buildBranchItem(summary: ParquetPtsetChildSummary): BranchPtsetItem {
  return {
    refno: summary.refno,
    noun: summary.noun,
    name: summary.name,
    success: summary.success,
    ptCount: summary.ptCount,
    errorMessage: summary.errorMessage ?? (summary.success ? null : '未找到 ptset 数据'),
  };
}

async function loadBranchInspector(targetRefno = contextRefno.value) {
  const rootRefno = normalizeRefnoKey(targetRefno);
  const seq = ++branchLoadSeq;
  branchItems.value = [];
  branchSelectedRefno.value = null;
  branchRenderedAll.value = false;
  branchError.value = null;

  if (!rootRefno) {
    branchLoading.value = false;
    return;
  }

  branchLoading.value = true;
  try {
    const dbno = resolveDbno(rootRefno);
    if (dbno == null) {
      branchError.value = `无法从 refno=${rootRefno} 解析 dbno`;
      return;
    }

    const summaries = await parquetLoader.queryDirectChildrenPtsetSummary(dbno, rootRefno);
    if (seq !== branchLoadSeq) return;
    branchItems.value = summaries.map(buildBranchItem);
  } catch (error) {
    if (seq !== branchLoadSeq) return;
    branchError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (seq === branchLoadSeq) {
      branchLoading.value = false;
    }
  }
}

async function renderBranchChild(refno: string) {
  const normalized = normalizeRefnoKey(refno);
  if (!normalized || !ptsetVis.value) return;

  const dbno = resolveDbno(normalized);
  if (dbno == null) {
    branchError.value = `无法从 refno=${normalized} 解析 dbno`;
    return;
  }

  const resp = await parquetLoader.queryPtsetByRefnoFromParquet(dbno, normalized);
  if (!resp.success || resp.ptset.length === 0) {
    branchError.value = resp.error_message || `未找到 ${normalized} 的点集数据`;
    branchRenderedAll.value = false;
    return;
  }

  ptsetVis.value.setPanelContext(contextRefno.value ?? normalized);
  ptsetVis.value.renderPtset(normalized, resp);
  ptsetVis.value.flyToPtset();
  branchSelectedRefno.value = normalized;
  branchRenderedAll.value = false;
  branchError.value = null;
}

async function renderAllBranchChildren() {
  if (!ptsetVis.value) return;

  const successItems = branchItems.value.filter((item) => item.success && item.ptCount > 0);
  if (successItems.length === 0) {
    branchError.value = '当前 BRAN 直子元件没有可绘制的 ptset';
    return;
  }

  const loaded: { refno: string; response: PtsetResponse }[] = [];
  for (const item of successItems) {
    const dbno = resolveDbno(item.refno);
    if (dbno == null) continue;
    const resp = await parquetLoader.queryPtsetByRefnoFromParquet(dbno, item.refno);
    if (resp.success && resp.ptset.length > 0) {
      loaded.push({ refno: item.refno, response: resp });
    }
  }

  if (loaded.length === 0) {
    branchError.value = '批量绘制时未取回任何有效 ptset';
    return;
  }

  ptsetVis.value.setPanelContext(contextRefno.value ?? loaded[0].refno);
  ptsetVis.value.renderPtset(loaded[0].refno, loaded[0].response);
  for (const item of loaded.slice(1)) {
    ptsetVis.value.appendPtset(item.refno, item.response, { setCurrent: false });
  }
  ptsetVis.value.flyToPtset();
  branchSelectedRefno.value = loaded[0].refno;
  branchRenderedAll.value = loaded.length > 1;
  branchError.value = null;
}

watch(
  contextRefno,
  (value) => {
    void loadBranchInspector(value);
  },
  { immediate: true },
);

function closePanel() {
  ptsetVis.value?.clearAll();
  try {
    (props.params.api as any)?.close?.();
  } catch {
    // ignore
  }
}
</script>

<template>
  <div class="h-full w-full overflow-auto p-2">
    <PtsetPanel v-if="ptsetVis"
      :context-refno="contextRefno"
      :current-refno="currentRefno"
      :response="response"
      :is-visible="isVisible"
      :show-crosses="showCrosses"
      :show-labels="showLabels"
      :show-arrows="showArrows"
      :branch-items="branchItems"
      :branch-loading="branchLoading"
      :branch-error="branchError"
      :branch-selected-refno="branchSelectedRefno"
      :branch-rendered-all="branchRenderedAll"
      @close="closePanel"
      @toggle-visible="ptsetVis.setVisible"
      @toggle-crosses="ptsetVis.setCrossesVisible"
      @toggle-labels="ptsetVis.setLabelsVisible"
      @toggle-arrows="ptsetVis.setArrowsVisible"
      @refresh-branch="loadBranchInspector"
      @render-branch-child="renderBranchChild"
      @render-branch-all="renderAllBranchChildren"
      @fly-to="ptsetVis.flyToPtset" />
    <div v-else class="text-muted-foreground p-4">等待 Viewer 初始化...</div>
  </div>
</template>

