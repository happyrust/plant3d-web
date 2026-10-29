import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import {
  clearFrames,
  DEFAULT_FRAME_CACHE_LIMIT,
  emptyFrameCache,
  frameKeyOf,
  getFrame,
  putFrame,
  putSharedFrame,
  touchFrame,
  trimFrames,
  type CachedFrame,
  type FrameCacheEffect,
  type FrameCacheState,
  type FrameKey,
  type ProtectSet,
} from './frameCache';

/** 每份几何是一个唯一对象，按引用比较。 */
type Geo = { readonly id: number };

/** 键池：2 个单元 × 8 个 sesno = 16 个键，能超过缺省上限 12。 */
const UNITS = ['24381_1', '24381_2'] as const;
const SESNOS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const KEY_POOL: { dbnum: number; unitRefno: string; sesno: number; key: FrameKey }[] = UNITS.flatMap((unitRefno) =>
  SESNOS.map((sesno) => ({ dbnum: 8000, unitRefno, sesno, key: frameKeyOf(8000, unitRefno, sesno) })),
);
const GEOMETRY_KEYS = ['g:a', 'g:b', 'g:c'] as const;
const SNAPSHOT_KEYS = ['snap-1', 'snap-2', 'snap-3'] as const;

function keyAt(i: number): { dbnum: number; unitRefno: string; sesno: number; key: FrameKey } {
  const entry = KEY_POOL[i % KEY_POOL.length];
  if (!entry) throw new Error(`key index out of range: ${i}`);
  return entry;
}

type Op =
  | { kind: 'put'; keyIdx: number; geometryKey: string | null; snap: string | null | undefined }
  | { kind: 'putShared'; keyIdx: number; fromIdx: number; snap: string | null | undefined }
  | { kind: 'touch'; keyIdx: number }
  | { kind: 'trim' }
  | { kind: 'clear' }
  | { kind: 'protect'; keyIdxs: number[] }
  | { kind: 'cursor'; sesno: number | null };

const keyIdxArb = fc.integer({ min: 0, max: KEY_POOL.length - 1 });
const snapArb = fc.constantFrom<string | null | undefined>(undefined, null, ...SNAPSHOT_KEYS);

const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('put' as const),
      keyIdx: keyIdxArb,
      geometryKey: fc.constantFrom<string | null>(null, ...GEOMETRY_KEYS),
      snap: snapArb,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({ kind: fc.constant('putShared' as const), keyIdx: keyIdxArb, fromIdx: keyIdxArb, snap: snapArb }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('touch' as const), keyIdx: keyIdxArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('trim' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('clear' as const) }) },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('protect' as const),
      keyIdxs: fc.uniqueArray(keyIdxArb, { maxLength: 6 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('cursor' as const),
      sesno: fc.option(fc.constantFrom(...SESNOS), { nil: null }),
    }),
  },
);

// ---------------------------------------------------------------------------
// 直白的参考模型：按键记帧与它引用的几何对象；几何是否仍存活只看「还有没有键引用它」。
// ---------------------------------------------------------------------------

type ModelFrame = CachedFrame<Geo>;

type Model = {
  order: FrameKey[]; // 下标 0 为最久未使用
  frames: Map<FrameKey, ModelFrame>;
  /** geometryKey → 当前存活的那份几何 */
  byGeometryKey: Map<string, Geo>;
};

type ModelStep = { evicted: ModelFrame[]; freed: Geo[] };

function referenced(m: Model): Set<Geo> {
  return new Set([...m.frames.values()].map((f) => f.geometry));
}

/** 移除不再被任何键引用的几何，返回它们（即应 free 的几何）。 */
function collectFreed(m: Model, before: Set<Geo>): Geo[] {
  const live = referenced(m);
  const freed = [...before].filter((g) => !live.has(g));
  for (const [gk, g] of [...m.byGeometryKey]) if (!live.has(g)) m.byGeometryKey.delete(gk);
  return freed;
}

function modelEvictToLimit(m: Model, protect: ProtectSet, limit: number, evicted: ModelFrame[]): void {
  while (m.order.length > limit) {
    let victim: FrameKey | undefined;
    for (const k of m.order) {
      if (protect.keys.has(k)) continue;
      if (m.frames.get(k)?.sesno !== protect.cursorSesno) {
        victim = k;
        break;
      }
    }
    if (victim === undefined) victim = m.order.find((k) => !protect.keys.has(k));
    if (victim === undefined) return;
    const frame = m.frames.get(victim);
    if (frame) evicted.push(frame);
    m.frames.delete(victim);
    m.order = m.order.filter((k) => k !== victim);
  }
}

