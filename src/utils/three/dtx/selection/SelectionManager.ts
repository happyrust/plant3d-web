/**
 * SelectionManager - 选中状态管理器
 *
 * 统一管理 DTX 渲染器中对象的选中和高亮状态。
 * 支持单选、多选、Ctrl+点击追加选中等交互模式。
 */

import { Color } from 'three';
import { EventEmitter } from './EventEmitter';

// ========== 类型定义 ==========

/**
 * 选中管理器配置
 */
export interface SelectionManagerOptions {
  /** 选中颜色 (默认橙色 #ff8800) */
  selectionColor?: Color | number | string;
  /** 高亮颜色 (悬停效果) */
  highlightColor?: Color | number | string;
  /** 是否允许多选 (默认 true) */
  multiSelect?: boolean;
}

/**
 * 选中变化事件数据
 */
export interface SelectionChangedEvent {
  /** 当前选中的对象 ID 列表 */
  selected: string[];
  /** 新增选中的对象 ID 列表 */
  added: string[];
  /** 取消选中的对象 ID 列表 */
  removed: string[];
}

/**
 * 颜色更新回调
 */
export type ColorUpdateCallback = (objectId: string, color: Color | null) => void;

// ========== SelectionManager 类 ==========

/**
 * 选中状态管理器
 */
export class SelectionManager extends EventEmitter {
  /** 当前选中的对象 ID 集合 */
  private _selected: Set<string> = new Set();
  /** 当前高亮的对象 ID */
  private _highlighted: string | null = null;
  /** 选中颜色 */
  private _selectionColor: Color;
  /** 高亮颜色 */
  private _highlightColor: Color;
  /** 是否允许多选 */
  private _multiSelect: boolean;
  /** 颜色更新回调 */
  private _onColorUpdate: ColorUpdateCallback | null = null;

  constructor(options: SelectionManagerOptions = {}) {
    super();

    this._selectionColor = this._toColor(options.selectionColor ?? 0xff8800);
    this._highlightColor = this._toColor(options.highlightColor ?? 0xffaa44);
    this._multiSelect = options.multiSelect ?? true;
  }

  /**
   * 设置颜色更新回调
   */
  setColorUpdateCallback(callback: ColorUpdateCallback): void {
    this._onColorUpdate = callback;
  }

  /**
   * 选中对象
   * @param objectIds 要选中的对象 ID (单个或数组)
   * @param additive 是否追加选中 (默认 false，会清除之前的选中)
   */
  select(objectIds: string | string[], additive: boolean = false): void {
    const ids = Array.isArray(objectIds) ? objectIds : [objectIds];
    const added: string[] = [];
    const removed: string[] = [];

    // 非追加模式，先清除之前的选中
    if (!additive) {
      for (const id of this._selected) {
        if (!ids.includes(id)) {
          removed.push(id);
          this._updateObjectColor(id, null);
        }
      }
      this._selected.clear();
    }

    // 添加新选中
    for (const id of ids) {
      if (!this._selected.has(id)) {
        if (this._multiSelect || this._selected.size === 0) {
          this._selected.add(id);
          added.push(id);
          this._updateObjectColor(id, this._selectionColor);
        }
      }
    }

    // 触发事件
    if (added.length > 0 || removed.length > 0) {
      this._emitSelectionChanged(added, removed);
    }
  }

  /**
   * 取消选中
   * @param objectIds 要取消选中的对象 ID (可选，不传则清空所有)
   */
  deselect(objectIds?: string | string[]): void {
    if (objectIds === undefined) {
      this.clearSelection();
      return;
    }

    const ids = Array.isArray(objectIds) ? objectIds : [objectIds];
    const removed: string[] = [];

    for (const id of ids) {
      if (this._selected.delete(id)) {
        removed.push(id);
        this._updateObjectColor(id, null);
      }
    }

    if (removed.length > 0) {
      this._emitSelectionChanged([], removed);
    }
  }

