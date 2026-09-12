<script setup lang="ts">
import {
  computed,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { externalDimensionCategory } from '../adapters/normalizeExternalDimensions';
import { createRebindEditSession } from '../interaction/editSession';
import { DEFAULT_DIMENSION_FORMAT } from '../kernel/format';

import {
  isDimensionRebindAction,
  isExternalDimensionRecord,
  rebindActionSlot,
} from './dimensionBoundActions';
import DimensionSemanticList from './DimensionSemanticList.vue';
import DimensionToolbar from './DimensionToolbar.vue';

import type { DimensionBoundAction } from './dimensionBoundActions';
import type { MbdPrimitive } from '../adapters/mbdV2Contract';
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';
import type { LayoutResult } from '../kernel/types';

import {
  useMbdDiagnosticsStore,
  type MbdDiagnosticsSnapshot,
} from '@/composables/useMbdDiagnosticsStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { emitToast } from '@/ribbon/toastBus';

type DimensionListItem = UserDimensionRecord | ExternalDimensionRecord;

/**
 * rs-mbd 自报的阶段性排版模式。契约还没有「本次交付覆盖哪些图元类别」的显式
 * 声明，在它出现之前，用已知的阶段模式名兜住「标注不完整」这个事实——未移植
 * 的类别不会产生任何 issue，光看诊断列表看不出缺了什么。
 */
const PARTIAL_LAYOUT_MODES: readonly string[] = ['linear_mvp'];

defineProps<{
  params?: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const viewerContext = useViewerContext();
const userStore = useUserStore();
const documentState = shallowRef(
  viewerContext.dimensionSystem.value?.document.state ?? null,
);
const externalRecords = shallowRef<readonly ExternalDimensionRecord[]>(
  viewerContext.dimensionSystem.value?.externalRegistry.snapshot.records ?? [],
);
const hiddenExternalIds = shallowRef<readonly string[]>(
  [...(viewerContext.dimensionSystem.value?.externalRegistry.snapshot.hiddenIds ?? [])],
);
const selectedId = ref<string | null>(null);
/** 最近一次完整布局（`viewport.subscribeLayouts`），用来读 `derived.lodHidden` 这类逐帧结果。 */
const viewportLayouts = shallowRef<readonly LayoutResult[]>(
  viewerContext.dimensionSystem.value?.viewport.getLayouts() ?? [],
);
let unsubscribeDocument: (() => void) | null = null;
let unsubscribeSelection: (() => void) | null = null;
let unsubscribeExternal: (() => void) | null = null;
let unsubscribeLayouts: (() => void) | null = null;

watch(
  () => viewerContext.dimensionSystem.value,
  (system) => {
    unsubscribeDocument?.();
    unsubscribeDocument = null;
    unsubscribeSelection?.();
    unsubscribeSelection = null;
    unsubscribeExternal?.();
    unsubscribeExternal = null;
    unsubscribeLayouts?.();
    unsubscribeLayouts = null;
    documentState.value = system?.document.state ?? null;
    externalRecords.value = system?.externalRegistry.snapshot.records ?? [];
    hiddenExternalIds.value = [
      ...(system?.externalRegistry.snapshot.hiddenIds ?? []),
    ];
    selectedId.value = system?.viewport.getSelection() ?? null;
    viewportLayouts.value = system?.viewport.getLayouts() ?? [];
    if (system) {
      unsubscribeDocument = system.document.subscribe((state) => {
        documentState.value = state;
      });
      unsubscribeSelection = system.viewport.subscribeSelection((dimensionId) => {
        selectedId.value = dimensionId;
      });
      unsubscribeExternal = system.externalRegistry.subscribe((snapshot) => {
        externalRecords.value = snapshot.records;
        hiddenExternalIds.value = [...snapshot.hiddenIds];
      });
      unsubscribeLayouts = system.viewport.subscribeLayouts((layouts) => {
        viewportLayouts.value = layouts;
      });
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  unsubscribeDocument?.();
  unsubscribeDocument = null;
  unsubscribeSelection?.();
  unsubscribeSelection = null;
  unsubscribeExternal?.();
  unsubscribeExternal = null;
  unsubscribeLayouts?.();
  unsubscribeLayouts = null;
});

const items = computed(() => [
  ...(documentState.value?.records ?? []),
  ...externalRecords.value.filter(
    record => externalDimensionCategory(record) === 'dimension',
  ),
  ...externalRecords.value.filter(
    record => externalDimensionCategory(record) === 'annotation',
  ),
]);

const mbdDiagnostics = useMbdDiagnosticsStore().snapshot;
const diagnosticsBySeverity = computed(() => {
  const groups: Record<'error' | 'warning' | 'info', MbdDiagnosticsSnapshot['issues'][number][]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const issue of mbdDiagnostics.value.issues) {
    groups[issue.severity].push(issue);
  }
  return groups;
});
const diagnosticsCount = computed(() =>
  mbdDiagnostics.value.issues.length + mbdDiagnostics.value.skipped.length);
const diagnosticsVisible = computed(() =>
  diagnosticsCount.value > 0
  || mbdDiagnostics.value.loadError !== null
  || mbdDiagnostics.value.layoutMode !== null);
const incompleteLayoutMode = computed(() => {
  const mode = mbdDiagnostics.value.layoutMode;
  return mode !== null && PARTIAL_LAYOUT_MODES.includes(mode) ? mode : null;
});

function locateIssueRefno(refno: string): void {
  window.dispatchEvent(new CustomEvent('showModelByRefnos', {
    detail: { refnos: [refno], flyTo: true },
  }));
}

/**
 * MBD 图元类别过滤（2026-09-12 长度尺寸显示优化 QW3）。真正的过滤在
 * `useMbdExternalSync` 读 URL `mbd_kinds`；这里只是把那个参数做成勾选框：
 * 改 URL → 派发 `popstate` → ViewerPanel 走同一条 `handleMbdLocationChange`
 * 重新同步。`Record` 钉住契约的全部 kind，契约新增 kind 时这里会编译失败。
 */
const MBD_KIND_LABELS: Readonly<Record<MbdPrimitive['kind'], string>> = {
  linear_dim: '长度尺寸',
  angle_dim: '安装角',
  slope_mark: '坡度',
  weld_mark: '焊缝',
  label: '位号标签',
  leader_line: '引线',
  aid_line: '辅助线',
  aid_arc: '辅助弧',
  aid_circle: '辅助圆',
  aid_point: '辅助点',
  aid_text: '辅助文字',
};
const MBD_KINDS = Object.keys(MBD_KIND_LABELS) as readonly MbdPrimitive['kind'][];

function readMbdKindFilter(): ReadonlySet<string> | null {
  if (typeof window === 'undefined') return null;
  const kinds = (new URLSearchParams(window.location.search).get('mbd_kinds') ?? '')
    .split(',')
    .map(kind => kind.trim().toLowerCase())
    .filter(kind => kind.length > 0);
  return kinds.length > 0 ? new Set(kinds) : null;
}

const mbdKindFilter = ref<ReadonlySet<string> | null>(readMbdKindFilter());
const mbdRecordCount = computed(() =>
  externalRecords.value.filter(record => record.source === 'mbd').length);
const shownMbdKindCount = computed(() =>
  MBD_KINDS.filter(kind => isMbdKindShown(kind)).length);

function isMbdKindShown(kind: string): boolean {
  return mbdKindFilter.value === null || mbdKindFilter.value.has(kind);
}

function writeMbdKinds(kinds: readonly string[] | null): void {
  const url = new URL(window.location.href);
  if (kinds === null) url.searchParams.delete('mbd_kinds');
  else url.searchParams.set('mbd_kinds', kinds.join(','));
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

function setMbdKindShown(kind: string, shown: boolean): void {
  const next = new Set(mbdKindFilter.value ?? MBD_KINDS);
  if (shown) next.add(kind);
  else next.delete(kind);
  if (next.size === 0) return;
  writeMbdKinds(
    next.size === MBD_KINDS.length ? null : MBD_KINDS.filter(item => next.has(item)),
  );
}

function showOnlyMbdKind(kind: MbdPrimitive['kind']): void {
  writeMbdKinds([kind]);
}

function showAllMbdKinds(): void {
  writeMbdKinds(null);
}

/**
 * 分级显示（LOD，S3）的面板开关与统计。开关同样只改 URL（`mbd_lod=0` = 关）并派发
 * `popstate`，由同步层剥掉 `lod` 提示；统计读最近一次布局里 MBD 记录的 `derived.lodHidden`。
 */
function readMbdLodDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mbd_lod')?.trim() === '0';
}

const mbdLodDisabled = ref(readMbdLodDisabled());

function setMbdLodEnabled(enabled: boolean): void {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.delete('mbd_lod');
  else url.searchParams.set('mbd_lod', '0');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

const mbdLodHidden = computed(() => {
  const mbdIds = new Set(
    externalRecords.value.filter(record => record.source === 'mbd').map(record => record.id),
  );
  const summary = { total: 0, secondaryFar: 0, detailFar: 0, shortLine: 0, overlap: 0 };
  for (const layout of viewportLayouts.value) {
    if (!mbdIds.has(layout.dimensionId)) continue;
    const reason = layout.derived.lodHidden;
    if (!reason) continue;
    summary.total += 1;
    if (reason === 'secondary-far') summary.secondaryFar += 1;
    else if (reason === 'detail-far') summary.detailFar += 1;
    else if (reason === 'overlap') summary.overlap += 1;
    else summary.shortLine += 1;
  }
  return summary;
});

/**
 * 三维标注呈现（2026-09-12 参考图风格：尺寸线沿 dim_dir 外移、数字在三维平面里置于线上方、
 * 实心箭头；标签按卡片 / 方框 / 药丸式 billboard 带引线出图）的面板开关。同样只改 URL
 * （`mbd_3d=0` = 关）并派发 `popstate`，由同步层剥掉 mapper 打的 `dimension3d` / `tag`，
 * 内核回到求解器原位几何的平面呈现。
 */
function readMbd3dDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mbd_3d')?.trim() === '0';
}

const mbd3dDisabled = ref(readMbd3dDisabled());

function setMbd3dEnabled(enabled: boolean): void {
  const url = new URL(window.location.href);
  if (enabled) url.searchParams.delete('mbd_3d');
  else url.searchParams.set('mbd_3d', '0');
  window.history.pushState({}, '', url);
  window.dispatchEvent(new Event('popstate'));
}

function syncMbdDebugStateFromLocation(): void {
  mbdKindFilter.value = readMbdKindFilter();
  mbdLodDisabled.value = readMbdLodDisabled();
  mbd3dDisabled.value = readMbd3dDisabled();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', syncMbdDebugStateFromLocation);
}
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', syncMbdDebugStateFromLocation);
  }
});
const recoveryPreview = computed(() => {
  void documentState.value;
  return viewerContext.dimensionSystem.value?.getRecoveryPreview() ?? null;
});
const currentUser = computed(() => {
  const user = userStore.currentUser.value;
  return user
    ? { id: user.id, role: String(user.role) }
    : null;
});

