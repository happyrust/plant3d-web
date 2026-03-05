import { useDbnoInstancesParquetLoader } from '@/composables/useDbnoInstancesParquetLoader'
import { realtimeInstancesByRefnos } from '@/api/genModelRealtimeApi'
import { parseGlbGeometry } from '@/utils/parseGlbGeometry'
import { DTXLayer } from '@/utils/three/dtx'
import {
  buildHiddenNounSet,
  buildHiddenRefnoSet,
  loadModelDisplayConfig,
  normalizeNounKey,
  normalizeRefnoKey,
  resolveMaterialWithTheme,
  type ModelDisplayConfig,
} from '@/utils/three/dtx/materialConfig'
import { useDisplayThemeStore, type DisplayTheme } from '@/composables/useDisplayThemeStore'
import { Box3, BufferAttribute, BufferGeometry, CylinderGeometry, Matrix4, SphereGeometry } from 'three'

type LoaderOptions = {
  lodAssetKey?: string // "L1"
  debug?: boolean
  forceReloadRefnos?: string[]
  /**
   * 数据源选择：
   * - 'parquet'：默认（失败则抛错）
   * - 'backend'：实时查库（用于 parquet miss 回填）
   */
  dataSource?: 'parquet' | 'backend'
}

export type DtxMissingBreakdown = {
  noGeoRowsRefnos: string[]
  mesh404Refnos: string[]
  mesh404GeoHashes: string[]
}

type DbnoRuntimeCache = {
  loadedRefnos: Set<string>
  loadedGeoHash: Set<string>
  /** 记录曾经 404 的 geoHash；用于触发按 refno 的自动生成，并在后续 forceReload 时重新拉取 GLB */
  notFoundGeoHash: Set<string>
  loadingGeoHash: Map<string, Promise<void>>
  objectCounter: number
  refnoToObjectIds: Map<string, string[]>
  objectIdToRefno: Map<string, string>
  refnoTransform: Map<string, number[]>
  refnoToNoun: Map<string, string>
  refnoToOwnerNoun: Map<string, string>
}

const cachesByDbno = new Map<number, DbnoRuntimeCache>()

function getCache(dbno: number): DbnoRuntimeCache {
  const existing = cachesByDbno.get(dbno)
  if (existing) {
    if (!existing.objectIdToSpecValue) existing.objectIdToSpecValue = new Map()
    return existing
  }
  const created: DbnoRuntimeCache = {
    loadedRefnos: new Set(),
    loadedGeoHash: new Set(),
    notFoundGeoHash: new Set(),
    loadingGeoHash: new Map(),
    objectCounter: 0,
    refnoToObjectIds: new Map(),
    objectIdToRefno: new Map(),
    refnoTransform: new Map(),
    refnoToNoun: new Map(),
    refnoToOwnerNoun: new Map(),
  }
  cachesByDbno.set(dbno, created)
  return created
}

function createFallbackBoxGeometry(): BufferGeometry {
  const positions = new Float32Array([
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
  ])
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ])
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(positions, 3))
  g.setIndex(new BufferAttribute(indices, 1))
  g.computeVertexNormals()
  g.computeBoundingBox()
  return g
}

let cachedUnitBoxGeometry: BufferGeometry | null = null
function getUnitBoxGeometry(): BufferGeometry {
  if (cachedUnitBoxGeometry) return cachedUnitBoxGeometry
  cachedUnitBoxGeometry = createFallbackBoxGeometry()
  return cachedUnitBoxGeometry
}

let cachedUnitTubiGeometry: BufferGeometry | null = null

/**
 * TUBI 几何体兜底：单位圆柱（对齐后端常用约定：z=[0..1]）。
 *
 * 说明：部分数据集的 instances_{dbno}.json 里，tubings[].geo_hash 会是 `tubi_{refno}`，但后端并不输出对应 GLB。
 * 此处直接用程序生成的单位圆柱承接（几何由 transform 缩放/旋转/平移到位）。
 */
