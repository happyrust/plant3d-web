import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'
import { TroikaBillboardText } from '../text/TroikaBillboardText'
import { DEFAULT_DIMENSION_FONT_URL } from '../text/defaultFontUrl'

export interface LinearDimension3DParams {
  /** 起点 */
  start: THREE.Vector3
  /** 终点 */
  end: THREE.Vector3
  /** 标注线偏移距离（世界单位） */
  offset?: number
  /** 文本在尺寸线上的位置（0..1，默认 0.5） */
  labelT?: number
  /** SolveSpace 风格：文字自由拖拽偏移（世界坐标，相对于 labelT 基准位置）。设置后优先于 labelT 定位。 */
  labelOffsetWorld?: THREE.Vector3 | null
  /** 参考尺寸（灰色虚线样式，仅显示不参与约束） */
  isReference?: boolean
  /** 自定义文本（默认自动计算距离） */
  text?: string
  /** 偏移方向（默认自动计算垂直方向） */
  direction?: THREE.Vector3
  /** 单位后缀 */
  unit?: string
  /** 小数位数 */
  decimals?: number
  /** 字体 URL（默认使用内置 Roboto Mono woff） */
  fontUrl?: string
}

// 共享几何体
const arrowGeometry = new THREE.ConeGeometry(0.06, 0.18, 8)
arrowGeometry.rotateZ(-Math.PI / 2) // 指向 +X 方向

const xAxis = new THREE.Vector3(1, 0, 0)

const SNAP_TS = [0, 0.25, 0.5, 0.75, 1] as const
const snapMarkerGeometry = new THREE.CircleGeometry(0.12, 24)

export class LinearDimension3D extends AnnotationBase {
  private params: Required<Omit<LinearDimension3DParams, 'direction' | 'fontUrl' | 'labelOffsetWorld' | 'isReference'>> & {
    direction?: THREE.Vector3
    fontUrl?: string
    labelOffsetWorld?: THREE.Vector3 | null
    isReference?: boolean
  }
  private materialSet: AnnotationMaterialSet

  // 子组件
  private dimensionLine: Line2
  private extensionLine1: Line2
  private extensionLine2: Line2
  private arrow1: THREE.Mesh
  private arrow2: THREE.Mesh
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
  private lastDistance = 0
  private lastDisplayText = ''

  // 几何体（需要动态更新）
  private dimLineGeometry: LineGeometry
  private ext1Geometry: LineGeometry
  private ext2Geometry: LineGeometry

  // 缓存计算结果
  private readonly dimStart = new THREE.Vector3()
  private readonly dimEnd = new THREE.Vector3()
  private readonly offsetDir = new THREE.Vector3()
  private readonly tempVec = new THREE.Vector3()
  private readonly tempVec2 = new THREE.Vector3()
  private readonly tempWorldA = new THREE.Vector3()
  private readonly tempWorldB = new THREE.Vector3()
  private readonly tempLocalA = new THREE.Vector3()
  private readonly tempLocalB = new THREE.Vector3()

