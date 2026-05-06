import { describe, expect, it } from 'vitest';

import {
  escapeHtml,
  hasMatch,
  highlightMatches,
} from './annotationTableHighlight';

describe('escapeHtml', () => {
  it('转义 < > & " \'', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('单引号转义为 &#39;', () => {
    expect(escapeHtml('it\'s')).toBe('it&#39;s');
  });

  it('空串返回空串', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('& 先于 < 转义，避免 &lt; 被再次转义', () => {
    expect(escapeHtml('&<')).toBe('&amp;&lt;');
  });
});

describe('highlightMatches', () => {
  it('空 query 只 escape 不加 mark', () => {
    expect(highlightMatches('DN800', '')).toBe('DN800');
    expect(highlightMatches('<div>', '')).toBe('&lt;div&gt;');
  });

  it('匹配时包裹 <mark>', () => {
    const out = highlightMatches('DN800 管段与梁', 'DN800');
    expect(out).toContain('<mark');
    expect(out).toContain('DN800</mark>');
    expect(out).toContain('管段与梁');
  });

  it('大小写不敏感匹配', () => {
    const out = highlightMatches('DN800', 'dn800');
    expect(out).toContain('<mark');
    // 保留原始大小写
    expect(out).toContain('>DN800</mark>');
  });

  it('多段匹配全部高亮', () => {
    const out = highlightMatches('abc DN150 abc DN150', 'DN150');
    expect(out.match(/<mark/g)?.length).toBe(2);
  });

  it('中文匹配', () => {
    const out = highlightMatches('地下管网涵洞', '管网');
    expect(out).toContain('>管网</mark>');
  });

  it('query 含 RegExp 元字符不抛异常', () => {
    expect(() => highlightMatches('a.b.c', '.')).not.toThrow();
    const out = highlightMatches('a.b.c', '.');
    expect(out).toContain('<mark');
  });

  it('XSS 防护：text 中的 <script> 不会被当作标签', () => {
    const out = highlightMatches('<script>alert(1)</script>', 'alert');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    // alert 部分高亮
    expect(out).toContain('>alert</mark>');
  });

  it('空 text 返回空串', () => {
    expect(highlightMatches('', 'DN800')).toBe('');
    expect(highlightMatches(null, 'DN800')).toBe('');
    expect(highlightMatches(undefined, 'DN800')).toBe('');
  });
});

describe('hasMatch', () => {
  it('大小写不敏感匹配返回 true', () => {
    expect(hasMatch('DN800 管段', 'dn800')).toBe(true);
  });

  it('未匹配返回 false', () => {
    expect(hasMatch('DN800', '不存在')).toBe(false);
  });

  it('空 text 或空 query 返回 false', () => {
    expect(hasMatch('', 'DN800')).toBe(false);
    expect(hasMatch('DN800', '')).toBe(false);
    expect(hasMatch(null, 'x')).toBe(false);
    expect(hasMatch(undefined, 'x')).toBe(false);
  });
});
