<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { useVirtualizer } from '@tanstack/vue-virtual';
import type { Viewer } from '@xeokit/xeokit-sdk';
import { Filter, Plus, Search, X } from 'lucide-vue-next';

import ModelGenerationProgressModal from '@/components/model-tree/ModelGenerationProgressModal.vue';
import ModelTreeRow from '@/components/model-tree/ModelTreeRow.vue';
import { useModelGeneration } from '@/composables/useModelGeneration';
import { usePdmsOwnerTree, NOUN_TYPES } from '@/composables/usePdmsOwnerTree';
import { useRoomTree } from '@/composables/useRoomTree';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { setModelTreeInstance } from '@/composables/useModelTreeStore';
import { ensurePanelAndActivate } from '@/composables/useDockApi';
import { cn } from '@/lib/utils';

const props = defineProps<{
  viewer: Viewer | null;
}>();

const activeTree = ref<'pdms' | 'room'>('pdms');

const pdmsViewerRef = shallowRef<Viewer | null>(props.viewer);
const roomViewerRef = shallowRef<Viewer | null>(null);

console.log('[ModelTreePanel] initial props.viewer:', props.viewer ? 'exists' : 'null');

watch(
  () => [props.viewer, activeTree.value] as const,
  ([v, t]) => {
    console.log('[ModelTreePanel] watch triggered, viewer:', v ? 'exists' : 'null', 'activeTree:', t);
    pdmsViewerRef.value = t === 'pdms' ? v : null;
    roomViewerRef.value = t === 'room' ? v : null;
  },
  { immediate: true }
);

const pdmsTree = usePdmsOwnerTree(pdmsViewerRef);
const roomTree = useRoomTree(roomViewerRef);

// Register the global tree instance for console commands
setModelTreeInstance(pdmsTree);


const selection = useSelectionStore();
const toolStore = useToolStore();

const isRoomTree = computed(() => activeTree.value === 'room');

const expandedIds = computed(() => (isRoomTree.value ? roomTree.expandedIds.value : pdmsTree.expandedIds.value));
const flatRows = computed(() => (isRoomTree.value ? roomTree.flatRows.value : pdmsTree.flatRows.value));
const filterText = computed(() => (isRoomTree.value ? roomTree.filterText.value : pdmsTree.filterText.value));
const typeQuery = computed(() => (isRoomTree.value ? roomTree.typeQuery.value : pdmsTree.typeQuery.value));
const filteredTypes = computed(() => (isRoomTree.value ? roomTree.filteredTypes.value : pdmsTree.filteredTypes.value));
const searchLoading = computed(() => (isRoomTree.value ? roomTree.searchLoading.value : pdmsTree.searchLoading.value));
const searchError = computed(() => (isRoomTree.value ? roomTree.searchError.value : pdmsTree.searchError.value));
const searchItems = computed(() => (isRoomTree.value ? roomTree.searchItems.value : pdmsTree.searchItems.value));

function setFilter(text: string) {
  if (isRoomTree.value) {
    roomTree.setFilter(text);
  } else {
    pdmsTree.setFilter(text);
  }
}

function setTypeQuery(text: string) {
  if (isRoomTree.value) {
    roomTree.setTypeQuery(text);
  } else {
    pdmsTree.setTypeQuery(text);
  }
}

function toggleType(type: string) {
  if (isRoomTree.value) {
    roomTree.toggleType(type);
  } else {
    pdmsTree.toggleType(type);
  }
}

function selectAllTypes() {
  if (!isRoomTree.value) {
    pdmsTree.selectAllTypes();
  }
}

function clearAllTypes() {
  if (isRoomTree.value) {
    roomTree.selectedTypes.value = new Set();
  } else {
    pdmsTree.clearAllTypes();
  }
}

const customTypeInput = ref('');

function addCustomType() {
  if (isRoomTree.value) return;
  const success = pdmsTree.addCustomType(customTypeInput.value);
  if (success) {
    customTypeInput.value = '';
  }
}

function removeCustomType(type: string) {
  if (!isRoomTree.value) {
    pdmsTree.removeCustomType(type);
  }
}

const customTypes = computed(() => {
  return isRoomTree.value ? [] : Array.from(pdmsTree.customTypes.value);
});

function toggleExpand(id: string) {
  if (isRoomTree.value) {
    roomTree.toggleExpand(id);
  } else {
    pdmsTree.toggleExpand(id);
  }
}

