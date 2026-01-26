import { ref, watch, type Ref } from 'vue'
import { Box3, BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Matrix4, Vector3 } from 'three'

import type { PtsetPoint, PtsetResponse } from '@/api/genModelPdmsAttrApi'
import { useUnitSettingsStore } from '@/composables/useUnitSettingsStore'
import { getDtxRefnoTransform } from '@/composables/useDbnoInstancesDtxLoader'
import type { DtxViewer } from '@/viewer/dtx/DtxViewer'
import { formatLengthMeters, formatNumber, formatVec3Meters } from '@/utils/unitFormat'

type Vec3 = [number, number, number]

type PtsetVisualObject = {
  id: string
  refno: string
  point: PtsetPoint
  worldPos: Vec3
  cross?: LineSegments
  arrow?: LineSegments
  labelDiv?: HTMLDivElement
}

export type UsePtsetVisualizationThreeReturn = {
  visualObjects: Ref<Map<string, PtsetVisualObject>>
  isVisible: Ref<boolean>
  currentRefno: Ref<string | null>
  currentResponse: Ref<PtsetResponse | null>
  showCrosses: Ref<boolean>
  showLabels: Ref<boolean>
  showArrows: Ref<boolean>
  renderPtset: (refno: string, response: PtsetResponse) => void
  clearAll: () => void
  setVisible: (visible: boolean) => void
  setCrossesVisible: (visible: boolean) => void
  setLabelsVisible: (visible: boolean) => void
  setArrowsVisible: (visible: boolean) => void
  flyToPtset: () => void
  updateLabelPositions: () => void
}

function extractDbNumFromRefno(refno: string): number | null {
  const normalized = refno.trim().replace('/', '_')
  const head = normalized.split('_')[0]
  const n = Number(head)
  return Number.isFinite(n) ? n : null
}

function formatCoord(pt: [number, number, number]): string {
  return `(${pt[0].toFixed(1)}, ${pt[1].toFixed(1)}, ${pt[2].toFixed(1)})`
}

function generateCrossLines(origin: Vec3, size: number) {
  const [x, y, z] = origin
  return {
    positions: [
      x - size, y, z, x + size, y, z,
      x, y - size, z, x, y + size, z,
      x, y, z - size, x, y, z + size,
    ],
    indices: [0, 1, 2, 3, 4, 5],
  }
}

function generateArrowLines(origin: Vec3, direction: Vec3, length: number) {
  const len = Math.sqrt(direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2)
  if (len < 0.0001) return null

  const dir: Vec3 = [direction[0] / len, direction[1] / len, direction[2] / len]
  const end: Vec3 = [origin[0] + dir[0] * length, origin[1] + dir[1] * length, origin[2] + dir[2] * length]

  const headLength = length * 0.2
  const headWidth = length * 0.1

  let perpX: Vec3
  if (Math.abs(dir[1]) < 0.9) {
    perpX = [dir[2], 0, -dir[0]]
  } else {
    perpX = [0, dir[2], -dir[1]]
  }
  const perpLen = Math.sqrt(perpX[0] ** 2 + perpX[1] ** 2 + perpX[2] ** 2)
  perpX = [perpX[0] / perpLen, perpX[1] / perpLen, perpX[2] / perpLen]

  const perpY: Vec3 = [
    dir[1] * perpX[2] - dir[2] * perpX[1],
    dir[2] * perpX[0] - dir[0] * perpX[2],
    dir[0] * perpX[1] - dir[1] * perpX[0],
  ]

  const headBase: Vec3 = [end[0] - dir[0] * headLength, end[1] - dir[1] * headLength, end[2] - dir[2] * headLength]
  const head1: Vec3 = [headBase[0] + perpX[0] * headWidth, headBase[1] + perpX[1] * headWidth, headBase[2] + perpX[2] * headWidth]
  const head2: Vec3 = [headBase[0] - perpX[0] * headWidth, headBase[1] - perpX[1] * headWidth, headBase[2] - perpX[2] * headWidth]
  const head3: Vec3 = [headBase[0] + perpY[0] * headWidth, headBase[1] + perpY[1] * headWidth, headBase[2] + perpY[2] * headWidth]
  const head4: Vec3 = [headBase[0] - perpY[0] * headWidth, headBase[1] - perpY[1] * headWidth, headBase[2] - perpY[2] * headWidth]

  return {
    positions: [
      ...origin, ...end,
      ...end, ...head1,
      ...end, ...head2,
      ...end, ...head3,
      ...end, ...head4,
    ],
    indices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  }
}

