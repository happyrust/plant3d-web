/**
 * 线性尺寸标注
 *
 * 结构：
 *          ↑ extensionLine1
 *     ─────┼───────────────────┼───── dimensionLine
 *          │                   │
 *     ◄────┼───────────────────┼────► arrows
 *          │     [1500 mm]     │      textLabel
 *     ─────┼───────────────────┼─────
 *          ↓ extensionLine2
 *        start                end
 */

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'

export interface LinearDimensionParams {
  /** 起点 */
  start: THREE.Vector3
  /** 终点 */
  end: THREE.Vector3
  /** 标注线偏移距离（世界单位） */
  offset?: number
  /** 自定义文本（默认自动计算距离） */
  text?: string
  /** 偏移方向（默认自动计算垂直方向） */
  direction?: THREE.Vector3
  /** 单位后缀 */
  unit?: string
  /** 小数位数 */
  decimals?: number
}

// 共享几何体
const arrowGeometry = new THREE.ConeGeometry(0.06, 0.18, 8)
arrowGeometry.rotateZ(-Math.PI / 2) // 指向 +X 方向

export class LinearDimension extends AnnotationBase {
  private params: Required<Omit<LinearDimensionParams, 'direction'>> & { direction?: THREE.Vector3 }
  private materialSet: AnnotationMaterialSet

  // 子组件
  private dimensionLine: Line2
  private extensionLine1: Line2
  private extensionLine2: Line2
  private arrow1: THREE.Mesh
  private arrow2: THREE.Mesh
  private textLabel: CSS2DObject

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

  constructor(
    materials: AnnotationMaterials,
    params: LinearDimensionParams,
    options?: AnnotationOptions
  ) {
    super(materials, options)

    this.params = {
      start: params.start.clone(),
      end: params.end.clone(),
      offset: params.offset ?? 0.5,
      text: params.text ?? '',
      direction: params.direction?.clone(),
      unit: params.unit ?? '',
      decimals: params.decimals ?? 1,
    }
    this.materialSet = this.resolveMaterialSet(materials.green)

    // 创建几何体
    this.dimLineGeometry = new LineGeometry()
    this.ext1Geometry = new LineGeometry()
    this.ext2Geometry = new LineGeometry()

    // 创建尺寸线
    this.dimensionLine = new Line2(this.dimLineGeometry, this.materialSet.line)
    this.add(this.dimensionLine)

    // 创建尺寸界线
    this.extensionLine1 = new Line2(this.ext1Geometry, this.materialSet.line)
    this.extensionLine2 = new Line2(this.ext2Geometry, this.materialSet.line)
    this.add(this.extensionLine1, this.extensionLine2)

    // 创建箭头
    this.arrow1 = new THREE.Mesh(arrowGeometry, this.materialSet.mesh)
    this.arrow2 = new THREE.Mesh(arrowGeometry, this.materialSet.mesh)
    this.add(this.arrow1, this.arrow2)

    // 创建文本标签
    const labelDiv = document.createElement('div')
    labelDiv.className = 'annotation-label annotation-label--dim'
    this.textLabel = new CSS2DObject(labelDiv)
    this.add(this.textLabel)

    // 初始化几何
    this.rebuild()
  }

  /** 获取当前参数 */
  getParams(): LinearDimensionParams {
    return {
      start: this.params.start.clone(),
      end: this.params.end.clone(),
      offset: this.params.offset,
      text: this.params.text || undefined,
      direction: this.params.direction?.clone(),
      unit: this.params.unit,
      decimals: this.params.decimals,
    }
  }

  /** 更新参数并重建几何 */
  setParams(params: Partial<LinearDimensionParams>): void {
    if (params.start) this.params.start.copy(params.start)
    if (params.end) this.params.end.copy(params.end)
    if (params.offset !== undefined) this.params.offset = params.offset
    if (params.text !== undefined) this.params.text = params.text
    if (params.direction) this.params.direction = params.direction.clone()
    if (params.unit !== undefined) this.params.unit = params.unit
    if (params.decimals !== undefined) this.params.decimals = params.decimals
    this.rebuild()
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  /** 重建几何体 */
  private rebuild(): void {
    const { start, end, offset } = this.params
    const distance = start.distanceTo(end)

    // 计算偏移方向
    if (this.params.direction) {
      this.offsetDir.copy(this.params.direction).normalize()
    } else {
      // 自动计算垂直方向
      this.tempVec.copy(end).sub(start).normalize()
      // 在 XY 平面内计算垂直方向
      this.offsetDir.set(-this.tempVec.y, this.tempVec.x, 0)
      if (this.offsetDir.lengthSq() < 0.0001) {
        // 如果线段平行于 Z 轴，使用 X 方向
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
    const extGap = 0.03 * Math.abs(offset) // 起点间隙
    const extOvershoot = 0.08 * Math.abs(offset) // 超出量
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
    const xAxis = new THREE.Vector3(1, 0, 0)

    this.arrow1.position.copy(this.dimStart)
    this.arrow1.quaternion.setFromUnitVectors(xAxis, dimDir)

    this.arrow2.position.copy(this.dimEnd)
    this.arrow2.quaternion.setFromUnitVectors(xAxis, dimDir.clone().negate())

    // 更新文本
    const displayText = this.params.text || `${distance.toFixed(this.params.decimals)}${this.params.unit}`
    const labelEl = this.textLabel.element as HTMLDivElement
    labelEl.textContent = displayText

    // 文本位置（尺寸线中点）
    this.textLabel.position.copy(this.dimStart).add(this.dimEnd).multiplyScalar(0.5)
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

  protected override onScaleFactorChanged(factor: number): void {
    // 仅缩放箭头等装饰件，避免缩放包含绝对坐标的线几何导致端点漂移
    this.arrow1.scale.setScalar(factor)
    this.arrow2.scale.setScalar(factor)
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()

    const labelEl = this.textLabel.element as HTMLElement
    labelEl.classList.toggle('annotation-label--active', highlighted)
  }

  override dispose(): void {
    this.dimLineGeometry.dispose()
    this.ext1Geometry.dispose()
    this.ext2Geometry.dispose()
    this.textLabel.element.remove()
    super.dispose()
  }
}
