import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'
import { TroikaBillboardText } from '../text/TroikaBillboardText'
import { DEFAULT_DIMENSION_FONT_URL } from '../text/defaultFontUrl'

export interface WeldAnnotation3DParams {
  /** 焊缝位置 */
  position: THREE.Vector3
  /** 焊缝标签 */
  label: string
  /** 是否为车间焊 */
  isShop?: boolean
  /** 十字大小（世界单位；在全局缩放下会自动换算为本地） */
  crossSize?: number
  /** 字体 URL（默认使用内置 Roboto Mono woff） */
  fontUrl?: string
}

// 十字标记：两条独立线段（避免 Line2 折线连线导致出现斜线）
export class WeldAnnotation3D extends AnnotationBase {
  private params: Required<Omit<WeldAnnotation3DParams, 'fontUrl'>> & { fontUrl?: string }
  private materialSet: AnnotationMaterialSet

  private crossLineH: Line2
  private crossLineV: Line2
  private lineGeometryH: LineGeometry
  private lineGeometryV: LineGeometry
  private textLabel: TroikaBillboardText

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
      fontUrl: params.fontUrl,
    }
    this.materialSet = this.resolveMaterialSet(materials.orange)

    this.lineGeometryH = new LineGeometry()
    this.lineGeometryV = new LineGeometry()
    this.crossLineH = new Line2(this.lineGeometryH, this.materialSet.line)
    this.crossLineV = new Line2(this.lineGeometryV, this.materialSet.line)
    this.add(this.crossLineH, this.crossLineV)

    const fontUrl = params.fontUrl ?? DEFAULT_DIMENSION_FONT_URL
    this.textLabel = new TroikaBillboardText({
      text: '',
      fontUrl,
      fontSize: 0.18,
      color: 0xf97316,
      outlineColor: 0x000000,
      outlineWidth: 0.015,
    })
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
      fontUrl: this.params.fontUrl,
    }
  }

  setParams(params: Partial<WeldAnnotation3DParams>): void {
    if (params.position) this.params.position.copy(params.position)
    if (params.label !== undefined) this.params.label = params.label
    if (params.isShop !== undefined) this.params.isShop = params.isShop
    if (params.crossSize !== undefined) this.params.crossSize = params.crossSize
    if (params.fontUrl !== undefined) this.params.fontUrl = params.fontUrl
    this.rebuild()
  }

  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  private rebuild(): void {
    const { position, label, isShop, crossSize } = this.params
    const s = crossSize

    // 以 position 作为根节点位置，几何体用“相对坐标”，避免全局缩放/缩放独立时漂移
    this.position.copy(position)

    this.lineGeometryH.setPositions([
      -s, 0, 0,
      s, 0, 0,
    ])
    this.lineGeometryV.setPositions([
      0, -s, 0,
      0, s, 0,
    ])

    const subtitle = isShop ? '车间焊' : '现场焊'
    // two-line text
    this.textLabel.setText(`${label}\n${subtitle}`)
    this.textLabel.object3d.position.set(0, s * 0.9, 0)
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line
    this.crossLineH.material = mat
    this.crossLineV.material = mat
  }

  protected override onScaleFactorChanged(factor: number): void {
    // 仅缩放文字，避免缩放包含绝对坐标的线几何导致位置漂移
    this.textLabel.setScale(factor)
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()
    this.textLabel.setHighlighted(highlighted)
  }

  override dispose(): void {
    this.lineGeometryH.dispose()
    this.lineGeometryV.dispose()
    this.textLabel.dispose()
    super.dispose()
  }
}