function getUnitTubiGeometry(): BufferGeometry {
  if (cachedUnitTubiGeometry) return cachedUnitTubiGeometry

  // three.js CylinderGeometry 默认沿 Y 轴、中心在原点、高度=1。
  // 我们把它旋转到 Z 轴，并整体平移到 z=[0..1] 区间。
  const g = new CylinderGeometry(0.5, 0.5, 1, 16, 1, false)
  g.rotateX(Math.PI / 2)
  g.translate(0, 0, 0.5)
  g.computeBoundingBox()

  cachedUnitTubiGeometry = g
  return g
}

let cachedUnitSphereGeometry: BufferGeometry | null = null
function getUnitSphereGeometry(): BufferGeometry {
  if (cachedUnitSphereGeometry) return cachedUnitSphereGeometry
  const g = new SphereGeometry(0.5, 16, 12)
  g.computeBoundingBox()
  cachedUnitSphereGeometry = g
  return g
}

async function ensureGeometryForGeoHash(
  dtxLayer: DTXLayer,
  dbno: number,
  geoHash: string,
  lodAssetKey: string,
  debug: boolean
): Promise<{ status: 'ok' | 'not_found' | 'error'; notFoundNew: boolean }> {
  const cache = getCache(dbno)
  const wasNotFound = cache.notFoundGeoHash.has(geoHash)
  // 已加载且非 404：无需再拉取
  if (cache.loadedGeoHash.has(geoHash) && !wasNotFound) {
    return { status: 'ok', notFoundNew: false }
  }
  const pending = cache.loadingGeoHash.get(geoHash)
  if (pending) {
    await pending
    return { status: cache.notFoundGeoHash.has(geoHash) ? 'not_found' : 'ok', notFoundNew: false }
  }

  const task = (async () => {
    // 基础几何体（后端约定 geo_hash = 1/2/3），直接在前端生成，避免无意义的 GLB 请求。
    const basic = String(geoHash).trim()
    if (basic === '1') {
      dtxLayer.addGeometry(geoHash, getUnitBoxGeometry())
      cache.loadedGeoHash.add(geoHash)
      cache.notFoundGeoHash.delete(geoHash)
      return { status: 'ok' as const, notFoundNew: false }
    }
    if (basic === '2') {
      // CYLINDER/TUBI 在后端均使用 2，统一用单位圆柱承接
      dtxLayer.addGeometry(geoHash, getUnitTubiGeometry())
      cache.loadedGeoHash.add(geoHash)
      cache.notFoundGeoHash.delete(geoHash)
      return { status: 'ok' as const, notFoundNew: false }
    }
    if (basic === '3') {
      dtxLayer.addGeometry(geoHash, getUnitSphereGeometry())
      cache.loadedGeoHash.add(geoHash)
      cache.notFoundGeoHash.delete(geoHash)
      return { status: 'ok' as const, notFoundNew: false }
    }

    // 约定：tubi_* 属于“虚拟管段几何”（unit cylinder），不走 glb 下载。
    // 这样可避免大量 404 噪音，并确保“管道只有标注不见模型”的场景可直接显示。
    if (geoHash.startsWith('tubi_') || geoHash.startsWith('t_')) {
      dtxLayer.addGeometry(geoHash, getUnitTubiGeometry())
      cache.loadedGeoHash.add(geoHash)
      cache.notFoundGeoHash.delete(geoHash)
      return { status: 'ok' as const, notFoundNew: false }
    }

    const glbUrl = `/files/meshes/lod_${lodAssetKey}/${geoHash}_${lodAssetKey}.glb`
    let geometry: BufferGeometry | null = null
    let notFound = false
    let notFoundNew = false

    try {
      const resp = await fetch(glbUrl)
      if (resp.status === 404) {
        notFound = true
        notFoundNew = !cache.notFoundGeoHash.has(geoHash)
        cache.notFoundGeoHash.add(geoHash)
      }
      if (resp.ok) {
        const glbData = await resp.arrayBuffer()
        const parsed = await parseGlbGeometry(glbData)
        if (parsed) {
          const g = new BufferGeometry()
          g.setAttribute('position', new BufferAttribute(new Float32Array(parsed.positions), 3))
          if (parsed.normals && parsed.normals.length > 0) {
            g.setAttribute('normal', new BufferAttribute(new Float32Array(parsed.normals), 3))
          }
          g.setIndex(new BufferAttribute(new Uint32Array(parsed.indices), 1))
          g.computeBoundingBox()
          geometry = g
        }
      }
    } catch (e) {
      if (debug) console.warn('[dtx][instances-json] load glb failed', { geoHash, glbUrl, e })
    }

    if (geometry) {
      dtxLayer.addGeometry(geoHash, geometry)
      cache.loadedGeoHash.add(geoHash)
      cache.notFoundGeoHash.delete(geoHash)
      return { status: 'ok' as const, notFoundNew: false }
    }

    // 404 或解析失败：用兜底盒子承接，避免完全不可见；同时保留 notFound 标记，便于后续生成后重拉 GLB。
    dtxLayer.addGeometry(geoHash, getUnitBoxGeometry())
    cache.loadedGeoHash.add(geoHash)
    return { status: notFound ? ('not_found' as const) : ('error' as const), notFoundNew }
  })()

  cache.loadingGeoHash.set(geoHash, task)
  try {
    return await task
  } finally {
    cache.loadingGeoHash.delete(geoHash)
  }
}