function getCheckState(id: string) {
  return isRoomTree.value ? roomTree.getCheckState(id) : pdmsTree.getCheckState(id);
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
  const shouldTryGenerate = !isRoomTree.value && visible && modelGenerationState.value;

  if (shouldTryGenerate) {
    // Check if it looks like a refno (123/456 or 123_456)
    // If it's a refno, we try to auto-generate if missing
    if (isRefnoLike(id)) {
      // Check if refno exists in cache
      const exists = modelGenerationState.value!.checkRefnoExists(id);

      if (!exists) {
        // Use showModelByRefno (direct generation without task)
        const success = await modelGenerationState.value!.showModelByRefno(id);

        if (success) {
          // 模型已加载成功：同步树的勾选状态（eye 图标）并确保可见。
          // 这样后续点击 eye 只会切换 visible，不会再次触发 show-by-refno。
          await pdmsTree.setVisible(id, true);
          return;
        }
        // 失败时继续调用 setVisible 显示部分加载的数据
      }
    }
  }

  // Call the original setVisible logic
  if (isRoomTree.value) {
    roomTree.setVisible(id, visible);
  } else {
    await pdmsTree.setVisible(id, visible);
  }
}

function selectByRowIndex(index: number, ev: MouseEvent) {
  if (isRoomTree.value) {
    roomTree.selectByRowIndex(index, ev);
    handleSelectionChanged(roomTree.selectedIds.value);
  } else {
    pdmsTree.selectByRowIndex(index, ev);
    handleSelectionChanged(pdmsTree.selectedIds.value);
  }
}

function isRefnoLike(id: string): boolean {
  // Support 123_456, 123/456, 123,456
  return /^\d+[_\/,]\d+/.test(id);
}

function handleSelectionChanged(selected: Set<string>) {
  if (selected.size !== 1) return;
  const only = Array.from(selected)[0];
  if (!only || !isRefnoLike(only)) return;

  selection.setSelectedRefno(only);
}

function flyTo(id: string) {
  if (isRoomTree.value) {
    roomTree.flyTo(id);
  } else {
    void pdmsTree.flyTo(id);
  }
}

function isolateXray(id: string) {
  if (isRoomTree.value) {
    roomTree.isolateXray(id);
  } else {
    void pdmsTree.isolateXray(id);
  }
}

function clearXrayScene() {
  if (isRoomTree.value) {
    roomTree.clearXray();
  } else {
    pdmsTree.clearXray();
  }
}

function isTypeSelected(type: string) {
  return isRoomTree.value ? roomTree.selectedTypes.value.has(type) : pdmsTree.selectedTypes.value.has(type);
}

function isExpanded(id: string) {
  return expandedIds.value.has(id);
}

function isSelected(id: string) {
  return isRoomTree.value ? roomTree.selectedIds.value.has(id) : pdmsTree.selectedIds.value.has(id);
}

function rowAt(index: number) {
  return flatRows.value[index];
}

const containerRef = ref<HTMLElement | null>(null);
const contextMenuOpen = ref(false);
const contextMenuPos = ref({ x: 0, y: 0 });
const contextNodeId = ref<string | null>(null);

const searchPopoverOpen = ref(false);
const typePopoverOpen = ref(false);

const rowVirtualizer = useVirtualizer({
  count: flatRows.value.length,
  getScrollElement: () => containerRef.value,
  estimateSize: () => 32,
  overscan: 10
});

const activeRootId = computed(() => (isRoomTree.value ? roomTree.rootIds.value[0] : pdmsTree.rootIds.value[0]));

let selectionSyncSeq = 0;

