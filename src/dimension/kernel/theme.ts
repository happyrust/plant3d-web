import type {
  DimensionLineStyle,
  DimensionSemanticRole,
  InteractionState,
  SceneTone,
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
   * regions, and SVG export. Text strokes stay heavier than dimension lines
   * (CAD practice); 1.8 px keeps 10–13 px LFF glyphs legible once their
   * edges are feathered (user's call, 2026-09-14). On screen the painter
   * hints screen-space text to whole device pixels — 2 on a 1× display, 4
   * on a 2× one — never below 2 (ADR 0064), and the dimension strokes
   * (dimension / extension / leader lines, markers) the same way from
   * 1.2 px: 2 device px on a 1× display (the floor — a thinner feathered
   * stroke has no solid core, so at 1× lines and text weigh the same),
   * 2 on a 2× one (2026-09-14 21:xx). Hit regions and SVG use the nominal
   * widths.
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
  /**
   * Billboard tags (`ExplicitLayoutInput.tag`, reference drawing style
   * 2026-09-12): screen-sized bodies hanging off a 3D anchor. All lengths are
   * CSS px — a tag is a sheet-like element, so it keeps its size at every
   * camera distance while the pipe and the 3D dimensions scale.
   */
  tag: Readonly<{
    /** Cap height of card / frame text and of pill text. */
    textHeightPx: number;
    pillTextHeightPx: number;
    /** Line advance as a multiple of the cap height. */
    lineAdvance: number;
    /** Inner padding of a card / frame body and of a pill body. */
    paddingPx: number;
    pillPaddingPx: number;
    /** Corner radius of a card / frame body (a pill is fully rounded). */
    cornerRadiusPx: number;
    /**
     * Anchor → body centre distance per style, before the size-dependent
     * share (`standoffSizeRatio · max(width, height)`) that keeps a large
     * card clear of the pipe.
     */
    standoffPx: Readonly<Record<'card' | 'frame' | 'pill', number>>;
    standoffSizeRatio: number;
    /**
     * Upward bias (screen) blended into the anchor → body direction per
     * style: tags sit above the pipe like drawing call-outs.
     */
    upwardBias: Readonly<Record<'card' | 'frame' | 'pill', number>>;
    /**
     * Where a tag goes when every candidate position intrudes on something
     * (a close-up where a component's projected box swallows all rings):
     * `least-intrusion` takes the candidate with the smallest weighted
     * covered area on any ring, which may lead the tag far out; `first-ring`
     * only looks at the nearest ring, so the tag stays by its anchor on a
     * short leader and accepts the overlap.
     */
    blockedFallback: 'least-intrusion' | 'first-ring';
    /**
     * Stroke widths (CSS px, nominal). On screen the painter hints them
     * like the dimension strokes — whole device pixels, never below 2, an
     * axis-aligned edge snapped to the pixel grid (ADR 0064 补, 2026-09-14):
     * at 1× all three are 2 device px; at 2× the 1 px border stays 2, the
     * 1.2 px frame rounds to 2, the 0.9 px leader to 2. Hit regions and
     * the SVG export use the nominal widths.
     */
    leaderWidthPx: number;
    borderWidthPx: number;
    frameWidthPx: number;
    /** Radius of the dot marking the leader target. */
    dotRadiusPx: number;
    /** Palette: body fill, card border, frame, leader / dot, text, pill text. */
    fillColor: string;
    borderColor: string;
    frameColor: string;
    leaderColor: string;
    textColor: string;
    mutedTextColor: string;
  }>;
  /**
   * Inspection display mode (S4, 2026-09-13): dimensions are never hidden,
   * but a record whose probe point lies behind model geometry from the
   * camera is faded to `occludedAlpha`, the rest to `visibleAlpha` (so the
   * two states differ while everything still reads). `engineering` mode
   * paints at alpha 1 and never probes. The overlay is drawn after the
   * frame's tone mapping straight into the sRGB canvas (ADR 0064), so these
   * are blend factors in sRGB and the share of the opaque contrast that
   * survives is the factor itself: 0.65 keeps about 65 %, 0.35 about 35 %.
   * (While the overlay still blended in linear light under ACES, the same
   * look needed 0.92 / 0.80 — d-417, 2026-09-14.)
   */
  inspection: Readonly<{
    visibleAlpha: number;
    occludedAlpha: number;
    /**
     * Occlusion tolerance: a hit has to be at least this much nearer the
     * camera than the probe point — the larger of a model distance (mm) and
     * a screen distance (px at the probe's depth) — so geometry the probe
     * itself sits on (a tag anchor on the pipe surface) never counts.
     */
    toleranceMm: number;
    tolerancePx: number;
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
  textStrokeWidthPx: 1.8,
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
  tag: {
    textHeightPx: 11,
    // Pill text (elbow angle / elevation) at the card height: 10 px read too
    // thin next to the frames and cards (user's call, 2026-09-14).
    pillTextHeightPx: 11,
    lineAdvance: 1.5,
    paddingPx: 7,
    pillPaddingPx: 4,
    cornerRadiusPx: 4,
    standoffPx: { card: 96, frame: 64, pill: 34 },
    standoffSizeRatio: 0.35,
    upwardBias: { card: 1, frame: 1, pill: 0.5 },
    blockedFallback: 'least-intrusion',
    leaderWidthPx: 0.9,
    borderWidthPx: 1,
    frameWidthPx: 1.2,
    dotRadiusPx: 2.4,
    fillColor: '#ffffff',
    borderColor: '#94a3b8',
    frameColor: '#0f172a',
    leaderColor: '#64748b',
    textColor: '#0f172a',
    mutedTextColor: '#334155',
  },
  inspection: {
    // ≈ 0.65 / 0.35 of the opaque contrast, blended in sRGB (see the type
    // doc; ADR 0064). Under the earlier linear-light blending these read as
    // ≈ 0.20 / 0.08 and had to be 0.92 / 0.80.
    visibleAlpha: 0.65,
    occludedAlpha: 0.35,
    toleranceMm: 0.5,
    tolerancePx: 2,
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

/**
 * Colour of a tag stroke / fill: the fill is always the tag body colour, an
 * interaction role (hovered / selected) keeps its highlight on every stroke,
 * and otherwise the tag palette decides. Shared by the scene painter and the
 * SVG export so both draw the same tag.
 */
export function resolveTagToneColor(
  theme: DimensionTheme,
  styleRole: string,
  tone: SceneTone,
): string {
  if (tone === 'tag-fill') return theme.tag.fillColor;
  if (styleRole === 'hovered' || styleRole === 'selected') {
    return theme.colors[styleRole];
  }
  switch (tone) {
    case 'tag-text':
      return theme.tag.textColor;
    case 'tag-muted-text':
      return theme.tag.mutedTextColor;
    case 'tag-border':
      return theme.tag.borderColor;
    case 'tag-frame':
      return theme.tag.frameColor;
    case 'tag-leader':
      return theme.tag.leaderColor;
  }
}

export function resolveTagToneStrokeWidth(
  theme: DimensionTheme,
  tone: SceneTone,
): number {
  switch (tone) {
    case 'tag-text':
    case 'tag-muted-text':
      return theme.textStrokeWidthPx;
    case 'tag-border':
      return theme.tag.borderWidthPx;
    case 'tag-frame':
      return theme.tag.frameWidthPx;
    case 'tag-leader':
      return theme.tag.leaderWidthPx;
    case 'tag-fill':
      return 0;
  }
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
