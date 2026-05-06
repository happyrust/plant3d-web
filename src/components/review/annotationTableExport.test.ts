import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCsvFilename,
  DEFAULT_ANNOTATION_TABLE_COLUMNS,
  downloadCsv,
  escapeCsvField,
  toAnnotationTableCsv,
  toCsvLine,
} from './annotationTableExport';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

function createItem(overrides: Partial<AnnotationWorkspaceItem> = {}): AnnotationWorkspaceItem {
  return {
    id: 'ann-1',
    type: 'text',
    title: '未命名批注',
    description: '暂无描述',
    createdAt: 1_700_000_000_000,
    activityAt: 1_700_000_000_000,
    visible: true,
    refnos: [],
    commentCount: 0,
    statusKey: 'pending',
    statusLabel: '待处理',
    statusTone: 'bg-slate-100 text-slate-700 border-slate-200',
    priority: 'medium',
    priorityLabel: '中',
    priorityTone: 'bg-blue-100 text-blue-700 border-blue-200',
    ...overrides,
  };
}

describe('escapeCsvField', () => {
  it('无特殊字符原样返回', () => {
    expect(escapeCsvField('DN800 管段')).toBe('DN800 管段');
  });

  it('含逗号时包裹双引号', () => {
    expect(escapeCsvField('a,b,c')).toBe('"a,b,c"');
  });

  it('含双引号时内部转义 + 外层包裹', () => {
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('含换行时包裹双引号', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('null / undefined 输出空串', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('数字转字符串', () => {
    expect(escapeCsvField(42)).toBe('42');
    expect(escapeCsvField(0)).toBe('0');
  });

  it('空串原样返回', () => {
    expect(escapeCsvField('')).toBe('');
  });
});

describe('toCsvLine', () => {
  it('多字段用逗号连接', () => {
    expect(toCsvLine(['a', 'b', 'c'])).toBe('a,b,c');
  });

  it('字段内含逗号时正确包裹', () => {
    expect(toCsvLine(['a,b', 'c'])).toBe('"a,b",c');
  });

  it('空数组返回空串', () => {
    expect(toCsvLine([])).toBe('');
  });

  it('混合 null / number / 带引号字串', () => {
    expect(toCsvLine([null, 42, 'say "hi"'])).toBe(',42,"say ""hi"""');
  });
});

describe('toAnnotationTableCsv', () => {
  it('空 items 只输出表头', () => {
    const csv = toAnnotationTableCsv([]);
    expect(csv).toBe(DEFAULT_ANNOTATION_TABLE_COLUMNS.map((c) => c.header).join(','));
  });

  it('单条 item · 表头 + 数据 2 行', () => {
    const item = createItem({
      title: 'DN800 管段与梁冲突',
      description: '偏左 60mm',
      refnos: ['24381_145018'],
      commentCount: 2,
      statusLabel: '待处理',
      priorityLabel: '高',
      severity: 'severe',
      activityAt: new Date('2026-04-22T08:30:00Z').getTime(),
    });
    const csv = toAnnotationTableCsv([item]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('序号');
    expect(lines[0]).toContain('校核发现问题');
    expect(lines[1]).toContain('DN800 管段与梁冲突');
    expect(lines[1]).toContain('24381_145018');
    expect(lines[1]).toContain('待处理');
    expect(lines[1]).toContain('2026-04-22');
  });

  it('title 含逗号时正确转义', () => {
    const item = createItem({ title: 'A, B, C' });
    const csv = toAnnotationTableCsv([item]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('"A, B, C"');
  });

  it('description 含换行时保留在双引号内', () => {
    const item = createItem({ description: 'line1\nline2' });
    const csv = toAnnotationTableCsv([item]);
    // 包裹整个含换行的字段
    expect(csv).toContain('"line1\nline2"');
  });

  it('多 refno 用 " ; " 连接', () => {
    const item = createItem({ refnos: ['24381_145018', '24381_200101'] });
    const csv = toAnnotationTableCsv([item]);
    expect(csv).toContain('24381_145018 ; 24381_200101');
  });

  it('自定义列只导出指定字段', () => {
    const item = createItem({ title: 'X', description: 'Y' });
    const csv = toAnnotationTableCsv([item], [
      { header: 'Title', accessor: (i) => i.title },
    ]);
    expect(csv).toBe('Title\r\nX');
  });

  it('accessor 返回 null 时输出空串', () => {
    const item = createItem();
    const csv = toAnnotationTableCsv([item], [
      { header: 'Nothing', accessor: () => null },
    ]);
    expect(csv).toBe('Nothing\r\n');
  });
});

describe('buildCsvFilename', () => {
  it('基本格式 prefix-任务-YYYYMMDD.csv', () => {
    const name = buildCsvFilename({ taskKey: 'SJ-0418', at: new Date('2026-04-22T00:00:00Z') });
    expect(name).toMatch(/^plant3d-annotations-SJ-0418-\d{8}\.csv$/);
  });

  it('任务 key 中非法字符会被清理', () => {
    const name = buildCsvFilename({ taskKey: 'SJ 2026/0418!', at: new Date('2026-04-22T00:00:00Z') });
    expect(name).toMatch(/^plant3d-annotations-SJ20260418-\d{8}\.csv$/);
  });

  it('未提供 taskKey 时只保留日期', () => {
    const name = buildCsvFilename({ at: new Date('2026-04-22T00:00:00Z') });
    expect(name).toMatch(/^plant3d-annotations-\d{8}\.csv$/);
  });

  it('使用当前时间作为默认', () => {
    const name = buildCsvFilename();
    expect(name).toMatch(/^plant3d-annotations-\d{8}\.csv$/);
  });

  it('日期零填充', () => {
    const name = buildCsvFilename({ at: new Date(2026, 0, 3) });
    expect(name).toContain('20260103');
  });
});

describe('downloadCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('在 happy-dom 环境下触发下载并清理 blob URL', () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    const originalUrl = window.URL;
    window.URL = {
      ...originalUrl,
      createObjectURL,
      revokeObjectURL,
    } as unknown as typeof URL;

    vi.useFakeTimers();

    const appended: HTMLAnchorElement[] = [];
    const clickSpy = vi.fn();
    const originalAppendChild = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLAnchorElement) {
        appended.push(node);
        node.click = clickSpy;
      }
      return originalAppendChild(node);
    });

    const ok = downloadCsv('test.csv', 'hello,world');

    expect(ok).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(1);
    expect(appended[0].download).toBe('test.csv');

    // 推进 1 秒让 setTimeout 跑完
    vi.advanceTimersByTime(1_100);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    vi.useRealTimers();
    window.URL = originalUrl;
  });
});
