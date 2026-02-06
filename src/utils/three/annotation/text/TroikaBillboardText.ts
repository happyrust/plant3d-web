import * as THREE from 'three'
import { Text } from 'troika-three-text'

export type TroikaBillboardTextParams = {
  text: string
  fontUrl: string
  fontSize: number
  color: number
  outlineColor: number
  outlineWidth: number
}

export class TroikaBillboardText {
  readonly object3d: THREE.Object3D

  private readonly baseOutlineWidth: number
  private readonly baseColor: THREE.Color
  private readonly baseOutlineColor: THREE.Color
  private readonly snapOutlineColor: THREE.Color

  private highlighted = false
  private snapActive = false

  // NOTE: test 中会通过 (as any).textMesh 读取；保持该字段名稳定
  private readonly textMesh: Text

  constructor(params: TroikaBillboardTextParams) {
    this.baseOutlineWidth = params.outlineWidth
    this.baseColor = new THREE.Color(params.color)
    this.baseOutlineColor = new THREE.Color(params.outlineColor)
    this.snapOutlineColor = new THREE.Color(0xffffff)

    const t = new Text()
    t.text = params.text
    t.font = params.fontUrl
    t.fontSize = params.fontSize
    t.color = this.baseColor
    t.outlineColor = this.baseOutlineColor
    t.outlineWidth = this.baseOutlineWidth
    t.anchorX = 'center'
    t.anchorY = 'middle'
    t.frustumCulled = false
    t.renderOrder = 910
    t.sync()

    // 作为“标注文字”，默认不参与深度测试，避免被模型遮挡（与 CSS2D 标签体验一致）。
    // 注意：troika Text 的 material 可能为数组；这里做兼容处理。
    try {
      const m = (t as any).material as THREE.Material | THREE.Material[] | undefined
      const apply = (mm: THREE.Material) => {
        ;(mm as any).depthTest = false
        ;(mm as any).depthWrite = false
        ;(mm as any).transparent = true
      }
      if (Array.isArray(m)) m.forEach((mm) => mm && apply(mm))
      else if (m) apply(m)
    } catch {
      // ignore
    }

    this.textMesh = t
    this.object3d = t
  }

  private applyStyle(): void {
    // 以描边为主：highlight 用“更粗”，snap 用“更亮”
    this.textMesh.outlineColor = this.snapActive ? this.snapOutlineColor : this.baseOutlineColor
    const w = this.highlighted ? Math.max(this.baseOutlineWidth, 0.08) : this.baseOutlineWidth
    this.textMesh.outlineWidth = this.snapActive ? Math.max(w, 0.12) : w
    this.textMesh.sync()
  }

  setText(text: string): void {
    if (this.textMesh.text === text) return
    this.textMesh.text = text
    this.textMesh.sync()
  }

  setHighlighted(highlighted: boolean): void {
    if (this.highlighted === highlighted) return
    this.highlighted = highlighted
    this.applyStyle()
  }

  /** 拖拽吸附提示：短暂增强描边 */
  setSnapActive(active: boolean): void {
    if (this.snapActive === active) return
    this.snapActive = active
    this.applyStyle()
  }

  setScale(scale: number): void {
    this.object3d.scale.setScalar(scale)
  }

  setVisible(visible: boolean): void {
    this.object3d.visible = visible
  }

  /** 使文字面向相机（billboard） */
  update(camera: THREE.Camera): void {
    this.object3d.quaternion.copy(camera.quaternion)
  }

  dispose(): void {
    try {
      ;(this.textMesh as any).dispose?.()
    } catch {
      // ignore
    }
    try {
      const m = (this.textMesh as any).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.())
      else m?.dispose?.()
    } catch {
      // ignore
    }
    try {
      ;(this.textMesh as any).geometry?.dispose?.()
    } catch {
      // ignore
    }
    this.object3d.removeFromParent()
  }
}
