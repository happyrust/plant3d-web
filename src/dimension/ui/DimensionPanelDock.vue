<script setup lang="ts">
import {
  computed,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';

import { externalDimensionCategory } from '../adapters/normalizeExternalDimensions';
import { isDimensionFlagEnabled } from '../flags';
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
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';

import {
  useMbdDiagnosticsStore,
  type MbdDiagnosticsSnapshot,
} from '@/composables/useMbdDiagnosticsStore';
import { useUserStore } from '@/composables/useUserStore';
import { useViewerContext } from '@/composables/useViewerContext';
import { emitToast } from '@/ribbon/toastBus';

type DimensionListItem = UserDimensionRecord | ExternalDimensionRecord;

defineProps<{
  params?: {
    params: unknown;
    api: unknown;
    containerApi: unknown;
  };
}>();

const enabled = isDimensionFlagEnabled('DIMENSION_V2_DEV')
  || isDimensionFlagEnabled('DIMENSION_V2_CUTOVER');
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
let unsubscribeDocument: (() => void) | null = null;
let unsubscribeSelection: (() => void) | null = null;
let unsubscribeExternal: (() => void) | null = null;

watch(
  () => viewerContext.dimensionSystem.value,
  (system) => {
    unsubscribeDocument?.();
    unsubscribeDocument = null;
    unsubscribeSelection?.();
    unsubscribeSelection = null;
    unsubscribeExternal?.();
    unsubscribeExternal = null;
    documentState.value = system?.document.state ?? null;
    externalRecords.value = system?.externalRegistry.snapshot.records ?? [];
    hiddenExternalIds.value = [
      ...(system?.externalRegistry.snapshot.hiddenIds ?? []),
    ];
    selectedId.value = system?.viewport.getSelection() ?? null;
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
  diagnosticsCount.value > 0 || mbdDiagnostics.value.loadError !== null);

function locateIssueRefno(refno: string): void {
  window.dispatchEvent(new CustomEvent('showModelByRefnos', {
    detail: { refnos: [refno], flyTo: true },
  }));
}
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
  <div v-if="enabled" class="flex h-full w-full flex-col overflow-hidden">
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
