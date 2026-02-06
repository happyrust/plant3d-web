/**
 * 标注交互控制器
 *
 * 提供标注的交互功能：
 * - 点击选中
 * - 悬停高亮
 * - 拖拽编辑（可选）
 */

import * as THREE from 'three'
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'
import type { AnnotationBase } from './core/AnnotationBase'

export interface AnnotationInteractionOptions {
  /** 是否启用悬停高亮 */
  enableHover?: boolean
  /** 是否启用点击选中 */
  enableClick?: boolean
  /** 是否启用拖拽编辑 */
  enableDrag?: boolean
  /** 拾取精度（像素） */
  pickingTolerance?: number
}

export interface AnnotationHitResult {
  /** 命中的标注 */
  annotation: AnnotationBase
  /** 标注 ID */
  id: string
  /** 命中的子对象（用于区分拖拽角色） */
  hitObject: THREE.Object3D
  /** 命中点（世界坐标） */
  point: THREE.Vector3
  /** 距离相机的距离 */
  distance: number
}

export type AnnotationInteractionEvent = {
  type: 'hover' | 'click' | 'select' | 'deselect' | 'drag-start' | 'drag' | 'drag-end'
  annotation: AnnotationBase | null
  id: string | null
  originalEvent?: MouseEvent
  point?: THREE.Vector3
  hitObject?: THREE.Object3D
}

export type AnnotationInteractionCallback = (event: AnnotationInteractionEvent) => void

export class AnnotationInteractionController {
  private annotations: Map<string, AnnotationBase>
  private camera: THREE.Camera | null = null
  private domElement: HTMLElement | null = null
  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()

  private options: Required<AnnotationInteractionOptions>
  private callbacks: AnnotationInteractionCallback[] = []

  // 为拖拽提供“全局 mouseup/move”兜底：避免鼠标移出 canvas 松手导致卡死。
  // (runtime 可被测试通过 (as any) 读取)
  private windowDragAttached = false

  // 状态
  private _hoveredId = ref<string | null>(null)
  private _selectedId = ref<string | null>(null)
  private _isDragging = ref(false)

  // 拖拽状态
  private dragStartPoint: THREE.Vector3 | null = null
  private dragAnnotation: AnnotationBase | null = null
  private dragAnnotationId: string | null = null

  constructor(
    annotations: Map<string, AnnotationBase>,
    options: AnnotationInteractionOptions = {}
  ) {
    this.annotations = annotations
    this.options = {
      enableHover: options.enableHover ?? true,
      enableClick: options.enableClick ?? true,
      enableDrag: options.enableDrag ?? false,
      pickingTolerance: options.pickingTolerance ?? 10,
    }

    // 绑定事件处理器
    this.onMouseMove = this.onMouseMove.bind(this)
    this.onMouseDown = this.onMouseDown.bind(this)
    this.onMouseUp = this.onMouseUp.bind(this)
    this.onClick = this.onClick.bind(this)
  }

  private attachWindowDragListeners(): void {
    if (this.windowDragAttached) return
    this.windowDragAttached = true
    // 拖拽中依赖 mousemove 发 drag 事件；mouseup 结束拖拽并恢复 controls
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
  }

  private detachWindowDragListeners(): void {
    if (!this.windowDragAttached) return
    this.windowDragAttached = false
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
  }

  /** 当前悬停的标注 ID */
  get hoveredId(): Ref<string | null> {
    return this._hoveredId
  }

  /** 当前选中的标注 ID */
  get selectedId(): Ref<string | null> {
    return this._selectedId
  }

  /** 是否正在拖拽 */
  get isDragging(): Ref<boolean> {
    return this._isDragging
  }

