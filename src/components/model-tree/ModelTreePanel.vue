<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { useVirtualizer } from '@tanstack/vue-virtual';
import { Filter, GitCompare, Plus, Search, X } from 'lucide-vue-next';

import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import GenModelV1HealthBadge from '@/components/model-tree/GenModelV1HealthBadge.vue';
import ModelGenerationProgressModal from '@/components/model-tree/ModelGenerationProgressModal.vue';
import ModelTreeRow from '@/components/model-tree/ModelTreeRow.vue';
import { readModelTreeTab, writeModelTreeTab, type ModelTreeTab } from '@/components/model-tree/modelTreeTab';
import ModelVersionAttrDiffPanel from '@/components/model-tree/ModelVersionAttrDiffPanel.vue';
import RoomTreePanel from '@/components/model-tree/RoomTreePanel.vue';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { setModelTreeInstance } from '@/composables/useModelTreeStore';
import { usePdmsOwnerTree, NOUN_TYPES } from '@/composables/usePdmsOwnerTree';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import {
  MODEL_VERSION_TREE_DIFF_EVENT,
  normalizeTreeDiffStatus,
  useTreeVersionDiff,
  type DiffFlatRow,
  type TreeDiffAttributesAt,
  type TreeDiffFilter,
  type TreeDiffModel,
} from '@/composables/useTreeVersionDiff';
import { cn } from '@/lib/utils';
import { MODEL_UNIT_VERSION_COMPARE_EVENT, requestModelVersionInspect } from '@/utils/modelUnitVersionCompare';

const props = defineProps<{
  viewer: DtxCompatViewer | null;
}>();

/** gen-model 连接徽标（plan 2026-09-06 P1-4）：legacy 退役后 gen-model-v1 是唯一数据源，徽标常驻。 */
const showGenModelV1Badge = true;

/**
 * 页签：PDMS 属主树 / 「房间」（ADR 0068 房间层级树，`RoomTreePanel`，2026-09-21 起；退役掉的旧 ROOM 页签走的是旧后端）。
 * 搜索 / 类型筛选 / 差异模式 / 右键菜单都只属于 PDMS 树；两棵树都 `v-show` 常驻，切回来时展开与勾选状态还在。
 * 上次停在哪一页记在 localStorage（`modelTreeTab.ts`，收口计划 P3-a），刷新回来还在那一页。
 */
const activeTab = ref<ModelTreeTab>(readModelTreeTab());
const isPdmsTab = computed(() => activeTab.value === 'pdms');

// 只剩 PDMS 一棵树：旧后端 `/api/room-tree/*` 的 ROOM 页签 2026-09-20 随 legacy 退役（D1）。
const pdmsViewerRef = shallowRef<DtxCompatViewer | null>(props.viewer);

console.log('[ModelTreePanel] initial props.viewer:', props.viewer ? 'exists' : 'null');

watch(
  () => props.viewer,
  (v) => {
    console.log('[ModelTreePanel] watch triggered, viewer:', v ? 'exists' : 'null');
    pdmsViewerRef.value = v;
  },
  { immediate: true }
);

const pdmsTree = usePdmsOwnerTree(pdmsViewerRef);

// 版本差异模式（树内差异标注）：由 MODEL_VERSION_TREE_DIFF_EVENT 事件驱动（派发方：模型版本对比面板）
const treeDiff = useTreeVersionDiff({
  nodesById: pdmsTree.nodesById,
  rootIds: pdmsTree.rootIds,
  expandedIds: pdmsTree.expandedIds,
  flatRows: pdmsTree.flatRows,
  expandPathToNode: pdmsTree.expandPathToNode,
});

// Register the global tree instance for console commands
setModelTreeInstance(pdmsTree);

const selection = useSelectionStore();
const toolStore = useToolStore();

// Debug: 用于排查点击 eye（显示/隐藏）导致卡死的问题。
// - true: 禁用“显示时自动 showModelByRefno 加载/生成”，仅走树的 setVisible。
// - false: 保持原行为。
const DEBUG_SKIP_EYE_AUTO_GENERATE = false;

const expandedIds = computed(() => pdmsTree.expandedIds.value);
const flatRows = computed(() => pdmsTree.flatRows.value);
const filterText = computed(() => pdmsTree.filterText.value);
const typeQuery = computed(() => pdmsTree.typeQuery.value);
const filteredTypes = computed(() => pdmsTree.filteredTypes.value);
const searchLoading = computed(() => pdmsTree.searchLoading.value);
const searchError = computed(() => pdmsTree.searchError.value);
const searchItems = computed(() => pdmsTree.searchItems.value);

// ------- 版本差异模式：模板用扁平状态（嵌套 ref 在模板中不会自动解包） -------
const diffActive = computed(() => treeDiff.isActive.value);
const diffFilter = treeDiff.filter;
const diffCounts = treeDiff.counts;
const diffVersionLabel = treeDiff.versionPairLabel;
const diffResolving = treeDiff.resolving;
const diffResolveDone = treeDiff.resolveDone;
const diffResolveTotal = treeDiff.resolveTotal;
const diffUnplacedCount = treeDiff.unplacedCount;
const diffSelectedModel = treeDiff.selectedModel;
const diffContext = treeDiff.context;
const diffDbLabel = computed(() => (diffContext.value?.dbnum ? `DB ${diffContext.value.dbnum}` : ''));

const DIFF_FILTER_CHIPS: { key: TreeDiffFilter; label: string; activeCls: string }[] = [
  { key: 'all', label: '全部', activeCls: 'border-brand bg-brand-subtle text-brand' },
  { key: 'added', label: '新增', activeCls: 'border-success bg-success-subtle text-success' },
  { key: 'modified', label: '修改', activeCls: 'border-warning bg-warning-subtle text-warning' },
  { key: 'deleted', label: '删除', activeCls: 'border-danger bg-danger-subtle text-danger' },
];

function exitDiffMode() {
  treeDiff.clear();
  // 差异模式退了，「属性见底部属性历史对比」那块也没了：登记为已删除的选中一起清掉
  if (selection.selectedIsDeleted.value) selection.clearSelection();
}

/**
 * 幽灵行（差异模式里当前会话已经没有的构件：B 版删掉的，或 B 版之后才被删的新增 / 修改）进全局选中：
 * 属性面板据 `selectedIsDeleted` 给「该构件已删除，属性见底部属性历史对比」、不拉当前会话的属性；
 * 树内不定位（当前树里没有它，去后端查祖先只会 404）。
 */
