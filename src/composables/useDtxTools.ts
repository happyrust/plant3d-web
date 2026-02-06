import { computed, ref, watch, type Ref } from 'vue'
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Plane,
  Vector2,
  Vector3,
} from 'three'

import { emitCommand } from '@/ribbon/commandBus'
import { dockActivatePanelIfExists, dockPanelExists } from '@/composables/useDockApi'
import { useSelectionStore } from '@/composables/useSelectionStore'
import { useToolStore, type AngleMeasurementRecord, type AnnotationRecord, type CloudAnnotationRecord, type DistanceMeasurementRecord, type MeasurementPoint, type Obb, type ObbAnnotationRecord, type RectAnnotationRecord, type Vec3, type LinearDistanceDimensionRecord, type AngleDimensionRecord as AngleDimensionRecord2 } from '@/composables/useToolStore'
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore'
import type { UseAnnotationThreeReturn } from './useAnnotationThree'
import type { DtxCompatViewer } from '@/viewer/dtx/DtxCompatViewer'
import type { DtxViewer } from '@/viewer/dtx/DtxViewer'
import type { DTXLayer, DTXSelectionController } from '@/utils/three/dtx'
import { AngleDimension3D, LinearDimension3D } from '@/utils/three/annotation'
import { computeDimensionOffsetDir } from '@/utils/three/annotation/utils/computeDimensionOffsetDir'
import { formatLengthMeters } from '@/utils/unitFormat'

type DragRect = {
  active: boolean
  pointerId: number | null
  startClient: { x: number; y: number } | null
  startCanvas: { x: number; y: number } | null
  currentCanvas: { x: number; y: number } | null
}

type RectPlaneDrag = {
  active: boolean
  pointerId: number | null
  startCanvas: { x: number; y: number } | null
  plane: Plane | null
  basisU: Vector3 | null
  basisV: Vector3 | null
  startWorld: Vector3 | null
  startEntityId: string | null
}

type LabelEl = {
  id: string
  worldPos: Vector3
  el: HTMLDivElement
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function formatAngleDegrees(deg: number, precision: number): string {
  const p = Math.max(0, Math.min(6, Math.floor(Number(precision) || 0)))
  return `${deg.toFixed(p)}°`
}

function computeDimensionOffsetDirectionByCamera(start: Vector3, end: Vector3, camera: any): Vector3 | null {
  // 保持原语义：优先按相机“屏幕直觉”计算；退化时返回 null 交由调用方 fallback。
  return computeDimensionOffsetDir(start, end, camera as any)
}

function vec3ToTuple(v: Vector3): Vec3 {
  return [v.x, v.y, v.z]
}

function aabbFromPoints(points: Vec3[]): [number, number, number, number, number, number] | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const p of points) {
    const x = p[0]
    const y = p[1]
    const z = p[2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }

  if (!Number.isFinite(minX)) return null
  return [minX, minY, minZ, maxX, maxY, maxZ]
}

function parseRefnoFromDtxObjectId(objectId: string): string | null {
  if (!objectId || !objectId.startsWith('o:')) return null
  const parts = objectId.split(':')
  return parts.length >= 3 ? (parts[1] ?? null) : null
}

function getCanvasPos(canvas: HTMLCanvasElement, e: PointerEvent): Vector2 {
  const rect = canvas.getBoundingClientRect()
  return new Vector2(e.clientX - rect.left, e.clientY - rect.top)
}

function worldToOverlay(
  camera: any,
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  worldPos: Vector3
): { x: number; y: number; visible: boolean } {
  const rect = canvas.getBoundingClientRect()
  const v = worldPos.clone()
  v.project(camera)
  const x = (v.x * 0.5 + 0.5) * rect.width
  const y = (-v.y * 0.5 + 0.5) * rect.height
  const visible = v.z >= -1 && v.z <= 1

  const overlayRect = overlay.getBoundingClientRect()
  return { x: x + (rect.left - overlayRect.left), y: y + (rect.top - overlayRect.top), visible }
}

function disposeObject3d(obj: any) {
  if (!obj) return
  try {
    if (obj.geometry) obj.geometry.dispose?.()
  } catch {
    // ignore
  }
  try {
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        for (const m of obj.material) m?.dispose?.()
      } else {
        obj.material.dispose?.()
      }
    }
  } catch {
    // ignore
  }
}

function clearGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child)
    disposeObject3d(child as any)
  }
}

function buildWireBoxGeometryFromBox3(box: Box3): BufferGeometry {
  const min = box.min
  const max = box.max

  const corners = [
    new Vector3(min.x, min.y, min.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, max.z),
    new Vector3(min.x, max.y, max.z),
  ]

  const edgePairs = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ]

  const positions: number[] = []
  for (let i = 0; i < edgePairs.length; i += 2) {
    const a = corners[edgePairs[i]!]!
    const b = corners[edgePairs[i + 1]!]!
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  return g
}

function buildWireBoxGeometryFromCorners(corners: Vec3[]): BufferGeometry | null {
  if (corners.length !== 8) return null
  const vs = corners.map((c) => new Vector3(c[0], c[1], c[2]))
  const edgePairs = [
    0, 1, 1, 2, 2, 3, 3, 0,
    4, 5, 5, 6, 6, 7, 7, 4,
    0, 4, 1, 5, 2, 6, 3, 7,
  ]
  const positions: number[] = []
  for (let i = 0; i < edgePairs.length; i += 2) {
    const a = vs[edgePairs[i]!]!
    const b = vs[edgePairs[i + 1]!]!
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  return g
}

function computeAabbObbFromBox3(box: Box3): Obb {
  const center = new Vector3()
  box.getCenter(center)
  const size = new Vector3()
  box.getSize(size)
  const half = size.multiplyScalar(0.5)

  const corners: Vec3[] = [
    [box.min.x, box.min.y, box.min.z],
    [box.max.x, box.min.y, box.min.z],
    [box.max.x, box.max.y, box.min.z],
    [box.min.x, box.max.y, box.min.z],
    [box.min.x, box.min.y, box.max.z],
    [box.max.x, box.min.y, box.max.z],
    [box.max.x, box.max.y, box.max.z],
    [box.min.x, box.max.y, box.max.z],
  ]

  return {
    center: [center.x, center.y, center.z],
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    halfSize: [half.x, half.y, half.z],
    corners: corners as any,
  }
}

function topCenterFromBox3(box: Box3): Vector3 {
  const center = new Vector3()
  box.getCenter(center)
  return new Vector3(center.x, center.y, box.max.z)
}

function ensureDiv(parent: HTMLElement, className: string, styleText: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  el.style.cssText = styleText
  parent.appendChild(el)
  return el
}

function makeMarkerEl(parent: HTMLElement, text: string, color: string): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-marker',
    [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:auto',
      'user-select:none',
      'z-index:920',
      'width:22px',
      'height:22px',
      'border-radius:9999px',
      `background:${color}`,
      'color:#fff',
      'font-size:11px',
      'font-weight:700',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'box-shadow:0 6px 14px rgba(0,0,0,0.25)',
      'border:2px solid rgba(255,255,255,0.75)',
    ].join(';')
  )
  el.textContent = text
  return el
}

