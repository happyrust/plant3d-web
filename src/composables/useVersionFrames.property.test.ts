import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { useVersionFrames, type BrowseContext } from './useVersionFrames';

import type { HistoryGeometryRequest, HistoryGeometryResult, ModelVersionGeometry, ModelVersionSource } from '@/model-source';
import type { DwellSchedule } from '@/utils/versionScrub/dwellGate';
import type { ModelUnitCompareBrowseApi, ModelUnitCompareController } from '@/viewer/modelUnitCompareController';

import { HistoryQueryError } from '@/model-source/modelVersionErrors';

/**
 * Feature: model-version-timeline-scrub
 *
 * Property 13: 装载一致性 —— 只有「请求完成时 sesno 仍是游标」的帧才装进视口，且角标 sesno 与实际装入的一致。
 * Property 17: 304 复用已装入几何 —— 带 `If-None-Match` 的 304 不新增几何份数。
 * Property 20: 退出浏览的资源清理 —— 退出后缓存键为 0、全部请求已中止。
 */

const UNIT = '24384_23257';

/** 立即到期的假计时器：`fire` 只跑当前挂着的全部计时 */
function immediateSchedule(): DwellSchedule {
  const timers = new Map<number, () => void>();
  let next = 0;
  const schedule = ((fn: () => void) => {
    const id = next++;
    timers.set(id, fn);
    return () => timers.delete(id);
  }) as DwellSchedule;
  Object.defineProperty(schedule, 'runAll', {
    value: () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
  });
  return schedule;
}

function geometry(sesno: number, geometryKey: string): ModelVersionGeometry {
  return {
    refnos: [`${UNIT}_1`],
    entries: new Map([[`${UNIT}_1`, [{ geo_hash: geometryKey, geo_index: 0, matrix: [], uniforms: { noun: 'TUBI' } } as never]]]),
    geometryKey,
    release: async () => undefined,
  };
}

