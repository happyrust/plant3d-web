import { computed, reactive, ref, watch, type Ref } from 'vue';

import { Box3, Matrix4, Vector3 } from 'three';

import type {
  fetchNegativeNouns,
  queryNearbyByRefno,
  queryNearbyByPosition,
  queryNearbyRefnos,
  querySpatialIndex,
  SpatialNearbyParams as ApiSpatialNearbyParams,
  SpatialNearbyResult as ApiSpatialNearbyResult,
  SpatialQueryResult as ApiSpatialQueryResult,
  SpatialQueryResultItem as ApiSpatialQueryResultItem,
  SpatialQuerySortParam,
} from '@/api/genModelSpatialApi';

import { enqueueParquetIncremental } from '@/api/genModelRealtimeApi';
import { triggerBatchGenerateSse } from '@/api/genModelStreamGenerateApi';
import { ensureDbMetaInfoLoaded, getDbnumByRefno } from '@/composables/useDbMetaInfo';
import {
  findNounByRefnoAcrossAllDbnos,
  findSpecValueByRefnoAcrossAllDbnos,
  loadDtxAabbProxyRefnos,
  loadDbnoInstancesForVisibleRefnosDtx,
} from '@/composables/useDbnoInstancesDtxLoader';
import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader';
import { AUTO_GENERATION_ENABLED } from '@/composables/useModelGeneration';
import { useSelectionStore } from '@/composables/useSelectionStore';
import { useToolStore } from '@/composables/useToolStore';
import { showModelByRefnosWithAck, useViewerContext, waitForViewerReady } from '@/composables/useViewerContext';
import { getModelSource } from '@/model-source';
import {
  type SpatialQueryAabb,
  type SpatialQueryCapabilities,
  type SpatialQueryCenterSource,
  type SpatialQueryDraft,
  type SpatialQueryFilterOptions,
  type SpatialQueryFilters,
  type SpatialQueryFullMatchSet,
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
    /** 目标含子树的并集盒（`DtxCompatScene.getSubtreeAABB`）；旧查看器 / 测试桩没有它时退回 `getAABB`。 */
    getSubtreeAABB?: (refnos: string[]) => [number, number, number, number, number, number] | null;
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

type Aabb6 = [number, number, number, number, number, number];

/** `DTXLayer.getGlobalModelMatrix()` 的最小形状（列主序 16 元素）；测试桩只需给这一个方法。 */
type DtxLayerMatrixSource = {
  getGlobalModelMatrix?: () => { elements: ArrayLike<number> } | null | undefined;
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
  /** 结果自带的 refno → dbnum（gen-model-v1 服务端直接给）；有它就不再按 refno 查库号，缺失的才 `getDbnumByRefno` */
  dbnumByRefno?: ReadonlyMap<string, number>;
};

type BatchLoadResult = {
  ok: string[];
  fail: { refno: string; error: string | null }[];
};

type BatchLoadRefnosFn = (refnos: string[], options?: BatchLoadOptions) => Promise<BatchLoadResult>;

/**
 * 四个取数点都可注入（测试 / 宿主替换）；不注入时一律经 `getModelSource().spatial` 取——
 * legacy 下与直接调 `genModelSpatialApi.ts` 逐字相同，gen-model-v1 下由其适配器接 `/api/v1/spatial/*`
 * （plan 2026-09-13 空间范围查询 P2 立端口、P3 接 v1）。函数签名保持旧 API 便捷函数的形状，既有调用方 / 用例不改。
 */
type SpatialQueryStoreOptions = {
  viewerRef?: Ref<ViewerLike | null>;
  selection?: SelectionLike;
  toolStore?: ToolStoreLike;
  queryNearbyByPosition?: typeof queryNearbyByPosition;
  queryNearbyByRefno?: typeof queryNearbyByRefno;
  queryNearbyRefnos?: typeof queryNearbyRefnos;
  querySpatialIndex?: typeof querySpatialIndex;
  fetchNegativeNouns?: FetchNegativeNounsFn;
  createRequestId?: () => string;
  batchLoadRefnos?: BatchLoadRefnosFn;
};

/** 各模式的默认排序：范围查询更关心分专业浏览，距离查询更关心由近及远。 */
const DEFAULT_SORT_BY_MODE: Record<SpatialQueryMode, SpatialQuerySortBy> = {
  range: 'specThenDistance',
  distance: 'distanceAsc',
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
    sortBy: DEFAULT_SORT_BY_MODE.distance,
  };
}

