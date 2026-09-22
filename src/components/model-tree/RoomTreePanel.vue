<script setup lang="ts">
/**
 * 模型树「房间」页签（ADR 0068；plan `docs/plans/2026-09-20-spatial-room-hierarchy-tree-plan.md` §4.5，2026-09-21 改法）：
 * 在册房间平铺一层 + 顶部搜索框，展开一间房是服务端聚合的 房间 → 专业 → 最小交付单元类型 → 单元 → 构件。行沿用 `ModelTreeRow`，
 * 眼睛 / 选中 / 右键（聚焦 · 隔离 · 显示 / 隐藏 · 加载模型 · 查看属性）与 PDMS 树同手势；状态在 `useRoomTree`。
 * legacy 退役（`0b2e317c`，D1）删掉的旧 ROOM 页签走的是旧后端 `/api/room-tree/*`，这里全部改吃 gen-model `/api/v1/spatial/rooms{,/{refno}/tree}`。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import { useVirtualizer } from '@tanstack/vue-virtual';
import { LoaderCircle, RefreshCw, Search, X } from 'lucide-vue-next';

import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import ModelTreeRow from '@/components/model-tree/ModelTreeRow.vue';
import { useConfirmDialogStore } from '@/composables/useConfirmDialogStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useRoomTree } from '@/composables/useRoomTree';
import { setGlobalSelectedRefno, useSelectionStore } from '@/composables/useSelectionStore';
import { showModelByRefnosWithAck } from '@/composables/useViewerContext';
import { cn } from '@/lib/utils';
import { emitToast } from '@/ribbon/toastBus';

const props = defineProps<{
  viewer: DtxCompatViewer | null;
  /** 页签是否在前台：切到别的页签时不拉数据、不动场景 */
  active?: boolean;
}>();

const viewerRef = computed(() => props.viewer);
const tree = useRoomTree(viewerRef);
const confirmDialog = useConfirmDialogStore();
const selection = useSelectionStore();

/** 批量加载超过这个数先弹确认（与抽屉同阈值，用户 2026-09-14 拍板） */
const LARGE_BATCH_LOAD_CONFIRM_THRESHOLD = 200;

const containerRef = ref<HTMLElement | null>(null);
const rows = computed(() => tree.flatRows.value);

const rowVirtualizer = useVirtualizer({
  count: rows.value.length,
  getScrollElement: () => containerRef.value,
  estimateSize: () => 32,
  overscan: 10,
});

watch(
  () => rows.value.length,
  async (count) => {
    rowVirtualizer.value.setOptions({ ...rowVirtualizer.value.options, count });
    await nextTick();
    if (containerRef.value) rowVirtualizer.value.measure();
  },
  { immediate: true },
);

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

function rowAt(index: number) {
  return rows.value[index];
}

const status = computed(() => tree.rootsStatus.value);
const searchPlaceholder = computed(() => (status.value.status === 'ready'
  ? `搜索房间号 / 名称（在册 ${status.value.total} 间）`
  : '搜索房间号 / 名称'));
const filteredCount = computed(() => tree.filteredRoots.value.length);

/** 展开过、取树 / 补叶子失败的节点：一句原因列在树上方 */
const nodeErrors = computed(() => {
  const out: { id: string; label: string; message: string }[] = [];
  for (const id of tree.expandedIds.value) {
    const message = tree.nodeError(id);
    if (!message) continue;
    const node = tree.nodesById.value[id];
    out.push({ id, label: node?.name ?? id, message });
  }
  return out;
});

watch(
  () => props.active ?? true,
  async (active) => {
    if (!active) return;
    void tree.loadRoots();
    // v-show 切回来：隐藏期间容器尺寸为 0，虚拟列表要重新量一次
    await nextTick();
    if (containerRef.value) rowVirtualizer.value.measure();
  },
  { immediate: true },
);

function refreshRoots() {
  tree.reset();
  void tree.loadRoots(true);
}

function onSearchInput(ev: Event) {
  tree.setFilter((ev.target as HTMLInputElement).value);
}

const TUBE_NOT_LOADED_MESSAGE = '这段直管还没装进场景：先对所属 BRAN 单元「加载模型」，再逐段显隐';

/** 眼睛：构件 / 分组按 refno 走；直段行逐段（T4）——对象没装进来时提示先加载所属 BRAN，勾选不变。 */
async function onToggleVisible(id: string, visible: boolean) {
  const result = await tree.setVisible(id, visible);
  if (result === 'tube-not-loaded') emitToast({ message: TUBE_NOT_LOADED_MESSAGE, level: 'info' });
}

/** 树内点选写全局选中时置位：下面的联动 watch 见到它就不再反过来展开 / 滚动（与 PDMS 树的 `internalTreeSelection` 同法）。 */
let internalSelection = false;

function publishSelection(refno: string) {
  if (selection.selectedRefno.value !== refno) internalSelection = true;
  setGlobalSelectedRefno(refno);
}

function onSelect(index: number, ev: MouseEvent) {
  const refno = tree.selectByRowIndex(index, ev);
  if (refno) publishSelection(refno);
}

