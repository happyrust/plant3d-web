import { describe, expect, it, vi } from 'vitest';

import { createTestFont } from '../kernel/testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../kernel/theme';

import { Canvas2DDimensionPainter } from './canvasPainter';

import type { LayoutResult } from '../kernel/types';

type RecordedOperation = Readonly<{
  name: string;
  args: readonly unknown[];
}>;

function createRecordingCanvas() {
  const operations: RecordedOperation[] = [];
  const context = {
    strokeStyle: '',
    lineWidth: 0,
    setTransform: (...args: unknown[]) => operations.push({ name: 'setTransform', args }),
    clearRect: (...args: unknown[]) => operations.push({ name: 'clearRect', args }),
    beginPath: (...args: unknown[]) => operations.push({ name: 'beginPath', args }),
    moveTo: (...args: unknown[]) => operations.push({ name: 'moveTo', args }),
    lineTo: (...args: unknown[]) => operations.push({ name: 'lineTo', args }),
    stroke: (...args: unknown[]) => operations.push({ name: 'stroke', args }),
    save: (...args: unknown[]) => operations.push({ name: 'save', args }),
    restore: (...args: unknown[]) => operations.push({ name: 'restore', args }),
    setLineDash: (...args: unknown[]) => operations.push({ name: 'setLineDash', args }),
    fillText: vi.fn(() => {
      throw new Error('Canvas painter must not use fillText');
    }),
    strokeText: vi.fn(() => {
      throw new Error('Canvas painter must not use strokeText');
    }),
    measureText: vi.fn(() => {
      throw new Error('Canvas painter must not use measureText');
    }),
  };
  const canvas = {
    width: 0,
    height: 0,
    style: { width: '', height: '' },
    getContext: vi.fn(() => context),
  } as unknown as HTMLCanvasElement;
  return { canvas, context, operations };
}

const layouts: readonly LayoutResult[] = [
  {
    dimensionId: 'first',
    primitives: [
      {
        kind: 'line',
        from: [10, 10],
        to: [30, 10],
        part: 'dimension',
        styleRole: 'normal',
      },
      {
        kind: 'glyph-run',
        text: 'A',
        origin: [12, 24],
        capHeightPx: 10,
        bounds: { x: 12, y: 14, width: 2, height: 10 },
        styleRole: 'normal',
      },
    ],
    hitRegions: [],
    labelBounds: { x: 12, y: 14, width: 2, height: 10 },
    labelPinned: false,
    derived: { formattedLabel: 'A' },
  },
  {
    dimensionId: 'second',
    primitives: [
      {
        kind: 'line',
        from: [40, 40],
        to: [60, 40],
        part: 'leader',
        styleRole: 'selected',
      },
    ],
    hitRegions: [],
    labelBounds: { x: 40, y: 40, width: 0, height: 0 },
    labelPinned: false,
    derived: { formattedLabel: '' },
  },
];

describe('Canvas2DDimensionPainter', () => {
  it('resizes the one canvas in physical and CSS pixels', () => {
    const { canvas } = createRecordingCanvas();
    const painter = new Canvas2DDimensionPainter(canvas, createTestFont());

    painter.resize(320, 180, 2);

    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(360);
    expect(canvas.style.width).toBe('320px');
    expect(canvas.style.height).toBe('180px');
  });

  it('clears in CSS coordinates and batches LFF traces by style role', () => {
    const { canvas, context, operations } = createRecordingCanvas();
    const painter = new Canvas2DDimensionPainter(canvas, createTestFont());
    painter.resize(320, 180, 2);
    operations.length = 0;

    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);

    expect(operations.filter(operation => operation.name === 'setTransform')).toEqual([
      { name: 'setTransform', args: [2, 0, 0, 2, 0, 0] },
    ]);
    expect(operations).toContainEqual({
      name: 'clearRect',
      args: [0, 0, 320, 180],
    });
    expect(operations.filter(operation => operation.name === 'stroke')).toHaveLength(2);
    expect(operations.filter(operation => operation.name === 'moveTo').length)
      .toBeGreaterThan(2);
    expect(context.fillText).not.toHaveBeenCalled();
    expect(context.strokeText).not.toHaveBeenCalled();
    expect(context.measureText).not.toHaveBeenCalled();
  });

  it('clears and releases canvas backing storage on dispose', () => {
    const { canvas, operations } = createRecordingCanvas();
    const painter = new Canvas2DDimensionPainter(canvas, createTestFont());
    painter.resize(100, 50, 1.5);
    operations.length = 0;

    painter.dispose();

    expect(operations).toContainEqual({
      name: 'clearRect',
      args: [0, 0, 100, 50],
    });
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('caches repeated LFF glyph traces across frames', () => {
    const { canvas } = createRecordingCanvas();
    const font = createTestFont();
    const trace = vi.spyOn(font, 'trace');
    const painter = new Canvas2DDimensionPainter(canvas, font);
    painter.resize(320, 180, 1);

    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);
    painter.paint(layouts, SOLVESPACE_DIMENSION_THEME);

    expect(trace).toHaveBeenCalledTimes(1);
  });
});
