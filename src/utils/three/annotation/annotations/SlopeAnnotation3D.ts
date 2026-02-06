import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { AnnotationBase, type AnnotationOptions } from '../core/AnnotationBase'
import type { AnnotationMaterials, AnnotationMaterialSet } from '../core/AnnotationMaterials'
import { TroikaBillboardText } from '../text/TroikaBillboardText'
import { DEFAULT_DIMENSION_FONT_URL } from '../text/defaultFontUrl'

export interface SlopeAnnotation3DParams {
  /** 起点 */
  start: THREE.Vector3
  /** 终点 */
  end: THREE.Vector3
  /** 坡度文本（主行） */
  text: string
  /** 坡度值（可选，仅保留字段以兼容后端） */
  slope?: number
  /** 字体 URL（默认使用内置 Roboto Mono woff） */
  fontUrl?: string
}

export class SlopeAnnotation3D extends AnnotationBase {
  private params: Required<Omit<SlopeAnnotation3DParams, 'slope' | 'fontUrl'>> & { slope?: number; fontUrl?: string }
  private materialSet: AnnotationMaterialSet

  private slopeLine: Line2
  private lineGeometry: LineGeometry
  private textLabel: TroikaBillboardText
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
      fontUrl: params.fontUrl,
    }
    this.materialSet = this.resolveMaterialSet(materials.blue)

    this.lineGeometry = new LineGeometry()
    this.slopeLine = new Line2(this.lineGeometry, this.materialSet.line)
    this.add(this.slopeLine)

    const fontUrl = params.fontUrl ?? DEFAULT_DIMENSION_FONT_URL
    this.textLabel = new TroikaBillboardText({
      text: '',
      fontUrl,
      fontSize: 0.18,
      color: 0x3b82f6,
      outlineColor: 0x000000,
      outlineWidth: 0.04,
    })
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
      fontUrl: this.params.fontUrl,
    }
  }

  setParams(params: Partial<SlopeAnnotation3DParams>): void {
    if (params.start) this.params.start.copy(params.start)
    if (params.end) this.params.end.copy(params.end)
    if (params.text !== undefined) this.params.text = params.text
    if (params.slope !== undefined) this.params.slope = params.slope
    if (params.fontUrl !== undefined) this.params.fontUrl = params.fontUrl
    this.rebuild()
  }

  setMaterialSet(materialSet: AnnotationMaterialSet): void {
    this.materialSet = materialSet
    this.applyMaterials()
  }

  private rebuild(): void {
    const { start, end, text } = this.params

    // root = start，线段与文字均用相对坐标，避免全局缩放/缩放独立时漂移
    this.position.copy(start)
    this._delta.copy(end).sub(start)

    this.lineGeometry.setPositions([
      0, 0, 0,
      this._delta.x, this._delta.y, this._delta.z,
    ])

    // two-line text
    this.textLabel.setText(`${text}\n坡度`)
    this.textLabel.object3d.position.copy(this._delta).multiplyScalar(0.5)
  }

  private applyMaterials(): void {
    const mat = this._highlighted ? this.materialSet.lineHover : this.materialSet.line
    this.slopeLine.material = mat
  }

  protected override onScaleFactorChanged(factor: number): void {
    // 仅缩放文字，避免缩放包含绝对坐标的线几何导致端点漂移
    this.textLabel.setScale(factor)
  }

  protected onHighlightChanged(highlighted: boolean): void {
    this.applyMaterials()
    this.textLabel.setHighlighted(highlighted)
  }

  override dispose(): void {
    this.lineGeometry.dispose()
    this.textLabel.dispose()
    super.dispose()
  }
}

