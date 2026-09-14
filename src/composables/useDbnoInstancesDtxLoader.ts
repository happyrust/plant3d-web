import { ref } from 'vue';

import { Box3, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Matrix4, SphereGeometry } from 'three';

import { realtimeInstancesByRefnos } from '@/api/genModelRealtimeApi';
import {
  type ParquetManifest,
  useDbnoInstancesParquetLoader,
} from '@/composables/useDbnoInstancesParquetLoader';
import { useDisplayThemeStore, type DisplayTheme } from '@/composables/useDisplayThemeStore';
import { getModelSource } from '@/model-source';
import { type InstanceEntry } from '@/utils/instances/instanceManifest';
import { parseGlbGeometryResult } from '@/utils/parseGlbGeometry';
import { parseMeshGeometryResult } from '@/utils/parseMeshGeometry';
import { DTXLayer } from '@/utils/three/dtx';
import {
  buildHiddenNounSet,
  buildHiddenRefnoSet,
  loadModelDisplayConfig,
  normalizeNounKey,
  normalizeRefnoKey,
  resolveInvalidTubiMaterial,
  resolveMaterialWithTheme,
  type ModelDisplayConfig,
} from '@/utils/three/dtx/materialConfig';

type LoaderOptions = {
  lodAssetKey?: string // "L1"
  debug?: boolean
  forceReloadRefnos?: string[]
  /** 隐藏 refno 现有对象并用本次结果替换，避免强制重载后新旧模型叠加。 */
  replaceExistingObjects?: boolean
  /** 即使 geoHash 未变化也重新拉取 GLB，用于显式模型重建。 */
  forceRefreshGeometries?: boolean
  /**
   * 数据源选择：
   * - 'parquet'：默认，DuckDB WASM 查 parquet（失败则抛错）
   * - 'backend'：实时查库（用于 parquet miss 回填）
   * - 'gen-model-v1'：gen-model `/api/v1`（ensure → records，plan 2026-09-06 P3-e）
   *
   * 页面级开关 `?model_source=gen-model-v1` 生效时，前两种会被**改写**成第三种（同一页面只该有一个几何数据源），
   * 只有调用方自带 `instanceEntriesByRefno` / `parquetManifestUrl`（不可变清单，版本对比）时不改。
   */
  dataSource?: 'parquet' | 'backend' | 'gen-model-v1'
  /** 人明确要求重生成（gen-model-v1 = `ensure(force=true)`）；其它数据源忽略 */
  forceRegenerate?: boolean
  includeOwnedTubings?: boolean
  /** 不可变最小交付单元提交的 manifest URL；提供后不读取 dbno 当前包。 */
  parquetManifestUrl?: string
  /** 已严格读取的清单快照，避免 latest 指针在加载期间再次解析到另一版本。 */
  parquetManifest?: ParquetManifest
  /** 校验不可变提交确实属于该最小交付单元根。 */
  expectedRootRefno?: string
  /** 使用独立运行时索引，避免版本对比对象污染当前模型的 refno 映射。 */
  isolated?: boolean
  /** 隔离对象的 ID 前缀，用于区分版本侧。 */
  objectIdPrefix?: string
  /** 调用方已按精确 manifest 读取的实例，供同 artifact 的多图层复用。 */
  instanceEntriesByRefno?: Map<string, InstanceEntry[]>
}

export type DtxMissingBreakdown = {
  noGeoRowsRefnos: string[]
  mesh404Refnos: string[]
  mesh404GeoHashes: string[]
}

export type DtxAabbProxyEntry = {
  refno: string
  noun?: string | null
  specValue?: number | null
  aabb: { min: number[]; max: number[] } | null
}

/**
 * 一次装载的几何来源身份（2026-09-14 云线范围体方案 §15 ③ / P0）：只记不用，供批注创建时填
 * `regionV1.source.modelSnapshotId`。拿不到身份就 `null`——backend 实时查询没有快照概念；
 * gen-model-v1 records 回包带 `snapshot_epoch` / `session_vector`，但 `src/model-source` 适配层尚未透传，先留空。
 */
export type DtxLoadSourceStamp = {
  dataSource: 'parquet' | 'backend' | 'gen-model-v1' | 'aabb-proxy'
  /** parquet 环境 / 最小交付单元版本 = `${dbno}:parquet:${generated_at}`；其它路径 `null` */
  modelSnapshotId: string | null
  /** 调用方显式钉住的不可变清单 URL（版本切换 / 版本对比）；「当前环境」加载为 `null` */
  manifestUrl: string | null
  generatedAt: string | null
  loadedAt: number
}

type DbnoRuntimeCache = {
  loadedRefnos: Set<string>
  loadedGeoHash: Set<string>
  geometryByGeoHash: Map<string, BufferGeometry>
  /** 记录曾经 404 的 geoHash；用于触发按 refno 的自动生成，并在后续 forceReload 时重新拉取 GLB */
  notFoundGeoHash: Set<string>
  failedGeoHash: Set<string>
  loadingGeoHash: Map<string, Promise<void>>
  objectCounter: number
  refnoToObjectIds: Map<string, string[]>
  objectIdToRefno: Map<string, string>
  objectIdToSpecValue: Map<string, number | null>
  refnoTransform: Map<string, number[]>
  refnoToNoun: Map<string, string>
  refnoToOwnerNoun: Map<string, string>
  refnoToOwnerRefno: Map<string, string>
  refnoToSpecValue: Map<string, number | null>
  /** 画成告警色的无效直管对象（gen-model `is_invalid_tubi`）；重刷材质时保住告警色 */
  invalidTubiObjectIds: Set<string>
  /** 直管对象（noun `TUBI` / gen-model `is_tubi`）：测量拾取层按它把对象当 E3D TUBING 拾成轴线 */
  tubiObjectIds: Set<string>
  /** refno → 最近一次把它装进场景的那批加载的来源身份（只记不用，见 `DtxLoadSourceStamp`） */
  refnoLoadSource: Map<string, DtxLoadSourceStamp>
}

const cachesByDbno = new Map<number, DbnoRuntimeCache>();
const AABB_PROXY_GEO_HASH = '__spatial_query_aabb_proxy_box';

/**
 * 运行时索引的修订号：每完成一批实例加载 / 替换（含版本切换重载）就 +1。
 * 只增不减，供批注关联解析（ADR-0050）等消费方 `watch` 后重算，
 * 省得它们各自去猜「模型什么时候装完了」。
 */
export const dtxLoaderRevision = ref(0);

function bumpDtxLoaderRevision(): void {
  dtxLoaderRevision.value += 1;
}

/** refno 的两种写法（`=24381/145018` 与 `24381_145018`）都试一遍，命中任一即算。 */
function refnoKeyCandidates(refno: string): string[] {
  const raw = String(refno ?? '').trim();
  if (!raw) return [];
  const out = new Set<string>([raw]);
  const noEq = raw.replace(/^=/, '');
  out.add(noEq);
  out.add(raw.replace('/', '_'));
  out.add(noEq.replace('/', '_'));
  out.add(normalizeRefnoKey(raw));
  return [...out].filter(Boolean);
}