function makeLabelEl(parent: HTMLElement, title: string, description: string): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-anno-label',
    [
      'position:absolute',
      'transform:translate(-50%,-110%)',
      'pointer-events:auto',
      'z-index:910',
      'max-width:260px',
      'padding:8px 10px',
      'border-radius:8px',
      'background:rgba(20,20,20,0.88)',
      'color:#fff',
      'box-shadow:0 8px 18px rgba(0,0,0,0.35)',
      'white-space:pre-wrap',
    ].join(';')
  )
  el.innerHTML = `<div style="font-weight:700;line-height:1.2;">${title}</div><div style="margin-top:4px;font-size:12px;opacity:0.95;">${description || ''}</div>`
  return el
}

function makeMeasureLabelEl(parent: HTMLElement, text: string): HTMLDivElement {
  const el = ensureDiv(
    parent,
    'dtx-measure-label',
    [
      'position:absolute',
      'transform:translate(-50%,-100%)',
      'pointer-events:none',
      'z-index:905',
      'padding:3px 6px',
      'border-radius:6px',
      'background:rgba(17,24,39,0.85)',
      'color:#fff',
      'font-size:11px',
      'font-weight:600',
      'box-shadow:0 6px 14px rgba(0,0,0,0.25)',
    ].join(';')
  )
  el.textContent = text
  return el
}

function ensurePanelActivated(panelId: string) {
  if (dockPanelExists(panelId)) {
    dockActivatePanelIfExists(panelId)
    return
  }
  emitCommand(`panel.${panelId === 'modelTree' ? 'tree' : panelId}`)
}

