import { computed, reactive, ref, watch, type Ref } from 'vue';

import { enqueueParquetIncremental } from '@/api/genModelRealtimeApi';
import {
  queryNearbyByRefno,
  queryNearbyByPosition,
  querySpatialIndex,
  type SpatialNearbyResult as ApiSpatialNearbyResult,
  type SpatialQueryResult as ApiSpatialQueryResult,
  type SpatialQueryResultItem as ApiSpatialQueryResultItem,
} from '@/api/genModelSpatialApi';
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  findNounByRefnoAcrossAllDbnos,
  findSpecValueByRefnoAcrossAllDbnos,
  loadDtxAabbProxyRefnos,
  loadDbnoInstancesForVisibleRefnosDtx,
} from '@/composables/useDbnoInstancesDtxLoader';
import { triggerBatchGenerateSse } from '@/composables/useDbnoInstancesJsonLoader';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { AUTO_GENERATION_ENABLED } from '@/composables/useModelGeneration';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import {
  type SpatialQueryAabb,
  type SpatialQueryCenterSource,
  type SpatialQueryDraft,
  type SpatialQueryFilterOptions,
  type SpatialQueryFilters,
  type SpatialQueryMode,
  type SpatialQueryPoint,
  type SpatialQueryRequest,
  type SpatialQueryResultGroup,
  type SpatialQueryResultItem,
  type SpatialQueryResultSet,
  type SpatialQueryServerCenter,
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

type ViewerRuntimeLike = ViewerLike & {
  __dtxLayer?: unknown;
  __dtxAfterInstancesLoaded?: (dbno: number, loadedRefnos: string[]) => void;
};

type SelectionLike = {
  selectedRefno: Ref<string | null>;
};

type ToolStoreLike = {
  pickedQueryCenter: Ref<{ entityId: string; worldPos: [number, number, number] } | null>;
  setToolMode: (mode: string) => void;
  setPickedQueryCenter: (value: { entityId: string; worldPos: [number, number, number] } | null) => void;
};

type BatchLoadOptions = {
  flyTo?: boolean;
};

type BatchLoadResult = {
  ok: string[];
  fail: { refno: string; error: string | null }[];
};

type BatchLoadRefnosFn = (refnos: string[], options?: BatchLoadOptions) => Promise<BatchLoadResult>;

type SpatialQueryStoreOptions = {
  viewerRef?: Ref<ViewerLike | null>;
  selection?: SelectionLike;
  toolStore?: ToolStoreLike;
  queryNearbyByPosition?: typeof queryNearbyByPosition;
  queryNearbyByRefno?: typeof queryNearbyByRefno;
  querySpatialIndex?: typeof querySpatialIndex;
  createRequestId?: () => string;
  batchLoadRefnos?: BatchLoadRefnosFn;
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
    includeNegative: false,
    specValues: [],
    limit: 100,
  };
}

const NEGATIVE_NOUNS = new Set([
  'NBOX',
  'NCYL',
  'NLCY',
  'NSBO',
  'NCON',
  'NSNO',
  'NPYR',
  'NDIS',
  'NXTR',
  'NCTO',
  'NRTO',
  'NREV',
  'NSCY',
  'NSCO',
  'NLSN',
  'NSSP',
  'NSCT',
  'NSRT',
  'NSDS',
  'NSSL',
  'NLPY',
  'NSEX',
  'NSRE',
]);

export type SpatialQueryUrlConfig = {
  refno: string;
  radius: number;
  shape: SpatialQueryShape;
  autorun: boolean;
};

type SpatialQueryUrlStore = {
  draft: SpatialQueryDraft;
  setMode: (mode: SpatialQueryMode) => void;
  resetQuery?: () => void;
};

type SpatialQueryDrawerOpenFn = (
  mode?: SpatialQueryMode,
  options?: { useSelection?: boolean; autoSubmit?: boolean },
) => void;

const SPATIAL_RADIUS_METERS_TO_MM = 1000;

function normalizeUrlRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

