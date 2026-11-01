import { describe, expect, it } from 'vitest';

import {
  appendMbdRefno,
  formatMbdRefnos,
  parseMbdRefnos,
  removeMbdRefno,
} from './mbdRefnoParam';

describe('parseMbdRefnos', () => {
  it('keeps the legacy single-value form working', () => {
    expect(parseMbdRefnos('?mbd_refno=24381_145018')).toEqual(['24381_145018']);
  });

  it('splits a comma-separated list', () => {
    expect(parseMbdRefnos('?mbd_refno=A,B,C')).toEqual(['A', 'B', 'C']);
  });

  it('normalizes slashes, the leading equals sign and whitespace', () => {
    expect(parseMbdRefnos('?mbd_refno=%3D24381%2F145018%20,%2024381%2F145019'))
      .toEqual(['24381_145018', '24381_145019']);
  });

  it('drops empty entries', () => {
    expect(parseMbdRefnos('?mbd_refno=A,,B,')).toEqual(['A', 'B']);
  });

  it('de-duplicates while keeping order', () => {
    expect(parseMbdRefnos('?mbd_refno=A,B,A')).toEqual(['A', 'B']);
    // 归一化之后才相等的也算重复。
    expect(parseMbdRefnos('?mbd_refno=24381/1,24381_1')).toEqual(['24381_1']);
  });

  it('returns nothing when the parameter is absent or empty', () => {
    expect(parseMbdRefnos('')).toEqual([]);
    expect(parseMbdRefnos('?other=1')).toEqual([]);
    expect(parseMbdRefnos('?mbd_refno=')).toEqual([]);
    expect(parseMbdRefnos('?mbd_refno=,')).toEqual([]);
  });
});

describe('formatMbdRefnos', () => {
  it('joins with commas', () => {
    expect(formatMbdRefnos(['A', 'B'])).toBe('A,B');
  });

  it('normalizes and de-duplicates', () => {
    expect(formatMbdRefnos([' 24381/1 ', '24381_1', '=24381/2']))
      .toBe('24381_1,24381_2');
  });

  it('returns null for an empty list so callers can delete the parameter', () => {
    expect(formatMbdRefnos([])).toBeNull();
    expect(formatMbdRefnos(['', '  '])).toBeNull();
  });

  it('round-trips through parse', () => {
    const encoded = formatMbdRefnos(['24381/145018', '24381/145019'])!;
    expect(parseMbdRefnos(`?mbd_refno=${encoded}`))
      .toEqual(['24381_145018', '24381_145019']);
  });
});

describe('appendMbdRefno', () => {
  it('appends a new refno', () => {
    expect(appendMbdRefno(['A'], 'B')).toEqual(['A', 'B']);
  });

  it('keeps the existing list when the refno is already there', () => {
    expect(appendMbdRefno(['A', 'B'], 'A')).toEqual(['A', 'B']);
    // 归一化之后相等也算已存在。
    expect(appendMbdRefno(['24381_1'], '24381/1')).toEqual(['24381_1']);
  });

  it('ignores an empty refno', () => {
    expect(appendMbdRefno(['A'], '   ')).toEqual(['A']);
  });
});

describe('removeMbdRefno', () => {
  it('removes by normalized key', () => {
    expect(removeMbdRefno(['A', 'B'], 'A')).toEqual(['B']);
    expect(removeMbdRefno(['24381_1', '24381_2'], '24381/1')).toEqual(['24381_2']);
  });

  it('is a no-op for an unknown or empty refno', () => {
    expect(removeMbdRefno(['A'], 'Z')).toEqual(['A']);
    expect(removeMbdRefno(['A'], '')).toEqual(['A']);
  });
});