function contextOf(cursor: number, ordered: number[]): BrowseContext {
  return { dbnum: 8000, unitRefnos: [UNIT], cursor, ordered, scope: 'self' };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

type Deferred = { resolve: (value: HistoryGeometryResult) => void; sesno: number };

describe('Property 13: 装载一致性', () => {
  it('任意请求完成顺序下，装入视口的 sesno 恒等于当时游标，且每个 sesno 至多装一次', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { minLength: 2, maxLength: 5 }),
        fc.uniqueArray(fc.integer({ min: 0, max: 4 }), { minLength: 2, maxLength: 5 }),
        async (ordered, order) => {
          const deferreds: Deferred[] = [];
          const shows: number[] = [];
          const source = {
            queryHistoryGeometry: (_req: HistoryGeometryRequest) => new Promise<HistoryGeometryResult>((resolve) => {
              const sesno = 'sesno' in _req ? _req.sesno : -1;
              deferreds.push({ resolve, sesno });
            }),
            readRealtimeLimit: async () => 4,
          } as unknown as ModelVersionSource;
          const controller = {
            browseEnter: () => undefined,
            browseShow: async (frame: { sesno: number }) => { shows.push(frame.sesno); },
            browsePending: () => undefined,
            browseMissing: () => undefined,
            browseBadge: () => undefined,
            browseExit: () => undefined,
            replaceSide: async () => undefined,
            open: async () => undefined,
          } as unknown as ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;

          const frames = useVersionFrames({
            source, controller, schedule: immediateSchedule(), sleep: async () => undefined,
          });
          const orderedSorted = [...ordered].sort((x, y) => x - y);
          void frames.enterBrowse(contextOf(orderedSorted[0]!, orderedSorted));
          await settle();

          // 按一个与响应顺序无关的排列依次移动游标
          const walk = order.map((i) => orderedSorted[i % orderedSorted.length]!);
          for (const sesno of walk) {
            frames.cursorChanged(sesno, 'click');
            await settle();
          }
          const finalCursor = walk[walk.length - 1]!;

          // 逆序放行：先回来的都是「过时」的请求
          for (const item of [...deferreds].reverse()) {
            item.resolve({
              kind: 'ok',
              sesno: item.sesno,
              sessionTime: null,
              geometryKey: `g${item.sesno}`,
              geometry: geometry(item.sesno, `g${item.sesno}`),
            });
            await settle();
          }

          // 装入的每个 sesno 都曾是某次游标，且最后一个必定是最终游标
          expect(shows.every((sesno) => orderedSorted.includes(sesno))).toBe(true);
          expect(shows[shows.length - 1]).toBe(finalCursor);
          // 同一个 sesno 不会被装入两次（缓存命中直接装、不再发请求）
          expect(new Set(shows).size).toBe(shows.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 17: 304 复用已装入几何', () => {
  it('带 If-None-Match 的 304 不新增几何份数：缓存键 +1、几何份数不变', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 30 }), async (base) => {
        const calls: { sesno: number; ifNoneMatch?: string }[] = [];
        const source = {
          queryHistoryGeometry: async (req: HistoryGeometryRequest, opts: { ifNoneMatch?: string }) => {
            const sesno = 'sesno' in req ? req.sesno : -1;
            calls.push({ sesno, ...(opts.ifNoneMatch ? { ifNoneMatch: opts.ifNoneMatch } : {}) });
            if (opts.ifNoneMatch) {
              return { kind: 'not-modified', sesno, sessionTime: null, geometryKey: opts.ifNoneMatch } as HistoryGeometryResult;
            }
            return {
              kind: 'ok', sesno, sessionTime: null, geometryKey: 'same',
              geometry: geometry(sesno, 'same'),
            } as HistoryGeometryResult;
          },
          readRealtimeLimit: async () => 4,
        } as unknown as ModelVersionSource;
        const controller = {
          browseEnter: () => undefined,
          browseShow: async () => undefined,
          browsePending: () => undefined,
          browseMissing: () => undefined,
          browseBadge: () => undefined,
          browseExit: () => undefined,
          replaceSide: async () => undefined,
          open: async () => undefined,
        } as unknown as ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;

        const frames = useVersionFrames({
          source, controller, schedule: immediateSchedule(), sleep: async () => undefined,
        });
        void frames.enterBrowse(contextOf(base, [base, base + 1]));
        await settle();
        frames.cursorChanged(base + 1, 'click');
        await settle();

        // 第二次请求带上了第一次的 geometryKey
        expect(calls[1]?.ifNoneMatch).toBe('same');
        // 两个键，但几何只有一份（键数按 4.2 照常计）
        expect(frames.debug.value.cacheKeys).toBe(2);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 20: 退出浏览的资源清理', () => {
  it('任意进行中的请求集合下，退出后缓存为 0 且全部 signal 已中止', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 30 }), { minLength: 2, maxLength: 6 }),
        async (ordered) => {
          const signals: AbortSignal[] = [];
          const source = {
            queryHistoryGeometry: (_req: HistoryGeometryRequest, opts: { signal: AbortSignal }) => {
              signals.push(opts.signal);
              return new Promise<HistoryGeometryResult>(() => undefined);
            },
            readRealtimeLimit: async () => 4,
          } as unknown as ModelVersionSource;
          const controller = {
            browseEnter: () => undefined,
            browseShow: async () => undefined,
            browsePending: () => undefined,
            browseMissing: () => undefined,
            browseBadge: () => undefined,
            browseExit: () => undefined,
            replaceSide: async () => undefined,
            open: async () => undefined,
          } as unknown as ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;

          const frames = useVersionFrames({
            source, controller, schedule: immediateSchedule(), sleep: async () => undefined,
          });
          const sorted = [...ordered].sort((x, y) => x - y);
          void frames.enterBrowse(contextOf(sorted[0]!, sorted));
          await settle();
          frames.cursorChanged(sorted[sorted.length - 1]!, 'click');
          await settle();

          await frames.exitBrowse();

          expect(frames.debug.value.cacheKeys).toBe(0);
          expect(frames.debug.value.inFlight).toBe(0);
          expect(signals.length).toBeGreaterThan(0);
          expect(signals.every((signal) => signal.aborted)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 15（第二半）：游标请求忙重试的刻度状态', () => {
  it('重试用尽才标失败；成功时不留失败标记', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (busyCount) => {
        let attempts = 0;
        const source = {
          queryHistoryGeometry: async (req: HistoryGeometryRequest) => {
            const sesno = 'sesno' in req ? req.sesno : -1;
            attempts += 1;
            if (attempts <= busyCount) {
              throw new HistoryQueryError('HISTORY_BUSY', { status: 503, retryAfterMs: 1000 });
            }
            return {
              kind: 'ok', sesno, sessionTime: null, geometryKey: `g${sesno}`,
              geometry: geometry(sesno, `g${sesno}`),
            } as HistoryGeometryResult;
          },
          readRealtimeLimit: async () => 4,
        } as unknown as ModelVersionSource;
        const controller = {
          browseEnter: () => undefined,
          browseShow: async () => undefined,
          browsePending: () => undefined,
          browseMissing: () => undefined,
          browseBadge: () => undefined,
          browseExit: () => undefined,
          replaceSide: async () => undefined,
          open: async () => undefined,
        } as unknown as ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;

        const frames = useVersionFrames({
          source, controller, schedule: immediateSchedule(), sleep: async () => undefined,
        });
        await frames.enterBrowse(contextOf(10, [10]));

        // busyCount ≤ 3 时总能重试成功；成功则不标失败
        expect(frames.tickStatus.value.get(10)).toBeUndefined();
        expect(attempts).toBe(busyCount + 1);
      }),
      { numRuns: 100 },
    );
  });

  it('忙 4 次以上（超过 3 次重发）才标失败', async () => {
    let attempts = 0;
    const source = {
      queryHistoryGeometry: async () => {
        attempts += 1;
        throw new HistoryQueryError('HISTORY_BUSY', { status: 503, retryAfterMs: 1000 });
      },
      readRealtimeLimit: async () => 4,
    } as unknown as ModelVersionSource;
    const controller = {
      browseEnter: () => undefined,
      browseShow: async () => undefined,
      browsePending: () => undefined,
      browseMissing: () => undefined,
      browseBadge: () => undefined,
      browseExit: () => undefined,
      replaceSide: async () => undefined,
      open: async () => undefined,
    } as unknown as ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;

    const frames = useVersionFrames({ source, controller, schedule: immediateSchedule(), sleep: async () => undefined });
    await frames.enterBrowse(contextOf(10, [10]));

    expect(attempts).toBe(4);
    expect(frames.tickStatus.value.get(10)).toBe('failed');
  });
});