/** 跨库：该 refno 的几何是否已装进场景（任一 dbno 缓存的 loadedRefnos 命中）。 */
export function isDtxRefnoLoadedAcrossAllDbnos(refno: string): boolean {
  const keys = refnoKeyCandidates(refno);
  if (keys.length === 0) return false;
  for (const cache of cachesByDbno.values()) {
    for (const key of keys) {
      if (cache.loadedRefnos.has(key)) return true;
    }
  }
  return false;
}

/** 跨库：运行时索引是否认识该 refno（noun 已登记），与几何是否加载无关。 */
export function isDtxRefnoKnownAcrossAllDbnos(refno: string): boolean {
  const keys = refnoKeyCandidates(refno);
  if (keys.length === 0) return false;
  for (const cache of cachesByDbno.values()) {
    for (const key of keys) {
      if (cache.refnoToNoun.has(key)) return true;
    }
  }
  return false;
}

function createRuntimeCache(): DbnoRuntimeCache {
  return {
    loadedRefnos: new Set(),
    loadedGeoHash: new Set(),
    geometryByGeoHash: new Map(),
    notFoundGeoHash: new Set(),
    failedGeoHash: new Set(),
    loadingGeoHash: new Map(),
    objectCounter: 0,
    refnoToObjectIds: new Map(),
    objectIdToRefno: new Map(),
    objectIdToSpecValue: new Map(),
    refnoTransform: new Map(),
    refnoToNoun: new Map(),
    refnoToOwnerNoun: new Map(),
    refnoToOwnerRefno: new Map(),
    refnoToSpecValue: new Map(),
    invalidTubiObjectIds: new Set(),
    tubiObjectIds: new Set(),
    refnoLoadSource: new Map(),
  };
}

function getCache(dbno: number): DbnoRuntimeCache {
  const existing = cachesByDbno.get(dbno);
  if (existing) {
    if (!existing.objectIdToSpecValue) existing.objectIdToSpecValue = new Map();
    if (!existing.geometryByGeoHash) existing.geometryByGeoHash = new Map();
    if (!existing.failedGeoHash) existing.failedGeoHash = new Set();
    if (!existing.invalidTubiObjectIds) existing.invalidTubiObjectIds = new Set();
    if (!existing.tubiObjectIds) existing.tubiObjectIds = new Set();
    if (!existing.refnoLoadSource) existing.refnoLoadSource = new Map();
    return existing;
  }
  const created = createRuntimeCache();
  cachesByDbno.set(dbno, created);
  return created;
}

