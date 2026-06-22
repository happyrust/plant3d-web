import { describe, expect, it } from 'vitest';

import { resolveMbdAnnotationRequestAxes } from './mbdPresetMapper';

describe('resolveMbdAnnotationRequestAxes', () => {
  it('maps full layout-first requests to lightweight interactive 3D dimensions', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'full',
      viewMode: 'layout_first',
    });

    expect(axes.requestIntent).toBe('interactive_annotation');
    expect(axes.layoutMode).toBe('backend_hints');
    expect(axes.renderMode).toBe('interactive_3d');
    expect(axes.includesFullMbdSemantics).toBe(false);
    expect(axes.showInlineTubeLengthDims).toBe(false);
    expect(axes.showPipeVisualEmphasis).toBe(false);
    expect(axes.hideCutTubiDetails).toBe(true);
    expect(axes.flyToOnPreload).toBe(true);
    expect(axes.dataScope.semantics.materialBalloons).toBe(false);
  });

  it('maps drawing layout-first requests to fixed sheet layout only when explicitly requested', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'drawing',
      viewMode: 'layout_first',
    });

    expect(axes.requestIntent).toBe('drawing_reference');
    expect(axes.layoutMode).toBe('sheet_fixed');
    expect(axes.renderMode).toBe('drawing_sheet');
    expect(axes.isDrawingSheet).toBe(true);
    expect(axes.includesFullMbdSemantics).toBe(true);
    expect(axes.showPipeVisualEmphasis).toBe(true);
    expect(axes.preloadTimeoutMs).toBe(12_000);
    expect(axes.flyToOnPreload).toBe(false);
    expect(axes.dataScope.semantics.fittings).toBe(true);
  });

  it('maps length requests to core length semantics without full tags or fittings', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'length',
      viewMode: 'layout_first',
    });

    expect(axes.requestIntent).toBe('length_focus');
    expect(axes.layoutMode).toBe('backend_hints');
    expect(axes.renderMode).toBe('interactive_3d');
    expect(axes.includesFullMbdSemantics).toBe(false);
    expect(axes.dataScope.lengths.chain).toBe(true);
    expect(axes.dataScope.lengths.cutTubi).toBe(true);
    expect(axes.dataScope.semantics.tags).toBe(false);
    expect(axes.dataScope.semantics.fittings).toBe(false);
  });

  it('keeps non-layout-first view modes semantic-only and avoids full layout flags', () => {
    const axes = resolveMbdAnnotationRequestAxes({
      displayMode: 'full',
      viewMode: 'construction',
    });

    expect(axes.layoutMode).toBe('semantic_only');
    expect(axes.isLayoutFirst).toBe(false);
    expect(axes.includesFullMbdSemantics).toBe(false);
    expect(axes.showPipeVisualEmphasis).toBe(false);
  });
});
