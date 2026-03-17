import { computed, reactive, ref, watch, type Ref } from 'vue';

import {
  queryNearbyByPosition,
  querySpatialIndex,
  type SpatialQueryResult as ApiSpatialQueryResult,
  type SpatialQueryResultItem as ApiSpatialQueryResultItem,
} from '@/api/genModelSpatialApi';
import {
  findNounByRefnoAcrossAllDbnos,
  findSpecValueByRefnoAcrossAllDbnos,
} from '@/composables/useDbnoInstancesDtxLoader';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import {
  type SpatialQueryAabb,
  type SpatialQueryCenterSource,
  type SpatialQueryDraft,
  type SpatialQueryFilters,
  type SpatialQueryMode,
  type SpatialQueryPoint,
  type SpatialQueryRequest,
  type SpatialQueryResultGroup,
  type SpatialQueryResultItem,
  type SpatialQueryResultSet,
  type SpatialQueryShape,
  type SpatialQuerySortBy,
  type SpatialQueryStatus,
} from '@/types/spatialQuery';
import { getSpecValueName } from '@/types/spec';

type ViewerLike = {
  scene: {
    objects: Record<string, { id: string; visible?: boolean; aabb?: [number, number, number, number, number, number] }>;
    objectIds: string[];
    selectedObjectIds: string[];
    getLoadedRefnos?: () => string[];
    getAABB: (refnos: string[]) => [number, number, number, number, number, number] | null;
    setObjectsVisible: (refnos: string[], visible: boolean) => void;
    setObjectsSelected: (refnos: string[], selected: boolean) => void;
    setObjectsXRayed: (refnos: string[], xrayed: boolean) => void;
    ensureRefnos: (refnos: string[]) => void;
  };
  cameraFlight: {
    flyTo: (options: { aabb?: [number, number, number, number, number, number] | null; duration?: number; fit?: boolean }) => void;
  };
};

type SelectionLike = {
  selectedRefno: Ref<string | null>;
};

type ToolStoreLike = {
  pickedQueryCenter: Ref<{ entityId: string; worldPos: [number, number, number] } | null>;
  setToolMode: (mode: string) => void;
  setPickedQueryCenter: (value: { entityId: string; worldPos: [number, number, number] } | null) => void;
};

type SpatialQueryStoreOptions = {
  viewerRef?: Ref<ViewerLike | null>;
  selection?: SelectionLike;
  toolStore?: ToolStoreLike;
  queryNearbyByPosition?: typeof queryNearbyByPosition;
  querySpatialIndex?: typeof querySpatialIndex;
  createRequestId?: () => string;
};

function createDefaultDraft(): SpatialQueryDraft {
  return {
    mode: 'distance',
    rangeCenterSource: 'selected',
    distanceCenterSource: 'refno',
    refno: '',
    center: { x: 0, y: 0, z: 0 },
    radius: 5000,
    shape: 'sphere',
    nounText: '',
    keyword: '',
    onlyLoaded: false,
    onlyVisible: false,
    specValues: [],
    limit: 100,
  };
}