function modelWrite(m: Model, stored: ModelFrame, evicted: ModelFrame[]): void {
  const old = m.frames.get(stored.key);
  if (old) {
    const oldSnap = old.legacySnapshotKey ?? null;
    if (oldSnap !== null && oldSnap !== (stored.legacySnapshotKey ?? null)) evicted.push(old);
  }
  m.frames.set(stored.key, stored);
  m.order = [...m.order.filter((k) => k !== stored.key), stored.key];
}

function modelPut(m: Model, frame: ModelFrame, protect: ProtectSet, limit: number): ModelStep {
  const before = referenced(m);
  const evicted: ModelFrame[] = [];
  const extraFreed: Geo[] = [];
  let geometry = frame.geometry;
  const shared = frame.geometryKey !== null ? m.byGeometryKey.get(frame.geometryKey) : undefined;
  if (shared !== undefined) {
    geometry = shared;
    extraFreed.push(frame.geometry); // 传入的几何从未入缓存，立即丢弃
  } else if (frame.geometryKey !== null) {
    m.byGeometryKey.set(frame.geometryKey, frame.geometry);
  }
  modelWrite(m, { ...frame, geometry }, evicted);
  before.add(geometry); // 新写入的几何也可能在本次淘汰中失去全部引用
  modelEvictToLimit(m, protect, limit, evicted);
  return { evicted, freed: [...extraFreed, ...collectFreed(m, before)] };
}

function modelPutShared(
  m: Model,
  meta: Omit<ModelFrame, 'geometry'>,
  from: FrameKey,
  protect: ProtectSet,
  limit: number,
): ModelStep {
  const source = m.frames.get(from);
  if (!source) return { evicted: [], freed: [] };
  const before = referenced(m);
  const evicted: ModelFrame[] = [];
  modelWrite(m, { ...meta, geometryKey: source.geometryKey ?? meta.geometryKey, geometry: source.geometry }, evicted);
  modelEvictToLimit(m, protect, limit, evicted);
  return { evicted, freed: collectFreed(m, before) };
}

function modelTrim(m: Model, protect: ProtectSet, limit: number): ModelStep {
  const before = referenced(m);
  const evicted: ModelFrame[] = [];
  modelEvictToLimit(m, protect, limit, evicted);
  return { evicted, freed: collectFreed(m, before) };
}

function modelClear(m: Model): ModelStep {
  const before = referenced(m);
  const evicted = m.order.map((k) => m.frames.get(k)).filter((f): f is ModelFrame => f !== undefined);
  m.frames.clear();
  m.order = [];
  return { evicted, freed: collectFreed(m, before) };
}

// ---------------------------------------------------------------------------

function split(effects: FrameCacheEffect<Geo>[]): { evicted: CachedFrame<Geo>[]; freed: Geo[] } {
  const evicted: CachedFrame<Geo>[] = [];
  const freed: Geo[] = [];
  for (const e of effects) {
    if (e.kind === 'evicted') evicted.push(e.frame);
    else freed.push(e.geometry);
  }
  return { evicted, freed };
}

function byId(gs: Geo[]): number[] {
  return gs.map((g) => g.id).sort((a, b) => a - b);
}

