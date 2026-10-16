/**
 * gen-model `/api/v1/ws` 的任务事件订阅（web-service spec §5；plant-ui `model_update_ws.rs` /
 * ADR-0005 的浏览器端对应实现）。
 *
 * - 信封 `{type, seq, ts, task_id, payload}`；`seq` 在本连接内单调递增，相邻两号有空洞说明
 *   broadcast 滞后丢过帧（服务端 `SeqCounter::skip` 故意留的记号）——事件不回放，明细以 REST 为准。
 * - 连接建立后服务端默认已订阅 `tasks` 主题；仍显式发一遍 `subscribe` 对齐 spec 形态。
 * - 服务端 90s 空闲断开（spec §5.4 约定客户端 30s 内 ping 一次）；掉线自动重连，
 *   连续握手失败封顶后停在 `down`——REST 轮询本来就是兜底通道。
 */
import { ref, type Ref } from 'vue';

import { buildGenModelV1Url } from '@/utils/apiBase';

/** `task_progress` 信封的 payload（gen-model `ManualUpdateEvent`，serde `tag = "kind"`）。 */
export type GenModelV1TaskProgress =
  | { kind: 'data_batch_started'; dbnum: number; start_sesno: number; end_sesno: number }
  | { kind: 'data_batch_finished'; dbnum: number; success: boolean; message?: string | null }
  | { kind: 'model_unit_started'; dbnum: number; root_refno: string; noun: string }
  | { kind: 'model_unit_finished'; dbnum: number; root_refno: string; success: boolean; message?: string | null };

export type GenModelV1TaskEnvelope = {
  type: string;
  seq?: number;
  ts?: string;
  task_id?: string | null;
  payload?: unknown;
};

/** `idle` 未连 · `connecting` 握手 · `live` 已订阅在收事件 · `down` 断开（REST 轮询兜底）。 */
export type GenModelV1TaskFeedStatus = 'idle' | 'connecting' | 'live' | 'down';

const PING_INTERVAL_MS = 25_000;
const RECONNECT_DELAY_MS = 3_000;
/** 握手屡败（比如服务端旧到没有 /ws）不无限重试；下一次显式 `connect` 时重估可达性。 */
const MAX_CONNECT_FAILURES = 5;

const feedStatus: Ref<GenModelV1TaskFeedStatus> = ref('idle');
/** 因 seq 空洞确认丢掉的信封数；>0 时逐单元明细以 REST 读数为准。 */
const missedEvents = ref(0);

const listeners = new Set<(envelope: GenModelV1TaskEnvelope) => void>();

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectFailures = 0;
let lastSeq = 0;

/** `buildGenModelV1Url` 的 http(s)/同源相对路径 → ws(s)（`/gm` 代理与生产同源都走得到）。 */
export function genModelV1WsUrl(path = '/api/v1/ws'): string {
  const httpUrl = buildGenModelV1Url(path);
  try {
    const absolute = new URL(httpUrl, window.location.origin);
    absolute.protocol = absolute.protocol === 'https:' ? 'wss:' : 'ws:';
    return absolute.toString();
  } catch {
    return httpUrl.replace(/^http/i, 'ws');
  }
}

function stopTimers(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer || listeners.size === 0) return;
  if (connectFailures >= MAX_CONNECT_FAILURES) return; // 已停在 down，等显式重连
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, RECONNECT_DELAY_MS);
}

function openSocket(): void {
  if (typeof WebSocket === 'undefined') return;
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(genModelV1WsUrl());
  } catch {
    feedStatus.value = 'down';
    connectFailures += 1;
    return;
  }
  socket = ws;
  feedStatus.value = 'connecting';
  let opened = false;

  ws.onopen = () => {
    opened = true;
    connectFailures = 0;
    lastSeq = 0;
    feedStatus.value = 'live';
    ws.send(JSON.stringify({ type: 'subscribe', topics: ['tasks'] }));
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, PING_INTERVAL_MS);
  };
  ws.onmessage = (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let envelope: GenModelV1TaskEnvelope;
    try {
      envelope = JSON.parse(event.data) as GenModelV1TaskEnvelope;
    } catch {
      return;
    }
    if (!envelope || typeof envelope.type !== 'string') return;
    const seq = envelope.seq;
    if (typeof seq === 'number' && Number.isFinite(seq)) {
      if (lastSeq > 0 && seq > lastSeq + 1) missedEvents.value += seq - lastSeq - 1;
      if (seq > lastSeq) lastSeq = seq;
    }
    for (const listener of listeners) {
      try {
        listener(envelope);
      } catch {
        // 单个监听方的异常不能打断事件流
      }
    }
  };
  ws.onclose = () => {
    if (!opened) connectFailures += 1;
    if (socket === ws) socket = null;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    feedStatus.value = 'down';
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose 随后收口（置 down + 重连）
  };
}

/** 建立任务事件连接；外部显式调用（新任务登记）时重置握手失败计数，重估可达性。 */
export function connectGenModelV1TaskFeed(): void {
  connectFailures = 0;
  openSocket();
}

/**
 * 订阅 `tasks` 主题信封；第一个订阅者拉起连接，最后一个退订断开。返回退订函数。
 * 信封原样转发——task_id 归属、丢帧对齐（REST）都由订阅方自己处理。
 */
export function subscribeGenModelV1TaskEvents(
  listener: (envelope: GenModelV1TaskEnvelope) => void,
): () => void {
  listeners.add(listener);
  if (listeners.size === 1) connectGenModelV1TaskFeed();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopTimers();
      socket?.close();
      socket = null;
      feedStatus.value = 'idle';
      missedEvents.value = 0;
      lastSeq = 0;
    }
  };
}

export function useGenModelV1TaskFeed() {
  return {
    feedStatus,
    missedEvents,
    subscribeGenModelV1TaskEvents,
    connectGenModelV1TaskFeed,
  };
}