/**
 * 外部选中联动（收口计划 P3-b，D5）：查看器 / 抽屉 / PDMS 树里选中一个构件，若它在页签里**已经取过树的房**下，展开到它、选中并滚到可见；
 * 只在页签在前台时做，不为它去拉没展开的房。
 */
let revealSeq = 0;
watch(
  () => [selection.selectedRefno.value, props.active ?? true] as const,
  async ([refno, active]) => {
    if (internalSelection) {
      internalSelection = false;
      return;
    }
    if (!active || !refno) return;
    const hit = tree.revealRefno(refno);
    if (!hit || hit.index < 0) return;
    const seq = ++revealSeq;
    await nextTick();
    if (seq !== revealSeq || !containerRef.value) return;
    rowVirtualizer.value.measure();
    rowVirtualizer.value.scrollToIndex(hit.index, { align: 'center' });
  },
);

// ---- 右键菜单 ----
const contextMenuOpen = ref(false);
const contextMenuPos = ref({ x: 0, y: 0 });
const contextMenuRef = ref<HTMLElement | null>(null);
const contextNodeId = ref<string | null>(null);
const contextNode = computed(() => (contextNodeId.value ? tree.nodesById.value[contextNodeId.value] ?? null : null));
const contextRefnoCount = computed(() => contextNode.value?.count ?? null);
const contextIsElementOrUnit = computed(() => contextNode.value?.kind === 'element' || contextNode.value?.kind === 'unit');
const contextIsTube = computed(() => contextNode.value?.kind === 'tube');

/** 直段行（方案 B）：title 挂两端 refno / 距离 / 所属 BRAN；眼睛是逐段的（T4），右键没有隔离 / 加载（那是单元级的事） */
function isTubeRow(id: string): boolean {
  return tree.nodesById.value[id]?.kind === 'tube';
}

function clamp(x: number, y: number, width: number, height: number) {
  const margin = 8;
  return {
    x: Math.min(Math.max(margin, x), Math.max(margin, window.innerWidth - width - margin)),
    y: Math.min(Math.max(margin, y), Math.max(margin, window.innerHeight - height - margin)),
  };
}

function openContextMenu(nodeId: string, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  contextNodeId.value = nodeId;
  contextMenuPos.value = clamp(ev.clientX, ev.clientY, 176, 300);
  contextMenuOpen.value = true;
  void nextTick(() => {
    const rect = contextMenuRef.value?.getBoundingClientRect();
    if (rect) contextMenuPos.value = clamp(contextMenuPos.value.x, contextMenuPos.value.y, rect.width || 176, rect.height || 300);
  });
}

function closeContextMenu() {
  contextMenuOpen.value = false;
  contextNodeId.value = null;
}

function onGlobalMouseDown(ev: MouseEvent) {
  const target = ev.target as HTMLElement;
  if (target.closest('[data-room-tree-context-menu="true"]')) return;
  closeContextMenu();
}

onMounted(() => window.addEventListener('mousedown', onGlobalMouseDown));
onUnmounted(() => window.removeEventListener('mousedown', onGlobalMouseDown));

async function focusNode() {
  const id = contextNodeId.value;
  closeContextMenu();
  if (!id) return;
  const ok = await tree.flyTo(id);
  if (!ok) emitToast({ message: '该节点下还没有已加载几何的构件，先「加载模型」再定位', level: 'info' });
}

function isolateNode() {
  const id = contextNodeId.value;
  closeContextMenu();
  if (id) void tree.isolateXray(id);
}

function clearXray() {
  closeContextMenu();
  tree.clearXray();
}

function showNode() {
  const id = contextNodeId.value;
  closeContextMenu();
  if (id) void onToggleVisible(id, true);
}

function hideNode() {
  const id = contextNodeId.value;
  closeContextMenu();
  if (id) void onToggleVisible(id, false);
}

/** 「加载模型」：节点下全部构件经数据源 ensure → records 进查看器并飞过去；> 200 个先确认。 */
async function loadNodeModels() {
  const id = contextNodeId.value;
  const label = contextNode.value?.name ?? '';
  closeContextMenu();
  if (!id) return;
  const refnos = await tree.collectRefnos(id);
  if (refnos.length === 0) {
    emitToast({ message: '该节点下没有构件', level: 'info' });
    return;
  }
  if (refnos.length > LARGE_BATCH_LOAD_CONFIRM_THRESHOLD) {
    const ok = await confirmDialog.open({
      title: '加载数量较多',
      message: `「加载模型」（${label}）将加载 ${refnos.length} 个模型（超过 ${LARGE_BATCH_LOAD_CONFIRM_THRESHOLD} 个），可能要等一会儿。继续吗？`,
      confirmText: `加载 ${refnos.length} 个`,
    });
    if (!ok) return;
  }
  const result = await showModelByRefnosWithAck({ refnos, flyTo: true, timeoutMs: 120_000, ensureViewerReady: true });
  if (result.error) {
    emitToast({ message: result.error, level: 'error' });
  } else if (result.fail.length > 0) {
    emitToast({ message: `${result.ok.length} 个已加载，${result.fail.length} 个失败：${result.fail[0]?.error ?? ''}`, level: 'warning' });
  }
}

