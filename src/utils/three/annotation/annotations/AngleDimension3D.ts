import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'
import { TroikaBillboardText } from '../text/TroikaBillboardText'
import { DEFAULT_DIMENSION_FONT_URL } from '../text/defaultFontUrl'

export interface AngleDimension3DParams {
  /** 角度顶点 */
  vertex: THREE.Vector3
  /** 第一条边上的点 */
  point1: THREE.Vector3
  /** 第二条边上的点 */
  point2: THREE.Vector3
  /** 圆弧半径（世界单位） */
  arcRadius?: number
  /** 文本在圆弧上的位置（0..1，默认 0.5） */
  labelT?: number
  /** SolveSpace 风格：文字自由拖拽偏移（世界坐标，相对于 labelT 基准位置） */
  labelOffsetWorld?: THREE.Vector3 | null
  /** 参考尺寸（灰色半透明样式，仅显示不参与约束） */
  isReference?: boolean
  /** 显示补角（360-angle 模式） */
  supplementary?: boolean
  /** 自定义文本（默认自动计算角度） */
  text?: string
  /** 单位（默认 °） */
  unit?: string
  /** 小数位数 */
  decimals?: number
  /** 圆弧分段数 */
  arcSegments?: number
  /** 字体 URL（默认使用内置 Roboto Mono woff） */
  fontUrl?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

const SNAP_TS = [0, 0.25, 0.5, 0.75, 1] as const
const snapMarkerGeometry = new THREE.CircleGeometry(0.12, 24)

export class AngleDimension3D extends AnnotationBase {
  private params: Required<Omit<AngleDimension3DParams, 'text' | 'fontUrl' | 'labelOffsetWorld' | 'isReference' | 'supplementary'>> & {
    text?: string
    fontUrl?: string
    labelOffsetWorld?: THREE.Vector3 | null
    isReference?: boolean
    supplementary?: boolean
  }
  private materialSet: AnnotationMaterialSet

  private ray1: Line2
  private ray2: Line2
  private arcLine: Line2
  private ray1Geometry: LineGeometry
  private ray2Geometry: LineGeometry
  private arcGeometry: LineGeometry
  private textLabel: TroikaBillboardText
  private snapGuideLine: THREE.Line
  private snapGuideGeometry: THREE.BufferGeometry
  private snapGuidePositions: Float32Array
  private snapGuideMaterial: THREE.LineBasicMaterial
  private snapGroup: THREE.Group
  private snapMarkers: THREE.Mesh[] = []
  private snapMarkerMat: THREE.MeshBasicMaterial
  private snapMarkerMatActive: THREE.MeshBasicMaterial
  private snapMarkersVisible = false
  private snapActiveIndex: number | null = null
  private snapNearIndex: number | null = null
  private snapScaleBase = 1
  private lastAngleDeg = 0
  private lastDisplayText = ''

  private readonly tempU = new THREE.Vector3()
  private readonly tempV = new THREE.Vector3()
  private readonly tempW = new THREE.Vector3()
  private readonly tempWorldA = new THREE.Vector3()
  private readonly tempWorldB = new THREE.Vector3()
  private readonly tempLocalA = new THREE.Vector3()
  private readonly tempLocalB = new THREE.Vector3()

