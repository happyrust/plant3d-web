import { describe, expect, it } from 'vitest';

import { layoutResultsToSvg } from '../../export/svgOverlay';
import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutChain } from './chain';

import type { LayoutContext } from './context';
import type { NormalizedDimensionInput, ScreenGlyphRun } from '../types';

const context: LayoutContext = {
  projector: createTestProjector(),
  font: createTestFont(),
  theme: SOLVESPACE_DIMENSION_THEME,
  format: DEFAULT_DIMENSION_FORMAT,
  interaction: 'normal',
};

function chain(
  showOverall = true,
): Extract<NormalizedDimensionInput, { kind: 'chain' }> {
  return {
    id: 'chain',
    kind: 'chain',
    role: 'normal',
    labelPinned: false,
    anchors: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [4, 0, 0]],
    placement: { offsetM: 0.2, labelT: 0.5, side: 1 },
    showOverall,
    directions: { dimensionDirection: [1, 0, 0] },
  };
}

function labels(result: ReturnType<typeof layoutChain>): string[] {
  return result.primitives
    .filter((primitive): primitive is ScreenGlyphRun => primitive.kind === 'glyph-run')
    .map(glyph => glyph.text);
}

describe('layoutChain', () => {
  it('draws each adjacent span and an overall value from one record', () => {
    const result = layoutChain(chain(true), context);
    expect(result.dimensionId).toBe('chain');
    expect(result.derived.valueM).toBeCloseTo(4);
    expect(labels(result)).toEqual(['1000.00', '1000.00', '2000.00', '4000.00']);
    expect(layoutChain(chain(false), context).derived.formattedLabel).toBe('1000.00 · 1000.00 · 2000.00');
  });

  it('keeps the same lengths when the camera rotates', () => {
    const angle = Math.PI / 5;
    const right: [number, number, number] = [Math.cos(angle), 0, -Math.sin(angle)];
    const rotated: LayoutContext = {
      ...context,
      projector: {
        ...createTestProjector(),
        right,
        forward: [-Math.sin(angle), 0, -Math.cos(angle)],
        project: point => ({
          x: 200 + (point[0] * right[0] + point[2] * right[2]) * 100,
          y: 200 - point[1] * 100,
          depth: 0,
        }),
      },
    };
    expect(layoutChain(chain(), rotated).derived.valueM).toBeCloseTo(4);
    expect(labels(layoutChain(chain(), rotated))).toEqual(labels(layoutChain(chain(), context)));
  });

  it('exports every chain label through the shared SVG serializer', () => {
    const svg = layoutResultsToSvg(
      [layoutChain(chain(), context)],
      createTestFont(),
      SOLVESPACE_DIMENSION_THEME,
      {
        formatPolicy: DEFAULT_DIMENSION_FORMAT,
        viewport: { widthCssPx: 400, heightCssPx: 400, dpr: 2 },
        exportedAt: 1,
      },
    );
    expect(svg).toContain('data-dimension-id="chain"');
    expect(svg.match(/data-part="label"/g)?.length).toBe(4);
  });
});
