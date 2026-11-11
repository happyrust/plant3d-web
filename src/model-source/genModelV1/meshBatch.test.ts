import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createGenModelV1MeshBatcher,
  fetchMeshBatch,
  MESH_BATCH_STATUS,
  MeshBatchDecoder,
  MeshBatchFormatError,
  type MeshBatchFrame,
} from './meshBatch';

import { parseMeshGeometryResult } from '@/utils/parseMeshGeometry';

const FIXTURES = join(process.cwd(), 'src', 'fixtures');

function fileBytes(...parts: string[]): Uint8Array {
  const buf = readFileSync(join(FIXTURES, ...parts));
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const SAMPLE = fileBytes('mesh-batch', 'sample-batch.bin');
const MANIFEST = JSON.parse(readFileSync(join(FIXTURES, 'mesh-batch', 'sample-batch.json'), 'utf8')) as {
  request: { keys: string[] };
  frames: { status: number; key: string; payload_len: number; payload_sha256: string | null }[];
};

const sha256 = (bytes: ArrayBuffer | Uint8Array) => createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex');
const ceil8 = (n: number) => (n + 7) & ~7;

/** 照规范 §4.11.4 拼一段响应体（测试自己的编码器，与被测的解码器互相独立）。 */
function encodeBatch(
  frames: { status: number; key: string; payload?: Uint8Array }[],
  options: { declared?: number; trailer?: boolean; trailerCount?: number; magic?: string } = {},
): Uint8Array {
  const parts: Uint8Array[] = [];
  const head = new Uint8Array(8);
  head.set(new TextEncoder().encode(options.magic ?? 'PMB1'), 0);
  new DataView(head.buffer).setUint32(4, options.declared ?? frames.length, true);
  parts.push(head);
  for (const frame of frames) {
    const key = new TextEncoder().encode(frame.key);
    const payload = frame.payload ?? new Uint8Array(0);
    const bytes = new Uint8Array(8 + ceil8(key.length) + ceil8(payload.length));
    const view = new DataView(bytes.buffer);
    view.setUint8(0, frame.status);
    view.setUint8(1, key.length);
    view.setUint32(4, payload.length, true);
    bytes.set(key, 8);
    bytes.set(payload, 8 + ceil8(key.length));
    parts.push(bytes);
  }
  if (options.trailer !== false) {
    const tail = new Uint8Array(8);
    tail.set(new TextEncoder().encode('PMBE'), 0);
    new DataView(tail.buffer).setUint32(4, options.trailerCount ?? options.declared ?? frames.length, true);
    parts.push(tail);
  }
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function decodeAll(bytes: Uint8Array, chunkSizes?: number[]) {
  const frames: MeshBatchFrame[] = [];
  const decoder = new MeshBatchDecoder((frame) => frames.push(frame));
  if (!chunkSizes) {
    decoder.push(bytes);
  } else {
    let at = 0;
    for (let i = 0; at < bytes.length; i++) {
      const size = chunkSizes[i % chunkSizes.length]!;
      decoder.push(bytes.subarray(at, at + size));
      at += size;
    }
  }
  return { frames, end: decoder.end() };
}

describe('MeshBatchDecoder（规范 §4.11.4 的流式解码）', () => {
  it('后端录的样本：四帧、顺序与请求一致、状态与内容逐帧对得上清单', () => {
    const { frames, end } = decodeAll(SAMPLE);
    expect(end).toEqual({ declared: 4, frames: 4, complete: true });
    expect(frames.map((frame) => frame.key)).toEqual(MANIFEST.request.keys);
    expect(frames.map((frame) => frame.index)).toEqual([0, 1, 2, 3]);
    for (const [index, expected] of MANIFEST.frames.entries()) {
      const frame = frames[index]!;
      expect(frame.status).toBe(expected.status);
      expect(frame.payload?.byteLength ?? 0).toBe(expected.payload_len);
      if (expected.payload_sha256) expect(sha256(frame.payload!)).toBe(expected.payload_sha256);
      else expect(frame.payload).toBeNull();
    }
  });

  it('有内容的帧与单个路由给的文件逐字节相同，并且解得出几何', () => {
    const { frames } = decodeAll(SAMPLE);
    expect(sha256(frames[0]!.payload!)).toBe(sha256(fileBytes('meshes', '1.mesh')));
    expect(sha256(frames[3]!.payload!)).toBe(sha256(fileBytes('meshes', '3.mesh')));
    for (const frame of frames.filter((item) => item.status === MESH_BATCH_STATUS.FOUND)) {
      const parsed = parseMeshGeometryResult(frame.payload!, `batch:${frame.key}`);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.data.indices.length % 3).toBe(0);
    }
  });

  it.each([[[1]], [[7]], [[8, 3, 4096]], [[1024]], [[39_759, 1]]])('分块到达（块大小 %j）与整段到达结果相同', (sizes) => {
    const whole = decodeAll(SAMPLE);
    const chunked = decodeAll(SAMPLE, sizes);
    expect(chunked.end).toEqual(whole.end);
    expect(chunked.frames.map((frame) => [frame.index, frame.status, frame.key, frame.payload ? sha256(frame.payload) : null]))
      .toEqual(whole.frames.map((frame) => [frame.index, frame.status, frame.key, frame.payload ? sha256(frame.payload) : null]));
  });

  it('边收边拆：一帧的字节到齐就交出来，不等后面的帧', () => {
    const frames: MeshBatchFrame[] = [];
    const decoder = new MeshBatchDecoder((frame) => frames.push(frame));
    // 第 0 帧（键 "1"）在偏移 8..1096；流头 8 字节
    decoder.push(SAMPLE.subarray(0, 1095));
    expect(frames).toHaveLength(0);
    decoder.push(SAMPLE.subarray(1095, 1096));
    expect(frames.map((frame) => frame.key)).toEqual(['1']);
    // 第 1 帧（不存在的键，没有内容）到 1120
    decoder.push(SAMPLE.subarray(1096, 1120));
    expect(frames.map((frame) => frame.key)).toEqual(['1', 'no_such_mesh']);
    expect(decoder.end()).toEqual({ declared: 4, frames: 2, complete: false });
  });

  it('交出来的内容是自己的一份缓冲：不随后续数据块变化，可以直接交给解析器', () => {
    const chunk = SAMPLE.slice();
    const frames: MeshBatchFrame[] = [];
    const decoder = new MeshBatchDecoder((frame) => frames.push(frame));
    decoder.push(chunk);
    const before = sha256(frames[0]!.payload!);
    chunk.fill(0);
    expect(sha256(frames[0]!.payload!)).toBe(before);
    expect(frames[0]!.payload!.byteLength).toBe(1068);
  });

  it('没有流尾 = 中途断了：收全的帧可用，complete 为假', () => {
    const cut = decodeAll(SAMPLE.subarray(0, SAMPLE.length - 8));
    expect(cut.end).toEqual({ declared: 4, frames: 4, complete: false });
    const midFrame = decodeAll(SAMPLE.subarray(0, 20_000));
    expect(midFrame.end).toEqual({ declared: 4, frames: 3, complete: false });
    expect(midFrame.frames.map((frame) => frame.key)).toEqual(['1', 'no_such_mesh', '2']);
    expect(decodeAll(new Uint8Array(0)).end).toEqual({ declared: null, frames: 0, complete: false });
  });

  it('流尾的帧数对不上、流尾之后还有字节：不算完整', () => {
    const frames = [{ status: 0, key: 'a', payload: new Uint8Array([1, 2, 3]) }];
    expect(decodeAll(encodeBatch(frames, { trailerCount: 2 })).end.complete).toBe(false);
    const extra = new Uint8Array([...encodeBatch(frames), 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(decodeAll(extra).end.complete).toBe(false);
    expect(decodeAll(encodeBatch(frames)).end.complete).toBe(true);
  });

  it('不是这个格式（魔数不对、键长为 0、帧数超过上限）直接报格式错', () => {
    expect(() => decodeAll(encodeBatch([], { magic: 'PMB2' }))).toThrow(MeshBatchFormatError);
    expect(() => decodeAll(new TextEncoder().encode('<html>405 Not Allowed</html>'))).toThrow(MeshBatchFormatError);
    expect(() => decodeAll(encodeBatch([{ status: 0, key: '' }]))).toThrow(MeshBatchFormatError);
    expect(() => decodeAll(encodeBatch([], { declared: 100_000 }))).toThrow(MeshBatchFormatError);
  });

  it('状态 1 / 2 / 3 与认不得的状态原样交出，内容为空', () => {
    const { frames, end } = decodeAll(encodeBatch([
      { status: 0, key: 'a', payload: new Uint8Array([9]) },
      { status: 1, key: 'b' },
      { status: 2, key: 'c' },
      { status: 3, key: 'd' },
      { status: 9, key: 'e' },
    ]));
    expect(end.complete).toBe(true);
    expect(frames.map((frame) => [frame.key, frame.status, frame.payload?.byteLength ?? null]))
      .toEqual([['a', 0, 1], ['b', 1, null], ['c', 2, null], ['d', 3, null], ['e', 9, null]]);
  });
});

/** 把一段字节做成 `fetch` 的 200 响应，响应体按给定的块大小分块流出。 */
function streamResponse(bytes: Uint8Array, chunkSize = 4096, status = 200): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(at, at + chunkSize));
      at += chunkSize;
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'application/octet-stream' } });
}

