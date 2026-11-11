import { describe, expect, it } from 'vitest';

import { appendUniqueRefnos } from './loadedRefnoList';

describe('appendUniqueRefnos（累计装入名单：数组留给自动化读，去重走集合）', () => {
  it('按首次出现的顺序追加，重复的不进数组', () => {
    const list: string[] = [];
    let index = appendUniqueRefnos(list, null, ['a_1', 'a_2', 'a_1']);
    index = appendUniqueRefnos(list, index, ['a_2', 'a_3']);
    expect(list).toEqual(['a_1', 'a_2', 'a_3']);
    expect(index.size).toBe(3);
  });

  it('集合与数组对不上（外面把数组换掉 / 清空了）就按数组重建，不沿用旧集合的结论', () => {
    const list = ['a_1', 'a_2'];
    const index = appendUniqueRefnos(list, null, []);
    list.length = 0;

    const rebuilt = appendUniqueRefnos(list, index, ['a_1', 'a_9']);

    expect(list).toEqual(['a_1', 'a_9']);
    expect(rebuilt).not.toBe(index);
    expect([...rebuilt]).toEqual(['a_1', 'a_9']);
  });

  it('八万条分七批追加在毫秒级完成（原来的数组 includes 是平方复杂度，同样的量要几秒）', () => {
    const all = Array.from({ length: 80_000 }, (_, i) => `23717_${i}`);
    const sizes = [1000, 2000, 4000, 8000, 16_000, 32_000, 17_000];
    const list: string[] = [];
    let index: Set<string> | null = null;
    let offset = 0;
    const started = performance.now();
    for (const size of sizes) {
      index = appendUniqueRefnos(list, index, all.slice(offset, offset + size));
      offset += size;
    }
    const elapsed = performance.now() - started;
    expect(list.length).toBe(80_000);
    expect(elapsed).toBeLessThan(500);
  });
});
