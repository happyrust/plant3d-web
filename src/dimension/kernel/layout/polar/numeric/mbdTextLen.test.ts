import { describe, expect, it } from 'vitest';

import {
  MBD_TEXT_LEN_FALLBACK,
  MBD_TEXT_LEN_PML_ENTRIES,
  MBD_TEXT_LEN_TABLE,
  mbdTextLen,
} from './mbdTextLen';

// The 16 glyphs the PML table lists twice (mbdtextlen.pmlfnc:12), with the
// width both rows carry — so first-match deduplication changes nothing.
const DUPLICATE_KEYS = ['s', 'S', '~', '@', '#', '%', '&', '*', '-', '=', '+', '{', '}', '…', '—', '、'];
const DUPLICATE_WIDTHS = [
  0.5201, 0.6869, 0.6040, 1.0351, 0.5768, 0.9086, 0.6872, 0.4093,
  0.3532, 0.6037, 0.6037, 0.3543, 0.3543, 1.0185, 1.0210, 1.0133,
];

describe('MBD_TEXT_LEN_PML_ENTRIES', () => {
  it('keeps the 128 PML rows in their original order', () => {
    expect(MBD_TEXT_LEN_PML_ENTRIES).toHaveLength(128);
    expect(MBD_TEXT_LEN_PML_ENTRIES[0]).toEqual(['1', 0.5741]);
    // Rows 34 / 60 (1-based) are where x / X belong; the PML author left s / S there.
    expect(MBD_TEXT_LEN_PML_ENTRIES[33]).toEqual(['s', 0.5201]);
    expect(MBD_TEXT_LEN_PML_ENTRIES[59]).toEqual(['S', 0.6869]);
    expect(MBD_TEXT_LEN_PML_ENTRIES[126]).toEqual(['|', 0.2788]);
    expect(MBD_TEXT_LEN_PML_ENTRIES[127]).toEqual([' ', 0.2987]);
  });

  it('has 112 distinct keys; every duplicate key appears twice with the same width', () => {
    const keys = MBD_TEXT_LEN_PML_ENTRIES.map(([glyph]) => glyph);
    expect(new Set(keys).size).toBe(112);
    const repeated = [...new Set(keys.filter((glyph, index) => keys.indexOf(glyph) !== index))];
    expect(repeated.sort()).toEqual([...DUPLICATE_KEYS].sort());
    for (const glyph of DUPLICATE_KEYS) {
      const widths = MBD_TEXT_LEN_PML_ENTRIES
        .filter(([candidate]) => candidate === glyph)
        .map(([, width]) => width);
      expect(widths, glyph).toHaveLength(2);
      expect(widths[0], glyph).toBe(widths[1]);
    }
  });
});

describe('MBD_TEXT_LEN_TABLE', () => {
  it('dedupes first-match and fills the x / X slots with the s / S widths', () => {
    expect(MBD_TEXT_LEN_TABLE.size).toBe(114);
    expect(MBD_TEXT_LEN_TABLE.get('x')).toBe(0.5201);
    expect(MBD_TEXT_LEN_TABLE.get('X')).toBe(0.6869);
    expect(MBD_TEXT_LEN_TABLE.get('s')).toBe(0.5201);
    expect(MBD_TEXT_LEN_TABLE.get('S')).toBe(0.6869);
  });

  it('keeps the first-row width of every duplicated glyph', () => {
    DUPLICATE_KEYS.forEach((glyph, index) => {
      expect(MBD_TEXT_LEN_TABLE.get(glyph), glyph).toBe(DUPLICATE_WIDTHS[index]);
    });
  });
});

describe('mbdTextLen', () => {
  it('sums the PML widths per code point', () => {
    expect(mbdTextLen('A')).toBe(0.6878);
    expect(mbdTextLen('1000')).toBeCloseTo(2.3024, 9);
    expect(mbdTextLen('Fx')).toBeCloseTo(1.1505, 9);
    expect(mbdTextLen('xX')).toBeCloseTo(1.207, 9);
    expect(mbdTextLen(' ')).toBe(0.2987);
    expect(mbdTextLen('|')).toBe(0.2788);
  });

  it('falls back to 1.02 per unknown glyph and to 0 for empty text', () => {
    expect(MBD_TEXT_LEN_FALLBACK).toBe(1.02);
    expect(mbdTextLen('中')).toBe(1.02);
    expect(mbdTextLen('')).toBe(0);
  });
});
