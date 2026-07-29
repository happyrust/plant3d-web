<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Database, ExternalLink, Eye } from 'lucide-vue-next';

import { ensurePanelAndActivate } from '@/composables/useDockApi';

const props = withDefaults(defineProps<{
  disableFrameNavigation?: boolean;
}>(), {
  disableFrameNavigation: false,
});

type DiffRow = {
  change_type?: string;
  component_key?: string;
  dbnum?: number;
  noun?: string;
  refno_str?: string;
  refno_u64?: number;
  old_component_hash?: string | null;
  new_component_hash?: string | null;
};

type DiffSummary = {
  added?: number;
  changed?: number;
  deleted?: number;
  unchanged?: number;
  emitted?: number;
  total_old?: number;
  total_new?: number;
};

const showDetails = ref(false);
const provenance = ref<{
  label: string;
  title: string;
  fromSesno: number | null;
  toSesno: number | null;
  classification: string | null;
  productionReady: boolean;
} | null>(null);
const diffRows = ref<DiffRow[]>([]);
const diffSummary = ref<DiffSummary | null>(null);
const diffLoading = ref(false);
const diffError = ref<string | null>(null);
const selectedRefno = ref<string | null>(null);
const lastDispatchedRefno = ref<string | null>(null);
let provenanceRequestId = 0;
let diffRequestId = 0;

const AMS_DB1112_COMPARE_DEFAULTS = {
  project: 'AvevaMarineSample',
  dbnum: '1112',
  from_release_id: 'codex-ams1112-physical-791-quarantine',
  to_release_id: 'codex-ams1112-physical-897-quarantine',
} as const;

function hasComponentScope(params: URLSearchParams) {
  return Boolean(params.get('component_key') || (params.get('dbnum') && params.get('refno_u64')));
}

