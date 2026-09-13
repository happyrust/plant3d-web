export type FileFormat = 'json' | 'glb' | 'mesh' | 'parquet' | 'pdf' | 'png' | 'jpeg';

export type FileValidationIssue = Readonly<{
  source: string;
  format: FileFormat;
  reason: string;
  expected: string;
  actual: string;
  byteOffset?: number;
  line?: number;
  column?: number;
}>;

export class FileValidationError extends Error {
  readonly issue: FileValidationIssue;

  constructor(issue: FileValidationIssue) {
    const location = issue.byteOffset !== undefined
      ? `，字节 ${issue.byteOffset}`
      : issue.line !== undefined
        ? `，第 ${issue.line} 行${issue.column !== undefined ? `第 ${issue.column} 列` : ''}`
        : '';
    super(
      `文件验证失败：${issue.source}（${issue.format.toUpperCase()}${location}）`
      + `：${issue.reason}；期望 ${issue.expected}，实际 ${issue.actual}`,
    );
    this.name = 'FileValidationError';
    this.issue = issue;
  }
}

export function failFileValidation(issue: FileValidationIssue): never {
  throw new FileValidationError(issue);
}

export function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').slice(0, 40);
    return compact ? `字符串“${compact}”` : '空字符串';
  }
  if (typeof value === 'object') return '对象';
  return `${typeof value} ${String(value)}`;
}

function lineAndColumnAt(text: string, position: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, position));
  const lines = before.split(/\r\n|\r|\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function jsonErrorPosition(error: unknown, text: string): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\bposition\s+(\d+)\b/i);
  if (match) {
    const position = Number(match[1]);
    return Number.isSafeInteger(position) ? position : null;
  }

  // Node 22/V8 may omit "at position N" and only include the offending token.
  const tokenMatch = message.match(/Unexpected token ['"](.{1})['"]/i);
  if (tokenMatch?.[1]) {
    const position = text.lastIndexOf(tokenMatch[1]);
    return position >= 0 ? position : null;
  }
  if (/Unexpected end of JSON input|unexpected end of data/i.test(message)) {
    return text.length;
  }
  return null;
}

export function parseJsonText<T = unknown>(
  raw: string,
  options: Readonly<{
    source: string;
    expectedRoot?: 'object' | 'array' | 'object-or-array';
  }>,
): T {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const firstContentOffset = text.search(/\S/);
  if (firstContentOffset < 0) {
    failFileValidation({
      source: options.source,
      format: 'json',
      reason: '文件为空',
      expected: '非空 JSON 文档',
      actual: '0 个有效字符',
      line: 1,
      column: 1,
    });
  }

  const first = text[firstContentOffset];
  if (first !== '{' && first !== '[') {
    const location = lineAndColumnAt(text, firstContentOffset);
    failFileValidation({
      source: options.source,
      format: 'json',
      reason: '根节点起始字符无效',
      expected: '“{”或“[”',
      actual: JSON.stringify(first),
      ...location,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const position = jsonErrorPosition(error, text);
    const location = position === null ? {} : lineAndColumnAt(text, position);
    failFileValidation({
      source: options.source,
      format: 'json',
      reason: error instanceof Error ? error.message : 'JSON 语法无效',
      expected: '合法 JSON 语法',
      actual: position === null ? '无法定位的语法错误' : JSON.stringify(text[position] ?? '文件末尾'),
      ...location,
    });
  }

  const expectedRoot = options.expectedRoot ?? 'object-or-array';
  const isArray = Array.isArray(parsed);
  const isObject = parsed !== null && typeof parsed === 'object' && !isArray;
  const rootMatches = expectedRoot === 'array'
    ? isArray
    : expectedRoot === 'object'
      ? isObject
      : isObject || isArray;
  if (!rootMatches) {
    failFileValidation({
      source: options.source,
      format: 'json',
      reason: '根节点类型无效',
      expected: expectedRoot === 'array'
        ? '数组'
        : expectedRoot === 'object'
          ? '对象'
          : '对象或数组',
      actual: describeValue(parsed),
      line: 1,
      column: 1,
    });
  }

  return parsed as T;
}

export async function parseJsonResponse<T = unknown>(
  response: Response,
  source: string,
): Promise<T> {
  // Some legacy services return valid JSON as text/plain. Validate the bytes
  // themselves instead of trusting or rejecting solely on response metadata.
  return parseJsonText<T>(await response.text(), { source, expectedRoot: 'object-or-array' });
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

export function validateParquetBuffer(buffer: ArrayBuffer, source: string): void {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 8) {
    failFileValidation({
      source,
      format: 'parquet',
      reason: '文件短于 Parquet 头尾标记',
      expected: '至少 8 字节',
      actual: `${bytes.byteLength} 字节`,
      byteOffset: bytes.byteLength,
    });
  }
  const header = asciiAt(bytes, 0, 4);
  if (header !== 'PAR1') {
    failFileValidation({
      source,
      format: 'parquet',
      reason: '文件头魔数无效',
      expected: 'PAR1',
      actual: JSON.stringify(header),
      byteOffset: 0,
    });
  }
  const footerOffset = bytes.byteLength - 4;
  const footer = asciiAt(bytes, footerOffset, 4);
  if (footer !== 'PAR1') {
    failFileValidation({
      source,
      format: 'parquet',
      reason: '文件尾魔数无效，文件可能被截断',
      expected: 'PAR1',
      actual: JSON.stringify(footer),
      byteOffset: footerOffset,
    });
  }
}

export function validateAttachmentBytes(
  bytes: Uint8Array,
  source: string,
  format: 'pdf' | 'png' | 'jpeg',
): void {
  const signatures = {
    pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
    png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    jpeg: [0xff, 0xd8, 0xff],
  } as const;
  const expected = signatures[format];
  // ISO 32000 permits the PDF header anywhere in the first 1024 bytes.
  const candidateOffsets = format === 'pdf'
    ? Array.from({ length: Math.max(0, bytes.length - expected.length + 1) }, (_, index) => index)
    : [0];
  const matches = candidateOffsets.some(offset => (
    expected.every((byte, index) => bytes[offset + index] === byte)
  ));
  if (!matches) {
    failFileValidation({
      source,
      format,
      reason: '文件签名与声明类型不一致',
      expected: expected.map(byte => byte.toString(16).padStart(2, '0')).join(' '),
      actual: Array.from(bytes.subarray(0, expected.length))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join(' ') || '空响应',
      byteOffset: 0,
    });
  }
}