  /** 设置相机 */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera
  }

  /** 更新标注集合引用 */
  setAnnotations(annotations: Map<string, AnnotationBase>): void {
    this.annotations = annotations
  }

  /** 附加到 DOM 元素 */
  attach(domElement: HTMLElement): void {
    this.detach()
    this.domElement = domElement

    if (this.options.enableHover) {
      domElement.addEventListener('mousemove', this.onMouseMove)
    }
    if (this.options.enableClick) {
      domElement.addEventListener('click', this.onClick)
    }
    if (this.options.enableDrag) {
      domElement.addEventListener('mousedown', this.onMouseDown)
      domElement.addEventListener('mouseup', this.onMouseUp)
    }
  }

  /** 从 DOM 元素分离 */
  detach(): void {
    // detach 时必须清理全局拖拽监听器，避免泄漏与“卡拖拽”状态
    this.detachWindowDragListeners()
    if (this.domElement) {
      this.domElement.removeEventListener('mousemove', this.onMouseMove)
      this.domElement.removeEventListener('click', this.onClick)
      this.domElement.removeEventListener('mousedown', this.onMouseDown)
      this.domElement.removeEventListener('mouseup', this.onMouseUp)
      this.domElement = null
    }
  }

  /** 添加事件监听器 */
  on(callback: AnnotationInteractionCallback): () => void {
    this.callbacks.push(callback)
    return () => {
      const index = this.callbacks.indexOf(callback)
      if (index >= 0) this.callbacks.splice(index, 1)
    }
  }

  /** 选中标注 */
  select(id: string | null): void {
    const prevId = this._selectedId.value
    if (prevId === id) return

    // 取消之前的选中
    if (prevId) {
      const prev = this.annotations.get(prevId)
      if (prev) prev.highlighted = false
      this.emit({ type: 'deselect', annotation: prev ?? null, id: prevId })
    }

    // 设置新的选中
    this._selectedId.value = id
    if (id) {
      const annotation = this.annotations.get(id)
      if (annotation) {
        annotation.highlighted = true
        this.emit({ type: 'select', annotation, id })
      }
    }
  }

  /** 清除选中 */
  clearSelection(): void {
    this.select(null)
  }

  /** 销毁 */
  dispose(): void {
    this.detach()
    this.callbacks = []
    this._hoveredId.value = null
    this._selectedId.value = null
    this._isDragging.value = false
  }

  private emit(event: AnnotationInteractionEvent): void {
    for (const callback of this.callbacks) {
      callback(event)
    }
  }

  private updateMousePosition(event: MouseEvent): void {
    if (!this.domElement) return
    const rect = this.domElement.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  }

  private hitTest(): AnnotationHitResult | null {
    if (!this.camera || this.annotations.size === 0) return null

    this.raycaster.setFromCamera(this.mouse, this.camera)

    // 设置拾取精度
    const prevThreshold = this.raycaster.params.Line?.threshold
    if (this.raycaster.params.Line) {
      this.raycaster.params.Line.threshold = this.options.pickingTolerance / 100
    }

    let closest: AnnotationHitResult | null = null

    for (const [id, annotation] of this.annotations) {
      if (!annotation.visible) continue
      const ud = (annotation as any).userData as any
      if (ud && (ud.pickable === false || ud.noPick === true)) continue

      const intersects = this.raycaster.intersectObject(annotation, true)
      if (intersects.length > 0) {
        let hit: THREE.Intersection<THREE.Object3D> | null = null
        for (const it of intersects) {
          const hud = (it.object as any)?.userData as any
          if (hud && (hud.noPick === true || hud.pickable === false)) continue
          hit = it as any
          break
        }
        if (!hit) continue
        if (!closest || hit.distance < closest.distance) {
          closest = {
            annotation,
            id,
            hitObject: hit.object,
            point: hit.point.clone(),
            distance: hit.distance,
          }
        }
      }
    }

    // 恢复精度
    if (this.raycaster.params.Line && prevThreshold !== undefined) {
      this.raycaster.params.Line.threshold = prevThreshold
    }

    return closest
  }

  private onMouseMove(event: MouseEvent): void {
    this.updateMousePosition(event)

    if (this._isDragging.value && this.dragAnnotation) {
      // 拖拽中
      const hit = this.hitTest()
      this.emit({
        type: 'drag',
        annotation: this.dragAnnotation,
        id: this.dragAnnotationId,
        originalEvent: event,
        point: hit?.point,
        hitObject: hit?.hitObject,
      })
      return
    }

    // 悬停检测
    const hit = this.hitTest()
    const prevHovered = this._hoveredId.value

    if (hit) {
      if (prevHovered !== hit.id) {
        // 取消之前的悬停
        if (prevHovered && prevHovered !== this._selectedId.value) {
          const prev = this.annotations.get(prevHovered)
          if (prev) prev.highlighted = false
        }

        // 设置新的悬停
        this._hoveredId.value = hit.id
        if (hit.id !== this._selectedId.value) {
          hit.annotation.highlighted = true
        }

        this.emit({
          type: 'hover',
          annotation: hit.annotation,
          id: hit.id,
          originalEvent: event,
          point: hit.point,
          hitObject: hit.hitObject,
        })
      }
    } else {
      // 清除悬停
      if (prevHovered) {
        if (prevHovered !== this._selectedId.value) {
          const prev = this.annotations.get(prevHovered)
          if (prev) prev.highlighted = false
        }
        this._hoveredId.value = null
        this.emit({ type: 'hover', annotation: null, id: null, originalEvent: event })
      }
    }
  }

  private onClick(event: MouseEvent): void {
    this.updateMousePosition(event)
    const hit = this.hitTest()

    if (hit) {
      this.select(hit.id)
      this.emit({
        type: 'click',
        annotation: hit.annotation,
        id: hit.id,
        originalEvent: event,
        point: hit.point,
        hitObject: hit.hitObject,
      })
    } else {
      // 点击空白区域取消选中
      this.select(null)
      this.emit({
        type: 'click',
        annotation: null,
        id: null,
        originalEvent: event,
      })
    }
  }

  private onMouseDown(event: MouseEvent): void {
    if (!this.options.enableDrag) return

    this.updateMousePosition(event)
    const hit = this.hitTest()

    if (hit && hit.id === this._selectedId.value) {
      const ud = (hit.annotation as any).userData as any
      if (!ud || ud.draggable !== true) return

      this._isDragging.value = true
      this.dragAnnotation = hit.annotation
      this.dragAnnotationId = hit.id
      this.dragStartPoint = hit.point.clone()
      // 绑定 window 级监听器：避免拖拽过程中鼠标移出 domElement 后无法收到 mouseup
      this.attachWindowDragListeners()

      this.emit({
        type: 'drag-start',
        annotation: hit.annotation,
        id: hit.id,
        originalEvent: event,
        point: hit.point,
        hitObject: hit.hitObject,
      })
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (this._isDragging.value && this.dragAnnotation) {
      this.emit({
        type: 'drag-end',
        annotation: this.dragAnnotation,
        id: this.dragAnnotationId,
        originalEvent: event,
      })

      this._isDragging.value = false
      this.dragAnnotation = null
      this.dragAnnotationId = null
      this.dragStartPoint = null
      this.detachWindowDragListeners()
    }
  }
}
