/** 运行记录往回翻页：游标怎么走、同一毫秒落库的行不被页边界吃掉、各页去重。 */
import { describe, expect, it, vi } from 'vitest';

import { fetchRunPage, mergeRunPages } from './useRvmStoreQueries';

import type { RvmStoreRun, RvmStoreRunFilter, RvmStoreRuns } from '@/api/rvmCheckStoreApi';

function run(id: string, at: number): RvmStoreRun {
  return { run_id: id, source: 'batch', refno: id, verdict: 'pass', status: 'pass', finished_unix_ms: at };
}

/** 模拟服务端：`finished_unix_ms < before` 的行按时刻倒序取前 `limit` 条 */
function server(all: RvmStoreRun[]) {
  const sorted = [...all].sort((left, right) => right.finished_unix_ms - left.finished_unix_ms);
  return vi.fn(async (filter: RvmStoreRunFilter): Promise<RvmStoreRuns> => {
    const rows = sorted.filter((row) => filter.before == null || row.finished_unix_ms < filter.before).slice(0, filter.limit ?? 50);
    return { count: rows.length, runs: rows };
  });
}

/** 一页一页翻到头，返回去重后的 run_id 与翻了几页 */
async function drain(fetcher: ReturnType<typeof server>, pageSize: number) {
  const pages = [];
  let before: number | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await fetchRunPage({ batch_id: 'b' }, before, pageSize, undefined, fetcher);
    pages.push(page);
    if (page.next == null) break;
    before = page.next;
  }
  return { ids: mergeRunPages(pages).map((row) => row.run_id), pages: pages.length };
}

describe('fetchRunPage', () => {
  it('不满一页就是到头了', async () => {
    const fetcher = server([run('a', 30), run('b', 20)]);
    const page = await fetchRunPage({ batch_id: 'b' }, null, 3, undefined, fetcher);
    expect(page.runs.map((row) => row.run_id)).toEqual(['a', 'b']);
    expect(page.next).toBeNull();
    expect(fetcher).toHaveBeenCalledWith({ batch_id: 'b', before: undefined, limit: 3 }, { signal: undefined });
  });

  it('满一页时下一页从「不晚于最后一行」起取', async () => {
    const fetcher = server([run('a', 40), run('b', 30), run('c', 20), run('d', 10)]);
    const page = await fetchRunPage({ batch_id: 'b' }, null, 2, undefined, fetcher);
    expect(page.runs.map((row) => row.run_id)).toEqual(['a', 'b']);
    expect(page.next).toBe(31);
  });

  it('同一毫秒的行被页边界切开也不丢', async () => {
    // c、d、e 同一毫秒落库，一页 3 行：第一页在 c 处切开
    const all = [run('a', 50), run('b', 40), run('c', 30), run('d', 30), run('e', 30), run('f', 20), run('g', 10)];
    const { ids } = await drain(server(all), 3);
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('整页都是同一毫秒时放大这一页，直到翻过去', async () => {
    const tied = Array.from({ length: 7 }, (_, index) => run(`t${index}`, 30));
    const all = [run('a', 40), ...tied, run('z', 10)];
    const fetcher = server(all);
    const { ids } = await drain(fetcher, 2);
    expect([...ids].sort()).toEqual(['a', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 'z']);
    // 放大过：出现过比一页 2 行更大的 limit
    expect(fetcher.mock.calls.some(([filter]) => (filter.limit ?? 0) > 2)).toBe(true);
  });

  it('正好整页取完时再取一次才知道到头，不多出行', async () => {
    const { ids, pages } = await drain(server([run('a', 30), run('b', 20)]), 2);
    expect(ids).toEqual(['a', 'b']);
    expect(pages).toBe(2);
  });

  it('条件原样带给服务端；续页多取一行抵掉重叠的那一行', async () => {
    const fetcher = server([]);
    await fetchRunPage({ batch_id: 'b', root_refno: '1/2', status: 'fail' }, 99, 100, undefined, fetcher);
    expect(fetcher).toHaveBeenCalledWith({ batch_id: 'b', root_refno: '1/2', status: 'fail', before: 99, limit: 101 }, { signal: undefined });
  });

  it('没有并列时刻时每一页正好多出一页的行数', async () => {
    const all = Array.from({ length: 250 }, (_, index) => run(`r${index}`, 10_000 - index));
    const fetcher = server(all);
    const first = await fetchRunPage({ batch_id: 'b' }, null, 100, undefined, fetcher);
    const second = await fetchRunPage({ batch_id: 'b' }, first.next, 100, undefined, fetcher);
    const third = await fetchRunPage({ batch_id: 'b' }, second.next, 100, undefined, fetcher);
    expect(mergeRunPages([first]).length).toBe(100);
    expect(mergeRunPages([first, second]).length).toBe(200);
    expect(mergeRunPages([first, second, third]).length).toBe(250);
    expect(third.next).toBeNull();
  });
});

describe('mergeRunPages', () => {
  it('各页接起来按 run_id 去重，保持先后', () => {
    const merged = mergeRunPages([
      { runs: [run('a', 30), run('b', 20)], next: 21 },
      { runs: [run('b', 20), run('c', 10)], next: null },
    ]);
    expect(merged.map((row) => row.run_id)).toEqual(['a', 'b', 'c']);
  });
});