/**
 * 负实体 noun 运行时注册表。
 *
 * 唯一事实源在服务端（rs-core TOTAL_NEG_NOUN_NAMES，经
 * `/api/sqlite-spatial/negative-nouns` 暴露）；前端不再自带硬编码清单，
 * 避免两边各改一份导致本地/服务端过滤口径漂移。
 * 查询响应里的 `filter_options.is_negative` 作为增量补充：
 * 端点偶发不可用时，注册表仍能随响应逐步学习。
 */
const negativeNounRegistry = new Set<string>();
let negativeNounsFetched = false;
let negativeNounsFetching: Promise<void> | null = null;

type FetchNegativeNounsFn = typeof fetchNegativeNouns;

function registerNegativeNoun(noun: string): void {
  const normalized = noun.trim().toUpperCase();
  if (normalized) {
    negativeNounRegistry.add(normalized);
  }
}

function isNegativeNoun(noun: string): boolean {
  return negativeNounRegistry.has(noun.trim().toUpperCase());
}

async function ensureNegativeNounsLoaded(fetcher: FetchNegativeNounsFn): Promise<void> {
  if (negativeNounsFetched) return;
  negativeNounsFetching ??= (async () => {
    try {
      const resp = await fetcher();
      if (resp.success) {
        resp.nouns.forEach(registerNegativeNoun);
        negativeNounsFetched = true;
      }
    } catch {
      // 端点不可用时靠 filter_options.is_negative 增量学习兜底，下次查询重试
    } finally {
      negativeNounsFetching = null;
    }
  })();
  await negativeNounsFetching;
}

/** 测试用：清掉进程内的负实体注册表与「已拉过清单」标记，让下一次查询重新走 `negativeNouns()`。 */
export function __resetNegativeNounRegistryForTests(): void {
  negativeNounRegistry.clear();
  negativeNounsFetched = false;
  negativeNounsFetching = null;
}

function learnNegativeNounsFromFilterOptions(
  options: ApiSpatialQueryResult['filter_options'] | null | undefined,
): void {
  for (const option of options?.nouns ?? []) {
    if (option.is_negative) {
      registerNegativeNoun(option.value);
    }
  }
}

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

/**
 * 场景坐标 ↔ E3D 世界 mm 的换算。
 *
 * 查看器里的一切几何读数（`scene.getAABB`、拾取 `hit.worldPos`）都在 `DTXLayer` 全局矩阵**之后**的场景坐标里——
 * 缺省 `modelUnit=mm` 时该矩阵是 0.001 缩放 + 以首个加载模型盒中心重心化（`ViewerPanel.vue::applyDtxGlobalTransformOnce`），
 * 也就是「米、已平移」；而 `/api/v1/spatial/*`、旧 `sqlite-spatial` 以及 `draft.center` 一律是 E3D 世界 mm。
 * 两边不换算，「当前选中 / 拾取中心」就会把 `(-0.3, 0, -0.6)` 当 mm 发出去、落到 E3D 原点旁边
 * （plan 2026-09-13 空间范围查询 §7 第 6 步核出的 B4）。
 *
 * 约定：`draft.center`、请求、结果项的 `position` / `bbox` / `distance` 全部是 mm；只在读查看器（→ mm）与
 * 写查看器（飞行、代理盒 → 场景）两个边界换算。矩阵缺失或为单位阵时两套坐标相同，换算是恒等。
 */
export type SceneWorldTransform = {
  /** 全局矩阵是否为单位阵（或根本没有）。 */
  identity: boolean;
  pointToWorldMm: (point: SpatialQueryPoint) => SpatialQueryPoint;
  pointToScene: (point: SpatialQueryPoint) => SpatialQueryPoint;
  aabbToWorldMm: (aabb: Aabb6) => Aabb6;
  aabbToScene: (aabb: Aabb6) => Aabb6;
};

