/**
 * DynamicPivotController - 动态 Pivot 点控制器
 *
 * 功能：
 * 1. 鼠标长按触发：鼠标按下并保持 300ms 后，找到鼠标与 mesh 的交点作为 pivot 点
 * 2. 变换中心：所有平移、旋转、缩放操作都围绕这个 pivot 点进行
 */

import { Vector2, Vector3 } from 'three';

import type { DTXLayer } from './DTXLayer';
import type { DTXSelectionController } from './selection/DTXSelectionController';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type DynamicPivotConfig = {
  /** 是否启用动态 pivot */
  enabled?: boolean
  /** 长按触发时间（毫秒，默认 300） */
  longPressDelay?: number
}

export class DynamicPivotController {
  private controls: OrbitControls;
  private selectionController: DTXSelectionController;
  private dtxLayer: DTXLayer;
  private config: Required<DynamicPivotConfig>;

  private currentPivot: Vector3 | null = null;
  private isMouseDown = false;
  private mouseDownPos: Vector2 | null = null;
  private longPressTimer: number | null = null;

  constructor(
    controls: OrbitControls,
    selectionController: DTXSelectionController,
    dtxLayer: DTXLayer,
    config: DynamicPivotConfig = {}
  ) {
    this.controls = controls;
    this.selectionController = selectionController;
    this.dtxLayer = dtxLayer;

    this.config = {
      enabled: config.enabled ?? true,
      longPressDelay: config.longPressDelay ?? 300,
    };
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
   * 清除 pivot 点
   */
  clearPivot(): void {
    this.currentPivot = null;
  }

  /**
   * 获取当前 pivot 点
   */
  getCurrentPivot(): Vector3 | null {
    return this.currentPivot;
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
    // 预留用于动画或其他更新逻辑
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.cancelLongPress();
    this.currentPivot = null;
    this.mouseDownPos = null;
    this.isMouseDown = false;
  }
}