  constructor(
    materials: AnnotationMaterials,
    params: AngleDimension3DParams,
    options?: AnnotationOptions
  ) {
    super(materials, options)

    this.params = {
      vertex: params.vertex.clone(),
      point1: params.point1.clone(),
      point2: params.point2.clone(),
      arcRadius: params.arcRadius ?? 1,
      labelT: params.labelT ?? 0.5,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
      isReference: params.isReference ?? false,
      supplementary: params.supplementary ?? false,
      text: params.text,
      unit: params.unit ?? '°',
      decimals: params.decimals ?? 1,
      arcSegments: params.arcSegments ?? 32,
      fontUrl: params.fontUrl,
    }
    this.materialSet = this.resolveMaterialSet(materials.yellow)

    this.ray1Geometry = new LineGeometry()
    this.ray2Geometry = new LineGeometry()
    this.arcGeometry = new LineGeometry()

    this.ray1 = new Line2(this.ray1Geometry, this.materialSet.line)
    this.ray2 = new Line2(this.ray2Geometry, this.materialSet.line)
    this.arcLine = new Line2(this.arcGeometry, this.materialSet.line)
    this.ray1.userData.dragRole = 'offset'
    this.ray2.userData.dragRole = 'offset'
    this.arcLine.userData.dragRole = 'offset'
    this.add(this.ray1, this.ray2, this.arcLine)

    // 吸附点标记（仅拖拽文字时临时显示）
    this.snapMarkerMat = this.materialSet.mesh.clone()
    this.snapMarkerMat.opacity = 0.25
    this.snapMarkerMat.transparent = true
    this.snapMarkerMat.depthWrite = false
    this.snapMarkerMat.side = THREE.DoubleSide
    this.snapMarkerMatActive = this.materialSet.meshHover.clone()
    this.snapMarkerMatActive.opacity = 0.95
    this.snapMarkerMatActive.transparent = true
    this.snapMarkerMatActive.depthWrite = false
    this.snapMarkerMatActive.side = THREE.DoubleSide

    this.snapGroup = new THREE.Group()
    this.snapGroup.visible = false
    this.snapGroup.userData.noPick = true
    for (let i = 0; i < SNAP_TS.length; i++) {
      const m = new THREE.Mesh(snapMarkerGeometry, this.snapMarkerMat)
      m.userData.noPick = true
      m.renderOrder = 905
      this.snapGroup.add(m)
      this.snapMarkers.push(m)
    }
    this.add(this.snapGroup)

    const fontUrl = params.fontUrl ?? DEFAULT_DIMENSION_FONT_URL
    this.textLabel = new TroikaBillboardText({
      text: '',
      fontUrl,
      fontSize: 0.18,
      color: 0xfacc15,
      outlineColor: 0x000000,
      outlineWidth: 0.015,
    })
    this.textLabel.object3d.userData.dragRole = 'label'
    this.add(this.textLabel.object3d)

    // 吸附提示线（拖拽文字时临时显示；不参与拾取）
    this.snapGuidePositions = new Float32Array(6)
    this.snapGuideGeometry = new THREE.BufferGeometry()
    this.snapGuideGeometry.setAttribute('position', new THREE.BufferAttribute(this.snapGuidePositions, 3))
    const guideColor =
      ((this.materialSet.lineHover as any)?.color as THREE.Color | undefined)?.getHex?.() ?? 0xffffff
    this.snapGuideMaterial = new THREE.LineBasicMaterial({
      color: guideColor,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
    })
    this.snapGuideLine = new THREE.Line(this.snapGuideGeometry, this.snapGuideMaterial)
    this.snapGuideLine.visible = false
    this.snapGuideLine.userData.noPick = true
    this.snapGuideLine.renderOrder = 904
    this.add(this.snapGuideLine)

    this.rebuild()
  }

  override update(camera: THREE.Camera): void {
    super.update(camera)
    this.textLabel.update(camera)

    // snap markers face camera + pulse (仅拖拽显示时)
    if (this.snapMarkersVisible) {
      for (const m of this.snapMarkers) {
        m.quaternion.copy(camera.quaternion)
      }
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now())
      const pulse = 1 + 0.12 * Math.sin(now * 0.008)
      const s = this.snapScaleBase * pulse
      for (const m of this.snapMarkers) {
        m.scale.setScalar(s)
      }
    }
  }

  /** 设置文字吸附提示（拖拽时用） */
  setLabelSnapActive(active: boolean): void {
    this.textLabel.setSnapActive(active)
  }

  /** 吸附提示线显隐（拖拽文字时用） */
  setLabelSnapGuideVisible(visible: boolean): void {
    this.snapGuideLine.visible = visible
  }

  /** 设置吸附提示线目标点（世界坐标）；worldPos=null 则清理并隐藏 */
  setLabelSnapGuideTarget(worldPos: THREE.Vector3 | null): void {
    if (!worldPos) {
      this.snapGuideLine.visible = false
      return
    }

    this.updateWorldMatrix(true, true)
    const fromWorld = this.textLabel.object3d.getWorldPosition(this.tempWorldA)
    const toWorld = this.tempWorldB.copy(worldPos)

    const fromLocal = this.worldToLocal(this.tempLocalA.copy(fromWorld))
    const toLocal = this.worldToLocal(this.tempLocalB.copy(toWorld))

    this.snapGuidePositions[0] = fromLocal.x
    this.snapGuidePositions[1] = fromLocal.y
    this.snapGuidePositions[2] = fromLocal.z
    this.snapGuidePositions[3] = toLocal.x
    this.snapGuidePositions[4] = toLocal.y
    this.snapGuidePositions[5] = toLocal.z

    const attr = this.snapGuideGeometry.getAttribute('position') as THREE.BufferAttribute
    attr.needsUpdate = true
    this.snapGuideGeometry.computeBoundingSphere()
    this.snapGuideLine.visible = true
  }

  getDisplayText(): string {
    return this.lastDisplayText
  }

  getAngleDegreesCached(): number {
    return this.lastAngleDeg
  }

  getLabelWorldPos(): THREE.Vector3 {
    return this.textLabel.object3d.getWorldPosition(new THREE.Vector3())
  }

  getSnapMarkerWorldPos(index: number): THREE.Vector3 | null {
    const m = this.snapMarkers[index]
    if (!m) return null
    return m.getWorldPosition(new THREE.Vector3())
  }

