/**
 * 网格打包取：`POST /api/v1/meshes/batch`（gen-model `docs/specs/web-service-api.md` §4.11.4；
 * 方案 `docs/plans/2026-11-10-model-load-speed-generate-and-freshness-plan.md` A4）。
 *
 * 一个节点常有上千种网格，逐个 `GET` 就是上千次请求（本机 1486 种要 1.4–1.7 秒）。这条路一次请求带一批键，
 * 响应是一段二进制流、一个键一帧。这里有三层：
 * - `MeshBatchDecoder`：流式解码。数据块到多少拆多少，一帧的字节到齐就交出来，不等后面的帧；
 * - `fetchMeshBatch`：发一次请求、边收边喂解码器，区分「没有这条路由」「请求不被接受」「中途失败」；
 * - `createGenModelV1MeshBatcher`：攒批与限并发。调用方一个键一个键地要，这里把同一拍里要的键攒成批
 *   （一批 256 个上下、同时在飞 3–4 批是后端建议的用法），并决定哪些键该退回逐个取。
 *
 * 只取原网格。粗网格（`?lod=1`）仍走单个路由。拿到的内容不缓存在这里：缓存是调用方（装载器）的事。
 */
import type { MeshBatchResult } from '../ports';

export const MESH_BATCH_STATUS = {
  /** 有：内容是这个键 `.mesh` 的原样字节 */
  FOUND: 0,
  /** 没有这个文件（同单个路由的 404） */
  MISSING: 1,
  /** 文件在，这一次没读出来 */
  READ_FAILED: 2,
  /** 没读：这一批的内容总量到了上限，再发一次即可 */
  DEFERRED: 3,
} as const;

/** 规范上限：一次最多这么多个键 */
export const MESH_BATCH_MAX_KEYS = 1024;
/** 一批发多少个键（后端建议 256 上下） */
export const MESH_BATCH_DEFAULT_KEYS = 256;
/** 同时在飞的批数（后端建议 3–4） */
export const MESH_BATCH_DEFAULT_PARALLEL = 4;
/** 这么久收不到新数据就放弃这一批（与逐个取时单个网格的时限同一个数） */
export const MESH_BATCH_IDLE_TIMEOUT_MS = 8_000;

const MAGIC_HEAD = 'PMB1';
const MAGIC_TAIL = 'PMBE';
/** 与单个路由的 `geo_hash` 是同一道门；不合的键后端会让整批 400 */
const VALID_KEY = /^[0-9A-Za-z_]{1,128}$/;

const ceil8 = (n: number) => (n + 7) & ~7;