  /**
   * 切换选中状态
   */
  toggle(objectId: string): void {
    if (this._selected.has(objectId)) {
      this.deselect(objectId);
    } else {
      this.select(objectId, this._multiSelect);
    }
  }

  /**
   * 清空所有选中
   */
  clearSelection(): void {
    if (this._selected.size === 0) return;

    const removed = Array.from(this._selected);

    for (const id of removed) {
      this._updateObjectColor(id, null);
    }

    this._selected.clear();
    this._emitSelectionChanged([], removed);
  }

  /**
   * 获取当前选中的对象 ID 列表
   */
  getSelected(): string[] {
    return Array.from(this._selected);
  }

  /**
   * 检查对象是否被选中
   */
  isSelected(objectId: string): boolean {
    return this._selected.has(objectId);
  }

  /**
   * 获取选中数量
   */
  get selectedCount(): number {
    return this._selected.size;
  }

  /**
   * 高亮对象 (悬停效果)
   */
  highlight(objectId: string): void {
    if (this._highlighted === objectId) return;

    // 清除之前的高亮
    if (this._highlighted && !this._selected.has(this._highlighted)) {
      this._updateObjectColor(this._highlighted, null);
    }

    this._highlighted = objectId;

    // 如果对象未被选中，应用高亮颜色
    if (!this._selected.has(objectId)) {
      this._updateObjectColor(objectId, this._highlightColor);
    }

    this.emit('highlighted', { objectId });
  }

  /**
   * 清除高亮
   */
  clearHighlight(): void {
    if (!this._highlighted) return;

    const objectId = this._highlighted;
    this._highlighted = null;

    // 如果对象未被选中，恢复原色
    if (!this._selected.has(objectId)) {
      this._updateObjectColor(objectId, null);
    }

    this.emit('highlightCleared', { objectId });
  }

  /**
   * 获取当前高亮的对象 ID
   */
  getHighlighted(): string | null {
    return this._highlighted;
  }

  // ========== 配置方法 ==========

  /**
   * 设置选中颜色
   */
  setSelectionColor(color: Color | number | string): void {
    this._selectionColor = this._toColor(color);

    // 更新已选中对象的颜色
    for (const id of this._selected) {
      this._updateObjectColor(id, this._selectionColor);
    }
  }

  /**
   * 设置高亮颜色
   */
  setHighlightColor(color: Color | number | string): void {
    this._highlightColor = this._toColor(color);
  }

  /**
   * 设置是否允许多选
   */
  setMultiSelect(enabled: boolean): void {
    this._multiSelect = enabled;

    // 如果禁用多选且当前选中多个，只保留第一个
    if (!enabled && this._selected.size > 1) {
      const first = this._selected.values().next().value;
      const removed = Array.from(this._selected).filter(id => id !== first);

      for (const id of removed) {
        this._selected.delete(id);
        this._updateObjectColor(id, null);
      }

      this._emitSelectionChanged([], removed);
    }
  }

  /**
   * 获取选中颜色
   */
  getSelectionColor(): Color {
    return this._selectionColor.clone();
  }

  // ========== 私有方法 ==========

  /**
   * 转换为 Color 对象
   */
  private _toColor(color: Color | number | string): Color {
    if (color instanceof Color) {
      return color.clone();
    }
    return new Color(color);
  }

  /**
   * 更新对象颜色
   */
  private _updateObjectColor(objectId: string, color: Color | null): void {
    if (this._onColorUpdate) {
      this._onColorUpdate(objectId, color);
    }
  }

  /**
   * 触发选中变化事件
   */
  private _emitSelectionChanged(added: string[], removed: string[]): void {
    const event: SelectionChangedEvent = {
      selected: this.getSelected(),
      added,
      removed
    };
    this.emit('selectionChanged', event);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.clearSelection();
    this.clearHighlight();
    this._onColorUpdate = null;
    this.removeAllListeners();
  }
}