function createFallbackBoxGeometry(): BufferGeometry {
  const positions = new Float32Array([
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  g.setIndex(new BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

let cachedUnitBoxGeometry: BufferGeometry | null = null;
function getUnitBoxGeometry(): BufferGeometry {
  if (cachedUnitBoxGeometry) return cachedUnitBoxGeometry;
  cachedUnitBoxGeometry = createFallbackBoxGeometry();
  return cachedUnitBoxGeometry;
}

let cachedUnitTubiGeometry: BufferGeometry | null = null;

/**
 * TUBI 几何体兜底：单位圆柱（对齐后端常用约定：z=[0..1]）。
 *
 * 说明：部分数据集的 instances_{dbno}.json 里，tubings[].geo_hash 会是 `tubi_{refno}`，但后端并不输出对应 GLB。
 * 此处直接用程序生成的单位圆柱承接（几何由 transform 缩放/旋转/平移到位）。
 */
function getUnitTubiGeometry(): BufferGeometry {
  if (cachedUnitTubiGeometry) return cachedUnitTubiGeometry;

  // three.js CylinderGeometry 默认沿 Y 轴、中心在原点、高度=1。
  // 我们把它旋转到 Z 轴，并整体平移到 z=[0..1] 区间。
  const g = new CylinderGeometry(0.5, 0.5, 1, 16, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  g.computeBoundingBox();

  cachedUnitTubiGeometry = g;
  return g;
}

let cachedUnitSphereGeometry: BufferGeometry | null = null;
function getUnitSphereGeometry(): BufferGeometry {
  if (cachedUnitSphereGeometry) return cachedUnitSphereGeometry;
  const g = new SphereGeometry(0.5, 16, 12);
  g.computeBoundingBox();
  cachedUnitSphereGeometry = g;
  return g;
}

function parseSpecValue(rawSpecValue: unknown): number | null {
  if (typeof rawSpecValue === 'number') {
    return Number.isFinite(rawSpecValue) ? rawSpecValue : null;
  }
  if (typeof rawSpecValue === 'string') {
    const trimmed = rawSpecValue.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function ensureGeometryForGeoHash(
  dtxLayer: DTXLayer,
  dbno: number,
  geoHash: string,
  lodAssetKey: string,
  debug: boolean,
  options: { forceRetryNotFound?: boolean; forceRefresh?: boolean } = {}
): Promise<{ status: 'ok' | 'not_found' | 'error'; notFoundNew: boolean }> {
  const cache = getCache(dbno);
  const wasNotFound = cache.notFoundGeoHash.has(geoHash);
  const wasFailed = cache.failedGeoHash.has(geoHash);
  const forceRetryNotFound = options.forceRetryNotFound === true;
  const forceRefresh = options.forceRefresh === true;
  const cachedGeometry = cache.geometryByGeoHash.get(geoHash);
  if (
    !forceRefresh
    && cache.loadedGeoHash.has(geoHash)
    && !(forceRetryNotFound && (wasNotFound || wasFailed))
  ) {
    if (!dtxLayer.hasGeometry(geoHash) && cachedGeometry) {
      dtxLayer.addGeometry(geoHash, cachedGeometry);
    }
    if (dtxLayer.hasGeometry(geoHash)) {
      return {
        status: wasNotFound ? 'not_found' : wasFailed ? 'error' : 'ok',
        notFoundNew: false,
      };
    }
  }
  // 已加载且非 404：无需再拉取
  if (!forceRefresh && cache.loadedGeoHash.has(geoHash) && !wasNotFound && !wasFailed && dtxLayer.hasGeometry(geoHash)) {
    return { status: 'ok', notFoundNew: false };
  }
  const pending = cache.loadingGeoHash.get(geoHash);
  if (pending) {
    await pending;
    const resolvedGeometry = cache.geometryByGeoHash.get(geoHash);
    if (!dtxLayer.hasGeometry(geoHash) && resolvedGeometry) {
      dtxLayer.addGeometry(geoHash, resolvedGeometry);
    }
    return {
      status: cache.notFoundGeoHash.has(geoHash)
        ? 'not_found'
        : cache.failedGeoHash.has(geoHash)
          ? 'error'
          : 'ok',
      notFoundNew: false,
    };
  }

  const task = (async () => {
    // 基础几何体（后端约定 geo_hash = 1/2/3），直接在前端生成，避免无意义的 GLB 请求。
    const basic = String(geoHash).trim();
    if (basic === '1') {
      const geometry = getUnitBoxGeometry();
      dtxLayer.addGeometry(geoHash, geometry);
      cache.geometryByGeoHash.set(geoHash, geometry);
      cache.loadedGeoHash.add(geoHash);
      cache.notFoundGeoHash.delete(geoHash);
      cache.failedGeoHash.delete(geoHash);
      return { status: 'ok' as const, notFoundNew: false };
    }
    if (basic === '2') {
      // CYLINDER/TUBI 在后端均使用 2，统一用单位圆柱承接
      const geometry = getUnitTubiGeometry();
      dtxLayer.addGeometry(geoHash, geometry);
      cache.geometryByGeoHash.set(geoHash, geometry);
      cache.loadedGeoHash.add(geoHash);
      cache.notFoundGeoHash.delete(geoHash);
      cache.failedGeoHash.delete(geoHash);
      return { status: 'ok' as const, notFoundNew: false };
    }
    if (basic === '3') {
      const geometry = getUnitSphereGeometry();
      dtxLayer.addGeometry(geoHash, geometry);
      cache.geometryByGeoHash.set(geoHash, geometry);
      cache.loadedGeoHash.add(geoHash);
      cache.notFoundGeoHash.delete(geoHash);
      cache.failedGeoHash.delete(geoHash);
      return { status: 'ok' as const, notFoundNew: false };
    }

    // 约定：tubi_* 属于“虚拟管段几何”（unit cylinder），不走 glb 下载。
    // 这样可避免大量 404 噪音，并确保“管道只有标注不见模型”的场景可直接显示。
    if (geoHash.startsWith('tubi_') || geoHash.startsWith('t_')) {
      const geometry = getUnitTubiGeometry();
      dtxLayer.addGeometry(geoHash, geometry);
      cache.geometryByGeoHash.set(geoHash, geometry);
      cache.loadedGeoHash.add(geoHash);
      cache.notFoundGeoHash.delete(geoHash);
      cache.failedGeoHash.delete(geoHash);
      return { status: 'ok' as const, notFoundNew: false };
    }

    // URL 模板由数据源给：legacy = `/files/meshes/lod_{L}/{hash}_{L}.glb`（逐字同前），
    // gen-model-v1 = `/api/v1/meshes/{hash}.mesh`（rkyv 原样直连，2026-09-09 拍板）。
    // 两种线上形态解析出同一份 {positions, indices, normals?}，按后缀选解析器。
    const meshUrl = getModelSource().meshes.meshUrl(geoHash, lodAssetKey);
    let geometry: BufferGeometry | null = null;
    let notFound = false;
    let notFoundNew = false;

    try {
      const resp = await fetch(meshUrl);
      if (resp.status === 404) {
        notFound = true;
        notFoundNew = !cache.notFoundGeoHash.has(geoHash);
        cache.notFoundGeoHash.add(geoHash);
      }
      if (!resp.ok && resp.status !== 404) {
        console.error('[dtx][instances-json] mesh request failed', {
          geoHash,
          meshUrl,
          status: resp.status,
          statusText: resp.statusText,
        });
      }
      if (resp.ok) {
        const meshData = await resp.arrayBuffer();
        const parseResult = meshUrl.endsWith('.mesh')
          ? parseMeshGeometryResult(meshData, meshUrl)
          : await parseGlbGeometryResult(meshData, meshUrl);
        if (parseResult.ok) {
          const parsed = parseResult.data;
          const g = new BufferGeometry();
          g.setAttribute('position', new BufferAttribute(new Float32Array(parsed.positions), 3));
          if (parsed.normals && parsed.normals.length > 0) {
            g.setAttribute('normal', new BufferAttribute(new Float32Array(parsed.normals), 3));
          }
          g.setIndex(new BufferAttribute(new Uint32Array(parsed.indices), 1));
          g.computeBoundingBox();
          geometry = g;
        } else {
          console.error('[dtx][instances-json] mesh validation failed', {
            geoHash,
            meshUrl,
            error: parseResult.error.message,
            issue: parseResult.error.issue,
          });
        }
      }
    } catch (e) {
      if (debug) console.warn('[dtx][instances-json] load mesh failed', { geoHash, meshUrl, e });
    }

    if (geometry) {
      if (forceRefresh) {
        dtxLayer.replaceGeometry(geoHash, geometry);
      } else {
        dtxLayer.addGeometry(geoHash, geometry);
      }
      cache.geometryByGeoHash.set(geoHash, geometry);
      cache.loadedGeoHash.add(geoHash);
      cache.notFoundGeoHash.delete(geoHash);
      cache.failedGeoHash.delete(geoHash);
      return { status: 'ok' as const, notFoundNew: false };
    }

    // 404 或解析失败：用兜底盒子承接，避免完全不可见；同时保留 notFound 标记，便于后续生成后重拉 GLB。
    const fallbackGeometry = getUnitBoxGeometry();
    dtxLayer.addGeometry(geoHash, fallbackGeometry);
    cache.geometryByGeoHash.set(geoHash, fallbackGeometry);
    cache.loadedGeoHash.add(geoHash);
    cache.failedGeoHash.add(geoHash);
    return { status: notFound ? ('not_found' as const) : ('error' as const), notFoundNew };
  })();

  cache.loadingGeoHash.set(geoHash, task);
  try {
    return await task;
  } finally {
    cache.loadingGeoHash.delete(geoHash);
  }
}

async function ensureGeometriesForGeoHashes(
  dtxLayer: DTXLayer,
  dbno: number,
  geoHashes: string[],
  lodAssetKey: string,
  debug: boolean,
  options: {
    concurrency?: number
    forceRetryNotFound?: boolean
    forceRefresh?: boolean
    collectAllFailures?: boolean
  } = {}
): Promise<string[]> {
  const cache = getCache(dbno);
  const forceRetryNotFound = options.forceRetryNotFound === true;
  const forceRefresh = options.forceRefresh === true;
  const unique = Array.from(new Set(geoHashes)).filter((h) => {
    if (!h) return false;
    if (forceRefresh) return true;
    if (!dtxLayer.hasGeometry(h)) return true;
    if (!cache.loadedGeoHash.has(h)) return true;
    // 对曾经 404 的几何体：允许重试拉取（用于生成完成后的 forceReload）。
    return forceRetryNotFound && (cache.notFoundGeoHash.has(h) || cache.failedGeoHash.has(h));
  });
  if (unique.length === 0) return [];

  const queue = unique.slice();
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, queue.length));
  const missing = new Set<string>();

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const geoHash = queue.pop();
      if (!geoHash) continue;
      const res = await ensureGeometryForGeoHash(dtxLayer, dbno, geoHash, lodAssetKey, debug, {
        forceRetryNotFound,
        forceRefresh,
      });
      if (
        (options.collectAllFailures && res.status !== 'ok')
        || (res.status === 'not_found' && res.notFoundNew)
      ) {
        missing.add(geoHash);
      }
    }
  });

  await Promise.all(workers);
  return Array.from(missing);
}

export function resolveDtxObjectIdsByRefno(dbno: number, refno: string): string[] {
  const cache = cachesByDbno.get(dbno);
  const key = String(refno ?? '').trim().replace('/', '_');
  return cache?.refnoToObjectIds.get(key) ?? [];
}

export function resolveDtxObjectIdsByUnitRefno(dbno: number, unitRefno: string): string[] {
  const cache = cachesByDbno.get(dbno);
  const root = normalizeRefnoKey(String(unitRefno ?? ''));
  if (!cache || !root) return [];
  const objectIds = new Set<string>();
  for (const [refno, ids] of cache.refnoToObjectIds) {
    let current = refno;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      if (current === root) {
        for (const objectId of ids) objectIds.add(objectId);
        break;
      }
      visited.add(current);
      current = cache.refnoToOwnerRefno.get(current) || '';
    }
  }
  return [...objectIds];
}

export function isDtxRefnoLoaded(dbno: number, refno: string): boolean {
  const cache = cachesByDbno.get(dbno);
  if (!cache) return false;
  const key = String(refno ?? '').trim().replace('/', '_');
  return cache.loadedRefnos.has(key);
}

export function hasDtxDbnoCache(dbno: number): boolean {
  return cachesByDbno.has(dbno);
}

/** 该 refno 最近一次被装进场景时的几何来源身份；没装过（或缓存里没有该 dbno）返回 `null`。 */
export function getDtxRefnoLoadSource(dbno: number, refno: string): DtxLoadSourceStamp | null {
  const cache = cachesByDbno.get(dbno);
  if (!cache) return null;
  for (const key of refnoKeyCandidates(refno)) {
    const stamp = cache.refnoLoadSource.get(key);
    if (stamp) return stamp;
  }
  return null;
}

/** `getDtxRefnoLoadSource` 的跨库版本：gen-model-v1 源下调用方常常拿不到 dbno。 */
export function getDtxRefnoLoadSourceAcrossAllDbnos(refno: string): DtxLoadSourceStamp | null {
  const keys = refnoKeyCandidates(refno);
  if (keys.length === 0) return null;
  for (const cache of cachesByDbno.values()) {
    for (const key of keys) {
      const stamp = cache.refnoLoadSource.get(key);
      if (stamp) return stamp;
    }
  }
  return null;
}

export function resolveDtxRefnoByObjectId(dbno: number, objectId: string): string | null {
  const cache = cachesByDbno.get(dbno);
  return cache?.objectIdToRefno.get(objectId) ?? null;
}

/** 该对象是否是直管（noun `TUBI` / gen-model `is_tubi`）：测量拾取层把它当 E3D TUBING 拾成轴线。 */
export function isDtxTubiObject(dbno: number, objectId: string): boolean {
  return cachesByDbno.get(dbno)?.tubiObjectIds.has(objectId) ?? false;
}

/** `isDtxTubiObject` 的跨库版本：gen-model-v1 源下调用方常常拿不到 dbno。 */
export function isDtxTubiObjectAcrossAllDbnos(objectId: string): boolean {
  for (const cache of cachesByDbno.values()) {
    if (cache.tubiObjectIds?.has(objectId)) return true;
  }
  return false;
}

/**
 * 同一 refno（BRAN / HANG）下已登记的全部直管对象 id（`o:<refno>:<n>`），跨库。
 * 测量拾取层把 ATTA 处断开的两段直管按 E3D `EDGTUBING.line` 合成一条轴线时，用它找另一段。
 */
export function listDtxTubiObjectIdsForRefno(refno: string): string[] {
  const prefix = `o:${String(refno ?? '').trim().replace(/\//g, '_')}:`;
  if (prefix.length <= 3) return [];
  const out: string[] = [];
  for (const cache of cachesByDbno.values()) {
    for (const objectId of cache.tubiObjectIds ?? []) {
      if (objectId.startsWith(prefix)) out.push(objectId);
    }
  }
  return out;
}

export function getDtxRefnoTransform(dbno: number, refno: string): number[] | undefined {
  const cache = cachesByDbno.get(dbno);
  return cache?.refnoTransform.get(refno);
}

export function resolveDtxNounByRefno(dbno: number, refno: string): string | null {
  const cache = cachesByDbno.get(dbno);
  return cache?.refnoToNoun.get(refno) ?? null;
}

/** 遍历所有已加载的 dbno 缓存，查找 refno 对应的 noun 类型 */
export function findNounByRefnoAcrossAllDbnos(refno: string): string | null {
  for (const cache of cachesByDbno.values()) {
    const noun = cache.refnoToNoun.get(refno);
    if (noun) return noun;
  }
  return null;
}

export function findSpecValueByRefnoAcrossAllDbnos(refno: string): number | null {
  for (const cache of cachesByDbno.values()) {
    const specValue = cache.refnoToSpecValue.get(refno);
    if (typeof specValue === 'number') return specValue;
  }
  return null;
}

/** 查找元件所属的 BRAN/HANG refno */
export function findOwnerRefnoByTubi(childRefno: string): string | null {
  // 优先使用缓存的 owner_refno
  for (const cache of cachesByDbno.values()) {
    const ownerRefno = cache.refnoToOwnerRefno.get(childRefno);
    if (ownerRefno) {
      const ownerNoun = cache.refnoToNoun.get(ownerRefno);
      if (ownerNoun === 'BRAN' || ownerNoun === 'HANG') return ownerRefno;
    }
  }
  // fallback: 通过前缀匹配查找
  for (const cache of cachesByDbno.values()) {
    for (const [branRefno, noun] of cache.refnoToNoun.entries()) {
      if ((noun === 'BRAN' || noun === 'HANG') && childRefno.startsWith(branRefno)) {
        return branRefno;
      }
    }
  }
  return null;
}

export function resolveDtxOwnerNounByRefno(dbno: number, refno: string): string | null {
  const cache = cachesByDbno.get(dbno);
  return cache?.refnoToOwnerNoun.get(refno) ?? null;
}

export function getDtxNounCounts(dbno: number): { noun: string; count: number }[] {
  const cache = cachesByDbno.get(dbno);
  if (!cache) return [];
  const counts = new Map<string, number>();
  for (const noun of cache.refnoToNoun.values()) {
    const key = normalizeNounKey(noun);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([noun, count]) => ({ noun, count }));
}

export function applyMaterialConfigToLoadedDtx(
  dtxLayer: DTXLayer,
  dbno: number,
  config: ModelDisplayConfig,
  theme: DisplayTheme = 'default',
): { updatedObjects: number } {
  const cache = cachesByDbno.get(dbno);
  if (!cache) return { updatedObjects: 0 };

  const hiddenNouns = buildHiddenNounSet(config);
  const hiddenRefnos = buildHiddenRefnoSet(config);
  let updatedObjects = 0;

  for (const [refno, objectIds] of cache.refnoToObjectIds.entries()) {
    const refnoKey = normalizeRefnoKey(refno);
    const noun = normalizeNounKey(cache.refnoToNoun.get(refno) || '');
    const ownerNoun = normalizeNounKey(cache.refnoToOwnerNoun.get(refno) || '');
    const isHidden = hiddenRefnos.has(refnoKey) || (noun && hiddenNouns.has(noun));

    for (const objectId of objectIds) {
      const objectSpecValue = cache.objectIdToSpecValue.get(objectId) ?? cache.refnoToSpecValue.get(refno) ?? null;
      // 无效直管保持告警色，不跟主题 / 专业色走
      const resolved = cache.invalidTubiObjectIds?.has(objectId)
        ? resolveInvalidTubiMaterial(config, refnoKey)
        : resolveMaterialWithTheme(config, refnoKey, noun, ownerNoun, theme, objectSpecValue);
      if (isHidden || resolved.hidden) {
        dtxLayer.setObjectVisible(objectId, false);
        continue;
      }
      dtxLayer.setObjectVisible(objectId, true);
      dtxLayer.setObjectMaterial(objectId, {
        color: resolved.color,
        metalness: resolved.metalness,
        roughness: resolved.roughness,
        opacity: resolved.opacity,
      });
      updatedObjects++;
    }
  }

  return { updatedObjects };
}

function normalizeAabbProxy(aabb: DtxAabbProxyEntry['aabb']): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!aabb || !Array.isArray(aabb.min) || !Array.isArray(aabb.max)) return null;
  const values = [
    Number(aabb.min[0]), Number(aabb.min[1]), Number(aabb.min[2]),
    Number(aabb.max[0]), Number(aabb.max[1]), Number(aabb.max[2]),
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;

  return {
    min: [
      Math.min(values[0]!, values[3]!),
      Math.min(values[1]!, values[4]!),
      Math.min(values[2]!, values[5]!),
    ],
    max: [
      Math.max(values[0]!, values[3]!),
      Math.max(values[1]!, values[4]!),
      Math.max(values[2]!, values[5]!),
    ],
  };
}