function commandId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `dimension-command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveRecovery(action: 'accept' | 'discard'): void {
  const system = viewerContext.dimensionSystem.value;
  if (!system) return;
  if (action === 'accept') {
    const preview = system.acceptRecovery();
    if (!preview) return;
    emitToast({
      message: `已恢复 ${preview.applied.length} 条尺寸修改`
        + (preview.rejected.length > 0
          ? `，${preview.rejected.length} 条无法恢复`
          : ''),
      level: preview.rejected.length > 0 ? 'warning' : 'success',
    });
    return;
  }
  system.discardRecovery();
  emitToast({ message: '已放弃未保存的尺寸修改', level: 'warning' });
}

function exportSvg(): void {
  const system = viewerContext.dimensionSystem.value;
  if (!system) {
    emitToast({ message: '尺寸系统尚未就绪', level: 'warning' });
    return;
  }
  try {
    const svg = system.exportSvg();
    const url = URL.createObjectURL(new Blob([svg], {
      type: 'image/svg+xml;charset=utf-8',
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `dimensions-${Date.now()}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    emitToast({ message: '尺寸 SVG 已导出', level: 'success' });
  } catch (error) {
    emitToast({
      message: `尺寸 SVG 导出失败：${
        error instanceof Error ? error.message : String(error)
      }`,
      level: 'error',
    });
  }
}