const IDENTITY_SCENE_WORLD_TRANSFORM: SceneWorldTransform = {
  identity: true,
  pointToWorldMm: (point) => ({ ...point }),
  pointToScene: (point) => ({ ...point }),
  aabbToWorldMm: (aabb) => [...aabb] as Aabb6,
  aabbToScene: (aabb) => [...aabb] as Aabb6,
};

function isIdentityMatrixElements(elements: ArrayLike<number>): boolean {
  if (elements.length !== 16) return false;
  for (let i = 0; i < 16; i += 1) {
    const expected = i % 5 === 0 ? 1 : 0;
    if (Math.abs(elements[i]! - expected) > 1e-12) return false;
  }
  return true;
}

function transformPoint(point: SpatialQueryPoint, matrix: Matrix4): SpatialQueryPoint {
  const v = new Vector3(point.x, point.y, point.z).applyMatrix4(matrix);
  return { x: v.x, y: v.y, z: v.z };
}

function transformAabb(aabb: Aabb6, matrix: Matrix4): Aabb6 {
  const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5])).applyMatrix4(matrix);
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
}

/** 从查看器上挂的 `__dtxLayer` 读全局矩阵；读不到、非法或不可逆都退回恒等换算。 */
export function resolveSceneWorldTransform(viewer: ViewerLike | null | undefined): SceneWorldTransform {
  const layer = (viewer as ViewerRuntimeLike | null | undefined)?.__dtxLayer as DtxLayerMatrixSource | null | undefined;
  const elements = layer?.getGlobalModelMatrix?.()?.elements;
  if (!elements || elements.length !== 16 || isIdentityMatrixElements(elements)) {
    return IDENTITY_SCENE_WORLD_TRANSFORM;
  }
  const values = Array.from(elements);
  if (values.some((value) => !Number.isFinite(value))) {
    return IDENTITY_SCENE_WORLD_TRANSFORM;
  }
  const toScene = new Matrix4().fromArray(values);
  if (toScene.determinant() === 0) {
    return IDENTITY_SCENE_WORLD_TRANSFORM;
  }
  const toWorldMm = toScene.clone().invert();
  return {
    identity: false,
    pointToWorldMm: (point) => transformPoint(point, toWorldMm),
    pointToScene: (point) => transformPoint(point, toScene),
    aabbToWorldMm: (aabb) => transformAabb(aabb, toWorldMm),
    aabbToScene: (aabb) => transformAabb(aabb, toScene),
  };
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

const SORT_BY_TO_SERVER_PARAM: Record<SpatialQuerySortBy, SpatialQuerySortParam> = {
  distanceAsc: 'distance',
  nameAsc: 'name',
  specThenDistance: 'spec_distance',
};

/**
 * 按专业分组。
 *
 * `count` 取服务端给的全量命中计数，`items` 只有当前页——
 * 用页内条数当计数会让「共 N 项」和分组小计对不上。
 */
function buildGroups(
  items: SpatialQueryResultItem[],
  globalCounts?: Map<number, number> | null,
): SpatialQueryResultGroup[] {
  const grouped = new Map<number, SpatialQueryResultItem[]>();
  for (const item of items) {
    const list = grouped.get(item.specValue) ?? [];
    list.push(item);
    grouped.set(item.specValue, list);
  }

  // 全量命中里存在、但当前页没有条目的专业也要成组，否则翻页时整组
  // 从分组列表里消失，分组小计和「共 N 项」对不上。
  if (globalCounts) {
    for (const specValue of globalCounts.keys()) {
      if (!grouped.has(specValue)) {
        grouped.set(specValue, []);
      }
    }
  }

  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([specValue, groupedItems]) => ({
      specValue,
      specName: toSpecName(specValue),
      count: globalCounts?.get(specValue) ?? groupedItems.length,
      items: groupedItems,
    }));
}

function toGlobalGroupCounts(serverResp: ApiSpatialQueryResult | null): Map<number, number> | null {
  if (!serverResp?.groups) return null;
  return new Map(serverResp.groups.map((group) => [group.spec_value, group.count]));
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
  const sortBy = draft.sortBy ?? DEFAULT_SORT_BY_MODE[draft.mode];
  if (draft.mode === 'range') {
    return { centerSource: draft.rangeCenterSource, sortBy };
  }
  return { centerSource: draft.distanceCenterSource, sortBy };
}

