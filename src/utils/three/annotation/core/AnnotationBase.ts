/**
 * 三维标注基类
 *
 * 提供：
 * - 缩放独立算法（标注在屏幕上保持恒定尺寸）
 * - 高亮状态管理
 * - 资源释放
 */

import * as THREE from 'three'
import type { AnnotationMaterials, AnnotationMaterialSet } from './AnnotationMaterials'

export interface AnnotationOptions {
  /** 是否启用缩放独立（默认 true） */
  scaleIndependent?: boolean
  /** 深度测试（默认 true） */
  depthTest?: boolean
}

export abstract class AnnotationBase extends THREE.Object3D {
  protected materials: AnnotationMaterials
  protected options: AnnotationOptions
  protected _highlighted = false

  // 缓存向量，避免每帧分配
  protected readonly _worldPosition = new THREE.Vector3()
  protected readonly _eye = new THREE.Vector3()
  protected readonly _worldScale = new THREE.Vector3()
  private _lastScaleFactor = 1
  private readonly _ownedMaterials: THREE.Material[] = []

  constructor(materials: AnnotationMaterials, options?: AnnotationOptions) {
    super()
    this.materials = materials
    this.options = {
      scaleIndependent: true,
      depthTest: true,
      ...options,
    }
    this.renderOrder = 900
  }

  /** 每帧更新，由渲染循环调用 */
  update(camera: THREE.Camera): void {
    this.getWorldPosition(this._worldPosition)
    this._eye.copy(camera.position).sub(this._worldPosition).normalize()

    if (this.shouldRescaleOnZoom) {
      // scaleIndependentOfZoom 返回的是“世界空间”尺度；若父级存在缩放（如 globalModelMatrix=0.001），
      // 需要换算到本地缩放系数，避免标注装饰件/文字被全局缩放压扁。
      const worldFactor = this.scaleIndependentOfZoom(camera, this._worldPosition)
      let localFactor = worldFactor
      try {
        this.getWorldScale(this._worldScale)
        const s = (Math.abs(this._worldScale.x) + Math.abs(this._worldScale.y) + Math.abs(this._worldScale.z)) / 3
        if (Number.isFinite(s) && s > 1e-9) {
          localFactor = worldFactor / s
        }
      } catch {
        // ignore
      }

      if (localFactor !== this._lastScaleFactor) {
        this._lastScaleFactor = localFactor
        this.onScaleFactorChanged(localFactor)
      }
    }
  }

  /** 是否需要缩放独立 */
  get shouldRescaleOnZoom(): boolean {
    return this.options.scaleIndependent ?? true
  }

  /**
   * 缩放独立算法（参考 Plasticity src/util/Helpers.ts）
   *
   * 使标注在屏幕上保持恒定尺寸，不随相机缩放而变化
   */
  protected scaleIndependentOfZoom(camera: THREE.Camera, worldPosition: THREE.Vector3): number {
    let factor: number

    const orthoCamera = camera as THREE.OrthographicCamera
    const perspCamera = camera as THREE.PerspectiveCamera

    if (orthoCamera.isOrthographicCamera) {
      factor = (orthoCamera.top - orthoCamera.bottom) / orthoCamera.zoom
    } else if (perspCamera.isPerspectiveCamera) {
      factor = worldPosition.distanceTo(camera.position)
        * Math.min(1.9 * Math.tan(Math.PI * perspCamera.fov / 360), 7)
    } else {
      factor = 1
    }

    factor *= 1 / 11
    return factor
  }

  /**
   * 当缩放独立系数变化时触发（默认无操作）。
   *
   * 注意：不要在这里缩放“承载绝对坐标”的根对象（否则会导致端点/长度漂移），
   * 建议仅缩放箭头/端点装饰等“以 position 定位”的子对象。
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected onScaleFactorChanged(factor: number): void {}

  /**
   * 按实例解析材质集。
   *
   * - depthTest=true：复用共享材质（由 AnnotationMaterials 统一释放）
   * - depthTest=false：克隆一份“仅此标注使用”的材质，避免影响其它标注
   */
  protected resolveMaterialSet(base: AnnotationMaterialSet): AnnotationMaterialSet {
    const depthTest = this.options.depthTest ?? true
    if (depthTest) return base

    const line = base.line.clone()
    const lineHover = base.lineHover.clone()
    const mesh = base.mesh.clone()
    const meshHover = base.meshHover.clone()

    // 关闭深度测试/写入：实现“始终在最上层”效果
    for (const m of [line, lineHover, mesh, meshHover]) {
      m.depthTest = false
      m.depthWrite = false
      // 关闭 polygonOffset，避免与深度相关的偏移逻辑干扰
      ;(m as any).polygonOffset = false
    }

    this._ownedMaterials.push(line, lineHover, mesh, meshHover)
    return {
      line: line as any,
      lineHover: lineHover as any,
      mesh: mesh as any,
      meshHover: meshHover as any,
    }
  }

  /** 高亮状态 */
  get highlighted(): boolean {
    return this._highlighted
  }

  set highlighted(value: boolean) {
    if (this._highlighted === value) return
    this._highlighted = value
    this.onHighlightChanged(value)
  }

  /** 子类实现：高亮状态变化时的处理 */
  protected abstract onHighlightChanged(highlighted: boolean): void

  /** 释放资源 */
  dispose(): void {
    // 注意：标注系统中材质通常由 AnnotationMaterials 统一复用并集中释放；
    // 部分几何体也可能为共享（例如箭头几何）。若在基类中遍历 dispose，
    // 容易误释放“仍在使用”的共享资源，导致后续渲染异常。
    //
    // 因此此处只做“从场景树移除”，具体资源（动态 LineGeometry / DOM 等）
    // 由各标注子类在 override dispose() 中自行释放，材质由 AnnotationMaterials.dispose() 统一释放。
    for (const m of this._ownedMaterials) {
      try {
        m.dispose()
      } catch {
        // ignore
      }
    }
    this._ownedMaterials.length = 0
    this.removeFromParent()
  }
}