async function ensureGeometriesForGeoHashes(
  dtxLayer: DTXLayer,
  dbno: number,
  geoHashes: string[],
  lodAssetKey: string,
  debug: boolean,
  options: { concurrency?: number } = {}
): Promise<string[]> {
  const cache = getCache(dbno)
  const unique = Array.from(new Set(geoHashes)).filter((h) => {
    if (!h) return false
    if (!cache.loadedGeoHash.has(h)) return true
    // 对曾经 404 的几何体：允许重试拉取（用于生成完成后的 forceReload）。
    return cache.notFoundGeoHash.has(h)
  })
  if (unique.length === 0) return []

  const queue = unique.slice()
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, queue.length))
  const missing = new Set<string>()

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const geoHash = queue.pop()
      if (!geoHash) continue
      const res = await ensureGeometryForGeoHash(dtxLayer, dbno, geoHash, lodAssetKey, debug)
      if (res.status === 'not_found' && res.notFoundNew) {
        missing.add(geoHash)
      }
    }
  })

  await Promise.all(workers)
  return Array.from(missing)
}

export function resolveDtxObjectIdsByRefno(dbno: number, refno: string): string[] {
  const cache = cachesByDbno.get(dbno)
  const key = String(refno ?? '').trim().replace('/', '_')
  return cache?.refnoToObjectIds.get(key) ?? []
}

export function isDtxRefnoLoaded(dbno: number, refno: string): boolean {
  const cache = cachesByDbno.get(dbno)
  if (!cache) return false
  const key = String(refno ?? '').trim().replace('/', '_')
  return cache.loadedRefnos.has(key)
}

export function hasDtxDbnoCache(dbno: number): boolean {
  return cachesByDbno.has(dbno)
}

export function resolveDtxRefnoByObjectId(dbno: number, objectId: string): string | null {
  const cache = cachesByDbno.get(dbno)
  return cache?.objectIdToRefno.get(objectId) ?? null
}

export function getDtxRefnoTransform(dbno: number, refno: string): number[] | undefined {
  const cache = cachesByDbno.get(dbno)
  return cache?.refnoTransform.get(refno)
}

export function resolveDtxNounByRefno(dbno: number, refno: string): string | null {
  const cache = cachesByDbno.get(dbno)
  return cache?.refnoToNoun.get(refno) ?? null
}