/**
 * 客户端过滤。
 *
 * 关键字默认不在这里判定：服务端已经在分页前按 refno / noun / name 匹配过，
 * 而客户端拿不到 name，再滤一遍会把靠名称命中的结果误删。
 * 只有拿不到服务端结果的兜底路径才需要 `applyKeyword`。
 */
function matchFilters(
  item: { refno: string; noun: string; specValue: number; loaded: boolean; visible: boolean },
  filters: SpatialQueryFilters,
  options: { applyKeyword?: boolean } = {},
): boolean {
  if (filters.onlyLoaded && !item.loaded) return false;
  if (filters.onlyVisible && !item.visible) return false;
  if (!filters.includeNegative && isNegativeNoun(item.noun)) return false;
  if (filters.nouns.length > 0 && !filters.nouns.includes(item.noun.toUpperCase())) return false;
  if (filters.specValues.length > 0 && !filters.specValues.includes(item.specValue)) return false;
  if (options.applyKeyword && !includesKeyword(item.refno, item.noun, filters.keyword)) return false;
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
    dbnum: typeof item.dbnum === 'number' ? item.dbnum : null,
    distance: typeof item.distance === 'number' ? item.distance : null,
    loaded,
    visible,
    matchedBy: loaded ? 'merged' : 'server-spatial-index',
    position,
    bbox,
    name: item.name?.trim() || item.refno,
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
  // 顺序由服务端在分页前决定，这里不再重排，否则页内顺序会和分页切分口径冲突。
  const items = current.items;
  const total = Math.max(current.total, items.length);
  const perPage = Math.max(1, current.perPage || current.request.limit || items.length || 1);
  // 重新提交时沿用上一轮的全量分组计数：条目的专业不会因为显隐/加载而改变。
  const globalCounts = new Map(current.groups.map((group) => [group.specValue, group.count]));
  return {
    ...current,
    items,
    total,
    returnedCount: current.returnedCount,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    loadedCount: items.filter((item) => item.loaded).length,
    unloadedCount: items.filter((item) => !item.loaded).length,
    groups: buildGroups(items, globalCounts),
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
  // gen-model-v1 下没有 parquet，也没有旧后端的 SSE 批量生成：`loadRefnosBySource(...,'backend')` 经 DTX 加载链
  // 已改走 `records.instanceEntriesByRefnos`（内部 ensure → records），缺失就是「没有可渲染几何」，不再另起生成
  const genModelV1 = getModelSource().kind === 'gen-model-v1';

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
      // 结果自带 dbnum（v1 服务端直接给）优先，缺失才按 refno 查库号
      const dbno = options.dbnumByRefno?.get(refno) ?? getDbnumByRefno(refno);
      const list = groupedByDbno.get(dbno) ?? [];
      list.push(refno);
      groupedByDbno.set(dbno, list);
    } catch (error) {
      failMap.set(refno, error instanceof Error ? error.message : String(error));
    }
  }

  const parquetLoader = genModelV1 ? null : useDbnoInstancesParquetLoader();
  const okSet = new Set<string>();

  for (const [dbno, groupRefnos] of groupedByDbno.entries()) {
    const normalizedGroup = uniqStrings(groupRefnos);
    if (normalizedGroup.length === 0) continue;

    let pending = normalizedGroup.slice();
    const groupOk = new Set<string>();

    const parquetAvailable = parquetLoader ? await parquetLoader.isParquetAvailable(dbno) : false;
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

    if (pending.length > 0 && AUTO_GENERATION_ENABLED && !genModelV1) {
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
      // 代理盒本身按 mm 写进 DTXLayer（渲染时再乘全局矩阵）；这里缓存到 scene.objects 的盒要与 `getAABB` 同一套场景坐标。
      const transform = resolveSceneWorldTransform(viewer);
      for (const refno of loaded) {
        const matched = group.find((entry) => entry.refno === refno);
        const aabb6 = bboxToAabb6(matched?.item.bbox);
        if (aabb6 && viewer.scene.objects[refno]) {
          viewer.scene.objects[refno]!.aabb = transform.aabbToScene(aabb6);
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
  // 数据源按调用时刻解析（`getModelSource()` 每次读 URL 开关），不在建 store 时钉死
  const spatialSource = () => getModelSource().spatial;
  const queryNearbyPosition: typeof queryNearbyByPosition = options.queryNearbyByPosition
    ?? ((x, y, z, radius, nearbyOptions) => spatialSource().nearby({ x, y, z, radius, ...nearbyOptions }));
  const queryNearbyRefno: typeof queryNearbyByRefno = options.queryNearbyByRefno
    ?? ((refno, radius, nearbyOptions) => spatialSource().nearby({ refno, radius, ...nearbyOptions }));
  const fetchNearbyRefnos: typeof queryNearbyRefnos = options.queryNearbyRefnos
    ?? ((params) => spatialSource().nearbyRefnos(params));
  const negativeNounsFetcher: FetchNegativeNounsFn = options.fetchNegativeNouns
    ?? (() => spatialSource().negativeNouns());
  /** 当前源的空间查询能力；v1 没有专业维度，抽屉据此收起专业 UI、改按库分组 */
  const spatialCapabilities = computed<SpatialQueryCapabilities>(() => ({
    specValues: spatialSource().capabilities.specValues,
  }));
  const nextRequestId = options.createRequestId ?? createRequestId;
  const batchLoadRefnos = options.batchLoadRefnos ?? ((refnos: string[], loadOptions?: BatchLoadOptions) => {
    return batchLoadSpatialQueryRefnos(viewerRef, refnos, loadOptions);
  });

  const draft = reactive<SpatialQueryDraft>(createDefaultDraft());
  const status = ref<SpatialQueryStatus>('idle');
  const error = ref<string | null>(null);
  const resultSet = ref<SpatialQueryResultSet | null>(null);
  const activeResultRefno = ref<string | null>(null);

  // 切模式时把排序拉回该模式的默认口径，用户在当前模式内的手动选择保持不变。
  // 用 watch 而不是只在 setMode 里改，是因为直接给 draft.mode 赋值同样要生效；
  // sync 保证紧接着提交的查询读到的已经是新默认值。
  // 范围查询默认「按专业」，但当前源没有专业维度（gen-model-v1）时退到由近及远。
  watch(
    () => draft.mode,
    (mode) => {
      const preferred = DEFAULT_SORT_BY_MODE[mode];
      draft.sortBy = preferred === 'specThenDistance' && !spatialCapabilities.value.specValues ? 'distanceAsc' : preferred;
    },
    { flush: 'sync' },
  );

  /** 拾取到的 `worldPos` 是 three 场景坐标（已乘 DTX 全局矩阵），进 `draft.center` 前换回 E3D mm。 */
  function pickedWorldPosToCenterMm(worldPos: [number, number, number]): SpatialQueryPoint {
    return resolveSceneWorldTransform(viewerRef.value).pointToWorldMm({
      x: worldPos[0],
      y: worldPos[1],
      z: worldPos[2],
    });
  }

  watch(
    () => toolStore.pickedQueryCenter.value,
    (picked) => {
      if (!picked) return;
      draft.center = pickedWorldPosToCenterMm(picked.worldPos);
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
    // 选中的是 BRAN 这类 owner 时，它自己的对象只有隐含管子（成员各有 refno）；服务端 refno 模式的 `refno_aabb_center`
    // 是子树并集盒（spec §4.13），这里同口径取子树盒，没有该方法的查看器退回 `getAABB`（叶子构件两者相同）。
    const aabb = viewer.scene.getSubtreeAABB?.([selectedRefno]) ?? viewer.scene.getAABB([selectedRefno]);
    if (!aabb) {
      error.value = '无法解析当前选中构件的位置';
      return;
    }
    // 盒是场景坐标；`draft.center` 一律 mm。
    draft.center = resolveSceneWorldTransform(viewer).pointToWorldMm(aabbToCenter(aabb));
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
    // 查看器盒是场景坐标，请求中心是 mm：盒先换回 mm，距离 / 相交才与服务端同口径。
    const transform = resolveSceneWorldTransform(viewer);
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
      const sceneAabb = viewer.scene.getAABB([refno]) || viewer.scene.objects[refno]?.aabb || null;
      if (!sceneAabb) continue;
      const aabb = transform.aabbToWorldMm(sceneAabb);
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

  function mergeResults(
    request: SpatialQueryRequest,
    localItems: SpatialQueryResultItem[],
    serverResp: ApiSpatialQueryResult | null,
    viewerLoadedRefnos?: Set<string> | null,
  ): SpatialQueryResultSet {
    const merged = new Map<string, SpatialQueryResultItem>();
    // loaded 以查看器实际加载集为准。本地扫描结果只是「检索形状内命中」的
    // 子集：refno 模式服务端按源 AABB 表面量距离、本地按中心点量，已加载
    // 但落在两种口径差集里的构件若用 localItems 判定会被误标成未加载。
    const loadedRefnos = viewerLoadedRefnos ?? new Set(localItems.map((item) => item.refno));
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
            // 本地扫描拿不到构件名称，只能回退成 refno；名称一律以服务端为准
            name: normalized.name,
            // 距离同样以服务端为准：排序发生在服务端，refno 模式下服务端按
            // 源 AABB 表面量距离而本地按中心点量，混用会让距离列非单调。
            distance: normalized.distance ?? existing.distance,
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
      // 没有服务端结果时关键字无人判定，这里补上
      for (const item of localItems) {
        if (!includesKeyword(item.refno, item.noun, request.filters.keyword)) continue;
        merged.set(item.refno, item);
      }
    }

    // 有服务端结果时沿用其顺序（已按 sort 在分页前排好）；
    // 只有纯本地兜底路径才需要在前端排序。
    const mergedItems = Array.from(merged.values());
    const items = serverResp ? mergedItems : sortItems(mergedItems, request.sortBy);
    const inferredTotal = hasMore ? Math.max(items.length, page * perPage + 1) : items.length;
    const total = Math.max(serverResp?.total_count ?? inferredTotal, items.length);
    const loadedCount = items.filter((item) => item.loaded).length;
    const unloadedCount = items.length - loadedCount;
    const serverCenter = normalizeServerCenter(serverResp?.center);

    return {
      request,
      items,
      fullMatches: null,
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
      groups: buildGroups(items, toGlobalGroupCounts(serverResp)),
      dbnumGroups: serverResp?.dbnum_groups
        ? serverResp.dbnum_groups.map((group) => ({ dbnum: group.dbnum, count: group.count }))
        : null,
      coverage: serverResp?.coverage ?? null,
    };
  }

  function toNearbyParams(request: SpatialQueryRequest): ApiSpatialNearbyParams {
    const base = {
      radius: request.radius,
      shape: request.shape,
      nouns: request.filters.nouns.length > 0 ? request.filters.nouns.join(',') : undefined,
      spec_values: request.filters.specValues.length > 0 ? request.filters.specValues.join(',') : undefined,
      keyword: request.filters.keyword || undefined,
      sort: SORT_BY_TO_SERVER_PARAM[request.sortBy],
      include_negative: request.filters.includeNegative,
    };

    if (request.centerSource === 'refno' && request.refno) {
      return {
        ...base,
        refno: request.refno,
        include_self: request.includeSelf ?? false,
      };
    }

    return {
      ...base,
      x: request.center.x,
      y: request.center.y,
      z: request.center.z,
    };
  }

  /**
   * 取回完整命中集合，供批量操作使用。
   *
   * 结果没有翻页时当前页就是全集，直接复用，避免多打一次请求。
   */
  async function fetchFullMatches(
    request: SpatialQueryRequest,
    resultSetValue: SpatialQueryResultSet,
  ): Promise<SpatialQueryFullMatchSet | null> {
    if (!resultSetValue.hasMore) {
      return null;
    }

    try {
      const resp = await fetchNearbyRefnos(toNearbyParams(request));
      if (!resp.success) return null;

      const localOnly = resultSetValue.items
        .map((item) => item.refno)
        .filter((refno) => !resp.refnos.includes(refno));

      return {
        refnos: uniqStrings([...resp.refnos, ...localOnly]),
        byDbnum: resp.by_dbnum ?? {},
        bySpecValue: resp.by_spec_value ?? {},
        total: resp.total_count,
        truncated: Boolean(resp.truncated),
      };
    } catch {
      // 取全集失败不影响本次查询结果，批量操作回退到当前页
      return null;
    }
  }

  type BatchScope = { specValue?: number; dbnum?: number };
  /**
   * 批量操作跨不跨页：`all` = 整个命中集合（取不到全集时退回当前页），「只加载未加载」、分组按钮、全部显示、隔离用它——
   * 它们的语义都是「结果里的全部」；`current` = 只动当前页列出的条目，只有「加载当前页」用它——摘要行的「当前页 N 项」数的就是这一页。
   * 改前「加载当前页」也走全集，1387 项的结果点下去会把全集拉下来（plan 2026-09-13 空间范围查询 §7 联调记录）。
   */
  type BatchPages = 'current' | 'all';

  /** 批量操作的作用域：缺省整个命中集合、取不到时回退当前页，`pages: 'current'` 只取当前页；可按专业（legacy）或按库（gen-model-v1）取一组。 */
  function resolveBatchRefnos(options: BatchScope & { pages?: BatchPages } = {}): string[] {
    const current = resultSet.value;
    if (!current) return [];

    const full = options.pages === 'current' ? null : current.fullMatches;
    if (full) {
      if (typeof options.specValue === 'number') {
        const grouped = full.bySpecValue[String(options.specValue)];
        if (grouped) return grouped;
      } else if (typeof options.dbnum === 'number') {
        const grouped = full.byDbnum[String(options.dbnum)];
        if (grouped) return grouped;
      } else {
        return full.refnos;
      }
    }

    return current.items
      .filter((item) => typeof options.specValue !== 'number' || item.specValue === options.specValue)
      .filter((item) => typeof options.dbnum !== 'number' || item.dbnum === options.dbnum)
      .map((item) => item.refno);
  }

  /** 结果自带的 refno → dbnum（v1 服务端给的），连同全集的 by_dbnum 一起交给批量加载，省掉逐个查库号。 */
  function collectDbnumHints(items: SpatialQueryResultItem[]): Map<string, number> {
    const hints = new Map<string, number>();
    for (const [dbnum, refnos] of Object.entries(resultSet.value?.fullMatches?.byDbnum ?? {})) {
      const parsed = Number(dbnum);
      if (!Number.isFinite(parsed)) continue;
      for (const refno of refnos) hints.set(normalizeRefno(refno), parsed);
    }
    for (const item of items) {
      if (typeof item.dbnum === 'number') hints.set(normalizeRefno(item.refno), item.dbnum);
    }
    return hints;
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
      draft.center = pickedWorldPosToCenterMm(picked.worldPos);
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

      // 负实体判定依赖服务端清单；失败不阻断查询（响应里的 is_negative 兜底）。
      await ensureNegativeNounsLoaded(negativeNounsFetcher);

      status.value = 'querying-server';
      const serverOptions = {
        nouns: request.filters.nouns.length > 0 ? request.filters.nouns.join(',') : undefined,
        spec_values: request.filters.specValues.length > 0 ? request.filters.specValues.join(',') : undefined,
        keyword: request.filters.keyword || undefined,
        sort: SORT_BY_TO_SERVER_PARAM[request.sortBy],
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
          keyword: serverOptions.keyword,
          sort: serverOptions.sort,
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

      learnNegativeNounsFromFilterOptions(serverResp.filter_options);

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
      const viewerLoadedRefnos = viewer ? new Set(resolveLoadedRefnos(viewer)) : null;
      const merged = mergeResults(authoritativeRequest, localItems, serverResp, viewerLoadedRefnos);
      merged.fullMatches = await fetchFullMatches(authoritativeRequest, merged);
      commitResultSet(merged);

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

      // 场景里拿不到盒时退回结果项的 bbox（mm），飞行前换到场景坐标。
      const fallbackAabb = bboxToAabb6(item.bbox);
      const aabb = viewer.scene.getAABB([item.refno])
        ?? (fallbackAabb ? resolveSceneWorldTransform(viewer).aabbToScene(fallbackAabb) : null);
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

  function pickResultItems(options: { onlyUnloaded?: boolean; pages?: BatchPages } & BatchScope = {}): SpatialQueryResultItem[] {
    const byRefno = new Map((resultSet.value?.items ?? []).map((item) => [item.refno, item]));
    const loadedRefnos = new Set(
      viewerRef.value ? resolveLoadedRefnos(viewerRef.value) : [],
    );

    return resolveBatchRefnos({ specValue: options.specValue, dbnum: options.dbnum, pages: options.pages }).map((refno) => {
      const existing = byRefno.get(refno);
      if (existing) return existing;

      // 全集里的跨页项没有明细，补一个最小可用的占位项供批量加载使用。
      return {
        refno,
        noun: 'UNKNOWN',
        specValue: options.specValue ?? 0,
        specName: toSpecName(options.specValue ?? 0),
        dbnum: options.dbnum ?? null,
        distance: null,
        loaded: loadedRefnos.has(refno),
        visible: false,
        matchedBy: 'server-spatial-index',
        name: refno,
        position: null,
        bbox: null,
        sourceModel: null,
      } satisfies SpatialQueryResultItem;
    }).filter((item) => !options.onlyUnloaded || !item.loaded);
  }

  type LoadResultsOptions = { onlyUnloaded?: boolean; flyTo?: boolean; pages?: BatchPages } & BatchScope;

  /**
   * `loadResults(options)` 会去加载多少个模型——与它同一套取法（全集 / 当前页、按库 / 按专业、只算未加载），
   * 供抽屉在跨页的大批量加载前先弹确认（「只加载未加载」、分组「加载本库 / 本专业」超过阈值时显示数量，用户 2026-09-14 拍板）。
   */
  function countLoadTargets(options: LoadResultsOptions = {}): number {
    return pickResultItems(options).length;
  }

  async function loadResults(options: LoadResultsOptions = {}) {
    const targets = pickResultItems(options);
    if (targets.length === 0) {
      status.value = 'ready';
      return;
    }

    try {
      error.value = null;
      status.value = 'loading-results-batch';
      const dbnumByRefno = collectDbnumHints(targets);
      const result = await batchLoadRefnos(
        targets.map((item) => item.refno),
        { flyTo: options.flyTo, ...(dbnumByRefno.size > 0 ? { dbnumByRefno } : {}) }
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
    const refnos = resolveBatchRefnos();
    if (!viewer || refnos.length === 0) return;
    viewer.scene.setObjectsVisible(refnos, visible);
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
    const keep = resolveBatchRefnos();
    if (!viewer || keep.length === 0) return;
    const all = viewer.scene.objectIds.slice();
    if (all.length > 0) {
      viewer.scene.setObjectsXRayed(all, true);
    }
    viewer.scene.setObjectsXRayed(keep, false);
    viewer.scene.setObjectsVisible(keep, true);
    items.forEach((item) => {
      item.visible = true;
    });
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

    const showRefnos = resolveBatchRefnos({ specValue });
    const showSet = new Set(showRefnos);
    const hideRefnos = resolveBatchRefnos().filter((refno) => !showSet.has(refno));

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

  /** `showOnlySpecGroup` 的按库版：gen-model-v1 源下结果按 dbnum 分组，「仅显示本库」走这里。 */
  function showOnlyDbnumGroup(dbnum: number) {
    const viewer = viewerRef.value;
    const items = resultSet.value?.items ?? [];
    if (!viewer || items.length === 0) return;

    const showRefnos = resolveBatchRefnos({ dbnum });
    const showSet = new Set(showRefnos);
    const hideRefnos = resolveBatchRefnos().filter((refno) => !showSet.has(refno));

    if (showRefnos.length > 0) {
      viewer.scene.setObjectsVisible(showRefnos, true);
    }
    if (hideRefnos.length > 0) {
      viewer.scene.setObjectsVisible(hideRefnos, false);
    }

    items.forEach((item) => {
      item.visible = item.dbnum === dbnum;
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
    spatialCapabilities,
    setMode,
    applyCurrentSelection,
    startPickCenter,
    submitQuery,
    resetQuery,
    clearResults,
    activateResult,
    countLoadTargets,
    loadResults,
    showOnlySpecGroup,
    showOnlyDbnumGroup,
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