function applyTransformToPoint(worldTransform: unknown, localPt: Vec3): Vec3 {
  const px = localPt[0]
  const py = localPt[1]
  const pz = localPt[2]

  if (Array.isArray(worldTransform) && worldTransform.length === 16) {
    // 列主序 4x4
    const m = worldTransform as number[]
    return [
      (m[0] ?? 1) * px + (m[4] ?? 0) * py + (m[8] ?? 0) * pz + (m[12] ?? 0),
      (m[1] ?? 0) * px + (m[5] ?? 1) * py + (m[9] ?? 0) * pz + (m[13] ?? 0),
      (m[2] ?? 0) * px + (m[6] ?? 0) * py + (m[10] ?? 1) * pz + (m[14] ?? 0),
    ]
  }

  if (Array.isArray(worldTransform) && worldTransform.length >= 3) {
    // 行主序 3x4 / 4x4（API world_transform）
    const m = worldTransform as unknown as number[][]
    const m0 = m[0] ?? [1, 0, 0, 0]
    const m1 = m[1] ?? [0, 1, 0, 0]
    const m2 = m[2] ?? [0, 0, 1, 0]
    return [
      (m0[0] ?? 1) * px + (m0[1] ?? 0) * py + (m0[2] ?? 0) * pz + (m0[3] ?? 0),
      (m1[0] ?? 0) * px + (m1[1] ?? 1) * py + (m1[2] ?? 0) * pz + (m1[3] ?? 0),
      (m2[0] ?? 0) * px + (m2[1] ?? 0) * py + (m2[2] ?? 1) * pz + (m2[3] ?? 0),
    ]
  }

  return localPt
}