function ascii(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

function u32le(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

/** 响应体不是规范里的格式（魔数不对、帧头不合理、帧里的键与请求不符）。 */
export class MeshBatchFormatError extends Error {
  constructor(message: string) {
    super(`meshes/batch 响应格式不对：${message}`);
    this.name = 'MeshBatchFormatError';
  }
}

export type MeshBatchFrame = {
  /** 第几帧（从 0 起），也就是请求里 `keys` 的下标 */
  index: number;
  /** 状态，见 `MESH_BATCH_STATUS`；认不得的值原样给出 */
  status: number;
  key: string;
  /** 状态 0 时是内容（自己的一份缓冲，起点对齐，可直接交给 `.mesh` 解析器）；其余为 `null` */
  payload: ArrayBuffer | null;
};

/**
 * 流式解码器。`push` 喂数据块，每凑齐一帧就调一次 `onFrame`；流读完后 `end()` 说完整不完整。
 * 每段内容只拷一次（从数据块拷进它自己的缓冲）。
 */
export class MeshBatchDecoder {
  private readonly chunks: Uint8Array[] = [];
  private headOffset = 0;
  private available = 0;
  private declared: number | null = null;
  private emitted = 0;
  private frameHead: { status: number; keyLen: number; payloadLen: number } | null = null;
  private trailerOk: boolean | null = null;
  private extraBytes = false;

  constructor(private readonly onFrame: (frame: MeshBatchFrame) => void) {}

  push(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.available += chunk.length;
    this.drain();
  }

  /** 流读完了。`complete`：帧数够、流尾对、流尾之后没有多余字节。不完整时已经交出的帧仍然可用。 */
  end(): { declared: number | null; frames: number; complete: boolean } {
    return {
      declared: this.declared,
      frames: this.emitted,
      complete: this.declared !== null && this.emitted === this.declared && this.trailerOk === true && !this.extraBytes,
    };
  }

  private take(length: number): Uint8Array {
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const head = this.chunks[0]!;
      const usable = Math.min(head.length - this.headOffset, length - filled);
      out.set(head.subarray(this.headOffset, this.headOffset + usable), filled);
      filled += usable;
      this.advance(usable);
    }
    return out;
  }

  private skip(length: number): void {
    let left = length;
    while (left > 0) {
      const usable = Math.min(this.chunks[0]!.length - this.headOffset, left);
      left -= usable;
      this.advance(usable);
    }
  }

  private advance(count: number): void {
    this.headOffset += count;
    this.available -= count;
    if (this.headOffset >= this.chunks[0]!.length) {
      this.chunks.shift();
      this.headOffset = 0;
    }
  }

  private drain(): void {
    for (;;) {
      if (this.declared === null) {
        if (this.available < 8) return;
        const head = this.take(8);
        if (ascii(head, 0, 4) !== MAGIC_HEAD) throw new MeshBatchFormatError('流头不是 PMB1');
        const declared = u32le(head, 4);
        if (declared > MESH_BATCH_MAX_KEYS) throw new MeshBatchFormatError(`帧数 ${declared} 超过上限 ${MESH_BATCH_MAX_KEYS}`);
        this.declared = declared;
        continue;
      }
      if (this.emitted < this.declared) {
        if (!this.frameHead) {
          if (this.available < 8) return;
          const head = this.take(8);
          const keyLen = head[1]!;
          if (keyLen < 1 || keyLen > 128) throw new MeshBatchFormatError(`第 ${this.emitted} 帧的键长 ${keyLen} 不在 1..128`);
          this.frameHead = { status: head[0]!, keyLen, payloadLen: u32le(head, 4) };
        }
        const { status, keyLen, payloadLen } = this.frameHead;
        if (this.available < ceil8(keyLen) + ceil8(payloadLen)) return;
        const key = ascii(this.take(keyLen));
        this.skip(ceil8(keyLen) - keyLen);
        let payload: ArrayBuffer | null = null;
        if (status === MESH_BATCH_STATUS.FOUND) {
          payload = this.take(payloadLen).buffer as ArrayBuffer;
          this.skip(ceil8(payloadLen) - payloadLen);
        } else {
          // 规范：状态不是 0 时内容长度为 0；真带了也只是跳过
          this.skip(ceil8(payloadLen));
        }
        const index = this.emitted;
        this.frameHead = null;
        this.emitted += 1;
        this.onFrame({ index, status, key, payload });
        continue;
      }
      if (this.trailerOk === null) {
        if (this.available < 8) return;
        const tail = this.take(8);
        this.trailerOk = ascii(tail, 0, 4) === MAGIC_TAIL && u32le(tail, 4) === this.declared;
        continue;
      }
      if (this.available > 0) {
        this.extraBytes = true;
        this.skip(this.available);
      }
      return;
    }
  }
}

export type MeshBatchFetchOutcome =
  /** 200，响应流读完了。`complete` 为假 = 没有流尾（中途断了），已交出的帧可用 */
  | { kind: 'ok'; complete: boolean; frames: number }
  /** 405（或经代理变成的 404）：后端没有这条路由 */
  | { kind: 'unsupported'; status: number }
  /** 400 / 413 等：请求不被接受（按规范不该发生，发生了说明两边约定不一致） */
  | { kind: 'rejected'; status: number }
  /** 网络错、5xx、空闲超时、响应体格式不对。`frames` 是失败之前已经交出的帧数 */
  | { kind: 'failed'; error: unknown; frames: number };

export type MeshBatchFetchOptions = {
  fetchImpl?: typeof fetch;
  /** 这么久收不到新数据（含等响应头）就放弃 */
  idleTimeoutMs?: number;
  signal?: AbortSignal;
};

/** 发一次打包请求，响应流边收边拆，每帧调一次 `onFrame`。不抛错：结局都在返回值里。 */
export async function fetchMeshBatch(
  url: string,
  keys: readonly string[],
  onFrame: (frame: MeshBatchFrame) => void,
  options: MeshBatchFetchOptions = {},
): Promise<MeshBatchFetchOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const idleTimeoutMs = options.idleTimeoutMs ?? MESH_BATCH_IDLE_TIMEOUT_MS;
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onOuterAbort();
  else options.signal?.addEventListener('abort', onOuterAbort, { once: true });
  let timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  let frames = 0;
  const decoder = new MeshBatchDecoder((frame) => {
    frames += 1;
    onFrame(frame);
  });
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keys }),
      signal: controller.signal,
    });
    if (response.status === 405 || response.status === 404) {
      void response.body?.cancel().catch(() => undefined);
      return { kind: 'unsupported', status: response.status };
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status >= 500) return { kind: 'failed', error: new Error(`meshes/batch HTTP ${response.status}`), frames };
      return { kind: 'rejected', status: response.status };
    }
    touch();
    const reader = response.body?.getReader();
    if (!reader) {
      decoder.push(new Uint8Array(await response.arrayBuffer()));
    } else {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        touch();
        if (value && value.length > 0) decoder.push(value);
      }
    }
    return { kind: 'ok', complete: decoder.end().complete, frames };
  } catch (error) {
    // 解码出错（格式不对、键对不上）时连接可能还在流：掐掉，别白收
    try { controller.abort(); } catch { /* ignore */ }
    return { kind: 'failed', error, frames };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}

