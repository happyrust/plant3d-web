/**
 * K05：`/api/v1/ws` 任务流（增量更新案例集合 K 组，gen-model `docs/plans/2026-10-27-plant3d-web-incremental-linkage-test-cases.md`）。
 * 模块级单例，每条用例重新 import 一份；WebSocket 换成可控的假连接，close 事件和浏览器一样异步派发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiBase = vi.hoisted(() => ({ base: 'http://127.0.0.1:9199' }));

vi.mock('@/utils/apiBase', () => ({
  buildGenModelV1Url: (path: string) => `${apiBase.base}${path}`,
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /** 客户端主动关：和浏览器一样，close 事件异步派发 */
  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    void Promise.resolve().then(() => this.onclose?.());
  }

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverSend(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }

  /** 服务端断开或握手失败 */
  serverDrop(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

async function loadFeed() {
  vi.resetModules();
  return import('./useGenModelV1TaskFeed');
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function lastSocket(): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error('还没建连接');
  return ws;
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  apiBase.base = 'http://127.0.0.1:9199';
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('K05 useGenModelV1TaskFeed', () => {
  it('第一个订阅者拉起连接：open 后 live 并显式订阅 tasks；第二个订阅者不再建连接', async () => {
    const feed = await loadFeed();
    const { feedStatus } = feed.useGenModelV1TaskFeed();
    expect(feedStatus.value).toBe('idle');

    feed.subscribeGenModelV1TaskEvents(() => undefined);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(lastSocket().url).toBe('ws://127.0.0.1:9199/api/v1/ws');
    expect(feedStatus.value).toBe('connecting');

    lastSocket().serverOpen();
    expect(feedStatus.value).toBe('live');
    expect(JSON.parse(lastSocket().sent[0]!)).toEqual({ type: 'subscribe', topics: ['tasks'] });

    feed.subscribeGenModelV1TaskEvents(() => undefined);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('信封原样转给每个订阅者；非字符串 / 坏 JSON / 没有 type 的帧丢掉；一个订阅者抛错不影响别人', async () => {
    const feed = await loadFeed();
    const first: unknown[] = [];
    const second: unknown[] = [];
    feed.subscribeGenModelV1TaskEvents((envelope) => {
      first.push(envelope);
      throw new Error('订阅者自己的错');
    });
    feed.subscribeGenModelV1TaskEvents((envelope) => second.push(envelope));
    const ws = lastSocket();
    ws.serverOpen();

    ws.serverSend({ type: 'task_finished', seq: 1, task_id: 'db-1', payload: { state: 'succeeded' } });
    ws.serverSend('不是 JSON');
    ws.serverSend({ seq: 2 });
    ws.onmessage?.({ data: new ArrayBuffer(4) });

    expect(first).toEqual([{ type: 'task_finished', seq: 1, task_id: 'db-1', payload: { state: 'succeeded' } }]);
    expect(second).toEqual(first);
  });

  it('seq 空洞计入 missedEvents；乱序的旧号不计；重连后从头计号', async () => {
    const feed = await loadFeed();
    const { missedEvents } = feed.useGenModelV1TaskFeed();
    feed.subscribeGenModelV1TaskEvents(() => undefined);
    lastSocket().serverOpen();
    for (const seq of [1, 2, 5, 4, 6]) lastSocket().serverSend({ type: 'task_progress', seq });
    expect(missedEvents.value).toBe(2);

    lastSocket().serverDrop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().serverOpen();
    lastSocket().serverSend({ type: 'task_progress', seq: 1 });
    expect(missedEvents.value).toBe(2);
  });

  it('连着时每 25 s 发一次 ping', async () => {
    const feed = await loadFeed();
    feed.subscribeGenModelV1TaskEvents(() => undefined);
    const ws = lastSocket();
    ws.serverOpen();
    expect(ws.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(ws.sent).toHaveLength(2);
    expect(JSON.parse(ws.sent[1]!)).toEqual({ type: 'ping' });
  });

  it('服务端断开 → down，3 s 后重连，连上又是 live', async () => {
    const feed = await loadFeed();
    const { feedStatus } = feed.useGenModelV1TaskFeed();
    feed.subscribeGenModelV1TaskEvents(() => undefined);
    lastSocket().serverOpen();
    lastSocket().serverDrop();
    expect(feedStatus.value).toBe('down');

    await vi.advanceTimersByTimeAsync(2_999);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().serverOpen();
    expect(feedStatus.value).toBe('live');
  });

  it('握手连败 5 次就停在 down 不再重试；显式 connect 重新计数、立刻再连', async () => {
    const feed = await loadFeed();
    const { feedStatus } = feed.useGenModelV1TaskFeed();
    feed.subscribeGenModelV1TaskEvents(() => undefined);
    for (let i = 0; i < 5; i += 1) {
      lastSocket().serverDrop();
      await vi.advanceTimersByTimeAsync(3_000);
    }
    expect(FakeWebSocket.instances).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(5);
    expect(feedStatus.value).toBe('down');

    feed.connectGenModelV1TaskFeed();
    expect(FakeWebSocket.instances).toHaveLength(6);
    expect(feedStatus.value).toBe('connecting');
  });

  it('最后一个订阅者退订：关连接、回到 idle、清 missedEvents；迟到的 close 不把状态改成 down，也不重连', async () => {
    const feed = await loadFeed();
    const { feedStatus, missedEvents } = feed.useGenModelV1TaskFeed();
    const off = feed.subscribeGenModelV1TaskEvents(() => undefined);
    const ws = lastSocket();
    ws.serverOpen();
    ws.serverSend({ type: 'task_progress', seq: 1 });
    ws.serverSend({ type: 'task_progress', seq: 4 });
    expect(missedEvents.value).toBe(2);

    off();
    expect(feedStatus.value).toBe('idle');
    expect(missedEvents.value).toBe(0);
    await flushMicrotasks();
    expect(feedStatus.value).toBe('idle');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('退订后马上又有人订阅：旧连接迟到的 close 不干扰新连接', async () => {
    const feed = await loadFeed();
    const { feedStatus } = feed.useGenModelV1TaskFeed();
    const off = feed.subscribeGenModelV1TaskEvents(() => undefined);
    lastSocket().serverOpen();
    off();
    feed.subscribeGenModelV1TaskEvents(() => undefined);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(feedStatus.value).toBe('connecting');
    await flushMicrotasks();
    expect(feedStatus.value).toBe('connecting');
    lastSocket().serverOpen();
    expect(feedStatus.value).toBe('live');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('旧连接在 CLOSING 期间被新连接取代后，残留消息不改 seq', async () => {
    const feed = await loadFeed();
    const { feedStatus, missedEvents } = feed.useGenModelV1TaskFeed();
    const received: number[] = [];
    feed.subscribeGenModelV1TaskEvents((envelope) => { received.push(envelope.seq ?? -1); });
    const ws1 = lastSocket();
    ws1.serverOpen();
    ws1.serverSend({ type: 'task_progress', seq: 1 });

    // 服务端发起关闭：ws1 进入 CLOSING、close 事件还没派发；此时新任务登记触发显式 connect，ws2 接手
    ws1.readyState = FakeWebSocket.CLOSING;
    feed.connectGenModelV1TaskFeed();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws2 = lastSocket();
    expect(ws2).not.toBe(ws1);
    expect(feedStatus.value).toBe('connecting');
    ws2.serverOpen();
    expect(feedStatus.value).toBe('live');
    ws2.serverSend({ type: 'task_progress', seq: 1 });

    // ws1 的残留帧：不改 lastSeq、不增 missedEvents、不转给订阅方
    ws1.serverSend({ type: 'task_progress', seq: 999 });
    expect(missedEvents.value).toBe(0);
    expect(received).toEqual([1, 1]);

    // ws2 继续按自己的号计：999 没被当成已见—— 2 之后直接来 4，空洞正好 1 个
    ws2.serverSend({ type: 'task_progress', seq: 2 });
    ws2.serverSend({ type: 'task_progress', seq: 4 });
    expect(missedEvents.value).toBe(1);

    // ws1 迟到的 close 不改状态、不重连；ping 定时器只剩 ws2 那一个（ws1 的在被顶替时已停）
    ws1.serverDrop();
    expect(feedStatus.value).toBe('live');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('genModelV1WsUrl：http → ws、https → wss，同源相对路径按页面 origin 补全', async () => {
    const feed = await loadFeed();
    apiBase.base = 'https://gm.example.com';
    expect(feed.genModelV1WsUrl()).toBe('wss://gm.example.com/api/v1/ws');
    apiBase.base = '/gm';
    const origin = new URL(window.location.origin);
    origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    expect(feed.genModelV1WsUrl()).toBe(`${origin.toString().replace(/\/$/, '')}/gm/api/v1/ws`);
  });
});
