import type { SceneModel, Viewer } from '@xeokit/xeokit-sdk'
import { buildInstanceIndexByRefno, type InstanceEntry, type InstanceManifest } from '@/aios-prepack-bundle-loader'
import { parseGlbGeometry } from '@/utils/parseGlbGeometry'
import { getBaseUrl } from '@/api/genModelTaskApi'

export class InstancesJsonNotFoundError extends Error {
  readonly dbno: number
  constructor(dbno: number) {
    super(`instances_${dbno}.json not found`)
    this.name = 'InstancesJsonNotFoundError'
    this.dbno = dbno
  }
}

type LoaderOptions = {
  modelId?: string
  lodAssetKey?: string // "L1"
  debug?: boolean
}

const manifestCache = new Map<number, InstanceManifest>()

const loadedRefnosByDbno = new Map<number, Set<string>>()
const loadedGeoHashByDbno = new Map<number, Set<string>>()
const meshCounterByDbno = new Map<number, number>()

function normalizeRgbMaybe(rgb: number[]): [number, number, number] {
  const r = Number(rgb[0] ?? 1)
  const g = Number(rgb[1] ?? 1)
  const b = Number(rgb[2] ?? 1)
  const max = Math.max(r, g, b)
  if (max > 1.0) return [r / 255, g / 255, b / 255]
  return [r, g, b]
}

async function fetchInstancesManifest(dbno: number): Promise<InstanceManifest> {
  const cached = manifestCache.get(dbno)
  if (cached) return cached

  const url = `/files/output/instances/instances_${dbno}.json`
  const resp = await fetch(url)
  if (resp.status === 404) {
    throw new InstancesJsonNotFoundError(dbno)
  }
  if (!resp.ok) {
    throw new Error(`加载 instances 失败: HTTP ${resp.status} ${resp.statusText}`)
  }

  const json = (await resp.json()) as InstanceManifest
  manifestCache.set(dbno, json)
  return json
}

async function triggerDbnoGenerate(dbno: number): Promise<void> {
  const apiBase = getBaseUrl().replace(/\/$/, '')
  const url = `${apiBase}/api/database/${dbno}/generate`
  const resp = await fetch(url, { method: 'POST' })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`触发生成任务失败: HTTP ${resp.status} ${resp.statusText}: ${text}`)
  }
}