describe('frameCache 属性测试', () => {
  // Feature: model-version-timeline-scrub, Property 16: 帧缓存 LRU 与几何共享
  it('Property 16: 与参考 LRU 模型一致；受保护键不被淘汰；同 geometryKey 只存一份且恰在最后引用消失时 free 一次', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 1, maxLength: 80 }),
        fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
        (ops, limitArg) => {
          const limit = limitArg ?? DEFAULT_FRAME_CACHE_LIMIT;
          let state: FrameCacheState<Geo> = emptyFrameCache<Geo>();
          const model: Model = { order: [], frames: new Map(), byGeometryKey: new Map() };
          let protectKeys = new Set<FrameKey>();
          let cursorSesno: number | null = null;
          let nextGeoId = 0;
          const created = new Set<Geo>();
          const freeCount = new Map<Geo, number>();

          const checkStep = (effects: FrameCacheEffect<Geo>[], expected: ModelStep, protect: ProtectSet, enforced: boolean): void => {
            const actual = split(effects);
            // evicted 帧序列与参考模型一致（同键重写的 Legacy 快照在前，随后按淘汰顺序）
            expect(actual.evicted.map((f) => f.key)).toEqual(expected.evicted.map((f) => f.key));
            actual.evicted.forEach((f, i) => {
              const e = expected.evicted[i];
              expect(e).toBeDefined();
              expect(f.geometry).toBe(e?.geometry);
              expect(f.legacySnapshotKey ?? null).toBe(e?.legacySnapshotKey ?? null);
            });
            // 因超限被淘汰（不在缓存中了）的键不受保护
            for (const f of actual.evicted) {
              if (getFrame(state, f.key) === null && enforced) expect(protect.keys.has(f.key)).toBe(false);
            }
            // free-geometry 集合一致，且被 free 的几何不再被任何键引用
            expect(byId(actual.freed)).toEqual(byId(expected.freed));
            const live = new Set([...state.frames.values()].map((f) => f.geometry));
            for (const g of actual.freed) {
              expect(live.has(g)).toBe(false);
              freeCount.set(g, (freeCount.get(g) ?? 0) + 1);
              expect(freeCount.get(g)).toBe(1);
            }
            // 超限：只有当剩余键全部受保护时才允许
            if (enforced && state.order.length > limit) {
              for (const k of state.order) expect(protect.keys.has(k)).toBe(true);
            }
          };

          const checkState = (): void => {
            expect([...state.order]).toEqual(model.order);
            expect(new Set(state.frames.keys())).toEqual(new Set(model.order));
            const byGk = new Map<string, Geo>();
            for (const k of model.order) {
              const actual = getFrame(state, k);
              const expected = model.frames.get(k);
              expect(actual).not.toBeNull();
              expect(actual?.geometry).toBe(expected?.geometry);
              expect(actual?.geometryKey).toBe(expected?.geometryKey);
              expect(actual?.sesno).toBe(expected?.sesno);
              expect(actual?.legacySnapshotKey ?? null).toBe(expected?.legacySnapshotKey ?? null);
              if (actual && actual.geometryKey !== null) {
                const seen = byGk.get(actual.geometryKey);
                if (seen === undefined) byGk.set(actual.geometryKey, actual.geometry);
                else expect(actual.geometry).toBe(seen);
              }
            }
            // 几何份数 = 被引用的不同几何对象数（同 geometryKey 只存一份）
            const distinct = new Set([...state.frames.values()].map((f) => f.geometry));
            expect(state.slots.size).toBe(distinct.size);
          };

          for (const op of ops) {
            const protect: ProtectSet = { keys: protectKeys, cursorSesno };
            switch (op.kind) {
              case 'put': {
                const k = keyAt(op.keyIdx);
                const geometry: Geo = { id: nextGeoId++ };
                created.add(geometry);
                const frame: CachedFrame<Geo> = {
                  ...k,
                  sessionTime: null,
                  geometryKey: op.geometryKey,
                  geometry,
                  ...(op.snap === undefined ? {} : { legacySnapshotKey: op.snap }),
                };
                const expected = modelPut(model, frame, protect, limit);
                const r = putFrame(state, frame, protect, limitArg);
                state = r.state;
                checkStep(r.effects, expected, protect, true);
                break;
              }
              case 'putShared': {
                const k = keyAt(op.keyIdx);
                const from = keyAt(op.fromIdx).key;
                // 304 只在 If-None-Match 命中 sharedFrom 的 geometryKey 时出现
                const sourceGk = model.frames.get(from)?.geometryKey ?? null;
                const meta: Omit<CachedFrame<Geo>, 'geometry'> = {
                  ...k,
                  sessionTime: null,
                  geometryKey: sourceGk,
                  ...(op.snap === undefined ? {} : { legacySnapshotKey: op.snap }),
                };
                const prev = state;
                const expected = modelPutShared(model, meta, from, protect, limit);
                const r = putSharedFrame(state, meta, from, protect, limitArg);
                if (!prev.frames.has(from)) {
                  expect(r.state).toBe(prev);
                  expect(r.effects).toEqual([]);
                }
                state = r.state;
                checkStep(r.effects, expected, protect, true);
                break;
              }
              case 'touch': {
                const key = keyAt(op.keyIdx).key;
                if (model.frames.has(key)) model.order = [...model.order.filter((x) => x !== key), key];
                state = touchFrame(state, key);
                break;
              }
              case 'trim': {
                const expected = modelTrim(model, protect, limit);
                const r = trimFrames(state, protect, limitArg);
                state = r.state;
                checkStep(r.effects, expected, protect, true);
                break;
              }
              case 'clear': {
                const expected = modelClear(model);
                const r = clearFrames(state);
                state = r.state;
                checkStep(r.effects, expected, protect, false);
                expect(state.frames.size).toBe(0);
                expect(state.slots.size).toBe(0);
                break;
              }
              case 'protect':
                protectKeys = new Set(op.keyIdxs.map((i) => keyAt(i).key));
                break;
              case 'cursor':
                cursorSesno = op.sesno;
                break;
            }
            checkState();
          }

          // 收尾：清空后每份几何恰好被 free 一次
          const finalExpected = modelClear(model);
          const r = clearFrames(state);
          state = r.state;
          checkStep(r.effects, finalExpected, { keys: protectKeys, cursorSesno }, false);
          for (const g of created) expect(freeCount.get(g)).toBe(1);
          expect(freeCount.size).toBe(created.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});
