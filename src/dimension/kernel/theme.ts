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
    external: '#ff1aff',
    'external-reference': '#ff1aff',
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
