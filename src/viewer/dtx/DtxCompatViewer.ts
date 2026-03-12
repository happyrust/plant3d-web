import { Box3, Vector3 } from 'three'

import { hasDtxDbnoCache, resolveDtxObjectIdsByRefno } from '@/composables/useDbnoInstancesDtxLoader'
import { tryGetDbnumByRefno } from '@/composables/useDbMetaInfo'
import type { DtxViewer } from '@/viewer/dtx/DtxViewer'
import type { DTXLayer } from '@/utils/three/dtx'
import type { DTXSelectionController } from '@/utils/three/dtx'

export type Aabb6 = [number, number, number, number, number, number]

function aabbFromBox3(box: Box3): Aabb6 {
  return [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]
}

function computeFlyToPositionFromAabb(aabb: Aabb6): { position: Vector3; target: Vector3 } {
  const [xmin, ymin, zmin, xmax, ymax, zmax] = aabb
  const center = new Vector3((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2)
  const dx = xmax - xmin
  const dy = ymax - ymin
  const dz = zmax - zmin
  const maxDim = Math.max(dx, dy, dz)
  const distance = Math.max(maxDim * 2.5, 5)
  const position = new Vector3(center.x + distance * 0.8, center.y + distance * 0.6, center.z + distance * 0.8)
  return { position, target: center }
}

type CompatObjectState = {
  id: string
  visible: boolean
  selected: boolean
  xrayed: boolean
  aabb?: Aabb6
}

export class DtxCompatScene {
  readonly objects: Record<string, CompatObjectState> = {}
  readonly camera = {
    perspective: {
      near: 0.1,
      far: 1_000_000,
    },
  }

  private _dtxLayer: DTXLayer
  private _selection: DTXSelectionController | null
  private _onDirty: (() => void) | null

  private _fallbackRefnoToObjectIds: Map<string, string[]> | null = null
  private _fallbackIndexObjectCount = 0

  constructor(options: { dtxLayer: DTXLayer; selection?: DTXSelectionController | null; onDirty?: (() => void) | null }) {
    this._dtxLayer = options.dtxLayer
    this._selection = options.selection ?? null
    this._onDirty = options.onDirty ?? null
  }

  get objectIds(): string[] {
    return Object.keys(this.objects)
  }

  getLoadedRefnos(): string[] {
    const loaded = new Set<string>()
    for (const objectId of this._dtxLayer.getAllObjectIds()) {
      if (typeof objectId !== 'string' || !objectId) continue
      if (objectId.startsWith('o:')) {
        const parts = objectId.split(':')
        const refno = parts.length >= 3 ? String(parts[1] ?? '').trim() : ''
        if (!refno) continue
        loaded.add(refno)
        continue
      }
      loaded.add(objectId)
    }
    return Array.from(loaded)
  }

  get selectedObjectIds(): string[] {
    const out: string[] = []
    for (const [id, obj] of Object.entries(this.objects)) {
      if (obj.selected) out.push(id)
    }
    return out
  }

  ensureRefnos(refnos: string[], options?: { computeAabb?: boolean }): void {
    const computeAabb = options?.computeAabb !== false
    for (const id of refnos) {
      if (!id) continue
      if (!this.objects[id]) {
        this.objects[id] = { id, visible: true, selected: false, xrayed: false }
      }
      if (computeAabb) {
        const aabb = this._computeRefnoAabb(id)
        if (aabb) {
          this.objects[id]!.aabb = aabb
        }
      }
    }
  }

  /**
   * 获取 refno 对应的 DTX objectIds（如果未加载则为空）
   */
  private _getDtxObjectIds(refno: string): string[] {
    const normalized = refno.trim().replace('/', '_')
    if (this._dtxLayer.hasObject(normalized)) {
      return [normalized]
    }
    // 仅对 refno-like 的对象尝试解析 dbno；避免把树节点/非 refno id 当作 refno 处理。
    if (!/^\d+_/.test(normalized)) return []
    const dbno = tryGetDbnumByRefno(normalized)
    if (!dbno) {
      return this._getObjectIdsFromLoadedIndex(normalized)
    }
    const ids = resolveDtxObjectIdsByRefno(dbno, normalized)
    if (ids.length > 0) return ids

    // 若运行时 cache 存在（即与 loader 同一模块实例），则 resolve 为空意味着该 refno 没有加载任何 objectIds，
    // 不应触发兜底“全量扫描所有 objectIds”（否则点击叶子节点/未加载节点也会卡死）。
    // 兜底扫描只用于 DEV/HMR 下模块实例隔离导致 cachesByDbno 不可见的极端情况。
    if (hasDtxDbnoCache(dbno)) {
      return []
    }

    // 兜底：避免开发环境下模块实例隔离/缓存不同步导致 resolve 失效
    // objectId 命名规则：o:<refno>:<n>
    return this._getObjectIdsFromLoadedIndex(normalized)
  }

  private _getObjectIdsFromLoadedIndex(refno: string): string[] {
    const objectCount = this._dtxLayer.objectCount
    if (!this._fallbackRefnoToObjectIds) {
      this._fallbackRefnoToObjectIds = new Map<string, string[]>()
      this._fallbackIndexObjectCount = 0
    }

    // 增量构建 fallback 索引：只处理新增的 objectIds，避免每次 objectCount 变化都全量扫描导致卡顿
    if (this._fallbackIndexObjectCount !== objectCount) {
      const all = this._dtxLayer.getAllObjectIds()
      if (Array.isArray(all)) {
        const start = Math.max(0, Math.min(this._fallbackIndexObjectCount, all.length))
        for (let i = start; i < all.length; i++) {
          const objectId = all[i]
          if (typeof objectId !== 'string') continue
          if (!objectId.startsWith('o:')) continue
          const parts = objectId.split(':')
          const normalizedRefno = parts.length >= 3 ? String(parts[1] ?? '') : ''
          if (!normalizedRefno) continue
          const list = this._fallbackRefnoToObjectIds.get(normalizedRefno) || []
          list.push(objectId)
          this._fallbackRefnoToObjectIds.set(normalizedRefno, list)
        }
      }
      this._fallbackIndexObjectCount = objectCount
    }

    return this._fallbackRefnoToObjectIds.get(refno) ?? []
  }

  private _computeRefnoAabb(refno: string): Aabb6 | null {
    const box = new Box3()
    const tmp = new Box3()
    let hasAny = false

    const objectIds = this._getDtxObjectIds(refno)
    for (const objectId of objectIds) {
      const b = this._dtxLayer.getObjectBoundingBoxInto(objectId, tmp)
      if (!b || b.isEmpty()) continue
      box.union(b)
      hasAny = true
    }

    if (!hasAny || box.isEmpty()) return null
    return aabbFromBox3(box)
  }

  setObjectsVisible(refnos: string[], visible: boolean): void {
    this.ensureRefnos(refnos, { computeAabb: false })
    const objectIdsToApply = new Set<string>()
    for (const refno of refnos) {
      const st = this.objects[refno]
      if (st) st.visible = visible

      const objectIds = this._getDtxObjectIds(refno)
      for (const objectId of objectIds) objectIdsToApply.add(objectId)
    }
    if (objectIdsToApply.size > 0) {
      this._dtxLayer.setObjectsVisible(Array.from(objectIdsToApply), visible)
    }
    this._onDirty?.()
  }

  setObjectsSelected(refnos: string[], selected: boolean): void {
    this.ensureRefnos(refnos, { computeAabb: false })
    for (const refno of refnos) {
      const st = this.objects[refno]
      if (st) st.selected = selected

      if (!this._selection) continue

      const objectIds = this._getDtxObjectIds(refno)
      if (objectIds.length === 0) continue

      if (selected) {
        this._selection.select(objectIds, true)
      } else {
        this._selection.deselect(objectIds)
      }
    }
    this._onDirty?.()
  }

  /**
   * XRayed：阶段 1 采用“隔离=隐藏其它”的近似实现
   * - xrayed=true 视为隐藏
   * - xrayed=false 视为显示
   */
  setObjectsXRayed(refnos: string[], xrayed: boolean): void {
    this.ensureRefnos(refnos, { computeAabb: false })
    for (const refno of refnos) {
      const st = this.objects[refno]
      if (st) st.xrayed = xrayed
    }
    this.setObjectsVisible(refnos, !xrayed)
  }

  /**
   * 在“实例按需加载”场景下回放 refno 的当前状态到 DTXLayer
   * - 避免 load 后默认 visible=true 覆盖用户之前在树上做的显隐/隔离
   */
  applyStateToRefnos(refnos: string[], options?: { computeAabb?: boolean; forceVisible?: boolean }): void {
    if (!refnos || refnos.length === 0) return

    const computeAabb = options?.computeAabb === true
    const forceVisible = options?.forceVisible === true
    this.ensureRefnos(refnos, { computeAabb })

    const toShow = new Set<string>()
    const toHide = new Set<string>()
    const toSelect = new Set<string>()

    for (const refno of refnos) {
      const st = this.objects[refno]
      if (!st) continue

      const objectIds = this._getDtxObjectIds(refno)
      if (objectIds.length === 0) continue

      const effectiveVisible = st.xrayed ? false : st.visible
      if (!effectiveVisible) {
        for (const objectId of objectIds) toHide.add(objectId)
      } else if (forceVisible) {
        // 仅在明确需要时才强制把对象设为可见（避免对大规模加载造成无意义的写入）
        for (const objectId of objectIds) toShow.add(objectId)
      }

      if (st.selected) {
        for (const objectId of objectIds) toSelect.add(objectId)
      }
    }

    if (toHide.size > 0) this._dtxLayer.setObjectsVisible(Array.from(toHide), false)
    if (toShow.size > 0) this._dtxLayer.setObjectsVisible(Array.from(toShow), true)

    if (this._selection) {
      if (toSelect.size > 0) this._selection.select(Array.from(toSelect), true)
    }

    this._onDirty?.()
  }

  getAABB(refnos: string[]): Aabb6 | null {
    const box = new Box3()
    const tmp = new Box3()
    let hasAny = false

    for (const refno of refnos) {
      const objectIds = this._getDtxObjectIds(refno)
      for (const objectId of objectIds) {
        const b = this._dtxLayer.getObjectBoundingBoxInto(objectId, tmp)
        if (!b || b.isEmpty()) continue
        box.union(b)
        hasAny = true
      }
      const st = this.objects[refno]
      if (st) {
        const aabb = this._computeRefnoAabb(refno)
        if (aabb) st.aabb = aabb
      }
    }

    if (!hasAny || box.isEmpty()) return null
    return aabbFromBox3(box)
  }

  clear(): void {
    for (const id of Object.keys(this.objects)) {
      delete this.objects[id]
    }
    this._selection?.clearSelection()
    this._onDirty?.()
  }
}

export class DtxCompatViewer {
  readonly __dtxLayer: DTXLayer
  readonly __dtxViewer: DtxViewer
  readonly __dtxSelection: DTXSelectionController | null

  readonly scene: DtxCompatScene
  readonly requestRender: (() => void) | null

  readonly cameraFlight: {
    flyTo: (options: { aabb?: Aabb6 | number[] | null; duration?: number; fit?: boolean }) => void
    jumpTo: (options: { aabb?: Aabb6 | number[] | null }) => void
  }

  constructor(options: {
    dtxViewer: DtxViewer
    dtxLayer: DTXLayer
    selection?: DTXSelectionController | null
    requestRender?: (() => void) | null
  }) {
    this.__dtxViewer = options.dtxViewer
    this.__dtxLayer = options.dtxLayer
    this.__dtxSelection = options.selection ?? null
    this.requestRender = options.requestRender ?? null

    this.scene = new DtxCompatScene({
      dtxLayer: this.__dtxLayer,
      selection: this.__dtxSelection,
      onDirty: this.requestRender,
    })

    const flyToImpl = (aabbInput: Aabb6 | number[] | null | undefined, durationSeconds?: number) => {
      if (!aabbInput) return
      if (!Array.isArray(aabbInput) || aabbInput.length !== 6) return
      const aabb = aabbInput as Aabb6
      const { position, target } = computeFlyToPositionFromAabb(aabb)
      const durationMs =
        typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) * 1000 : 800
      this.__dtxViewer.flyTo(position, target, { duration: durationMs })
    }

    this.cameraFlight = {
      flyTo: (options) => {
        void options.fit
        flyToImpl(options.aabb as any, options.duration)
      },
      jumpTo: (options) => {
        flyToImpl(options.aabb as any, 0)
      },
    }
  }
}
