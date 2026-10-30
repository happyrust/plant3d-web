import { describe, expect, it, vi } from 'vitest';

import { useVersionFrames, type BrowseContext } from './useVersionFrames';

import type {
  HistoryGeometryRequest,
  HistoryGeometryResult,
  ModelNodeDiffScope,
  ModelNodeDiffSummary,
  ModelVersionGeometry,
  ModelVersionSource,
} from '@/model-source';
import type { DwellSchedule } from '@/utils/versionScrub/dwellGate';
import type { Pins } from '@/utils/versionScrub/pins';
import type { ModelUnitCompareBrowseApi, ModelUnitCompareController } from '@/viewer/modelUnitCompareController';

import { HistoryQueryError, ModelVersionRouteUnavailableError } from '@/model-source/modelVersionErrors';

/**
 * `useVersionFrames`（tasks.md 14.16 例子测试）：取数时机、装载一致性、失败标记、忙重试、子树确认与降级。
 *
 * 调度算法本身（停留门、预取计划、重分配、帧缓存、并发闸、忙重试）都已在 `utils/versionScrub/*` 覆盖；
 * 这里只测组合式函数把它们接起来之后那几件纯函数管不到的事。
 */

/** 手动放行的假计时器：`fire(ms)` 只触发到期的那些 */
function fakeSchedule(): DwellSchedule & { fire(ms: number): void; pending(): number } {
  let next = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const schedule = ((fn: () => void, ms: number) => {
    const id = next++;
    timers.set(id, { fn, ms });
    return () => timers.delete(id);
  }) as unknown as DwellSchedule & { fire(ms: number): void; pending(): number };
  schedule.fire = (ms: number) => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      timers.delete(id);
      timer.fn();
    }
  };
  schedule.pending = () => timers.size;
  return schedule;
}

function geometry(unitRefno: string, sesno: number, geometryKey: string): ModelVersionGeometry {
  return {
    refnos: [`${unitRefno}_1`],
    entries: new Map([[`${unitRefno}_1`, [{
      geo_hash: geometryKey,
      geo_index: 0,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      uniforms: { noun: 'TUBI' },
    } as never]]]),
    geometryKey,
    release: async () => undefined,
  };
}

type Call = { unitRefno: string; sesno: number; ifNoneMatch?: string; signal: AbortSignal };

/** 可编排的来源：`respond` 决定每个请求的结果 */
function sourceWith(respond: (call: Call) => Promise<HistoryGeometryResult>) {
  const calls: Call[] = [];
  const source = {
    queryHistoryGeometry: vi.fn(async (req: HistoryGeometryRequest, opts: { signal: AbortSignal; ifNoneMatch?: string }) => {
      const call: Call = {
        unitRefno: req.unitRefno,
        sesno: 'sesno' in req ? req.sesno : -1,
        signal: opts.signal,
        ...(opts.ifNoneMatch ? { ifNoneMatch: opts.ifNoneMatch } : {}),
      };
      calls.push(call);
      return respond(call);
    }),
    loadVersion: vi.fn(async () => geometry('24384_23257', 1, 'legacy')),
    attributesAt: vi.fn(),
    attributesAtSesno: vi.fn(),
    diffSummary: vi.fn(),
    readRealtimeLimit: vi.fn(async () => 4),
  } as unknown as ModelVersionSource;
  return { source, calls };
}

function controllerStub() {
  const shows: { sesno: number; units: number; diffRows: number | undefined }[] = [];
  const pending: number[] = [];
  const missing: { sesno: number; reason: string }[] = [];
  const badges: string[] = [];
  const api = {
    browseEnter: vi.fn(),
    browseShow: vi.fn(async (frame: { sesno: number; units: unknown[] }, opts?: { diffRows?: unknown[] }) => {
      shows.push({ sesno: frame.sesno, units: frame.units.length, diffRows: opts?.diffRows?.length });
    }),
    browsePending: vi.fn((sesno: number) => { pending.push(sesno); }),
    browseMissing: vi.fn((sesno: number, reason: 'not-yet' | 'deleted') => { missing.push({ sesno, reason }); }),
    browseBadge: vi.fn((text: string) => { badges.push(text); }),
    browseExit: vi.fn(),
    replaceSide: vi.fn(),
    open: vi.fn(async () => undefined),
  } as unknown as ModelUnitCompareBrowseApi & Pick<ModelUnitCompareController, 'open'>;
  return { api, shows, pending, missing, badges };
}