function select(item: DimensionListItem): void {
  selectedId.value = item.id;
  viewerContext.dimensionSystem.value?.viewport.setSelection(item.id);
}

function act(
  action: DimensionBoundAction,
  item: DimensionListItem,
): void {
  if (isExternalDimensionRecord(item)) {
    if (action === 'hide-external') {
      const registry = viewerContext.dimensionSystem.value?.externalRegistry;
      registry?.setHidden(item.id, !registry.isHidden(item.id));
    }
    return;
  }

  const session = viewerContext.dimensionSystem.value?.document;
  const system = viewerContext.dimensionSystem.value;
  const user = currentUser.value;
  if (!session || !system || !user) return;

  if (isDimensionRebindAction(action)) {
    if (!system.snapPort) {
      emitToast({ message: '尺寸捕捉数据尚未就绪', level: 'warning' });
      return;
    }
    const edit = createRebindEditSession({
      record: item,
      anchorSlot: rebindActionSlot(action),
      snapPort: system.snapPort,
      actor: { actorId: user.id, actorRole: user.role },
      createCommandId: commandId,
      now: Date.now,
      onPreview: preview => system.viewport.setPreview(preview),
    });
    if (!edit) {
      emitToast({ message: '该锚点不属于当前尺寸类型', level: 'warning' });
      return;
    }
    system.pointer.start(edit);
    emitToast({ message: '请在模型上选择新的锚点', level: 'info' });
    return;
  }

  const metadata = {
    commandId: commandId(),
    actorId: user.id,
    actorRole: user.role,
    at: Date.now(),
  };
  if (action === 'delete') {
    const result = session.apply({
      ...metadata,
      type: 'delete',
      dimensionId: item.id,
    });
    if (!result.ok) {
      emitToast({ message: `删除尺寸失败：${result.reason}`, level: 'warning' });
    }
    return;
  }
  if (action === 'restore-auto-layout') {
    const result = session.apply({
      ...metadata,
      type: 'set-label-pinned',
      dimensionId: item.id,
      labelPinned: false,
    });
    if (!result.ok) {
      emitToast({ message: `恢复自动布局失败：${result.reason}`, level: 'warning' });
    }
    return;
  }
  if (action === 'flip-angle' && item.kind === 'angular') {
    const result = session.apply({
      ...metadata,
      type: 'set-angle-arc',
      dimensionId: item.id,
      arcChoice: item.placement.arcChoice === 'minor' ? 'major' : 'minor',
    });
    if (!result.ok) {
      emitToast({ message: `翻转角度失败：${result.reason}`, level: 'warning' });
    }
    return;
  }
  if (action === 'toggle-radial-display' && item.kind === 'radial') {
    const result = session.apply({
      ...metadata,
      type: 'set-radial-display',
      dimensionId: item.id,
      display: item.display === 'radius' ? 'diameter' : 'radius',
    });
    if (!result.ok) {
      emitToast({ message: `切换半径/直径失败：${result.reason}`, level: 'warning' });
    }
  }
}
</script>

