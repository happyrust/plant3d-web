import { buildInstanceIndexByRefno, type InstanceManifest } from '@/utils/instances/instanceManifest'
import { getDbnoInstancesManifest } from '@/composables/useDbnoInstancesJsonLoader'
import { parseGlbGeometry } from '@/utils/parseGlbGeometry'
import { DTXLayer } from '@/utils/three/dtx'
import {
  buildHiddenNounSet,
  buildHiddenRefnoSet,
  loadModelDisplayConfig,
  normalizeNounKey,
  normalizeRefnoKey,
  resolveMaterialForInstance,
  type ModelDisplayConfig,
} from '@/utils/three/dtx/materialConfig'
import { Box3, BufferAttribute, BufferGeometry, Matrix4 } from 'three'

type LoaderOptions = {
  lodAssetKey?: string // "L1"
  debug?: boolean
  forceReloadRefnos?: string[]
}

type DbnoRuntimeCache = {
  loadedRefnos: Set<string>
  loadedGeoHash: Set<string>
  loadingGeoHash: Map<string, Promise<void>>
  objectCounter: number
  refnoToObjectIds: Map<string, string[]>
  objectIdToRefno: Map<string, string>
  refnoTransform: Map<string, number[]>
  refnoToNoun: Map<string, string>
}

const cachesByDbno = new Map<number, DbnoRuntimeCache>()

function getCache(dbno: number): DbnoRuntimeCache {
  const existing = cachesByDbno.get(dbno)
  if (existing) return existing
  const created: DbnoRuntimeCache = {
    loadedRefnos: new Set(),
    loadedGeoHash: new Set(),
    loadingGeoHash: new Map(),
    objectCounter: 0,
    refnoToObjectIds: new Map(),
    objectIdToRefno: new Map(),
    refnoTransform: new Map(),
    refnoToNoun: new Map(),
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

async function ensureGeometryForGeoHash(
  dtxLayer: DTXLayer,
  dbno: number,
  geoHash: string,
  lodAssetKey: string,
  debug: boolean
): Promise<void> {
  const cache = getCache(dbno)
  if (cache.loadedGeoHash.has(geoHash)) return
  const pending = cache.loadingGeoHash.get(geoHash)
  if (pending) {
    await pending
    return
  }

  const task = (async () => {
    const glbUrl = `/files/meshes/lod_${lodAssetKey}/${geoHash}_${lodAssetKey}.glb`
    let geometry: BufferGeometry | null = null

    try {
      const resp = await fetch(glbUrl)
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

    if (!geometry) {
      geometry = createFallbackBoxGeometry()
    }

    dtxLayer.addGeometry(geoHash, geometry)
    cache.loadedGeoHash.add(geoHash)
  })()

  cache.loadingGeoHash.set(geoHash, task)
  try {
    await task
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
): Promise<void> {
  const cache = getCache(dbno)
  const unique = Array.from(new Set(geoHashes)).filter((h) => !!h && !cache.loadedGeoHash.has(h))
  if (unique.length === 0) return

  const queue = unique.slice()
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 8, queue.length))

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const geoHash = queue.pop()
      if (!geoHash) continue
      await ensureGeometryForGeoHash(dtxLayer, dbno, geoHash, lodAssetKey, debug)
    }
  })

  await Promise.all(workers)
}

export function resolveDtxObjectIdsByRefno(dbno: number, refno: string): string[] {
  const cache = cachesByDbno.get(dbno)
  const key = String(refno ?? '').trim().replace('/', '_')
  return cache?.refnoToObjectIds.get(key) ?? []
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
  config: ModelDisplayConfig
): { updatedObjects: number } {
  const cache = cachesByDbno.get(dbno)
  if (!cache) return { updatedObjects: 0 }

  const hiddenNouns = buildHiddenNounSet(config)
  const hiddenRefnos = buildHiddenRefnoSet(config)
  let updatedObjects = 0

  for (const [refno, objectIds] of cache.refnoToObjectIds.entries()) {
    const refnoKey = normalizeRefnoKey(refno)
    const noun = normalizeNounKey(cache.refnoToNoun.get(refno) || '')
    const isHidden = hiddenRefnos.has(refnoKey) || (noun && hiddenNouns.has(noun))
    const resolved = resolveMaterialForInstance(config, refnoKey, noun)

    for (const objectId of objectIds) {
      if (isHidden || resolved.hidden) {
        dtxLayer.setObjectVisible(objectId, false)
        continue
      }
      dtxLayer.setObjectVisible(objectId, true)
      dtxLayer.setObjectMaterial(objectId, {
        color: resolved.color,
        metalness: resolved.metalness,
        roughness: resolved.roughness,
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
  sceneBoundingBox: Box3
}> {
  const debug = options.debug === true
  const lodAssetKey = options.lodAssetKey || 'L1'
  const forceReloadSet = options.forceReloadRefnos && options.forceReloadRefnos.length > 0
    ? new Set(options.forceReloadRefnos)
    : null

  if (refnos.length === 0) {
    return { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, missingRefnos: [], sceneBoundingBox: dtxLayer.getBoundingBox() }
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
    return { loadedRefnos: 0, skippedRefnos: refnos.length, loadedObjects: 0, missingRefnos: [], sceneBoundingBox: dtxLayer.getBoundingBox() }
  }

  const displayConfig = await loadModelDisplayConfig()
  const hiddenNouns = buildHiddenNounSet(displayConfig)
  const hiddenRefnos = buildHiddenRefnoSet(displayConfig)

  const manifest: InstanceManifest = await getDbnoInstancesManifest(dbno)
  const index = buildInstanceIndexByRefno(manifest, new Set(toLoad))

  let loadedObjects = 0
  const missingRefnos: string[] = []

  // 预取本次需要的所有几何体（并发 + 去重），避免在实例循环中串行 await
  const neededGeoHashes = new Set<string>()
  for (const refno of toLoad) {
    const insts = index.get(refno) || []
    for (const inst of insts) {
      const geoHash = String((inst as any).geo_hash || '')
      if (geoHash) neededGeoHashes.add(geoHash)
    }
  }
  await ensureGeometriesForGeoHashes(dtxLayer, dbno, Array.from(neededGeoHashes), lodAssetKey, debug, { concurrency: 8 })

  for (const refnoKey of toLoad) {
    if (hiddenRefnos.has(refnoKey)) {
      cache.loadedRefnos.add(refnoKey)
      cache.refnoToObjectIds.set(refnoKey, [])
      continue
    }

    const insts = index.get(refnoKey) || []
    if (insts.length === 0) {
      missingRefnos.push(refnoKey)
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
      if (noun && !refnoNoun) {
        refnoNoun = noun
      }
      if (noun && hiddenNouns.has(noun)) {
        continue
      }

      const resolved = resolveMaterialForInstance(displayConfig, refnoKey, noun)
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
        },
        precomputedAabb // 传递预计算的 AABB
      )

      objectIds.push(objectId)
      cache.objectIdToRefno.set(objectId, refnoKey)
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
    sceneBoundingBox: dtxLayer.getBoundingBox(),
  }
}
