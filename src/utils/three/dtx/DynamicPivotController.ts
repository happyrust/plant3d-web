/**
 * DynamicPivotController - 动态 Pivot 点控制器
 *
 * 功能：
 * 1. 鼠标长按触发：鼠标按下并保持 300ms 后，找到鼠标与 mesh 的交点作为 pivot 点
 * 2. 视觉指示器：显示图钉样式的 gizmo 标记 pivot 点位置
 * 3. 变换中心：所有平移、旋转、缩放操作都围绕这个 pivot 点进行
 */

import {
  Vector2,
  Vector3,
  Scene,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  PerspectiveCamera,
  OrthographicCamera,
} from 'three';

import type { DTXLayer } from './DTXLayer';
import type { DTXSelectionController } from './selection/DTXSelectionController';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type DynamicPivotConfig = {
  /** 是否启用动态 pivot */
  enabled?: boolean
  /** 长按触发时间（毫秒，默认 300） */
  longPressDelay?: number
  /** 图钉颜色 */
  pinColor?: string
  /** 图钉大小（像素） */
  pinSize?: number
  /** 图钉显隐变化时回调；宿主按需渲染时必须借此补一帧，否则图钉要等下一次相机变化才出现 / 消失 */
  onVisualChange?: () => void
}

export class DynamicPivotController {
  private controls: OrbitControls;
  private selectionController: DTXSelectionController;
  private dtxLayer: DTXLayer;
  private scene: Scene;
  private config: Required<DynamicPivotConfig>;

  private currentPivot: Vector3 | null = null;
  private isMouseDown = false;
  private mouseDownPos: Vector2 | null = null;
  private longPressTimer: number | null = null;

  // 图钉 Gizmo
  private pinSprite: Sprite | null = null;
  private isPinVisible = false;

  constructor(
    controls: OrbitControls,
    selectionController: DTXSelectionController,
    dtxLayer: DTXLayer,
    scene: Scene,
    config: DynamicPivotConfig = {}
  ) {
    this.controls = controls;
    this.selectionController = selectionController;
    this.dtxLayer = dtxLayer;
    this.scene = scene;

    this.config = {
      enabled: config.enabled ?? true,
      longPressDelay: config.longPressDelay ?? 300,
      pinColor: config.pinColor ?? '#FF6B35',
      pinSize: config.pinSize ?? 32,
      onVisualChange: config.onVisualChange ?? (() => {}),
    };

    this.createPinGizmo();
  }

  /**
   * 创建图钉 Gizmo
   */
  private createPinGizmo(): void {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 绘制图钉形状
    ctx.clearRect(0, 0, size, size);

    // 图钉针尖（下方的尖）
    ctx.fillStyle = this.config.pinColor;
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.9); // 底部尖端
    ctx.lineTo(size / 2 - 8, size * 0.6); // 左侧
    ctx.lineTo(size / 2 + 8, size * 0.6); // 右侧
    ctx.closePath();
    ctx.fill();