const UNIT = '24384_23257';

function contextOf(overrides: Partial<BrowseContext> = {}): BrowseContext {
  return {
    dbnum: 8000,
    unitRefnos: [UNIT],
    cursor: 10,
    ordered: [10, 12, 15],
    scope: 'self',
    ...overrides,
  };
}

/** 让挂起的 Promise 走完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function ok(call: Call, key = `g${call.sesno}`): Promise<HistoryGeometryResult> {
  return Promise.resolve({
    kind: 'ok',
    sesno: call.sesno,
    sessionTime: `2026-09-${String(call.sesno).padStart(2, '0')}T00:00:00Z`,
    geometryKey: key,
    geometry: geometry(call.unitRefno, call.sesno, key),
  });
}

function setup(options: {
  respond?: (call: Call) => Promise<HistoryGeometryResult>;
  ctx?: Partial<BrowseContext>;
} = {}) {
  const schedule = fakeSchedule();
  const { source, calls } = sourceWith(options.respond ?? ((call) => ok(call)));
  const stub = controllerStub();
  const frames = useVersionFrames({ source, controller: stub.api, schedule, sleep: async () => undefined });
  return { frames, source, calls, schedule, ...stub };
}

describe('useVersionFrames：取数时机（Requirement 3.3、3.4、3.5）', () => {
  it('进入浏览立刻取游标那一版，角标先「正在加载」', async () => {
    const { frames, calls, pending, shows } = setup();
    await frames.enterBrowse(contextOf());

    expect(calls.map((c) => c.sesno)).toEqual([10]);
    expect(pending).toEqual([10]);
    expect(shows).toEqual([{ sesno: 10, units: 1, diffRows: undefined }]);
    expect(frames.tickStatus.value.get(10)).toBeUndefined();
  });

  it('拖动经 150 ms 门；期间经过的刻度不发请求', async () => {
    const { frames, calls, schedule } = setup();
    await frames.enterBrowse(contextOf());
    calls.length = 0;

    frames.cursorChanged(12, 'drag');
    frames.cursorChanged(15, 'drag');
    expect(calls).toHaveLength(0);

    schedule.fire(150);
    expect(calls.map((c) => c.sesno)).toEqual([15]);
  });

  it('松开 / 点击 / 方向键立即请求，不等门', async () => {
    for (const trigger of ['release', 'click', 'key'] as const) {
      const { frames, calls } = setup();
      await frames.enterBrowse(contextOf());
      calls.length = 0;

      frames.cursorChanged(12, trigger);
      await settle();
      expect(calls.map((c) => c.sesno), trigger).toEqual([12]);
    }
  });

  it('缓存里已有这一版：直接装，不再发请求', async () => {
    const { frames, calls, shows } = setup();
    await frames.enterBrowse(contextOf());
    frames.cursorChanged(12, 'click');
    await settle();
    expect(calls.map((c) => c.sesno)).toEqual([10, 12]);

    calls.length = 0;
    shows.length = 0;
    frames.cursorChanged(10, 'click');
    await settle();
    expect(calls).toHaveLength(0);
    expect(shows[0]?.sesno).toBe(10);
  });

  it('完成时游标已移走：只写缓存，不装入（3.7）', async () => {
    let release!: (value: HistoryGeometryResult) => void;
    const { frames, shows } = setup({
      respond: (call) => (call.sesno === 10
        ? new Promise<HistoryGeometryResult>((resolve) => { release = resolve; })
        : ok(call)),
    });
    void frames.enterBrowse(contextOf());
    frames.cursorChanged(12, 'click');
    await settle();
    expect(shows.map((s) => s.sesno)).toEqual([12]);

    release({ kind: 'ok', sesno: 10, sessionTime: null, geometryKey: 'g10', geometry: geometry(UNIT, 10, 'g10') });
    await settle();
    // 10 的请求回来了但游标在 12：没有再装一次 10
    expect(shows.map((s) => s.sesno)).toEqual([12]);

    // 再拖回 10 时直接从缓存装
    frames.cursorChanged(10, 'click');
    await settle();
    expect(shows.map((s) => s.sesno)).toEqual([12, 10]);
  });
});

describe('useVersionFrames：失败与重试（Requirement 3.12、3.13、4.9）', () => {
  it('游标请求失败：标刻度失败、记错误、视口不动', async () => {
    const { frames, shows } = setup({
      respond: (call) => (call.sesno === 12
        ? Promise.reject(new HistoryQueryError('HISTORY_QUERY_TIMEOUT', { status: 504, message: '查询超时' }))
        : ok(call)),
    });
    await frames.enterBrowse(contextOf());
    shows.length = 0;

    frames.cursorChanged(12, 'click');
    await settle();

    expect(frames.tickStatus.value.get(12)).toBe('failed');
    expect(frames.errors.value).toEqual([{ sesno: 12, unitRefno: UNIT, code: 'HISTORY_QUERY_TIMEOUT', message: '查询超时' }]);
    expect(shows).toHaveLength(0);
  });

  it('retry 清掉失败标记并重发', async () => {
    let fail = true;
    const { frames, calls } = setup({
      respond: (call) => {
        if (call.sesno === 12 && fail) return Promise.reject(new HistoryQueryError('NETWORK', { message: '无法连接服务端' }));
        return ok(call);
      },
    });
    await frames.enterBrowse(contextOf());
    frames.cursorChanged(12, 'click');
    await settle();
    expect(frames.tickStatus.value.get(12)).toBe('failed');

    fail = false;
    calls.length = 0;
    frames.retry(12);
    await settle();

    expect(frames.tickStatus.value.get(12)).toBeUndefined();
    expect(frames.errors.value).toHaveLength(0);
    expect(calls.map((c) => c.sesno)).toEqual([12]);
  });

  it('预取遇忙不标失败；预取其他错误标失败', async () => {
    const busyThen = (call: Call) => (call.sesno === 12
      ? Promise.reject(new HistoryQueryError('HISTORY_BUSY', { status: 503, retryAfterMs: 1000 }))
      : Promise.reject(new HistoryQueryError('HISTORY_QUERY_TIMEOUT', { status: 504 })));
    const { frames, schedule } = setup({ respond: busyThen });
    await frames.enterBrowse(contextOf());
    // 让预取真正跑起来：等游标请求结束后 300 ms 门
    schedule.fire(300);
    await settle();

    // 12 是忙 → 不标失败；15 是超时 → 标失败
    expect(frames.tickStatus.value.get(12)).toBeUndefined();
    expect(frames.tickStatus.value.get(15)).toBe('failed');
  });
});

describe('useVersionFrames：游标请求忙重试（Requirement 3.16）', () => {
  it('重试 3 次后成功：期间角标保持「正在加载」，最终不标失败', async () => {
    let attempts = 0;
    const { frames, pending } = setup({
      respond: (call) => {
        if (call.sesno !== 10) return ok(call);
        attempts += 1;
        if (attempts <= 3) return Promise.reject(new HistoryQueryError('HISTORY_BUSY', { status: 503, retryAfterMs: 1000 }));
        return ok(call);
      },
    });
    await frames.enterBrowse(contextOf());

    expect(attempts).toBe(4);
    expect(pending).toEqual([10]);
    expect(frames.tickStatus.value.get(10)).toBeUndefined();
    expect(frames.errors.value).toHaveLength(0);
  });

  it('重试用尽仍忙：按失败处理', async () => {
    const { frames } = setup({
      respond: (call) => (call.sesno === 10
        ? Promise.reject(new HistoryQueryError('HISTORY_BUSY', { status: 503, retryAfterMs: 1000 }))
        : ok(call)),
    });
    await frames.enterBrowse(contextOf());

    expect(frames.tickStatus.value.get(10)).toBe('failed');
    expect(frames.errors.value[0]?.code).toBe('HISTORY_BUSY');
  });

  it('等待期间游标移走：该请求转预取继续执行，但不再标失败、不装入', async () => {
    let attempts = 0;
    let releaseWait!: () => void;
    const waitGate = new Promise<void>((resolve) => { releaseWait = resolve; });
    const schedule = fakeSchedule();
    const { source } = sourceWith((call) => {
      if (call.sesno !== 10) return ok(call);
      attempts += 1;
      return Promise.reject(new HistoryQueryError('HISTORY_BUSY', { status: 503, retryAfterMs: 1000 }));
    });
    const stub = controllerStub();
    const frames = useVersionFrames({ source, controller: stub.api, schedule, sleep: () => waitGate });

    void frames.enterBrowse(contextOf());
    await settle();
    expect(attempts).toBe(1);

    frames.cursorChanged(15, 'click');
    await settle();
    releaseWait();
    await settle();
    schedule.fire(150);
    await settle();

    // 3.16 第 15 条：转成预取的请求继续执行（含重试），所以确实又发了一次
    expect(attempts).toBe(2);
    // 预取遇忙不标失败（4.11），也不装入视口
    expect(frames.tickStatus.value.get(10)).toBeUndefined();
    expect(stub.shows.map((s) => s.sesno)).not.toContain(10);
  });
});

describe('useVersionFrames：UNIT_NOT_PRESENT（Requirement 3.11）', () => {
  it('两种原因都缓存空帧并在装入时 browseMissing', async () => {
    for (const reason of ['not-yet', 'deleted'] as const) {
      const { frames, missing } = setup({
        respond: (call) => (call.sesno === 12
          ? Promise.reject(new HistoryQueryError('UNIT_NOT_PRESENT', { status: 404, reason }))
          : ok(call)),
      });
      await frames.enterBrowse(contextOf());
      frames.cursorChanged(12, 'click');
      await settle();

      expect(missing).toEqual([{ sesno: 12, reason }]);
      // 不是失败
      expect(frames.tickStatus.value.get(12)).toBeUndefined();
      expect(frames.errors.value).toHaveLength(0);
    }
  });
});

describe('useVersionFrames：304 与 If-None-Match（Requirement 4.10）', () => {
  it('视口已装入同单元时带 If-None-Match；304 与已装入帧共用几何', async () => {
    const { frames, calls, shows } = setup({
      respond: (call) => (call.ifNoneMatch
        ? Promise.resolve({ kind: 'not-modified', sesno: call.sesno, sessionTime: null, geometryKey: call.ifNoneMatch })
        : ok(call)),
    });
    await frames.enterBrowse(contextOf());
    frames.cursorChanged(12, 'click');
    await settle();

    expect(calls[1]?.ifNoneMatch).toBe('g10');
    expect(shows.map((s) => s.sesno)).toEqual([10, 12]);
    expect(frames.debug.value.cacheKeys).toBe(2);
  });
});

describe('useVersionFrames：单钉着色（Requirement 5.4）', () => {
  it('只有一个钉时算四态行交给 browseShow；游标等于钉时全为未变', async () => {
    const { frames, shows } = setup();
    await frames.enterBrowse(contextOf());
    frames.cursorChanged(12, 'click');
    await settle();

    const pins: Pins = { a: 10, b: null };
    frames.pinsChanged(pins);
    await settle();
    // 钉 10 与游标 12 的几何键不同 → 有 diffRows
    expect(shows.at(-1)?.diffRows).toBe(1);

    frames.cursorChanged(10, 'click');
    await settle();
    expect(shows.at(-1)?.sesno).toBe(10);
    expect(shows.at(-1)?.diffRows).toBe(1);

    frames.pinsChanged({ a: null, b: null });
    await settle();
    expect(shows.at(-1)?.diffRows).toBeUndefined();
  });
});

/** 子树差异摘要的样例：`loadUnits` 的单元来源 */
function summaryWith(
  groups: { unitRefno: string; added: number; deleted: number; modified: number }[],
  needsConfirm = false,
): ModelNodeDiffSummary {
  return {
    dbnum: 8000,
    refno: UNIT,
    noun: 'ZONE',
    scope: 'subtree' as ModelNodeDiffScope,
    a: 10,
    b: 15,
    units: { changed: groups.length, unchanged: 0, total: groups.length, complete: true },
    elements: { added: 0, deleted: 0, modified: 0, noop: 0 },
    groups: groups.map((group) => ({
      unitRefno: group.unitRefno,
      unitNoun: 'BRAN',
      unitName: group.unitRefno,
      counts: { added: group.added, deleted: group.deleted, modified: group.modified, noop: 0 },
      geometryChanged: true,
      rows: [],
      rowsTruncated: 0,
    })),
    needsConfirm,
    estimatedProjections: groups.length,
    confirmThresholdUnits: 2,
    warnings: [],
  };
}

