import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { createDwellGate, CURSOR_DWELL_MS, type DwellSchedule } from './dwellGate';

/** 可控假时钟：按到期时间（同刻按安排顺序）执行计时器。 */
function createFakeClock() {
  let now = 0;
  let seq = 0;
  const timers: { due: number; seq: number; fn: () => void; cancelled: boolean }[] = [];

  const schedule: DwellSchedule = (fn, ms) => {
    const timer = { due: now + ms, seq: seq++, fn, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };

  /** 把时钟推进到 target，途中依次执行到期计时器（执行时 now 为到期时刻）。 */
  const advanceTo = (target: number): void => {
    for (;;) {
      const live = timers.filter((t) => !t.cancelled && t.due <= target);
      if (live.length === 0) break;
      live.sort((a, b) => a.due - b.due || a.seq - b.seq);
      const next = live[0];
      if (!next) break;
      next.cancelled = true;
      now = next.due;
      next.fn();
    }
    now = target;
  };

  return { schedule, advanceTo, now: () => now };
}

type GateEvent =
  | { kind: 'snap'; sesno: number; dt: number }
  | { kind: 'flush'; sesno: number; dt: number }
  | { kind: 'dispose'; dt: number };

type Fired = { sesno: number; at: number };

/** 间隔集中在 150 ms 边界附近，也覆盖短促拖动与长停留。 */
const dtArb = fc.oneof(
  fc.integer({ min: 0, max: CURSOR_DWELL_MS - 1 }),
  fc.constantFrom(CURSOR_DWELL_MS - 1, CURSOR_DWELL_MS, CURSOR_DWELL_MS + 1),
  fc.integer({ min: 0, max: CURSOR_DWELL_MS * 3 }),
);

/** 刻度取值范围小，让「再吸附到同一刻度」经常出现。 */
const sesnoArb = fc.integer({ min: 1, max: 4 });

const eventArb: fc.Arbitrary<GateEvent> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ kind: fc.constant('snap' as const), sesno: sesnoArb, dt: dtArb }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('flush' as const), sesno: sesnoArb, dt: dtArb }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('dispose' as const), dt: dtArb }) },
);

/**
 * 参考模型：吸附到新刻度时记下起点；时钟走到「起点 + delay」仍停在该刻度就触发一次。
 * 同刻度再吸附不改起点；flush 取消计时并立即触发；dispose 后一切无效。
 * 时刻相同时，先结算到期的停留，再处理该时刻的事件（停满恰好 delay 也算停够）。
 */
function referenceFires(events: GateEvent[], delayMs: number): Fired[] {
  const fired: Fired[] = [];
  let now = 0;
  let current: number | null = null;
  let pendingStart: number | null = null;
  let disposed = false;

  const settle = (target: number): void => {
    if (pendingStart !== null && current !== null && pendingStart + delayMs <= target) {
      fired.push({ sesno: current, at: pendingStart + delayMs });
      pendingStart = null;
    }
  };

  for (const ev of events) {
    now += ev.dt;
    settle(now);
    if (disposed) continue;
    if (ev.kind === 'snap') {
      if (ev.sesno === current) continue;
      current = ev.sesno;
      pendingStart = now;
    } else if (ev.kind === 'flush') {
      pendingStart = null;
      current = ev.sesno;
      fired.push({ sesno: ev.sesno, at: now });
    } else {
      disposed = true;
      pendingStart = null;
      current = null;
    }
  }
  settle(Number.POSITIVE_INFINITY);
  return fired;
}

function runGate(events: GateEvent[], delayMs: number): Fired[] {
  const clock = createFakeClock();
  const fired: Fired[] = [];
  const gate = createDwellGate({
    delayMs,
    schedule: clock.schedule,
    fire: (sesno) => fired.push({ sesno, at: clock.now() }),
  });

  let t = 0;
  for (const ev of events) {
    t += ev.dt;
    clock.advanceTo(t);
    if (ev.kind === 'snap') gate.onSnap(ev.sesno);
    else if (ev.kind === 'flush') gate.flush(ev.sesno);
    else gate.dispose();
  }
  // 排空：最后一次吸附之后无限停留
  clock.advanceTo(t + delayMs * 10);
  return fired;
}

describe('dwellGate property', () => {
  // Feature: model-version-timeline-scrub, Property 12: 拖动停留门
  // **Validates: Requirements 3.3**
  it('Property 12: 150 ms 门只触发停满的刻度，flush 立即触发且不重复', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { minLength: 0, maxLength: 40 }), (events) => {
        const actual = runGate(events, CURSOR_DWELL_MS);
        const expected = referenceFires(events, CURSOR_DWELL_MS);
        expect(actual).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  });
});