watch(
  () => [selection.selectedRefno.value, activeTree.value, activeRootId.value] as const,
  ([refno, tab]) => {
    selectionSyncSeq++;
    const seq = selectionSyncSeq;

    if (!refno || !isRefnoLike(refno)) return;

    void (async () => {
      try {
        if (tab === 'room') {
          const already = roomTree.selectedIds.value.size === 1 && roomTree.selectedIds.value.has(refno);
          if (!already) {
            await roomTree.focusNodeById(refno, { flyTo: false, syncSceneSelection: false, clearSearch: false });
          }
        } else {
          const already = pdmsTree.selectedIds.value.size === 1 && pdmsTree.selectedIds.value.has(refno);
          if (!already) {
            await pdmsTree.focusNodeById(refno, { flyTo: false, syncSceneSelection: false, clearSearch: false });
          }
        }
      } catch {
        void 0;
      }

      await nextTick();
      if (seq !== selectionSyncSeq) return;

      const idx = flatRows.value.findIndex((r) => r.id === refno);
      if (idx < 0) return;

      const v = rowVirtualizer.value as unknown as { scrollToIndex?: (index: number, opts?: unknown) => void };
      if (typeof v.scrollToIndex === 'function') {
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
  () => flatRows.value.length,
  (count) => {
    console.log('[ModelTreePanel] flatRows.length changed:', count);
    rowVirtualizer.value.setOptions({
      ...rowVirtualizer.value.options,
      count,
    });
    // 强制重新计算虚拟行
    console.log('[ModelTreePanel] virtualRows after setOptions:', rowVirtualizer.value.getVirtualItems());
  },
  { immediate: true }
);

const virtualRows = computed(() => {
  const items = rowVirtualizer.value.getVirtualItems();
  console.log('[ModelTreePanel] virtualRows computed:', items.length, 'items');
  return items;
});
const totalSize = computed(() => rowVirtualizer.value.getTotalSize());

function closeContextMenu() {
  contextMenuOpen.value = false;
  contextNodeId.value = null;
}

function openContextMenu(nodeId: string, ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  contextNodeId.value = nodeId;
  
  // 计算菜单位置，考虑视口边界
  const menuWidth = 176; // w-44 = 11rem = 176px
  const menuHeight = 200; // 预估高度
  
  let x = ev.clientX;
  let y = ev.clientY;
  
  // 检查右边界
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 8;
  }
  
  // 检查下边界
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 8;
  }
  
  // 确保不超出左上边界
  x = Math.max(8, x);
  y = Math.max(8, y);
  
  contextMenuPos.value = { x, y };
  contextMenuOpen.value = true;
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

onMounted(() => {
  window.addEventListener('mousedown', onGlobalMouseDown);
  
  // 监听自动定位事件 (from ViewerPanel via auto_locate_refno URL param)
  const handleAutoLocate = async (event: Event) => {
    const customEvent = event as CustomEvent<{ refno: string }>;
    const refno = customEvent.detail?.refno;
    
    if (!refno) return;
    
    console.log('[ModelTreePanel] autoLocateRefno event received:', refno);
    
    try {
      // 1. 先在树中定位
      if (isRoomTree.value) {
        await roomTree.focusNodeById(refno);
      } else {
        await pdmsTree.focusNodeById(refno);
      }
      
      console.log('[ModelTreePanel] Node located in tree:', refno);
      
      // 2. 然后调用 show-by-refno 加载模型
      if (!isRoomTree.value && isRefnoLike(refno) && modelGenerationState.value) {
        const exists = modelGenerationState.value.checkRefnoExists(refno);
        
        if (!exists) {
          console.log('[ModelTreePanel] Auto-loading model for:', refno);
          const success = await modelGenerationState.value.showModelByRefno(refno);
          
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
});

onUnmounted(() => {
  window.removeEventListener('mousedown', onGlobalMouseDown);
  
  // 清理自动定位事件监听器
  const handler = (window as any).__autoLocateHandler;
  if (handler) {
    window.removeEventListener('autoLocateRefno', handler);
    delete (window as any).__autoLocateHandler;
  }
});

const typesButtonLabel = computed(() => {
  const size = isRoomTree.value ? roomTree.selectedTypes.value.size : pdmsTree.selectedTypes.value.size;
  if (size === 0) return '类型：全部';
  if (size === 1) {
    const only = isRoomTree.value
      ? Array.from(roomTree.selectedTypes.value)[0]
      : Array.from(pdmsTree.selectedTypes.value)[0];
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
  if (isRoomTree.value) {
    roomTree.selectedTypes.value = new Set();
  } else {
    pdmsTree.selectedTypes.value = new Set();
  }

  searchPopoverOpen.value = false;
  typePopoverOpen.value = false;
}

function getSearchItemId(item: unknown): string {
  if (isRoomTree.value) return String((item as { id?: unknown }).id ?? '');
  return String((item as { refno?: unknown }).refno ?? '');
}

function getSearchItemSubtitle(item: unknown): string {
  const noun = String((item as { noun?: unknown }).noun ?? '');
  const id = getSearchItemId(item);
  return `${noun} · ${id}`;
}

async function onPickSearchItem(refno: string) {
  try {
    if (isRoomTree.value) {
      await roomTree.focusNodeById(refno);
    } else {
      await pdmsTree.focusNodeById(refno);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('[model-tree] focusNodeById failed', e);
    }
  }
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

function showNode() {
  if (!contextNodeId.value) return;
  setVisible(contextNodeId.value, true);
  closeContextMenu();
}

function hideNode() {
  if (!contextNodeId.value) return;
  setVisible(contextNodeId.value, false);
  closeContextMenu();
}

function showPtset() {
  if (!contextNodeId.value) return;
  // 只有 refno 格式的节点才能显示点集
  if (isRefnoLike(contextNodeId.value)) {
    toolStore.requestPtsetVisualization(contextNodeId.value);
    ensurePanelAndActivate('ptset');
  }
  closeContextMenu();
}

function viewProperties() {
  if (!contextNodeId.value) return;
  // 只有 refno 格式的节点才能查看属性
  if (isRefnoLike(contextNodeId.value)) {
    // 设置选中的 refno，触发属性面板加载
    selection.setSelectedRefno(contextNodeId.value);
    // 确保属性面板存在并激活
    ensurePanelAndActivate('properties');
  }
  closeContextMenu();
}

function onSearchEnter(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;

  // 如果输入的是 RefNo 格式，直接尝试定位，无需等待搜索结果
  if (isRefnoLike(trimmed)) {
    console.log(`[ModelTreePanel] Enter pressed with RefNo-like input: ${trimmed}, triggering direct focus`);
    onPickSearchItem(trimmed);
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
        <div class="flex h-8 items-center rounded-md bg-muted p-1 text-muted-foreground">
          <button type="button"
            class="inline-flex h-full items-center justify-center rounded-sm px-3 text-xs font-medium transition-all"
            :class="activeTree === 'pdms' ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/50 hover:text-foreground'"
            @click="activeTree = 'pdms'">
            PDMS
          </button>
          <button type="button"
            class="inline-flex h-full items-center justify-center rounded-sm px-3 text-xs font-medium transition-all"
            :class="activeTree === 'room' ? 'bg-background text-foreground shadow-sm' : 'hover:bg-background/50 hover:text-foreground'"
            @click="activeTree = 'room'">
            ROOM
          </button>
        </div>

        <div class="flex-1" />

        <div class="flex items-center gap-0.5">
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
                @click="onPickSearchItem(getSearchItemId(item))">
                <div class="truncate">{{ (item as any).name }}</div>
                <div class="-mt-0.5 truncate text-xs text-muted-foreground">{{ getSearchItemSubtitle(item) }}</div>
              </button>
            </div>
          </div>
        </div>

        <div v-if="typePopoverOpen"
          data-model-tree-popover="true"
          class="absolute left-0 top-full mt-2 w-full rounded-md border border-border bg-background p-2 shadow-md">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm">{{ typesButtonLabel }}</span>
            <div v-if="!isRoomTree" class="flex items-center gap-1">
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
            placeholder="搜索类型"
            :value="typeQuery"
            @input="setTypeQuery(($event.target as HTMLInputElement).value)" />

          <div class="max-h-56 overflow-auto pr-1">
            <!-- 预定义类型 -->
            <div v-if="!isRoomTree" class="mb-1 text-xs text-muted-foreground">常用类型</div>
            <template v-for="t in (isRoomTree ? filteredTypes : NOUN_TYPES.filter(n => !typeQuery || n.toLowerCase().includes(typeQuery.toLowerCase())))" :key="t">
              <label class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                <input type="checkbox"
                  class="h-4 w-4"
                  :checked="isTypeSelected(t)"
                  @change="toggleType(t)" />
                <span class="min-w-0 flex-1 truncate">{{ t }}</span>
              </label>
            </template>

            <!-- 自定义类型 -->
            <template v-if="!isRoomTree && customTypes.length > 0">
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

          <!-- 添加自定义类型 -->
          <div v-if="!isRoomTree" class="mt-2 flex items-center gap-1 border-t border-border pt-2">
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

    <div ref="containerRef"
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
            :selected="isSelected(rowAt(vr.index)!.id)"
            :check-state="getCheckState(rowAt(vr.index)!.id)"
            @toggle-expand="toggleExpand"
            @toggle-visible="setVisible"
            @select="selectByRowIndex"
            @context="openContextMenu" />
        </div>
      </div>
    </div>
    
    <!-- 右键菜单 - 使用 Teleport 渲染到 body -->
    <Teleport to="body">
      <div v-if="contextMenuOpen"
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
      </div>
    </Teleport>

    <!-- Model Generation Progress Modal -->
    <ModelGenerationProgressModal 
      v-if="modelGenerationState"
      :open="modelGenerationState.isGenerating.value"
      :progress="modelGenerationState.progress.value"
      :status="modelGenerationState.statusMessage.value"
      :error="modelGenerationState.error.value"
      :total-count="modelGenerationState.totalCount.value"
      :current-index="modelGenerationState.currentIndex.value"
      :current-refno="modelGenerationState.currentRefno.value"
      @close="modelGenerationState.isGenerating.value = false"
    />
  </div>
</template>
