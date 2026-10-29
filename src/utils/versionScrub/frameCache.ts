/**
 * 版本帧缓存：LRU + 按 geometryKey 共享几何（design.md §2.4，Requirement 4.1、4.2、4.7、4.10、10.5）。
 * 纯函数：无 Vue、无 DOM、无网络。每个操作返回新状态与副作用清单，不修改传入的状态；
 * 副作用（释放图层几何、Legacy 下 DELETE 快照）由调用方（useVersionFrames）执行。
 *
 * 口径：
 * - 键 `${dbnum}|${unitRefno}|${sesno}`，上限按键计，缺省 12。
 * - 写入（putFrame / putSharedFrame）与装入视口（touchFrame）记为一次使用。
 * - 超限时从最久未使用端起：先淘汰「不在 protect.keys 且 sesno !== cursorSesno」的键，
 *   找不到再淘汰「不在 protect.keys」的键，仍找不到则暂时超限；游标改变后调 trimFrames 收回。
 * - 几何存放在引用计数的槽里。带 geometryKey 的帧按 geometryKey 共用一个槽；无 geometryKey 的帧独占一个槽；
 *   putSharedFrame（304）直接引用 sharedFrom 的槽。槽的引用归 0 才产出 `free-geometry`。
 */

export type FrameKey = string; // `${dbnum}|${unitRefno}|${sesno}`

export function frameKeyOf(dbnum: number, unitRefno: string, sesno: number): FrameKey {
  return `${dbnum}|${unitRefno}|${sesno}`;
}

export type CachedFrame<G> = {
  key: FrameKey;
  dbnum: number;
  unitRefno: string;
  sesno: number;
  sessionTime: string | null;
  geometryKey: string | null;
  geometry: G;
  legacySnapshotKey?: string | null; // 仅 Legacy 降级路径产生
};

export type ProtectSet = { keys: ReadonlySet<FrameKey>; cursorSesno: number | null };

export type FrameCacheEffect<G> =
  | { kind: 'evicted'; frame: CachedFrame<G> } // 调用方据 legacySnapshotKey 决定是否 DELETE
  | { kind: 'free-geometry'; geometry: G };

export type GeometrySlot<G> = { readonly geometry: G; readonly refs: number };

export type FrameCacheState<G> = {
  /** 键 → 帧；帧的 geometry 恒为其槽中的那份 */
  readonly frames: ReadonlyMap<FrameKey, CachedFrame<G>>;
  /** 使用顺序，下标 0 为最久未使用 */
  readonly order: readonly FrameKey[];
  /** 槽 id → 几何与引用数 */
  readonly slots: ReadonlyMap<number, GeometrySlot<G>>;
  /** 键 → 槽 id */
  readonly slotOf: ReadonlyMap<FrameKey, number>;
  /** geometryKey → 槽 id（只登记按 geometryKey 共享的槽） */
  readonly slotByGeometryKey: ReadonlyMap<string, number>;
  readonly nextSlot: number;
};

export type FrameCacheResult<G> = { state: FrameCacheState<G>; effects: FrameCacheEffect<G>[] };

export const DEFAULT_FRAME_CACHE_LIMIT = 12;

export function emptyFrameCache<G>(): FrameCacheState<G> {
  return {
    frames: new Map(),
    order: [],
    slots: new Map(),
    slotOf: new Map(),
    slotByGeometryKey: new Map(),
    nextSlot: 0,
  };
}

export function getFrame<G>(s: FrameCacheState<G>, key: FrameKey): CachedFrame<G> | null {
  return s.frames.get(key) ?? null;
}

/** 可变工作副本：每个操作复制一次状态，在副本上改，最后冻结为新状态。 */
type Draft<G> = {
  frames: Map<FrameKey, CachedFrame<G>>;
  order: FrameKey[];
  slots: Map<number, GeometrySlot<G>>;
  slotOf: Map<FrameKey, number>;
  slotByGeometryKey: Map<string, number>;
  nextSlot: number;
  effects: FrameCacheEffect<G>[];
};