export function loadDtxAabbProxyRefnos(
  dtxLayer: DTXLayer,
  dbno: number,
  entries: DtxAabbProxyEntry[],
): { loadedRefnos: string[]; missingRefnos: string[]; loadedObjects: number; skippedObjects: number } {
  const normalizedEntries = entries
    .map((entry) => ({
      ...entry,
      refno: normalizeRefnoKey(entry.refno),
      normalizedAabb: normalizeAabbProxy(entry.aabb),
    }))
    .filter((entry) => !!entry.refno);

  if (normalizedEntries.length === 0) {
    return { loadedRefnos: [], missingRefnos: [], loadedObjects: 0, skippedObjects: 0 };
  }

  const cache = getCache(dbno);
  dtxLayer.addGeometry(AABB_PROXY_GEO_HASH, getUnitBoxGeometry());
  cache.loadedGeoHash.add(AABB_PROXY_GEO_HASH);

  const loadedRefnos: string[] = [];
  const missingRefnos: string[] = [];
  let loadedObjects = 0;
  let skippedObjects = 0;
  const sourceStamp: DtxLoadSourceStamp = {
    dataSource: 'aabb-proxy',
    modelSnapshotId: null,
    manifestUrl: null,
    generatedAt: null,
    loadedAt: Date.now(),
  };

  for (const entry of normalizedEntries) {
    const refno = entry.refno;
    const aabb = entry.normalizedAabb;
    if (!aabb) {
      missingRefnos.push(refno);
      continue;
    }

    const sizeX = Math.max(aabb.max[0] - aabb.min[0], 1);
    const sizeY = Math.max(aabb.max[1] - aabb.min[1], 1);
    const sizeZ = Math.max(aabb.max[2] - aabb.min[2], 1);
    const centerX = (aabb.min[0] + aabb.max[0]) / 2;
    const centerY = (aabb.min[1] + aabb.max[1]) / 2;
    const centerZ = (aabb.min[2] + aabb.max[2]) / 2;

    const objectId = `o:${refno}:spatial-proxy`;
    const matrix = new Matrix4().makeScale(sizeX, sizeY, sizeZ);
    matrix.setPosition(centerX, centerY, centerZ);

    if (!dtxLayer.hasObject(objectId)) {
      dtxLayer.addObject(
        objectId,
        AABB_PROXY_GEO_HASH,
        matrix,
        new Color(0x14b8a6),
        { metalness: 0.05, roughness: 0.78, opacity: 0.38 },
        { min: aabb.min, max: aabb.max },
      );
      loadedObjects++;
    } else {
      skippedObjects++;
    }

    const existingObjectIds = cache.refnoToObjectIds.get(refno) ?? [];
    if (!existingObjectIds.includes(objectId)) {
      cache.refnoToObjectIds.set(refno, [...existingObjectIds, objectId]);
    }
    cache.objectIdToRefno.set(objectId, refno);
    cache.objectIdToSpecValue.set(objectId, parseSpecValue(entry.specValue));
    cache.refnoTransform.set(refno, matrix.toArray());
    cache.refnoToNoun.set(refno, normalizeNounKey(entry.noun || '') || 'AABB_PROXY');
    if (!cache.refnoToSpecValue.has(refno)) {
      cache.refnoToSpecValue.set(refno, parseSpecValue(entry.specValue));
    }
    cache.loadedRefnos.add(refno);
    cache.refnoLoadSource.set(refno, sourceStamp);
    loadedRefnos.push(refno);
  }

  if (loadedObjects > 0) {
    dtxLayer.recompile();
  }
  if (loadedRefnos.length > 0) bumpDtxLoaderRevision();

  return {
    loadedRefnos: Array.from(new Set(loadedRefnos)),
    missingRefnos: Array.from(new Set(missingRefnos)),
    loadedObjects,
    skippedObjects,
  };
}

