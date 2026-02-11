import * as THREE from 'three'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'
import { SolveSpaceBillboardVectorText } from '../text/SolveSpaceBillboardVectorText'

export interface SlopeAnnotation3DParams {
  /** 起点 */
  start: THREE.Vector3
  /** 终点 */
  end: THREE.Vector3
  /** 坡度文本（主行） */
  text: string
  /** 坡度值（可选，仅保留字段以兼容后端） */
  slope?: number
  /** 文字世界偏移（拖拽后保存） */
  labelOffsetWorld?: THREE.Vector3 | null
}

export class SlopeAnnotation3D extends AnnotationBase {
  private params: Required<Omit<SlopeAnnotation3DParams, 'slope' | 'labelOffsetWorld'>> & { slope?: number; labelOffsetWorld: THREE.Vector3 | null }
  private materialSet: AnnotationMaterialSet

  private slopeLine: THREE.Line
  private lineGeometry: THREE.BufferGeometry
  private textLabel: SolveSpaceBillboardVectorText
  private readonly _delta = new THREE.Vector3()

  constructor(
    materials: AnnotationMaterials,
    params: SlopeAnnotation3DParams,
    options?: AnnotationOptions
  ) {
    super(materials, options)

    this.params = {
      start: params.start.clone(),
      end: params.end.clone(),
      text: params.text,
      slope: params.slope,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
    }
    this.materialSet = this.resolveMaterialSet(materials.blue)

    this.lineGeometry = new THREE.BufferGeometry()
    this.slopeLine = new THREE.Line(this.lineGeometry, this.materialSet.line)
    this.slopeLine.userData.dragRole = 'offset'
    this.add(this.slopeLine)

    this.textLabel = new SolveSpaceBillboardVectorText({
      text: '',
      materialNormal: this.materialSet.line,
      materialHovered: materials.ssHovered.line,
      materialSelected: materials.ssSelected.line,
    })
    this.textLabel.object3d.userData.dragRole = 'label'
    this.add(this.textLabel.object3d)

    this.rebuild()
  }

  override update(camera: THREE.Camera): void {
    super.update(camera)
    this.textLabel.update(camera)
  }

  /** 仅控制文字显隐（不影响线） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible)
  }

  getParams(): SlopeAnnotation3DParams {
    return {
      start: this.params.start.clone(),
      end: this.params.end.clone(),
      text: this.params.text,
      slope: this.params.slope,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
    }
  }

  setParams(params: Partial<SlopeAnnotation3DParams>): void {
    if (params.start) this.params.start.copy(params.start)
    if (params.end) this.params.end.copy(params.end)
    if (params.text !== undefined) this.params.text = params.text
    if (params.slope !== undefined) this.params.slope = params.slope
    if ('labelOffsetWorld' in params) {
      this.params.labelOffsetWorld = params.labelOffsetWorld?.clone() ?? null
    }
    this.rebuild()
  }

  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  /** 获取默认文字位置（本地坐标，用于拖拽偏移计算） */
  getDefaultLabelLocalPos(): THREE.Vector3 {
    return this._delta.clone().multiplyScalar(0.5)
  }

  /** 获取默认文字世界位置（用于拖拽偏移计算） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    const local = this.getDefaultLabelLocalPos()
    return this.localToWorld(local)
  }

  private rebuild(): void {
    const { start, end, text, labelOffsetWorld } = this.params

    // root = start，线段与文字均用相对坐标，避免全局缩放/缩放独立时漂移
    this.position.copy(start)
    this._delta.copy(end).sub(start)

    this.lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      this._delta.x, this._delta.y, this._delta.z,
    ], 3))

    // two-line text
    this.textLabel.setText(`${text}\n坡度`)
    const labelPos = this._delta.clone().multiplyScalar(0.5)
    if (labelOffsetWorld) {
      labelPos.add(labelOffsetWorld)
    }
    this.textLabel.object3d.position.copy(labelPos)
  }

  private applyMaterials(): void {
    // SolveSpace 风格：selected > hovered > normal
    const state = this.interactionState
    let lineMat: any
    if (state === 'selected') {
      lineMat = this.materials.ssSelected.line
    } else if (state === 'hovered') {
      lineMat = this.materials.ssHovered.line
    } else {
      lineMat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line
    }
    this.slopeLine.material = lineMat
  }

  protected override onScaleFactorChanged(factor: number): void {
    // 仅缩放文字，避免缩放包含绝对坐标的线几何导致端点漂移
    this.textLabel.setScale(factor)
  }

  override setBackgroundColor(color: THREE.ColorRepresentation): void {
    this.textLabel.setBackgroundColor(color)
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()
    this.textLabel.setInteractionState(this.interactionState)
  }

  override dispose(): void {
    this.lineGeometry.dispose()
    this.textLabel.dispose()
    super.dispose()
  }
}

