import { buildInstanceIndexByRefno, type InstanceManifest } from '@/utils/instances/instanceManifest'
import { getDbnoInstancesManifest } from '@/composables/useDbnoInstancesJsonLoader'
import { parseGlbGeometry } from '@/utils/parseGlbGeometry'
import { DTXLayer } from '@/utils/three/dtx'
import { Box3, BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three'

type LoaderOptions = {
  lodAssetKey?: string // "L1"
  debug?: boolean
}

type DbnoRuntimeCache = {
  loadedRefnos: Set<string>
  loadedGeoHash: Set<string>
  loadingGeoHash: Map<string, Promise<void>>
  objectCounter: number
  refnoToObjectIds: Map<string, string[]>
  objectIdToRefno: Map<string, string>
  refnoTransform: Map<string, number[]>
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
  }
  cachesByDbno.set(dbno, created)
  return created
}

function normalizeRgbMaybe(rgb: number[]): [number, number, number] {
  const r = Number(rgb[0] ?? 1)
  const g = Number(rgb[1] ?? 1)
  const b = Number(rgb[2] ?? 1)
  const max = Math.max(r, g, b)
  if (max > 1.0) return [r / 255, g / 255, b / 255]
  return [r, g, b]
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
  return cache?.refnoToObjectIds.get(refno) ?? []
}

export function resolveDtxRefnoByObjectId(dbno: number, objectId: string): string | null {
  const cache = cachesByDbno.get(dbno)
  return cache?.objectIdToRefno.get(objectId) ?? null
}

export function getDtxRefnoTransform(dbno: number, refno: string): number[] | undefined {
  const cache = cachesByDbno.get(dbno)
  return cache?.refnoTransform.get(refno)
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
  sceneBoundingBox: Box3
}> {
  const debug = options.debug === true
  const lodAssetKey = options.lodAssetKey || 'L1'

  if (refnos.length === 0) {
    return { loadedRefnos: 0, skippedRefnos: 0, loadedObjects: 0, sceneBoundingBox: dtxLayer.getBoundingBox() }
  }

  const cache = getCache(dbno)
  const toLoad = refnos.filter((r) => !cache.loadedRefnos.has(r))
  if (toLoad.length === 0) {
    return { loadedRefnos: 0, skippedRefnos: refnos.length, loadedObjects: 0, sceneBoundingBox: dtxLayer.getBoundingBox() }
  }

  const manifest: InstanceManifest = await getDbnoInstancesManifest(dbno)
  const index = buildInstanceIndexByRefno(manifest, new Set(toLoad))
  const colors = manifest.colors || []

  let loadedObjects = 0

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

  for (const refno of toLoad) {
    const insts = index.get(refno) || []
    if (insts.length === 0) {
      cache.loadedRefnos.add(refno)
      continue
    }

    const objectIds: string[] = []

    for (const inst of insts) {
      const geoHash = String((inst as any).geo_hash || '')
      if (!geoHash) continue

      const objectId = `o:${refno}:${cache.objectCounter++}`
      const matrix = new Matrix4().fromArray((inst as any).matrix || [])

      const rawColor = colors[(inst as any).color_index] || null
      const [r, g, b] = rawColor ? normalizeRgbMaybe(rawColor) : [0.85, 0.85, 0.85]
      const color = new Color(r, g, b)

      dtxLayer.addObject(objectId, geoHash, matrix, color, { metalness: 0, roughness: 1 })

      objectIds.push(objectId)
      cache.objectIdToRefno.set(objectId, refno)
      loadedObjects++

      const refnoTransform = (inst as any).refno_transform
      if (Array.isArray(refnoTransform) && refnoTransform.length === 16) {
        if (!cache.refnoTransform.has(refno)) {
          cache.refnoTransform.set(refno, refnoTransform as number[])
        }
      }
    }

    if (objectIds.length > 0) {
      cache.refnoToObjectIds.set(refno, objectIds)
    }
    cache.loadedRefnos.add(refno)
  }

  // 增量追加后重建 GPU 资源（1000 objects 级别可接受）
  if (loadedObjects > 0) {
    dtxLayer.recompile()
  }

  return {
    loadedRefnos: toLoad.length,
    skippedRefnos: refnos.length - toLoad.length,
    loadedObjects,
    sceneBoundingBox: dtxLayer.getBoundingBox(),
  }
}
