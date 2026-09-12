import type {
  DimensionLineStyle,
  DimensionSemanticRole,
  InteractionState,
} from './types';

export type DimensionStyleRole =
  | DimensionSemanticRole
  | Exclude<InteractionState, 'normal'>;

export type DimensionTheme = Readonly<{
  textHeightPx: number;
  arrowLengthPx: number;
  arrowHalfAngleDeg: number;
  /**
   * Legibility floor for explicit arrow strokes (`ExplicitLayoutInput.arrowLines`,
   * e.g. MBD `arrow_lines`): a wing whose projection is shorter than this is
   * stretched on screen about its tip to this length; longer wings draw 1:1
   * (ADR 0056). Defaults to `arrowLengthPx` so a clamped wing matches the
   * filled heads of user dimensions.
   */
  arrowLineMinLengthPx: number;
  /**
   * Clamp for source-declared text heights (`ExplicitLayoutInput.textHeightM`,
   * e.g. MBD `meta.cheight_mm`): the projected height is lifted to the floor
   * on a plant-wide view and capped at the ceiling on a close-up, so labels
   * follow the model like PML `cheight` without becoming unreadable or
   * filling the viewport. Fixed-height sources ignore both.
   */
  sourceTextHeightMinPx: number;
  sourceTextHeightMaxPx: number;
  /**
   * Level of detail for explicit inputs that opt in (`lod.hideShort`): a
   * dimension whose projected line is shorter than this many label widths is
   * elided for the current view (S3).
   */
  lodMinLineToLabelRatio: number;
  extensionOvershootPx: number;
  labelPaddingPx: number;
  outsideExtensionPx: number;
  minArcRadiusPx: number;
  /**
   * Stroke widths (CSS px) for the screen-space stroke-quad renderer, hit
   * regions, and SVG export. Text strokes stay slightly heavier than
   * dimension lines (CAD practice).
   */
  textStrokeWidthPx: number;
  dimensionStrokeWidthPx: number;
  colors: Readonly<Record<DimensionStyleRole, string>>;
  /**
   * Label text colors per role; roles not listed fall back to `colors`, so
   * interaction highlights (hovered/selected) and semantic warnings
   * (invalid/approximate) keep tinting text. Normal/external labels read
   * better dark on the light viewport background than in dimension magenta.
   */
  textColors: Readonly<Partial<Record<DimensionStyleRole, string>>>;
}>;

export const SOLVESPACE_DIMENSION_THEME: DimensionTheme = {
  textHeightPx: 13,
  arrowLengthPx: 13,
  arrowHalfAngleDeg: 18,
  arrowLineMinLengthPx: 13,
  sourceTextHeightMinPx: 11,
  sourceTextHeightMaxPx: 18,
  lodMinLineToLabelRatio: 1,
  extensionOvershootPx: 10,
  labelPaddingPx: 8,
  outsideExtensionPx: 18,
  minArcRadiusPx: 15,
  textStrokeWidthPx: 1.5,
  dimensionStrokeWidthPx: 1.2,
  colors: {
    normal: '#ff1aff',
    hovered: '#ffff00',
    selected: '#ff0000',
    invalid: '#f59e0b',
    approximate: '#f472b6',
    // External (MBD / measurement) dimension lines: deep orange, deliberately
    // apart from the user-dimension magenta, from the DTX selection highlight
    // (0xff4fd8) and from the default blue pipe body, so a selected BRAN and
    // its MBD dimensions stay distinguishable and the lines still read where
    // they run over the pipe (QW2, 2026-09-12 linear-dim visual optimization
    // plan; deep cyan #0e7490 was tried first and vanished against the pipe).
    external: '#c2410c',
    'external-reference': '#c2410c',
  },
  textColors: {
    normal: '#111827',
    external: '#111827',
  },
};

export function resolveDimensionStyleRole(
  role: DimensionSemanticRole,
  interaction: InteractionState,
): DimensionStyleRole {
  return interaction === 'normal' ? role : interaction;
}

export function resolveDimensionColor(
  theme: DimensionTheme,
  role: DimensionSemanticRole,
  interaction: InteractionState,
): string {
  return theme.colors[resolveDimensionStyleRole(role, interaction)];
}

const ROLE_LINE_DASH: Readonly<Record<string, readonly number[]>> = {
  'external-reference': [6, 4],
  invalid: [7, 3],
  approximate: [2, 2],
};

const STYLE_LINE_DASH: Readonly<Record<DimensionLineStyle, readonly number[]>> = {
  solid: [],
  dashed: [6, 4],
  'dash-dot': [8, 3, 2, 3],
};

/**
 * Dash pattern for a primitive: an explicit per-primitive line style wins,
 * otherwise the semantic style role decides (ADR 0042).
 */
export function resolveDimensionLineDash(
  styleRole: string,
  lineStyle?: DimensionLineStyle,
): readonly number[] {
  if (lineStyle) return STYLE_LINE_DASH[lineStyle];
  return ROLE_LINE_DASH[styleRole] ?? [];
}
