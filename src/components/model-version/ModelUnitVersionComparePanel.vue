<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { GitCompare, RefreshCw, X } from 'lucide-vue-next';

import {
  listModelUnitCommits,
  type ModelUnitCommitData,
} from '@/api/modelUnitVersionApi';
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import {
  compareModelUnitGeometry,
  formatModelUnitVersionTime,
  geometrySnapshotsFromInstanceEntries,
  MODEL_UNIT_VERSION_COMPARE_EVENT,
  orderModelUnitVersionPair,
  type ModelUnitGeometryDiff,
  type ModelUnitGeometryStatus,
  type ModelUnitVersionCompareEventDetail,
} from '@/utils/modelUnitVersionCompare';

const ROOT_NOUNS = new Set(['BRAN', 'HANG', 'EQUI', 'WALL', 'FLOOR']);

const unitRefno = ref(new URLSearchParams(window.location.search).get('unit_refno') || '');
const dbnum = ref<number | null>(null);
const versions = ref<ModelUnitCommitData[]>([]);
const beforeSesno = ref<number | null>(null);
const afterSesno = ref<number | null>(null);
const loadingVersions = ref(false);
const comparing = ref(false);
const error = ref<string | null>(null);
const rows = ref<ModelUnitGeometryDiff[]>([]);
const statusFilter = ref<'all' | Exclude<ModelUnitGeometryStatus, 'unchanged'>>('all');
const includeUnchanged = ref(false);
const compareActive = ref(false);
const compareCompleted = ref(false);
let requestId = 0;

