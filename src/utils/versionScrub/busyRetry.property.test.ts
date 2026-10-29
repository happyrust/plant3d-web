import { describe, expect, it } from 'vitest';

import fc from 'fast-check';

import { retryAfterMs, retryOnBusy } from './busyRetry';

import { HistoryQueryError } from '@/model-source/modelVersionErrors';

/** 一次 `run` 的结局：成功、非忙错误、或带随机 `Retry-After` 的 `HISTORY_BUSY`。 */
type Outcome =
  | { kind: 'ok'; value: number }
  | { kind: 'fail'; code: string }
  | { kind: 'busy'; retryAfterMs: number | undefined };

const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
  fc.record({ kind: fc.constant('ok' as const), value: fc.integer() }),
  fc.record({ kind: fc.constant('fail' as const), code: fc.constantFrom('HISTORY_QUERY_TIMEOUT', 'UNIT_NOT_PRESENT', 'NETWORK') }),
  fc.record({
    kind: fc.constant('busy' as const),
    retryAfterMs: fc.oneof(
      { weight: 3, arbitrary: fc.integer({ min: -5000, max: 20000 }) },
      { weight: 1, arbitrary: fc.constant(undefined) },
    ),
  }),
);

/** 至少给 1 个、最多 8 个结局的响应序列。 */
const outcomesArb = fc.array(outcomeArb, { minLength: 1, maxLength: 8 });

function toError(outcome: Outcome): unknown {
  if (outcome.kind === 'ok') return null;
  if (outcome.kind === 'fail') return new HistoryQueryError(outcome.code);
  return new HistoryQueryError('HISTORY_BUSY', {
    status: 503,
    ...(outcome.retryAfterMs === undefined ? {} : { retryAfterMs: outcome.retryAfterMs }),
  });
}

function clampSecs(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return 1;
  return Math.min(5, Math.max(1, ms / 1000));
}