function isTruthyFlag(raw: string | null | undefined): boolean {
  const value = String(raw ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function toSearchParams(search: string | URLSearchParams): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  const normalized = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(normalized);
}

export function parseSpatialQueryUrlParams(search: string | URLSearchParams): SpatialQueryUrlConfig | null {
  const params = toSearchParams(search);
  const refno = normalizeUrlRefno(params.get('spatial_refno') || '');
  if (!refno) return null;

  const rawRadius = Number(params.get('spatial_radius'));
  if (!Number.isFinite(rawRadius) || rawRadius <= 0) return null;
  const radiusUnit = String(params.get('spatial_radius_unit') || '').trim().toLowerCase();
  const radius = radiusUnit === 'm' || radiusUnit === 'meter' || radiusUnit === 'meters'
    ? Math.round(rawRadius * SPATIAL_RADIUS_METERS_TO_MM)
    : rawRadius;

  const rawShape = String(params.get('spatial_shape') || 'sphere').trim().toLowerCase();
  const shape: SpatialQueryShape = rawShape === 'cube' ? 'cube' : 'sphere';

  return {
    refno,
    radius,
    shape,
    autorun: isTruthyFlag(params.get('spatial_autorun')),
  };
}

export function applySpatialQueryUrlConfig(store: SpatialQueryUrlStore, config: SpatialQueryUrlConfig): void {
  store.resetQuery?.();
  store.setMode('distance');
  store.draft.distanceCenterSource = 'refno';
  store.draft.refno = config.refno;
  store.draft.radius = config.radius;
  store.draft.shape = config.shape;
}

export function initializeSpatialQueryFromUrl(
  search: string | URLSearchParams,
  store: SpatialQueryUrlStore,
  openDrawer: SpatialQueryDrawerOpenFn,
): boolean {
  const config = parseSpatialQueryUrlParams(search);
  if (!config) return false;

  applySpatialQueryUrlConfig(store, config);
  openDrawer('distance', {
    useSelection: false,
    autoSubmit: config.autorun,
  });
  return true;
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

function isFiniteAabb6(aabb: [number, number, number, number, number, number] | null | undefined): boolean {
  if (!aabb) return false;
  return aabb.every((value) => Number.isFinite(value))
    && aabb[3] >= aabb[0]
    && aabb[4] >= aabb[1]
    && aabb[5] >= aabb[2];
}

function hasRenderableSpatialResult(viewer: ViewerRuntimeLike, refno: string): boolean {
  const normalized = normalizeRefno(refno);
  if (!normalized) return false;

  const sceneAabb = viewer.scene.getAABB([normalized]);
  if (isFiniteAabb6(sceneAabb)) return true;

  const objectAabb = viewer.scene.objects[normalized]?.aabb;
  return isFiniteAabb6(objectAabb);
}

function axisGap(point: number, min: number, max: number): number {
  if (point < min) return min - point;
  if (point > max) return point - max;
  return 0;
}

// 与后端 sqlite_spatial_api.rs 的 aabb_min_distance 口径保持一致：
// 用候选 AABB 到查询点的“最近表面距离”，而非中心到中心距离。
// 否则长管 / 大设备会因为中心较远而在球形查询中被本地误排除，
// 且本地（已加载）与服务端（未加载）结果的距离 / 排序口径会不一致。
function aabbMinDistanceToPoint(
  aabb: [number, number, number, number, number, number],
  point: SpatialQueryPoint,
): number {
  const dx = axisGap(point.x, aabb[0], aabb[3]);
  const dy = axisGap(point.y, aabb[1], aabb[4]);
  const dz = axisGap(point.z, aabb[2], aabb[5]);
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

function normalizeRefno(refno: string): string {
  return String(refno || '').trim().replace(/\//g, '_');
}

function uniqStrings(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const value = normalizeRefno(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function chunkBySize<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const safeSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += safeSize) {
    chunks.push(items.slice(start, start + safeSize));
  }
  return chunks;
}

function resolveLoadedRefnos(viewer: ViewerLike): string[] {
  const primary = typeof viewer.scene.getLoadedRefnos === 'function'
    ? viewer.scene.getLoadedRefnos()
    : viewer.scene.objectIds.slice();
  const withAabb = Object.keys(viewer.scene.objects || {}).filter((refno) => {
    return Array.isArray(viewer.scene.objects[refno]?.aabb);
  });
  return uniqStrings([...primary, ...withAabb]);
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
    includeNegative: draft.includeNegative,
    specValues: draft.specValues.slice(),
  };
}

function shouldIncludeSelf(draft: SpatialQueryDraft): boolean | undefined {
  if (draft.mode === 'distance' && draft.distanceCenterSource === 'refno') {
    return false;
  }
  return undefined;
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
  if (!filters.includeNegative && NEGATIVE_NOUNS.has(item.noun.toUpperCase())) return false;
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

function normalizeServerCenter(center: ApiSpatialQueryResult['center'] | undefined): SpatialQueryServerCenter | null {
  if (!center) return null;
  return {
    x: center.x,
    y: center.y,
    z: center.z,
    source: center.source,
    refno: center.refno,
  };
}

function normalizeServerShape(shape: ApiSpatialQueryResult['shape'] | undefined): SpatialQueryShape | string | null {
  return shape ?? null;
}

function queryBBoxFromResponse(serverResp: ApiSpatialQueryResult | null): SpatialQueryAabb | null {
  return serverResp?.query_bbox
    ? {
      min: { ...serverResp.query_bbox.min },
      max: { ...serverResp.query_bbox.max },
    }
    : null;
}

function normalizeServerFilterOptions(serverResp: ApiSpatialQueryResult | null): SpatialQueryFilterOptions | null {
  const raw = serverResp?.filter_options;
  if (!raw) return null;
  return {
    nouns: raw.nouns.map((option) => ({
      value: option.value,
      count: option.count,
      isNegative: Boolean(option.is_negative),
    })),
    specValues: raw.spec_values.map((option) => ({
      value: option.value,
      count: option.count,
      label: toSpecName(option.value),
    })),
    includeNegative: Boolean(raw.include_negative),
  };
}

function syncResultSetSummary(current: SpatialQueryResultSet): SpatialQueryResultSet {
  const items = sortItems(current.items, current.request.sortBy);
  const total = Math.max(current.total, items.length);
  const perPage = Math.max(1, current.perPage || current.request.limit || items.length || 1);
  return {
    ...current,
    items,
    total,
    returnedCount: current.returnedCount,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    loadedCount: items.filter((item) => item.loaded).length,
    unloadedCount: items.filter((item) => !item.loaded).length,
    groups: buildGroups(items),
  };
}

async function loadRefnosBySource(
  viewer: ViewerRuntimeLike,
  dtxLayer: unknown,
  dbno: number,
  refnos: string[],
  source: 'parquet' | 'backend',
  options: { forceReload?: boolean } = {},
): Promise<{ ok: string[]; missing: string[] }> {
  const ok: string[] = [];
  const missing: string[] = [];

  for (const batch of chunkBySize(refnos, 1000)) {
    const result = await loadDbnoInstancesForVisibleRefnosDtx(dtxLayer as any, dbno, batch, {
      lodAssetKey: 'L1',
      debug: false,
      dataSource: source,
      forceReloadRefnos: options.forceReload ? batch : undefined,
    });
    viewer.__dtxAfterInstancesLoaded?.(dbno, batch);
    const missingSet = new Set(result.missingRefnos.map((item) => normalizeRefno(item)));
    for (const refno of batch) {
      if (missingSet.has(refno)) {
        missing.push(refno);
      } else {
        ok.push(refno);
      }
    }
  }

  return {
    ok: uniqStrings(ok),
    missing: uniqStrings(missing),
  };
}

async function generateMissingRefnos(
  viewer: ViewerRuntimeLike,
  dtxLayer: unknown,
  dbno: number,
  refnos: string[],
): Promise<{ ok: string[]; fail: string[] }> {
  const okSet = new Set<string>();
  const backendMissing = new Set<string>();
  const normalized = uniqStrings(refnos);
  if (normalized.length === 0) {
    return { ok: [], fail: [] };
  }

  try {
    const result = await triggerBatchGenerateSse(normalized, {
      onBatchDone: async (update) => {
        const readyRefnos = uniqStrings(update.readyRefnos.map((item) => normalizeRefno(item)));
        if (readyRefnos.length === 0) return;

        const loadResult = await loadRefnosBySource(viewer, dtxLayer, dbno, readyRefnos, 'backend', {
          forceReload: true,
        });
        loadResult.ok.forEach((refno) => okSet.add(refno));
        loadResult.missing.forEach((refno) => backendMissing.add(refno));

        try {
          await enqueueParquetIncremental(dbno, readyRefnos);
        } catch {
          // ignore parquet incremental enqueue failures for spatial-query batch load
        }
      },
      skipOnError: true,
      exportInstances: false,
      mergeInstances: false,
    });

    const failed = uniqStrings([
      ...result.failedRefnos.map((item) => normalizeRefno(item)),
      ...Array.from(backendMissing),
    ]).filter((refno) => !okSet.has(refno));

    return {
      ok: uniqStrings(Array.from(okSet)),
      fail: failed,
    };
  } catch {
    return {
      ok: uniqStrings(Array.from(okSet)),
      fail: normalized.filter((refno) => !okSet.has(refno)),
    };
  }
}

async function batchLoadSpatialQueryRefnos(
  viewerRef: Ref<ViewerLike | null>,
  refnos: string[],
  options: BatchLoadOptions = {},
): Promise<BatchLoadResult> {
  const viewer = viewerRef.value as ViewerRuntimeLike | null;
  const normalizedRefnos = uniqStrings(refnos);
  if (normalizedRefnos.length === 0) {
    return { ok: [], fail: [] };
  }
  if (!viewer) {
    return {
      ok: [],
      fail: normalizedRefnos.map((refno) => ({ refno, error: '查看器未就绪' })),
    };
  }

  const dtxLayer = viewer.__dtxLayer;
  if (!dtxLayer) {
    return {
      ok: [],
      fail: normalizedRefnos.map((refno) => ({ refno, error: 'DTXLayer 未初始化，无法批量加载模型' })),
    };
  }

  const failMap = new Map<string, string | null>();
  const groupedByDbno = new Map<number, string[]>();

  try {
    await ensureDbMetaInfoLoaded();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: [],
      fail: normalizedRefnos.map((refno) => ({ refno, error: message })),
    };
  }

  for (const refno of normalizedRefnos) {
    try {
      const dbno = getDbnumByRefno(refno);
      const list = groupedByDbno.get(dbno) ?? [];
      list.push(refno);
      groupedByDbno.set(dbno, list);
    } catch (error) {
      failMap.set(refno, error instanceof Error ? error.message : String(error));
    }
  }

  const parquetLoader = useDbnoInstancesParquetLoader();
  const okSet = new Set<string>();

  for (const [dbno, groupRefnos] of groupedByDbno.entries()) {
    const normalizedGroup = uniqStrings(groupRefnos);
    if (normalizedGroup.length === 0) continue;

    let pending = normalizedGroup.slice();
    const groupOk = new Set<string>();

    const parquetAvailable = await parquetLoader.isParquetAvailable(dbno);
    if (parquetAvailable) {
      try {
        const parquetResult = await loadRefnosBySource(viewer, dtxLayer, dbno, pending, 'parquet');
        parquetResult.ok.forEach((refno) => groupOk.add(refno));
        pending = parquetResult.missing;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pending.forEach((refno) => failMap.set(refno, message));
        pending = normalizedGroup.filter((refno) => !groupOk.has(refno));
      }
    }

    if (pending.length > 0) {
      try {
        const backendResult = await loadRefnosBySource(viewer, dtxLayer, dbno, pending, 'backend', {
          forceReload: parquetAvailable,
        });
        backendResult.ok.forEach((refno) => {
          groupOk.add(refno);
          failMap.delete(refno);
        });
        pending = backendResult.missing;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pending.forEach((refno) => failMap.set(refno, message));
        pending = [];
      }
    }

    if (pending.length > 0 && AUTO_GENERATION_ENABLED) {
      const generated = await generateMissingRefnos(viewer, dtxLayer, dbno, pending);
      generated.ok.forEach((refno) => {
        groupOk.add(refno);
        failMap.delete(refno);
      });
      pending = generated.fail;
    }

    pending.forEach((refno) => {
      if (!groupOk.has(refno)) {
        failMap.set(refno, failMap.get(refno) ?? '加载模型失败');
      }
    });

    const loadedGroup = uniqStrings(Array.from(groupOk));
    if (loadedGroup.length > 0) {
      viewer.scene.ensureRefnos(loadedGroup);
      viewer.scene.setObjectsVisible(loadedGroup, true);
      loadedGroup.forEach((refno) => {
        okSet.add(refno);
        failMap.delete(refno);
      });
    }
  }

  const ok = uniqStrings(Array.from(okSet));

  if (options.flyTo && ok.length > 0) {
    const flyTargets = ok.length > 5000 ? ok.slice(0, 5000) : ok;
    const aabb = viewer.scene.getAABB(flyTargets);
    if (aabb) {
      viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
    }
  }

  return {
    ok,
    fail: Array.from(failMap.entries())
      .filter(([refno]) => !okSet.has(refno))
      .map(([refno, error]) => ({ refno, error })),
  };
}

async function loadSpatialQueryAabbProxies(
  viewer: ViewerRuntimeLike,
  items: SpatialQueryResultItem[],
  options: BatchLoadOptions = {},
): Promise<BatchLoadResult> {
  const normalizedItems = items
    .map((item) => ({
      item,
      refno: normalizeRefno(item.refno),
      aabb: item.bbox
        ? {
          min: [item.bbox.min.x, item.bbox.min.y, item.bbox.min.z],
          max: [item.bbox.max.x, item.bbox.max.y, item.bbox.max.z],
        }
        : null,
    }))
    .filter((entry) => !!entry.refno);
  if (normalizedItems.length === 0) {
    return { ok: [], fail: [] };
  }

  const dtxLayer = viewer.__dtxLayer;
  if (!dtxLayer) {
    return {
      ok: [],
      fail: normalizedItems.map(({ refno }) => ({ refno, error: 'DTXLayer 未初始化，无法生成空间查询代理模型' })),
    };
  }

  try {
    await ensureDbMetaInfoLoaded();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: [],
      fail: normalizedItems.map(({ refno }) => ({ refno, error: message })),
    };
  }

  const groupedByDbno = new Map<number, typeof normalizedItems>();
  const fail: { refno: string; error: string | null }[] = [];

  for (const entry of normalizedItems) {
    if (!entry.aabb) {
      fail.push({ refno: entry.refno, error: '空间查询结果缺少 AABB，无法生成代理模型' });
      continue;
    }
    try {
      const dbno = getDbnumByRefno(entry.refno);
      const group = groupedByDbno.get(dbno) ?? [];
      group.push(entry);
      groupedByDbno.set(dbno, group);
    } catch (error) {
      fail.push({ refno: entry.refno, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const okSet = new Set<string>();

  for (const [dbno, group] of groupedByDbno.entries()) {
    const proxyResult = loadDtxAabbProxyRefnos(
      dtxLayer as Parameters<typeof loadDtxAabbProxyRefnos>[0],
      dbno,
      group.map(({ item, refno, aabb }) => ({
        refno,
        noun: item.noun,
        specValue: item.specValue,
        aabb,
      })),
    );

    const loaded = uniqStrings(proxyResult.loadedRefnos);
    if (loaded.length > 0) {
      (viewer.scene.ensureRefnos as (refnos: string[], opts?: { computeAabb?: boolean }) => void)(loaded, { computeAabb: true });
      for (const refno of loaded) {
        const matched = group.find((entry) => entry.refno === refno);
        const aabb6 = bboxToAabb6(matched?.item.bbox);
        if (aabb6 && viewer.scene.objects[refno]) {
          viewer.scene.objects[refno]!.aabb = aabb6;
        }
      }
      viewer.scene.setObjectsVisible(loaded, true);
      viewer.__dtxAfterInstancesLoaded?.(dbno, loaded);
      loaded.forEach((refno) => okSet.add(refno));
    }

    for (const refno of proxyResult.missingRefnos) {
      fail.push({ refno, error: '空间查询结果缺少有效 AABB，无法生成代理模型' });
    }
  }

  const ok = uniqStrings(Array.from(okSet));
  if (options.flyTo && ok.length > 0) {
    const aabb = viewer.scene.getAABB(ok);
    if (aabb) {
      viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
    }
  }

  return {
    ok,
    fail: fail.filter((item) => !okSet.has(item.refno)),
  };
}

export function createSpatialQueryStore(options: SpatialQueryStoreOptions = {}) {
  const viewerRef = options.viewerRef ?? useViewerContext().viewerRef;
  const selection = options.selection ?? useSelectionStore();
  const toolStore = options.toolStore ?? useToolStore();
  const queryNearbyPosition = options.queryNearbyByPosition ?? queryNearbyByPosition;
  const queryNearbyRefno = options.queryNearbyByRefno ?? queryNearbyByRefno;
  const nextRequestId = options.createRequestId ?? createRequestId;
  const batchLoadRefnos = options.batchLoadRefnos ?? ((refnos: string[], loadOptions?: BatchLoadOptions) => {
    return batchLoadSpatialQueryRefnos(viewerRef, refnos, loadOptions);
  });

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

  function commitResultSet(next: SpatialQueryResultSet | null) {
    resultSet.value = next ? syncResultSetSummary(next) : null;
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
      shape: draft.shape,
      filters,
      limit: draft.limit,
      sortBy,
      refno: draft.mode === 'distance' && draft.distanceCenterSource === 'refno' ? draft.refno.trim() || undefined : undefined,
      includeSelf: shouldIncludeSelf(draft),
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
      if (request.centerSource === 'refno' && request.includeSelf === false && request.refno && normalizeRefno(refno) === normalizeRefno(request.refno)) {
        continue;
      }
      const aabb = viewer.scene.getAABB([refno]) || viewer.scene.objects[refno]?.aabb || null;
      if (!aabb) continue;
      const center = aabbToCenter(aabb);
      const distance = aabbMinDistanceToPoint(aabb, request.center);
      const intersectsCube =
        aabb[3] >= minx && aabb[0] <= maxx &&
        aabb[4] >= miny && aabb[1] <= maxy &&
        aabb[5] >= minz && aabb[2] <= maxz;
      const intersectsSphere = distance <= radius;
      const matchShape = request.shape === 'cube' ? intersectsCube : intersectsSphere;
      if (!matchShape) continue;

      const noun = findNounByRefnoAcrossAllDbnos(refno)
        || (viewer.scene.objects as Record<string, { noun?: string } | undefined>)[refno]?.noun
        || 'UNKNOWN';
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
    const localByRefno = new Map(localItems.map((item) => [item.refno, item]));
    const serverResults = serverResp?.results ?? [];
    const page = Math.max(1, Math.floor(serverResp?.page ?? 1));
    const perPage = Math.max(1, Math.floor(serverResp?.per_page ?? request.limit));
    const hasMore = Boolean(serverResp?.has_more ?? serverResp?.truncated ?? false);

    if (serverResp) {
      if (hasMore) {
        warnings.push('服务端还有更多结果，请使用分页继续查看');
      } else if (serverResp.truncated || serverResp.truncated_results) {
        warnings.push('服务端结果已按当前页数量返回');
      }
      if (serverResp.truncated_candidates) {
        warnings.push('服务端候选集已截断，结果可能只覆盖候选上限范围');
      }
      if (serverResp.truncated_results) {
        warnings.push('服务端结果集已截断，请缩小半径或过滤条件');
      }

      for (const raw of serverResults) {
        const existing = localByRefno.get(raw.refno);
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
    } else {
      for (const item of localItems) {
        merged.set(item.refno, item);
      }
    }

    const items = sortItems(Array.from(merged.values()), request.sortBy);
    const inferredTotal = hasMore ? Math.max(items.length, page * perPage + 1) : items.length;
    const total = Math.max(serverResp?.total_count ?? inferredTotal, items.length);
    const loadedCount = items.filter((item) => item.loaded).length;
    const unloadedCount = items.length - loadedCount;
    const serverCenter = normalizeServerCenter(serverResp?.center);

    return {
      request,
      items,
      filterOptions: normalizeServerFilterOptions(serverResp),
      center: serverCenter,
      queryBBox: queryBBoxFromResponse(serverResp),
      serverRadius: typeof serverResp?.radius === 'number' ? serverResp.radius : null,
      serverShape: normalizeServerShape(serverResp?.shape),
      truncatedCandidates: Boolean(serverResp?.truncated_candidates ?? false),
      truncatedResults: Boolean(serverResp?.truncated_results ?? false),
      candidateCount: typeof serverResp?.candidate_count === 'number' ? serverResp.candidate_count : null,
      candidateCap: typeof serverResp?.candidate_cap === 'number' ? serverResp.candidate_cap : null,
      resultCap: typeof serverResp?.result_cap === 'number' ? serverResp.result_cap : null,
      page,
      perPage,
      returnedCount: serverResp?.returned_count ?? items.length,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      hasMore,
      total,
      loadedCount,
      unloadedCount,
      truncated: Boolean(hasMore || serverResp?.truncated || serverResp?.truncated_candidates || serverResp?.truncated_results),
      warnings,
      groups: buildGroups(items),
    };
  }

  async function resolveRequest(): Promise<{ request: SpatialQueryRequest }> {
    status.value = 'resolving-center';
    const centerSource = parseRequestMode(draft).centerSource;

    if (draft.mode === 'distance' && centerSource === 'refno') {
      const refno = draft.refno.trim();
      if (!refno) {
        throw new Error('请输入起始物项 Refno');
      }
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

  async function submitQuery(page = 1) {
    error.value = null;
    activeResultRefno.value = null;

    try {
      const viewer = viewerRef.value;
      const { request } = await resolveRequest();
      let localItems: SpatialQueryResultItem[] = [];
      let serverResp: ApiSpatialNearbyResult | null = null;

      status.value = 'querying-server';
      const serverOptions = {
        nouns: request.filters.nouns.length > 0 ? request.filters.nouns.join(',') : undefined,
        spec_values: request.filters.specValues.length > 0 ? request.filters.specValues.join(',') : undefined,
        page,
        per_page: request.limit,
        shape: request.shape,
        include_negative: request.filters.includeNegative,
      };

      if (request.centerSource === 'refno' && request.refno) {
        serverResp = await queryNearbyRefno(request.refno, request.radius, {
          include_self: request.includeSelf ?? false,
          nouns: serverOptions.nouns,
          spec_values: serverOptions.spec_values,
          page: serverOptions.page,
          per_page: serverOptions.per_page,
          shape: serverOptions.shape,
          include_negative: serverOptions.include_negative,
        });
      } else {
        serverResp = await queryNearbyPosition(request.center.x, request.center.y, request.center.z, request.radius, serverOptions);
      }

      if (!serverResp.success) {
        throw new Error(serverResp.error || '空间查询失败');
      }

      const serverCenter = normalizeServerCenter(serverResp.center);
      const authoritativeRequest = serverCenter
        ? {
          ...request,
          center: {
            x: serverCenter.x,
            y: serverCenter.y,
            z: serverCenter.z,
          },
        }
        : request;
      if (serverCenter) {
        draft.center = {
          x: serverCenter.x,
          y: serverCenter.y,
          z: serverCenter.z,
        };
      }

      if (viewer) {
        status.value = 'querying-local';
        localItems = queryLocal(viewer, authoritativeRequest);
      }

      status.value = 'merging-results';
      commitResultSet(mergeResults(authoritativeRequest, localItems, serverResp));

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
    if (resultSet.value) {
      commitResultSet(resultSet.value);
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
      try {
        await ensureResultLoaded(item);
        if (!hasRenderableSpatialResult(viewer as ViewerRuntimeLike, item.refno)) {
          const proxyResult = await loadSpatialQueryAabbProxies(viewer as ViewerRuntimeLike, [item]);
          if (proxyResult.ok.length === 0) {
            throw new Error(proxyResult.fail[0]?.error || `加载模型失败: ${item.refno}`);
          }
        }
      } catch (loadError) {
        const proxyResult = await loadSpatialQueryAabbProxies(viewer as ViewerRuntimeLike, [item]);
        if (proxyResult.ok.length === 0) {
          throw loadError;
        }
      }

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
      if (resultSet.value) {
        commitResultSet(resultSet.value);
      }
      status.value = 'ready';
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      status.value = 'error';
    }
  }

  function pickResultItems(options: { onlyUnloaded?: boolean; specValue?: number } = {}): SpatialQueryResultItem[] {
    const items = resultSet.value?.items ?? [];
    return items.filter((item) => {
      if (options.onlyUnloaded && item.loaded) return false;
      if (typeof options.specValue === 'number' && item.specValue !== options.specValue) return false;
      return true;
    });
  }

  async function loadResults(options: { onlyUnloaded?: boolean; specValue?: number; flyTo?: boolean } = {}) {
    const targets = pickResultItems(options);
    if (targets.length === 0) {
      status.value = 'ready';
      return;
    }

    try {
      error.value = null;
      status.value = 'loading-results-batch';
      const result = await batchLoadRefnos(
        targets.map((item) => item.refno),
        { flyTo: options.flyTo }
      );
      const okSet = new Set(result.ok.map((item) => normalizeRefno(item)));
      const failSet = new Set(result.fail.map((item) => normalizeRefno(item.refno)));
      let unresolvedFail = result.fail;
      const viewer = viewerRef.value as ViewerRuntimeLike | null;

      if (viewer && okSet.size > 0) {
        const fakeOkTargets = targets.filter((item) => {
          const refno = normalizeRefno(item.refno);
          return okSet.has(refno) && !hasRenderableSpatialResult(viewer, refno);
        });
        if (fakeOkTargets.length > 0) {
          const proxyResult = await loadSpatialQueryAabbProxies(
            viewer,
            fakeOkTargets,
            { flyTo: false },
          );
          proxyResult.ok.forEach((refno) => okSet.add(normalizeRefno(refno)));
          const proxyOkSet = new Set(proxyResult.ok.map((refno) => normalizeRefno(refno)));
          for (const target of fakeOkTargets) {
            const refno = normalizeRefno(target.refno);
            if (!proxyOkSet.has(refno)) {
              okSet.delete(refno);
            }
          }
          unresolvedFail = [
            ...unresolvedFail,
            ...proxyResult.fail,
            ...fakeOkTargets
              .filter((target) => !proxyOkSet.has(normalizeRefno(target.refno)))
              .map((target) => ({
                refno: normalizeRefno(target.refno),
                error: `模型加载完成但未生成可见对象: ${normalizeRefno(target.refno)}`,
              })),
          ];
        }
      }

      if (failSet.size > 0) {
        if (viewer) {
          const proxyResult = await loadSpatialQueryAabbProxies(
            viewer,
            targets.filter((item) => failSet.has(normalizeRefno(item.refno))),
            { flyTo: options.flyTo },
          );
          proxyResult.ok.forEach((refno) => okSet.add(normalizeRefno(refno)));
          const proxyOkSet = new Set(proxyResult.ok.map((refno) => normalizeRefno(refno)));
          unresolvedFail = [
            ...result.fail.filter((item) => !proxyOkSet.has(normalizeRefno(item.refno))),
            ...proxyResult.fail,
          ].filter((item, index, list) => {
            const refno = normalizeRefno(item.refno);
            return !!refno && list.findIndex((candidate) => normalizeRefno(candidate.refno) === refno) === index;
          });
        }
      }

      unresolvedFail = unresolvedFail.filter((item, index, list) => {
        const refno = normalizeRefno(item.refno);
        return !!refno
          && !okSet.has(refno)
          && list.findIndex((candidate) => normalizeRefno(candidate.refno) === refno) === index;
      });

      if (viewer && options.flyTo && okSet.size > 0) {
        const flyTargets = Array.from(okSet).filter((refno) => hasRenderableSpatialResult(viewer, refno));
        const aabb = viewer.scene.getAABB(flyTargets.length > 5000 ? flyTargets.slice(0, 5000) : flyTargets);
        if (aabb) {
          viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 });
        }
      }

      if (resultSet.value) {
        for (const item of resultSet.value.items) {
          if (okSet.has(normalizeRefno(item.refno))) {
            item.loaded = true;
            item.visible = true;
          }
        }
        commitResultSet(resultSet.value);
      }

      if (unresolvedFail.length > 0) {
        error.value = unresolvedFail.length === 1
          ? (unresolvedFail[0]?.error || `加载模型失败: ${unresolvedFail[0]?.refno}`)
          : `有 ${unresolvedFail.length} 个模型加载失败`;
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
    if (resultSet.value) {
      commitResultSet(resultSet.value);
    }
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
    if (resultSet.value) {
      commitResultSet(resultSet.value);
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

  function showOnlySpecGroup(specValue: number) {
    const viewer = viewerRef.value;
    const items = resultSet.value?.items ?? [];
    if (!viewer || items.length === 0) return;

    const showRefnos = items
      .filter((item) => item.specValue === specValue)
      .map((item) => item.refno);
    const hideRefnos = items
      .filter((item) => item.specValue !== specValue)
      .map((item) => item.refno);

    if (showRefnos.length > 0) {
      viewer.scene.setObjectsVisible(showRefnos, true);
    }
    if (hideRefnos.length > 0) {
      viewer.scene.setObjectsVisible(hideRefnos, false);
    }

    items.forEach((item) => {
      item.visible = item.specValue === specValue;
    });
    if (resultSet.value) {
      commitResultSet(resultSet.value);
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
    loadResults,
    showOnlySpecGroup,
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