  /** 设置吸附点标记显示与激活态（拖拽时用） */
  setLabelSnapMarkersState(visible: boolean, activeIndex: number | null, nearIndex: number | null): void {
    this.snapMarkersVisible = visible
    this.snapActiveIndex = visible ? activeIndex : null
    this.snapNearIndex = visible ? nearIndex : null
    this.snapGroup.visible = visible
    this.applySnapMarkerMaterials()
  }

  private applySnapMarkerMaterials(): void {
    for (let i = 0; i < this.snapMarkers.length; i++) {
      this.snapMarkers[i]!.material =
        this.snapMarkersVisible && this.snapActiveIndex === i
          ? this.snapMarkerMatActive
          : this.snapMarkerMat

      // 仅显示邻近点（nearIndex 的相邻点 + activeIndex）
      let show = false
      if (this.snapMarkersVisible) {
        const near = this.snapNearIndex
        const active = this.snapActiveIndex
        if (active !== null && i === active) show = true
        if (near !== null && (i === near || i === near - 1 || i === near + 1)) show = true
      }
      this.snapMarkers[i]!.visible = show
    }
  }

  /** 仅控制文字显隐（不影响圆弧/射线） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible)
  }

  /** 计算角度（度） */
  getAngleDegrees(): number {
    return (this.getAngleRadians() * 180) / Math.PI
  }

  /** 计算角度（弧度） */
  getAngleRadians(): number {
    const { vertex, point1, point2 } = this.params
    const u = this.tempU.copy(point1).sub(vertex)
    const v = this.tempV.copy(point2).sub(vertex)
    if (u.lengthSq() < 1e-9 || v.lengthSq() < 1e-9) return 0
    u.normalize()
    v.normalize()
    return Math.acos(clamp(u.dot(v), -1, 1))
  }

  getParams(): AngleDimension3DParams {
    return {
      vertex: this.params.vertex.clone(),
      point1: this.params.point1.clone(),
      point2: this.params.point2.clone(),
      arcRadius: this.params.arcRadius,
      labelT: this.params.labelT,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
      isReference: this.params.isReference,
      supplementary: this.params.supplementary,
      text: this.params.text,
      unit: this.params.unit,
      decimals: this.params.decimals,
      arcSegments: this.params.arcSegments,
      fontUrl: this.params.fontUrl,
    }
  }