  constructor(
    materials: AnnotationMaterials,
    params: LinearDimension3DParams,
    options?: AnnotationOptions
  ) {
    super(materials, options)

    this.params = {
      start: params.start.clone(),
      end: params.end.clone(),
      offset: params.offset ?? 0.5,
      labelT: params.labelT ?? 0.5,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
      isReference: params.isReference ?? false,
      text: params.text ?? '',
      direction: params.direction?.clone(),
      unit: params.unit ?? '',
      decimals: params.decimals ?? 1,
      fontUrl: params.fontUrl,
    }
    this.materialSet = this.resolveMaterialSet(materials.green)

    // 创建几何体
    this.dimLineGeometry = new LineGeometry()
    this.ext1Geometry = new LineGeometry()
    this.ext2Geometry = new LineGeometry()

    // 创建尺寸线
    this.dimensionLine = new Line2(this.dimLineGeometry, this.materialSet.line)
    this.dimensionLine.userData.dragRole = 'offset'
    this.add(this.dimensionLine)

    // 创建尺寸界线
    this.extensionLine1 = new Line2(this.ext1Geometry, this.materialSet.line)
    this.extensionLine2 = new Line2(this.ext2Geometry, this.materialSet.line)
    this.extensionLine1.userData.dragRole = 'offset'
    this.extensionLine2.userData.dragRole = 'offset'
    this.add(this.extensionLine1, this.extensionLine2)

    // 创建箭头
    this.arrow1 = new THREE.Mesh(arrowGeometry, this.materialSet.mesh)
    this.arrow2 = new THREE.Mesh(arrowGeometry, this.materialSet.mesh)
    this.arrow1.userData.dragRole = 'offset'
    this.arrow2.userData.dragRole = 'offset'
    this.add(this.arrow1, this.arrow2)

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

    // 创建 3D 文本标签（billboard）
    const fontUrl = params.fontUrl ?? DEFAULT_DIMENSION_FONT_URL
    this.textLabel = new TroikaBillboardText({
      text: '',
      fontUrl,
      fontSize: 0.18,
      color: 0x22c55e,
      outlineColor: 0x000000,
      outlineWidth: 0.015,
    })
    this.textLabel.object3d.userData.dragRole = 'label'
    this.add(this.textLabel.object3d)

    // 吸附提示线（拖拽文字时临时显示；不参与拾取；使用普通 Line 避免 LineMaterial 分辨率维护）
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

  /**
   * 设置吸附提示线目标点（世界坐标）。
   * - worldPos=null：清理并隐藏
   */
  setLabelSnapGuideTarget(worldPos: THREE.Vector3 | null): void {
    if (!worldPos) {
      this.snapGuideLine.visible = false
      return
    }

    // 确保 world matrices 可用
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

  /** 获取当前显示文本（优先 textOverride，否则为自动计算） */
  getDisplayText(): string {
    return this.lastDisplayText
  }

  /** 获取当前测量距离（start-end 的长度） */
  getDistance(): number {
    return this.lastDistance
  }

  /** 获取文字标签的世界坐标 */
  getLabelWorldPos(): THREE.Vector3 {
    return this.textLabel.object3d.getWorldPosition(new THREE.Vector3())
  }

  /** 获取吸附点的世界坐标（用于拖拽提示线/外部辅助） */
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

  /** 仅控制文字显隐（不影响线/箭头） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible)
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

  /** 获取当前参数 */
  getParams(): LinearDimension3DParams {
    return {
      start: this.params.start.clone(),
      end: this.params.end.clone(),
      offset: this.params.offset,
      labelT: this.params.labelT,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
      isReference: this.params.isReference,
      text: this.params.text || undefined,
      direction: this.params.direction?.clone(),
      unit: this.params.unit,
      decimals: this.params.decimals,
      fontUrl: this.params.fontUrl,
    }
  }

  /** 获取 label 默认位置（无 labelOffsetWorld 时的基准，即 labelT 插值点） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5))
    return this.dimStart.clone().lerp(this.dimEnd, t)
  }

  /** 更新参数并重建几何 */
  setParams(params: Partial<LinearDimension3DParams>): void {
    if (params.start) this.params.start.copy(params.start)
    if (params.end) this.params.end.copy(params.end)
    if (params.offset !== undefined) this.params.offset = params.offset
    if (params.labelT !== undefined) this.params.labelT = params.labelT
    if ('labelOffsetWorld' in params) {
      this.params.labelOffsetWorld = params.labelOffsetWorld?.clone() ?? null
    }
    if (params.isReference !== undefined) this.params.isReference = params.isReference
    if (params.text !== undefined) this.params.text = params.text
    if (params.direction) this.params.direction = params.direction.clone()
    if (params.unit !== undefined) this.params.unit = params.unit
    if (params.decimals !== undefined) this.params.decimals = params.decimals
    if (params.fontUrl !== undefined) this.params.fontUrl = params.fontUrl
    this.rebuild()
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line
    const meshMat = this._highlighted ? this.materialSet.meshHover : this.materialSet.mesh

    this.dimensionLine.material = mat
    this.extensionLine1.material = mat
    this.extensionLine2.material = mat
    this.arrow1.material = meshMat
    this.arrow2.material = meshMat
  }

  /** 重建几何体 */
  private rebuild(): void {
    const { start, end, offset } = this.params
    const distance = start.distanceTo(end)
    this.lastDistance = distance

    // 计算偏移方向
    if (this.params.direction) {
      this.offsetDir.copy(this.params.direction).normalize()
    } else {
      this.tempVec.copy(end).sub(start).normalize()
      this.offsetDir.set(-this.tempVec.y, this.tempVec.x, 0)
      if (this.offsetDir.lengthSq() < 0.0001) {
        this.offsetDir.set(1, 0, 0)
      }
      this.offsetDir.normalize()
    }

    // 尺寸线端点
    this.dimStart.copy(start).addScaledVector(this.offsetDir, offset)
    this.dimEnd.copy(end).addScaledVector(this.offsetDir, offset)

    // 更新尺寸线几何
    this.dimLineGeometry.setPositions([
      this.dimStart.x, this.dimStart.y, this.dimStart.z,
      this.dimEnd.x, this.dimEnd.y, this.dimEnd.z,
    ])

    // 更新尺寸界线几何
    const extGap = 0.03 * Math.abs(offset)
    const extOvershoot = 0.08 * Math.abs(offset)
    const signedOffset = offset >= 0 ? 1 : -1

    // 界线1：从 start 向 dimStart
    const ext1Start = this.tempVec.copy(start).addScaledVector(this.offsetDir, extGap * signedOffset)
    const ext1End = this.tempVec2.copy(this.dimStart).addScaledVector(this.offsetDir, extOvershoot * signedOffset)
    this.ext1Geometry.setPositions([
      ext1Start.x, ext1Start.y, ext1Start.z,
      ext1End.x, ext1End.y, ext1End.z,
    ])

    // 界线2：从 end 向 dimEnd
    const ext2Start = this.tempVec.copy(end).addScaledVector(this.offsetDir, extGap * signedOffset)
    const ext2End = this.tempVec2.copy(this.dimEnd).addScaledVector(this.offsetDir, extOvershoot * signedOffset)
    this.ext2Geometry.setPositions([
      ext2Start.x, ext2Start.y, ext2Start.z,
      ext2End.x, ext2End.y, ext2End.z,
    ])

    // 更新箭头位置和朝向
    const dimDir = this.tempVec.copy(this.dimEnd).sub(this.dimStart).normalize()
    this.arrow1.position.copy(this.dimStart)
    this.arrow1.quaternion.setFromUnitVectors(xAxis, dimDir)
    this.arrow2.position.copy(this.dimEnd)
    this.arrow2.quaternion.setFromUnitVectors(xAxis, dimDir.clone().negate())

    // 参考尺寸样式（灰色半透明）
    if (this.params.isReference) {
      this.dimensionLine.visible = true
      this.extensionLine1.visible = true
      this.extensionLine2.visible = true
      // 视觉区分：降低不透明度
      const setRefOpacity = (obj: any) => {
        try {
          const m = obj.material
          if (m) { m.opacity = 0.4; m.transparent = true }
        } catch { /* ignore */ }
      }
      setRefOpacity(this.dimensionLine)
      setRefOpacity(this.extensionLine1)
      setRefOpacity(this.extensionLine2)
      setRefOpacity(this.arrow1)
      setRefOpacity(this.arrow2)
    }

    // 更新文本
    let displayText = this.params.text || `${distance.toFixed(this.params.decimals)}${this.params.unit}`
    if (this.params.isReference && !displayText.startsWith('REF ')) {
      displayText = `REF ${displayText}`
    }
    this.lastDisplayText = displayText
    this.textLabel.setText(displayText)

    // 文本位置：优先使用 labelOffsetWorld（SolveSpace 自由拖拽），否则用 labelT 插值
    const t = Math.max(0, Math.min(1, Number(this.params.labelT) || 0.5))
    const baseLabelPos = this.tempVec.copy(this.dimStart).lerp(this.dimEnd, t)
    if (this.params.labelOffsetWorld) {
      this.textLabel.object3d.position.copy(baseLabelPos).add(this.params.labelOffsetWorld)
    } else {
      this.textLabel.object3d.position.copy(baseLabelPos)
    }

    // 吸附点位置
    for (let i = 0; i < this.snapMarkers.length; i++) {
      const mt = SNAP_TS[i] ?? 0.5
      this.snapMarkers[i]!.position.copy(this.dimStart).lerp(this.dimEnd, mt)
    }
    this.applySnapMarkerMaterials()
  }

  protected override onScaleFactorChanged(factor: number): void {
    this.arrow1.scale.setScalar(factor)
    this.arrow2.scale.setScalar(factor)
    this.textLabel.setScale(factor)
    this.snapScaleBase = factor
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()
    this.textLabel.setHighlighted(highlighted)
  }

  override dispose(): void {
    this.dimLineGeometry.dispose()
    this.ext1Geometry.dispose()
    this.ext2Geometry.dispose()
    this.textLabel.dispose()
    this.snapGuideGeometry.dispose()
    this.snapGuideMaterial.dispose()
    this.snapMarkerMat.dispose()
    this.snapMarkerMatActive.dispose()
    super.dispose()
  }
}
