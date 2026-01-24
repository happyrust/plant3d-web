/**
 * DynamicPivotController - 动态 Pivot 点控制器
 *
 * 功能：
 * 1. 鼠标长按触发：鼠标按下并保持 300ms 后，找到鼠标与 mesh 的交点作为 pivot 点
 * 2. 视觉指示器：显示图钉样式的 gizmo 标记 pivot 点位置
 * 3. 变换中心：所有平移、旋转、缩放操作都围绕这个 pivot 点进行
 */

import { Vector2, Vector3, Scene, Sprite, SpriteMaterial, CanvasTexture } from 'three'
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DTXSelectionController } from './selection/DTXSelectionController'
import type { DTXLayer } from './DTXLayer'

export interface DynamicPivotConfig {
  /** 是否启用动态 pivot */
  enabled?: boolean
  /** 长按触发时间（毫秒，默认 300） */
  longPressDelay?: number
  /** 图钉颜色 */
  pinColor?: string
  /** 图钉大小（像素） */
  pinSize?: number
}

export class DynamicPivotController {
  private controls: OrbitControls
  private selectionController: DTXSelectionController
  private dtxLayer: DTXLayer
  private scene: Scene
  private config: Required<DynamicPivotConfig>

  private currentPivot: Vector3 | null = null
  private isMouseDown = false
  private mouseDownPos: Vector2 | null = null
  private longPressTimer: number | null = null

  // 图钉 Gizmo
  private pinSprite: Sprite | null = null
  private isPinVisible = false

  constructor(
    controls: OrbitControls,
    selectionController: DTXSelectionController,
    dtxLayer: DTXLayer,
    scene: Scene,
    config: DynamicPivotConfig = {}
  ) {
    this.controls = controls
    this.selectionController = selectionController
    this.dtxLayer = dtxLayer
    this.scene = scene

    this.config = {
      enabled: config.enabled ?? true,
      longPressDelay: config.longPressDelay ?? 300,
      pinColor: config.pinColor ?? '#FF6B35',
      pinSize: config.pinSize ?? 32,
    }

    this.createPinGizmo()
  }

  /**
   * 创建图钉 Gizmo
   */
  private createPinGizmo(): void {
    const canvas = document.createElement('canvas')
    const size = 128
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 绘制图钉形状
    ctx.clearRect(0, 0, size, size)

    // 图钉针尖（下方的尖）
    ctx.fillStyle = this.config.pinColor
    ctx.beginPath()
    ctx.moveTo(size / 2, size * 0.9) // 底部尖端
    ctx.lineTo(size / 2 - 8, size * 0.6) // 左侧
    ctx.lineTo(size / 2 + 8, size * 0.6) // 右侧
    ctx.closePath()
    ctx.fill()

    // 图钉头部（圆形）
    ctx.beginPath()
    ctx.arc(size / 2, size * 0.35, size * 0.25, 0, Math.PI * 2)
    ctx.fillStyle = this.config.pinColor
    ctx.fill()

    // 添加高光效果
    ctx.beginPath()
    ctx.arc(size / 2 - 8, size * 0.3, size * 0.1, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fill()

    // 添加阴影轮廓
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(size / 2, size * 0.35, size * 0.25, 0, Math.PI * 2)
    ctx.stroke()

    const texture = new CanvasTexture(canvas)
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    this.pinSprite = new Sprite(material)
    this.pinSprite.scale.set(this.config.pinSize / 10, this.config.pinSize / 10, 1)
    this.pinSprite.visible = false
    this.scene.add(this.pinSprite)
  }

  /**
   * 处理鼠标按下事件
   */
  handleMouseDown(mousePos: Vector2): void {
    if (!this.config.enabled) return
    
    this.isMouseDown = true
    this.mouseDownPos = mousePos.clone()
    
    // 启动长按计时器
    this.longPressTimer = window.setTimeout(() => {
      this.onLongPress(mousePos)
    }, this.config.longPressDelay)
  }

  /**
   * 处理鼠标移动事件
   */
  handleMouseMove(mousePos: Vector2): void {
    if (!this.isMouseDown || !this.mouseDownPos) return
    
    // 如果鼠标移动超过一定距离，取消长按
    const distance = mousePos.distanceTo(this.mouseDownPos)
    if (distance > 10) {
      this.cancelLongPress()
    }
  }

  /**
   * 处理鼠标释放事件
   */
  handleMouseUp(): void {
    this.isMouseDown = false
    this.mouseDownPos = null
    this.cancelLongPress()
  }

  /**
   * 长按触发
   */
  private onLongPress(mousePos: Vector2): void {
    this.longPressTimer = null
    
    // 使用 CPU 精确拾取获取表面交点
    const precisePick = this.selectionController.pickPoint(mousePos)
    if (!precisePick) {
      return
    }

    // 设置 pivot 点
    this.currentPivot = precisePick.point.clone()
    this.controls.target.copy(this.currentPivot)
    this.controls.update()

    // 显示图钉 Gizmo
    this.showPinGizmo(this.currentPivot)
  }

  /**
   * 取消长按
   */
  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer)
      this.longPressTimer = null
    }
  }

  /**
   * 显示图钉 Gizmo
   */
  private showPinGizmo(position: Vector3): void {
    if (!this.pinSprite) return
    
    this.pinSprite.position.copy(position)
    this.pinSprite.visible = true
    this.isPinVisible = true
  }

  /**
   * 隐藏图钉 Gizmo
   */
  private hidePinGizmo(): void {
    if (!this.pinSprite) return
    
    this.pinSprite.visible = false
    this.isPinVisible = false
  }

  /**
   * 清除 pivot 点
   */
  clearPivot(): void {
    this.currentPivot = null
    this.hidePinGizmo()
  }

  /**
   * 获取当前 pivot 点
   */
  getCurrentPivot(): Vector3 | null {
    return this.currentPivot
  }

  /**
   * 图钉是否可见
   */
  isPinGizmoVisible(): boolean {
    return this.isPinVisible
  }

  /**
   * 设置是否启用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled
    if (!enabled) {
      this.clearPivot()
      this.cancelLongPress()
    }
  }

  /**
   * 更新（每帧调用）
   */
  update(): void {
    // 预留用于动画或其他更新逻辑
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.cancelLongPress()
    
    if (this.pinSprite) {
      this.scene.remove(this.pinSprite)
      this.pinSprite.material.dispose()
      if (this.pinSprite.material.map) {
        this.pinSprite.material.map.dispose()
      }
      this.pinSprite = null
    }
    
    this.currentPivot = null
    this.mouseDownPos = null
    this.isMouseDown = false
  }
}
