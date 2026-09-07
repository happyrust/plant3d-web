import { beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetGenModelV1DbnumsForTests, DBNUMS_DEFAULT_MAX_AGE_MS, getGenModelV1Dbnums, peekGenModelV1Dbnums } from './useGenModelV1Dbnums';

import type { DbnumsResponse } from '@/api/genModelV1Api';

const baseUrlMock = vi.hoisted(() => ({ value: 'http://localhost:18082' }));

vi.mock('@/utils/apiBase', () => ({
  getGenModelV1BaseUrl: () => baseUrlMock.value,
}));

function response(tag: string): DbnumsResponse {
  return { dbnums: [{ dbnum: 7997, db_type: 'DESI', model_verdict: tag }] };
}

/** 可控完成时机的假 fetcher */
function deferredFetcher() {
  const pending: { resolve: (value: DbnumsResponse) => void; reject: (error: unknown) => void }[] = [];
  const fetcher = vi.fn(() => new Promise<DbnumsResponse>((resolve, reject) => { pending.push({ resolve, reject }); }));
  return { fetcher, pending };
}

beforeEach(() => {
  __resetGenModelV1DbnumsForTests();
  baseUrlMock.value = 'http://localhost:18082';
});

describe('getGenModelV1Dbnums（/dbnums 共享缓存）', () => {
  it('并发两处要 /dbnums 只发一次请求，都拿到同一份；之后新鲜度窗口内直接回缓存', async () => {
    const { fetcher, pending } = deferredFetcher();
    let now = 1_000;
    const clock = () => now;

    const a = getGenModelV1Dbnums({ fetcher, now: clock });
    const b = getGenModelV1Dbnums({ fetcher, now: clock, force: true }); // force 也共用在飞的
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith({ timeoutMs: 60_000, signal: undefined });
    pending[0]!.resolve(response('first'));
    expect(await a).toBe(await b);
    expect(peekGenModelV1Dbnums()).toEqual({ fetchedAt: 1_000, response: response('first') });

    now += DBNUMS_DEFAULT_MAX_AGE_MS - 1;
    expect(await getGenModelV1Dbnums({ fetcher, now: clock })).toEqual(response('first'));
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 过了窗口重拉；force 在窗口内也重拉
    now += 2;
    const c = getGenModelV1Dbnums({ fetcher, now: clock });
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending[1]!.resolve(response('second'));
    expect(await c).toEqual(response('second'));
    const d = getGenModelV1Dbnums({ fetcher, now: clock, force: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
    pending[2]!.resolve(response('third'));
    expect(await d).toEqual(response('third'));
    expect(peekGenModelV1Dbnums()?.response).toEqual(response('third'));
  });

  it('maxAgeMs=0 总是重拉；请求失败不写缓存、在飞标记清掉，下一次能再试', async () => {
    const { fetcher, pending } = deferredFetcher();
    const first = getGenModelV1Dbnums({ fetcher, maxAgeMs: 0 });
    pending[0]!.reject(new Error('timeout'));
    await expect(first).rejects.toThrow('timeout');
    expect(peekGenModelV1Dbnums()).toBeNull();

    const second = getGenModelV1Dbnums({ fetcher, maxAgeMs: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending[1]!.resolve(response('ok'));
    expect(await second).toEqual(response('ok'));
    const third = getGenModelV1Dbnums({ fetcher, maxAgeMs: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    pending[2]!.resolve(response('ok2'));
    await third;
  });

  it('换了 gen-model base URL 就不认旧缓存', async () => {
    const { fetcher, pending } = deferredFetcher();
    const a = getGenModelV1Dbnums({ fetcher });
    pending[0]!.resolve(response('a'));
    await a;
    baseUrlMock.value = 'http://10.0.0.5:8022';
    expect(peekGenModelV1Dbnums()).toBeNull();
    const b = getGenModelV1Dbnums({ fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
    pending[1]!.resolve(response('b'));
    expect(await b).toEqual(response('b'));
  });
});
