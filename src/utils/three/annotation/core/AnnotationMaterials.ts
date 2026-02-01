/**
 * 三维标注材质管理
 *
 * 管理 Line2 和 Mesh 材质，支持正常/高亮状态切换
 * 需要每帧调用 setResolution() 更新 LineMaterial 分辨率
 */

import * as THREE from 'three'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

export interface AnnotationMaterialSet {
  line: LineMaterial
  lineHover: LineMaterial
  mesh: THREE.MeshBasicMaterial
  meshHover: THREE.MeshBasicMaterial
}

export class AnnotationMaterials {
  private resolution = new THREE.Vector2(1, 1)
  private lastDpr = 1

  // 预定义颜色集
  readonly green: AnnotationMaterialSet   // 尺寸标注
  readonly orange: AnnotationMaterialSet  // 焊缝标注
  readonly blue: AnnotationMaterialSet    // 坡度/引线标注
  readonly white: AnnotationMaterialSet   // 通用
  readonly yellow: AnnotationMaterialSet  // 高亮/默认

  constructor() {
    this.green = this.createMaterialSet(0x22c55e, 0x4ade80)
    this.orange = this.createMaterialSet(0xf97316, 0xfb923c)
    this.blue = this.createMaterialSet(0x3b82f6, 0x60a5fa)
    this.white = this.createMaterialSet(0xffffff, 0xffffff)
    this.yellow = this.createMaterialSet(0xfacc15, 0xfde047)
  }

  private createMaterialSet(normalColor: number, hoverColor: number): AnnotationMaterialSet {
    const depthParams = {
      depthTest: true,
      depthWrite: true,
      transparent: true,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }

    return {
      line: new LineMaterial({
        color: normalColor,
        linewidth: 2,
        resolution: this.resolution,
        ...depthParams,
      }),
      lineHover: new LineMaterial({
        color: hoverColor,
        linewidth: 3,
        resolution: this.resolution,
        ...depthParams,
      }),
      mesh: new THREE.MeshBasicMaterial({
        color: normalColor,
        opacity: 0.9,
        ...depthParams,
      }),
      meshHover: new THREE.MeshBasicMaterial({
        color: hoverColor,
        opacity: 1,
        ...depthParams,
      }),
    }
  }

  /** 每帧渲染前调用，更新 LineMaterial 分辨率 */
  setResolution(width: number, height: number): void {
    // LineMaterial.resolution 使用绘制缓冲区像素更稳；linewidth 也按 dpr 做同尺度缩放（与 useDtxTools 一致）。
    const dpr = Math.max(1, Number((window as any)?.devicePixelRatio) || 1)
    const w = Math.max(1, Math.floor(width * dpr))
    const h = Math.max(1, Math.floor(height * dpr))

    this.resolution.set(w, h)
    for (const set of this.all) {
      set.line.resolution.set(w, h)
      set.lineHover.resolution.set(w, h)

      // 仅在 dpr 变化时重设 linewidth，避免外部未来做自定义宽度时被每次覆盖
      if (dpr !== this.lastDpr) {
        set.line.linewidth = 2 * dpr
        set.lineHover.linewidth = 3 * dpr
      }
    }
    this.lastDpr = dpr
  }

  get all(): AnnotationMaterialSet[] {
    return [this.green, this.orange, this.blue, this.white, this.yellow]
  }

  dispose(): void {
    for (const set of this.all) {
      set.line.dispose()
      set.lineHover.dispose()
      set.mesh.dispose()
      set.meshHover.dispose()
    }
  }
}
