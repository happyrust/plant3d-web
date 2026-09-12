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
  /**
   * 3D running dimensions (`ExplicitLayoutInput.dimension3d`, reference
   * drawing style 2026-09-12). Lengths suffixed `H` are multiples of the text
   * height `h = max(source cheight, textFloorPx · worldPerPixel)`, so the
   * whole annotation keeps its proportions at any camera distance.
   */
  dimension3d: Readonly<{
    /** Screen floor for `h`: 3D text never projects below this cap height. */
    textFloorPx: number;
    /** Pipe surface → innermost dimension line. */
    standoffH: number;
    /** Distance between solver rows (atta / main). */
    rowSpacingH: number;
    /** Text baseline above the dimension line (ISO 129-1 §5.7.2). */
    textGapH: number;
    /** Extension line starts this far outside the pipe surface … */
    extensionStartH: number;
    /** … and runs this far past the dimension line (drawing convention). */
    extensionOvershootH: number;
    /** Filled arrowhead length; half-angle is `arrowHalfAngleDeg`. */
    arrowLengthH: number;
    /** Dimension-line tail past an outside arrowhead (small dims). */
    outsideTailH: number;
    /** Clearance, in px, added when deciding whether text fits between the arrowheads. */
    outsideClearancePx: number;
    /**
     * Projected baseline shorter than this fraction of the ideal cap height
     * means the text plane is edge-on; the value falls back to view-plane text.
     */
    foreshortenRatio: number;
    /** Heavier strokes (bold) plus a contrasting halo keep 3D text legible over the pipe. */
    textStrokeWidthPx: number;
    textHaloWidthPx: number;
    textHaloColor: string;
  }>;
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
  dimension3d: {
    textFloorPx: 13,
    standoffH: 1.2,
    rowSpacingH: 1.7,
    textGapH: 0.3,
    extensionStartH: 0.15,
    extensionOvershootH: 0.3,
    arrowLengthH: 0.9,
    outsideTailH: 0.4,
    outsideClearancePx: 8,
    foreshortenRatio: 0.35,
    textStrokeWidthPx: 2,
    textHaloWidthPx: 1.4,
    textHaloColor: '#ffffff',
  },
  colors: {
    normal: '#ff1aff',
    hovered: '#ffff00',
    // Selected: green, the one hue still free once external dimensions turned
    // red — apart from red / magenta / yellow / amber / pink and the blue pipe.
    selected: '#16a34a',
    invalid: '#f59e0b',
    approximate: '#f472b6',
    // External (MBD / measurement) dimension lines: drawing red (reference
    // isometric style, 2026-09-12), deliberately apart from the user-dimension
    // magenta, from the DTX selection highlight (0xff4fd8) and from the default
    // blue pipe body, so a selected BRAN and its MBD dimensions stay
    // distinguishable and the lines still read where they run over the pipe
    // (QW2 first went deep orange #c2410c; deep cyan #0e7490 vanished against
    // the pipe).
    external: '#c81e1e',
    'external-reference': '#c81e1e',
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