function normalizeNounText(nounText: string): string[] {
  return nounText
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function aabbToCenter(aabb: [number, number, number, number, number, number]): SpatialQueryPoint {
  return {
    x: (aabb[0] + aabb[3]) / 2,
    y: (aabb[1] + aabb[4]) / 2,
    z: (aabb[2] + aabb[5]) / 2,
  };
}

function aabbToStruct(aabb: [number, number, number, number, number, number] | undefined | null): SpatialQueryAabb | null {
  if (!aabb) return null;
  return {
    min: { x: aabb[0], y: aabb[1], z: aabb[2] },
    max: { x: aabb[3], y: aabb[4], z: aabb[5] },
  };
}

function bboxToAabb6(bbox: SpatialQueryAabb | null | undefined): [number, number, number, number, number, number] | null {
  if (!bbox) return null;
  return [bbox.min.x, bbox.min.y, bbox.min.z, bbox.max.x, bbox.max.y, bbox.max.z];
}

function distanceBetweenPoints(a: SpatialQueryPoint, b: SpatialQueryPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function includesKeyword(refno: string, noun: string, keyword: string): boolean {
  if (!keyword) return true;
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return refno.toLowerCase().includes(needle) || noun.toLowerCase().includes(needle);
}

function toSpecName(specValue: number): string {
  return getSpecValueName(specValue);
}

function createRequestId(): string {
  return `spatial-query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveLoadedRefnos(viewer: ViewerLike): string[] {
  return typeof viewer.scene.getLoadedRefnos === 'function'
    ? viewer.scene.getLoadedRefnos()
    : viewer.scene.objectIds.slice();
}

function sortItems(items: SpatialQueryResultItem[], sortBy: SpatialQuerySortBy): SpatialQueryResultItem[] {
  const copy = items.slice();

  if (sortBy === 'nameAsc') {
    return copy.sort((a, b) => String(a.name || a.refno).localeCompare(String(b.name || b.refno)));
  }

  if (sortBy === 'specThenDistance') {
    return copy.sort((a, b) => {
      if (a.specValue !== b.specValue) return a.specValue - b.specValue;
      return (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER);
    });
  }

  return copy.sort((a, b) => (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER));
}

function buildGroups(items: SpatialQueryResultItem[]): SpatialQueryResultGroup[] {
  const grouped = new Map<number, SpatialQueryResultItem[]>();
  for (const item of items) {
    const list = grouped.get(item.specValue) ?? [];
    list.push(item);
    grouped.set(item.specValue, list);
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([specValue, groupedItems]) => ({
      specValue,
      specName: toSpecName(specValue),
      count: groupedItems.length,
      items: groupedItems,
    }));
}

function makeFilters(draft: SpatialQueryDraft): SpatialQueryFilters {
  return {
    nouns: normalizeNounText(draft.nounText),
    keyword: draft.keyword.trim(),
    onlyLoaded: draft.onlyLoaded,
    onlyVisible: draft.onlyVisible,
    specValues: draft.specValues.slice(),
  };
}

function parseRequestMode(draft: SpatialQueryDraft): { centerSource: SpatialQueryCenterSource; sortBy: SpatialQuerySortBy } {
  if (draft.mode === 'range') {
    return {
      centerSource: draft.rangeCenterSource,
      sortBy: 'specThenDistance',
    };
  }
  return {
    centerSource: draft.distanceCenterSource,
    sortBy: 'distanceAsc',
  };
}

function matchFilters(item: { refno: string; noun: string; specValue: number; loaded: boolean; visible: boolean }, filters: SpatialQueryFilters): boolean {
  if (filters.onlyLoaded && !item.loaded) return false;
  if (filters.onlyVisible && !item.visible) return false;
  if (filters.nouns.length > 0 && !filters.nouns.includes(item.noun.toUpperCase())) return false;
  if (filters.specValues.length > 0 && !filters.specValues.includes(item.specValue)) return false;
  if (!includesKeyword(item.refno, item.noun, filters.keyword)) return false;
  return true;
}

function toSpatialItemFromApi(item: ApiSpatialQueryResultItem, loaded: boolean, visible: boolean): SpatialQueryResultItem {
  const bbox = item.aabb ? {
    min: { x: item.aabb.min.x, y: item.aabb.min.y, z: item.aabb.min.z },
    max: { x: item.aabb.max.x, y: item.aabb.max.y, z: item.aabb.max.z },
  } : null;
  const position = bbox ? aabbToCenter([
    bbox.min.x, bbox.min.y, bbox.min.z,
    bbox.max.x, bbox.max.y, bbox.max.z,
  ]) : null;

  return {
    refno: item.refno,
    noun: item.noun || 'UNKNOWN',
    specValue: item.spec_value ?? 0,
    specName: toSpecName(item.spec_value ?? 0),
    distance: typeof item.distance === 'number' ? item.distance : null,
    loaded,
    visible,
    matchedBy: loaded ? 'merged' : 'server-spatial-index',
    position,
    bbox,
    name: item.refno,
    sourceModel: null,
  };
}

export function createSpatialQueryStore(options: SpatialQueryStoreOptions = {}) {
  const viewerRef = options.viewerRef ?? useViewerContext().viewerRef;
  const selection = options.selection ?? useSelectionStore();
  const toolStore = options.toolStore ?? useToolStore();
  const queryNearby = options.queryNearbyByPosition ?? queryNearbyByPosition;
  const queryByIndex = options.querySpatialIndex ?? querySpatialIndex;
  const nextRequestId = options.createRequestId ?? createRequestId;

  const draft = reactive<SpatialQueryDraft>(createDefaultDraft());
  const status = ref<SpatialQueryStatus>('idle');
  const error = ref<string | null>(null);
  const resultSet = ref<SpatialQueryResultSet | null>(null);
  const activeResultRefno = ref<string | null>(null);

  watch(
    () => toolStore.pickedQueryCenter.value,
    (picked) => {
      if (!picked) return;
      draft.center = {
        x: picked.worldPos[0],
        y: picked.worldPos[1],
        z: picked.worldPos[2],
      };
      draft.rangeCenterSource = 'pick';
    },
    { deep: true }
  );

  const canSubmit = computed(() => {
    if (draft.mode === 'distance' && draft.distanceCenterSource === 'refno') {
      return draft.refno.trim().length > 0 && draft.radius > 0;
    }
    return Number.isFinite(draft.center.x) && Number.isFinite(draft.center.y) && Number.isFinite(draft.center.z) && draft.radius > 0;
  });

  function resetQuery() {
    Object.assign(draft, createDefaultDraft());
    status.value = 'idle';
    error.value = null;
    resultSet.value = null;
    activeResultRefno.value = null;
  }

  function clearResults() {
    resultSet.value = null;
    activeResultRefno.value = null;
  }

  function setMode(mode: SpatialQueryMode) {
    draft.mode = mode;
  }

  function applyCurrentSelection() {
    const viewer = viewerRef.value;
    if (!viewer) {
      error.value = '查看器未就绪';
      return;
    }
    const selectedRefno = selection.selectedRefno.value || viewer.scene.selectedObjectIds[0] || null;
    if (!selectedRefno) {
      error.value = '请先选中一个模型';
      return;
    }
    const aabb = viewer.scene.getAABB([selectedRefno]);
    if (!aabb) {
      error.value = '无法解析当前选中构件的位置';
      return;
    }
    draft.center = aabbToCenter(aabb);
    draft.rangeCenterSource = 'selected';
    draft.refno = selectedRefno;
    error.value = null;
  }

  function startPickCenter() {
    toolStore.setPickedQueryCenter(null);
    toolStore.setToolMode('pick_query_center');
  }

  function normalizeRequestFromCenter(center: SpatialQueryPoint, centerSource: SpatialQueryCenterSource): SpatialQueryRequest {
    const filters = makeFilters(draft);
    const { sortBy } = parseRequestMode(draft);
    return {
      mode: draft.mode,
      centerSource,
      center,
      radius: draft.radius,
      shape: draft.mode === 'distance' ? 'sphere' : draft.shape,
      filters,
      limit: draft.limit,
      sortBy,
      refno: draft.distanceCenterSource === 'refno' ? draft.refno.trim() || undefined : undefined,
    };
  }

  function queryLocal(viewer: ViewerLike, request: SpatialQueryRequest): SpatialQueryResultItem[] {
    const refnos = resolveLoadedRefnos(viewer);
    const results: SpatialQueryResultItem[] = [];
    const radius = request.radius;
    const minx = request.center.x - radius;
    const miny = request.center.y - radius;
    const minz = request.center.z - radius;
    const maxx = request.center.x + radius;
    const maxy = request.center.y + radius;
    const maxz = request.center.z + radius;

    for (const refno of refnos) {
      const aabb = viewer.scene.getAABB([refno]) || viewer.scene.objects[refno]?.aabb || null;
      if (!aabb) continue;
      const center = aabbToCenter(aabb);
      const distance = distanceBetweenPoints(center, request.center);
      const intersectsCube =
        aabb[3] >= minx && aabb[0] <= maxx &&
        aabb[4] >= miny && aabb[1] <= maxy &&
        aabb[5] >= minz && aabb[2] <= maxz;
      const intersectsSphere = distance <= radius;
      const matchShape = request.shape === 'cube' ? intersectsCube : intersectsSphere;
      if (!matchShape) continue;

      const noun = findNounByRefnoAcrossAllDbnos(refno) || 'UNKNOWN';
      const specValue = findSpecValueByRefnoAcrossAllDbnos(refno) ?? 0;
      const visible = viewer.scene.objects[refno]?.visible !== false;
      const item = {
        refno,
        noun,
        specValue,
        loaded: true,
        visible,
      };
      if (!matchFilters(item, request.filters)) continue;

      results.push({
        refno,
        noun,
        specValue,
        specName: toSpecName(specValue),
        distance,
        loaded: true,
        visible,
        matchedBy: 'viewer-local',
        position: center,
        bbox: aabbToStruct(aabb),
        name: refno,
        sourceModel: null,
      });
    }

    return results;
  }

  function mergeResults(request: SpatialQueryRequest, localItems: SpatialQueryResultItem[], serverResp: ApiSpatialQueryResult | null): SpatialQueryResultSet {
    const merged = new Map<string, SpatialQueryResultItem>();
    const loadedRefnos = new Set(localItems.map((item) => item.refno));
    const warnings: string[] = [];

    for (const item of localItems) {
      merged.set(item.refno, item);
    }

    if (serverResp?.truncated) {
      warnings.push('服务端结果已按最大结果数截断');
    }

    for (const raw of serverResp?.results ?? []) {
      const existing = merged.get(raw.refno);
      const visible = existing?.visible ?? true;
      const loaded = loadedRefnos.has(raw.refno);
      const normalized = toSpatialItemFromApi(raw, loaded, visible);

      if (existing) {
        merged.set(raw.refno, {
          ...normalized,
          ...existing,
          noun: existing.noun !== 'UNKNOWN' ? existing.noun : normalized.noun,
          specValue: existing.specValue !== 0 ? existing.specValue : normalized.specValue,
          specName: existing.specValue !== 0 ? existing.specName : normalized.specName,
          distance: existing.distance ?? normalized.distance,
          matchedBy: 'merged',
          bbox: existing.bbox ?? normalized.bbox,
          position: existing.position ?? normalized.position,
          loaded: true,
        });
        continue;
      }

      if (!matchFilters({
        refno: normalized.refno,
        noun: normalized.noun,
        specValue: normalized.specValue,
        loaded: normalized.loaded,
        visible: normalized.visible,
      }, request.filters)) {
        continue;
      }

      merged.set(raw.refno, normalized);
    }

    const items = sortItems(Array.from(merged.values()), request.sortBy).slice(0, request.limit);
    const loadedCount = items.filter((item) => item.loaded).length;
    const unloadedCount = items.length - loadedCount;

    return {
      request,
      items,
      total: items.length,
      loadedCount,
      unloadedCount,
      truncated: !!serverResp?.truncated,
      warnings,
      groups: buildGroups(items),
    };
  }

  async function resolveRequest(): Promise<{ request: SpatialQueryRequest; serverFallbackRefno?: string }> {
    status.value = 'resolving-center';
    const viewer = viewerRef.value;
    const centerSource = parseRequestMode(draft).centerSource;

    if (draft.mode === 'distance' && centerSource === 'refno') {
      const refno = draft.refno.trim();
      if (!refno) {
        throw new Error('请输入起始物项 Refno');
      }
      const aabb = viewer?.scene.getAABB([refno]) ?? null;
      if (!aabb) {
        return {
          request: normalizeRequestFromCenter(draft.center, centerSource),
          serverFallbackRefno: refno,
        };
      }
      draft.center = aabbToCenter(aabb);
      return { request: normalizeRequestFromCenter(draft.center, centerSource) };
    }

    if (centerSource === 'selected') {
      applyCurrentSelection();
      if (error.value) throw new Error(error.value);
      return { request: normalizeRequestFromCenter(draft.center, centerSource) };
    }

    if (centerSource === 'pick') {
      const picked = toolStore.pickedQueryCenter.value;
      if (!picked) {
        throw new Error('请先拾取查询中心点');
      }
      draft.center = {
        x: picked.worldPos[0],
        y: picked.worldPos[1],
        z: picked.worldPos[2],
      };
      return { request: normalizeRequestFromCenter(draft.center, centerSource) };
    }

    return { request: normalizeRequestFromCenter(draft.center, centerSource) };
  }

  async function submitQuery() {
    error.value = null;
    activeResultRefno.value = null;

    try {
      const viewer = viewerRef.value;
      const { request, serverFallbackRefno } = await resolveRequest();
      let localItems: SpatialQueryResultItem[] = [];
      let serverResp: ApiSpatialQueryResult | null = null;

      if (viewer && !serverFallbackRefno) {
        status.value = 'querying-local';
        localItems = queryLocal(viewer, request);
      }

      status.value = 'querying-server';
      const serverOptions = {
        nouns: request.filters.nouns.length > 0 ? request.filters.nouns.join(',') : undefined,
        max_results: request.limit,
        shape: request.shape,
      };

      if (serverFallbackRefno) {
        serverResp = await queryByIndex({
          mode: 'refno',
          refno: serverFallbackRefno,
          distance: request.radius,
          include_self: false,
          nouns: serverOptions.nouns,
          max_results: serverOptions.max_results,
          shape: serverOptions.shape,
        });
      } else {
        serverResp = await queryNearby(request.center.x, request.center.y, request.center.z, request.radius, serverOptions);
      }

      if (!serverResp.success) {
        throw new Error(serverResp.error || '空间查询失败');
      }

      status.value = 'merging-results';
      resultSet.value = mergeResults(request, localItems, serverResp);

      if (serverFallbackRefno) {
        resultSet.value.warnings.push('起始 Refno 未在当前 Viewer 中加载，已回退为服务端 Refno 周边查询');
      }

      status.value = 'ready';
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      status.value = 'error';
      clearResults();
    }
  }

  async function ensureResultLoaded(item: SpatialQueryResultItem): Promise<void> {
    if (item.loaded) return;
    const requestId = nextRequestId();
    const result = await showModelByRefnosWithAck({
      refnos: [item.refno],
      flyTo: false,
      requestId,
      timeoutMs: 10_000,
      ensureViewerReady: true,
      viewerRef: viewerRef as Ref<unknown | null>,
    });
    if (result.error || result.fail.length > 0 || result.ok.length === 0) {
      throw new Error(result.error || result.fail[0]?.error || `加载模型失败: ${item.refno}`);
    }

    const currentItem = resultSet.value?.items.find((entry) => entry.refno === item.refno);
    if (currentItem) {
      currentItem.loaded = true;
      currentItem.visible = true;
    }
  }

  async function activateResult(item: SpatialQueryResultItem) {
    const ready = await waitForViewerReady({ timeoutMs: 4_000, viewerRef: viewerRef as Ref<unknown | null> });
    const viewer = viewerRef.value;
    if (!ready || !viewer) {
      error.value = '查看器未就绪';
      status.value = 'error';
      return;
    }

    try {
      status.value = 'loading-model-for-result';
      await ensureResultLoaded(item);

      status.value = 'flying-to-result';
      const previous = viewer.scene.selectedObjectIds.slice();
      if (previous.length > 0) {
        viewer.scene.setObjectsSelected(previous, false);
      }
      viewer.scene.ensureRefnos([item.refno]);
      viewer.scene.setObjectsVisible([item.refno], true);
      viewer.scene.setObjectsSelected([item.refno], true);

      const aabb = viewer.scene.getAABB([item.refno]) ?? bboxToAabb6(item.bbox);
      if (aabb) {
        viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
      }

      activeResultRefno.value = item.refno;
      const currentItem = resultSet.value?.items.find((entry) => entry.refno === item.refno);
      if (currentItem) {
        currentItem.loaded = true;
        currentItem.visible = true;
      }
      status.value = 'ready';
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      status.value = 'error';
    }
  }

  function toggleResultVisible(item: SpatialQueryResultItem) {
    const viewer = viewerRef.value;
    if (!viewer) return;
    const nextVisible = !item.visible;
    viewer.scene.setObjectsVisible([item.refno], nextVisible);
    item.visible = nextVisible;
  }

  function setAllResultsVisible(visible: boolean) {
    const viewer = viewerRef.value;
    const items = resultSet.value?.items ?? [];
    if (!viewer || items.length === 0) return;
    viewer.scene.setObjectsVisible(items.map((item) => item.refno), visible);
    items.forEach((item) => {
      item.visible = visible;
    });
  }

  function isolateResults() {
    const viewer = viewerRef.value;
    const items = resultSet.value?.items ?? [];
    if (!viewer || items.length === 0) return;
    const all = viewer.scene.objectIds.slice();
    if (all.length > 0) {
      viewer.scene.setObjectsXRayed(all, true);
    }
    const keep = items.map((item) => item.refno);
    if (keep.length > 0) {
      viewer.scene.setObjectsXRayed(keep, false);
      viewer.scene.setObjectsVisible(keep, true);
      items.forEach((item) => {
        item.visible = true;
      });
    }
  }

  function restoreScene() {
    const viewer = viewerRef.value;
    if (!viewer) return;
    const all = viewer.scene.objectIds.slice();
    if (all.length > 0) {
      viewer.scene.setObjectsXRayed(all, false);
    }
  }

  return {
    draft,
    status,
    error,
    resultSet,
    activeResultRefno,
    canSubmit,
    setMode,
    applyCurrentSelection,
    startPickCenter,
    submitQuery,
    resetQuery,
    clearResults,
    activateResult,
    toggleResultVisible,
    setAllResultsVisible,
    isolateResults,
    restoreScene,
  };
}

let sharedSpatialQueryStore: ReturnType<typeof createSpatialQueryStore> | null = null;

export function useSpatialQuery() {
  if (!sharedSpatialQueryStore) {
    sharedSpatialQueryStore = createSpatialQueryStore();
  }
  return sharedSpatialQueryStore;
}