function selectDeletedRefno(refno: string) {
  if (selection.selectedRefno.value !== refno) internalTreeSelection = true;
  selection.setSelectedDeletedRefno(refno);
}

/** 虚拟列表实际渲染的行：差异模式下为“变更节点 + 祖先 + 幽灵节点”过滤视图 */
const displayRows = computed<DiffFlatRow[]>(() => (
  treeDiff.isActive.value ? treeDiff.rows.value : flatRows.value
));

function setFilter(text: string) {
  pdmsTree.setFilter(text);
}

function setTypeQuery(text: string) {
  pdmsTree.setTypeQuery(text);
}

function toggleType(type: string) {
  pdmsTree.toggleType(type);
}

function selectAllTypes() {
  pdmsTree.selectAllTypes();
}

function clearAllTypes() {
  pdmsTree.clearAllTypes();
}

const customTypeInput = ref('');

function addCustomType() {
  const success = pdmsTree.addCustomType(customTypeInput.value);
  if (success) {
    customTypeInput.value = '';
  }
}

function removeCustomType(type: string) {
  pdmsTree.removeCustomType(type);
}

const customTypes = computed(() => Array.from(pdmsTree.customTypes.value));

const loadingVisibleIds = ref<Set<string>>(new Set());

function setNodeLoading(id: string, loading: boolean) {
  const normalizedId = normalizeRefnoKeyLike(id);
  if (!normalizedId) return;
  const next = new Set(loadingVisibleIds.value);
  if (loading) {
    next.add(normalizedId);
  } else {
    next.delete(normalizedId);
  }
  loadingVisibleIds.value = next;
}

function isNodeLoading(id: string) {
  return loadingVisibleIds.value.has(normalizeRefnoKeyLike(id));
}

function toggleExpand(id: string) {
  pdmsTree.toggleExpand(id);
}

function getCheckState(id: string) {
  const state = pdmsTree.getCheckState(id);
  if (state === 'unchecked') return state;
  if (!isRefnoLike(id)) return state;
  const modelState = modelGenerationState.value;
  if (!modelState) return state;
  return modelState.isModelActuallyLoaded(id) ? state : 'unchecked';
}

// Initialize model generation composable
const modelGenerationState = shallowRef<ReturnType<typeof useModelGeneration> | null>(null);

watch(
  () => props.viewer,
  (viewer) => {
    if (viewer && !modelGenerationState.value) {
      modelGenerationState.value = useModelGeneration({ viewer });
    }
  },
  { immediate: true }
);

async function setVisible(id: string, visible: boolean) {
  // Only auto-generate for PDMS tree and when trying to show (visible = true)
  const shouldTryGenerate = !DEBUG_SKIP_EYE_AUTO_GENERATE && visible && modelGenerationState.value;

  if (shouldTryGenerate) {
    // Check if it looks like a refno (123/456 or 123_456)
    // If it's a refno, we try to auto-generate if missing
    if (isRefnoLike(id)) {
      // eye 的“显示”也应支持 auto fit：
      // - 若已加载：showModelByRefno 会直接用 AABB flyTo
      // - 若未加载：showModelByRefno 会加载完成后 flyTo
      setNodeLoading(id, true);
      try {
        const success = await modelGenerationState.value!.showModelByRefno(id, { flyTo: true });

        if (success) {
          // 模型已加载成功：同步树的勾选状态（eye 图标）并确保可见。
          // 这样后续点击 eye 只会切换 visible，不会再次触发 show-by-refno。
          await pdmsTree.setVisible(id, true);
          return;
        }
      } finally {
        setNodeLoading(id, false);
      }
      // 失败时继续调用 setVisible 显示部分加载的数据
    }
  }

  // Call the original setVisible logic
  await pdmsTree.setVisible(id, visible);
}

function selectByRowIndex(index: number, ev: MouseEvent) {
  if (treeDiff.isActive.value) {
    const row = displayRows.value[index];
    if (!row) return;
    // 变更节点/幽灵节点：更新属性差异面板选中
    if (row.diffStatus || row.ghost) treeDiff.select(row.id);
    // 幽灵节点：不进入树选中与 3D 联动；全局选中登记为「已删除」，让右侧属性面板给提示而不是去拉当前会话（404）
    if (row.ghost) {
      selectDeletedRefno(row.id);
      return;
    }
    // 差异视图行索引与源树 flatRows 索引不一致，按 id 映射回源索引
    const realIndex = pdmsTree.flatRows.value.findIndex((r) => r.id === row.id);
    if (realIndex < 0) return;
    pdmsTree.selectByRowIndex(realIndex, ev);
    handleSelectionChanged(pdmsTree.selectedIds.value);
    return;
  }

  pdmsTree.selectByRowIndex(index, ev);
  handleSelectionChanged(pdmsTree.selectedIds.value);
}

function isRefnoLike(id: string): boolean {
  // Support 123_456, 123/456, 123,456
  return /^\d+[_\/,]\d+/.test(id);
}

function treeNodeRefno(id: string): string {
  return isRefnoLike(id) ? normalizeRefnoKeyLike(id) : '';
}

function handleSelectionChanged(selected: Set<string>) {
  internalTreeSelection = true;
  const normalized = Array.from(selected)
    .filter((id) => !!id && isRefnoLike(id))
    .map((id) => normalizeRefnoKeyLike(id))
    .filter(Boolean);

  if (toolStore.toolMode.value === 'measure_object_to_object') {
    if (normalized.length === 0) {
      selection.clearSelection();
      return;
    }
    selection.setSelectedRefnos(normalized, normalized[normalized.length - 1] ?? normalized[0] ?? null);
    return;
  }

  if (normalized.length !== 1) {
    selection.clearSelection();
    return;
  }
  selection.setSelectedRefno(normalized[0] ?? null);
}

function flyTo(id: string) {
  void pdmsTree.flyTo(id);
}

function isolateXray(id: string) {
  void pdmsTree.isolateXray(id);
}

function clearXrayScene() {
  pdmsTree.clearXray();
}

function isTypeSelected(type: string) {
  return pdmsTree.selectedTypes.value.has(type);
}

function isExpanded(id: string) {
  return expandedIds.value.has(id);
}

function isSelected(id: string) {
  return pdmsTree.selectedIds.value.has(id);
}

function rowAt(index: number) {
  return displayRows.value[index];
}

function isRowSelected(row: DiffFlatRow): boolean {
  if (row.ghost) return treeDiff.selectedRefno.value === row.id;
  return isSelected(row.id);
}

