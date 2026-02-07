/**
 * MBD 管道标注 Composable（重构版）
 *
 * 使用新的三维标注系统，支持：
 * - Line2 粗线条
 * - troika-three-text 3D billboard 文字（非 CSS2D）
 * - 缩放独立（装饰件/文字）
 */

import { ref, type Ref, watch, shallowRef } from 'vue'
import { Box3, BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Matrix4, Vector3 } from 'three'

import type { DtxViewer } from '@/viewer/dtx/DtxViewer'
import type {
  MbdPipeData,
  MbdDimDto,
  MbdDimKind,
  MbdSlopeDto,
  MbdWeldDto,
  MbdPipeSegmentDto,
  Vec3 as ApiVec3,
} from '@/api/mbdPipeApi'

import { computeMbdDimOffset } from '@/composables/mbd/computeMbdDimOffset'

import {
  AnnotationMaterials,
  LinearDimension3D,
  WeldAnnotation3D,
  SlopeAnnotation3D,
} from '@/utils/three/annotation'
import { computeDimensionOffsetDirInLocal } from '@/utils/three/annotation/utils/computeDimensionOffsetDirInLocal'

export type UseMbdPipeAnnotationThreeReturn = {
  isVisible: Ref<boolean>
  showDims: Ref<boolean>
  /** 每段长度（默认 kind=segment） */
  showDimSegment: Ref<boolean>
  /** 焊口链式（kind=chain，包含两端） */
  showDimChain: Ref<boolean>
  /** 总长（kind=overall） */
  showDimOverall: Ref<boolean>
  /** 元件端口间距（kind=port） */
  showDimPort: Ref<boolean>
  showWelds: Ref<boolean>
  showSlopes: Ref<boolean>
  /** 显示“管段骨架线”（当真实 meshes 缺失时用于定位/对齐标注） */
  showSegments: Ref<boolean>
  showLabels: Ref<boolean>

  currentData: Ref<MbdPipeData | null>
  activeItemId: Ref<string | null>

  renderBranch: (data: MbdPipeData) => void
  clearAll: () => void
  flyTo: () => void
  updateLabelPositions: () => void
  highlightItem: (id: string | null) => void
  /** 更新分辨率（resize 时调用：LineMaterial + CSS2DRenderer 都需要） */
  setResolution: (width: number, height: number) => void
  /** 释放资源（Viewer 卸载时调用） */
  dispose: () => void

  /** Session-only：更新 MBD dim 交互调整（offset/label/reference 等） */
  updateDimOverride: (dimId: string, patch: Partial<MbdDimOverride>) => void
  /** Session-only：重置单个 MBD dim 的交互调整 */
  resetDimOverride: (dimId: string) => void
  /** 获取 dim annotations map（用于外部交互控制器注册） */
  getDimAnnotations: () => Map<string, LinearDimension3D>
}

/** MBD dims session-only override（不写回后端，仅当前会话有效） */
export type MbdDimOverride = {
  offset?: number
  direction?: [number, number, number]
  labelT?: number
  labelOffsetWorld?: [number, number, number] | null
  isReference?: boolean
}

function computeFlyToPositionFromBox(box: Box3): { position: Vector3; target: Vector3 } {
  const center = new Vector3()
  box.getCenter(center)
  const size = new Vector3()
  box.getSize(size)
  const maxDim = Math.max(size.x, size.y, size.z)
  const distance = Math.max(maxDim * 2.5, 5)
  const position = new Vector3(center.x + distance * 0.8, center.y + distance * 0.6, center.z + distance * 0.8)
  return { position, target: center }
}