export async function loadDbnoInstancesForVisibleRefnosDtx(
  dtxLayer: DTXLayer,
  dbno: number,
  refnos: string[],
  options: LoaderOptions = {}
): Promise<{
  loadedRefnos: number
  skippedRefnos: number
  loadedObjects: number
  /** 这次画成告警色的无效直管对象数（gen-model `is_invalid_tubi`；legacy 源永远 0） */
  invalidTubiObjects?: number
  missingRefnos: string[]
  missingBreakdown: DtxMissingBreakdown
  sceneBoundingBox: Box3
}> {
  const debug = options.debug === true;
  const lodAssetKey = options.lodAssetKey || 'L1';
  const forceReloadSet = options.forceReloadRefnos && options.forceReloadRefnos.length > 0
    ? new Set(options.forceReloadRefnos)
    : null;
  const createEmptyMissingBreakdown = (): DtxMissingBreakdown => ({
    noGeoRowsRefnos: [],
    mesh404Refnos: [],
    mesh404GeoHashes: [],
  });

  if (refnos.length === 0) {
    return {
      loadedRefnos: 0,
      skippedRefnos: 0,
      loadedObjects: 0,
      missingRefnos: [],
      missingBreakdown: createEmptyMissingBreakdown(),
      sceneBoundingBox: dtxLayer.getBoundingBox(),
    };
  }

  const cache = options.isolated === true ? createRuntimeCache() : getCache(dbno);
  const objectIdPrefix = options.objectIdPrefix?.trim() || 'o';
  const normalizedRefnos = refnos
    .map((r) => normalizeRefnoKey(String(r ?? '')))
    .filter((r) => !!r);
  const normalizedForceReload = forceReloadSet
    ? new Set(Array.from(forceReloadSet).map((r) => normalizeRefnoKey(String(r ?? ''))).filter((r) => !!r))
    : null;
  const replaceExistingObjects = options.replaceExistingObjects === true;
  const forceRefreshGeometries = options.forceRefreshGeometries === true;

  const toLoad = Array.from(new Set(normalizedRefnos))
    .filter((r) => (normalizedForceReload && normalizedForceReload.has(r)) || !cache.loadedRefnos.has(r));
  if (toLoad.length === 0) {
    return {
      loadedRefnos: 0,
      skippedRefnos: refnos.length,
      loadedObjects: 0,
      missingRefnos: [],
      missingBreakdown: createEmptyMissingBreakdown(),
      sceneBoundingBox: dtxLayer.getBoundingBox(),
    };
  }

  const displayConfig = await loadModelDisplayConfig();
  const hiddenNouns = buildHiddenNounSet(displayConfig);
  const hiddenRefnos = buildHiddenRefnoSet(displayConfig);

  const { currentTheme } = useDisplayThemeStore();
  const currentLoadTheme: DisplayTheme = currentTheme.value;

  // 根据 dataSource 选项决定数据源；页面级开关切到 gen-model-v1 时改写（不可变清单的调用除外）
  const modelSource = getModelSource();
  const pinnedByCaller = !!options.instanceEntriesByRefno || !!options.parquetManifestUrl || !!options.parquetManifest;
  const dataSource: 'parquet' | 'backend' | 'gen-model-v1' =
    !pinnedByCaller && modelSource.kind === 'gen-model-v1' ? 'gen-model-v1' : (options.dataSource || 'parquet');
  let index: Map<string, InstanceEntry[]>;
  let parquetGeneratedAt: string | null = null;

  if (options.instanceEntriesByRefno) {
    index = options.instanceEntriesByRefno;
  } else if (dataSource === 'gen-model-v1') {
    const source = modelSource.kind === 'gen-model-v1' ? modelSource : getModelSource('gen-model-v1');
    index = await source.records.instanceEntriesByRefnos(dbno, toLoad, {
      debug,
      forceRefresh: normalizedForceReload !== null,
      forceRegenerate: options.forceRegenerate === true,
      includeOwnedTubings: options.includeOwnedTubings,
      expectedRootRefno: options.expectedRootRefno,
    });
    if (debug) console.log('[dtx][instances] using gen-model-v1', { dbno, refnos: toLoad.length, indexSize: index.size });
  } else if (dataSource === 'backend') {
    const resp = await realtimeInstancesByRefnos(dbno, toLoad, {
      includeTubings: true,
      enableHoles: true,
    });
    if (!resp.success) {
      throw new Error(resp.message || `后端实时查询失败 (dbno=${dbno})`);
    }
    index = new Map();
    for (const [rawRefno, entries] of Object.entries(resp.instances_by_refno || {})) {
      const refnoKey = normalizeRefnoKey(rawRefno);
      if (!refnoKey) continue;
      index.set(refnoKey, Array.isArray(entries) ? entries : []);
    }
    if (debug) console.log('[dtx][instances] using backend', { dbno, refnos: toLoad.length, indexSize: index.size, missing: resp.missing_refnos?.length ?? 0 });
  } else {
    const parquet = useDbnoInstancesParquetLoader();
    if (!options.parquetManifestUrl) {
      const available = await parquet.isParquetAvailable(dbno);
      if (!available) {
        throw new Error(`Parquet not available (dbno=${dbno})`);
      }
    }
    index = await parquet.queryInstanceEntriesByRefnos(dbno, toLoad, {
      debug,
      forceRefresh: normalizedForceReload !== null,
      includeOwnedTubings: options.includeOwnedTubings,
      manifestUrl: options.parquetManifestUrl,
      expectedRootRefno: options.expectedRootRefno,
      pinnedManifest: options.parquetManifest,
    });
    if (debug) console.log('[dtx][instances] using parquet', { dbno, refnos: toLoad.length });
    // 这次查询实际注册的清单（当前环境 / 钉住的不可变版本都从这里拿 generated_at）
    parquetGeneratedAt = options.parquetManifest?.generated_at
      ?? parquet.lastRegisteredManifest?.value?.generatedAt
      ?? null;
  }

  const sourceStamp: DtxLoadSourceStamp = {
    dataSource,
    modelSnapshotId: dataSource === 'parquet' && parquetGeneratedAt ? `${dbno}:parquet:${parquetGeneratedAt}` : null,
    manifestUrl: options.parquetManifestUrl ?? null,
    generatedAt: parquetGeneratedAt,
    loadedAt: Date.now(),
  };

  let loadedObjects = 0;
  let invalidTubiObjects = 0;
  const missingRefnos: string[] = [];
  const noGeoRowsRefnos = new Set<string>();
  const mesh404Refnos = new Set<string>();
  const mesh404GeoHashes = new Set<string>();

  // 预取本次需要的所有几何体（并发 + 去重），避免在实例循环中串行 await
  const neededGeoHashes = new Set<string>();
  const geoHashToRefnos = new Map<string, Set<string>>();
  for (const refno of toLoad) {
    // 隐藏 refno：不预取几何体，也不参与“缺失 mesh -> 触发生成”逻辑。
    if (hiddenRefnos.has(refno)) continue;
    const insts = index.get(refno) || [];
    for (const inst of insts) {
      const geoHash = String((inst as any).geo_hash || '');
      if (!geoHash) continue;
      neededGeoHashes.add(geoHash);
      let set = geoHashToRefnos.get(geoHash);
      if (!set) {
        set = new Set<string>();
        geoHashToRefnos.set(geoHash, set);
      }
      set.add(refno);
    }
  }
  const missingGeoHashes = await ensureGeometriesForGeoHashes(dtxLayer, dbno, Array.from(neededGeoHashes), lodAssetKey, debug, {
    concurrency: 8,
    forceRetryNotFound: normalizedForceReload !== null,
    forceRefresh: forceRefreshGeometries,
    collectAllFailures: replaceExistingObjects,
  });
  if (missingGeoHashes.length > 0) {
    const extraMissing = new Set<string>();
    for (const gh of missingGeoHashes) {
      mesh404GeoHashes.add(gh);
      const owners = geoHashToRefnos.get(gh);
      if (!owners) continue;
      for (const r of owners) extraMissing.add(r);
    }
    if (extraMissing.size > 0) {
      // 将“mesh 404”映射为“缺失 refno”，交由上层触发 SSE 生成并 forceReload。
      const existing = new Set<string>(missingRefnos);
      for (const r of extraMissing) {
        mesh404Refnos.add(r);
        if (!existing.has(r)) {
          missingRefnos.push(r);
          existing.add(r);
        }
      }
    }
  }

  // 替换必须等实例与几何全部取得后才隐藏旧对象；刷新失败时保留旧环境。
  if (replaceExistingObjects && missingGeoHashes.length > 0) {
    throw new Error(`替换模型所需几何不完整: ${missingGeoHashes.join(', ')}`);
  }
  const replacementSnapshot = replaceExistingObjects
    ? {
      objectCount: dtxLayer.getAllObjectIds().length,
      visibility: new Map(
        dtxLayer.getAllObjectIds().map((objectId) => [objectId, dtxLayer.isObjectVisible(objectId)]),
      ),
      objectCounter: cache.objectCounter,
      refnoToObjectIds: new Map(
        [...cache.refnoToObjectIds].map(([refno, objectIds]) => [refno, [...objectIds]]),
      ),
      objectIdToRefno: new Map(cache.objectIdToRefno),
      objectIdToSpecValue: new Map(cache.objectIdToSpecValue),
      refnoTransform: new Map(
        [...cache.refnoTransform].map(([refno, transform]) => [refno, [...transform]]),
      ),
      refnoToNoun: new Map(cache.refnoToNoun),
      refnoToOwnerNoun: new Map(cache.refnoToOwnerNoun),
      refnoToOwnerRefno: new Map(cache.refnoToOwnerRefno),
      refnoToSpecValue: new Map(cache.refnoToSpecValue),
      loadedRefnos: new Set(cache.loadedRefnos),
      invalidTubiObjectIds: new Set(cache.invalidTubiObjectIds),
      tubiObjectIds: new Set(cache.tubiObjectIds),
      refnoLoadSource: new Map(cache.refnoLoadSource),
    }
    : null;
  if (replaceExistingObjects) {
    for (const refno of toLoad) {
      const previousObjectIds = cache.refnoToObjectIds.get(refno) ?? [];
      if (previousObjectIds.length > 0) {
        dtxLayer.setObjectsVisible(previousObjectIds, false);
      }
      cache.refnoToObjectIds.set(refno, []);
      cache.loadedRefnos.delete(refno);
      cache.refnoLoadSource.delete(refno);
    }
  }

  try {
    for (const refnoKey of toLoad) {
      if (hiddenRefnos.has(refnoKey)) {
        cache.loadedRefnos.add(refnoKey);
        cache.refnoLoadSource.set(refnoKey, sourceStamp);
        cache.refnoToObjectIds.set(refnoKey, []);
        continue;
      }

      const insts = index.get(refnoKey) || [];
      if (insts.length === 0) {
        noGeoRowsRefnos.add(refnoKey);
        if (!missingRefnos.includes(refnoKey)) missingRefnos.push(refnoKey);
        continue;
      }

      const bucketHasOwnGeometry = insts.some((inst) => {
        const geoHash = String((inst as any).geo_hash || '');
        if (!geoHash) return false;
        const actualRefnoKey = normalizeRefnoKey(String((inst as any).uniforms?.refno || refnoKey));
        const noun = normalizeNounKey((inst as any).uniforms?.noun || (inst as any)._noun || '');
        return actualRefnoKey === refnoKey && noun !== 'TUBI';
      });

      const objectIdsByMappedRefno = new Map<string, string[]>();
      let refnoNoun = '';

      for (const inst of insts) {
        const geoHash = String((inst as any).geo_hash || '');
        if (!geoHash) continue;

        // 检查 matrix 数据是否有效（跳过包含 null 的数据）
        const matrixData = (inst as any).matrix;
        if (!matrixData || !Array.isArray(matrixData) || matrixData.length !== 16) {
          continue;
        }
        // 检查 matrix 数组中是否包含 null 或 undefined
        if (matrixData.some((v: any) => v === null || v === undefined || typeof v !== 'number')) {
          continue;
        }
        const matrix = new Matrix4().fromArray(matrixData);

        const noun = normalizeNounKey((inst as any).uniforms?.noun || (inst as any)._noun || '');
        const specValue = parseSpecValue((inst as any).uniforms?.spec_value);
        const actualRefnoKey = normalizeRefnoKey(String((inst as any).uniforms?.refno || refnoKey)) || refnoKey;
        if (noun && !refnoNoun) {
          refnoNoun = noun;
        }
        if (noun && hiddenNouns.has(noun)) {
          continue;
        }
        const ownerRefFromUniforms = normalizeRefnoKey(String((inst as any).uniforms?.owner_refno || ''));

        // 某些 fitting（如 ELBO）自身已有几何时，还会混入同 refno 的 TUBI。
        // 若直接挂在 fitting 下，选择/高亮会连带直管；若直接丢弃，BRAN 只剩 fittings 变成碎点。
        // 有独立 BRAN/HANG owner 时：保留绘制，但把 object 挂到 owner_refno。
        // 无独立 owner 时：保持旧行为跳过，避免污染 fitting 选择。
        if (bucketHasOwnGeometry && noun === 'TUBI' && actualRefnoKey === refnoKey) {
          if (!ownerRefFromUniforms || ownerRefFromUniforms === actualRefnoKey) {
            continue;
          }
        }

        const instOwnerNoun = (() => {
          const raw = normalizeNounKey((inst as any).uniforms?.owner_noun || '');
          if (raw) return raw;
          // TUBI 只可能属于 BRAN/HANG，从已加载 cache 推断或 fallback 为 BRAN
          if (noun === 'TUBI') {
            return (ownerRefFromUniforms && cache.refnoToNoun.get(ownerRefFromUniforms)) || 'BRAN';
          }
          return raw;
        })();
        // 无效直管（gen-model is_invalid_tubi）画告警色实体，其余照主题走；隐藏规则两边一样
        const invalidTubi = (inst as any).uniforms?.is_invalid_tubi === true;
        const resolved = invalidTubi
          ? resolveInvalidTubiMaterial(displayConfig, refnoKey)
          : resolveMaterialWithTheme(displayConfig, refnoKey, noun, instOwnerNoun, currentLoadTheme, specValue);
        if (resolved.hidden) {
          continue;
        }

        const mappedRefnoKey = (() => {
          if (
            bucketHasOwnGeometry
          && noun === 'TUBI'
          && actualRefnoKey === refnoKey
          && ownerRefFromUniforms
          && ownerRefFromUniforms !== actualRefnoKey
          ) {
            return ownerRefFromUniforms;
          }
          if (bucketHasOwnGeometry && actualRefnoKey !== refnoKey) {
            return actualRefnoKey;
          }
          return refnoKey;
        })();
        const objectId = `${objectIdPrefix}:${mappedRefnoKey}:${cache.objectCounter++}`;

        // 获取预计算的 AABB（如果 instances.json 中提供了）
        const precomputedAabb = (inst as any).aabb ?? null;

        dtxLayer.addObject(
          objectId,
          geoHash,
          matrix,
          resolved.color,
          {
            metalness: resolved.metalness,
            roughness: resolved.roughness,
            opacity: resolved.opacity,
          },
          precomputedAabb // 传递预计算的 AABB
        );

        const mappedObjectIds = objectIdsByMappedRefno.get(mappedRefnoKey) ?? [];
        mappedObjectIds.push(objectId);
        objectIdsByMappedRefno.set(mappedRefnoKey, mappedObjectIds);
        cache.objectIdToRefno.set(objectId, mappedRefnoKey);
        cache.objectIdToSpecValue.set(objectId, specValue);
        if (invalidTubi) {
          cache.invalidTubiObjectIds.add(objectId);
          invalidTubiObjects++;
        }
        if (noun === 'TUBI' || (inst as any).uniforms?.is_tubi === true) {
          cache.tubiObjectIds.add(objectId);
        }
        loadedObjects++;

        const refnoTransform = (inst as any).refno_transform;
        if (Array.isArray(refnoTransform) && refnoTransform.length === 16) {
        // 检查 refnoTransform 数组中是否包含 null 或 undefined
          const hasInvalidValue = refnoTransform.some((v: any) => v === null || v === undefined || typeof v !== 'number');
          if (!hasInvalidValue && !cache.refnoTransform.has(mappedRefnoKey)) {
            cache.refnoTransform.set(mappedRefnoKey, refnoTransform as number[]);
          }
        }
        if (noun && !cache.refnoToNoun.has(mappedRefnoKey)) {
          cache.refnoToNoun.set(mappedRefnoKey, noun);
        }
        if (instOwnerNoun && !cache.refnoToOwnerNoun.has(mappedRefnoKey)) {
          cache.refnoToOwnerNoun.set(mappedRefnoKey, instOwnerNoun);
        }
        const ownerRef = normalizeRefnoKey(String((inst as any).uniforms?.owner_refno || ''));
        if (ownerRef && !cache.refnoToOwnerRefno.has(mappedRefnoKey)) {
          cache.refnoToOwnerRefno.set(mappedRefnoKey, ownerRef);
        }
        if (!cache.refnoToSpecValue.has(mappedRefnoKey)) {
          cache.refnoToSpecValue.set(mappedRefnoKey, specValue);
        }
        cache.loadedRefnos.add(mappedRefnoKey);
        cache.refnoLoadSource.set(mappedRefnoKey, sourceStamp);
      }

      for (const [mappedRefnoKey, objectIds] of objectIdsByMappedRefno.entries()) {
        if (objectIds.length === 0) continue;
        const existingObjectIds = cache.refnoToObjectIds.get(mappedRefnoKey) ?? [];
        cache.refnoToObjectIds.set(mappedRefnoKey, [...existingObjectIds, ...objectIds]);
      }
      if (refnoNoun) {
        cache.refnoToNoun.set(refnoKey, refnoNoun);
      }
      const firstInst = insts[0];
      let ownerNoun = normalizeNounKey((firstInst as any)?.uniforms?.owner_noun || '');
      const ownerRef = normalizeRefnoKey(String((firstInst as any)?.uniforms?.owner_refno || ''));
      // TUBI 一定属于 BRAN/HANG，从 cache 推断或 fallback 为 BRAN
      if (!ownerNoun && refnoNoun === 'TUBI') {
        ownerNoun = (ownerRef && cache.refnoToNoun.get(ownerRef)) || 'BRAN';
      }
      if (ownerNoun && !cache.refnoToOwnerNoun.has(refnoKey)) {
        cache.refnoToOwnerNoun.set(refnoKey, ownerNoun);
      }
      if (ownerRef && !cache.refnoToOwnerRefno.has(refnoKey)) {
        cache.refnoToOwnerRefno.set(refnoKey, ownerRef);
      }
      const rawSpecValue = (firstInst as any)?.uniforms?.spec_value;
      const firstSpecValue = parseSpecValue(rawSpecValue);
      if (!cache.refnoToSpecValue.has(refnoKey)) {
        cache.refnoToSpecValue.set(refnoKey, firstSpecValue);
      }
      cache.loadedRefnos.add(refnoKey);
      cache.refnoLoadSource.set(refnoKey, sourceStamp);
    }

    // 增量追加后重建 GPU 资源（1000 objects 级别可接受）
    if (loadedObjects > 0) {
      dtxLayer.recompile();
    }
  } catch (error) {
    if (replacementSnapshot) {
      try {
        dtxLayer.rollbackObjectsAddedAfter(replacementSnapshot.objectCount);
      } catch (rollbackError) {
        if (debug) console.warn('[dtx][instances] rollback appended objects failed', rollbackError);
      }
      for (const [objectId, visible] of replacementSnapshot.visibility) {
        dtxLayer.setObjectVisible(objectId, visible);
      }
      cache.objectCounter = replacementSnapshot.objectCounter;
      cache.refnoToObjectIds = replacementSnapshot.refnoToObjectIds;
      cache.objectIdToRefno = replacementSnapshot.objectIdToRefno;
      cache.objectIdToSpecValue = replacementSnapshot.objectIdToSpecValue;
      cache.refnoTransform = replacementSnapshot.refnoTransform;
      cache.refnoToNoun = replacementSnapshot.refnoToNoun;
      cache.refnoToOwnerNoun = replacementSnapshot.refnoToOwnerNoun;
      cache.refnoToOwnerRefno = replacementSnapshot.refnoToOwnerRefno;
      cache.refnoToSpecValue = replacementSnapshot.refnoToSpecValue;
      cache.loadedRefnos = replacementSnapshot.loadedRefnos;
      cache.invalidTubiObjectIds = replacementSnapshot.invalidTubiObjectIds;
      cache.tubiObjectIds = replacementSnapshot.tubiObjectIds;
      cache.refnoLoadSource = replacementSnapshot.refnoLoadSource;
      try {
        dtxLayer.recompile();
      } catch {
        // 保留原异常；旧对象显隐与索引已恢复。
      }
    }
    throw error;
  }

  // 一批实例装完（含 replaceExistingObjects 的版本切换重载）→ 运行时索引修订 +1，
  // 批注关联解析等消费方据此重算；抛错路径不 bump（索引已回滚到旧快照）。
  // 版本对比的隔离图层（`isolated`）装进的是另一张独立索引，主模型没变，不该让批注重解析一遍。
  if (toLoad.length > 0 && options.isolated !== true) bumpDtxLoaderRevision();

  return {
    loadedRefnos: toLoad.length,
    skippedRefnos: refnos.length - toLoad.length,
    loadedObjects,
    invalidTubiObjects,
    missingRefnos,
    missingBreakdown: {
      noGeoRowsRefnos: Array.from(noGeoRowsRefnos),
      mesh404Refnos: Array.from(mesh404Refnos),
      mesh404GeoHashes: Array.from(mesh404GeoHashes),
    },
    sceneBoundingBox: dtxLayer.getBoundingBox(),
  };
}
