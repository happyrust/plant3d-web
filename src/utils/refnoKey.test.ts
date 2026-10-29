import { describe, expect, it } from 'vitest';

import { toRefnoKey } from './refnoKey';

describe('toRefnoKey', () => {
  it('单斜杠换成下划线', () => {
    expect(toRefnoKey('24381/145018')).toBe('24381_145018');
  });

  it('多段斜杠全部替换（修「只换首个」缺陷的核心用例）', () => {
    expect(toRefnoKey('24381/145018/1')).toBe('24381_145018_1');
  });

  it('剥掉一个前导等号', () => {
    expect(toRefnoKey('=24381/145018')).toBe('24381_145018');
  });

  it('忽略首尾空白', () => {
    expect(toRefnoKey(' 24381/145018 ')).toBe('24381_145018');
  });

  it('已是下划线形式原样返回', () => {
    expect(toRefnoKey('24381_145018')).toBe('24381_145018');
  });

  it('空串 / null / undefined 返回空串', () => {
    expect(toRefnoKey('')).toBe('');
    expect(toRefnoKey(null)).toBe('');
    expect(toRefnoKey(undefined)).toBe('');
  });

  it('非 refno 形状原样返回', () => {
    expect(toRefnoKey('abc')).toBe('abc');
  });

  it('幂等：对结果再调用一次不变', () => {
    for (const input of ['=24381/145018', ' 24381/145018/1 ', 'abc', '']) {
      const once = toRefnoKey(input);
      expect(toRefnoKey(once)).toBe(once);
    }
  });
});