export function useMbdPipeAnnotationThree(
  dtxViewerRef: Ref<DtxViewer | null>,
  labelContainerRef: Ref<HTMLElement | null>,
  options: {
    requestRender?: (() => void) | null
    getGlobalModelMatrix?: (() => Matrix4 | null) | null
  } = {}
): UseMbdPipeAnnotationThreeReturn {
  const requestRender = options.requestRender ?? null
  const getGlobalModelMatrix = options.getGlobalModelMatrix ?? null
  // 方案B：MBD 标注统一为 3D 文本，不再需要 CSS2D 容器；保留参数以维持 API 兼容。
  void labelContainerRef

  const isVisible = ref(false)
  const showDims = ref(true)
  const showDimSegment = ref(true)
  const showDimChain = ref(true)
  const showDimOverall = ref(true)
  const showDimPort = ref(true)
  const showWelds = ref(true)
  const showSlopes = ref(true)
  const showSegments = ref(true)
  const showLabels = ref(true)

  const currentData = ref<MbdPipeData | null>(null)
  const activeItemId = ref<string | null>(null)

  // 标注组
  const group = new Group()
  group.name = 'dtx-mbd-pipe-v2'
  group.renderOrder = 981
  group.matrixAutoUpdate = false

  const identityMatrix = new Matrix4()

  // 材质管理器
  const materials = new AnnotationMaterials()

  // 标注集合（按类型分组）
  const dimAnnotations = shallowRef<Map<string, LinearDimension3D>>(new Map())
  const weldAnnotations = shallowRef<Map<string, WeldAnnotation3D>>(new Map())
  const slopeAnnotations = shallowRef<Map<string, SlopeAnnotation3D>>(new Map())
  const segmentLines = shallowRef<Map<string, Line>>(new Map())

  const segmentMaterial = new LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.9 })
  const segmentHighlightMaterial = new LineBasicMaterial({ color: 0xf59e0b })

  // Session-only overrides（不写回后端）
  const dimOverrides = new Map<string, MbdDimOverride>()

  function applyLabelVisibility(): void {
    const visible = isVisible.value && showLabels.value
    for (const annotation of dimAnnotations.value.values()) {
      annotation.setLabelVisible(visible)
    }
    for (const annotation of weldAnnotations.value.values()) {
      annotation.setLabelVisible(visible)
    }
    for (const annotation of slopeAnnotations.value.values()) {
      annotation.setLabelVisible(visible)
    }
  }

  function ensureGroupAttached(): void {
    const viewer = dtxViewerRef.value
    if (!viewer) return
    if (group.parent !== viewer.scene) {
      try { group.parent?.remove(group) } catch { /* ignore */ }
      viewer.scene.add(group)
    }
  }

  function clearAll(): void {
    // 清理尺寸标注
    for (const annotation of dimAnnotations.value.values()) {
      annotation.dispose()
    }
    dimAnnotations.value.clear()

    // 清理焊缝标注
    for (const annotation of weldAnnotations.value.values()) {
      annotation.dispose()
    }
    weldAnnotations.value.clear()

    // 清理坡度标注
    for (const annotation of slopeAnnotations.value.values()) {
      annotation.dispose()
    }
    slopeAnnotations.value.clear()

    // 清理管段骨架线
    for (const line of segmentLines.value.values()) {
      try {
        ;(line.geometry as BufferGeometry)?.dispose?.()
      } catch {
        // ignore
      }
    }
    segmentLines.value.clear()

    // 清理 group 子对象
    for (const child of [...group.children]) {
      group.remove(child)
    }

    // 清理 session-only overrides
    dimOverrides.clear()

    currentData.value = null
    activeItemId.value = null
    isVisible.value = false
    applyLabelVisibility()
    requestRender?.()
  }

  function applyVisibility(): void {
    // 尺寸标注可见性
    for (const annotation of dimAnnotations.value.values()) {
      const kind = ((annotation.userData as any)?.mbdDimKind ?? 'segment') as MbdDimKind
      const kindVisible =
        (kind === 'segment' && showDimSegment.value) ||
        (kind === 'chain' && showDimChain.value) ||
        (kind === 'overall' && showDimOverall.value) ||
        (kind === 'port' && showDimPort.value)
      annotation.visible = isVisible.value && showDims.value && kindVisible
    }

    // 焊缝标注可见性
    for (const annotation of weldAnnotations.value.values()) {
      annotation.visible = isVisible.value && showWelds.value
    }

    // 坡度标注可见性
    for (const annotation of slopeAnnotations.value.values()) {
      annotation.visible = isVisible.value && showSlopes.value
    }

    // 管段骨架线可见性
    for (const line of segmentLines.value.values()) {
      line.visible = isVisible.value && showSegments.value
    }
  }

  function highlightItem(id: string | null): void {
    activeItemId.value = id

    // 取消所有高亮
    for (const annotation of dimAnnotations.value.values()) {
      annotation.highlighted = false
    }
    for (const annotation of weldAnnotations.value.values()) {
      annotation.highlighted = false
    }
    for (const annotation of slopeAnnotations.value.values()) {
      annotation.highlighted = false
    }
    for (const line of segmentLines.value.values()) {
      line.material = segmentMaterial
    }

    // 设置新的高亮
    if (id) {
      const dim = dimAnnotations.value.get(id)
      if (dim) dim.highlighted = true

      const weld = weldAnnotations.value.get(id)
      if (weld) weld.highlighted = true

      const slope = slopeAnnotations.value.get(id)
      if (slope) slope.highlighted = true

      const seg = segmentLines.value.get(id)
      if (seg) seg.material = segmentHighlightMaterial
    }

    requestRender?.()
  }

  function renderDims(dims: MbdDimDto[]): void {
    const viewer = dtxViewerRef.value
    const gm = getGlobalModelMatrix?.() || identityMatrix
    for (const d of dims) {
      const start = new Vector3(d.start[0], d.start[1], d.start[2])
      const end = new Vector3(d.end[0], d.end[1], d.end[2])
      const kind = (d.kind ?? 'segment') as MbdDimKind

      // 计算偏移方向：优先按相机方向（SolveSpace 风格“屏幕直觉”），退化时 fallback。
      const offsetDir =
        computeDimensionOffsetDirInLocal(start, end, viewer?.camera ?? null, gm) ||
        new Vector3(1, 0, 0)

      const dist = start.distanceTo(end)
      const offset = computeMbdDimOffset(dist)

      // 合并 session-only overrides
      const ov = dimOverrides.get(d.id)
      const finalOffset = ov?.offset ?? offset
      const finalDir = ov?.direction ? new Vector3(ov.direction[0], ov.direction[1], ov.direction[2]) : offsetDir
      const finalLabelT = ov?.labelT ?? 0.5
      const finalLabelOffsetWorld = ov?.labelOffsetWorld
        ? new Vector3(ov.labelOffsetWorld[0], ov.labelOffsetWorld[1], ov.labelOffsetWorld[2])
        : null
      const finalIsReference = ov?.isReference ?? false

      const dim = new LinearDimension3D(materials, {
        start,
        end,
        offset: finalOffset,
        labelT: finalLabelT,
        labelOffsetWorld: finalLabelOffsetWorld,
        isReference: finalIsReference,
        text: d.text,
        direction: finalDir,
      })

      // 可交互：MBD dims 在当前会话内支持拖拽调整
      dim.userData.pickable = true
      dim.userData.draggable = true
      ;(dim.userData as any).mbdDimId = d.id

      // 颜色仅用于快速区分不同尺寸语义；屏幕布局/避让由前端负责。
      if (kind === 'segment') dim.setMaterialSet(materials.green)
      else if (kind === 'chain') dim.setMaterialSet(materials.yellow)
      else if (kind === 'overall') dim.setMaterialSet(materials.white)
      else dim.setMaterialSet(materials.blue) // port

      ;(dim.userData as any).mbdDimKind = kind
      group.add(dim)
      dimAnnotations.value.set(d.id, dim)
    }
  }

  function renderWelds(welds: MbdWeldDto[]): void {
    for (const w of welds) {
      const position = new Vector3(w.position[0], w.position[1], w.position[2])

      const weld = new WeldAnnotation3D(materials, {
        position,
        label: w.label,
        isShop: w.is_shop,
        crossSize: 50, // 世界单位
      })

      weld.setMaterialSet(materials.orange)
      group.add(weld)
      weldAnnotations.value.set(w.id, weld)
    }
  }

  function renderSlopes(slopes: MbdSlopeDto[]): void {
    for (const s of slopes) {
      const start = new Vector3(s.start[0], s.start[1], s.start[2])
      const end = new Vector3(s.end[0], s.end[1], s.end[2])

      const slope = new SlopeAnnotation3D(materials, {
        start,
        end,
        text: s.text,
        slope: s.slope,
      })

      slope.setMaterialSet(materials.blue)
      group.add(slope)
      slopeAnnotations.value.set(s.id, slope)
    }
  }

  function renderSegments(segments: MbdPipeSegmentDto[]): void {
    for (const s of segments) {
      if (!s.arrive || !s.leave) continue
      const geom = new BufferGeometry()
      const pos = new Float32Array([
        s.arrive[0], s.arrive[1], s.arrive[2],
        s.leave[0], s.leave[1], s.leave[2],
      ])
      geom.setAttribute('position', new Float32BufferAttribute(pos, 3))
      const line = new Line(geom, segmentMaterial)
      line.name = `mbd-seg:${s.id}`
      group.add(line)
      segmentLines.value.set(s.id, line)
    }
  }

  function renderBranch(data: MbdPipeData): void {
    const viewer = dtxViewerRef.value
    if (!viewer) return

    ensureGroupAttached()
    clearAll()

    currentData.value = data
    isVisible.value = true

    // 应用全局模型矩阵
    const gm = getGlobalModelMatrix?.() || identityMatrix
    group.matrix.copy(gm)
    group.updateMatrixWorld(true)

    // 更新材质分辨率
    const rect = viewer.canvas.getBoundingClientRect()
    setResolution(rect.width, rect.height)

    // 渲染各类标注
    if (data.dims?.length) renderDims(data.dims)
    if (data.welds?.length) renderWelds(data.welds)
    if (data.slopes?.length) renderSlopes(data.slopes)
    if (data.segments?.length) renderSegments(data.segments)

    highlightItem(null)
    applyVisibility()
    applyLabelVisibility()
    requestRender?.()
  }

  function flyTo(): void {
    const viewer = dtxViewerRef.value
    if (!viewer) return
    const data = currentData.value
    if (!data) return

    // 与渲染侧保持一致：后端坐标为“原始坐标”，需应用全局模型矩阵（mm->m / recenter 等）
    const gm = getGlobalModelMatrix?.() || identityMatrix

    const box = new Box3()
    let hasAny = false
    const tmp = new Vector3()
    const expand = (p: ApiVec3) => {
      tmp.set(p[0], p[1], p[2]).applyMatrix4(gm)
      box.expandByPoint(tmp)
      hasAny = true
    }

    for (const d of data.dims || []) {
      expand(d.start); expand(d.end)
    }
    for (const w of data.welds || []) expand(w.position)
    for (const s of data.slopes || []) {
      expand(s.start); expand(s.end)
    }
    for (const seg of data.segments || []) {
      if (seg.arrive) expand(seg.arrive)
      if (seg.leave) expand(seg.leave)
    }
    if (!hasAny || box.isEmpty()) return

    const size = new Vector3()
    box.getSize(size)
    const pad = Math.max(2, (size.x + size.y + size.z) * 0.2)
    box.expandByScalar(pad)

    const { position, target } = computeFlyToPositionFromBox(box)
    viewer.flyTo(position, target, { duration: 800 })
  }

  function updateLabelPositions(): void {
    const viewer = dtxViewerRef.value
    if (!viewer || !isVisible.value) return

    // 若全局模型矩阵在运行期变化（例如单位/重心配置），需要保持标注组与之同步。
    const gm = getGlobalModelMatrix?.() || identityMatrix
    group.matrix.copy(gm)
    group.updateMatrixWorld(true)

    // 更新所有标注
    const camera = viewer.camera
    for (const annotation of dimAnnotations.value.values()) {
      annotation.update(camera)
    }
    for (const annotation of weldAnnotations.value.values()) {
      annotation.update(camera)
    }
    for (const annotation of slopeAnnotations.value.values()) {
      annotation.update(camera)
    }
  }

  function setResolution(width: number, height: number): void {
    materials.setResolution(width, height)
  }

  /** Session-only：更新指定 MBD dim 的交互调整并即时刷新 3D 标注 */
  function updateDimOverride(dimId: string, patch: Partial<MbdDimOverride>): void {
    const existing = dimOverrides.get(dimId) ?? {}
    const merged = { ...existing, ...patch }
    dimOverrides.set(dimId, merged)

    // 即时更新已渲染的标注（避免重建全部）
    const dim = dimAnnotations.value.get(dimId)
    if (dim) {
      const p: any = {}
      if (merged.offset !== undefined) p.offset = merged.offset
      if (merged.direction) p.direction = new Vector3(merged.direction[0], merged.direction[1], merged.direction[2])
      if (merged.labelT !== undefined) p.labelT = merged.labelT
      if ('labelOffsetWorld' in merged) {
        p.labelOffsetWorld = merged.labelOffsetWorld
          ? new Vector3(merged.labelOffsetWorld[0], merged.labelOffsetWorld[1], merged.labelOffsetWorld[2])
          : null
      }
      if (merged.isReference !== undefined) p.isReference = merged.isReference
      dim.setParams(p)
    }
    requestRender?.()
  }

  /** Session-only：重置指定 MBD dim 的交互调整 */
  function resetDimOverride(dimId: string): void {
    dimOverrides.delete(dimId)
    // 需要重建才能回到后端原始状态（简单方案：如果有 currentData 就重新渲染该 dim）
    requestRender?.()
  }

  /** 获取 dim annotations map（用于外部将 MBD dims 注册到交互控制器） */
  function getDimAnnotations(): Map<string, LinearDimension3D> {
    return dimAnnotations.value
  }

  function dispose(): void {
    clearAll()
    materials.dispose()
    segmentMaterial.dispose()
    segmentHighlightMaterial.dispose()
    group.removeFromParent()
  }

  // 监听可见性变化
  watch(
    [
      isVisible,
      showDims,
      showDimSegment,
      showDimChain,
      showDimOverall,
      showDimPort,
      showWelds,
      showSlopes,
      showSegments,
      showLabels,
    ],
    () => {
    applyVisibility()
    applyLabelVisibility()
    requestRender?.()
    }
  )

  // 监听 viewer 变化
  watch(dtxViewerRef, (viewer, prev) => {
    if (prev && !viewer) {
      clearAll()
    }
    // 更新分辨率
    if (viewer) {
      const rect = viewer.canvas.getBoundingClientRect()
      materials.setResolution(rect.width, rect.height)
    }
  })

  return {
    isVisible,
    showDims,
    showDimSegment,
    showDimChain,
    showDimOverall,
    showDimPort,
    showWelds,
    showSlopes,
    showSegments,
    showLabels,
    currentData,
    activeItemId,
    renderBranch,
    clearAll,
    flyTo,
    updateLabelPositions,
    highlightItem,
    setResolution,
    dispose,
    updateDimOverride,
    resetDimOverride,
    getDimAnnotations,
  }
}