export type MeshBatchStats = {
  batches: number;
  keysSent: number;
  meshes: number;
  missing: number;
  singles: number;
  deferred: number;
};

export type GenModelV1MeshBatcher = {
  /**
   * 这条路现在可不可用。两种探测都认：`/health` 的 `capabilities` 里有没有 `mesh_batch_max_keys` /
   * `mesh_batch_max_bytes`（没有这两格的后端就没有这条路由）；发出去的请求回没回 405 / 404。
   * `capabilities` 还没拿到时算可用——先试，试出来没有再退。
   */
  available(): boolean;
  /** 要一个键。同一拍里要的键攒成批；同一个键同时被要多次共用一个结果。从不抛错。 */
  request(geoHash: string): Promise<MeshBatchResult>;
  /** 后端换了一代（重启 / 换地址）：之前试出来的「不可用」作废，重新探测。 */
  reset(): void;
  stats(): MeshBatchStats;
};

export type GenModelV1MeshBatcherOptions = {
  /** 打包路由的完整地址（每次发请求时取，跟着当前后端地址走） */
  url: () => string;
  /** `/health` 的 `capabilities`（只看 `mesh_batch_max_keys` / `mesh_batch_max_bytes` 两格）；还没拿到回 `null` */
  capabilities: () => Record<string, unknown> | null | undefined;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  parallel?: number;
  idleTimeoutMs?: number;
};

