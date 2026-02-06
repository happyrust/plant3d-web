/**
 * 引线标注
 *
 * 结构：
 *                    [文本]
 *                      │
 *     ─────────────────┘ (折线可选)
 *            ↓
 *          anchor (指向点)
 */

import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'

export interface LeaderAnnotationParams {
  /** 指向点（箭头位置） */
  anchor: THREE.Vector3
  /** 文本位置 */
  textPosition: THREE.Vector3
  /** 主文本 */
  text: string
  /** 副标题 */
  subtitle?: string
  /** 折线中间点（可选，用于创建折线引线） */
  bendPoint?: THREE.Vector3
}

// 共享几何体
const arrowGeometry = new THREE.ConeGeometry(0.05, 0.15, 6)

export class LeaderAnnotation extends AnnotationBase {
  private params: LeaderAnnotationParams
  private materialSet: AnnotationMaterialSet

  private leaderLine: Line2
  private lineGeometry: LineGeometry
  private arrowHead: THREE.Mesh
  private textLabel: CSS2DObject

  constructor(
    materials: AnnotationMaterials,
    params: LeaderAnnotationParams,
    options?: AnnotationOptions
  ) {
    super(materials, options)

    this.params = {
      anchor: params.anchor.clone(),
      textPosition: params.textPosition.clone(),
      text: params.text,
      subtitle: params.subtitle,
      bendPoint: params.bendPoint?.clone(),
    }
    this.materialSet = this.resolveMaterialSet(materials.blue)

    // 创建引线
    this.lineGeometry = new LineGeometry()
    this.leaderLine = new Line2(this.lineGeometry, this.materialSet.line)
    this.add(this.leaderLine)

    // 创建箭头
    this.arrowHead = new THREE.Mesh(arrowGeometry, this.materialSet.mesh)
    this.add(this.arrowHead)

    // 创建文本
    const labelDiv = document.createElement('div')
    labelDiv.className = 'annotation-label annotation-label--leader'
    this.textLabel = new CSS2DObject(labelDiv)
    this.add(this.textLabel)

    this.rebuild()
  }

  /** 获取当前参数 */
  getParams(): LeaderAnnotationParams {
    return {
      anchor: this.params.anchor.clone(),
      textPosition: this.params.textPosition.clone(),
      text: this.params.text,
      subtitle: this.params.subtitle,
      bendPoint: this.params.bendPoint?.clone(),
    }
  }

  /** 更新参数并重建 */
  setParams(params: Partial<LeaderAnnotationParams>): void {
    if (params.anchor) this.params.anchor.copy(params.anchor)
    if (params.textPosition) this.params.textPosition.copy(params.textPosition)
    if (params.text !== undefined) this.params.text = params.text
    if (params.subtitle !== undefined) this.params.subtitle = params.subtitle
    if (params.bendPoint !== undefined) {
      this.params.bendPoint = params.bendPoint?.clone()
    }
    this.rebuild()
  }

  /** 设置材质颜色集 */
  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  private rebuild(): void {
    const { anchor, textPosition, text, subtitle, bendPoint } = this.params

    // 更新引线
    if (bendPoint) {
      // 折线：textPosition -> bendPoint -> anchor
      this.lineGeometry.setPositions([
        textPosition.x, textPosition.y, textPosition.z,
        bendPoint.x, bendPoint.y, bendPoint.z,
        anchor.x, anchor.y, anchor.z,
      ])
    } else {
      // 直线：textPosition -> anchor
      this.lineGeometry.setPositions([
        textPosition.x, textPosition.y, textPosition.z,
        anchor.x, anchor.y, anchor.z,
      ])
    }

    // 更新箭头（指向 anchor）
    // 箭头方向：从 bendPoint（或 textPosition）指向 anchor
    const fromPoint = bendPoint || textPosition
    const dir = new THREE.Vector3().copy(anchor).sub(fromPoint).normalize()

    this.arrowHead.position.copy(anchor)
    // ConeGeometry 默认指向 +Y，需要旋转到 dir 方向
    const yAxis = new THREE.Vector3(0, 1, 0)
    this.arrowHead.quaternion.setFromUnitVectors(yAxis, dir.clone().negate())

    // 更新文本
    const labelEl = this.textLabel.element as HTMLDivElement
    if (subtitle) {
      labelEl.innerHTML = `<div class="annotation-label-title">${text}</div><div class="annotation-label-sub">${subtitle}</div>`
    } else {
      labelEl.textContent = text
    }
    this.textLabel.position.copy(textPosition)
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line
    const meshMat = this._highlighted ? this.materialSet.meshHover : this.materialSet.mesh

    this.leaderLine.material = mat
    this.arrowHead.material = meshMat
  }

  protected override onScaleFactorChanged(factor: number): void {
    // 仅缩放箭头等装饰件，避免缩放线条本体导致端点漂移
    this.arrowHead.scale.setScalar(factor)
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()

    const labelEl = this.textLabel.element as HTMLElement
    labelEl.classList.toggle('annotation-label--active', highlighted)
  }

  override dispose(): void {
    this.lineGeometry.dispose()
    this.textLabel.element.remove()
    super.dispose()
  }
}
