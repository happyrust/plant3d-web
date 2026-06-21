import type { MbdPipeViewMode } from '@/api/mbdPipeApi';
import type { MbdPipeAnnotationDisplayMode } from '@/composables/useToolStore';

export type MbdRequestIntent =
  | 'interactive_annotation'
  | 'length_focus'
  | 'drawing_reference';

export type MbdLayoutMode =
  | 'semantic_only'
  | 'backend_hints'
  | 'backend_prelaid'
  | 'sheet_fixed';

export type MbdRenderMode =
  | 'interactive_3d'
  | 'drawing_sheet';

export type MbdDataScope = {
  lengths: {
    segment: boolean;
    chain: boolean;
    overall: boolean;
    port: boolean;
    cutTubi: boolean;
  };
  semantics: {
    fittings: boolean;
    tags: boolean;
    positionTags: boolean;
    elevationMarks: boolean;
    branchLabel: boolean;
    materialBalloons: boolean;
    materialTable: boolean;
    welds: boolean;
    bends: boolean;
    slopes: boolean;
  };
};

export type MbdAnnotationRequestAxes = {
  sourceDisplayMode: MbdPipeAnnotationDisplayMode;
  viewMode: MbdPipeViewMode;
  requestIntent: MbdRequestIntent;
  dataScope: MbdDataScope;
  layoutMode: MbdLayoutMode;
  renderMode: MbdRenderMode;
  isLayoutFirst: boolean;
  isDrawingSheet: boolean;
  isFullInteractive: boolean;
  includesFullMbdSemantics: boolean;
  showInlineTubeLengthDims: boolean;
  showPipeVisualEmphasis: boolean;
  hideCutTubiDetails: boolean;
  preloadTimeoutMs: number;
  flyToOnPreload: boolean;
};

export type ResolveMbdAnnotationRequestAxesOptions = {
  displayMode?: MbdPipeAnnotationDisplayMode | null;
  viewMode: MbdPipeViewMode;
};

const LENGTH_SCOPE: MbdDataScope['lengths'] = {
  segment: false,
  chain: true,
  overall: true,
  port: false,
  cutTubi: true,
};

function createSemanticScope(enabled: boolean): MbdDataScope['semantics'] {
  return {
    fittings: enabled,
    tags: enabled,
    positionTags: enabled,
    elevationMarks: enabled,
    branchLabel: enabled,
    materialBalloons: enabled,
    materialTable: enabled,
    welds: enabled,
    bends: enabled,
    slopes: false,
  };
}

export function resolveMbdAnnotationRequestAxes(
  options: ResolveMbdAnnotationRequestAxesOptions,
): MbdAnnotationRequestAxes {
  const sourceDisplayMode = options.displayMode ?? 'full';
  const isLayoutFirst = options.viewMode === 'layout_first';
  const isDrawingSheet = isLayoutFirst && sourceDisplayMode === 'drawing';
  const isFullInteractive = isLayoutFirst && sourceDisplayMode === 'full';
  const includesFullMbdSemantics = isDrawingSheet;
  const requestIntent: MbdRequestIntent =
    sourceDisplayMode === 'drawing'
      ? 'drawing_reference'
      : sourceDisplayMode === 'length'
        ? 'length_focus'
        : 'interactive_annotation';
  const layoutMode: MbdLayoutMode =
    isDrawingSheet
      ? 'sheet_fixed'
      : isLayoutFirst
        ? 'backend_hints'
        : 'semantic_only';
  const renderMode: MbdRenderMode = isDrawingSheet ? 'drawing_sheet' : 'interactive_3d';

  return {
    sourceDisplayMode,
    viewMode: options.viewMode,
    requestIntent,
    dataScope: {
      lengths: { ...LENGTH_SCOPE },
      semantics: createSemanticScope(includesFullMbdSemantics),
    },
    layoutMode,
    renderMode,
    isLayoutFirst,
    isDrawingSheet,
    isFullInteractive,
    includesFullMbdSemantics,
    showInlineTubeLengthDims: includesFullMbdSemantics,
    showPipeVisualEmphasis: isDrawingSheet,
    hideCutTubiDetails: includesFullMbdSemantics,
    preloadTimeoutMs: isDrawingSheet ? 12_000 : 20_000,
    flyToOnPreload: !isDrawingSheet,
  };
}