export function createGenModelV1MeshBatcher(options: GenModelV1MeshBatcherOptions): GenModelV1MeshBatcher {
  const batchSize = options.batchSize ?? MESH_BATCH_DEFAULT_KEYS;
  const parallel = options.parallel ?? MESH_BATCH_DEFAULT_PARALLEL;
  /** 试出来不可用的原因；`null` = 没试出问题 */
  let disabledReason: string | null = null;
  const pending = new Map<string, { promise: Promise<MeshBatchResult>; resolve: (result: MeshBatchResult) => void }>();
  const queue: string[] = [];
  let inFlight = 0;
  let pumpScheduled = false;
  const counters: MeshBatchStats = { batches: 0, keysSent: 0, meshes: 0, missing: 0, singles: 0, deferred: 0 };

  function declaredMaxKeys(): number | null | undefined {
    const caps = options.capabilities();
    if (!caps) return undefined;
    const maxKeys = caps.mesh_batch_max_keys;
    return typeof maxKeys === 'number' && maxKeys > 0 && typeof caps.mesh_batch_max_bytes === 'number' ? maxKeys : null;
  }

  function available(): boolean {
    return disabledReason === null && declaredMaxKeys() !== null;
  }

  function settle(key: string, result: MeshBatchResult): void {
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    if (result.kind === 'mesh') counters.meshes += 1;
    else if (result.kind === 'missing') counters.missing += 1;
    else counters.singles += 1;
    entry.resolve(result);
  }

  function flushQueueAsSingle(reason: string): void {
    for (const key of queue.splice(0)) settle(key, { kind: 'single', reason });
  }

  function request(geoHash: string): Promise<MeshBatchResult> {
    const existing = pending.get(geoHash);
    if (existing) return existing.promise;
    if (!available()) {
      counters.singles += 1;
      return Promise.resolve({ kind: 'single', reason: disabledReason ?? 'no_capability' });
    }
    if (!VALID_KEY.test(geoHash)) {
      counters.singles += 1;
      return Promise.resolve({ kind: 'single', reason: 'invalid_key' });
    }
    let resolve!: (result: MeshBatchResult) => void;
    const promise = new Promise<MeshBatchResult>((done) => { resolve = done; });
    pending.set(geoHash, { promise, resolve });
    queue.push(geoHash);
    schedulePump();
    return promise;
  }

  /** 推到微任务里再发：同一拍里连着要的键（装载器一次要上千个）才攒得成一批 */
  function schedulePump(): void {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  }

  function pump(): void {
    while (inFlight < parallel && queue.length > 0) {
      if (!available()) {
        flushQueueAsSingle(disabledReason ?? 'no_capability');
        return;
      }
      const limit = Math.max(1, Math.min(batchSize, declaredMaxKeys() ?? batchSize, MESH_BATCH_MAX_KEYS));
      void runBatch(queue.splice(0, limit));
    }
  }

  async function runBatch(keys: string[]): Promise<void> {
    inFlight += 1;
    counters.batches += 1;
    counters.keysSent += keys.length;
    const unanswered = new Set(keys);
    const deferred: string[] = [];
    const outcome = await fetchMeshBatch(options.url(), keys, (frame) => {
      const key = keys[frame.index];
      if (key === undefined || frame.key !== key) throw new MeshBatchFormatError(`第 ${frame.index} 帧的键与请求的不符`);
      unanswered.delete(key);
      if (frame.status === MESH_BATCH_STATUS.FOUND) settle(key, { kind: 'mesh', data: frame.payload ?? new ArrayBuffer(0) });
      else if (frame.status === MESH_BATCH_STATUS.MISSING) settle(key, { kind: 'missing' });
      else if (frame.status === MESH_BATCH_STATUS.DEFERRED) deferred.push(key);
      else settle(key, { kind: 'single', reason: `status_${frame.status}` });
    }, { fetchImpl: options.fetchImpl, idleTimeoutMs: options.idleTimeoutMs });
    inFlight -= 1;

    if (outcome.kind === 'unsupported' || outcome.kind === 'rejected') {
      // 没有这条路由，或两边约定不一致：这一代服务不再试，手里的都退回逐个取
      disabledReason = outcome.kind === 'unsupported' ? `route_missing_${outcome.status}` : `rejected_${outcome.status}`;
      for (const key of [...unanswered, ...deferred]) settle(key, { kind: 'single', reason: disabledReason });
      flushQueueAsSingle(disabledReason);
      return;
    }
    // 流断了 / 中途失败：收全的帧已经交出去了，其余的键走单个路由（它有自己的时限与兜底）
    const reason = outcome.kind === 'ok' ? 'incomplete' : 'failed';
    for (const key of unanswered) settle(key, { kind: 'single', reason });
    if (deferred.length > 0) {
      counters.deferred += deferred.length;
      if (deferred.length === keys.length) {
        // 规范保证第 0 帧不会是「没读」；真遇到了就别再发同样的请求
        for (const key of deferred) settle(key, { kind: 'single', reason: 'deferred_all' });
      } else {
        queue.unshift(...deferred);
      }
    }
    pump();
  }

  return {
    available,
    request,
    reset() {
      disabledReason = null;
    },
    stats: () => ({ ...counters }),
  };
}