function applyTransformToDir(worldTransform: unknown, localDir: Vec3): Vec3 {
  const dx = localDir[0]
  const dy = localDir[1]
  const dz = localDir[2]

  if (Array.isArray(worldTransform) && worldTransform.length === 16) {
    const m = worldTransform as number[]
    return [
      (m[0] ?? 1) * dx + (m[4] ?? 0) * dy + (m[8] ?? 0) * dz,
      (m[1] ?? 0) * dx + (m[5] ?? 1) * dy + (m[9] ?? 0) * dz,
      (m[2] ?? 0) * dx + (m[6] ?? 0) * dy + (m[10] ?? 1) * dz,
    ]
  }

  if (Array.isArray(worldTransform) && worldTransform.length >= 3) {
    const m = worldTransform as unknown as number[][]
    const m0 = m[0] ?? [1, 0, 0, 0]
    const m1 = m[1] ?? [0, 1, 0, 0]
    const m2 = m[2] ?? [0, 0, 1, 0]
    return [
      (m0[0] ?? 1) * dx + (m0[1] ?? 0) * dy + (m0[2] ?? 0) * dz,
      (m1[0] ?? 0) * dx + (m1[1] ?? 1) * dy + (m1[2] ?? 0) * dz,
      (m2[0] ?? 0) * dx + (m2[1] ?? 0) * dy + (m2[2] ?? 1) * dz,
    ]
  }

  return localDir
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

export function usePtsetVisualizationThree(
  dtxViewerRef: Ref<DtxViewer | null>,
  labelContainerRef: Ref<HTMLElement | null>,
  options: {
    requestRender?: (() => void) | null
    /** 与 DTXLayer.globalModelMatrix 对齐（mm->m + recenter 等），用于 ptset 与模型同坐标系显示 */
    getGlobalModelMatrix?: (() => Matrix4 | null) | null
  } = {}
): UsePtsetVisualizationThreeReturn {
  const requestRender = options.requestRender ?? null
  const getGlobalModelMatrix = options.getGlobalModelMatrix ?? null
  const unitSettings = useUnitSettingsStore()
  const visualObjects = ref<Map<string, PtsetVisualObject>>(new Map())
  const isVisible = ref(false)
  const currentRefno = ref<string | null>(null)
  const currentResponse = ref<PtsetResponse | null>(null)

  const showCrosses = ref(true)
  const showLabels = ref(true)
  const showArrows = ref(true)

  const group = new Group()
  group.name = 'dtx-ptset'
  group.renderOrder = 980
  group.matrixAutoUpdate = false
  const identityMatrix = new Matrix4()

  function ensureGroupAttached() {
    const viewer = dtxViewerRef.value
    if (!viewer) return
    if (group.parent !== viewer.scene) {
      try { group.parent?.remove(group) } catch { /* ignore */ }
      viewer.scene.add(group)
    }
  }

  function clearAll() {
    for (const obj of visualObjects.value.values()) {
      try {
        obj.cross?.geometry.dispose()
        ;(obj.cross?.material as any)?.dispose?.()
      } catch { /* ignore */ }
      try {
        obj.arrow?.geometry.dispose()
        ;(obj.arrow?.material as any)?.dispose?.()
      } catch { /* ignore */ }
      try { obj.labelDiv?.remove() } catch { /* ignore */ }
    }
    visualObjects.value.clear()
    currentRefno.value = null
    currentResponse.value = null
    isVisible.value = false

    for (const child of [...group.children]) {
      group.remove(child)
    }
    requestRender?.()
  }

  function applyVisibility() {
    for (const obj of visualObjects.value.values()) {
      try {
        if (obj.cross) obj.cross.visible = isVisible.value && showCrosses.value
        if (obj.arrow) obj.arrow.visible = isVisible.value && showArrows.value
        if (obj.labelDiv) obj.labelDiv.style.display = (isVisible.value && showLabels.value) ? 'block' : 'none'
      } catch { /* ignore */ }
    }
  }

  function updateLabelPositions() {
    const viewer = dtxViewerRef.value
    const overlay = labelContainerRef.value
    if (!viewer || !overlay) return
    if (!isVisible.value || !showLabels.value) return

    const canvasRect = viewer.canvas.getBoundingClientRect()
    const overlayRect = overlay.getBoundingClientRect()

    for (const obj of visualObjects.value.values()) {
      const el = obj.labelDiv
      if (!el) continue

      const world = new Vector3(obj.worldPos[0], obj.worldPos[1], obj.worldPos[2])
      world.project(viewer.camera)

      const visible = world.z >= -1 && world.z <= 1
      const x = (world.x * 0.5 + 0.5) * canvasRect.width + (canvasRect.left - overlayRect.left)
      const y = (-world.y * 0.5 + 0.5) * canvasRect.height + (canvasRect.top - overlayRect.top)

      el.style.left = `${x}px`
      el.style.top = `${y - 10}px`
      el.style.opacity = visible ? '1' : '0'
    }
  }

  function renderPtset(refno: string, response: PtsetResponse) {
    const viewer = dtxViewerRef.value
    const container = labelContainerRef.value
    if (!viewer || !container) return

    ensureGroupAttached()
    clearAll()

    currentRefno.value = refno
    currentResponse.value = response

    if (!response.success || response.ptset.length === 0) {
      return
    }

    // DTX 使用 shader uniform 的 globalModelMatrix 做全局变换；ptset 作为普通 Three 对象需要显式对齐。
    const gm = getGlobalModelMatrix?.() || identityMatrix
    group.matrix.copy(gm)
    group.updateMatrixWorld(true)

    const unitFactor = response.unit_info?.conversion_factor || 1
    const targetUnit = response.unit_info?.target_unit || 'unknown'
    const policy = unitSettings.ptsetDisplayPolicy.value
    const displayUnit = unitSettings.displayUnit.value
    const precision = unitSettings.precision.value

    const dbno = extractDbNumFromRefno(refno)
    const normalizedRefno = refno.trim().replace('/', '_')
    const refnoTransform = dbno ? getDtxRefnoTransform(dbno, normalizedRefno) : undefined
    const worldTransform = refnoTransform || response.world_transform

    for (const point of response.ptset) {
      const objId = `ptset_${normalizedRefno}_${point.number}`

      const localPt: Vec3 = [
        point.pt[0] * unitFactor,
        point.pt[1] * unitFactor,
        point.pt[2] * unitFactor,
      ]
      const localDir: Vec3 | null = point.dir ? [
        point.dir[0] * unitFactor,
        point.dir[1] * unitFactor,
        point.dir[2] * unitFactor,
      ] : null

      const worldPt = applyTransformToPoint(worldTransform, localPt)
      const worldDir = localDir ? applyTransformToDir(worldTransform, localDir) : null
      const scenePtV = new Vector3(worldPt[0], worldPt[1], worldPt[2]).applyMatrix4(gm)
      const scenePt: Vec3 = [scenePtV.x, scenePtV.y, scenePtV.z]

      // crosses
      const crossSize = Math.max(0.2, (point.pbore * unitFactor) * 0.15 || 0.6)
      const cross = generateCrossLines(worldPt, crossSize)
      const crossGeo = new BufferGeometry()
      crossGeo.setAttribute('position', new BufferAttribute(new Float32Array(cross.positions), 3))
      crossGeo.setIndex(new BufferAttribute(new Uint16Array(cross.indices), 1))
      const crossMat = new LineBasicMaterial({ color: 0x22c55e })
      ;(crossMat as any).depthTest = false
      const crossLine = new LineSegments(crossGeo, crossMat)
      crossLine.renderOrder = 980
      group.add(crossLine)

      // arrows
      let arrowLine: LineSegments | undefined
      if (worldDir) {
        const arrowLen = Math.max(0.6, (point.pbore * unitFactor) * 0.6 || 2.0)
        const arrow = generateArrowLines(worldPt, worldDir, arrowLen)
        if (arrow) {
          const arrowGeo = new BufferGeometry()
          arrowGeo.setAttribute('position', new BufferAttribute(new Float32Array(arrow.positions), 3))
          arrowGeo.setIndex(new BufferAttribute(new Uint16Array(arrow.indices), 1))
          const arrowMat = new LineBasicMaterial({ color: 0xf59e0b })
          ;(arrowMat as any).depthTest = false
          arrowLine = new LineSegments(arrowGeo, arrowMat)
          arrowLine.renderOrder = 980
          group.add(arrowLine)
        }
      }

      // label
      const labelDiv = document.createElement('div')
      labelDiv.className = 'ptset-label'
      labelDiv.setAttribute('data-ptset-point', String(point.number))
      const pboreInTargetUnit = point.pbore * unitFactor
      const coordText = policy === 'follow_backend'
        ? `(${formatNumber(worldPt[0], precision)}, ${formatNumber(worldPt[1], precision)}, ${formatNumber(worldPt[2], precision)})${targetUnit}`
        : formatVec3Meters(worldPt as any, displayUnit, precision)
      const boreText = point.pbore > 0
        ? (policy === 'follow_backend'
          ? `Ø${formatNumber(pboreInTargetUnit, precision)}${targetUnit}`
          : `Ø${formatLengthMeters(pboreInTargetUnit, displayUnit, precision)}`)
        : ''
      labelDiv.innerHTML = `
        <div class="ptset-label-content">
          <div class="ptset-label-number">#${point.number}</div>
          <div class="ptset-label-coord">${coordText}</div>
          ${boreText ? `<div class="ptset-label-bore">${boreText}</div>` : ''}
        </div>
      `
      labelDiv.style.cssText = `
        position: absolute;
        pointer-events: none;
        transform: translate(-50%, -100%);
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.2s;
      `
      container.appendChild(labelDiv)

      visualObjects.value.set(objId, {
        id: objId,
        refno: normalizedRefno,
        point,
        worldPos: scenePt,
        cross: crossLine,
        arrow: arrowLine,
        labelDiv,
      })
    }

    isVisible.value = true
    applyVisibility()
    updateLabelPositions()
    requestRender?.()
  }

  function setVisible(visible: boolean) {
    isVisible.value = visible
    applyVisibility()
    requestRender?.()
  }

  function setCrossesVisible(visible: boolean) {
    showCrosses.value = visible
    applyVisibility()
    requestRender?.()
  }

  function setLabelsVisible(visible: boolean) {
    showLabels.value = visible
    applyVisibility()
    requestRender?.()
  }

  function setArrowsVisible(visible: boolean) {
    showArrows.value = visible
    applyVisibility()
    requestRender?.()
  }

  function flyToPtset() {
    const viewer = dtxViewerRef.value
    if (!viewer || visualObjects.value.size === 0) return

    const box = new Box3()
    let hasAny = false
    for (const obj of visualObjects.value.values()) {
      box.expandByPoint(new Vector3(obj.worldPos[0], obj.worldPos[1], obj.worldPos[2]))
      hasAny = true
    }
    if (!hasAny || box.isEmpty()) return

    const size = new Vector3()
    box.getSize(size)
    const pad = Math.max(2, (size.x + size.y + size.z) * 0.2)
    box.expandByScalar(pad)

    const { position, target } = computeFlyToPositionFromBox(box)
    viewer.flyTo(position, target, { duration: 800 })
  }

  watch(dtxViewerRef, (viewer, prev) => {
    if (prev && !viewer) {
      clearAll()
    }
  })

  // 显示单位/精度/策略变化时，重建 label 文本（点数一般不多，直接重绘即可）。
  watch(
    () => [
      unitSettings.displayUnit.value,
      unitSettings.precision.value,
      unitSettings.ptsetDisplayPolicy.value,
    ],
    () => {
      if (!currentRefno.value || !currentResponse.value) return
      renderPtset(currentRefno.value, currentResponse.value)
    }
  )

  return {
    visualObjects,
    isVisible,
    currentRefno,
    currentResponse,
    showCrosses,
    showLabels,
    showArrows,
    renderPtset,
    clearAll,
    setVisible,
    setCrossesVisible,
    setLabelsVisible,
    setArrowsVisible,
    flyToPtset,
    updateLabelPositions,
  }
}