describe('Property 15: `HISTORY_BUSY` 有界重试', () => {
  // Feature: model-version-timeline-scrub, Property 15: `HISTORY_BUSY` 有界重试
  it('调用 run 不超过 4 次，相邻等待恰为前一次 Retry-After（钳到 1–5 s），结果等于第一个非忙响应', async () => {
    await fc.assert(
      fc.asyncProperty(outcomesArb, async (outcomes) => {
        const calls: number[] = [];
        const waits: number[] = [];
        let index = 0;
        const controller = new AbortController();

        const run = async (): Promise<number> => {
          calls.push(index);
          const outcome = outcomes[Math.min(index, outcomes.length - 1)]!;
          index += 1;
          if (outcome.kind === 'ok') return outcome.value;
          throw toError(outcome);
        };
        const sleep = async (ms: number): Promise<void> => {
          waits.push(ms);
        };

        let result: number | null = null;
        let failure: unknown = null;
        try {
          result = await retryOnBusy(run, { sleep, signal: controller.signal });
        } catch (err) {
          failure = err;
        }

        // 最多 4 次调用
        expect(calls.length).toBeLessThanOrEqual(4);
        // 等待次数 = 调用次数 − 1（每次重发前等一次）
        expect(waits.length).toBe(Math.max(0, calls.length - 1));
        // 每次等待恰为「前一次响应」的 Retry-After 钳到 [1000, 5000] ms
        waits.forEach((ms, i) => {
          const outcome = outcomes[Math.min(i, outcomes.length - 1)]!;
          expect(ms).toBe(clampSecs(outcome.kind === 'busy' ? outcome.retryAfterMs : undefined) * 1000);
        });

        // 结果：第一个非忙响应；前 4 次都忙时以 HISTORY_BUSY 失败
        const firstNonBusy = outcomes.slice(0, 4).findIndex((o) => o.kind !== 'busy');
        if (firstNonBusy >= 0) {
          const expected = outcomes[firstNonBusy]!;
          if (expected.kind === 'ok') {
            expect(failure).toBeNull();
            expect(result).toBe(expected.value);
          } else if (expected.kind === 'fail') {
            expect((failure as HistoryQueryError).code).toBe(expected.code);
            expect(result).toBeNull();
          }
        } else {
          expect(failure).toBeInstanceOf(HistoryQueryError);
          expect((failure as HistoryQueryError).code).toBe('HISTORY_BUSY');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('signal 已中止时一次都不调 run，并以 AbortError 结束', async () => {
    await fc.assert(
      fc.asyncProperty(outcomesArb, async (outcomes) => {
        let calls = 0;
        const controller = new AbortController();
        controller.abort();
        await expect(
          retryOnBusy(async () => {
            calls += 1;
            const outcome = outcomes[0]!;
            if (outcome.kind === 'ok') return outcome.value;
            throw toError(outcome);
          }, { sleep: async () => {}, signal: controller.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(calls).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it('等待中中止：不再重发 run，以 AbortError 结束', async () => {
    await fc.assert(
      // 上限 4 次调用 ⇒ 至多 3 次等待；取 1..3 保证一定在等待中中止
      fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (abortAfterWaits) => {
        let calls = 0;
        let waits = 0;
        const controller = new AbortController();
        const sleep = async (): Promise<void> => {
          waits += 1;
          if (waits >= abortAfterWaits) controller.abort();
        };
        await expect(
          retryOnBusy(async () => {
            calls += 1;
            throw new HistoryQueryError('HISTORY_BUSY', { retryAfterMs: 2000 });
          }, { sleep, signal: controller.signal }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        // 第 abortAfterWaits 次等待后就中止了，run 的次数等于「已发出的请求数」
        expect(calls).toBe(abortAfterWaits);
        expect(calls).toBeLessThanOrEqual(4);
      }),
      { numRuns: 100 },
    );
  });

  it('shouldRetry 返回 false 后不再重发，并以最后一次 HISTORY_BUSY 结束', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (allowRetries) => {
        let calls = 0;
        let granted = 0;
        const controller = new AbortController();
        await expect(
          retryOnBusy(async () => {
            calls += 1;
            throw new HistoryQueryError('HISTORY_BUSY', { retryAfterMs: 1000 });
          }, {
            sleep: async () => {},
            signal: controller.signal,
            shouldRetry: () => {
              granted += 1;
              return granted <= allowRetries;
            },
          }),
        ).rejects.toMatchObject({ name: 'HistoryQueryError', code: 'HISTORY_BUSY' });
        // 允许 allowRetries 次重发 → run 被调 allowRetries + 1 次
        expect(calls).toBe(allowRetries + 1);
        expect(calls).toBeLessThanOrEqual(4);
      }),
      { numRuns: 100 },
    );
  });

  it('非忙错误原样抛出，不等待、不重发', async () => {
    await fc.assert(
      fc.asyncProperty(outcomeArb.filter((o) => o.kind === 'fail'), async (outcome) => {
        let calls = 0;
        const waits: number[] = [];
        await expect(
          retryOnBusy(async () => {
            calls += 1;
            throw toError(outcome);
          }, {
            sleep: async (ms) => {
              waits.push(ms);
            },
            signal: new AbortController().signal,
          }),
        ).rejects.toMatchObject({ name: 'HistoryQueryError' });
        expect(calls).toBe(1);
        expect(waits).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('retryAfterMs 把 Retry-After 钳到 1–5 s，缺头按 1 s', () => {
    fc.assert(
      fc.property(fc.oneof(
        { weight: 4, arbitrary: fc.integer({ min: -10000, max: 60000 }) },
        { weight: 1, arbitrary: fc.constant(Number.NaN) },
        { weight: 1, arbitrary: fc.constant(Number.POSITIVE_INFINITY) },
      ), (raw) => {
        const err = new HistoryQueryError('HISTORY_BUSY', { retryAfterMs: raw });
        const got = retryAfterMs(err);
        expect(got).toBeGreaterThanOrEqual(1000);
        expect(got).toBeLessThanOrEqual(5000);
        // 钳位只在 [1, 5] s 之外生效；非有限值按缺头处理（1 s）
        if (!Number.isFinite(raw)) {
          expect(got).toBe(1000);
        } else {
          expect(got).toBe(Math.min(5, Math.max(1, raw / 1000)) * 1000);
        }
      }),
      { numRuns: 100 },
    );
    const missing = new HistoryQueryError('HISTORY_BUSY');
    expect(retryAfterMs(missing)).toBe(1000);
  });

  it('onWait 在每次进入等待前被调一次，attempt 从 1 起', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (busyCount) => {
        const waits: { attempt: number; delayMs: number }[] = [];
        let calls = 0;
        const controller = new AbortController();
        await retryOnBusy(async () => {
          calls += 1;
          if (calls <= busyCount) throw new HistoryQueryError('HISTORY_BUSY', { retryAfterMs: 3000 });
          return 'ok';
        }, {
          sleep: async () => {},
          signal: controller.signal,
          onWait: (attempt, delayMs) => {
            waits.push({ attempt, delayMs });
          },
        });
        expect(waits).toHaveLength(busyCount);
        waits.forEach((w, i) => {
          expect(w.attempt).toBe(i + 1);
          expect(w.delayMs).toBe(3000);
        });
      }),
      { numRuns: 100 },
    );
  });
});