const compareSrc = computed(() => {
  const params = new URLSearchParams();
  const current = new URLSearchParams(window.location.search);
  const project = current.get('project') || current.get('output_project') || AMS_DB1112_COMPARE_DEFAULTS.project;
  if (project) params.set('project', project);
  for (const key of [
    'project',
    'from_release_id',
    'to_release_id',
    'from',
    'to',
    'diff_limit',
    'change_type',
    'component_key',
    'refno_u64',
    'dbnum',
  ]) {
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  if (params.get('project') === AMS_DB1112_COMPARE_DEFAULTS.project) {
    for (const [key, value] of Object.entries(AMS_DB1112_COMPARE_DEFAULTS)) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  if (!params.has('change_type')) params.set('change_type', 'changed');
  if (!params.has('diff_limit')) params.set('diff_limit', hasComponentScope(params) ? '20' : '10');
  return `/model-version/compare?${params.toString()}`;
});

const activeParams = computed(() => new URLSearchParams(compareSrc.value.split('?', 2)[1] ?? ''));

const projectDbLabel = computed(() => {
  const params = activeParams.value;
  const project = params.get('project') || 'Project';
  const dbnum = params.get('dbnum') || AMS_DB1112_COMPARE_DEFAULTS.dbnum;
  return `${project} DB${dbnum}`;
});

function sesnoFromReleaseId(releaseId: string | null) {
  if (!releaseId) return null;
  return releaseId.match(/physical-(\d+)/)?.[1] ?? null;
}

const releasePairLabel = computed(() => {
  const params = activeParams.value;
  const fromSesno = provenance.value?.fromSesno ?? sesnoFromReleaseId(params.get('from_release_id') || params.get('from'));
  const toSesno = provenance.value?.toSesno ?? sesnoFromReleaseId(params.get('to_release_id') || params.get('to'));
  return fromSesno && toSesno ? `${fromSesno} -> ${toSesno}` : 'from -> to';
});

const componentScopeLabel = computed(() => {
  const params = activeParams.value;
  const refno = selectedRefno.value || params.get('refno_u64');
  if (refno) return `参考号 ${refno}`;
  if (hasComponentScope(params)) return '当前参考号';
  return '首个变化参考号';
});

const componentScopeTitle = computed(() => {
  const params = activeParams.value;
  return params.get('component_key') || params.get('refno_u64') || selectedRefno.value || componentScopeLabel.value;
});

const dataStatusLabel = computed(() => {
  if (!provenance.value) return null;
  return provenance.value.productionReady ? '生产' : '诊断';
});

const dataStatusTitle = computed(() => {
  if (!provenance.value) return '';
  const classification = provenance.value.classification || 'unknown';
  return provenance.value.productionReady
    ? `production_ready: ${classification}`
    : `not production_ready: ${classification}`;
});

const summaryLabel = computed(() => {
  const summary = diffSummary.value;
  if (!summary) return '读取真实 diff 中';
  return [
    `变更 ${summary.changed ?? 0}`,
    `新增 ${summary.added ?? 0}`,
    `删除 ${summary.deleted ?? 0}`,
  ].join(' / ');
});

const selectedRow = computed(() => {
  const selected = selectedRefno.value;
  if (!selected) return diffRows.value[0] ?? null;
  return diffRows.value.find((row) => rowRefno(row) === selected) ?? diffRows.value[0] ?? null;
});

function fileUrl(path: string) {
  return `/files/${path.replaceAll('\\', '/')}`;
}

function sourceTail(path: string) {
  const parts = path.replace(/^\\\\\?\\/, '').replaceAll('\\', '/').split('/').filter(Boolean);
  const projectIndex = parts.findIndex((part) => part.toLowerCase() === 'avevamarinesample');
  return (projectIndex >= 0 ? parts.slice(projectIndex + 1) : parts.slice(-2)).join('\\');
}

async function baselineSource(path: unknown) {
  if (typeof path !== 'string' || !path) return null;
  const response = await fetch(fileUrl(path));
  if (!response.ok) return null;
  const manifest = await response.json() as { source_db_file?: unknown; source_db_latest_sesno?: unknown };
  if (typeof manifest.source_db_file !== 'string') return null;
  return {
    path: manifest.source_db_file,
    sesno: typeof manifest.source_db_latest_sesno === 'number' ? manifest.source_db_latest_sesno : null,
  };
}

async function loadProvenance() {
  const requestId = ++provenanceRequestId;
  provenance.value = null;

  const params = activeParams.value;
  const project = params.get('project');
  const fromRelease = params.get('from_release_id') || params.get('from');
  const toRelease = params.get('to_release_id') || params.get('to');
  if (!project || !fromRelease || !toRelease) return;

  try {
    const readinessParams = new URLSearchParams({
      project,
      from_release_id: fromRelease,
      to_release_id: toRelease,
    });
    const response = await fetch(`/api/model-version/compare-readiness?${readinessParams.toString()}`);
    if (!response.ok) return;
    const payload = await response.json();
    const readiness = payload?.data?.readiness;
    const [fromSource, toSource] = await Promise.all([
      baselineSource(readiness?.from?.baseline_state_manifest_path),
      baselineSource(readiness?.to?.baseline_state_manifest_path),
    ]);
    if (requestId !== provenanceRequestId || (!fromSource && !toSource)) return;

    const dbnum = readiness?.dbnum ?? params.get('dbnum') ?? '';
    const format = (source: typeof fromSource, fallback: string) =>
      source ? `${source.sesno ?? fallback}=${sourceTail(source.path)}` : `${fallback}=unknown`;
    provenance.value = {
      label: `${project} DB${dbnum} real sources: ${format(fromSource, 'from')}, ${format(toSource, 'to')}`,
      title: [
        fromSource ? `From source: ${fromSource.path}` : 'From source: unknown',
        toSource ? `To source: ${toSource.path}` : 'To source: unknown',
      ].join('\n'),
      fromSesno: fromSource?.sesno ?? null,
      toSesno: toSource?.sesno ?? null,
      classification: typeof readiness?.classification === 'string' ? readiness.classification : null,
      productionReady: readiness?.production_ready === true,
    };
  } catch {
    if (requestId === provenanceRequestId) provenance.value = null;
  }
}

function rowRefno(row: DiffRow | null | undefined) {
  if (!row) return '';
  if (row.refno_str) return String(row.refno_str).replace(/\//g, '_');
  if (row.component_key) return String(row.component_key).split(':').pop() || '';
  return '';
}

function rowStatus(row: DiffRow) {
  if (row.change_type === 'changed') return 'modified';
  return row.change_type || 'modified';
}

function rowBeforeState(row: DiffRow) {
  return row.change_type === 'added' ? 'missing' : 'present';
}

function rowAfterState(row: DiffRow) {
  return row.change_type === 'deleted' ? 'missing' : 'present';
}

function emitDtxCompare(row: DiffRow | null = selectedRow.value) {
  const refno = rowRefno(row);
  if (!refno) return;
  selectedRefno.value = refno;
  lastDispatchedRefno.value = refno;
  if (props.disableFrameNavigation) return;
  ensurePanelAndActivate('viewer');

  const params = activeParams.value;
  const detail = {
    project: params.get('project') || AMS_DB1112_COMPARE_DEFAULTS.project,
    dbnum: Number(params.get('dbnum') || row?.dbnum || AMS_DB1112_COMPARE_DEFAULTS.dbnum),
    fromReleaseId: params.get('from_release_id') || params.get('from') || AMS_DB1112_COMPARE_DEFAULTS.from_release_id,
    toReleaseId: params.get('to_release_id') || params.get('to') || AMS_DB1112_COMPARE_DEFAULTS.to_release_id,
    fromSesno: Number(provenance.value?.fromSesno ?? sesnoFromReleaseId(params.get('from_release_id') || params.get('from')) ?? 0),
    toSesno: Number(provenance.value?.toSesno ?? sesnoFromReleaseId(params.get('to_release_id') || params.get('to')) ?? 0),
    mode: 'dtx',
    compare: true,
    componentKey: row?.component_key || params.get('component_key') || '',
    refnos: [refno],
    models: diffRows.value.map((item) => ({
      refno: rowRefno(item),
      componentKey: item.component_key || '',
      refnoU64: item.refno_u64,
      category: item.noun || '',
      status: rowStatus(item),
      beforeState: rowBeforeState(item),
      afterState: rowAfterState(item),
      sourceChangeCount: 1,
      sourceNouns: item.noun || '',
    })).filter((item) => item.refno),
  };
  window.dispatchEvent(new CustomEvent('plant3d:incremental-version-compare', { detail }));
}

async function loadDiff() {
  const requestId = ++diffRequestId;
  diffRows.value = [];
  diffSummary.value = null;
  diffError.value = null;
  diffLoading.value = true;
  selectedRefno.value = null;
  lastDispatchedRefno.value = null;

  const params = activeParams.value;
  const project = params.get('project');
  const fromRelease = params.get('from_release_id') || params.get('from');
  const toRelease = params.get('to_release_id') || params.get('to');
  if (!project || !fromRelease || !toRelease) {
    diffLoading.value = false;
    return;
  }

  try {
    const diffParams = new URLSearchParams({
      project,
      from_release_id: fromRelease,
      to_release_id: toRelease,
      limit: params.get('diff_limit') || '10',
    });
    const componentKey = params.get('component_key');
    if (componentKey) {
      diffParams.set('component_key', componentKey);
    }
    diffParams.set('change_type', params.get('change_type') || 'changed');

    const response = await fetch(`/api/model-version/diff?${diffParams.toString()}`);
    const payload = await response.json();
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.message || 'diff failed');
    }
    if (requestId !== diffRequestId) return;

    const diff = payload?.data?.diff;
    const rows = Array.isArray(diff?.rows) ? diff.rows as DiffRow[] : [];
    const selectedComponent = params.get('component_key');
    const selectedU64 = params.get('refno_u64');
    const scopedRows = rows.filter((row) => (
      (selectedComponent && row.component_key === selectedComponent)
      || (selectedU64 && String(row.refno_u64 || '') === selectedU64)
    ));
    diffRows.value = scopedRows.length > 0 ? scopedRows : rows;
    diffSummary.value = diff?.summary ?? null;

    const preferred = diffRows.value[0] ?? null;
    if (preferred) emitDtxCompare(preferred);
  } catch (error) {
    if (requestId === diffRequestId) {
      diffError.value = error instanceof Error ? error.message : String(error);
    }
  } finally {
    if (requestId === diffRequestId) diffLoading.value = false;
  }
}

watch(compareSrc, () => {
  void loadProvenance();
  void loadDiff();
}, { immediate: true });

function openDiagnosticWindow() {
  window.open(compareSrc.value, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background" data-testid="model-version-compare-panel">
    <div class="shrink-0 border-b border-border bg-background">
      <div class="flex items-center justify-between gap-2 px-3 py-2">
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <div class="truncate text-sm font-semibold text-foreground">模型版本对比</div>
            <span class="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
              {{ projectDbLabel }}
            </span>
            <button v-if="dataStatusLabel"
              type="button"
              class="shrink-0 rounded border px-1.5 py-0.5 text-[11px] leading-4 transition-colors hover:bg-muted"
              :class="provenance?.productionReady ? 'border-success bg-success-subtle text-success' : 'border-warning bg-warning-subtle text-warning'"
              :title="dataStatusTitle"
              :aria-expanded="showDetails"
              data-testid="model-version-compare-data-status"
              @click="showDetails = !showDetails">
              {{ dataStatusLabel }}
            </button>
          </div>
          <div class="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span class="shrink-0 font-medium text-foreground">{{ releasePairLabel }}</span>
            <span aria-hidden="true" class="text-border">/</span>
            <span class="truncate" :title="componentScopeTitle">{{ componentScopeLabel }}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button type="button"
            class="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-foreground transition-colors hover:bg-primary/90"
            :disabled="!selectedRow"
            data-testid="model-version-compare-show-dtx"
            title="在三维视图显示"
            @click="emitDtxCompare()">
            <Eye class="h-3.5 w-3.5" />
            DTX
          </button>
          <button type="button"
            class="inline-flex h-7 w-7 items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="打开诊断页"
            data-testid="model-version-compare-open-diagnostic"
            @click="openDiagnosticWindow">
            <ExternalLink class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div v-if="showDetails"
        class="border-t border-border px-3 py-2 text-[11px] leading-5 text-muted-foreground"
        data-testid="model-version-compare-details">
        <div v-if="provenance"
          class="flex min-w-0 items-center gap-1"
          data-testid="model-version-compare-provenance"
          :title="provenance.title">
          <Database class="h-3 w-3 shrink-0" />
          <span class="truncate">{{ provenance.label }}</span>
        </div>
        <div v-else class="text-muted-foreground">来源校验中</div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-3 py-3">
      <div class="rounded-md border border-border bg-muted/20 p-3" data-testid="model-version-compare-dtx-summary">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-medium text-foreground">使用主三维 DTX 视图</div>
            <div class="mt-1 truncate text-xs text-muted-foreground">
              {{ summaryLabel }}
            </div>
          </div>
          <div class="shrink-0 rounded bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
            {{ lastDispatchedRefno || selectedRefno || '-' }}
          </div>
        </div>
        <div class="mt-2 text-xs leading-5 text-muted-foreground">
          版本差异来自 AMS DB1112 的真实 release diff；模型显示交给当前 ViewerPanel 的 DTX loader。
        </div>
      </div>

      <div v-if="diffLoading" class="mt-3 text-xs text-muted-foreground" data-testid="model-version-compare-loading">
        正在读取真实 diff
      </div>
      <div v-else-if="diffError" class="mt-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive" data-testid="model-version-compare-error">
        {{ diffError }}
      </div>
      <div v-else class="mt-3 space-y-1" data-testid="model-version-compare-diff-list">
        <button v-for="row in diffRows.slice(0, 8)"
          :key="row.component_key || row.refno_str"
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted"
          :class="rowRefno(row) === selectedRefno ? 'border-primary/50 bg-primary/5' : 'border-border bg-background'"
          @click="emitDtxCompare(row)">
          <span class="min-w-0 truncate">
            <span class="font-mono">{{ rowRefno(row) }}</span>
            <span class="ml-2 text-muted-foreground">{{ row.noun || '-' }}</span>
          </span>
          <span class="shrink-0 text-muted-foreground">{{ row.change_type || 'changed' }}</span>
        </button>
        <div v-if="diffRows.length === 0" class="text-xs text-muted-foreground">
          没有可显示的变化参考号
        </div>
      </div>
    </div>
  </section>
</template>