function draftOf<G>(s: FrameCacheState<G>): Draft<G> {
  return {
    frames: new Map(s.frames),
    order: [...s.order],
    slots: new Map(s.slots),
    slotOf: new Map(s.slotOf),
    slotByGeometryKey: new Map(s.slotByGeometryKey),
    nextSlot: s.nextSlot,
    effects: [],
  };
}

function finish<G>(d: Draft<G>): FrameCacheResult<G> {
  return {
    state: {
      frames: d.frames,
      order: d.order,
      slots: d.slots,
      slotOf: d.slotOf,
      slotByGeometryKey: d.slotByGeometryKey,
      nextSlot: d.nextSlot,
    },
    effects: d.effects,
  };
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit < 0) return DEFAULT_FRAME_CACHE_LIMIT;
  return Math.floor(limit);
}

function moveToMostRecent<G>(d: Draft<G>, key: FrameKey): void {
  const i = d.order.indexOf(key);
  if (i >= 0) d.order.splice(i, 1);
  d.order.push(key);
}

/** 槽引用 +1 */
function retainSlot<G>(d: Draft<G>, slotId: number): G {
  const slot = d.slots.get(slotId)!;
  d.slots.set(slotId, { geometry: slot.geometry, refs: slot.refs + 1 });
  return slot.geometry;
}

/** 新建引用数为 1 的槽；geometryKey 非空时登记以便后续共享 */
function createSlot<G>(d: Draft<G>, geometry: G, geometryKey: string | null): number {
  const id = d.nextSlot;
  d.nextSlot += 1;
  d.slots.set(id, { geometry, refs: 1 });
  if (geometryKey !== null) d.slotByGeometryKey.set(geometryKey, id);
  return id;
}

/** 槽引用 -1；归 0 时删除槽并产出 free-geometry */
function releaseSlot<G>(d: Draft<G>, slotId: number): void {
  const slot = d.slots.get(slotId);
  if (!slot) return;
  if (slot.refs > 1) {
    d.slots.set(slotId, { geometry: slot.geometry, refs: slot.refs - 1 });
    return;
  }
  d.slots.delete(slotId);
  for (const [gk, id] of d.slotByGeometryKey) {
    if (id === slotId) {
      d.slotByGeometryKey.delete(gk);
      break;
    }
  }
  d.effects.push({ kind: 'free-geometry', geometry: slot.geometry });
}

/** 从缓存移除一个键：产出 evicted，再释放其槽引用 */
function evictKey<G>(d: Draft<G>, key: FrameKey): void {
  const frame = d.frames.get(key);
  if (!frame) return;
  d.frames.delete(key);
  const i = d.order.indexOf(key);
  if (i >= 0) d.order.splice(i, 1);
  const slotId = d.slotOf.get(key);
  d.slotOf.delete(key);
  d.effects.push({ kind: 'evicted', frame });
  if (slotId !== undefined) releaseSlot(d, slotId);
}

/** 按淘汰顺序淘汰到 limit 以内；剩余键都不可淘汰时暂时超限 */
function enforceLimit<G>(d: Draft<G>, protect: ProtectSet, limit: number): void {
  while (d.order.length > limit) {
    const unprotected = d.order.filter((k) => !protect.keys.has(k));
    const victim =
      unprotected.find((k) => d.frames.get(k)!.sesno !== protect.cursorSesno) ?? unprotected[0];
    if (victim === undefined) return;
    evictKey(d, victim);
  }
}

/**
 * 把旧帧换成同键新帧时处理旧帧：释放旧槽引用；旧帧的 Legacy 快照与新帧不同时产出 evicted，
 * 以便调用方 DELETE 旧快照。新帧已先取得槽引用，故同一份几何不会被误释放。
 */
function replaceOld<G>(d: Draft<G>, old: CachedFrame<G>, oldSlot: number | undefined, next: CachedFrame<G>): void {
  const oldSnap = old.legacySnapshotKey ?? null;
  if (oldSnap !== null && oldSnap !== (next.legacySnapshotKey ?? null)) {
    d.effects.push({ kind: 'evicted', frame: old });
  }
  if (oldSlot !== undefined) releaseSlot(d, oldSlot);
}

