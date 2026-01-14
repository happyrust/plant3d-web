/**
 * EventEmitter - 简单的事件发射器
 *
 * 提供基础的事件订阅和发布功能。
 */

export type EventCallback = (...args: any[]) => void;

export class EventEmitter {
  private _listeners: Map<string, Set<EventCallback>> = new Map();

  /**
   * 订阅事件
   */
  on(event: string, callback: EventCallback): this {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(callback);
    return this;
  }

  /**
   * 取消订阅
   */
  off(event: string, callback: EventCallback): this {
    const listeners = this._listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
    return this;
  }

  /**
   * 一次性订阅
   */
  once(event: string, callback: EventCallback): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      callback(...args);
    };
    return this.on(event, wrapper);
  }

  /**
   * 发射事件
   */
  emit(event: string, ...args: any[]): boolean {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }
    for (const callback of listeners) {
      callback(...args);
    }
    return true;
  }

  /**
   * 移除所有监听器
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }
}
