import { describe, expect, it } from 'vitest';

import {
  FileValidationError,
  parseJsonResponse,
  parseJsonText,
  validateAttachmentBytes,
  validateParquetBuffer,
} from './fileValidation';

describe('fileValidation', () => {
  it('reports the JSON source and syntax location before consumers apply data', () => {
    let thrown: unknown;
    try {
      parseJsonText('{\n  "tasks": [\n}', {
        source: 'broken-review.json',
        expectedRoot: 'object',
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FileValidationError);
    const validationError = thrown as FileValidationError;
    expect(validationError.issue.source).toBe('broken-review.json');
    expect(validationError.issue.format).toBe('json');
    expect(validationError.issue.line).toBeGreaterThanOrEqual(2);
    expect(validationError.message).toContain('合法 JSON 语法');
  });

  it('rejects non-container JSON roots with an explicit actual type', () => {
    expect(() => parseJsonText('"not an object"', {
      source: 'review.json',
      expectedRoot: 'object',
    })).toThrow('根节点起始字符无效');
  });

  it('validates legacy text/plain JSON by content rather than trusting metadata', async () => {
    const response = new Response('{"ok":true}', {
      headers: { 'Content-Type': 'text/plain' },
    });
    await expect(parseJsonResponse<{ ok: boolean }>(response, '/legacy-api'))
      .resolves.toEqual({ ok: true });
  });

  it('validates both Parquet magic markers before DuckDB parsing', () => {
    const valid = new TextEncoder().encode('PAR1payloadPAR1').buffer;
    expect(() => validateParquetBuffer(valid, 'instances.parquet')).not.toThrow();

    const truncated = new TextEncoder().encode('PAR1payloadFAIL').buffer;
    expect(() => validateParquetBuffer(truncated, 'instances.parquet'))
      .toThrow('文件尾魔数无效');
  });

  it('validates attachment signatures instead of trusting the extension', () => {
    expect(() => validateAttachmentBytes(
      new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      'drawing.pdf',
      'pdf',
    )).not.toThrow();
    expect(() => validateAttachmentBytes(
      new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]),
      'drawing.pdf',
      'pdf',
    )).toThrow('文件签名与声明类型不一致');
  });
});