/**
 * 写入一个 200 帧。若已有同 geometryKey 的几何，丢弃传入的几何（产出 free-geometry）并复用已有份。
 * 同键已存在时替换旧帧。写入记为一次使用，随后按 protect 淘汰到 limit。
 */
export function putFrame<G>(
  s: FrameCacheState<G>,
  frame: CachedFrame<G>,
  protect: ProtectSet,
  limit?: number,
): FrameCacheResult<G> {
  const d = draftOf(s);
  const old = d.frames.get(frame.key);
  const oldSlot = d.slotOf.get(frame.key);

  let slotId: number;
  let geometry: G;
  const sharedId = frame.geometryKey !== null ? d.slotByGeometryKey.get(frame.geometryKey) : undefined;
  if (sharedId !== undefined) {
    slotId = sharedId;
    geometry = retainSlot(d, sharedId);
    if (geometry !== frame.geometry) d.effects.push({ kind: 'free-geometry', geometry: frame.geometry });
  } else if (old && oldSlot !== undefined && frame.geometryKey === null && old.geometry === frame.geometry) {
    // 同键重写同一份独占几何：沿用原槽，不重复释放
    slotId = oldSlot;
    geometry = retainSlot(d, oldSlot);
  } else {
    slotId = createSlot(d, frame.geometry, frame.geometryKey);
    geometry = frame.geometry;
  }

  const stored: CachedFrame<G> = { ...frame, geometry };
  if (old) replaceOld(d, old, oldSlot, stored);
  d.frames.set(frame.key, stored);
  d.slotOf.set(frame.key, slotId);
  moveToMostRecent(d, frame.key);
  enforceLimit(d, protect, normalizeLimit(limit));
  return finish(d);
}

/**
 * 304：新键直接引用 sharedFrom 那份几何（引用 +1，不新增几何份数）。
 * sesno / sessionTime 取自 meta（来自响应头）；geometryKey 取 sharedFrom 的值（为空时用 meta 的）。
 * sharedFrom 不在缓存中时状态不变、无副作用，调用方可据 getFrame(meta.key) 为空改为无条件请求。
 */
export function putSharedFrame<G>(
  s: FrameCacheState<G>,
  meta: Omit<CachedFrame<G>, 'geometry'>,
  sharedFrom: FrameKey,
  protect: ProtectSet,
  limit?: number,
): FrameCacheResult<G> {
  const source = s.frames.get(sharedFrom);
  const sourceSlot = s.slotOf.get(sharedFrom);
  if (!source || sourceSlot === undefined) return { state: s, effects: [] };

  const d = draftOf(s);
  const old = d.frames.get(meta.key);
  const oldSlot = d.slotOf.get(meta.key);
  const geometry = retainSlot(d, sourceSlot);
  const stored: CachedFrame<G> = {
    ...meta,
    geometryKey: source.geometryKey ?? meta.geometryKey,
    geometry,
  };
  if (old) replaceOld(d, old, oldSlot, stored);
  d.frames.set(meta.key, stored);
  d.slotOf.set(meta.key, sourceSlot);
  moveToMostRecent(d, meta.key);
  enforceLimit(d, protect, normalizeLimit(limit));
  return finish(d);
}

/** 帧被装入视口：记为一次使用。键不在缓存中时原样返回。 */
export function touchFrame<G>(s: FrameCacheState<G>, key: FrameKey): FrameCacheState<G> {
  if (!s.frames.has(key)) return s;
  if (s.order[s.order.length - 1] === key) return s;
  const order = s.order.filter((k) => k !== key);
  order.push(key);
  return { ...s, order };
}

/** 保护集合或游标改变后收回到 limit（缺省 12）。 */
export function trimFrames<G>(s: FrameCacheState<G>, protect: ProtectSet, limit?: number): FrameCacheResult<G> {
  const d = draftOf(s);
  enforceLimit(d, protect, normalizeLimit(limit));
  return finish(d);
}

/** 退出 Browse_Mode / 关闭面板：按最久未使用起逐个淘汰全部键。 */
export function clearFrames<G>(s: FrameCacheState<G>): FrameCacheResult<G> {
  const d = draftOf(s);
  for (const key of [...d.order]) evictKey(d, key);
  return finish(d);
}