function keysOf(init?: RequestInit): string[] {
  return (JSON.parse(String(init?.body ?? '{}')) as { keys: string[] }).keys;
}

const payloadFor = (key: string) => new TextEncoder().encode(`mesh:${key}`);

describe('fetchMeshBatch', () => {
  it('POST JSON 的 keys，响应流边到边交帧，读完回完整', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      expect(keysOf(init)).toEqual(MANIFEST.request.keys);
      return streamResponse(SAMPLE, 777);
    });
    const frames: MeshBatchFrame[] = [];
    const outcome = await fetchMeshBatch('/gm/api/v1/meshes/batch', MANIFEST.request.keys, (frame) => frames.push(frame), {
      fetchImpl: fetchImpl as never,
    });
    expect(outcome).toEqual({ kind: 'ok', complete: true, frames: 4 });
    expect(frames.map((frame) => frame.key)).toEqual(MANIFEST.request.keys);
    expect(fetchImpl).toHaveBeenCalledWith('/gm/api/v1/meshes/batch', expect.anything());
  });

  it.each([405, 404])('旧后端没有这条路由（%i）：回 unsupported，不当成错误', async (status) => {
    const outcome = await fetchMeshBatch('/x', ['a'], () => {}, {
      fetchImpl: (async () => new Response(null, { status })) as never,
    });
    expect(outcome).toEqual({ kind: 'unsupported', status });
  });

  it('400 / 413 等：请求不被接受', async () => {
    const outcome = await fetchMeshBatch('/x', ['a'], () => {}, {
      fetchImpl: (async () => new Response('{"code":"bad_request"}', { status: 400 })) as never,
    });
    expect(outcome).toEqual({ kind: 'rejected', status: 400 });
  });

  it('网络错、响应体不是这个格式：failed，带上已经交出的帧数', async () => {
    const network = await fetchMeshBatch('/x', ['a'], () => {}, {
      fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as never,
    });
    expect(network).toMatchObject({ kind: 'failed', frames: 0 });
    const html = await fetchMeshBatch('/x', ['a'], () => {}, {
      fetchImpl: (async () => new Response('<html>ok</html>', { status: 200 })) as never,
    });
    expect(html).toMatchObject({ kind: 'failed', frames: 0 });
  });

  it('响应头到了、之后一直没有数据：过了空闲时限就放弃，已交出的帧照算', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = (async (_url: string, init?: RequestInit) => {
        let sent = false;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(SAMPLE.slice(0, 1200));
              return undefined;
            }
            // 之后再也不给数据；只有 abort 能让它结束
            return new Promise<void>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
            });
          },
        });
        return new Response(body, { status: 200 });
      }) as never;
      const frames: MeshBatchFrame[] = [];
      const pending = fetchMeshBatch('/x', MANIFEST.request.keys, (frame) => frames.push(frame), { fetchImpl, idleTimeoutMs: 8000 });
      await vi.advanceTimersByTimeAsync(7999);
      expect(frames.map((frame) => frame.key)).toEqual(['1', 'no_such_mesh']);
      await vi.advanceTimersByTimeAsync(2);
      expect(await pending).toMatchObject({ kind: 'failed', frames: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createGenModelV1MeshBatcher（攒批、限并发、退回逐个取）', () => {
  type FakeServer = {
    fetchImpl: typeof fetch;
    calls: string[][];
    maxInFlight: () => number;
    release: () => void;
  };

  /** 假后端：照规范回帧。`statusOf` 决定每个键的状态；`gate` 为真时每个请求等 `release()` 才回。 */
  function fakeServer(options: {
    statusOf?: (key: string, callIndex: number, position: number) => number;
    respond?: (keys: string[], callIndex: number) => Response | null;
    gate?: boolean;
  } = {}): FakeServer {
    const calls: string[][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let open = !options.gate;
    const waiters: (() => void)[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const keys = keysOf(init);
      const callIndex = calls.length;
      calls.push(keys);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (!open) await new Promise<void>((resolve) => waiters.push(resolve));
        const custom = options.respond?.(keys, callIndex);
        if (custom) return custom;
        return streamResponse(encodeBatch(keys.map((key, position) => {
          const status = options.statusOf?.(key, callIndex, position) ?? 0;
          return { status, key, payload: status === 0 ? payloadFor(key) : undefined };
        })), 64);
      } finally {
        inFlight -= 1;
      }
    }) as typeof fetch;
    return {
      fetchImpl,
      calls,
      maxInFlight: () => maxInFlight,
      release: () => {
        open = true;
        waiters.splice(0).forEach((resolve) => resolve());
      },
    };
  }

  const CAPS = { mesh_batch_max_keys: 1024, mesh_batch_max_bytes: 33_554_432 };

  function batcher(server: FakeServer, extra: Parameters<typeof createGenModelV1MeshBatcher>[0] extends infer T ? Partial<T> : never = {}) {
    return createGenModelV1MeshBatcher({
      url: () => '/gm/api/v1/meshes/batch',
      capabilities: () => CAPS,
      fetchImpl: server.fetchImpl,
      ...extra,
    });
  }

  const text = (data: ArrayBuffer) => new TextDecoder().decode(data);

  it('同一拍里要的键攒成一批发；每个键拿到自己的内容', async () => {
    const server = fakeServer();
    const source = batcher(server);
    const keys = ['a', 'b', 'c'];
    const results = await Promise.all(keys.map((key) => source.request(key)));
    expect(server.calls).toEqual([keys]);
    expect(results.map((result) => (result.kind === 'mesh' ? text(result.data) : result.kind))).toEqual(['mesh:a', 'mesh:b', 'mesh:c']);
  });

  it('一批不超过 256 个键、同时在飞的不超过 4 批，先要的先发', async () => {
    const server = fakeServer({ gate: true });
    const source = batcher(server);
    const keys = Array.from({ length: 1486 }, (_, i) => `k${i}`);
    const all = Promise.all(keys.map((key) => source.request(key)));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(server.calls).toHaveLength(4);
    expect(server.calls.map((call) => call.length)).toEqual([256, 256, 256, 256]);
    expect(server.calls[0]![0]).toBe('k0');
    server.release();
    const results = await all;
    expect(results.every((result) => result.kind === 'mesh')).toBe(true);
    expect(server.calls.map((call) => call.length)).toEqual([256, 256, 256, 256, 256, 206]);
    expect(server.maxInFlight()).toBe(4);
    expect(server.calls.flat()).toEqual(keys);
  });

  it('同一个键同时被要两次只发一次；发出去的键不重复（后端对重复键回 400）', async () => {
    const server = fakeServer();
    const source = batcher(server);
    const [first, second] = await Promise.all([source.request('a'), source.request('a')]);
    expect(second).toBe(first);
    expect(server.calls).toEqual([['a']]);
  });

  it('状态 1 是「没有这个文件」；状态 2 与认不得的状态让这个键走单个路由', async () => {
    const server = fakeServer({ statusOf: (key) => ({ gone: 1, broken: 2, odd: 7 }[key] ?? 0) });
    const source = batcher(server);
    const [ok, gone, broken, odd] = await Promise.all(['ok', 'gone', 'broken', 'odd'].map((key) => source.request(key)));
    expect(ok!.kind).toBe('mesh');
    expect(gone).toEqual({ kind: 'missing' });
    expect(broken).toMatchObject({ kind: 'single' });
    expect(odd).toMatchObject({ kind: 'single' });
    expect(server.calls).toHaveLength(1);
  });

  it('状态 3（这一批到了总量上限没读）：把没读的键再发一次，最后都拿到', async () => {
    // 第一次：前两个给内容，后三个回 3；第二次：全给
    const server = fakeServer({ statusOf: (_key, callIndex, position) => (callIndex === 0 && position >= 2 ? 3 : 0) });
    const source = batcher(server);
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const results = await Promise.all(keys.map((key) => source.request(key)));
    expect(results.every((result) => result.kind === 'mesh')).toBe(true);
    expect(server.calls).toEqual([keys, ['c', 'd', 'e']]);
  });

  it('后端违反约定、第 0 帧就回状态 3：不无限重发，改走单个路由', async () => {
    const server = fakeServer({ statusOf: () => 3 });
    const source = batcher(server);
    const results = await Promise.all(['a', 'b'].map((key) => source.request(key)));
    expect(results.every((result) => result.kind === 'single')).toBe(true);
    expect(server.calls).toHaveLength(1);
  });

  it.each([405, 404])('旧后端回 %i：这一批和排着队的都退回逐个取，之后不再发打包请求', async (status) => {
    const server = fakeServer({ respond: () => new Response(null, { status }) });
    const source = batcher(server, { capabilities: () => null });
    expect(source.available()).toBe(true);
    const keys = Array.from({ length: 600 }, (_, i) => `k${i}`);
    const results = await Promise.all(keys.map((key) => source.request(key)));
    expect(results.every((result) => result.kind === 'single')).toBe(true);
    expect(source.available()).toBe(false);
    const sent = server.calls.length;
    expect(sent).toBeLessThanOrEqual(4);
    expect(await source.request('later')).toMatchObject({ kind: 'single' });
    expect(server.calls).toHaveLength(sent);
  });

  it('/health 的 capabilities 里没有 mesh_batch 两格：不可用，一个打包请求都不发', async () => {
    const server = fakeServer();
    const source = batcher(server, { capabilities: () => ({ mesh_formats: ['mesh', 'glb'] }) });
    expect(source.available()).toBe(false);
    expect(await source.request('a')).toMatchObject({ kind: 'single' });
    expect(server.calls).toHaveLength(0);
  });

  it('capabilities 还没拿到：先试，试出来有就用', async () => {
    const server = fakeServer();
    const source = batcher(server, { capabilities: () => null });
    expect(source.available()).toBe(true);
    expect((await source.request('a')).kind).toBe('mesh');
  });

  it('capabilities 给的键数上限比 256 小时按它来', async () => {
    const server = fakeServer();
    const source = batcher(server, { capabilities: () => ({ mesh_batch_max_keys: 100, mesh_batch_max_bytes: 1 }) });
    await Promise.all(Array.from({ length: 250 }, (_, i) => source.request(`k${i}`)));
    expect(server.calls.map((call) => call.length)).toEqual([100, 100, 50]);
  });

  it('流中途断了（没有流尾）：收全的帧照用，其余的键走单个路由', async () => {
    const server = fakeServer({
      respond: (keys) => {
        const full = encodeBatch(keys.map((key) => ({ status: 0, key, payload: payloadFor(key) })));
        // 只给到第 2 帧中间
        return streamResponse(full.subarray(0, 8 + 24 + 10), 16);
      },
    });
    const source = batcher(server);
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((key) => source.request(key)));
    expect(a!.kind).toBe('mesh');
    expect(b).toMatchObject({ kind: 'single' });
    expect(c).toMatchObject({ kind: 'single' });
    // 一次流断不等于没有这条路由
    expect(source.available()).toBe(true);
  });

  it('帧里的键与请求的对不上：这一批作废，没拿到的键走单个路由', async () => {
    const server = fakeServer({
      respond: (keys) => streamResponse(encodeBatch(keys.map((key, i) => ({ status: 0, key: i === 1 ? 'zzz' : key, payload: payloadFor(key) })))),
    });
    const source = batcher(server);
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((key) => source.request(key)));
    expect(a!.kind).toBe('mesh');
    expect(b).toMatchObject({ kind: 'single' });
    expect(c).toMatchObject({ kind: 'single' });
  });

  it('请求被拒（400）：这一批退回逐个取，并且这一代服务不再用这条路', async () => {
    const server = fakeServer({ respond: () => new Response('{"code":"bad_request"}', { status: 400 }) });
    const source = batcher(server);
    expect(await source.request('a')).toMatchObject({ kind: 'single' });
    expect(source.available()).toBe(false);
  });

  it('不合字符集的键不进打包请求（后端会整批回 400）', async () => {
    const server = fakeServer();
    const source = batcher(server);
    const [bad, long, good] = await Promise.all([source.request('a/b'), source.request('x'.repeat(129)), source.request('good_1')]);
    expect(bad).toMatchObject({ kind: 'single' });
    expect(long).toMatchObject({ kind: 'single' });
    expect(good!.kind).toBe('mesh');
    expect(server.calls).toEqual([['good_1']]);
  });

  it('reset（后端换了一代）之后重新探测：405 记下的「不可用」作废', async () => {
    let routeExists = false;
    const server = fakeServer({ respond: () => (routeExists ? null : new Response(null, { status: 405 })) });
    const source = batcher(server, { capabilities: () => null });
    expect(await source.request('a')).toMatchObject({ kind: 'single' });
    expect(source.available()).toBe(false);
    routeExists = true;
    source.reset();
    expect(source.available()).toBe(true);
    expect((await source.request('a')).kind).toBe('mesh');
  });

  it('拿到结果的键不留在手里：再要一次会重新发（缓存是调用方的事）', async () => {
    const server = fakeServer();
    const source = batcher(server);
    await source.request('a');
    await source.request('a');
    expect(server.calls).toEqual([['a'], ['a']]);
    expect(source.stats()).toMatchObject({ batches: 2, keysSent: 2, meshes: 2 });
  });

  describe('叫停（加载中可以停）：调用方给 signal', () => {
    it('叫停之后，还没发出去的键不再发，当场退给调用方；已经发出去的那一批照常回来', async () => {
      const server = fakeServer({ gate: true });
      const source = batcher(server, { batchSize: 2, parallel: 1 });
      const controller = new AbortController();
      const keys = ['a', 'b', 'c', 'd', 'e'];
      const all = keys.map((key) => source.request(key, { signal: controller.signal }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(server.calls).toEqual([['a', 'b']]);

      controller.abort();
      // 没发的三个不用等后端：马上就有结果
      const queued = await Promise.all(all.slice(2));
      expect(queued).toEqual([
        { kind: 'single', reason: 'cancelled' }, { kind: 'single', reason: 'cancelled' }, { kind: 'single', reason: 'cancelled' },
      ]);

      server.release();
      const sent = await Promise.all(all.slice(0, 2));
      expect(sent.map((result) => result.kind)).toEqual(['mesh', 'mesh']);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(server.calls).toEqual([['a', 'b']]);
    });

    it('同一个键还有别人在等（没叫停的那一方）：照常发', async () => {
      const server = fakeServer({ gate: true });
      const source = batcher(server, { batchSize: 1, parallel: 1 });
      const controller = new AbortController();
      const first = source.request('a', { signal: controller.signal });
      const sharedByStopped = source.request('b', { signal: controller.signal });
      const sharedByOther = source.request('b');
      const onlyStopped = source.request('c', { signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(server.calls).toEqual([['a']]);

      controller.abort();
      expect(await onlyStopped).toEqual({ kind: 'single', reason: 'cancelled' });
      server.release();
      expect((await first).kind).toBe('mesh');
      // b 有人还要：发出去了，两边拿到同一个结果
      expect((await sharedByOther).kind).toBe('mesh');
      expect(await sharedByStopped).toBe(await sharedByOther);
      expect(server.calls).toEqual([['a'], ['b']]);
    });

    it('一上来就已经叫停：不进队列', async () => {
      const server = fakeServer();
      const source = batcher(server);
      const controller = new AbortController();
      controller.abort();
      expect(await source.request('a', { signal: controller.signal })).toEqual({ kind: 'single', reason: 'cancelled' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(server.calls).toEqual([]);
    });

    it('叫停过的键之后再要（不带 signal）：照常发', async () => {
      const server = fakeServer({ gate: true });
      const source = batcher(server, { batchSize: 1, parallel: 1 });
      const controller = new AbortController();
      const first = source.request('a', { signal: controller.signal });
      const stopped = source.request('b', { signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      expect(await stopped).toEqual({ kind: 'single', reason: 'cancelled' });

      const again = source.request('b');
      server.release();
      expect((await first).kind).toBe('mesh');
      expect((await again).kind).toBe('mesh');
      expect(server.calls).toEqual([['a'], ['b']]);
    });

    it('后端回「这一批没读」要重发的键，重发之前被叫停：不再重发', async () => {
      const server = fakeServer({ gate: true, statusOf: (_key, callIndex, position) => (callIndex === 0 && position >= 1 ? 3 : 0) });
      const source = batcher(server);
      const controller = new AbortController();
      const all = ['a', 'b', 'c'].map((key) => source.request(key, { signal: controller.signal }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(server.calls).toEqual([['a', 'b', 'c']]);

      controller.abort();
      server.release();
      const results = await Promise.all(all);
      expect(results[0]!.kind).toBe('mesh');
      expect(results.slice(1)).toEqual([{ kind: 'single', reason: 'cancelled' }, { kind: 'single', reason: 'cancelled' }]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(server.calls).toHaveLength(1);
    });

    it('正常回来的键不留监听：signal 之后再 abort 没有任何影响', async () => {
      const server = fakeServer();
      const source = batcher(server);
      const controller = new AbortController();
      expect((await source.request('a', { signal: controller.signal })).kind).toBe('mesh');
      controller.abort();
      expect((await source.request('a')).kind).toBe('mesh');
      expect(source.stats()).toMatchObject({ batches: 2, meshes: 2 });
    });
  });
});
