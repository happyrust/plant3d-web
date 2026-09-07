import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGenModelV1TaskSocket, toGenModelV1WsUrl, type GenModelV1WsEnvelope } from './genModelV1Ws';

/** 最小假 WebSocket：记录发出的消息，测试手动触发 open / message / close。 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  drop(code = 1006, reason = 'lost'): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

describe('toGenModelV1WsUrl', () => {
  it('http(s) 绝对地址换协议并拼 /api/v1/ws；同源前缀用 location.origin', () => {
    expect(toGenModelV1WsUrl('http://localhost:8022')).toBe('ws://localhost:8022/api/v1/ws');
    expect(toGenModelV1WsUrl('https://gm.example.com/', null)).toBe('wss://gm.example.com/api/v1/ws');
    expect(toGenModelV1WsUrl('/gm', 'http://127.0.0.1:3101')).toBe('ws://127.0.0.1:3101/gm/api/v1/ws');
    expect(toGenModelV1WsUrl('', 'https://plant.example.com')).toBe('wss://plant.example.com/api/v1/ws');
  });
});

describe('createGenModelV1TaskSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(overrides: Partial<Parameters<typeof createGenModelV1TaskSocket>[0]> = {}) {
    const events: GenModelV1WsEnvelope[] = [];
    const opens: { reconnect: boolean }[] = [];
    const gaps: { expected: number; received: number; missed: number }[] = [];
    const statuses: string[] = [];
    const socket = createGenModelV1TaskSocket({
      baseUrl: 'http://gm.test:8022',
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      onEvent: (e) => events.push(e),
      onOpen: (info) => opens.push(info),
      onGap: (info) => gaps.push(info),
      onStatus: (s) => statuses.push(s),
      pingIntervalMs: 1000,
      reconnectMinMs: 100,
      reconnectMaxMs: 400,
      ...overrides,
    });
    return { socket, events, opens, gaps, statuses };
  }

  it('连上就 subscribe tasks，按周期 ping，pong 不进事件，其它事件原样交出', () => {
    const { socket, events, opens } = setup();
    socket.start();
    const ws = FakeWebSocket.instances[0]!;
    expect(ws.url).toBe('ws://gm.test:8022/api/v1/ws');
    expect(socket.status).toBe('connecting');

    ws.open();
    expect(socket.status).toBe('open');
    expect(opens).toEqual([{ reconnect: false }]);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'subscribe', topics: ['tasks'] });

    vi.advanceTimersByTime(2100);
    expect(ws.sent.filter((m) => JSON.parse(m).type === 'ping')).toHaveLength(2);

    ws.message({ type: 'pong', seq: 1 });
    ws.message({ type: 'task_finished', seq: 2, task_id: 'db-1', payload: { state: 'succeeded' } });
    ws.message('not json at all');
    expect(events).toEqual([{ type: 'task_finished', seq: 2, task_id: 'db-1', payload: { state: 'succeeded' } }]);
  });

  it('seq 出现空洞时回调 onGap（慢消费者被跳帧，事件不重放）', () => {
    const { socket, gaps } = setup();
    socket.start();
    const ws = FakeWebSocket.instances[0]!;
    ws.open();
    ws.message({ type: 'task_started', seq: 3 });
    ws.message({ type: 'task_progress', seq: 4 });
    ws.message({ type: 'task_finished', seq: 9 });
    expect(gaps).toEqual([{ expected: 5, received: 9, missed: 4 }]);
  });

  it('断线指数退避重连，重连成功 onOpen 标 reconnect=true；stop 之后不再重连', () => {
    const { socket, opens, statuses } = setup();
    socket.start();
    FakeWebSocket.instances[0]!.open();
    FakeWebSocket.instances[0]!.drop();
    expect(socket.status).toBe('closed');
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.drop();
    vi.advanceTimersByTime(150);
    expect(FakeWebSocket.instances).toHaveLength(2); // 第二次退避 200 ms，150 ms 时还没到
    vi.advanceTimersByTime(60);
    expect(FakeWebSocket.instances).toHaveLength(3);
    FakeWebSocket.instances[2]!.open();
    expect(opens).toEqual([{ reconnect: false }, { reconnect: true }]);

    socket.stop();
    expect(FakeWebSocket.instances[2]!.closed).toEqual({ code: 1000, reason: 'client stop' });
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances).toHaveLength(3);
    expect(statuses.at(-1)).toBe('stopped');
    expect(socket.send({ type: 'ping' })).toBe(false);
  });
});