function viewProperties() {
  const node = contextNode.value;
  closeContextMenu();
  // 直段行没有 refno：看它所属 BRAN 的属性
  const refno = node?.refno ?? node?.tube?.unitRefno;
  if (refno) {
    publishSelection(refno);
    ensurePanelAndActivate('properties');
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="room-tree-panel">
    <div class="border-b border-border/60 px-3 py-2">
      <div class="relative flex items-center gap-1">
        <Search class="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
        <input class="h-8 w-full rounded-md border border-input bg-background pl-7 pr-7 text-sm"
          :placeholder="searchPlaceholder"
          :value="tree.filterText.value"
          data-testid="room-tree-search"
          @input="onSearchInput" />
        <button v-if="tree.filterText.value"
          type="button"
          class="absolute right-9 inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          title="清空搜索"
          @click="tree.setFilter('')">
          <X class="h-3.5 w-3.5" />
        </button>
        <button type="button"
          class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="重新拉取在册房间"
          data-testid="room-tree-refresh"
          @click="refreshRoots">
          <RefreshCw class="h-3.5 w-3.5" />
        </button>
      </div>
      <div class="mt-1 text-[11px] text-muted-foreground" data-testid="room-tree-status">
        <span v-if="status.status === 'loading'" class="inline-flex items-center gap-1"><LoaderCircle class="h-3 w-3 animate-spin" /> 正在拉取在册房间…</span>
        <span v-else-if="status.status === 'ready'">
          {{ filteredCount === status.total ? `在册 ${status.total} 间房` : `匹配 ${filteredCount} / ${status.total} 间房` }}
          <span v-if="status.reason" class="text-warning"> · {{ status.reason }}</span>
          · 展开一间房看 专业 → 最小交付单元 → 构件
        </span>
        <span v-else-if="status.status === 'unavailable'" class="text-warning">{{ status.reason }}</span>
        <span v-else-if="status.status === 'error'" class="text-destructive">{{ status.reason }}</span>
      </div>
      <div v-if="nodeErrors.length > 0" class="mt-1 space-y-0.5" data-testid="room-tree-node-errors">
        <div v-for="item in nodeErrors" :key="item.id" class="truncate text-[11px] text-destructive" :title="`${item.label}：${item.message}`">
          {{ item.label }}：{{ item.message }}
        </div>
      </div>
    </div>

    <div ref="containerRef"
      class="relative min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-2"
      data-testid="room-tree-body">
      <div v-if="status.status === 'ready' && rows.length === 0" class="px-2 py-6 text-center text-xs text-muted-foreground">
        没有匹配的房间
      </div>
      <div class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div v-for="vr in virtualRows"
          :key="String(vr.key)"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${vr.start}px)` }">
          <ModelTreeRow v-if="rowAt(vr.index)"
            :row="rowAt(vr.index)!"
            :index="vr.index"
            :expanded="tree.expandedIds.value.has(rowAt(vr.index)!.id)"
            :selected="tree.isRowSelected(rowAt(vr.index)!.id)"
            :check-state="tree.getCheckState(rowAt(vr.index)!.id)"
            :loading="tree.isNodeLoading(rowAt(vr.index)!.id)"
            :row-title="isTubeRow(rowAt(vr.index)!.id) ? tree.nodesById.value[rowAt(vr.index)!.id]?.title : undefined"
            @toggle-expand="tree.toggleExpand"
            @toggle-visible="onToggleVisible"
            @select="onSelect"
            @context="openContextMenu" />
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="contextMenuOpen"
        ref="contextMenuRef"
        data-room-tree-context-menu="true"
        :class="cn('fixed z-[9999] w-44 rounded-md border border-border bg-background p-1 shadow-md')"
        :style="{ left: `${contextMenuPos.x}px`, top: `${contextMenuPos.y}px` }">
        <button type="button" class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" @click="focusNode">聚焦飞行</button>
        <!-- 直段行（方案 B）：聚焦 + 逐段显 / 隐（T4，只动那一段直管对象）+ 查看所属 BRAN 的属性；隔离 / 加载是单元级的事，去单元行 -->
        <template v-if="!contextIsTube">
          <button type="button" class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" @click="isolateNode">隔离（XRAY 其它）</button>
          <button type="button" class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" @click="clearXray">取消隔离</button>
        </template>
        <div class="my-1 h-px bg-border" />
        <button type="button" class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" @click="showNode">显示</button>
        <button type="button" class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" @click="hideNode">隐藏</button>
        <template v-if="!contextIsTube">
          <button type="button"
            class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            data-testid="room-tree-load-models"
            @click="loadNodeModels">
            加载模型{{ contextRefnoCount !== null ? `（${contextRefnoCount} 个构件）` : '' }}
          </button>
        </template>
        <template v-if="contextIsElementOrUnit || contextIsTube">
          <div class="my-1 h-px bg-border" />
          <button type="button" class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted" @click="viewProperties">查看属性</button>
        </template>
      </div>
    </Teleport>
  </div>
</template>