describe('useVersionFrames：子树范围（Requirement 9.2、9.3、9.6、9.7、9.8）', () => {
  it('游标就是最新版：不装任何帧，角标「最新版本，无历史差异」', async () => {
    const { frames, calls, badges } = setup();
    await frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 15, latest: 15, ordered: [10, 12, 15] }));

    expect(calls).toHaveLength(0);
    expect(badges.at(-1)).toContain('最新版本，无历史差异');
  });

  it('load：按差异摘要的单元逐个装入', async () => {
    const { frames, source, calls } = setup();
    (source.diffSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summaryWith([
      { unitRefno: UNIT, added: 1, deleted: 0, modified: 0 },
    ]));
    await frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 10, latest: 15 }));

    expect(source.diffSummary).toHaveBeenCalledWith(8000, UNIT, 10, 15, 'subtree');
    expect(calls.map((c) => c.sesno)).toEqual([10]);
  });

  it('confirm：置 pendingConfirm；取消不发请求，角标「未加载（已取消）」', async () => {
    const { frames, source, calls, badges } = setup();
    (source.diffSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summaryWith(
      [1, 2, 3].map((i) => ({ unitRefno: `unit_${i}`, added: i, deleted: 0, modified: 0 })),
      true,
    ));
    await frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 10, latest: 15, unitRefnos: [] }));

    expect(frames.pendingConfirm.value?.kind).toBe('confirm');
    expect(calls).toHaveLength(0);
    expect(badges.at(-1)).toContain('等待确认');

    frames.answerConfirm('cancel');
    expect(calls).toHaveLength(0);
    expect(badges.at(-1)).toContain('未加载（已取消）');
  });

  it('差异摘要失败：不发任何几何请求，记错误', async () => {
    const { frames, source, calls } = setup();
    (source.diffSummary as ReturnType<typeof vi.fn>).mockRejectedValue(
      new HistoryQueryError('HISTORY_QUERY_TIMEOUT', { status: 504, message: '查询超时' }),
    );
    await frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 10, latest: 15 }));

    expect(calls).toHaveLength(0);
    expect(frames.tickStatus.value.get(10)).toBe('failed');
    expect(frames.errors.value[0]?.code).toBe('HISTORY_QUERY_TIMEOUT');
  });

  it('部分失败：成功单元照常显示，失败单元列出', async () => {
    const { frames, source } = setup({
      respond: (call) => (call.unitRefno === 'unit_2'
        ? Promise.reject(new HistoryQueryError('HISTORY_QUERY_TIMEOUT', { status: 504 }))
        : ok(call)),
    });
    (source.diffSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summaryWith([
      { unitRefno: 'unit_1', added: 1, deleted: 0, modified: 0 },
      { unitRefno: 'unit_2', added: 1, deleted: 0, modified: 0 },
    ]));
    await frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 10, latest: 15, unitRefnos: ['unit_1', 'unit_2'] }));

    expect(frames.errors.value).toEqual([{ sesno: 10, unitRefno: 'unit_2', code: 'HISTORY_QUERY_TIMEOUT', message: expect.any(String) }]);
    expect(frames.tickStatus.value.get(10)).toBe('failed');
  });

  it('子树单元回 304 但本地无几何：算失败，不当成功', async () => {
    // `fetchUnitAt` 只在缓存里没有这一帧时才发起，此时 304 没有可复用的本地几何。
    // 原实现 `if (result.kind !== 'ok') return` 把它当成功：`failed` 恒为 0，
    // 角标说「全部加载成功」而实际一帧都没装。
    const { frames, source } = setup({
      respond: (call) => Promise.resolve({
        kind: 'not-modified' as const,
        sesno: call.sesno,
        sessionTime: null,
        geometryKey: 'sha256:304',
      }),
    });
    (source.diffSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summaryWith([
      { unitRefno: 'unit_1', added: 1, deleted: 0, modified: 0 },
    ]));
    await frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 10, latest: 15, unitRefnos: ['unit_1'] }));

    expect(frames.errors.value).toHaveLength(1);
    expect(frames.errors.value[0]?.unitRefno).toBe('unit_1');
    expect(frames.errors.value[0]?.code).toBe('INVALID_RESPONSE');
    expect(frames.tickStatus.value.get(10)).toBe('failed');
  });
});