const normalizedRefno = computed(() => unitRefno.value.trim().replace(/\//g, '_'));
const selectedBefore = computed(() => versions.value.find((item) => item.commit.sesno === beforeSesno.value) ?? null);
const selectedAfter = computed(() => versions.value.find((item) => item.commit.sesno === afterSesno.value) ?? null);
const sameArtifact = computed(() => selectedBefore.value?.commit.artifact_sesno === selectedAfter.value?.commit.artifact_sesno);

const summary = computed(() => {
  const counts: Record<ModelUnitGeometryStatus, number> = { added: 0, deleted: 0, modified: 0, unchanged: 0 };
  for (const row of rows.value) counts[row.status] += 1;
  return counts;
});
const noGeometryDifference = computed(() => compareCompleted.value
  && summary.value.added === 0
  && summary.value.deleted === 0
  && summary.value.modified === 0);

const visibleRows = computed(() => rows.value.filter((row) => {
  if (!includeUnchanged.value && row.status === 'unchanged') return false;
  return statusFilter.value === 'all' || row.status === statusFilter.value;
}));

function dispatch(detail: ModelUnitVersionCompareEventDetail): void {
  window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_EVENT, { detail }));
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function versionLabel(item: ModelUnitCommitData): string {
  const reused = item.commit.artifact_sesno !== item.commit.sesno
    ? ` · 复用 ${item.commit.artifact_sesno}`
    : '';
  return `${item.commit.sesno} · ${formatModelUnitVersionTime(item.commit.generated_at)} · ${item.commit.impact_kind}${reused}`;
}

async function loadVersions(): Promise<void> {
  closeCompare();
  const run = ++requestId;
  error.value = null;
  rows.value = [];
  versions.value = [];
  dbnum.value = null;
  beforeSesno.value = null;
  afterSesno.value = null;
  compareCompleted.value = false;
  const refno = normalizedRefno.value;
  if (!/^\d+_\d+$/.test(refno)) {
    error.value = '请输入最小交付单元根参考号，例如 24381_145018';
    return;
  }
  loadingVersions.value = true;
  try {
    await ensureDbMetaInfoLoaded();
    const resolvedDbnum = getDbnumByRefno(refno);
    const result = await listModelUnitCommits(resolvedDbnum, refno);
    if (run !== requestId) return;
    if (result.length < 2) throw new Error('该最小交付单元至少需要两个模型提交才能对比');
    const noun = String(result[0]?.commit.unit_noun || '').toUpperCase();
    if (!ROOT_NOUNS.has(noun)) throw new Error(`参考号不是支持的最小交付单元根：${noun || 'UNKNOWN'}`);
    dbnum.value = resolvedDbnum;
    versions.value = result;
    beforeSesno.value = result.at(-2)?.commit.sesno ?? null;
    afterSesno.value = result.at(-1)?.commit.sesno ?? null;
  } catch (cause) {
    if (run === requestId) {
      versions.value = [];
      dbnum.value = null;
      error.value = messageOf(cause);
    }
  } finally {
    if (run === requestId) loadingVersions.value = false;
  }
}

function normalizeSelectedPair(): void {
  const first = selectedBefore.value;
  const second = selectedAfter.value;
  if (!first || !second || first.commit.sesno === second.commit.sesno) return;
  const [before, after] = orderModelUnitVersionPair(first, second);
  beforeSesno.value = before.commit.sesno;
  afterSesno.value = after.commit.sesno;
}

async function snapshotsFor(version: ModelUnitCommitData) {
  if (dbnum.value === null || version.manifest_url === null) return [];
  const parquet = useDbnoInstancesParquetLoader();
  const refnos = await parquet.queryAllRefnosByDbno(dbnum.value, { manifestUrl: version.manifest_url });
  const entries = await parquet.queryInstanceEntriesByRefnos(dbnum.value, refnos, {
    manifestUrl: version.manifest_url,
    includeOwnedTubings: false,
  });
  return geometrySnapshotsFromInstanceEntries(entries);
}

async function runCompare(): Promise<void> {
  closeCompare();
  rows.value = [];
  compareCompleted.value = false;
  normalizeSelectedPair();
  const before = selectedBefore.value;
  const after = selectedAfter.value;
  if (dbnum.value === null || !before || !after || before.commit.sesno >= after.commit.sesno) {
    error.value = '请选择两个不同版本，A 必须早于 B';
    return;
  }

  const run = ++requestId;
  comparing.value = true;
  error.value = null;
  try {
    const sameArtifact = before.commit.artifact_sesno === after.commit.artifact_sesno;
    const [beforeSnapshots, afterSnapshots] = sameArtifact
      ? await snapshotsFor(after).then((snapshots) => [snapshots, snapshots] as const)
      : await Promise.all([snapshotsFor(before), snapshotsFor(after)]);
    if (run !== requestId) return;
    rows.value = compareModelUnitGeometry(beforeSnapshots, afterSnapshots);
    compareCompleted.value = true;
    compareActive.value = true;
    dispatch({
      action: 'open',
      dbnum: dbnum.value,
      unitRefno: normalizedRefno.value,
      before: {
        sesno: before.commit.sesno,
        artifactSesno: before.commit.artifact_sesno,
        manifestUrl: before.manifest_url,
        generatedAt: before.commit.generated_at,
      },
      after: {
        sesno: after.commit.sesno,
        artifactSesno: after.commit.artifact_sesno,
        manifestUrl: after.manifest_url,
        generatedAt: after.commit.generated_at,
      },
      refnos: rows.value.map((row) => row.refno),
      rows: rows.value,
    });
  } catch (cause) {
    if (run === requestId) error.value = messageOf(cause);
  } finally {
    if (run === requestId) comparing.value = false;
  }
}

function focusRow(refno: string): void {
  dispatch({ action: 'focus', refno });
}

function closeCompare(): void {
  if (compareActive.value) dispatch({ action: 'close' });
  compareActive.value = false;
}

function handleCompareLifecycle(event: Event): void {
  const detail = (event as CustomEvent<ModelUnitVersionCompareEventDetail>).detail;
  if (detail?.action === 'close') compareActive.value = false;
}

onMounted(() => window.addEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleCompareLifecycle));
onBeforeUnmount(() => {
  requestId += 1;
  closeCompare();
  window.removeEventListener(MODEL_UNIT_VERSION_COMPARE_EVENT, handleCompareLifecycle);
});
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background" data-testid="model-unit-version-compare-panel">
    <header class="border-b border-border px-3 py-3">
      <div class="flex items-center gap-2">
        <GitCompare class="h-4 w-4 text-primary" />
        <div>
          <h2 class="text-sm font-semibold text-foreground">模型版本对比</h2>
          <p class="text-[11px] text-muted-foreground">按最小交付单元 sesno 对比</p>
        </div>
      </div>

      <form class="mt-3 flex gap-2" @submit.prevent="loadVersions">
        <input v-model="unitRefno"
          class="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          data-testid="model-unit-compare-refno"
          placeholder="根参考号，例如 24381_145018"
          autocomplete="off" />
        <button type="submit"
          class="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          data-testid="model-unit-compare-load"
          :disabled="loadingVersions">
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loadingVersions }" />
          查询
        </button>
      </form>
      <p v-if="dbnum !== null" class="mt-1.5 text-[11px] text-muted-foreground">DB {{ dbnum }} · {{ normalizedRefno }}</p>
    </header>

    <div class="min-h-0 flex-1 overflow-auto p-3">
      <div v-if="error" class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="model-unit-compare-error">
        {{ error }}
      </div>

      <template v-if="versions.length >= 2">
        <div class="grid grid-cols-2 gap-2">
          <label class="space-y-1 text-[11px] text-muted-foreground">
            <span class="font-semibold text-blue-600">A · 较早版本</span>
            <select v-model.number="beforeSesno"
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
              data-testid="model-unit-compare-a"
              @change="normalizeSelectedPair">
              <option v-for="item in versions" :key="item.commit.sesno" :value="item.commit.sesno">{{ versionLabel(item) }}</option>
            </select>
          </label>
          <label class="space-y-1 text-[11px] text-muted-foreground">
            <span class="font-semibold text-emerald-600">B · 较新版本</span>
            <select v-model.number="afterSesno"
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
              data-testid="model-unit-compare-b"
              @change="normalizeSelectedPair">
              <option v-for="item in versions" :key="item.commit.sesno" :value="item.commit.sesno">{{ versionLabel(item) }}</option>
            </select>
          </label>
        </div>

        <div class="mt-3 flex gap-2">
          <button class="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
            data-testid="model-unit-compare-run"
            :disabled="comparing || loadingVersions"
            @click="runCompare">
            {{ comparing ? '正在比较…' : '在三维中对比' }}
          </button>
          <button v-if="compareActive"
            class="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-2 text-xs text-foreground"
            data-testid="model-unit-compare-close"
            @click="closeCompare">
            <X class="h-3.5 w-3.5" />退出
          </button>
        </div>
      </template>

      <template v-if="compareCompleted">
        <div class="mt-3 rounded-md border border-border bg-muted/20 p-2" data-testid="model-unit-compare-summary">
          <div class="flex flex-wrap gap-1.5 text-[11px]">
            <span class="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">新增 {{ summary.added }}</span>
            <span class="rounded bg-rose-100 px-1.5 py-0.5 text-rose-700">删除 {{ summary.deleted }}</span>
            <span class="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">修改 {{ summary.modified }}</span>
            <span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">未变 {{ summary.unchanged }}</span>
          </div>
          <p v-if="noGeometryDifference" class="mt-2 text-xs font-medium text-emerald-700" data-testid="model-unit-compare-noop">
            无几何差异<span v-if="sameArtifact">；A/B 复用 artifact_sesno {{ selectedAfter?.commit.artifact_sesno }}</span>
          </p>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-1" data-testid="model-unit-compare-filters">
          <button v-for="filter in ['all', 'added', 'deleted', 'modified'] as const"
            :key="filter"
            class="rounded border px-2 py-1 text-[11px]"
            :class="statusFilter === filter ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'"
            @click="statusFilter = filter">
            {{ { all: '全部差异', added: '新增', deleted: '删除', modified: '修改' }[filter] }}
          </button>
          <label class="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <input v-model="includeUnchanged" type="checkbox" />包含未变化
          </label>
        </div>

        <div class="mt-2 space-y-1" data-testid="model-unit-compare-list">
          <button v-for="row in visibleRows"
            :key="row.refno"
            class="flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-xs hover:bg-muted/50"
            @click="focusRow(row.refno)">
            <span class="rounded px-1.5 py-0.5 text-[10px]"
              :class="{
                'bg-emerald-100 text-emerald-700': row.status === 'added',
                'bg-rose-100 text-rose-700': row.status === 'deleted',
                'bg-amber-100 text-amber-700': row.status === 'modified',
                'bg-slate-100 text-slate-600': row.status === 'unchanged',
              }">
              {{ { added: '新增', deleted: '删除', modified: '修改', unchanged: '未变' }[row.status] }}
            </span>
            <span class="min-w-0 flex-1 truncate font-mono">{{ row.refno }}</span>
            <span class="text-[10px] text-muted-foreground">{{ row.noun }}</span>
          </button>
          <p v-if="visibleRows.length === 0" class="py-4 text-center text-xs text-muted-foreground">当前筛选没有差异项</p>
        </div>
      </template>
    </div>
  </section>
</template>
