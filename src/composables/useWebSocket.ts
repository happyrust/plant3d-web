// WebSocket 连接管理 composable
import { ref, onUnmounted, type Ref } from 'vue';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type UseWebSocketOptions = {
  /** 自动重连 */
  autoReconnect?: boolean;
  /** 最大重连次数 */
  maxReconnectAttempts?: number;
  /** 重连延迟（毫秒） */
  reconnectDelay?: number;
  /** 连接成功回调 */
  onConnected?: () => void;
  /** 断开连接回调 */
  onDisconnected?: () => void;
  /** 收到消息回调 */
  onMessage?: (data: unknown) => void;
  /** 错误回调 */
  onError?: (error: Event) => void;
};

export type UseWebSocketReturn = {
  /** WebSocket 连接状态 */
  status: Ref<WebSocketStatus>;
  /** 是否已连接 */
  isConnected: Ref<boolean>;
  /** 最后收到的消息 */
  lastMessage: Ref<unknown>;
  /** 错误信息 */
  error: Ref<string | null>;
  /** 最后更新时间 */
  lastUpdateTime: Ref<string | null>;
  /** 重连次数 */
  reconnectCount: Ref<number>;
  /** 连接 */
  connect: () => void;
  /** 断开连接 */
  disconnect: () => void;
  /** 发送消息 */
  sendMessage: (data: unknown) => void;
};

const DEFAULT_OPTIONS: Required<UseWebSocketOptions> = {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 3000,
  onConnected: () => {},
  onDisconnected: () => {},
  onMessage: () => {},
  onError: () => {},
};

/**
 * WebSocket 连接管理 composable
 * @param url WebSocket URL
 * @param options 配置选项
 */
export function useWebSocket(
  url: string | Ref<string | null>,
  options: UseWebSocketOptions = {}
): UseWebSocketReturn {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const status = ref<WebSocketStatus>('disconnected');
  const isConnected = ref(false);
  const lastMessage = ref<unknown>(null);
  const error = ref<string | null>(null);
  const lastUpdateTime = ref<string | null>(null);
  const reconnectCount = ref(0);

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 获取 URL 字符串
   */
  function getUrl(): string | null {
    if (typeof url === 'string') return url;
    return url.value;
  }

  /**
   * 转换 HTTP URL 为 WebSocket URL
   */
  function toWebSocketUrl(httpUrl: string): string {
    try {
      const urlObj = new URL(httpUrl, window.location.origin);
      urlObj.protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
      return urlObj.toString();
    } catch {
      // 如果 URL 解析失败，尝试简单替换
      return httpUrl.replace(/^http/, 'ws');
    }
  }

  /**
   * 建立 WebSocket 连接
   */
  function connect() {
    const wsUrl = getUrl();
    if (!wsUrl) {
      error.value = 'WebSocket URL 未设置';
      return;
    }

    // 如果已经连接，先断开
    if (ws) {
      disconnect();
    }

    // 清除重连定时器
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    status.value = 'connecting';
    error.value = null;

    try {
      // 确保是 WebSocket URL
      const finalUrl = wsUrl.startsWith('ws') ? wsUrl : toWebSocketUrl(wsUrl);
      ws = new WebSocket(finalUrl);

      ws.onopen = () => {
        status.value = 'connected';
        isConnected.value = true;
        error.value = null;
        reconnectCount.value = 0;
        lastUpdateTime.value = new Date().toISOString();
        opts.onConnected();
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          lastMessage.value = data;
          lastUpdateTime.value = new Date().toISOString();
          opts.onMessage(data);
        } catch (e) {
          // 如果不是 JSON，直接存储原始数据
          lastMessage.value = event.data;
          lastUpdateTime.value = new Date().toISOString();
          opts.onMessage(event.data);
        }
      };

      ws.onerror = (event: Event) => {
        status.value = 'error';
        error.value = 'WebSocket 连接错误';
        opts.onError(event);
      };

      ws.onclose = () => {
        status.value = 'disconnected';
        isConnected.value = false;
        ws = null;
        opts.onDisconnected();

        // 自动重连
        if (opts.autoReconnect && reconnectCount.value < opts.maxReconnectAttempts) {
          reconnectCount.value++;
          error.value = `连接断开，${opts.reconnectDelay / 1000}秒后重试 (${reconnectCount.value}/${opts.maxReconnectAttempts})`;
          reconnectTimer = setTimeout(() => {
            connect();
          }, opts.reconnectDelay);
        } else if (reconnectCount.value >= opts.maxReconnectAttempts) {
          error.value = '已达到最大重连次数，请手动重连';
        }
      };
    } catch (e) {
      status.value = 'error';
      error.value = `WebSocket 创建失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * 断开 WebSocket 连接
   */
  function disconnect() {
    // 清除重连定时器
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // 重置重连计数
    reconnectCount.value = 0;

    if (ws) {
      // 先移除事件监听，避免触发自动重连
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onopen = null;

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      ws = null;
    }

    status.value = 'disconnected';
    isConnected.value = false;
  }

  /**
   * 发送消息
   */
  function sendMessage(data: unknown) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      error.value = 'WebSocket 未连接';
      return;
    }

    try {
      const message = typeof data === 'string' ? data : JSON.stringify(data);
      ws.send(message);
    } catch (e) {
      error.value = `发送消息失败: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // 组件卸载时断开连接
  onUnmounted(() => {
    disconnect();
  });

  return {
    status,
    isConnected,
    lastMessage,
    error,
    lastUpdateTime,
    reconnectCount,
    connect,
    disconnect,
    sendMessage,
  };
}