describe('useVersionFrames：旧服务端降级（Requirement 10.1、10.5、10.6）', () => {
  it('实时路由缺失：置 legacyFallback 并改走 loadVersion', async () => {
    const { frames, source, calls } = setup({
      respond: () => Promise.reject(new ModelVersionRouteUnavailableError('model/history/geometry')),
    });
    await frames.enterBrowse(contextOf());

    expect(frames.legacyFallback.value).toBe(true);
    expect(source.loadVersion).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(frames.errors.value).toHaveLength(0);
  });

  it('非 404 错误不降级', async () => {
    const { frames, source } = setup({
      respond: () => Promise.reject(new HistoryQueryError('NETWORK', { message: '无法连接服务端' })),
    });
    await frames.enterBrowse(contextOf());

    expect(frames.legacyFallback.value).toBe(false);
    expect(source.loadVersion).not.toHaveBeenCalled();
    expect(frames.errors.value[0]?.code).toBe('NETWORK');
  });

  it('退出时清空缓存并还原', async () => {
    const { frames, api } = setup();
    await frames.enterBrowse(contextOf());
    expect(frames.debug.value.cacheKeys).toBe(1);

    await frames.exitBrowse();
    expect(frames.mode.value).toBe('idle');
    expect(frames.debug.value.cacheKeys).toBe(0);
    expect(api.browseExit).toHaveBeenCalled();
  });
});

