import { describe, expect, it } from 'vitest';

import { clampedNumberInput, positiveMmInput } from './numberInput';

describe('管道距离抽屉的数值输入', () => {
  const maxDistance = { min: 50, max: 2000, fallback: 500 };

  it('最大距离：范围内原样保留，超出夹到边界，留空或不合法回到缺省', () => {
    expect(clampedNumberInput('1500', maxDistance)).toBe(1500);
    expect(clampedNumberInput('800', maxDistance)).toBe(800);
    expect(clampedNumberInput('120', maxDistance)).toBe(120);
    expect(clampedNumberInput('20', maxDistance)).toBe(50);
    expect(clampedNumberInput('20000', maxDistance)).toBe(2000);
    expect(clampedNumberInput('', maxDistance)).toBe(500);
    expect(clampedNumberInput('abc', maxDistance)).toBe(500);
  });

  it('正整数毫米：取整，非正数或留空回到缺省', () => {
    expect(positiveMmInput('1000.4', 300)).toBe(1000);
    expect(positiveMmInput('0', 300)).toBe(300);
    expect(positiveMmInput('-5', 300)).toBe(300);
    expect(positiveMmInput('', 300)).toBe(300);
  });
});
