import { describe, expect, it } from 'vitest';

import {
  appendRefno,
  formatRefnoList,
  normalizeRefnoList,
  parseRefnoList,
  removeRefno,
} from './refnoListParam';

describe('parseRefnoList', () => {
  it('keeps the legacy single-value form working', () => {
    expect(parseRefnoList('?show_refno=24381_145018', 'show_refno'))
      .toEqual(['24381_145018']);
  });

  it('splits a comma-separated list', () => {
    expect(parseRefnoList('?show_refno=A,B,C', 'show_refno')).toEqual(['A', 'B', 'C']);
  });

  it('normalizes slashes, the leading equals sign and whitespace', () => {
    expect(parseRefnoList('?show_refno=%3D24381%2F145018%20,%2024381%2F145019', 'show_refno'))
      .toEqual(['24381_145018', '24381_145019']);
  });

  it('drops empty entries', () => {
    expect(parseRefnoList('?show_refno=A,,B,', 'show_refno')).toEqual(['A', 'B']);
  });

  it('de-duplicates while keeping order', () => {
    expect(parseRefnoList('?show_refno=A,B,A', 'show_refno')).toEqual(['A', 'B']);
    expect(parseRefnoList('?show_refno=24381/1,24381_1', 'show_refno'))
      .toEqual(['24381_1']);
  });

  it('only reads the requested parameter', () => {
    expect(parseRefnoList('?mbd_refno=A', 'show_refno')).toEqual([]);
    expect(parseRefnoList('?show_refno=A&mbd_refno=B', 'show_refno')).toEqual(['A']);
    expect(parseRefnoList('?show_refno=A&mbd_refno=B', 'mbd_refno')).toEqual(['B']);
  });

  it('returns nothing when the parameter is absent or empty', () => {
    expect(parseRefnoList('', 'show_refno')).toEqual([]);
    expect(parseRefnoList('?other=1', 'show_refno')).toEqual([]);
    expect(parseRefnoList('?show_refno=', 'show_refno')).toEqual([]);
    expect(parseRefnoList('?show_refno=,', 'show_refno')).toEqual([]);
  });
});

describe('normalizeRefnoList', () => {
  it('normalizes, drops blanks and de-duplicates while keeping order', () => {
    expect(normalizeRefnoList([' 24381/1 ', '', '=24381/2', '24381_1', null, undefined]))
      .toEqual(['24381_1', '24381_2']);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeRefnoList([])).toEqual([]);
  });
});

describe('formatRefnoList', () => {
  it('joins with commas', () => {
    expect(formatRefnoList(['A', 'B'])).toBe('A,B');
  });

  it('normalizes and de-duplicates', () => {
    expect(formatRefnoList([' 24381/1 ', '24381_1', '=24381/2']))
      .toBe('24381_1,24381_2');
  });

  it('returns null for an empty list so callers can delete the parameter', () => {
    expect(formatRefnoList([])).toBeNull();
    expect(formatRefnoList(['', '  '])).toBeNull();
  });

  it('round-trips through parse', () => {
    const encoded = formatRefnoList(['24381/145018', '24381/145019'])!;
    expect(parseRefnoList(`?show_refno=${encoded}`, 'show_refno'))
      .toEqual(['24381_145018', '24381_145019']);
  });
});

describe('appendRefno', () => {
  it('appends a new refno', () => {
    expect(appendRefno(['A'], 'B')).toEqual(['A', 'B']);
  });

  it('keeps the existing list when the refno is already there', () => {
    expect(appendRefno(['A', 'B'], 'A')).toEqual(['A', 'B']);
    expect(appendRefno(['24381_1'], '24381/1')).toEqual(['24381_1']);
  });

  it('ignores an empty refno', () => {
    expect(appendRefno(['A'], '   ')).toEqual(['A']);
  });
});

describe('removeRefno', () => {
  it('removes by normalized key', () => {
    expect(removeRefno(['A', 'B'], 'A')).toEqual(['B']);
    expect(removeRefno(['24381_1', '24381_2'], '24381/1')).toEqual(['24381_2']);
  });

  it('is a no-op for an unknown or empty refno', () => {
    expect(removeRefno(['A'], 'Z')).toEqual(['A']);
    expect(removeRefno(['A'], '')).toEqual(['A']);
  });
});