  /** 获取 label 默认位置（无 labelOffsetWorld 时的基准，即 labelT 插值点） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    // 复用当前文字位置逻辑但不含 offset
    const { vertex, arcRadius } = this.params
    const u = this.tempU.copy(this.params.point1).sub(vertex)
    const w = this.tempW.copy(this.params.point2).sub(vertex)
    if (u.lengthSq() < 1e-9 || w.lengthSq() < 1e-9) return vertex.clone()
    u.normalize()
    w.normalize()
    const dot = clamp(u.dot(w), -1, 1)
    const theta = this.params.supplementary ? (2 * Math.PI - Math.acos(dot)) : Math.acos(dot)
    const v = this.tempV.copy(w).addScaledVector(u, -clamp(u.dot(w), -1, 1))
    if (v.lengthSq() < 1e-9) return vertex.clone().addScaledVector(u, arcRadius)
    v.normalize()
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5))
    const a = theta * t
    return new THREE.Vector3()
      .copy(u).multiplyScalar(Math.cos(a))
      .addScaledVector(v, Math.sin(a))
      .multiplyScalar(arcRadius)
      .add(vertex)
  }

  setParams(params: Partial<AngleDimension3DParams>): void {
    if (params.vertex) this.params.vertex.copy(params.vertex)
    if (params.point1) this.params.point1.copy(params.point1)
    if (params.point2) this.params.point2.copy(params.point2)
    if (params.arcRadius !== undefined) this.params.arcRadius = params.arcRadius
    if (params.labelT !== undefined) this.params.labelT = params.labelT
    if ('labelOffsetWorld' in params) {
      this.params.labelOffsetWorld = params.labelOffsetWorld?.clone() ?? null
    }
    if (params.isReference !== undefined) this.params.isReference = params.isReference
    if (params.supplementary !== undefined) this.params.supplementary = params.supplementary
    if (params.text !== undefined) this.params.text = params.text
    if (params.unit !== undefined) this.params.unit = params.unit
    if (params.decimals !== undefined) this.params.decimals = params.decimals
    if (params.arcSegments !== undefined) this.params.arcSegments = params.arcSegments
    if (params.fontUrl !== undefined) this.params.fontUrl = params.fontUrl
    this.rebuild()
  }

  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line
    this.ray1.material = mat
    this.ray2.material = mat
    this.arcLine.material = mat
  }

  private rebuild(): void {
    const { vertex, point1, point2, arcRadius, arcSegments } = this.params

    // rays
    this.ray1Geometry.setPositions([
      vertex.x, vertex.y, vertex.z,
      point1.x, point1.y, point1.z,
    ])
    this.ray2Geometry.setPositions([
      vertex.x, vertex.y, vertex.z,
      point2.x, point2.y, point2.z,
    ])

    // compute basis
    const u = this.tempU.copy(point1).sub(vertex)
    const w = this.tempW.copy(point2).sub(vertex)
    if (u.lengthSq() < 1e-9 || w.lengthSq() < 1e-9) {
      this.arcGeometry.setPositions([])
      const display = this.params.text ?? `0${this.params.unit}`
      this.lastAngleDeg = 0
      this.lastDisplayText = display
      this.textLabel.setText(display)
      this.textLabel.object3d.position.copy(vertex)
      for (const m of this.snapMarkers) {
        m.position.copy(vertex)
      }
      this.applySnapMarkerMaterials()
      return
    }
    u.normalize()
    w.normalize()

    const dot = clamp(u.dot(w), -1, 1)
    const minorTheta = Math.acos(dot)
    const theta = this.params.supplementary ? (2 * Math.PI - minorTheta) : minorTheta
    const deg = (theta * 180) / Math.PI
    this.lastAngleDeg = deg

    // v = normalize( w - u*dot )
    const v = this.tempV.copy(w).addScaledVector(u, -dot)
    if (v.lengthSq() < 1e-9) {
      // 共线：不画弧
      this.arcGeometry.setPositions([])
      const display = this.params.text ?? `${deg.toFixed(this.params.decimals)}${this.params.unit}`
      this.lastDisplayText = display
      this.textLabel.setText(display)
      this.textLabel.object3d.position.copy(vertex).addScaledVector(u, arcRadius)
      for (const m of this.snapMarkers) {
        m.position.copy(vertex).addScaledVector(u, arcRadius)
      }
      this.applySnapMarkerMaterials()
      return
    }
    v.normalize()

    // arc points
    const positions: number[] = []
    for (let i = 0; i <= arcSegments; i++) {
      const t = i / arcSegments
      const a = theta * t
      const p = new THREE.Vector3()
        .copy(u).multiplyScalar(Math.cos(a))
        .addScaledVector(v, Math.sin(a))
        .multiplyScalar(arcRadius)
        .add(vertex)
      positions.push(p.x, p.y, p.z)
    }
    this.arcGeometry.setPositions(positions)

    // 参考尺寸样式
    if (this.params.isReference) {
      const setRefOpacity = (obj: any) => {
        try {
          const m = obj.material
          if (m) { m.opacity = 0.4; m.transparent = true }
        } catch { /* ignore */ }
      }
      setRefOpacity(this.ray1)
      setRefOpacity(this.ray2)
      setRefOpacity(this.arcLine)
    }

    let display = this.params.text ?? `${deg.toFixed(this.params.decimals)}${this.params.unit}`
    if (this.params.isReference && !display.startsWith('REF ')) {
      display = `REF ${display}`
    }
    this.lastDisplayText = display
    this.textLabel.setText(display)

    // label at arc t（基准位置），然后叠加 labelOffsetWorld
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5))
    const a = theta * t
    const baseLabelPos = new THREE.Vector3()
      .copy(u).multiplyScalar(Math.cos(a))
      .addScaledVector(v, Math.sin(a))
      .multiplyScalar(arcRadius)
      .add(vertex)
    if (this.params.labelOffsetWorld) {
      this.textLabel.object3d.position.copy(baseLabelPos).add(this.params.labelOffsetWorld)
    } else {
      this.textLabel.object3d.position.copy(baseLabelPos)
    }

    // snap marker positions
    for (let i = 0; i < this.snapMarkers.length; i++) {
      const mt = SNAP_TS[i] ?? 0.5
      const ma = theta * mt
      this.snapMarkers[i]!.position
        .copy(u).multiplyScalar(Math.cos(ma))
        .addScaledVector(v, Math.sin(ma))
        .multiplyScalar(arcRadius)
        .add(vertex)
    }
    this.applySnapMarkerMaterials()
  }

  protected override onScaleFactorChanged(factor: number): void {
    this.textLabel.setScale(factor)
    this.snapScaleBase = factor
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()
    this.textLabel.setHighlighted(highlighted)
  }

  override dispose(): void {
    this.ray1Geometry.dispose()
    this.ray2Geometry.dispose()
    this.arcGeometry.dispose()
    this.textLabel.dispose()
    this.snapGuideGeometry.dispose()
    this.snapGuideMaterial.dispose()
    this.snapMarkerMat.dispose()
    this.snapMarkerMatActive.dispose()
    super.dispose()
  }
}
