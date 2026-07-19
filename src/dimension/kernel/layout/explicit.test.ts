import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_DIMENSION_FORMAT } from '../format';
import { createTestFont, createTestProjector, roundNumbers } from '../testUtils';
import { SOLVESPACE_DIMENSION_THEME } from '../theme';

import { layoutExplicit } from './explicit';

import type { ExplicitLayoutInput } from '../types';
import type { LayoutContext } from './context';

const input: ExplicitLayoutInput = {
  id: 'explicit',
  role: 'external-reference',
  labelPinned: true,
  formattedLabel: '25 REF',
  lines: [{ from: [0, 0, 0], to: [1, 0, 0], part: 'dimension' }],
  labelAnchor: [0.5, 0.2, 0],
  arrowLines: [{ from: [0, 0, 0], to: [0.1, 0.05, 0] }],
};

describe('layoutExplicit', () => {
  it('projects supplied geometry exactly once and adds LFF bounds and hits', () => {
    const projector = createTestProjector();
    const project = vi.spyOn(projector, 'project');
    const context: LayoutContext = {
      projector,
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'normal',
    };

    const result = roundNumbers(layoutExplicit(input, context));

    expect(project).toHaveBeenCalledTimes(5);
    expect(result.labelPinned).toBe(true);
    expect(result.derived).toEqual({ formattedLabel: '25 REF' });
    expect(result.primitives).toEqual([
      {
        kind: 'line',
        from: [200, 200],
        to: [300, 200],
        part: 'dimension',
        styleRole: 'external-reference',
      },
      {
        kind: 'line',
        from: [200, 200],
        to: [210, 195],
        part: 'arrow',
        styleRole: 'external-reference',
      },
      {
        kind: 'glyph-run',
        text: '25 REF',
        origin: [242.525, 185.175],
        capHeightPx: 11.5,
        bounds: { x: 242.525, y: 171.375, width: 14.95, height: 17.25 },
        styleRole: 'external-reference',
      },
    ]);
    expect(result.hitRegions).toHaveLength(3);
  });

  it('routes explicit geometry through interaction colors', () => {
    const result = layoutExplicit(input, {
      projector: createTestProjector(),
      font: createTestFont(),
      theme: SOLVESPACE_DIMENSION_THEME,
      format: DEFAULT_DIMENSION_FORMAT,
      interaction: 'hovered',
    });

    expect(result.primitives.every((primitive) => primitive.styleRole === 'hovered')).toBe(true);
  });
});