export function resolveDtxOwnerNounByRefno(dbno: number, refno: string): string | null {
  const cache = cachesByDbno.get(dbno)
  return cache?.refnoToOwnerNoun.get(refno) ?? null
}

export function getDtxNounCounts(dbno: number): Array<{ noun: string; count: number }> {
  const cache = cachesByDbno.get(dbno)
  if (!cache) return []
  const counts = new Map<string, number>()
  for (const noun of cache.refnoToNoun.values()) {
    const key = normalizeNounKey(noun)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts.entries()).map(([noun, count]) => ({ noun, count }))
}

export function applyMaterialConfigToLoadedDtx(
  dtxLayer: DTXLayer,
  dbno: number,
  config: ModelDisplayConfig,
  theme: DisplayTheme = 'default',
): { updatedObjects: number } {
  const cache = cachesByDbno.get(dbno)
  if (!cache) return { updatedObjects: 0 }

  const hiddenNouns = buildHiddenNounSet(config)
  const hiddenRefnos = buildHiddenRefnoSet(config)
  let updatedObjects = 0

  for (const [refno, objectIds] of cache.refnoToObjectIds.entries()) {
    const refnoKey = normalizeRefnoKey(refno)
    const noun = normalizeNounKey(cache.refnoToNoun.get(refno) || '')
    const ownerNoun = normalizeNounKey(cache.refnoToOwnerNoun.get(refno) || '')
    const isHidden = hiddenRefnos.has(refnoKey) || (noun && hiddenNouns.has(noun))
    const resolved = resolveMaterialWithTheme(config, refnoKey, noun, ownerNoun, theme)

    for (const objectId of objectIds) {
      const specValue = cache.objectIdToSpecValue.get(objectId) ?? 0
      const resolved = resolveMaterialForInstance(config, refnoKey, noun, specValue)
      if (isHidden || resolved.hidden) {
        dtxLayer.setObjectVisible(objectId, false)
        continue
      }
      dtxLayer.setObjectVisible(objectId, true)
      dtxLayer.setObjectMaterial(objectId, {
        color: resolved.color,
        metalness: resolved.metalness,
        roughness: resolved.roughness,
        opacity: resolved.opacity,
      })
      updatedObjects++
    }
  }

  return { updatedObjects }
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
  missingRefnos: string[]
  missingBreakdown: DtxMissingBreakdown
  sceneBoundingBox: Box3
}> {
  const debug = options.debug === true
  const lodAssetKey = options.lodAssetKey || 'L1'
  const forceReloadSet = options.forceReloadRefnos && options.forceReloadRefnos.length > 0
    ? new Set(options.forceReloadRefnos)
    : null
  const createEmptyMissingBreakdown = (): DtxMissingBreakdown => ({
    noGeoRowsRefnos: [],
    mesh404Refnos: [],
    mesh404GeoHashes: [],
  })

  if (refnos.length === 0) {
    return {
      loadedRefnos: 0,
      skippedRefnos: 0,
      loadedObjects: 0,
      missingRefnos: [],
      missingBreakdown: createEmptyMissingBreakdown(),
      sceneBoundingBox: dtxLayer.getBoundingBox(),
    }
  }

  const cache = getCache(dbno)
  const normalizedRefnos = refnos
    .map((r) => normalizeRefnoKey(String(r ?? '')))
    .filter((r) => !!r)
  const normalizedForceReload = forceReloadSet
    ? new Set(Array.from(forceReloadSet).map((r) => normalizeRefnoKey(String(r ?? ''))).filter((r) => !!r))
    : null

  const toLoad = Array.from(new Set(normalizedRefnos))
    .filter((r) => (normalizedForceReload && normalizedForceReload.has(r)) || !cache.loadedRefnos.has(r))
  if (toLoad.length === 0) {
    return {
      loadedRefnos: 0,
      skippedRefnos: refnos.length,
      loadedObjects: 0,
      missingRefnos: [],
      missingBreakdown: createEmptyMissingBreakdown(),
      sceneBoundingBox: dtxLayer.getBoundingBox(),
    }
  }

  const displayConfig = await loadModelDisplayConfig()
  const hiddenNouns = buildHiddenNounSet(displayConfig)
  const hiddenRefnos = buildHiddenRefnoSet(displayConfig)

  const { currentTheme } = useDisplayThemeStore()
  const currentLoadTheme: DisplayTheme = currentTheme.value

  // 根据 dataSource 选项决定数据源
  const dataSource = options.dataSource || 'parquet'
  let index: Map<string, import('@/utils/instances/instanceManifest').InstanceEntry[]>

  if (dataSource === 'backend') {
    const resp = await realtimeInstancesByRefnos(dbno, toLoad, {
      includeTubings: true,
      enableHoles: true,
    })
    if (!resp.success) {
      throw new Error(resp.message || `后端实时查询失败 (dbno=${dbno})`)
    }
    index = new Map()
    for (const [rawRefno, entries] of Object.entries(resp.instances_by_refno || {})) {
      const refnoKey = normalizeRefnoKey(rawRefno)
      if (!refnoKey) continue
      index.set(refnoKey, Array.isArray(entries) ? entries : [])
    }
    if (debug) console.log('[dtx][instances] using backend', { dbno, refnos: toLoad.length, indexSize: index.size, missing: resp.missing_refnos?.length ?? 0 })
  } else {
    const parquet = useDbnoInstancesParquetLoader()
    const available = await parquet.isParquetAvailable(dbno)
    if (!available) {
      throw new Error(`Parquet not available (dbno=${dbno})`)
    }
    index = await parquet.queryInstanceEntriesByRefnos(dbno, toLoad, { debug })
    if (debug) console.log('[dtx][instances] using parquet', { dbno, refnos: toLoad.length })
  }

  let loadedObjects = 0
  const missingRefnos: string[] = []
  const noGeoRowsRefnos = new Set<string>()
  const mesh404Refnos = new Set<string>()
  const mesh404GeoHashes = new Set<string>()

  // 预取本次需要的所有几何体（并发 + 去重），避免在实例循环中串行 await
  const neededGeoHashes = new Set<string>()
  const geoHashToRefnos = new Map<string, Set<string>>()
  for (const refno of toLoad) {
    // 隐藏 refno：不预取几何体，也不参与“缺失 mesh -> 触发生成”逻辑。
    if (hiddenRefnos.has(refno)) continue
    const insts = index.get(refno) || []
    for (const inst of insts) {
      const geoHash = String((inst as any).geo_hash || '')
      if (!geoHash) continue
      neededGeoHashes.add(geoHash)
      let set = geoHashToRefnos.get(geoHash)
      if (!set) {
        set = new Set<string>()
        geoHashToRefnos.set(geoHash, set)
      }
      set.add(refno)
    }
  }
  const missingGeoHashes = await ensureGeometriesForGeoHashes(dtxLayer, dbno, Array.from(neededGeoHashes), lodAssetKey, debug, { concurrency: 8 })
  if (missingGeoHashes.length > 0) {
    const extraMissing = new Set<string>()
    for (const gh of missingGeoHashes) {
      mesh404GeoHashes.add(gh)
      const owners = geoHashToRefnos.get(gh)
      if (!owners) continue
      for (const r of owners) extraMissing.add(r)
    }
    if (extraMissing.size > 0) {
      // 将“mesh 404”映射为“缺失 refno”，交由上层触发 SSE 生成并 forceReload。
      const existing = new Set<string>(missingRefnos)
      for (const r of extraMissing) {
        mesh404Refnos.add(r)
        if (!existing.has(r)) {
          missingRefnos.push(r)
          existing.add(r)
        }
      }
    }
  }

  for (const refnoKey of toLoad) {
    if (hiddenRefnos.has(refnoKey)) {
      cache.loadedRefnos.add(refnoKey)
      cache.refnoToObjectIds.set(refnoKey, [])
      continue
    }

    const insts = index.get(refnoKey) || []
    if (insts.length === 0) {
      noGeoRowsRefnos.add(refnoKey)
      if (!missingRefnos.includes(refnoKey)) missingRefnos.push(refnoKey)
      cache.loadedRefnos.add(refnoKey)
      continue
    }

    const objectIds: string[] = []
    let refnoNoun = ''

    for (const inst of insts) {
      const geoHash = String((inst as any).geo_hash || '')
      if (!geoHash) continue

      // 检查 matrix 数据是否有效（跳过包含 null 的数据）
      const matrixData = (inst as any).matrix
      if (!matrixData || !Array.isArray(matrixData) || matrixData.length !== 16) {
        continue
      }
      // 检查 matrix 数组中是否包含 null 或 undefined
      if (matrixData.some((v: any) => v === null || v === undefined || typeof v !== 'number')) {
        continue
      }

      const objectId = `o:${refnoKey}:${cache.objectCounter++}`
      const matrix = new Matrix4().fromArray(matrixData)

      const noun = normalizeNounKey((inst as any).uniforms?.noun || (inst as any)._noun || '')
      const specValue = typeof (inst as any).uniforms?.spec_value === 'number' ? (inst as any).uniforms.spec_value : 0
      if (noun && !refnoNoun) {
        refnoNoun = noun
      }
      if (noun && hiddenNouns.has(noun)) {
        continue
      }

      const instOwnerNoun = normalizeNounKey((inst as any).uniforms?.owner_noun || '')
      const resolved = resolveMaterialWithTheme(displayConfig, refnoKey, noun, instOwnerNoun, currentLoadTheme)
      if (resolved.hidden) {
        continue
      }

      // 获取预计算的 AABB（如果 instances.json 中提供了）
      const precomputedAabb = (inst as any).aabb ?? null

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
      )

      objectIds.push(objectId)
      cache.objectIdToRefno.set(objectId, refnoKey)
      cache.objectIdToSpecValue.set(objectId, specValue)
      loadedObjects++

      const refnoTransform = (inst as any).refno_transform
      if (Array.isArray(refnoTransform) && refnoTransform.length === 16) {
        // 检查 refnoTransform 数组中是否包含 null 或 undefined
        const hasInvalidValue = refnoTransform.some((v: any) => v === null || v === undefined || typeof v !== 'number')
        if (!hasInvalidValue && !cache.refnoTransform.has(refnoKey)) {
          cache.refnoTransform.set(refnoKey, refnoTransform as number[])
        }
      }
    }

    if (objectIds.length > 0) {
      cache.refnoToObjectIds.set(refnoKey, objectIds)
    }
    if (refnoNoun) {
      cache.refnoToNoun.set(refnoKey, refnoNoun)
    }
    const firstInst = insts[0]
    const ownerNoun = normalizeNounKey((firstInst as any)?.uniforms?.owner_noun || '')
    if (ownerNoun && !cache.refnoToOwnerNoun.has(refnoKey)) {
      cache.refnoToOwnerNoun.set(refnoKey, ownerNoun)
    }
    cache.loadedRefnos.add(refnoKey)
  }

  // 增量追加后重建 GPU 资源（1000 objects 级别可接受）
  if (loadedObjects > 0) {
    dtxLayer.recompile()
  }

  return {
    loadedRefnos: toLoad.length,
    skippedRefnos: refnos.length - toLoad.length,
    loadedObjects,
    missingRefnos,
    missingBreakdown: {
      noGeoRowsRefnos: Array.from(noGeoRowsRefnos),
      mesh404Refnos: Array.from(mesh404Refnos),
      mesh404GeoHashes: Array.from(mesh404GeoHashes),
    },
    sceneBoundingBox: dtxLayer.getBoundingBox(),
  }
}
