import { describe, expect, it, vi } from 'vitest';

import { LffFont } from './lffParser';

const INLINE_LFF = [
  '# LetterSpacing: 1',
  '# WordSpacing: 4',
  '[0030] 0',
  '0,0;2,0,A1',
  '',
  '[0031] 1',
  '0,0;0,10',
  '',
  '[0041] A',
  '0,0;1,10;2,0',
  '',
  '[0042] deliberately malformed but lazily ignored',
  'not-a-point',
  '',
  '[0045] E',
  '0,0;0,10;2,10',
  '',
  '[0046] F',
  '0,0;0,10;2,10',
  '',
  '[0052] R',
  '0,0;0,10;2,10',
  '',
  '[0068] h',
  '0,0;0,12;2,12',
  '',
  '[0070] p',
  '0,-3;0,7;2,7',
  '',
  '[007e] tilde',
  '0,5;1,6;2,5',
  '',
  '[00b0] degree',
  '0,8;1,9;2,8',
  '',
  '[2300] diameter',
  '0,0;2,10',
  '',
  '[fffd] replacement',
  '0,0;1,10',
  '',
].join('\r\n');

describe('LffFont', () => {
  it('normalizes CRLF and derives metrics from A, h, and p', () => {
    const font = LffFont.fromText(INLINE_LFF);

    expect(font.letterSpacing).toBe(1);
    expect(font.wordSpacing).toBe(4);
    expect(font.capHeight).toBe(10);
    expect(font.ascender).toBe(12);
    expect(font.descender).toBe(-3);
    expect(font.getWidth(20, 'A A')).toBe(18);
    expect(font.getHeight(20)).toBe(30);
  });

  it('parses codepoints lazily and falls back to the replacement glyph', () => {
    const font = LffFont.fromText(INLINE_LFF);

    expect(font.getGlyph('R'.codePointAt(0)!)).toMatchObject({
      leftSideBearing: 0,
      boundingWidth: 2,
      advanceWidth: 3,
    });
    expect(font.getGlyph('x'.codePointAt(0)!)).toBe(font.getGlyph(0xfffd));
  });

  it('draws a missing approximate mark ≈ with the tilde instead of the replacement box', () => {
    const font = LffFont.fromText(INLINE_LFF);

    expect(font.getGlyph(0x2248)).toBe(font.getGlyph(0x7e));
    expect(font.getWidth(20, '≈1')).toBe(font.getWidth(20, '~1'));
  });

  it('expands each bulge into eight deterministic line subdivisions', () => {
    const points = LffFont.fromText(INLINE_LFF).getGlyph(0x30).contours[0].points;

    expect(points).toHaveLength(10);
    expect(points[0]).toEqual([0, 0]);
    expect(points[5][0]).toBeCloseTo(1, 12);
    expect(points[5][1]).toBeCloseTo(-1, 12);
    expect(points[9][0]).toBeCloseTo(2, 12);
    expect(points[9][1]).toBeCloseTo(0, 12);
  });

  it('traces deterministic screen-space segments', () => {
    const segments = LffFont.fromText(INLINE_LFF).trace(10, 'A', [5, 20]);

    expect(segments).toEqual([
      { from: [5, 20], to: [6, 10] },
      { from: [6, 10], to: [7, 20] },
    ]);
  });

  describe('a glyph body that does not parse', () => {
    // INLINE_LFF 的 [0042] B 是刻意的坏字形（`not-a-point`）。它是这份 fixture
    // 里唯一一个「字体本身有缺陷」的样本，正是要钉住的场景。
    const B = 'B'.codePointAt(0)!;

    it('degrades that one code point to blank instead of throwing', () => {
      // 修前：`getGlyph(0x42)` 抛 SyntaxError，`trace` / `getWidth` 一并抛。
      // 抛点在分帧绘制内部（§11.11 A1），后果是含该字符的每个 run 每帧都抛，
      // 且缓存帮不上忙 —— 失败发生在写入 glyphCache 之前。
      const font = LffFont.fromText(INLINE_LFF);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(() => font.getGlyph(B)).not.toThrow();
        expect(() => font.trace(10, 'B', [0, 0])).not.toThrow();
        expect(() => font.getWidth(10, 'B')).not.toThrow();
        // 降级 = 没有笔画。
        expect(font.getGlyph(B).contours).toEqual([]);
        expect(font.trace(10, 'B', [0, 0])).toEqual([]);
      } finally {
        warn.mockRestore();
      }
    });

    it('keeps the rest of a mixed run drawable and the width finite', () => {
      // 关键点：一个坏字符不能让整条 run 消失。'AB' 里的 A 必须照常出笔画，
      // 宽度必须是有限数（advance 退化成 letterSpacing = 1）。
      const font = LffFont.fromText(INLINE_LFF);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const onlyA = font.trace(10, 'A', [0, 0]);
        const mixed = font.trace(10, 'AB', [0, 0]);
        expect(onlyA.length).toBeGreaterThan(0);
        expect(mixed).toEqual(onlyA);
        // 宽度不写死数字：`getWidth` 末尾会减一次 letterSpacing，把那个常数抄进
        // 断言等于把实现的收尾算式钉进测试。只断言「有限」且「比只有 A 宽」——
        // 后者证明 B 确实占了位，而不是被当成零宽吞掉。
        const widthA = font.getWidth(10, 'A');
        const widthAB = font.getWidth(10, 'AB');
        expect(Number.isFinite(widthAB)).toBe(true);
        expect(widthAB).toBeGreaterThan(widthA);
      } finally {
        warn.mockRestore();
      }
    });

    it('warns once per code point, not once per call', () => {
      // 缓存降级结果的意义就在这里：每帧都告警会把控制台淹掉，也就没人看告警了。
      const font = LffFont.fromText(INLINE_LFF);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (let repeat = 0; repeat < 5; repeat += 1) font.trace(10, 'B', [0, 0]);
        expect(warn).toHaveBeenCalledTimes(1);
        // 日志要能定位到具体码位。
        expect(String(warn.mock.calls[0]![0])).toContain('U+42');
      } finally {
        warn.mockRestore();
      }
    });

    it('leaves a glyph that parses untouched', () => {
      // 兜底不能顺手把好字形也吞了：这条防「整个 try 块都被 catch 包住、
      // 连正常路径的返回值都被替换」。
      const font = LffFont.fromText(INLINE_LFF);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(font.getGlyph('R'.codePointAt(0)!).contours).toHaveLength(1);
        expect(font.trace(10, 'A', [0, 0])).toHaveLength(2);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });
  });
});
