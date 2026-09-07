/**
 * gen-model `GET /api/v1/ws` 客户端（spec §5，plan P5）。
 *
 * - 信封 `{ type, seq, ts, task_id, payload }`；`seq` 连接内单调递增，出现空洞 = 慢消费者被跳帧，
 *   **事件不重放**，调用方该走 REST 对齐（`onGap`）；
 * - 客户端消息：`subscribe { topics }`（默认 `tasks`）、`ping`（每 30 s；服务端 90 s 无入站主动断开）；
 * - 断线指数退避重连（1 s → 30 s），`stop()` 之后不再重连；重连成功也回调 `onOpen`，调用方借此做一次 REST 对齐。
 *
 * 只做传输，不解释事件；`WebSocket` 实现可注入，便于测试。
 */
import { getGenModelV1BaseUrl } from '@/utils/apiBase';

export type GenModelV1WsEnvelope = {
  type: string;
  seq?: number;
  ts?: string;
  task_id?: string | null;
  payload?: unknown;
};

export type GenModelV1TaskSocketStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'stopped';

export type GenModelV1TaskSocketOptions = {
  /** 缺省 `getGenModelV1BaseUrl()` */
  baseUrl?: string;
  /** 缺省 `['tasks']` */
  topics?: string[];
  onEvent: (envelope: GenModelV1WsEnvelope) => void;
  /** 连接（含重连）建立并已发出 subscribe */
  onOpen?: (info: { reconnect: boolean }) => void;
  onStatus?: (status: GenModelV1TaskSocketStatus, detail?: unknown) => void;
  /** `seq` 出现空洞：`missed` 条事件没收到 */
  onGap?: (info: { expected: number; received: number; missed: number }) => void;
  pingIntervalMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** 测试注入 */
  WebSocketImpl?: typeof WebSocket;
  /** 测试注入：`window.location.origin` */
  locationOrigin?: string | null;
};

/** `http(s)://host[/prefix]` 或同源前缀 `/gm` → `ws(s)://host[/prefix]/api/v1/ws` */
export function toGenModelV1WsUrl(baseUrl: string, locationOrigin?: string | null, path = '/api/v1/ws'): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('/') || trimmed === '') {
    const origin = locationOrigin ?? (typeof window !== 'undefined' ? window.location?.origin : '') ?? '';
    const wsOrigin = origin.replace(/^http/i, 'ws');
    return `${wsOrigin}${trimmed}${path}`;
  }
  return `${trimmed.replace(/^http/i, 'ws')}${path}`;
}

export type GenModelV1TaskSocket = {
  start(): void;
  stop(): void;
  readonly status: GenModelV1TaskSocketStatus;
  /** 主动发一条（连接没开就丢弃并返回 false） */
  send(message: Record<string, unknown>): boolean;
};

export function createGenModelV1TaskSocket(options: GenModelV1TaskSocketOptions): GenModelV1TaskSocket {
  const topics = options.topics ?? ['tasks'];
  const pingIntervalMs = options.pingIntervalMs ?? 30_000;
  const reconnectMinMs = options.reconnectMinMs ?? 1_000;
  const reconnectMaxMs = options.reconnectMaxMs ?? 30_000;

  let status: GenModelV1TaskSocketStatus = 'idle';
  let socket: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let everOpened = false;
  let lastSeq: number | null = null;
  let stopped = false;

  function setStatus(next: GenModelV1TaskSocketStatus, detail?: unknown): void {
    status = next;
    options.onStatus?.(next, detail);
  }

  function clearTimers(): void {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function send(message: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== 1 /* OPEN */) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  function scheduleReconnect(reason: unknown): void {
    if (stopped) return;
    clearTimers();
    const delay = Math.min(reconnectMaxMs, reconnectMinMs * 2 ** Math.min(attempts, 10));
    attempts++;
    setStatus('closed', { reason, retryInMs: delay });
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect(): void {
    if (stopped) return;
    const Impl = options.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    if (!Impl) {
      setStatus('stopped', 'WebSocket 不可用');
      return;
    }
    const url = toGenModelV1WsUrl(options.baseUrl ?? getGenModelV1BaseUrl(), options.locationOrigin);
    setStatus('connecting', url);
    let ws: WebSocket;
    try {
      ws = new Impl(url);
    } catch (error) {
      scheduleReconnect(error);
      return;
    }
    socket = ws;
    lastSeq = null;

    ws.onopen = () => {
      if (socket !== ws) return;
      const reconnect = everOpened;
      everOpened = true;
      attempts = 0;
      setStatus('open');
      send({ type: 'subscribe', topics });
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        send({ type: 'ping' });
      }, pingIntervalMs);
      options.onOpen?.({ reconnect });
    };

    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws) return;
      let envelope: GenModelV1WsEnvelope;
      try {
        envelope = JSON.parse(String(event.data)) as GenModelV1WsEnvelope;
      } catch {
        return;
      }
      if (!envelope || typeof envelope.type !== 'string') return;
      if (typeof envelope.seq === 'number') {
        if (lastSeq !== null && envelope.seq > lastSeq + 1) {
          options.onGap?.({ expected: lastSeq + 1, received: envelope.seq, missed: envelope.seq - lastSeq - 1 });
        }
        lastSeq = Math.max(lastSeq ?? 0, envelope.seq);
      }
      if (envelope.type === 'pong') return;
      options.onEvent(envelope);
    };

    ws.onerror = (event: Event) => {
      if (socket !== ws) return;
      options.onStatus?.('closed', event);
    };

    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      scheduleReconnect({ code: event.code, reason: event.reason });
    };
  }

  return {
    get status() {
      return status;
    },
    send,
    start() {
      if (status === 'connecting' || status === 'open') return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimers();
      const ws = socket;
      socket = null;
      if (ws) {
        try {
          ws.close(1000, 'client stop');
        } catch {
          // ignore
        }
      }
      setStatus('stopped');
    },
  };
}