async function waitForInstancesFile(dbno: number, timeoutMs = 10 * 60 * 1000): Promise<void> {
  const url = `/files/output/instances/instances_${dbno}.json`
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const resp = await fetch(url, { method: 'GET' })
    if (resp.ok) return
    if (resp.status !== 404) {
      const text = await resp.text().catch(() => '')
      throw new Error(`等待 instances 文件失败: HTTP ${resp.status} ${resp.statusText}: ${text}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`等待 instances_${dbno}.json 超时`)
}

function getOrCreateSceneModel(viewer: Viewer, modelId: string): SceneModel {
  const existing = viewer.scene.models[modelId] as unknown as SceneModel | undefined
  if (existing) return existing

  const { SceneModel: SceneModelClass } = (viewer as unknown as { SceneModel?: unknown }).constructor as unknown as {
    SceneModel?: new (...args: unknown[]) => SceneModel
  }
  if (!SceneModelClass) {
    // fallback: runtime import (avoids bundler issues)
    throw new Error('SceneModel class not available')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (SceneModelClass as any)(viewer.scene, { id: modelId, isModel: true })
}

async function getOrCreateSceneModelDynamic(viewer: Viewer, modelId: string): Promise<SceneModel> {
  const existing = viewer.scene.models[modelId] as unknown as SceneModel | undefined
  if (existing) return existing
  const { SceneModel: SceneModelClass } = await import('@xeokit/xeokit-sdk')
  return new SceneModelClass(viewer.scene, { id: modelId, isModel: true } as unknown as Record<string, unknown>)
}

function hasGeometry(sceneModel: SceneModel, geometryId: string): boolean {
  const m = sceneModel as unknown as { _geometries?: Record<string, unknown> }
  return !!m._geometries?.[geometryId]
}

function preFinalize(sceneModel: SceneModel) {
  try {
    const m = sceneModel as unknown as { preFinalize?: () => boolean }
    m.preFinalize?.()
  } catch {
    void 0
  }
}

async function ensureGeometryForGeoHash(sceneModel: SceneModel, geoHash: string, lodAssetKey: string, debug: boolean): Promise<void> {
  const geometryId = `g:${geoHash}`
  if (hasGeometry(sceneModel, geometryId)) return

  const glbUrl = `/files/meshes/lod_${lodAssetKey}/${geoHash}_${lodAssetKey}.glb`
  let geometryLoaded = false
  try {
    const resp = await fetch(glbUrl)
    if (resp.ok) {
      const glbData = await resp.arrayBuffer()
      const geometry = await parseGlbGeometry(glbData)
      if (geometry) {
        sceneModel.createGeometry({
          id: geometryId,
          primitive: 'triangles',
          positions: geometry.positions,
          indices: geometry.indices,
          normals: geometry.normals,
        } as unknown as Parameters<SceneModel['createGeometry']>[0])
        geometryLoaded = true
      }
    }
  } catch (e) {
    if (debug) console.warn('[instances-json] load glb failed', { geoHash, glbUrl, e })
  }

  if (!geometryLoaded) {
    // 占位盒子（避免整条链路中断）
    const positions = [
      -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5,
      -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, -0.5,
      -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5,
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
      0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5,
      -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5,
    ]
    const indices = [
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11, 12, 13, 14, 12, 14, 15,
      16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]
    sceneModel.createGeometry({
      id: geometryId,
      primitive: 'triangles',
      positions,
      indices,
    } as unknown as Parameters<SceneModel['createGeometry']>[0])
  }
}

export async function ensureDbnoInstancesAvailable(dbno: number, options?: { autoGenerate?: boolean; timeoutMs?: number }): Promise<void> {
  try {
    await fetchInstancesManifest(dbno)
    return
  } catch (e) {
    if (!(e instanceof InstancesJsonNotFoundError)) throw e
    if (!options?.autoGenerate) throw e
    await triggerDbnoGenerate(dbno)
    await waitForInstancesFile(dbno, options?.timeoutMs)
    manifestCache.delete(dbno)
    await fetchInstancesManifest(dbno)
  }
}

export async function loadDbnoInstancesForVisibleRefnos(
  viewer: Viewer,
  dbno: number,
  refnos: string[],
  options: LoaderOptions = {}
): Promise<{ loadedRefnos: number; skippedRefnos: number }> {
  const debug = options.debug === true
  const lodAssetKey = options.lodAssetKey || 'L1'
  const modelId = options.modelId || `instances-${dbno}`

  if (refnos.length === 0) return { loadedRefnos: 0, skippedRefnos: 0 }

  const loadedSet = loadedRefnosByDbno.get(dbno) || new Set<string>()
  loadedRefnosByDbno.set(dbno, loadedSet)

  const geoSet = loadedGeoHashByDbno.get(dbno) || new Set<string>()
  loadedGeoHashByDbno.set(dbno, geoSet)

  const toLoad = refnos.filter((r) => !loadedSet.has(r))
  if (toLoad.length === 0) return { loadedRefnos: 0, skippedRefnos: refnos.length }

  const manifest = await fetchInstancesManifest(dbno)
  const filter = new Set<string>(toLoad)
  const index = buildInstanceIndexByRefno(manifest, filter)

  const sceneModel = await getOrCreateSceneModelDynamic(viewer, modelId)

  const colors = manifest.colors || []

  let meshCounter = meshCounterByDbno.get(dbno) || 0

  for (const refno of toLoad) {
    const insts = index.get(refno) || []
    if (insts.length === 0) {
      loadedSet.add(refno)
      continue
    }

    const meshIds: string[] = []

    for (const inst of insts) {
      const geoHash = inst.geo_hash
      const geometryId = `g:${geoHash}`

      if (!geoSet.has(geoHash)) {
        await ensureGeometryForGeoHash(sceneModel, geoHash, lodAssetKey, debug)
        geoSet.add(geoHash)
      }

      const meshId = `m:${refno}:${meshCounter++}`
      const rawColor = colors[inst.color_index]
      const color = rawColor ? normalizeRgbMaybe(rawColor) : [0.85, 0.85, 0.85]

      sceneModel.createMesh({
        id: meshId,
        geometryId,
        primitive: 'triangles',
        matrix: inst.matrix,
        color,
        opacity: 1.0,
        metallic: 0,
        roughness: 1,
      } as unknown as Parameters<SceneModel['createMesh']>[0])

      meshIds.push(meshId)
    }

    sceneModel.createEntity({
      id: refno,
      meshIds,
      isObject: true,
    } as unknown as Parameters<SceneModel['createEntity']>[0])

    loadedSet.add(refno)
    preFinalize(sceneModel)
  }

  meshCounterByDbno.set(dbno, meshCounter)

  return { loadedRefnos: toLoad.length, skippedRefnos: refnos.length - toLoad.length }
}