export function useDtxTools(options: {
  dtxViewerRef: Ref<DtxViewer | null>
  dtxLayerRef: Ref<DTXLayer | null>
  selectionRef: Ref<DTXSelectionController | null>
  overlayContainerRef: Ref<HTMLElement | null>
  annotationSystemRef?: Ref<UseAnnotationThreeReturn | null>
  store: ReturnType<typeof useToolStore>
  compatViewerRef: Ref<DtxCompatViewer | null>
  requestRender?: (() => void) | null
}) {
  const { dtxViewerRef, dtxLayerRef, selectionRef, overlayContainerRef, store, compatViewerRef } = options
  const requestRender = options.requestRender ?? null

  const selectionStore = useSelectionStore()
  const unitSettings = useUnitSettingsStore()

  let lastTextMarkerClickTime = 0
  let lastTextMarkerClickId: string | null = null

  const ready = computed(() => {
    const layer = dtxLayerRef.value
    if (!layer) return false
    try {
      return layer.getStats().compiled === true
    } catch {
      return false
    }
  })

  const progressPoints = ref<MeasurementPoint[]>([])
  const pointToObjectStart = ref<MeasurementPoint | null>(null)

  // dimensions (独立于测量)
  const dimensionPoints = ref<MeasurementPoint[]>([])

  const DIMENSION_PREVIEW_ID = 'dim_preview'

  function clearDimensionPreview(): void {
    const sys = options.annotationSystemRef?.value ?? null
    if (!sys) return
    try {
      sys.removeAnnotation(DIMENSION_PREVIEW_ID)
    } catch {
      // ignore
    }
  }

  function ensureLinearPreview(sys: UseAnnotationThreeReturn): LinearDimension3D {
    const existing = sys.getAnnotation(DIMENSION_PREVIEW_ID)
    if (existing instanceof LinearDimension3D) return existing
    if (existing) sys.removeAnnotation(DIMENSION_PREVIEW_ID)

    const dim = new LinearDimension3D(sys.materials, {
      start: new Vector3(),
      end: new Vector3(1, 0, 0),
      offset: 0.5,
      labelT: 0.5,
      text: '',
    })
    dim.userData.pickable = false
    dim.userData.draggable = false
    sys.addAnnotation(DIMENSION_PREVIEW_ID, dim)
    return dim
  }

  function ensureAnglePreview(sys: UseAnnotationThreeReturn): AngleDimension3D {
    const existing = sys.getAnnotation(DIMENSION_PREVIEW_ID)
    if (existing instanceof AngleDimension3D) return existing
    if (existing) sys.removeAnnotation(DIMENSION_PREVIEW_ID)

    const dim = new AngleDimension3D(sys.materials, {
      vertex: new Vector3(),
      point1: new Vector3(1, 0, 0),
      point2: new Vector3(0, 1, 0),
      arcRadius: 0.8,
      labelT: 0.5,
      text: '',
      decimals: 1,
    })
    dim.userData.pickable = false
    dim.userData.draggable = false
    sys.addAnnotation(DIMENSION_PREVIEW_ID, dim)
    return dim
  }

  function updateDimensionPreview(canvas: HTMLCanvasElement, e: PointerEvent): void {
    const sys = options.annotationSystemRef?.value ?? null
    if (!sys) return

    const mode = store.toolMode.value
    if (mode !== 'dimension_linear' && mode !== 'dimension_angle') {
      clearDimensionPreview()
      return
    }

    const hit = pickSurfacePoint(canvas, e)
    if (!hit) {
      clearDimensionPreview()
      return
    }

    if (mode === 'dimension_linear') {
      if (dimensionPoints.value.length !== 1) {
        clearDimensionPreview()
        return
      }
      const p0 = dimensionPoints.value[0]!
      const start = new Vector3(...p0.worldPos)
      const end = hit.worldPos.clone()
      const dist = start.distanceTo(end)
      if (dist < 1e-9) {
        clearDimensionPreview()
        return
      }

      const viewer = dtxViewerRef.value
      const dir = viewer ? computeDimensionOffsetDirectionByCamera(start, end, viewer.camera as any) : null
      const offset = Math.max(0.2, Math.min(2, dist * 0.15))
      const text = formatLengthMeters(dist, unitSettings.displayUnit.value, unitSettings.precision.value)

      const dim = ensureLinearPreview(sys)
      dim.setParams({
        start,
        end,
        offset,
        labelT: 0.5,
        direction: dir ?? undefined,
        text,
      })
      dim.visible = true
      return
    }

    // angle
    if (dimensionPoints.value.length !== 2) {
      clearDimensionPreview()
      return
    }
    const p0 = dimensionPoints.value[0]!
    const p1 = dimensionPoints.value[1]!
    const origin = new Vector3(...p0.worldPos)
    const corner = new Vector3(...p1.worldPos)
    const target = hit.worldPos.clone()

    const arm1 = origin.distanceTo(corner)
    const arm2 = target.distanceTo(corner)
    const arcRadius = clamp(Math.min(arm1, arm2) * 0.3, 0.3, 1.2)

    const dim = ensureAnglePreview(sys)
    dim.setParams({
      vertex: corner,
      point1: origin,
      point2: target,
      arcRadius,
      labelT: 0.5,
      decimals: Math.max(0, Math.min(6, Math.floor(Number(unitSettings.precision.value) || 0))),
    })
    const deg = dim.getAngleDegrees()
    dim.setParams({ text: formatAngleDegrees(deg, unitSettings.precision.value) })
    dim.visible = true
  }

  const statusText = computed(() => {
    const mode = store.toolMode.value
    if (mode === 'none') return '未启用工具'
    if (!ready.value) return '等待模型加载完成…'

    if (mode === 'measure_distance') {
      return progressPoints.value.length === 0 ? '距离测量：请选择起点' : '距离测量：请选择终点'
    }
    if (mode === 'measure_angle') {
      if (progressPoints.value.length === 0) return '角度测量：请选择起点'
      if (progressPoints.value.length === 1) return '角度测量：请选择拐点'
      return '角度测量：请选择终点'
    }
    if (mode === 'measure_point_to_object') {
      return pointToObjectStart.value ? '点到面测量：请点击选择目标对象（自动计算最近距离）' : '点到面测量：请点击选择起始点'
    }
    if (mode === 'dimension_linear') {
      return dimensionPoints.value.length === 0 ? '尺寸标注（距离）：请选择起点' : '尺寸标注（距离）：请选择终点'
    }
    if (mode === 'dimension_angle') {
      if (dimensionPoints.value.length === 0) return '尺寸标注（角度）：请选择起点'
      if (dimensionPoints.value.length === 1) return '尺寸标注（角度）：请选择拐点'
      return '尺寸标注（角度）：请选择终点'
    }
    if (mode === 'pick_query_center') {
      return '请点击模型拾取查询中心点'
    }
    if (mode === 'annotation_cloud') {
      return '云线批注：拖拽框选对象生成包围框'
    }
    if (mode === 'annotation_rect') {
      return '矩形批注：拖拽两点对角生成'
    }
    if (mode === 'annotation_obb') {
      return 'OBB 批注：拖拽框选生成（左→右=相交，右→左=包含）'
    }
    return '批注：点击模型表面创建'
  })

  const toolsGroup = new Group()
  toolsGroup.name = 'dtx-tools'

  const labels = new Map<string, LabelEl>()
  const markers = new Map<string, LabelEl>()

  const marqueeState = ref<DragRect>({ active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null })
  const marqueeDiv = ref<HTMLDivElement | null>(null)

  const rectDrag = ref<RectPlaneDrag>({
    active: false,
    pointerId: null,
    startCanvas: null,
    plane: null,
    basisU: null,
    basisV: null,
    startWorld: null,
    startEntityId: null,
  })
  const rectPreviewLine = ref<Line | null>(null)

  function resetProgress() {
    progressPoints.value = []
    pointToObjectStart.value = null
    dimensionPoints.value = []
    clearDimensionPreview()
  }

  function ensureToolsGroupAttached() {
    const viewer = dtxViewerRef.value
    if (!viewer) return
    if (toolsGroup.parent !== viewer.scene) {
      try {
        toolsGroup.parent?.remove(toolsGroup)
      } catch {
        // ignore
      }
      viewer.scene.add(toolsGroup)
    }
  }

  function clearOverlayEls() {
    for (const it of labels.values()) {
      try { it.el.remove() } catch { /* ignore */ }
    }
    labels.clear()
    for (const it of markers.values()) {
      try { it.el.remove() } catch { /* ignore */ }
    }
    markers.clear()
  }

  function ensureMarqueeDiv() {
    const overlay = overlayContainerRef.value
    if (!overlay) return null
    if (marqueeDiv.value && marqueeDiv.value.parentElement === overlay) return marqueeDiv.value

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove() } catch { /* ignore */ }
    }

    marqueeDiv.value = ensureDiv(
      overlay,
      'dtx-marquee',
      [
        'position:absolute',
        'display:none',
        'left:0',
        'top:0',
        'width:0',
        'height:0',
        'pointer-events:none',
        'z-index:930',
      ].join(';')
    )
    return marqueeDiv.value
  }

  function hideMarquee() {
    marqueeState.value = { active: false, pointerId: null, startClient: null, startCanvas: null, currentCanvas: null }
    const div = marqueeDiv.value
    if (div) div.style.display = 'none'
  }

  function updateMarqueeStyle(mode: 'annotation_cloud' | 'annotation_obb', dx: number) {
    const div = ensureMarqueeDiv()
    if (!div) return
    div.style.display = 'block'
    if (mode === 'annotation_cloud') {
      div.style.border = '3px solid #dc2626'
      div.style.borderRadius = '8px'
      div.style.background = 'rgba(220, 38, 38, 0.08)'
      div.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.3), inset 0 0 8px rgba(220, 38, 38, 0.1)'
    } else {
      div.style.border = dx >= 0 ? '2px dashed #333' : '2px solid #333'
      div.style.borderRadius = '0'
      div.style.background = 'rgba(0,0,0,0.06)'
      div.style.boxShadow = 'none'
    }
  }

  function updateMarqueeRect(start: { x: number; y: number }, end: { x: number; y: number }) {
    const div = ensureMarqueeDiv()
    if (!div) return
    const x1 = Math.min(start.x, end.x)
    const y1 = Math.min(start.y, end.y)
    const x2 = Math.max(start.x, end.x)
    const y2 = Math.max(start.y, end.y)
    div.style.left = `${x1}px`
    div.style.top = `${y1}px`
    div.style.width = `${x2 - x1}px`
    div.style.height = `${y2 - y1}px`
  }

  function syncFromStore() {
    const viewer = dtxViewerRef.value
    const overlay = overlayContainerRef.value
    if (!viewer || !overlay) return

    ensureToolsGroupAttached()
    clearGroup(toolsGroup)
    clearOverlayEls()

    // ---------------- Measurements ----------------
    for (const m of store.measurements.value) {
      if (!m.visible) continue

      if (m.kind === 'distance') {
        const lineMat = new LineBasicMaterial({ color: 0x2563eb })
        ;(lineMat as any).depthTest = false
        ;(lineMat as any).transparent = true
        ;(lineMat as any).opacity = 0.95

        const a = new Vector3(...m.origin.worldPos)
        const b = new Vector3(...m.target.worldPos)
        const g = new BufferGeometry()
        g.setAttribute('position', new BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z]), 3))
        const line = new Line(g, lineMat)
        line.renderOrder = 1000
        toolsGroup.add(line)

        const mid = a.clone().add(b).multiplyScalar(0.5)
        const dist = a.distanceTo(b)
        const unit = unitSettings.displayUnit.value
        const precision = unitSettings.precision.value
        const el = makeMeasureLabelEl(overlay, `D ${formatLengthMeters(dist, unit, precision)}`)
        labels.set(`m:${m.id}`, { id: `m:${m.id}`, worldPos: mid, el })
      } else {
        const lineMat = new LineBasicMaterial({ color: 0x2563eb })
        ;(lineMat as any).depthTest = false
        ;(lineMat as any).transparent = true
        ;(lineMat as any).opacity = 0.95

        const o = new Vector3(...m.origin.worldPos)
        const c = new Vector3(...m.corner.worldPos)
        const t = new Vector3(...m.target.worldPos)
        const g = new BufferGeometry()
        g.setAttribute(
          'position',
          new BufferAttribute(new Float32Array([o.x, o.y, o.z, c.x, c.y, c.z, c.x, c.y, c.z, t.x, t.y, t.z]), 3)
        )
        const seg = new LineSegments(g, lineMat)
        seg.renderOrder = 1000
        toolsGroup.add(seg)

        const v1 = o.clone().sub(c).normalize()
        const v2 = t.clone().sub(c).normalize()
        const angle = Math.acos(clamp(v1.dot(v2), -1, 1)) * (180 / Math.PI)
        const el = makeMeasureLabelEl(overlay, `${angle.toFixed(1)}°`)
        labels.set(`m:${m.id}`, { id: `m:${m.id}`, worldPos: c, el })
      }
    }

    // ---------------- Text annotations ----------------
    for (const a of store.annotations.value) {
      if (!a.visible) continue

      const wp = new Vector3(...a.worldPos)
      const marker = makeMarkerEl(overlay, a.glyph || 'A', '#2563eb')
      const label = makeLabelEl(overlay, a.title || '批注', a.description || '')
      markers.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: wp, el: marker })
      labels.set(`anno:${a.id}`, { id: `anno:${a.id}`, worldPos: wp, el: label })

      const onClick = () => {
        const now = Date.now()
        const isDouble = lastTextMarkerClickId === a.id && now - lastTextMarkerClickTime < 400
        if (isDouble) {
          store.pendingTextAnnotationEditId.value = a.id
          lastTextMarkerClickId = null
          lastTextMarkerClickTime = 0
        } else {
          store.activeAnnotationId.value = a.id
          store.activeCloudAnnotationId.value = null
          store.activeRectAnnotationId.value = null
          store.activeObbAnnotationId.value = null
          lastTextMarkerClickId = a.id
          lastTextMarkerClickTime = now
        }
      }

      marker.addEventListener('click', (ev) => { ev.stopPropagation(); onClick() })
      label.addEventListener('click', (ev) => { ev.stopPropagation(); onClick() })
    }

    // ---------------- Cloud annotations (3D bounding wireframe) ----------------
    for (const c of store.cloudAnnotations.value) {
      if (!c.visible) continue

      const refnos = (c.refnos && c.refnos.length > 0) ? c.refnos : c.objectIds
      if (!refnos || refnos.length === 0) continue

      const aabb = compatViewerRef.value?.scene.getAABB(refnos) || null
      if (!aabb) continue
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]))
      const g = buildWireBoxGeometryFromBox3(box)
      const mat = new LineBasicMaterial({ color: 0xdc2626 })
      ;(mat as any).depthTest = false
      const wire = new LineSegments(g, mat)
      wire.renderOrder = 900
      toolsGroup.add(wire)

      const anchor = new Vector3(...c.anchorWorldPos)
      const marker = makeMarkerEl(overlay, 'C', '#dc2626')
      markers.set(`cloud:${c.id}`, { id: `cloud:${c.id}`, worldPos: anchor, el: marker })

      const isActive = store.activeCloudAnnotationId.value === c.id
      if (isActive) {
        const label = makeLabelEl(overlay, c.title || '云线批注', c.description || '')
        labels.set(`cloud:${c.id}`, { id: `cloud:${c.id}`, worldPos: anchor, el: label })
      }

      marker.addEventListener('click', (ev) => {
        ev.stopPropagation()
        store.activeCloudAnnotationId.value = c.id
        store.activeAnnotationId.value = null
        store.activeRectAnnotationId.value = null
        store.activeObbAnnotationId.value = null
      })
    }

    // ---------------- Rect annotations (plane rectangle) ----------------
    for (const r of store.rectAnnotations.value) {
      if (!r.visible) continue

      const pts = r.corners.map((p) => new Vector3(...p.worldPos))
      if (pts.length !== 4) continue

      const g = new BufferGeometry()
      g.setAttribute(
        'position',
        new BufferAttribute(
          new Float32Array([
            pts[0]!.x, pts[0]!.y, pts[0]!.z, pts[1]!.x, pts[1]!.y, pts[1]!.z,
            pts[1]!.x, pts[1]!.y, pts[1]!.z, pts[2]!.x, pts[2]!.y, pts[2]!.z,
            pts[2]!.x, pts[2]!.y, pts[2]!.z, pts[3]!.x, pts[3]!.y, pts[3]!.z,
            pts[3]!.x, pts[3]!.y, pts[3]!.z, pts[0]!.x, pts[0]!.y, pts[0]!.z,
          ]),
          3
        )
      )
      const mat = new LineBasicMaterial({ color: 0x111827 })
      ;(mat as any).depthTest = false
      const wire = new LineSegments(g, mat)
      wire.renderOrder = 900
      toolsGroup.add(wire)

      const center = pts[0]!.clone().add(pts[2]!).multiplyScalar(0.5)
      const marker = makeMarkerEl(overlay, 'R', '#111827')
      markers.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: center, el: marker })

      const isActive = store.activeRectAnnotationId.value === r.id
      if (isActive) {
        const label = makeLabelEl(overlay, r.title || '矩形批注', r.description || '')
        labels.set(`rect:${r.id}`, { id: `rect:${r.id}`, worldPos: center, el: label })
      }

      marker.addEventListener('click', (ev) => {
        ev.stopPropagation()
        store.activeRectAnnotationId.value = r.id
        store.activeAnnotationId.value = null
        store.activeCloudAnnotationId.value = null
        store.activeObbAnnotationId.value = null
      })
    }

    // ---------------- OBB annotations ----------------
    for (const o of store.obbAnnotations.value) {
      if (!o.visible) continue
      const g = buildWireBoxGeometryFromCorners(o.obb.corners as unknown as Vec3[])
      if (!g) continue
      const mat = new LineBasicMaterial({ color: 0x0f766e })
      ;(mat as any).depthTest = false
      const wire = new LineSegments(g, mat)
      wire.renderOrder = 900
      toolsGroup.add(wire)

      const anchor = new Vector3(...o.labelWorldPos)
      const marker = makeMarkerEl(overlay, 'O', '#0f766e')
      markers.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: anchor, el: marker })

      const isActive = store.activeObbAnnotationId.value === o.id
      if (isActive) {
        const label = makeLabelEl(overlay, o.title || 'OBB 批注', o.description || '')
        labels.set(`obb:${o.id}`, { id: `obb:${o.id}`, worldPos: anchor, el: label })
      }

      marker.addEventListener('click', (ev) => {
        ev.stopPropagation()
        store.activeObbAnnotationId.value = o.id
        store.activeAnnotationId.value = null
        store.activeCloudAnnotationId.value = null
        store.activeRectAnnotationId.value = null
      })
    }

    // preview rect line (if exists)
    if (rectPreviewLine.value) {
      toolsGroup.add(rectPreviewLine.value)
    }

    updateOverlayPositions()
    requestRender?.()
  }

  function updateOverlayPositions() {
    const viewer = dtxViewerRef.value
    const overlay = overlayContainerRef.value
    const canvas = viewer?.canvas
    if (!viewer || !overlay || !canvas) return

    for (const it of markers.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos)
      it.el.style.left = `${p.x}px`
      it.el.style.top = `${p.y}px`
      it.el.style.opacity = p.visible ? '1' : '0'
    }

    for (const it of labels.values()) {
      const p = worldToOverlay(viewer.camera, canvas, overlay, it.worldPos)
      it.el.style.left = `${p.x}px`
      it.el.style.top = `${p.y}px`
      it.el.style.opacity = p.visible ? '1' : '0'
    }
  }

  function flyToMeasurement(id: string) {
    const viewer = compatViewerRef.value
    if (!viewer) return
    const rec = store.measurements.value.find((m) => m.id === id)
    if (!rec) return
    const pts: Vec3[] = []
    if (rec.kind === 'distance') {
      pts.push(rec.origin.worldPos, rec.target.worldPos)
    } else {
      pts.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos)
    }
    const aabb = aabbFromPoints(pts)
    if (!aabb) return
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
  }

  function flyToDimension(id: string) {
    const viewer = compatViewerRef.value
    if (!viewer) return
    const rec = store.dimensions.value.find((d) => d.id === id) as any
    if (!rec) return
    const pts: Vec3[] = []
    if (rec.kind === 'linear_distance') {
      pts.push(rec.origin.worldPos, rec.target.worldPos)
    } else {
      pts.push(rec.origin.worldPos, rec.corner.worldPos, rec.target.worldPos)
    }
    const aabb = aabbFromPoints(pts)
    if (!aabb) return
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
  }

  function flyToAnnotation(id: string) {
    const viewer = compatViewerRef.value
    if (!viewer) return
    const rec = store.annotations.value.find((a) => a.id === id)
    if (!rec) return
    const aabb = aabbFromPoints([rec.worldPos])
    if (!aabb) return
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
  }

  function flyToCloudAnnotation(id: string) {
    const viewer = compatViewerRef.value
    if (!viewer) return
    const rec = store.cloudAnnotations.value.find((a) => a.id === id)
    if (!rec) return
    const refnos = (rec.refnos && rec.refnos.length > 0) ? rec.refnos : rec.objectIds
    const aabb = viewer.scene.getAABB(refnos)
    if (!aabb) return
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
  }

  function flyToRectAnnotation(id: string) {
    const viewer = compatViewerRef.value
    if (!viewer) return
    const rec = store.rectAnnotations.value.find((a) => a.id === id)
    if (!rec) return
    const pts = rec.corners.map((c) => c.worldPos)
    const aabb = aabbFromPoints(pts as any)
    if (!aabb) return
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
  }

  function flyToObbAnnotation(id: string) {
    const viewer = compatViewerRef.value
    if (!viewer) return
    const rec = store.obbAnnotations.value.find((a) => a.id === id)
    if (!rec) return
    const aabb = aabbFromPoints(rec.obb.corners as any)
    if (!aabb) return
    viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
  }

  function removeMeasurement(id: string) {
    store.removeMeasurement(id)
  }

  function removeDimension(id: string) {
    store.removeDimension(id)
  }

  function removeAnnotation(id: string) {
    store.removeAnnotation(id)
  }

  function removeCloudAnnotation(id: string) {
    store.removeCloudAnnotation(id)
  }

  function removeRectAnnotation(id: string) {
    store.removeRectAnnotation(id)
  }

  function removeObbAnnotation(id: string) {
    store.removeObbAnnotation(id)
  }

  function highlightAnnotationTargets(refnos: string[]) {
    const viewer = compatViewerRef.value
    if (!viewer) return

    if (refnos.length > 0) {
      window.dispatchEvent(new CustomEvent('showModelByRefnos', { detail: { refnos, regenModel: false } }))
    }

    const prev = viewer.scene.selectedObjectIds
    if (prev.length > 0) {
      viewer.scene.setObjectsSelected(prev, false)
    }

    viewer.scene.ensureRefnos(refnos)
    viewer.scene.setObjectsSelected(refnos, true)

    const aabb = viewer.scene.getAABB(refnos)
    if (aabb) {
      viewer.cameraFlight.flyTo({ aabb, fit: true, duration: 0.8 })
    }
  }

  function highlightAnnotationTarget(refno: string) {
    highlightAnnotationTargets([refno])
  }

  function clearAllInScene() {
    clearGroup(toolsGroup)
    clearOverlayEls()
    hideMarquee()
    clearDimensionPreview()
    try {
      rectPreviewLine.value?.geometry.dispose()
      ;(rectPreviewLine.value?.material as any)?.dispose?.()
    } catch { /* ignore */ }
    rectPreviewLine.value = null
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null }
    resetProgress()
    store.clearAll()
  }

  function dispose() {
    const viewer = dtxViewerRef.value
    if (viewer && toolsGroup.parent === viewer.scene) {
      try { viewer.scene.remove(toolsGroup) } catch { /* ignore */ }
    }
    clearGroup(toolsGroup)
    clearOverlayEls()
    hideMarquee()
    clearDimensionPreview()

    if (marqueeDiv.value) {
      try { marqueeDiv.value.remove() } catch { /* ignore */ }
      marqueeDiv.value = null
    }

    try {
      rectPreviewLine.value?.geometry.dispose()
      ;(rectPreviewLine.value?.material as any)?.dispose?.()
    } catch { /* ignore */ }
    rectPreviewLine.value = null
  }

  function pickSurfacePoint(canvas: HTMLCanvasElement, e: PointerEvent): { entityId: string; worldPos: Vector3; objectId: string } | null {
    const sel = selectionRef.value
    if (!sel) return null
    const pos = getCanvasPos(canvas, e)
    const hit = sel.pickPoint(pos)
    if (!hit) return null
    const refno = parseRefnoFromDtxObjectId(hit.objectId) || hit.objectId
    return { entityId: refno, worldPos: hit.point.clone(), objectId: hit.objectId }
  }

  function computeRectPlaneBasis(camera: any, normal: Vector3): { u: Vector3; v: Vector3 } {
    const camUp = camera.up ? (camera.up as Vector3) : new Vector3(0, 0, 1)
    const u = new Vector3().crossVectors(normal, camUp)
    if (u.lengthSq() < 1e-8) {
      u.set(1, 0, 0)
    } else {
      u.normalize()
    }
    const v = new Vector3().crossVectors(u, normal).normalize()
    return { u, v }
  }

  function intersectPlaneFromPointer(canvas: HTMLCanvasElement, e: PointerEvent, plane: Plane): Vector3 | null {
    const viewer = dtxViewerRef.value
    if (!viewer) return null
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
    const ndc = new Vector3(x, y, 0.5)
    ndc.unproject(viewer.camera)
    const dir = ndc.sub(viewer.camera.position).normalize()
    const rayOrigin = viewer.camera.position.clone()
    const hit = new Vector3()
    // Plane.intersectLine expects Line3; use analytic ray-plane intersection
    const denom = plane.normal.dot(dir)
    if (Math.abs(denom) < 1e-8) return null
    const t = -(rayOrigin.dot(plane.normal) + plane.constant) / denom
    if (!Number.isFinite(t)) return null
    hit.copy(dir).multiplyScalar(t).add(rayOrigin)
    return hit
  }

  function updateRectPreview(worldCorners: Vector3[]) {
    if (worldCorners.length !== 4) return
    const pts = [...worldCorners, worldCorners[0]!]
    const arr: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!
      arr.push(p.x, p.y, p.z)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3))
    const mat = new LineBasicMaterial({ color: 0x111827 })
    ;(mat as any).depthTest = false
    const line = new Line(g, mat)
    line.renderOrder = 950

    if (rectPreviewLine.value) {
      try {
        toolsGroup.remove(rectPreviewLine.value)
        rectPreviewLine.value.geometry.dispose()
        ;(rectPreviewLine.value.material as any)?.dispose?.()
      } catch { /* ignore */ }
    }
    rectPreviewLine.value = line
    toolsGroup.add(line)
  }

  function collectRefnosInScreenRect(canvas: HTMLCanvasElement, rect: { x1: number; y1: number; x2: number; y2: number }, mode: 'annotation_cloud' | 'annotation_obb', dx: number): string[] {
    const viewer = compatViewerRef.value
    const overlay = overlayContainerRef.value
    const dtxViewer = dtxViewerRef.value
    if (!viewer || !overlay || !dtxViewer) return []
    const refnos = viewer.scene.objectIds
    if (!refnos || refnos.length === 0) return []

    const sel: string[] = []
    const containMode = mode === 'annotation_obb' && dx < 0

    for (const refno of refnos) {
      const aabb = viewer.scene.getAABB([refno])
      if (!aabb) continue
      const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]))
      const corners = [
        new Vector3(box.min.x, box.min.y, box.min.z),
        new Vector3(box.max.x, box.min.y, box.min.z),
        new Vector3(box.max.x, box.max.y, box.min.z),
        new Vector3(box.min.x, box.max.y, box.min.z),
        new Vector3(box.min.x, box.min.y, box.max.z),
        new Vector3(box.max.x, box.min.y, box.max.z),
        new Vector3(box.max.x, box.max.y, box.max.z),
        new Vector3(box.min.x, box.max.y, box.max.z),
      ]

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let anyVisible = false
      for (const c of corners) {
        const p = worldToOverlay(dtxViewer.camera, canvas, overlay, c)
        if (!p.visible) continue
        anyVisible = true
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      if (!anyVisible) continue

      const intersects = !(maxX < rect.x1 || minX > rect.x2 || maxY < rect.y1 || minY > rect.y2)
      const contained = minX >= rect.x1 && maxX <= rect.x2 && minY >= rect.y1 && maxY <= rect.y2

      if (containMode ? contained : intersects) {
        sel.push(refno)
      }
    }

    return sel
  }

  function beginMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb') {
    if (!ready.value) return
    if (e.button !== 0) return
    const start = getCanvasPos(canvas, e)
    marqueeState.value = {
      active: true,
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startCanvas: { x: start.x, y: start.y },
      currentCanvas: { x: start.x, y: start.y },
    }
    updateMarqueeStyle(mode, 0)
    updateMarqueeRect(marqueeState.value.startCanvas!, marqueeState.value.currentCanvas!)

    const viewer = dtxViewerRef.value
    if (viewer) viewer.controls.enabled = false
    try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  function moveMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb') {
    if (!marqueeState.value.active) return
    if (marqueeState.value.pointerId !== e.pointerId) return
    const cur = getCanvasPos(canvas, e)
    marqueeState.value.currentCanvas = { x: cur.x, y: cur.y }
    const start = marqueeState.value.startCanvas!
    const dx = (cur.x - start.x)
    updateMarqueeStyle(mode, dx)
    updateMarqueeRect(start, marqueeState.value.currentCanvas)
  }

  function endMarquee(canvas: HTMLCanvasElement, e: PointerEvent, mode: 'annotation_cloud' | 'annotation_obb') {
    if (!marqueeState.value.active) return
    if (marqueeState.value.pointerId !== e.pointerId) return

    const start = marqueeState.value.startCanvas
    const end = marqueeState.value.currentCanvas
    if (!start || !end) {
      hideMarquee()
      return
    }

    const viewer = dtxViewerRef.value
    if (viewer) viewer.controls.enabled = true
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }

    const rect = {
      x1: Math.min(start.x, end.x),
      y1: Math.min(start.y, end.y),
      x2: Math.max(start.x, end.x),
      y2: Math.max(start.y, end.y),
    }
    const dx = end.x - start.x
    const selectedRefnos = collectRefnosInScreenRect(canvas, rect, mode, dx)
    hideMarquee()

    if (selectedRefnos.length === 0) return

    // 打开批注面板，便于用户立即看到新建条目
    ensurePanelActivated('annotation')

    // 计算 combined bbox
    const compat = compatViewerRef.value
    if (!compat) return
    const aabb = compat.scene.getAABB(selectedRefnos)
    if (!aabb) return
    const box = new Box3(new Vector3(aabb[0], aabb[1], aabb[2]), new Vector3(aabb[3], aabb[4], aabb[5]))

    if (mode === 'annotation_cloud') {
      const n = store.cloudAnnotations.value.length + 1
      const anchor = topCenterFromBox3(box)
      const rec: CloudAnnotationRecord = {
        id: nowId('cloud'),
        objectIds: [...selectedRefnos],
        anchorWorldPos: vec3ToTuple(anchor),
        visible: true,
        title: `云线批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refnos: [...selectedRefnos],
      }
      store.addCloudAnnotation(rec)
      return
    }

    const n = store.obbAnnotations.value.length + 1
    const obb = computeAabbObbFromBox3(box)
    const labelPos = topCenterFromBox3(box)
    const rec: ObbAnnotationRecord = {
      id: nowId('obb'),
      objectIds: [...selectedRefnos],
      obb,
      labelWorldPos: vec3ToTuple(labelPos),
      anchor: { kind: 'top_center' },
      visible: true,
      title: `OBB 批注 ${n}`,
      description: '',
      createdAt: Date.now(),
      refnos: [...selectedRefnos],
    }
    store.addObbAnnotation(rec)
  }

  function beginRectDrag(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return
    if (e.button !== 0) return
    const viewer = dtxViewerRef.value
    if (!viewer) return

    const hit = pickSurfacePoint(canvas, e)
    if (!hit) return

    const normal = new Vector3()
    viewer.camera.getWorldDirection(normal).normalize()
    const basis = computeRectPlaneBasis(viewer.camera as any, normal)
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, hit.worldPos)

    rectDrag.value = {
      active: true,
      pointerId: e.pointerId,
      startCanvas: { x: getCanvasPos(canvas, e).x, y: getCanvasPos(canvas, e).y },
      plane,
      basisU: basis.u,
      basisV: basis.v,
      startWorld: hit.worldPos.clone(),
      startEntityId: hit.entityId,
    }

    viewer.controls.enabled = false
    try { canvas.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  function moveRectDrag(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!rectDrag.value.active) return
    if (rectDrag.value.pointerId !== e.pointerId) return
    const plane = rectDrag.value.plane
    const u = rectDrag.value.basisU
    const v = rectDrag.value.basisV
    const p0 = rectDrag.value.startWorld
    if (!plane || !u || !v || !p0) return

    const p1 = intersectPlaneFromPointer(canvas, e, plane)
    if (!p1) return

    const delta = p1.clone().sub(p0)
    const du = delta.dot(u)
    const dv = delta.dot(v)

    const c0 = p0.clone()
    const c1 = p0.clone().add(u.clone().multiplyScalar(du))
    const c2 = c1.clone().add(v.clone().multiplyScalar(dv))
    const c3 = p0.clone().add(v.clone().multiplyScalar(dv))
    updateRectPreview([c0, c1, c2, c3])
  }

  function endRectDrag(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!rectDrag.value.active) return
    if (rectDrag.value.pointerId !== e.pointerId) return

    const viewer = dtxViewerRef.value
    if (viewer) viewer.controls.enabled = true
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }

    const plane = rectDrag.value.plane
    const u = rectDrag.value.basisU
    const v = rectDrag.value.basisV
    const p0 = rectDrag.value.startWorld
    const entityId = rectDrag.value.startEntityId

    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null }

    if (!plane || !u || !v || !p0 || !entityId) return
    const p1 = intersectPlaneFromPointer(canvas, e, plane)
    if (!p1) return

    const delta = p1.clone().sub(p0)
    const du = delta.dot(u)
    const dv = delta.dot(v)

    const c0 = p0.clone()
    const c1 = p0.clone().add(u.clone().multiplyScalar(du))
    const c2 = c1.clone().add(v.clone().multiplyScalar(dv))
    const c3 = p0.clone().add(v.clone().multiplyScalar(dv))

    const n = store.rectAnnotations.value.length + 1
    const corners: RectAnnotationRecord['corners'] = [
      { entityId, worldPos: vec3ToTuple(c0) },
      { entityId, worldPos: vec3ToTuple(c1) },
      { entityId, worldPos: vec3ToTuple(c2) },
      { entityId, worldPos: vec3ToTuple(c3) },
    ]

    // 打开批注面板，便于用户立即编辑
    ensurePanelActivated('annotation')

    const rec: RectAnnotationRecord = {
      id: nowId('rect'),
      corners,
      visible: true,
      title: `矩形批注 ${n}`,
      description: '',
      createdAt: Date.now(),
    }
    store.addRectAnnotation(rec)
  }

  // click-based tools
  const clickTracker = ref<{ down: { x: number; y: number } | null; moved: boolean }>({ down: null, moved: false })

  function onCanvasPointerDown(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return
    if (e.button !== 0) return
    clickTracker.value = { down: { x: e.clientX, y: e.clientY }, moved: false }

    const mode = store.toolMode.value
    if (mode === 'annotation_cloud' || mode === 'annotation_obb') {
      beginMarquee(canvas, e, mode)
      return
    }
    if (mode === 'annotation_rect') {
      beginRectDrag(canvas, e)
      return
    }
  }

  function onCanvasPointerMove(canvas: HTMLCanvasElement, e: PointerEvent) {
    const down = clickTracker.value.down
    if (down) {
      const dx = e.clientX - down.x
      const dy = e.clientY - down.y
      if (dx * dx + dy * dy > 9) clickTracker.value.moved = true
    }

    const mode = store.toolMode.value
    if (mode === 'annotation_cloud' || mode === 'annotation_obb') {
      moveMarquee(canvas, e, mode)
      return
    }
    if (mode === 'annotation_rect') {
      moveRectDrag(canvas, e)
      return
    }

    if (mode === 'dimension_linear' || mode === 'dimension_angle') {
      // 仅在“已选中部分点”的情况下才做 preview，避免每帧 pick 带来额外开销
      if (
        (mode === 'dimension_linear' && dimensionPoints.value.length >= 1) ||
        (mode === 'dimension_angle' && dimensionPoints.value.length >= 2)
      ) {
        updateDimensionPreview(canvas, e)
        requestRender?.()
      }
    }
  }

  function onCanvasPointerUp(canvas: HTMLCanvasElement, e: PointerEvent) {
    if (!ready.value) return

    const mode = store.toolMode.value
    if (mode === 'annotation_cloud' || mode === 'annotation_obb') {
      endMarquee(canvas, e, mode)
      return
    }
    if (mode === 'annotation_rect') {
      endRectDrag(canvas, e)
      return
    }

    // 防止相机拖拽结束误触发
    if (clickTracker.value.moved) {
      clickTracker.value = { down: null, moved: false }
      return
    }
    clickTracker.value = { down: null, moved: false }

    if (mode === 'none') return

    if (mode === 'pick_query_center') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return
      store.setPickedQueryCenter({ entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) })
      store.setToolMode('none')
      return
    }

    if (mode === 'measure_distance') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return
      progressPoints.value = [...progressPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }]
      if (progressPoints.value.length >= 2) {
        const [p0, p1] = progressPoints.value as [MeasurementPoint, MeasurementPoint]
        const rec: DistanceMeasurementRecord = {
          id: nowId('dist'),
          kind: 'distance',
          origin: p0,
          target: p1,
          visible: true,
          createdAt: Date.now(),
        }
        store.addMeasurement(rec)
        progressPoints.value = []
      }
      return
    }

    if (mode === 'measure_angle') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return
      progressPoints.value = [...progressPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }]
      if (progressPoints.value.length >= 3) {
        const [p0, p1, p2] = progressPoints.value as [MeasurementPoint, MeasurementPoint, MeasurementPoint]
        const rec: AngleMeasurementRecord = {
          id: nowId('angle'),
          kind: 'angle',
          origin: p0,
          corner: p1,
          target: p2,
          visible: true,
          createdAt: Date.now(),
        }
        store.addMeasurement(rec)
        progressPoints.value = []
      }
      return
    }

    if (mode === 'dimension_linear') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return
      dimensionPoints.value = [...dimensionPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }]
      if (dimensionPoints.value.length >= 2) {
        const [p0, p1] = dimensionPoints.value as [MeasurementPoint, MeasurementPoint]
        const a = new Vector3(...p0.worldPos)
        const b = new Vector3(...p1.worldPos)
        const dist = a.distanceTo(b)
        const viewer = dtxViewerRef.value
        const dir = viewer ? computeDimensionOffsetDirectionByCamera(a, b, viewer.camera as any) : null
        const offset = Math.max(0.2, Math.min(2, dist * 0.15))

        const rec: LinearDistanceDimensionRecord = {
          id: nowId('dim'),
          kind: 'linear_distance',
          origin: p0,
          target: p1,
          offset,
          direction: dir ? vec3ToTuple(dir) : null,
          labelT: 0.5,
          visible: true,
          createdAt: Date.now(),
        }
        store.addDimension(rec)
        dimensionPoints.value = []
        clearDimensionPreview()
      }
      return
    }

    if (mode === 'dimension_angle') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return
      dimensionPoints.value = [...dimensionPoints.value, { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }]
      if (dimensionPoints.value.length >= 3) {
        const [p0, p1, p2] = dimensionPoints.value as [MeasurementPoint, MeasurementPoint, MeasurementPoint]
        const rec: AngleDimensionRecord2 = {
          id: nowId('dimang'),
          kind: 'angle',
          origin: p0,
          corner: p1,
          target: p2,
          offset: 0.8,
          direction: null,
          labelT: 0.5,
          visible: true,
          createdAt: Date.now(),
        }
        store.addDimension(rec as any)
        dimensionPoints.value = []
        clearDimensionPreview()
      }
      return
    }

    if (mode === 'measure_point_to_object') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return

      if (!pointToObjectStart.value) {
        pointToObjectStart.value = { entityId: hit.entityId, worldPos: vec3ToTuple(hit.worldPos) }
        return
      }

      const layer = dtxLayerRef.value
      if (!layer) return
      const start = new Vector3(...pointToObjectStart.value.worldPos)
      const closest = layer.closestPointToObject(hit.objectId, start)
      if (!closest) return

      const rec: DistanceMeasurementRecord = {
        id: nowId('pto'),
        kind: 'distance',
        origin: pointToObjectStart.value,
        target: { entityId: hit.entityId, worldPos: vec3ToTuple(closest.point) },
        visible: true,
        createdAt: Date.now(),
      }
      store.addMeasurement(rec)
      pointToObjectStart.value = null
      return
    }

    // annotation: click to create text annotation
    if (mode === 'annotation') {
      const hit = pickSurfacePoint(canvas, e)
      if (!hit) return
      const n = store.annotations.value.length + 1
      const rec: AnnotationRecord = {
        id: nowId('anno'),
        entityId: hit.entityId,
        worldPos: vec3ToTuple(hit.worldPos),
        visible: true,
        glyph: `A${n}`,
        title: `批注 ${n}`,
        description: '',
        createdAt: Date.now(),
        refno: hit.entityId,
      }
      store.addAnnotation(rec)
      ensurePanelActivated('annotation')
      return
    }

    // 点击其它批注模式时，保持不误创建文字批注
  }

  function onCanvasPointerCancel(canvas: HTMLCanvasElement, e: PointerEvent) {
    void e
    const viewer = dtxViewerRef.value
    if (viewer) viewer.controls.enabled = true
    hideMarquee()
    clearDimensionPreview()
    rectDrag.value = { active: false, pointerId: null, startCanvas: null, plane: null, basisU: null, basisV: null, startWorld: null, startEntityId: null }
    try {
      rectPreviewLine.value?.geometry.dispose()
      ;(rectPreviewLine.value?.material as any)?.dispose?.()
    } catch { /* ignore */ }
    rectPreviewLine.value = null
    clickTracker.value = { down: null, moved: false }
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  watch(
    () => ({
      measurements: store.measurements.value,
      annotations: store.annotations.value,
      cloudAnnotations: store.cloudAnnotations.value,
      rectAnnotations: store.rectAnnotations.value,
      obbAnnotations: store.obbAnnotations.value,
      activeAnnotationId: store.activeAnnotationId.value,
      activeCloudAnnotationId: store.activeCloudAnnotationId.value,
      activeRectAnnotationId: store.activeRectAnnotationId.value,
      activeObbAnnotationId: store.activeObbAnnotationId.value,
    }),
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return
      syncFromStore()
    },
    { deep: true }
  )

  // 显示单位变化：刷新测量标签等 overlay 文本
  watch(
    () => [unitSettings.displayUnit.value, unitSettings.precision.value],
    () => {
      if (!dtxViewerRef.value || !overlayContainerRef.value) return
      syncFromStore()
      requestRender?.()
    }
  )

  watch(
    () => store.toolMode.value,
    (mode, prev) => {
      if (mode !== prev) {
        resetProgress()
      }
      if (mode === 'none' && prev !== 'none') {
        hideMarquee()
      }
    }
  )

  watch(
    () => dtxViewerRef.value,
    (viewer, prev) => {
      if (prev && toolsGroup.parent === prev.scene) {
        prev.scene.remove(toolsGroup)
      }
      if (viewer) {
        ensureToolsGroupAttached()
        syncFromStore()
      } else {
        clearGroup(toolsGroup)
        clearOverlayEls()
      }
    },
    { immediate: true }
  )

  return {
    ready,
    statusText,

    syncFromStore,
    updateOverlayPositions,

    // actions used by panels
    flyToMeasurement,
    flyToDimension,
    flyToAnnotation,
    flyToCloudAnnotation,
    flyToRectAnnotation,
    flyToObbAnnotation,

    removeMeasurement,
    removeDimension,
    removeAnnotation,
    removeCloudAnnotation,
    removeRectAnnotation,
    removeObbAnnotation,

    highlightAnnotationTarget,
    highlightAnnotationTargets,

    clearAllInScene,
    dispose,

    // input hook (ViewerPanel 使用)
    onCanvasPointerDown,
    onCanvasPointerMove,
    onCanvasPointerUp,
    onCanvasPointerCancel,

    // 兼容：selectionStore 在 none 模式下由 ViewerPanel 处理
    selectionStore,
  }
}