const containerRef = ref<HTMLElement | null>(null);
const contextMenuOpen = ref(false);
const contextMenuPos = ref({ x: 0, y: 0 });
const contextMenuRef = ref<HTMLElement | null>(null);
const contextNodeId = ref<string | null>(null);

const searchPopoverOpen = ref(false);
const typePopoverOpen = ref(false);

// 无名构件显示短名（`ZONE 4`，默认）还是 E3D 整条默认全名（`ZONE 4 of SITE 2`）。
// 两种形态服务端一次都给（gen-model spec §4.10 `name` / `short_name`），这里只是换个字段画，
// 不重查；选择按浏览器落盘。
const FULL_NAMES_STORAGE_KEY = 'plant3d-web.modelTree.fullNames';
const showFullNames = ref(readFullNamesPreference());
function readFullNamesPreference(): boolean {
  try {
    return globalThis.localStorage?.getItem(FULL_NAMES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
watch(showFullNames, (on) => {
  try {
    globalThis.localStorage?.setItem(FULL_NAMES_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // 私密模式 / 配额满：这次的选择只在本页有效，不值得报错。
  }
});

const rowVirtualizer = useVirtualizer({
  count: displayRows.value.length,
  getScrollElement: () => containerRef.value,
  estimateSize: () => 32,
  overscan: 10
});

const activeRootId = computed(() => pdmsTree.rootIds.value[0]);

let selectionSyncSeq = 0;
let internalTreeSelection = false;

watch(
  () => toolStore.toolMode.value,
  (mode, prev) => {
    if (mode === 'measure_object_to_object' || prev !== 'measure_object_to_object') return;
    if (pdmsTree.selectedIds.value.size <= 1) return;

    const active = normalizeRefnoKeyLike(selection.selectedRefno.value || Array.from(pdmsTree.selectedIds.value)[0] || '');
    const next = new Set<string>();
    if (active) {
      next.add(active);
    }
    pdmsTree.selectedIds.value = next;
    handleSelectionChanged(next);
  },
);

watch(
  () => [selection.selectedRefno.value, activeRootId.value] as const,
  ([refno]) => {
    selectionSyncSeq++;
    const seq = selectionSyncSeq;

    // 树内点击选中时不需要展开/滚动定位，只有外部选中才需要
    if (internalTreeSelection) {
      internalTreeSelection = false;
      return;
    }

    if (!refno || !isRefnoLike(refno)) {
      if (pdmsTree.selectedIds.value.size > 0) {
        pdmsTree.selectedIds.value = new Set();
      }
      return;
    }

    void (async () => {
      const targetId = normalizeRefnoKeyLike(refno);
      try {
        const already = pdmsTree.selectedIds.value.size === 1 && pdmsTree.selectedIds.value.has(targetId);
        if (!already) {
          await pdmsTree.focusNodeById(targetId, { flyTo: false, syncSceneSelection: false, clearSearch: false });
        }
      } catch {
        void 0;
      }

      await nextTick();
      if (seq !== selectionSyncSeq) return;

      if (containerRef.value) rowVirtualizer.value.measure();
      await nextTick();
      if (seq !== selectionSyncSeq) return;

      const idx = displayRows.value.findIndex((r) => r.id === targetId);
      if (idx < 0) return;

      const v = rowVirtualizer.value as unknown as { scrollToIndex?: (index: number, opts?: unknown) => void };
      if (typeof v.scrollToIndex === 'function') {
        v.scrollToIndex(idx, { align: 'center' });
        await nextTick();
        if (seq !== selectionSyncSeq) return;
        if (containerRef.value) rowVirtualizer.value.measure();
        v.scrollToIndex(idx, { align: 'center' });
        return;
      }
      if (containerRef.value) {
        containerRef.value.scrollTop = idx * 32;
      }
    })();
  },
  { immediate: true }
);

watch(
  () => displayRows.value.length,
  async (count) => {
    // console.log('[ModelTreePanel] displayRows.length changed:', count);
    rowVirtualizer.value.setOptions({
      ...rowVirtualizer.value.options,
      count,
    });
    // 等待 DOM 更新后强制重新测量，确保虚拟列表正确渲染
    await nextTick();
    if (containerRef.value) {
      rowVirtualizer.value.measure();
    }
  },
  { immediate: true }
);

const virtualRows = computed(() => {
  const items = rowVirtualizer.value.getVirtualItems();
  // console.log('[ModelTreePanel] virtualRows computed:', items.length, 'items');
  return items;
});
const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

function getPdmsTreeE2ESnapshot(rawRefno?: string) {
  const targetId = normalizeRefnoKeyLike(rawRefno || '');
  const targetIndex = targetId ? displayRows.value.findIndex((row) => row.id === targetId) : -1;
  const node = targetId ? pdmsTree.nodesById.value[targetId] : null;
  const parent = node?.parentId ? pdmsTree.nodesById.value[node.parentId] : null;
  const rows = targetIndex >= 0
    ? displayRows.value.slice(Math.max(0, targetIndex - 6), targetIndex + 7)
    : displayRows.value.slice(0, 80);

  return {
    rootIds: [...pdmsTree.rootIds.value],
    expandedIds: [...pdmsTree.expandedIds.value],
    selectedIds: [...pdmsTree.selectedIds.value],
    flatRowCount: displayRows.value.length,
    targetId,
    targetIndex,
    targetNode: node
      ? {
        id: node.id,
        name: node.name,
        type: node.type,
        parentId: node.parentId,
        childrenIds: [...node.childrenIds],
      }
      : null,
    targetParent: parent
      ? {
        id: parent.id,
        name: parent.name,
        type: parent.type,
        parentId: parent.parentId,
        childrenIds: [...parent.childrenIds],
      }
      : null,
    rows,
    virtualRows: virtualRows.value.map((row) => ({
      index: row.index,
      start: row.start,
      size: row.size,
    })),
  };
}

async function focusPdmsTreeRefnoForE2E(rawRefno: string) {
  const targetId = normalizeRefnoKeyLike(rawRefno);
  let error: string | null = null;

  try {
    await nextTick();
    await pdmsTree.focusNodeById(targetId, {
      flyTo: false,
      syncSceneSelection: false,
      clearSearch: false,
    });
    selection.setSelectedRefno(targetId);
    await nextTick();
    if (containerRef.value) rowVirtualizer.value.measure();
    await nextTick();

    const targetIndex = displayRows.value.findIndex((row) => row.id === targetId);
    if (targetIndex >= 0) {
      const v = rowVirtualizer.value as unknown as { scrollToIndex?: (index: number, opts?: unknown) => void };
      if (typeof v.scrollToIndex === 'function') {
        v.scrollToIndex(targetIndex, { align: 'center' });
      } else if (containerRef.value) {
        containerRef.value.scrollTop = targetIndex * 32;
      }
      await nextTick();
      if (containerRef.value) rowVirtualizer.value.measure();
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return {
    ...getPdmsTreeE2ESnapshot(targetId),
    error,
  };
}

function closeContextMenu() {
  contextMenuOpen.value = false;
  contextNodeId.value = null;
}

function clampContextMenuPosition(x: number, y: number, width: number, height: number) {
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - width - margin);
  const maxY = Math.max(margin, window.innerHeight - height - margin);

  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}

function openContextMenu(nodeId: string, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  // 幽灵节点（已删除、不在当前树中）仅展示，不提供右键操作
  if (treeDiff.isActive.value
    && !pdmsTree.nodesById.value[normalizeRefnoKeyLike(nodeId)]) {
    return;
  }
  contextNodeId.value = nodeId;

  // 先用预估尺寸定位，再在 DOM 渲染后按真实尺寸二次夹紧。
  const menuWidth = 176; // w-44 = 11rem = 176px
  const menuHeight = 360;

  contextMenuPos.value = clampContextMenuPosition(ev.clientX, ev.clientY, menuWidth, menuHeight);
  contextMenuOpen.value = true;

  void nextTick(() => {
    const el = contextMenuRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    contextMenuPos.value = clampContextMenuPosition(
      contextMenuPos.value.x,
      contextMenuPos.value.y,
      rect.width || menuWidth,
      rect.height || menuHeight,
    );
  });
}

function onGlobalMouseDown(ev: MouseEvent) {
  const target = ev.target as HTMLElement;
  if (target.closest('[data-model-tree-context-menu="true"]')) return;
  if (target.closest('[data-model-tree-popover="true"]')) return;
  if (target.closest('[data-model-tree-popover-trigger="true"]')) return;

  closeContextMenu();
  searchPopoverOpen.value = false;
  typePopoverOpen.value = false;
}

onMounted(async () => {
  window.addEventListener('mousedown', onGlobalMouseDown);

  // 等待 DOM 渲染完成后，强制 virtualizer 重新测量滚动容器
  // 解决初始化时 containerRef 为 null 导致虚拟列表无法正确计算可见区域的问题
  await nextTick();
  if (containerRef.value) {
    rowVirtualizer.value.measure();
  }

  (window as any).__plant3dModelTreeE2E = {
    focusRefno: focusPdmsTreeRefnoForE2E,
    getSnapshot: getPdmsTreeE2ESnapshot,
  };

  // 监听自动定位事件 (from ViewerPanel via auto_locate_refno URL param)
  const handleAutoLocate = async (event: Event) => {
    const customEvent = event as CustomEvent<{ refno: string }>;
    const refno = customEvent.detail?.refno;
    
    if (!refno) return;
    
    console.log('[ModelTreePanel] autoLocateRefno event received:', refno);
    
    try {
      // 1. 先在树中定位
      await pdmsTree.focusNodeById(refno);
      
      console.log('[ModelTreePanel] Node located in tree:', refno);

      // 1.5. 设置全局 selection 触发树滚动居中
      if (isRefnoLike(refno)) {
        selection.setSelectedRefno(normalizeRefnoKeyLike(refno));
      }
      
      // 2. 然后调用 show-by-refno 加载模型
      if (isRefnoLike(refno) && modelGenerationState.value) {
        const exists = modelGenerationState.value.checkRefnoExists(refno);
        
        if (!exists) {
          console.log('[ModelTreePanel] Auto-loading model for:', refno);
          const success = await modelGenerationState.value.showModelByRefno(refno, { flyTo: true });
          
          if (success) {
            console.log('[ModelTreePanel] Auto-load successful:', refno);
            await pdmsTree.setVisible(refno, true);
          } else {
            console.error('[ModelTreePanel] Auto-load failed:', refno);
          }
        } else {
          console.log('[ModelTreePanel] Model already loaded:', refno);
        }
      }
    } catch (error) {
      console.error('[ModelTreePanel] Auto-locate error:', error);
    }
  };
  
  window.addEventListener('autoLocateRefno', handleAutoLocate);
  
  // 清理函数将在 onUnmounted 中处理
  (window as any).__autoLocateHandler = handleAutoLocate;

  const handleTreeDiffContext = (event: Event) => {
    applyTreeDiffContext((event as CustomEvent).detail);
  };
  window.addEventListener(MODEL_VERSION_TREE_DIFF_EVENT, handleTreeDiffContext);
  (window as any).__treeDiffContextHandler = handleTreeDiffContext;
});

onUnmounted(() => {
  window.removeEventListener('mousedown', onGlobalMouseDown);
  
  // 清理自动定位事件监听器
  const handler = (window as any).__autoLocateHandler;
  if (handler) {
    window.removeEventListener('autoLocateRefno', handler);
    delete (window as any).__autoLocateHandler;
  }

  const treeDiffHandler = (window as any).__treeDiffContextHandler;
  if (treeDiffHandler) {
    window.removeEventListener(MODEL_VERSION_TREE_DIFF_EVENT, treeDiffHandler);
    delete (window as any).__treeDiffContextHandler;
  }

  delete (window as any).__plant3dModelTreeE2E;
});

const typesButtonLabel = computed(() => {
  const size = pdmsTree.selectedTypes.value.size;
  if (size === 0) return '类型：全部';
  if (size === 1) {
    const only = Array.from(pdmsTree.selectedTypes.value)[0];
    return `类型：${only}`;
  }
  return `类型：已选 ${size} 个`;
});

const typePanelOpen = ref(false);

function toggleTypePanel() {
  typePanelOpen.value = !typePanelOpen.value;
}

function toggleSearchPopover() {
  searchPopoverOpen.value = !searchPopoverOpen.value;
  if (searchPopoverOpen.value) {
    typePopoverOpen.value = false;
  }
}

function toggleTypePopover() {
  typePopoverOpen.value = !typePopoverOpen.value;
  if (typePopoverOpen.value) {
    searchPopoverOpen.value = false;
  }
}

function onWheelStop(ev: WheelEvent) {
  ev.stopPropagation();
}

function onMouseDownStop(ev: MouseEvent) {
  ev.stopPropagation();
}

function onTouchStartStop(ev: TouchEvent) {
  ev.stopPropagation();
}

function clearFilters() {
  setFilter('');
  setTypeQuery('');
  pdmsTree.selectedTypes.value = new Set();

  searchPopoverOpen.value = false;
  typePopoverOpen.value = false;
}

/** 切页签：PDMS 的两个弹层与右键菜单一起收起，别挂在「房间」页上；记住这一页。 */
function switchTab(tab: ModelTreeTab) {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  writeModelTreeTab(tab);
  searchPopoverOpen.value = false;
  typePopoverOpen.value = false;
  closeContextMenu();
}

function getSearchItemId(item: unknown): string {
  return String((item as { refno?: unknown }).refno ?? '');
}

function getSearchItemSubtitle(item: unknown): string {
  const noun = String((item as { noun?: unknown }).noun ?? '');
  const id = getSearchItemId(item);
  return `${noun} · ${id}`;
}

let pickClickTimer: number | null = null;
let focusAndCenterSeq = 0;

function normalizeRefnoKeyLike(id: string): string {
  // 与项目其它处保持一致：统一使用 "_" refno 格式，并兼容后端/调试输出中的 record id 包装。
  // - 123/456, 123,456 -> 123_456
  // - pe:⟨12345_67890⟩ / pe:<12345_67890> -> 12345_67890
  // - =123/456 -> 123_456
  const raw = String(id || '').trim();
  if (!raw) return '';
  const wrapped = raw.match(/[⟨<]([^⟩>]+)[⟩>]/)?.[1] ?? raw;
  const core = wrapped.replace(/^pe:/i, '').replace(/^=/, '');
  return core.replace(/\//g, '_').replace(/,/g, '_');
}

function normalizeCompareRefno(raw: unknown): string {
  return normalizeRefnoKeyLike(String(raw ?? ''));
}

/** 应用一份树内差异上下文；`models` / `refnos` 都为空视为退出差异模式（见 `MODEL_VERSION_TREE_DIFF_EVENT`）。 */
function applyTreeDiffContext(rawDetail: unknown) {
  const detail = rawDetail as {
    project?: unknown;
    dbnum?: unknown;
    fromSesno?: unknown;
    toSesno?: unknown;
    mode?: unknown;
    refnos?: unknown;
    models?: unknown;
    attributesAt?: unknown;
  };
  const refnos = Array.isArray(detail?.refnos)
    ? detail.refnos.map(normalizeCompareRefno).filter(Boolean)
    : [];
  // 可选字段按「有才带」条件展开：`TreeDiffModel` 的这些字段是 `?:`，写成 `字段: undefined` 会让映射出来的类型变成
  // 「必有该键、值可为 undefined」，`TreeDiffModel` 反过来就装不进去（TS2677 类型谓词不成立）。
  const models: TreeDiffModel[] = Array.isArray(detail?.models)
    ? detail.models
      .map((model: unknown): TreeDiffModel | null => {
        const item = model as Partial<TreeDiffModel> | null | undefined;
        const refno = normalizeCompareRefno(item?.refno);
        if (!refno) return null;
        const ownerRefno = normalizeCompareRefno(item?.ownerRefno);
        return {
          refno,
          ...(item?.category !== undefined ? { category: item.category } : {}),
          ...(item?.status !== undefined ? { status: item.status } : {}),
          ...(item?.beforeState !== undefined ? { beforeState: item.beforeState } : {}),
          ...(item?.afterState !== undefined ? { afterState: item.afterState } : {}),
          ...(item?.sourceChangeCount !== undefined ? { sourceChangeCount: item.sourceChangeCount } : {}),
          ...(item?.sourceNouns !== undefined ? { sourceNouns: item.sourceNouns } : {}),
          ...(ownerRefno ? { ownerRefno } : {}),
        };
      })
      .filter((item): item is TreeDiffModel => item !== null)
    : [];
  const mergedRefnos = Array.from(new Set([
    ...refnos,
    ...models.map((item) => item.refno),
  ]));
  if (mergedRefnos.length === 0) {
    exitDiffMode();
    return;
  }

  const resolved = treeDiff.apply({
    project: typeof detail.project === 'string' ? detail.project : undefined,
    dbnum: Number.isFinite(Number(detail.dbnum)) ? Number(detail.dbnum) : undefined,
    fromSesno: Number.isFinite(Number(detail.fromSesno)) ? Number(detail.fromSesno) : undefined,
    toSesno: Number.isFinite(Number(detail.toSesno)) ? Number(detail.toSesno) : undefined,
    mode: typeof detail.mode === 'string' ? detail.mode : undefined,
    refnos: mergedRefnos,
    models: models.length > 0 ? models : mergedRefnos.map((refno) => ({ refno })),
    // 属性历史对比的取数口（派发方闭包住两份版本几何）；不是函数就当没给，底部那块不显示
    attributesAt: typeof detail.attributesAt === 'function' ? (detail.attributesAt as TreeDiffAttributesAt) : undefined,
  });
  const first = mergedRefnos[0] ?? null;
  if (first) {
    const firstModel = models.find((item) => item.refno === first);
    const firstStatus = normalizeTreeDiffStatus(firstModel?.status);
    if (firstStatus === 'deleted' && !pdmsTree.nodesById.value[first]) {
      // 第一条变更就是被删的（tombstone 单元里常见）：当前会话里必然没有它，不用等解析
      selectDeletedRefno(first);
    } else if (pdmsTree.nodesById.value[first]) {
      selection.setSelectedRefno(first);
    } else {
      // 还不知道它在不在当前会话：新增 / 修改的构件也可能在 B 版之后又被删了。等路径解析落定再决定走哪条
      // 登记，免得先发一次注定 404 的 element/attributes（§5.2 那条红条就是这么来的）。
      void resolved.then(() => {
        // 解析这段时间里用户可能已经换了选中、或退出了差异模式
        if (!treeDiff.isActive.value || treeDiff.selectedRefno.value !== first) return;
        if (pdmsTree.nodesById.value[first]) selection.setSelectedRefno(first);
        else selectDeletedRefno(first);
      });
    }
  }
}

/**
 * 「在 3D 中定位」（差异模式底部属性历史对比面板）：飞到该构件在版本对比 A / B 隔离图层里的包围盒
 * （`plant3d:model-unit-version-compare` 的 `focus`，两层都找，被删的构件在 A 层也找得到），不往主层装当前模型。
 */
function locateModelVersionCompareRefno(refno: string): void {
  const target = normalizeCompareRefno(refno);
  if (!target) return;
  treeDiff.select(target);
  ensurePanelAndActivate('viewer');
  window.dispatchEvent(new CustomEvent(MODEL_UNIT_VERSION_COMPARE_EVENT, { detail: { action: 'focus', refno: target } }));
}

async function focusAndCenterInTree(id: string) {
  const seq = ++focusAndCenterSeq;
  const targetId = normalizeRefnoKeyLike(id);

  try {
    // “搜索结果定位”仅需在树里展开/选中并滚动到居中；避免触发三维飞行与场景选中同步。
    await pdmsTree.focusNodeById(targetId, { flyTo: false, syncSceneSelection: false, clearSearch: false });
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[model-tree] focusAndCenterInTree failed', e);
    }
  }

  // 等待展开祖先导致的 flatRows/virtualizer 更新
  await nextTick();
  if (seq !== focusAndCenterSeq) return;
  if (containerRef.value) {
    rowVirtualizer.value.measure();
  }
  await nextTick();
  if (seq !== focusAndCenterSeq) return;

  const idx = displayRows.value.findIndex((r) => r.id === targetId);
  if (idx < 0) return;

  const v = rowVirtualizer.value as unknown as { scrollToIndex?: (index: number, opts?: unknown) => void };
  if (typeof v.scrollToIndex === 'function') {
    v.scrollToIndex(idx, { align: 'center' });
    // 二次校正：首次滚动通常使用 estimateSize，等目标项渲染后再测量+再次居中更稳。
    await nextTick();
    if (seq !== focusAndCenterSeq) return;
    if (containerRef.value) {
      rowVirtualizer.value.measure();
    }
    v.scrollToIndex(idx, { align: 'center' });
    return;
  }
  if (containerRef.value) {
    // fallback：估算居中位置
    const rowH = 32;
    const center = containerRef.value.clientHeight / 2 - rowH / 2;
    containerRef.value.scrollTop = Math.max(0, idx * rowH - center);
  }
}

async function onPickSearchItem(refno: string) {
  const targetId = normalizeRefnoKeyLike(refno);
  try {
    await pdmsTree.focusNodeById(targetId);
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[model-tree] focusNodeById failed', e);
    }
  }
}

function onPickSearchItemClick(refno: string) {
  // 区分单击/双击：避免双击触发两次后端查询与 focus。
  if (pickClickTimer !== null) {
    clearTimeout(pickClickTimer);
  }
  pickClickTimer = window.setTimeout(() => {
    pickClickTimer = null;
    void onPickSearchItem(refno);
  }, 220);
}

function onPickSearchItemDblClick(refno: string) {
  if (pickClickTimer !== null) {
    clearTimeout(pickClickTimer);
    pickClickTimer = null;
  }
  void (async () => {
    await focusAndCenterInTree(refno);
    // “回到模型树显示”：关闭弹窗，露出树列表
    searchPopoverOpen.value = false;
    typePopoverOpen.value = false;
  })();
}

function onClearXray() {
  clearXrayScene();
  closeContextMenu();
}

function isolate() {
  if (!contextNodeId.value) return;
  isolateXray(contextNodeId.value);
  closeContextMenu();
}

function focus() {
  if (!contextNodeId.value) return;
  flyTo(contextNodeId.value);
  closeContextMenu();
}

async function showNode() {
  if (!contextNodeId.value) return;
  const id = contextNodeId.value;

  // 右键“显示”是显式操作：若是 PDMS refno，则优先触发加载并飞行聚焦。
  if (isRefnoLike(id) && modelGenerationState.value && !DEBUG_SKIP_EYE_AUTO_GENERATE) {
    try {
      await modelGenerationState.value.showModelByRefno(id, { flyTo: true });
    } finally {
      await pdmsTree.setVisible(id, true);
    }
  } else {
    await setVisible(id, true);
  }

  closeContextMenu();
}

async function regenerateNode() {
  if (!contextNodeId.value || !modelGenerationState.value) return;
  const id = normalizeRefnoKeyLike(contextNodeId.value);
  if (!isRefnoLike(id)) return;
  closeContextMenu();
  if (!window.confirm(`确认重新生成 ${id} 及其模型子树？`)) return;

  setNodeLoading(id, true);
  try {
    const success = await modelGenerationState.value.showModelByRefno(id, {
      flyTo: true,
      regenerate: true,
    });
    if (success) await pdmsTree.setVisible(id, true);
  } finally {
    setNodeLoading(id, false);
  }
}

function hideNode() {
  if (!contextNodeId.value) return;
  setVisible(contextNodeId.value, false);
  closeContextMenu();
}

function showPtset() {
  if (!contextNodeId.value) return;
  const refno = treeNodeRefno(contextNodeId.value);
  if (refno) {
    toolStore.requestPtsetVisualization(refno);
    ensurePanelAndActivate('ptset');
  }
  closeContextMenu();
}

function viewProperties() {
  if (!contextNodeId.value) return;
  const refno = treeNodeRefno(contextNodeId.value);
  if (refno) {
    selection.setSelectedRefno(refno);
    ensurePanelAndActivate('properties');
  }
  closeContextMenu();
}

/**
 * 「查看历史版本」：把这个构件交给版本对比面板。面板自己解它所属的最小交付单元——树里点的多半是
 * 单元里的某个构件（FTUB / BOX…），不是单元根。
 */
function viewVersionHistory() {
  if (!contextNodeId.value) return;
  const refno = treeNodeRefno(contextNodeId.value);
  if (refno) {
    requestModelVersionInspect(refno);
    ensurePanelAndActivate('modelVersionCompare');
  }
  closeContextMenu();
}

// MBD 标注：右键菜单已移除

function onSearchEnter(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;

  // 如果输入的是 RefNo 格式，直接尝试定位，无需等待搜索结果
  if (isRefnoLike(trimmed)) {
    console.log(`[ModelTreePanel] Enter pressed with RefNo-like input: ${trimmed}, triggering direct focus`);
    void onPickSearchItem(trimmed);
    // 可选：关闭搜索框
    searchPopoverOpen.value = false;
  }
}

</script>

<template>
  <div class="flex h-full flex-col"
    @wheel.passive="onWheelStop"
    @mousedown="onMouseDownStop"
    @touchstart.passive="onTouchStartStop">
    <div class="sticky top-0 z-20 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div class="relative flex items-center gap-2">
        <div class="flex h-8 items-center rounded-md bg-muted p-1 text-muted-foreground" data-testid="model-tree-tabs">
          <button type="button"
            class="inline-flex h-full items-center justify-center rounded-sm px-3 text-xs font-medium transition-colors"
            :class="isPdmsTab ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'"
            data-testid="model-tree-tab-pdms"
            @mousedown.stop
            @click="switchTab('pdms')">
            PDMS
          </button>
          <button type="button"
            class="inline-flex h-full items-center justify-center rounded-sm px-3 text-xs font-medium transition-colors"
            :class="!isPdmsTab ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground'"
            title="在册房间 → 专业 → 最小交付单元 → 构件（服务端聚合，ADR 0068）"
            data-testid="model-tree-tab-room"
            @mousedown.stop
            @click="switchTab('room')">
            房间
          </button>
        </div>

        <GenModelV1HealthBadge v-if="showGenModelV1Badge" />

        <div class="flex-1" />

        <div v-if="isPdmsTab" class="flex items-center gap-0.5">
          <button type="button"
            data-model-tree-popover-trigger="true"
            class="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            :class="searchPopoverOpen ? 'bg-muted text-foreground' : ''"
            @mousedown.stop
            @click="toggleSearchPopover">
            <Search class="h-3.5 w-3.5" />
          </button>

          <button type="button"
            data-model-tree-popover-trigger="true"
            class="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            :class="typePopoverOpen ? 'bg-muted text-foreground' : ''"
            @mousedown.stop
            @click="toggleTypePopover">
            <Filter class="h-3.5 w-3.5" />
          </button>

          <button type="button"
            data-model-tree-popover-trigger="true"
            class="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            @mousedown.stop
            @click="clearFilters">
            <X class="h-3.5 w-3.5" />
          </button>
        </div>

        <div v-if="searchPopoverOpen"
          data-model-tree-popover="true"
          class="absolute left-0 top-full mt-2 w-full rounded-md border border-border bg-background p-2 shadow-md">
          <input class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            placeholder="按名称搜索"
            :value="filterText"
            @input="setFilter(($event.target as HTMLInputElement).value)"
            @keydown.enter="onSearchEnter(($event.target as HTMLInputElement).value)" />

          <div v-if="searchLoading || searchError || (searchItems && searchItems.length > 0)" class="mt-2">
            <div v-if="searchLoading" class="text-sm text-muted-foreground">搜索中...</div>
            <div v-else-if="searchError" class="text-sm text-destructive">{{ searchError }}</div>
            <div v-else class="max-h-56 overflow-auto">
              <button v-for="item in searchItems"
                :key="getSearchItemId(item)"
                type="button"
                class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                @click="onPickSearchItemClick(getSearchItemId(item))"
                @dblclick.prevent="onPickSearchItemDblClick(getSearchItemId(item))">
                <div class="truncate">{{ (item as any).name }}</div>
                <div class="-mt-0.5 truncate text-xs text-muted-foreground">{{ getSearchItemSubtitle(item) }}</div>
              </button>
            </div>
          </div>
        </div>

        <div v-if="typePopoverOpen"
          data-model-tree-popover="true"
          class="absolute left-0 top-full mt-2 w-full rounded-md border border-border bg-background p-2 shadow-md">
          <!-- 名称搜索：与“类型筛选”合并展示，避免用户误以为“搜索类型”会出构件预览结果 -->
          <div class="mb-2 border-b border-border pb-2">
            <input class="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              placeholder="按名称搜索（至少 2 个字符）"
              :value="filterText"
              @input="setFilter(($event.target as HTMLInputElement).value)"
              @keydown.enter="onSearchEnter(($event.target as HTMLInputElement).value)" />

            <div v-if="searchLoading || searchError || (searchItems && searchItems.length > 0)" class="mt-2">
              <div v-if="searchLoading" class="text-sm text-muted-foreground">搜索中...</div>
              <div v-else-if="searchError" class="text-sm text-destructive">{{ searchError }}</div>
              <div v-else class="max-h-40 overflow-auto">
                <button v-for="item in searchItems"
                  :key="getSearchItemId(item)"
                  type="button"
                  class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  @click="onPickSearchItemClick(getSearchItemId(item))"
                  @dblclick.prevent="onPickSearchItemDblClick(getSearchItemId(item))">
                  <div class="truncate">{{ (item as any).name }}</div>
                  <div class="-mt-0.5 truncate text-xs text-muted-foreground">{{ getSearchItemSubtitle(item) }}</div>
                </button>
              </div>
            </div>
          </div>

          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm">{{ typesButtonLabel }}</span>
            <div class="flex items-center gap-1">
              <button type="button"
                class="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                @click="selectAllTypes">
                全选
              </button>
              <button type="button"
                class="rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                @click="clearAllTypes">
                清除
              </button>
            </div>
          </div>
          <input class="mb-2 h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            placeholder="搜索类型（仅过滤类型）"
            :value="typeQuery"
            @input="setTypeQuery(($event.target as HTMLInputElement).value)" />

          <div class="max-h-56 overflow-auto pr-1">
            <!-- 预定义类型 -->
            <div class="mb-1 text-xs text-muted-foreground">常用类型</div>
            <template v-for="t in NOUN_TYPES.filter(n => !typeQuery || n.toLowerCase().includes(typeQuery.toLowerCase()))" :key="t">
              <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                <input type="checkbox"
                  class="h-4 w-4"
                  :checked="isTypeSelected(t)"
                  @change="toggleType(t)" />
                <span class="min-w-0 flex-1 truncate">{{ t }}</span>
              </label>
            </template>

            <!-- 自定义类型 -->
            <template v-if="customTypes.length > 0">
              <div class="mb-1 mt-2 text-xs text-muted-foreground">自定义类型</div>
              <div v-for="t in customTypes" :key="t" class="flex items-center gap-1">
                <label class="flex flex-1 cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                  <input type="checkbox"
                    class="h-4 w-4"
                    :checked="isTypeSelected(t)"
                    @change="toggleType(t)" />
                  <span class="min-w-0 flex-1 truncate">{{ t }}</span>
                </label>
                <button type="button"
                  class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  @click="removeCustomType(t)">
                  <X class="h-3 w-3" />
                </button>
              </div>
            </template>
          </div>

          <!-- 无名构件的名字：默认短名（ZONE 4），勾上显示 E3D 整条默认全名（ZONE 4 of SITE 2） -->
          <div class="mt-2 border-t border-border pt-2">
            <label class="flex items-center gap-2 text-xs text-muted-foreground"
              title="没有名字的构件按 E3D 规则起名：默认显示短名，勾上显示整条（含所属层级）；整条一直挂在行的悬停提示上">
              <input v-model="showFullNames"
                type="checkbox"
                class="h-4 w-4"
                data-testid="model-tree-full-names" />
              无名构件显示全称
            </label>
          </div>

          <!-- 添加自定义类型 -->
          <div class="mt-2 flex items-center gap-1 border-t border-border pt-2">
            <input v-model="customTypeInput" class="h-7 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              placeholder="添加自定义类型"
              @keydown.enter="addCustomType" />
            <button type="button"
              class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              @click="addCustomType">
              <Plus class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 版本差异模式工具条：版本对胶囊 + 差异筛选 chips -->
    <div v-if="diffActive && isPdmsTab"
      class="border-b border-border bg-brand-subtle px-3 py-2"
      data-testid="model-tree-diff-bar">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <GitCompare class="h-3.5 w-3.5 shrink-0 text-brand" />
          <span class="inline-flex shrink-0 items-center rounded-full bg-brand text-brand-foreground px-2 py-0.5 text-[11px] font-medium"
            data-testid="model-tree-diff-version-pill">
            {{ diffVersionLabel }} 差异模式
          </span>
          <span v-if="diffDbLabel" class="truncate font-mono text-[11px] text-brand">{{ diffDbLabel }}</span>
        </div>
        <button type="button"
          class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-brand hover:bg-muted"
          title="退出差异模式"
          data-testid="model-tree-diff-exit"
          @click="exitDiffMode">
          <X class="h-3.5 w-3.5" />
        </button>
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1">
        <button v-for="chip in DIFF_FILTER_CHIPS"
          :key="chip.key"
          type="button"
          class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
          :class="diffFilter === chip.key ? chip.activeCls : 'border-border bg-background text-muted-foreground hover:bg-muted'"
          :data-testid="`model-tree-diff-chip-${chip.key}`"
          @click="treeDiff.setFilter(chip.key)">
          {{ chip.label }}
          <span class="font-mono">{{ diffCounts[chip.key] }}</span>
        </button>
      </div>
      <div v-if="diffResolving" class="mt-1 text-[10px] text-brand" data-testid="model-tree-diff-resolving">
        正在定位变更节点 {{ diffResolveDone }}/{{ diffResolveTotal }}…
      </div>
      <div v-else-if="diffUnplacedCount > 0" class="mt-1 text-[10px] text-warning" data-testid="model-tree-diff-unplaced">
        {{ diffUnplacedCount }} 个变更未能定位到树（已计入统计）
      </div>
    </div>

    <div v-show="isPdmsTab"
      ref="containerRef"
      class="relative min-h-0 flex-1 overflow-auto rounded-md border border-border bg-background p-2">
      <div class="relative w-full"
        :style="{ height: `${totalSize}px` }">
        <div v-for="vr in virtualRows"
          :key="String(vr.key)"
          class="absolute left-0 top-0 w-full"
          :style="{ transform: `translateY(${vr.start}px)` }">
          <ModelTreeRow v-if="rowAt(vr.index)"
            :row="rowAt(vr.index)!"
            :index="vr.index"
            :expanded="isExpanded(rowAt(vr.index)!.id)"
            :selected="isRowSelected(rowAt(vr.index)!)"
            :check-state="getCheckState(rowAt(vr.index)!.id)"
            :loading="isNodeLoading(rowAt(vr.index)!.id)"
            :diff-status="rowAt(vr.index)!.diffStatus"
            :diff-count="rowAt(vr.index)!.diffCount"
            :ghost="rowAt(vr.index)!.ghost"
            :ghost-unplaced="rowAt(vr.index)!.ghostUnplaced"
            :full-names="showFullNames"
            @toggle-expand="toggleExpand"
            @toggle-visible="setVisible"
            @select="selectByRowIndex"
            @context="openContextMenu" />
        </div>
      </div>
    </div>

    <!-- 「房间」页签（ADR 0068）：在册房间平铺 + 展开一间房是服务端聚合的层级树；v-show 常驻，切回来状态还在 -->
    <RoomTreePanel v-show="!isPdmsTab"
      class="min-h-0 flex-1"
      :viewer="props.viewer"
      :active="!isPdmsTab" />

    <!-- 版本差异模式：选中变更构件在 A / B 两版下的属性逐项对比（取数口随差异上下文来，没有就不显示） -->
    <ModelVersionAttrDiffPanel v-if="isPdmsTab && diffActive && diffSelectedModel && diffContext?.attributesAt"
      class="max-h-[45%] shrink-0"
      :model="diffSelectedModel"
      :from-sesno="diffContext?.fromSesno"
      :to-sesno="diffContext?.toSesno"
      :attributes-at="diffContext?.attributesAt"
      @locate="locateModelVersionCompareRefno" />

    <!-- 右键菜单 - 使用 Teleport 渲染到 body -->
    <Teleport to="body">
      <div v-if="contextMenuOpen"
        ref="contextMenuRef"
        data-model-tree-context-menu="true"
        :class="cn('fixed z-[9999] w-44 rounded-md border border-border bg-background p-1 shadow-md')"
        :style="{ left: `${contextMenuPos.x}px`, top: `${contextMenuPos.y}px` }">
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="focus">
          聚焦飞行
        </button>
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="isolate">
          隔离（XRAY 其它）
        </button>
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="onClearXray">
          取消隔离
        </button>
        <div class="my-1 h-px bg-border" />
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="showNode">
          显示
        </button>
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="hideNode">
          隐藏
        </button>
        <button v-if="contextNodeId && isRefnoLike(contextNodeId)" type="button"
          data-testid="model-tree-regenerate-model"
          :data-refno="contextNodeId"
          class="w-full rounded px-2 py-1 text-left text-sm text-warning hover:bg-muted"
          @click="regenerateNode">
          重新生成模型
        </button>
        <div class="my-1 h-px bg-border" />
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="showPtset">
          显示点集
        </button>
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          @click="viewProperties">
          查看属性
        </button>
        <button type="button"
          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
          data-testid="model-tree-view-version-history"
          @click="viewVersionHistory">
          查看历史版本
        </button>
      </div>
    </Teleport>

    <!-- Model Generation Progress Modal -->
    <ModelGenerationProgressModal v-if="modelGenerationState"
      :open="modelGenerationState.isGenerating.value && modelGenerationState.showProgressModal.value"
      :progress="modelGenerationState.progress.value"
      :status="modelGenerationState.statusMessage.value"
      :error="modelGenerationState.error.value"
      :total-count="modelGenerationState.totalCount.value"
      :current-index="modelGenerationState.currentIndex.value"
      :current-refno="modelGenerationState.currentRefno.value"
      @close="modelGenerationState.showProgressModal.value = false" />
  </div>
</template>
