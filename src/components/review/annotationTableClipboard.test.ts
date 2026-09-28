import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildRowClipboardLine,
  copyToClipboard,
  pickItemRefno,
} from './annotationTableClipboard';

import type { AnnotationWorkspaceItem } from './annotationWorkspaceModel';

function createItem(overrides: Partial<AnnotationWorkspaceItem> = {}): AnnotationWorkspaceItem {
  return {
    id: 'ann-1',
    type: 'text',
    title: 'DN800 管段',
    description: '偏左',
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

describe('pickItemRefno', () => {
  it('空数组返回空串', () => {
    expect(pickItemRefno(createItem())).toBe('');
  });

  it('单个 refno 直接返回', () => {
    expect(pickItemRefno(createItem({ refnos: ['24381_145018'] }))).toBe('24381_145018');
  });

  it('多个 refno 用 "; " 连接', () => {
    expect(pickItemRefno(createItem({ refnos: ['A', 'B', 'C'] }))).toBe('A ; B ; C');
  });
});

describe('buildRowClipboardLine', () => {
  it('单行 CSV 与默认列表头对应', () => {
    const item = createItem({
      title: 'DN800 管段',
      description: '偏左',
      refnos: ['24381_145018'],
      statusLabel: '待处理',
      priorityLabel: '高',
      severity: 'severe',
      activityAt: new Date('2026-04-22T00:00:00Z').getTime(),
      commentCount: 2,
    });
    const line = buildRowClipboardLine(item, 0);
    // 应包含: 1, 高·severe, DN800 管段, 偏左, refno, 待处理, 时间, 2
    expect(line).toContain('DN800 管段');
    expect(line).toContain('24381_145018');
    expect(line).toContain('待处理');
    expect(line).not.toContain('\n'); // 单行
  });
});

describe('copyToClipboard', () => {
  let originalClipboard: typeof navigator.clipboard | undefined;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    }
    vi.restoreAllMocks();
  });

  it('优先走 navigator.clipboard.writeText · 返回 copied', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const result = await copyToClipboard('hello');
    expect(result).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('clipboard.writeText 抛错时降级到 execCommand · 返回 fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('not-allowed');
        }),
      },
    });

    const execMock = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execMock,
    });

    const result = await copyToClipboard('hi');
    expect(result).toBe('fallback');
    expect(execMock).toHaveBeenCalledWith('copy');
  });

  it('execCommand 也失败时返回 failed', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('not-allowed');
        }),
      },
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });

    const result = await copyToClipboard('x');
    expect(result).toBe('failed');
  });
});