describe('useVersionFrames：退出中止全部请求（Requirement 4.6）', () => {
  it('进行中的请求被 abort，不标失败', async () => {
    let signal!: AbortSignal;
    const { frames } = setup({
      respond: (call) => {
        signal = call.signal;
        return new Promise<HistoryGeometryResult>(() => undefined);
      },
    });
    void frames.enterBrowse(contextOf());
    await settle();
    await frames.exitBrowse();

    expect(signal.aborted).toBe(true);
    expect(frames.errors.value).toHaveLength(0);
  });

  it('子树请求也被 abort，且退出后不再落地', async () => {
    // `inFlight` 只装游标/预取请求，子树请求另记一份。原先 `exitBrowse` 只 abort `inFlight`，
    // 退出后子树请求继续跑，回来后 `commit` 把帧写进已清空的缓存。
    const signals: AbortSignal[] = [];
    const { frames, source } = setup({
      respond: (call) => {
        signals.push(call.signal);
        return new Promise<HistoryGeometryResult>(() => undefined);
      },
    });
    (source.diffSummary as ReturnType<typeof vi.fn>).mockResolvedValue(summaryWith([
      { unitRefno: 'unit_1', added: 1, deleted: 0, modified: 0 },
    ]));
    void frames.enterBrowse(contextOf({ scope: 'subtree', cursor: 10, latest: 15, unitRefnos: ['unit_1'] }));
    await settle();
    expect(signals.length).toBeGreaterThan(0);

    await frames.exitBrowse();

    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(frames.errors.value).toHaveLength(0);
    expect(frames.debug.value.cacheKeys).toBe(0);
  });
});