    // 图钉头部（圆形）
    ctx.beginPath();
    ctx.arc(size / 2, size * 0.35, size * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = this.config.pinColor;
    ctx.fill();

    // 添加高光效果
    ctx.beginPath();
    ctx.arc(size / 2 - 8, size * 0.3, size * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();

    // 添加阴影轮廓
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(size / 2, size * 0.35, size * 0.25, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.pinSprite = new Sprite(material);
    // 针尖画在贴图 y=0.9 处（Canvas 坐标向下），对应 sprite 局部坐标自底向上 0.1；
    // 把锚点放到针尖，这样 sprite.position 就是针尖真正"扎"在的拾取点。
    this.pinSprite.center.set(0.5, 0.1);
    this.pinSprite.renderOrder = 10_000;
    this.pinSprite.visible = false;
    this.scene.add(this.pinSprite);
  }

  /**
   * 按当前相机把 pinSize（屏幕像素）换算成 sprite 的世界缩放，
   * 图钉在屏幕上大小恒定，不随模型单位与相机远近放大成遮挡视口的大球。
   */
  private syncPinScale(): void {
    const sprite = this.pinSprite;
    if (!sprite || !sprite.visible) return;
    const camera = this.controls.object;
    const dom = this.controls.domElement as HTMLElement | null | undefined;
    const viewportHeight = Math.max(1, dom?.clientHeight ?? 0);
    let worldPerPixel = 0;
    if (camera instanceof PerspectiveCamera) {
      const dist = camera.position.distanceTo(sprite.position);
      const halfFovRad = (camera.fov * Math.PI) / 360;
      worldPerPixel = (2 * dist * Math.tan(halfFovRad)) / viewportHeight;
    } else if (camera instanceof OrthographicCamera) {
      worldPerPixel = (camera.top - camera.bottom) / camera.zoom / viewportHeight;
    }
    if (!(worldPerPixel > 0) || !Number.isFinite(worldPerPixel)) return;
    const s = this.config.pinSize * worldPerPixel;
    sprite.scale.set(s, s, 1);
  }

  /**
   * 处理鼠标按下事件
   */
  handleMouseDown(mousePos: Vector2): void {
    if (!this.config.enabled) return;
    
    this.isMouseDown = true;
    this.mouseDownPos = mousePos.clone();
    
    // 启动长按计时器
    this.longPressTimer = window.setTimeout(() => {
      this.onLongPress(mousePos);
    }, this.config.longPressDelay);
  }

  /**
   * 处理鼠标移动事件
   */
  handleMouseMove(mousePos: Vector2): void {
    if (!this.isMouseDown || !this.mouseDownPos) return;
    
    // 如果鼠标移动超过一定距离，取消长按
    const distance = mousePos.distanceTo(this.mouseDownPos);
    if (distance > 10) {
      this.cancelLongPress();
    }
  }

  /**
   * 处理鼠标释放事件
   */
  handleMouseUp(): void {
    this.isMouseDown = false;
    this.mouseDownPos = null;
    this.cancelLongPress();
    // 图钉只在长按拖拽期间提示 pivot 位置；松手后 pivot 仍作为轨道中心保留，图钉收起。
    this.hidePinGizmo();
  }

  /**
   * 长按触发
   */
  private onLongPress(mousePos: Vector2): void {
    this.longPressTimer = null;
    
    // 使用 CPU 精确拾取获取表面交点
    const precisePick = this.selectionController.pickPoint(mousePos);
    if (!precisePick) {
      return;
    }

    // 设置 pivot 点
    this.currentPivot = precisePick.point.clone();
    this.controls.target.copy(this.currentPivot);
    this.controls.update();

    // 显示图钉 Gizmo
    this.showPinGizmo(this.currentPivot);
  }

  /**
   * 取消长按
   */
  private cancelLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  /**
   * 显示图钉 Gizmo
   */
  private showPinGizmo(position: Vector3): void {
    if (!this.pinSprite) return;
    
    this.pinSprite.position.copy(position);
    this.pinSprite.visible = true;
    this.isPinVisible = true;
    this.syncPinScale();
    this.config.onVisualChange();
  }

  /**
   * 隐藏图钉 Gizmo
   */
  private hidePinGizmo(): void {
    if (!this.pinSprite || !this.pinSprite.visible) return;
    
    this.pinSprite.visible = false;
    this.isPinVisible = false;
    this.config.onVisualChange();
  }

  /**
   * 清除 pivot 点
   */
  clearPivot(): void {
    this.currentPivot = null;
    this.hidePinGizmo();
  }

  /**
   * 获取当前 pivot 点
   */
  getCurrentPivot(): Vector3 | null {
    return this.currentPivot;
  }

  /**
   * 图钉是否可见
   */
  isPinGizmoVisible(): boolean {
    return this.isPinVisible;
  }

  /**
   * 设置是否启用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (!enabled) {
      this.clearPivot();
      this.cancelLongPress();
    }
  }

  /**
   * 更新（每帧调用）
   */
  update(): void {
    // 相机距离变化时保持图钉屏幕像素大小恒定
    this.syncPinScale();
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.cancelLongPress();
    
    if (this.pinSprite) {
      this.scene.remove(this.pinSprite);
      this.pinSprite.material.dispose();
      if (this.pinSprite.material.map) {
        this.pinSprite.material.map.dispose();
      }
      this.pinSprite = null;
    }
    
    this.currentPivot = null;
    this.mouseDownPos = null;
    this.isMouseDown = false;
  }
}