<template>
  <div class="flex h-full w-full flex-col overflow-hidden">
    <DimensionToolbar :disabled="!viewerContext.dimensionSystem.value"
      :can-undo="viewerContext.dimensionSystem.value?.document.canUndo ?? false"
      :can-redo="viewerContext.dimensionSystem.value?.document.canRedo ?? false"
      @export-svg="exportSvg" />
    <div v-if="recoveryPreview"
      class="m-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
      <div class="font-semibold">发现未保存的尺寸修改</div>
      <div class="mt-1">
        可恢复 {{ recoveryPreview.applied.length }} 条，
        无法恢复 {{ recoveryPreview.rejected.length }} 条。
      </div>
      <div class="mt-2 flex gap-2">
        <button type="button" class="rounded border px-2 py-1"
          @click="resolveRecovery('accept')">
          恢复
        </button>
        <button type="button" class="rounded border px-2 py-1"
          @click="resolveRecovery('discard')">
          放弃
        </button>
      </div>
    </div>
    <div v-if="incompleteLayoutMode"
      class="m-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
      data-testid="mbd-incomplete-annotation">
      <div class="font-semibold">本分支标注不完整</div>
      <div class="mt-1">
        求解器以 {{ incompleteLayoutMode }} 模式产出，只覆盖部分标注类别。
        未产出的类别不会出现在下方诊断里，请勿据此判断标注已完整。
      </div>
    </div>
    <div v-if="mbdDiagnostics.channel"
      class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-kind-filter">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold">MBD 图元类别（显示 {{ mbdRecordCount }} 条）</span>
        <span class="flex gap-1">
          <button type="button"
            class="rounded border px-1.5 py-0.5"
            data-testid="mbd-kind-only-linear"
            @click="showOnlyMbdKind('linear_dim')">
            只看长度
          </button>
          <button type="button"
            class="rounded border px-1.5 py-0.5 disabled:opacity-40"
            data-testid="mbd-kind-all"
            :disabled="mbdKindFilter === null"
            @click="showAllMbdKinds()">
            全部
          </button>
        </span>
      </div>
      <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        <label v-for="kind in MBD_KINDS"
          :key="kind"
          class="flex items-center gap-1">
          <input type="checkbox"
            :data-mbd-kind="kind"
            :checked="isMbdKindShown(kind)"
            :disabled="isMbdKindShown(kind) && shownMbdKindCount === 1"
            @change="setMbdKindShown(kind, ($event.target as HTMLInputElement).checked)" />
          <span>{{ MBD_KIND_LABELS[kind] }}</span>
        </label>
      </div>
      <div class="mt-1 flex flex-wrap items-center justify-between gap-2"
        data-testid="mbd-lod">
        <label class="flex items-center gap-1">
          <input type="checkbox"
            data-testid="mbd-lod-enabled"
            :checked="!mbdLodDisabled"
            @change="setMbdLodEnabled(($event.target as HTMLInputElement).checked)" />
          <span>分级显示（LOD）</span>
        </label>
        <span data-testid="mbd-lod-hidden">
          <template v-if="mbdLodDisabled">已关闭，每条尺寸照常出图</template>
          <template v-else>
            LOD 隐藏 {{ mbdLodHidden.total }} 条（atta 远景 {{ mbdLodHidden.secondaryFar }} / 短段 {{ mbdLodHidden.shortLine }} / 相压 {{ mbdLodHidden.overlap }} / 细节 {{ mbdLodHidden.detailFar }}）
          </template>
        </span>
      </div>
      <div class="mt-1 flex flex-wrap items-center justify-between gap-2"
        data-testid="mbd-3d">
        <label class="flex items-center gap-1">
          <input type="checkbox"
            data-testid="mbd-3d-enabled"
            :checked="!mbd3dDisabled"
            @change="setMbd3dEnabled(($event.target as HTMLInputElement).checked)" />
          <span>三维标注呈现（尺寸线外移 / 数字在线上方 / 实心箭头 / 标签卡片带引线）</span>
        </label>
        <span data-testid="mbd-3d-state">
          <template v-if="mbd3dDisabled">已关闭，按求解器原位几何平面出图</template>
          <template v-else>开</template>
        </span>
      </div>
    </div>
    <details v-if="diagnosticsVisible"
      class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-diagnostics">
      <summary class="cursor-pointer font-semibold">
        MBD 诊断（{{ diagnosticsCount }}）
        <span v-if="mbdDiagnostics.channel" class="font-normal opacity-70">
          {{ mbdDiagnostics.channel === 'api' ? '实时' : 'parquet' }}
          · {{ mbdDiagnostics.sourceId }}
        </span>
      </summary>
      <div v-if="mbdDiagnostics.loadError"
        class="mt-2 font-semibold text-red-700"
        data-testid="mbd-load-error">
        装载失败：{{ mbdDiagnostics.loadError }}
      </div>
      <div v-for="severity in (['error', 'warning', 'info'] as const)"
        :key="severity">
        <template v-if="diagnosticsBySeverity[severity].length > 0">
          <div class="mt-2 font-semibold"
            :class="{
              'text-red-700': severity === 'error',
              'text-amber-700': severity === 'warning',
            }">
            {{ severity }}（{{ diagnosticsBySeverity[severity].length }}）
          </div>
          <div v-for="issue in diagnosticsBySeverity[severity]"
            :key="issue.id"
            class="mt-1 flex items-center justify-between gap-2"
            :data-issue-id="issue.id">
            <span class="min-w-0 break-all">
              [{{ issue.category }}] {{ issue.message }}
            </span>
            <button v-if="issue.refno"
              type="button"
              class="shrink-0 rounded border px-1.5 py-0.5"
              :data-locate-refno="issue.refno"
              @click="locateIssueRefno(issue.refno)">
              定位 {{ issue.refno }}
            </button>
          </div>
        </template>
      </div>
      <template v-if="mbdDiagnostics.skipped.length > 0">
        <div class="mt-2 font-semibold">
          跳过图元（{{ mbdDiagnostics.skipped.length }}）
        </div>
        <div v-for="entry in mbdDiagnostics.skipped"
          :key="entry.id"
          class="mt-1 break-all"
          :data-skipped-id="entry.id">
          {{ entry.id }}：{{ entry.reason }}
        </div>
      </template>
      <template v-if="mbdDiagnostics.layoutMode || mbdDiagnostics.notes.length > 0">
        <div class="mt-2 font-semibold">求解器自报</div>
        <div v-if="mbdDiagnostics.layoutMode"
          class="mt-1"
          data-testid="mbd-layout-mode">
          排版模式：{{ mbdDiagnostics.layoutMode }}
        </div>
        <div v-for="note in mbdDiagnostics.notes"
          :key="note"
          class="mt-1 break-all">
          {{ note }}
        </div>
      </template>
    </details>
    <div class="min-h-0 flex-1">
      <DimensionSemanticList :items="items"
        :selected-id="selectedId"
        :user="currentUser"
        :format-policy="DEFAULT_DIMENSION_FORMAT"
        :hidden-external-ids="hiddenExternalIds"
        :on-select="select"
        :on-action="act" />
    </div>
  </div>
</template>
