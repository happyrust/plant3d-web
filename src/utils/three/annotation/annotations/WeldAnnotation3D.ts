import * as THREE from 'three'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'
import { SolveSpaceBillboardVectorText } from '../text/SolveSpaceBillboardVectorText'

export interface WeldAnnotation3DParams {
  /** 焊缝位置 */
  position: THREE.Vector3
  /** 焊缝标签 */
  label: string
  /** 是否为车间焊 */
  isShop?: boolean
  /** 十字大小（世界单位；在全局缩放下会自动换算为本地） */
  crossSize?: number
  /** 文字世界偏移（拖拽后保存） */
  labelOffsetWorld?: THREE.Vector3 | null
}

// 十字标记：两条独立线段（避免 Line2 折线连线导致出现斜线）
export class WeldAnnotation3D extends AnnotationBase {
  private params: Required<Omit<WeldAnnotation3DParams, 'labelOffsetWorld'>> & { labelOffsetWorld: THREE.Vector3 | null }
  private materialSet: AnnotationMaterialSet

  private crossLineH: THREE.Line
  private crossLineV: THREE.Line
  private lineGeometryH: THREE.BufferGeometry
  private lineGeometryV: THREE.BufferGeometry
  private textLabel: SolveSpaceBillboardVectorText

  constructor(
    materials: AnnotationMaterials,
    params: WeldAnnotation3DParams,
    options?: AnnotationOptions
  ) {
    super(materials, options)

    this.params = {
      position: params.position.clone(),
      label: params.label,
      isShop: params.isShop ?? false,
      crossSize: params.crossSize ?? 50,
      labelOffsetWorld: params.labelOffsetWorld?.clone() ?? null,
    }
    this.materialSet = this.resolveMaterialSet(materials.orange)

    this.lineGeometryH = new THREE.BufferGeometry()
    this.lineGeometryV = new THREE.BufferGeometry()
    this.crossLineH = new THREE.Line(this.lineGeometryH, this.materialSet.line)
    this.crossLineV = new THREE.Line(this.lineGeometryV, this.materialSet.line)
    this.crossLineH.userData.dragRole = 'offset'
    this.crossLineV.userData.dragRole = 'offset'
    this.add(this.crossLineH, this.crossLineV)

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

  /** 仅控制文字显隐（不影响十字/线） */
  setLabelVisible(visible: boolean): void {
    this.textLabel.setVisible(visible)
  }

  getParams(): WeldAnnotation3DParams {
    return {
      position: this.params.position.clone(),
      label: this.params.label,
      isShop: this.params.isShop,
      crossSize: this.params.crossSize,
      labelOffsetWorld: this.params.labelOffsetWorld?.clone() ?? null,
    }
  }

  setParams(params: Partial<WeldAnnotation3DParams>): void {
    if (params.position) this.params.position.copy(params.position)
    if (params.label !== undefined) this.params.label = params.label
    if (params.isShop !== undefined) this.params.isShop = params.isShop
    if (params.crossSize !== undefined) this.params.crossSize = params.crossSize
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
    const s = this.params.crossSize
    return new THREE.Vector3(0, s * 0.9, 0)
  }

  /** 获取默认文字世界位置（用于拖拽偏移计算） */
  getDefaultLabelWorldPos(): THREE.Vector3 {
    const local = this.getDefaultLabelLocalPos()
    return this.localToWorld(local)
  }

  private rebuild(): void {
    const { position, label, isShop, crossSize } = this.params
    const s = crossSize

    // 以 position 作为根节点位置，几何体用“相对坐标”，避免全局缩放/缩放独立时漂移
    this.position.copy(position)

    this.lineGeometryH.setAttribute('position', new THREE.Float32BufferAttribute([
      -s, 0, 0,
      s, 0, 0,
    ], 3))
    this.lineGeometryV.setAttribute('position', new THREE.Float32BufferAttribute([
      0, -s, 0,
      0, s, 0,
    ], 3))

    const subtitle = isShop ? '车间焊' : '现场焊'
    // two-line text
    this.textLabel.setText(`${label}\n${subtitle}`)
    const labelPos = new THREE.Vector3(0, s * 0.9, 0)
    if (this.params.labelOffsetWorld) {
      labelPos.add(this.params.labelOffsetWorld)
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
    this.crossLineH.material = lineMat
    this.crossLineV.material = lineMat
  }

  protected override onScaleFactorChanged(factor: number): void {
    // 仅缩放文字，避免缩放包含绝对坐标的线几何导致位置漂移
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
    this.lineGeometryH.dispose()
    this.lineGeometryV.dispose()
    this.textLabel.dispose()
    super.dispose()
  }
}

