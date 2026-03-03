<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { useVirtualizer } from '@tanstack/vue-virtual';
import { Filter, Plus, Search, X } from 'lucide-vue-next';
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer';

import { pdmsSearch, type PdmsSearchItem } from '@/api/genModelSearchApi';
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
  viewer: DtxCompatViewer | null;
}>();

const activeTree = ref<'pdms' | 'room'>('pdms');

const pdmsViewerRef = shallowRef<DtxCompatViewer | null>(props.viewer);
const roomViewerRef = shallowRef<DtxCompatViewer | null>(null);

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
// 房间树仅在 tab=room 时启用，避免其副作用影响 PDMS 模型树（显隐/选中回放等）
const roomTree = useRoomTree(roomViewerRef, computed(() => activeTree.value === 'room'));

// Register the global tree instance for console commands
setModelTreeInstance(pdmsTree);


const selection = useSelectionStore();
const toolStore = useToolStore();

const isRoomTree = computed(() => activeTree.value === 'room');

// Debug: 用于排查点击 eye（显示/隐藏）导致卡死的问题。
// - true: 禁用“显示时自动 showModelByRefno 加载/生成”，仅走树的 setVisible。
// - false: 保持原行为。
const DEBUG_SKIP_EYE_AUTO_GENERATE = false;

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
  const shouldTryGenerate = !DEBUG_SKIP_EYE_AUTO_GENERATE && !isRoomTree.value && visible && modelGenerationState.value;

  if (shouldTryGenerate) {
    // Check if it looks like a refno (123/456 or 123_456)
    // If it's a refno, we try to auto-generate if missing
    if (isRefnoLike(id)) {
      // eye 的“显示”也应支持 auto fit：
      // - 若已加载：showModelByRefno 会直接用 AABB flyTo
      // - 若未加载：showModelByRefno 会加载完成后 flyTo
      const success = await modelGenerationState.value!.showModelByRefno(id, { flyTo: true });

      if (success) {
        // 模型已加载成功：同步树的勾选状态（eye 图标）并确保可见。
        // 这样后续点击 eye 只会切换 visible，不会再次触发 show-by-refno。
        await pdmsTree.setVisible(id, true);
        return;
      }
      // 失败时继续调用 setVisible 显示部分加载的数据
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
  // 约定：全局 selection（属性面板/查询等）只绑定 PDMS refno，房间树 id 不写入
  if (isRoomTree.value) return;
  if (selected.size !== 1) return;
  const only = Array.from(selected)[0];
  if (!only || !isRefnoLike(only)) return;

  internalTreeSelection = true;
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

// ========================
// 类型筛选：查看过滤结果（分组面板）
// - 通过后端 /api/search/pdms（Meilisearch）做可分页查询
// - 支持“按 SITE(dbnum) 分组”开关
// ========================
type FilterGroupState = {
  open: boolean;
  total: number;
  offset: number;
  items: PdmsSearchItem[];
  loading: boolean;
  error: string | null;
};

type SiteGroupState = {
  open: boolean;
  total: number;
  nounCounts: Record<string, number>;
  nounLoading: boolean;
  nounError: string | null;
  nounGroups: Record<string, FilterGroupState>;
};

const filterResultsOpen = ref(false);
const filterResultsGroupBySite = ref(true);
const filterResultsLoading = ref(false);
const filterResultsError = ref<string | null>(null);
const filterResultsFacet = ref<Record<string, Record<string, number>> | null>(null);

const nounGroups = ref<Record<string, FilterGroupState>>({});
const siteGroups = ref<Record<string, SiteGroupState>>({});

const FILTER_RESULTS_PAGE_SIZE = 200;

function selectedPdmsNouns(): string[] {
  if (isRoomTree.value) return [];
  return Array.from(pdmsTree.selectedTypes.value).map((t) => String(t || '').trim().toUpperCase()).filter(Boolean);
}

function currentKeyword(): string | undefined {
  const q = String(filterText.value || '').trim();
  return q ? q : undefined;
}

async function refreshFilterResultsFacets() {
  if (isRoomTree.value) return;

  const nouns = selectedPdmsNouns();
  if (nouns.length === 0) {
    filterResultsFacet.value = null;
    nounGroups.value = {};
    siteGroups.value = {};
    return;
  }

  filterResultsLoading.value = true;
  filterResultsError.value = null;
  try {
    const resp = await pdmsSearch({
      keyword: currentKeyword(),
      nouns,
      offset: 0,
      limit: 1,
      facets: true,
    });
    if (!resp.success) {
      filterResultsFacet.value = null;
      filterResultsError.value = resp.error_message || 'search failed';
      return;
    }

    filterResultsFacet.value = resp.facet_distribution || null;

    const nounFacet = (resp.facet_distribution && resp.facet_distribution['noun']) || {};
    const siteFacet = (resp.facet_distribution && resp.facet_distribution['site']) || {};

    // 初始化 nounGroups（用于“无 SITE 分组”模式）
    const nextNounGroups: Record<string, FilterGroupState> = {};
    for (const noun of nouns) {
      nextNounGroups[noun] = {
        open: false,
        total: Number(nounFacet[noun] ?? 0),
        offset: 0,
        items: [],
        loading: false,
        error: null,
      };
    }
    nounGroups.value = nextNounGroups;

    // 初始化 siteGroups（用于“按 SITE 分组”模式）
    const nextSiteGroups: Record<string, SiteGroupState> = {};
    const sites = Object.keys(siteFacet).sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
    for (const site of sites) {
      nextSiteGroups[site] = {
        open: false,
        total: Number(siteFacet[site] ?? 0),
        nounCounts: {},
        nounLoading: false,
        nounError: null,
        nounGroups: {},
      };
    }
    siteGroups.value = nextSiteGroups;
  } catch (e) {
    filterResultsFacet.value = null;
    filterResultsError.value = e instanceof Error ? e.message : String(e);
  } finally {
    filterResultsLoading.value = false;
  }
}

async function openFilterResults() {
  if (isRoomTree.value) return;
  filterResultsOpen.value = true;
  searchPopoverOpen.value = false;
  typePopoverOpen.value = false;
  await refreshFilterResultsFacets();
}

function closeFilterResults() {
  filterResultsOpen.value = false;
}

async function loadNounGroup(noun: string, opts?: { site?: string; append?: boolean }) {
  if (isRoomTree.value) return;

  const append = opts?.append ?? false;
  const site = opts?.site;

  const key = String(noun || '').trim().toUpperCase();
  if (!key) return;

  const group = site
    ? siteGroups.value[site]?.nounGroups?.[key]
    : nounGroups.value[key];
  if (!group) return;

  group.loading = true;
  group.error = null;
  try {
    const resp = await pdmsSearch({
      keyword: currentKeyword(),
      nouns: [key],
      site,
      offset: append ? group.offset : 0,
      limit: FILTER_RESULTS_PAGE_SIZE,
      facets: false,
    });
    if (!resp.success) {
      group.error = resp.error_message || 'search failed';
      return;
    }

    const nextItems = Array.isArray(resp.items) ? resp.items : [];
    group.total = typeof resp.total === 'number' ? resp.total : group.total;
    group.items = append ? group.items.concat(nextItems) : nextItems;
    group.offset = group.items.length;
  } catch (e) {
    group.error = e instanceof Error ? e.message : String(e);
  } finally {
    group.loading = false;
  }
}

async function toggleNounGroupOpen(noun: string) {
  const key = String(noun || '').trim().toUpperCase();
  const group = nounGroups.value[key];
  if (!group) return;
  group.open = !group.open;
  if (group.open && group.items.length === 0 && !group.loading) {
    await loadNounGroup(key);
  }
}

async function toggleSiteGroupOpen(site: string) {
  const s = String(site || '').trim();
  const siteGroup = siteGroups.value[s];
  if (!siteGroup) return;

  siteGroup.open = !siteGroup.open;
  if (!siteGroup.open) return;

  // 首次展开：加载该 site 下的 noun facet（用于二级分组计数）
  if (Object.keys(siteGroup.nounCounts).length === 0 && !siteGroup.nounLoading) {
    const nouns = selectedPdmsNouns();
    siteGroup.nounLoading = true;
    siteGroup.nounError = null;
    try {
      const resp = await pdmsSearch({
        keyword: currentKeyword(),
        nouns,
        site: s,
        offset: 0,
        limit: 1,
        facets: true,
      });
      if (!resp.success) {
        siteGroup.nounError = resp.error_message || 'search failed';
        return;
      }
      const nounFacet = (resp.facet_distribution && resp.facet_distribution['noun']) || {};
      siteGroup.nounCounts = nounFacet;

      const next: Record<string, FilterGroupState> = {};
      for (const noun of nouns) {
        next[noun] = {
          open: false,
          total: Number(nounFacet[noun] ?? 0),
          offset: 0,
          items: [],
          loading: false,
          error: null,
        };
      }
      siteGroup.nounGroups = next;
    } catch (e) {
      siteGroup.nounError = e instanceof Error ? e.message : String(e);
    } finally {
      siteGroup.nounLoading = false;
    }
  }
}

async function toggleSiteNounGroupOpen(site: string, noun: string) {
  const s = String(site || '').trim();
  const key = String(noun || '').trim().toUpperCase();
  const siteGroup = siteGroups.value[s];
  const group = siteGroup?.nounGroups?.[key];
  if (!siteGroup || !group) return;

  group.open = !group.open;
  if (group.open && group.items.length === 0 && !group.loading) {
    await loadNounGroup(key, { site: s });
  }
}

let filterResultsRefreshTimer: number | null = null;

// 面板打开时：随筛选条件变化自动刷新分组（轻量防抖）
watch(
  () => [
    filterResultsOpen.value,
    filterResultsGroupBySite.value,
    String(filterText.value || '').trim(),
    isRoomTree.value ? '' : Array.from(pdmsTree.selectedTypes.value).sort().join('|'),
  ] as const,
  ([open]) => {
    if (!open) return;
    if (filterResultsRefreshTimer !== null) {
      clearTimeout(filterResultsRefreshTimer);
    }
    filterResultsRefreshTimer = window.setTimeout(() => {
      filterResultsRefreshTimer = null;
      void refreshFilterResultsFacets();
    }, 250);
  },
);

// 切换 tab 时关闭结果面板，避免“PDMS 结果”挂在 ROOM 上
watch(
  () => activeTree.value,
  () => {
    filterResultsOpen.value = false;
  },
);

const rowVirtualizer = useVirtualizer({
  count: flatRows.value.length,
  getScrollElement: () => containerRef.value,
  estimateSize: () => 32,
  overscan: 10
});

const activeRootId = computed(() => (isRoomTree.value ? roomTree.rootIds.value[0] : pdmsTree.rootIds.value[0]));

let selectionSyncSeq = 0;
let internalTreeSelection = false;

watch(
  () => [selection.selectedRefno.value, activeTree.value, activeRootId.value] as const,
  ([refno, tab]) => {
    selectionSyncSeq++;
    const seq = selectionSyncSeq;

    // 树内点击选中时不需要展开/滚动定位，只有外部选中才需要
    if (internalTreeSelection) {
      internalTreeSelection = false;
      return;
    }

    if (!refno || !isRefnoLike(refno)) return;

    void (async () => {
      const targetId = tab === 'room' ? refno : normalizeRefnoKeyLike(refno);
      try {
        if (tab === 'room') {
          const already = roomTree.selectedIds.value.size === 1 && roomTree.selectedIds.value.has(targetId);
          if (!already) {
            await roomTree.focusNodeById(targetId, { flyTo: false, syncSceneSelection: false, clearSearch: false });
          }
        } else {
          const already = pdmsTree.selectedIds.value.size === 1 && pdmsTree.selectedIds.value.has(targetId);
          if (!already) {
            await pdmsTree.focusNodeById(targetId, { flyTo: false, syncSceneSelection: false, clearSearch: false });
          }
        }
      } catch {
        void 0;
      }

      await nextTick();
      if (seq !== selectionSyncSeq) return;

      if (containerRef.value) rowVirtualizer.value.measure();
      await nextTick();
      if (seq !== selectionSyncSeq) return;

      const idx = flatRows.value.findIndex((r) => r.id === targetId);
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
  () => flatRows.value.length,
  async (count) => {
    // console.log('[ModelTreePanel] flatRows.length changed:', count);
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

onMounted(async () => {
  window.addEventListener('mousedown', onGlobalMouseDown);

  // 等待 DOM 渲染完成后，强制 virtualizer 重新测量滚动容器
  // 解决初始化时 containerRef 为 null 导致虚拟列表无法正确计算可见区域的问题
  await nextTick();
  if (containerRef.value) {
    rowVirtualizer.value.measure();
  }

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

      // 1.5. 设置全局 selection 触发树滚动居中
      if (!isRoomTree.value && isRefnoLike(refno)) {
        selection.setSelectedRefno(normalizeRefnoKeyLike(refno));
      }
      
      // 2. 然后调用 show-by-refno 加载模型
      if (!isRoomTree.value && isRefnoLike(refno) && modelGenerationState.value) {
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

async function focusAndCenterInTree(id: string) {
  const seq = ++focusAndCenterSeq;
  const targetId = isRoomTree.value ? id : normalizeRefnoKeyLike(id);

  try {
    // “搜索结果定位”仅需在树里展开/选中并滚动到居中；避免触发三维飞行与场景选中同步。
    if (isRoomTree.value) {
      await roomTree.focusNodeById(targetId, { flyTo: false, syncSceneSelection: false, clearSearch: false });
    } else {
      await pdmsTree.focusNodeById(targetId, { flyTo: false, syncSceneSelection: false, clearSearch: false });
    }
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

  const idx = flatRows.value.findIndex((r) => r.id === targetId);
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
  const targetId = isRoomTree.value ? refno : normalizeRefnoKeyLike(refno);
  try {
    if (isRoomTree.value) {
      await roomTree.focusNodeById(targetId);
    } else {
      await pdmsTree.focusNodeById(targetId);
    }
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
  if (!isRoomTree.value && isRefnoLike(id) && modelGenerationState.value && !DEBUG_SKIP_EYE_AUTO_GENERATE) {
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

// MBD 标注：右键菜单可用的 noun 类型
const MBD_NOUNS = new Set(['BRAN', 'HANG', 'PIPE'])

const contextNodeCanMbd = computed(() => {
  if (isRoomTree.value) return false;
  const id = contextNodeId.value;
  if (!id || !isRefnoLike(id)) return false;
  const node = pdmsTree.nodesById.value[id];
  return !!node && MBD_NOUNS.has(node.type);
})

function generateMbd() {
  if (!contextNodeId.value) return;
  if (isRefnoLike(contextNodeId.value)) {
    toolStore.requestMbdPipeAnnotation(contextNodeId.value);
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
            placeholder="搜索类型（仅过滤类型）"
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

          <!-- 应用：打开“过滤结果分组”面板（筛选本身已即时生效） -->
          <div v-if="!isRoomTree" class="mt-2 flex items-center justify-between border-t border-border pt-2">
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox"
                class="h-4 w-4"
                v-model="filterResultsGroupBySite" />
              按 SITE 分组
            </label>
            <button type="button"
              class="rounded-md bg-muted px-3 py-1 text-sm text-foreground hover:bg-muted/70"
              @click="openFilterResults">
              应用
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 过滤结果面板：按 SITE(dbnum) / noun 分组展示；单击/双击可定位到树 -->
    <div v-if="filterResultsOpen && !isRoomTree"
      class="mb-2 rounded-md border border-border bg-background p-2">
      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-sm font-medium">过滤结果（{{ filterResultsGroupBySite ? '按 SITE 分组' : '按类型分组' }}）</div>
          <div class="truncate text-xs text-muted-foreground">
            已选类型：{{ Array.from(pdmsTree.selectedTypes.value).join(', ') || '（无）' }}
            <span v-if="filterText && String(filterText).trim()"> · 关键字：{{ String(filterText).trim() }}</span>
          </div>
        </div>
        <button type="button"
          class="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          @click="closeFilterResults">
          关闭
        </button>
      </div>

      <div class="mt-2">
        <div v-if="filterResultsLoading" class="text-sm text-muted-foreground">加载中...</div>
        <div v-else-if="filterResultsError" class="text-sm text-destructive">{{ filterResultsError }}</div>

        <template v-else>
          <!-- 按类型分组 -->
          <div v-if="!filterResultsGroupBySite" class="space-y-2">
            <div v-for="(g, noun) in nounGroups" :key="noun" class="rounded border border-border/60">
              <button type="button"
                class="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-muted"
                @click="toggleNounGroupOpen(noun)">
                <div class="truncate text-sm">{{ noun }}</div>
                <div class="text-xs text-muted-foreground">{{ g.total }}</div>
              </button>
              <div v-if="g.open" class="border-t border-border/60 p-2">
                <div v-if="g.loading" class="text-sm text-muted-foreground">加载中...</div>
                <div v-else-if="g.error" class="text-sm text-destructive">{{ g.error }}</div>
                <div v-else class="max-h-56 overflow-auto">
                  <button v-for="item in g.items"
                    :key="item.refno"
                    type="button"
                    class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                    @click="onPickSearchItemClick(item.refno)"
                    @dblclick.prevent="() => { onPickSearchItemDblClick(item.refno); filterResultsOpen = false; }">
                    <div class="truncate">{{ item.name }}</div>
                    <div class="-mt-0.5 truncate text-xs text-muted-foreground">{{ item.noun }} · {{ item.refno }}</div>
                  </button>
                  <button v-if="g.items.length < g.total"
                    type="button"
                    class="mt-1 w-full rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                    @click="loadNounGroup(noun, { append: true })">
                    查看更多（{{ g.items.length }}/{{ g.total }}）
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 按 SITE 分组 -->
          <div v-else class="space-y-2">
            <div v-for="(sg, site) in siteGroups" :key="site" class="rounded border border-border/60">
              <button type="button"
                class="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-muted"
                @click="toggleSiteGroupOpen(site)">
                <div class="truncate text-sm">SITE {{ site }}</div>
                <div class="text-xs text-muted-foreground">{{ sg.total }}</div>
              </button>

              <div v-if="sg.open" class="border-t border-border/60 p-2">
                <div v-if="sg.nounLoading" class="text-sm text-muted-foreground">加载分组中...</div>
                <div v-else-if="sg.nounError" class="text-sm text-destructive">{{ sg.nounError }}</div>

                <div v-else class="space-y-2">
                  <div v-for="(g, noun) in sg.nounGroups" :key="`${site}_${noun}`" class="rounded border border-border/40">
                    <button type="button"
                      class="flex w-full items-center justify-between gap-2 px-2 py-1 text-left hover:bg-muted"
                      @click="toggleSiteNounGroupOpen(site, noun)">
                      <div class="truncate text-sm">{{ noun }}</div>
                      <div class="text-xs text-muted-foreground">{{ g.total }}</div>
                    </button>
                    <div v-if="g.open" class="border-t border-border/40 p-2">
                      <div v-if="g.loading" class="text-sm text-muted-foreground">加载中...</div>
                      <div v-else-if="g.error" class="text-sm text-destructive">{{ g.error }}</div>
                      <div v-else class="max-h-48 overflow-auto">
                        <button v-for="item in g.items"
                          :key="item.refno"
                          type="button"
                          class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                          @click="onPickSearchItemClick(item.refno)"
                          @dblclick.prevent="() => { onPickSearchItemDblClick(item.refno); filterResultsOpen = false; }">
                          <div class="truncate">{{ item.name }}</div>
                          <div class="-mt-0.5 truncate text-xs text-muted-foreground">{{ item.noun }} · {{ item.refno }}</div>
                        </button>
                        <button v-if="g.items.length < g.total"
                          type="button"
                          class="mt-1 w-full rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                          @click="loadNounGroup(noun, { site, append: true })">
                          查看更多（{{ g.items.length }}/{{ g.total }}）
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="Object.keys(siteGroups).length === 0" class="text-sm text-muted-foreground">
              无结果
            </div>
          </div>
        </template>
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
        <template v-if="contextNodeCanMbd">
          <div class="my-1 h-px bg-border" />
          <button type="button"
            class="w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
            @click="generateMbd">
            生成 MBD 标注
          </button>
        </template>
      </div>
    </Teleport>

    <!-- Model Generation Progress Modal -->
    <ModelGenerationProgressModal 
      v-if="modelGenerationState"
      :open="modelGenerationState.isGenerating.value && modelGenerationState.showProgressModal.value"
      :progress="modelGenerationState.progress.value"
      :status="modelGenerationState.statusMessage.value"
      :error="modelGenerationState.error.value"
      :total-count="modelGenerationState.totalCount.value"
      :current-index="modelGenerationState.currentIndex.value"
      :current-refno="modelGenerationState.currentRefno.value"
      @close="modelGenerationState.showProgressModal.value = false"
    />
  </div>
</template>
