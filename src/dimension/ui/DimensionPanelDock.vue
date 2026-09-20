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
import type { ExternalDimensionRecord } from '../adapters/normalizeExternalDimensions';
import type { UserDimensionRecord } from '../domain/types';
import type { LayoutResult } from '../kernel/types';

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

/** 显示模式（见下「显示模式」段）；先于订阅声明，viewport 一出现就按 URL 校准。 */
type MbdDisplayMode = 'engineering' | 'inspection';

function readMbdDisplayMode(): MbdDisplayMode {
  if (typeof window === 'undefined') return 'engineering';
  return new URLSearchParams(window.location.search).get('mbd_mode')?.trim() === 'inspection'
    ? 'inspection'
    : 'engineering';
}

const mbdDisplayMode = ref<MbdDisplayMode>(readMbdDisplayMode());

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
      // The display mode lives in the URL; a (re)created viewport starts in
      // engineering and is brought in line here.
      system.viewport.setDisplayMode(mbdDisplayMode.value);
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

/**
 * 显示模式（S4，2026-09-13）：`engineering`（默认）每条尺寸照工程图样全画；`inspection`
 * 让内核在每次完整布局后对每条尺寸的探测点（数字 / 标签锚点）向相机做一次射线求交，
 * 被模型挡住的整条淡化到 `theme.inspection.occludedAlpha`、其余 `visibleAlpha`（叠层在整帧
 * 之后直接画进 sRGB 画布，ADR 0064：0.35 / 0.65 就是约 35 % / 65 % 的对比），不隐藏。
 * 状态记在 URL `mbd_mode=inspection` 上（参数名沿用 MBD 时代），模式只关系到呈现，直接交给
 * `viewport.setDisplayMode`；浏览器前进 / 后退带来的 `popstate` 会把它同步回来。
 */
function setMbdDisplayMode(mode: MbdDisplayMode): void {
  const url = new URL(window.location.href);
  if (mode === 'engineering') url.searchParams.delete('mbd_mode');
  else url.searchParams.set('mbd_mode', mode);
  window.history.replaceState({}, '', url);
  mbdDisplayMode.value = mode;
  viewerContext.dimensionSystem.value?.viewport.setDisplayMode(mode);
}

/** 检视模式下最近一次布局里各条尺寸的遮挡统计（只数画出来的）。 */
const dimensionOcclusion = computed(() => {
  const summary = { occluded: 0, visible: 0 };
  for (const layout of viewportLayouts.value) {
    if (layout.primitives.length === 0) continue;
    if (layout.derived.occluded) summary.occluded += 1;
    else summary.visible += 1;
  }
  return summary;
});

function syncDisplayModeFromLocation(): void {
  const mode = readMbdDisplayMode();
  if (mode !== mbdDisplayMode.value) {
    mbdDisplayMode.value = mode;
    viewerContext.dimensionSystem.value?.viewport.setDisplayMode(mode);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', syncDisplayModeFromLocation);
}
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('popstate', syncDisplayModeFromLocation);
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
    <div class="m-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700"
      data-testid="mbd-mode">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex flex-wrap items-center gap-2">
          <span>显示模式</span>
          <label class="flex items-center gap-1">
            <input type="radio"
              name="mbd-display-mode"
              value="engineering"
              data-testid="mbd-mode-engineering"
              :checked="mbdDisplayMode === 'engineering'"
              @change="setMbdDisplayMode('engineering')" />
            <span>Engineering（工程）</span>
          </label>
          <label class="flex items-center gap-1">
            <input type="radio"
              name="mbd-display-mode"
              value="inspection"
              data-testid="mbd-mode-inspection"
              :checked="mbdDisplayMode === 'inspection'"
              @change="setMbdDisplayMode('inspection')" />
            <span>Inspection（检视：被模型挡住的尺寸淡化）</span>
          </label>
        </span>
        <span data-testid="mbd-mode-state">
          <template v-if="mbdDisplayMode === 'inspection'">
            被遮挡 {{ dimensionOcclusion.occluded }} 条 / 可见 {{ dimensionOcclusion.visible }} 条
          </template>
          <template v-else>每条尺寸照工程图样全画</template>
        </span>
      </div>
    </div>
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
