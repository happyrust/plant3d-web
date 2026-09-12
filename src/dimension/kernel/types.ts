export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type ScreenRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type InteractionState = 'normal' | 'hovered' | 'selected';
export type DimensionSemanticRole =
  | 'normal'
  | 'external'
  | 'external-reference'
  | 'invalid'
  | 'approximate';

/** Per-primitive stroke style; overrides the role-derived dash when set. */
export type DimensionLineStyle = 'solid' | 'dashed' | 'dash-dot';

export type ScreenLinePart =
  | 'dimension'
  | 'extension'
  | 'projection'
  | 'leader'
  | 'arc'
  | 'arrow';

export type ScreenLine = Readonly<{
  kind: 'line';
  from: Vec2;
  to: Vec2;
  part: ScreenLinePart;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

/**
 * One connected polyline path (projected design-space arc/circle). Kept as a
 * single primitive so dash patterns flow continuously along the whole path
 * (ADR 0042).
 */
export type ScreenPath = Readonly<{
  kind: 'path';
  points: readonly Vec2[];
  closed: boolean;
  part: ScreenLinePart;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

export type ScreenMarkerShape = 'circle' | 'cross';

/** Screen-pixel sized symbol anchored at a projected design-space point. */
export type ScreenMarker = Readonly<{
  kind: 'marker';
  at: Vec2;
  shape: ScreenMarkerShape;
  radiusPx: number;
  part: string;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

export type ScreenGlyphRun = Readonly<{
  kind: 'glyph-run';
  text: string;
  origin: Vec2;
  capHeightPx: number;
  bounds: ScreenRect;
  unrotatedBounds?: ScreenRect;
  rotationRad?: number;
  rotationCenter?: Vec2;
  styleRole: string;
}>;

export type LayoutPrimitive =
  | ScreenLine
  | ScreenPath
  | ScreenMarker
  | ScreenGlyphRun;

/**
 * One design-space anchor plus a constant view-plane offset. The shader
 * projects the anchor with the active camera, then applies the CSS-pixel
 * offset in clip space, matching SolveSpace's view-facing presentation.
 */
export type SceneVertex = Readonly<{
  anchor: Vec3;
  offsetPx: Vec2;
}>;

export type SceneLine = Readonly<{
  kind: 'scene-line';
  from: SceneVertex;
  to: SceneVertex;
  part: ScreenLinePart;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

export type ScenePath = Readonly<{
  kind: 'scene-path';
  points: readonly SceneVertex[];
  closed: boolean;
  part: ScreenLinePart;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

export type SceneTriangle = Readonly<{
  kind: 'scene-triangle';
  points: readonly [SceneVertex, SceneVertex, SceneVertex];
  part: 'arrow';
  styleRole: string;
}>;

export type SceneMarker = Readonly<{
  kind: 'scene-marker';
  at: SceneVertex;
  shape: ScreenMarkerShape;
  radiusPx: number;
  part: string;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
}>;

export type SceneGlyphRun = Readonly<{
  kind: 'scene-glyph-run';
  text: string;
  at: SceneVertex;
  capHeightPx: number;
  rotationRad: number;
  styleRole: string;
}>;

export type ScenePrimitive =
  | SceneLine
  | ScenePath
  | SceneTriangle
  | SceneMarker
  | SceneGlyphRun;

export type HitRegion =
  | Readonly<{
      kind: 'segment';
      from: Vec2;
      to: Vec2;
      widthPx: number;
      part: string;
    }>
  | Readonly<{
      kind: 'rect';
      rect: ScreenRect;
      part: string;
    }>;

export type LayoutResult = Readonly<{
  dimensionId: string;
  /** Authoritative 3D/view-plane representation consumed by the scene painter. */
  scenePrimitives: readonly ScenePrimitive[];
  /** Projected compatibility snapshot for collision, hit testing, and SVG. */
  primitives: readonly LayoutPrimitive[];
  hitRegions: readonly HitRegion[];
  labelBounds: ScreenRect;
  labelPinned: boolean;
  derived: Readonly<{
    valueM?: number;
    valueRad?: number;
    formattedLabel: string;
    /**
     * Set when the explicit layout was elided by level-of-detail rules
     * (`ExplicitLayoutInput.lod`): the primitives are empty on purpose, not
     * because the geometry failed.
     */
    lodHidden?: ExplicitLodHiddenReason;
  }>;
}>;

export type ExplicitLodHiddenReason = 'secondary-far' | 'short-line';

/**
 * Level-of-detail hints for dense explicit sources (S3, 2026-09-12). Opt-in
 * per input: sources that must always draw (measurements) simply omit it.
 */
export type ExplicitLodInput = Readonly<{
  /**
   * `secondary` (e.g. MBD ATTA sub-dimensions) is elided while the source
   * text height (`textHeightM`) projects below `theme.sourceTextHeightMinPx`,
   * i.e. on a plant-wide view where only the main running dimensions matter.
   */
  tier?: 'primary' | 'secondary';
  /**
   * Elide the whole dimension when its projected dimension line is shorter
   * than `theme.lodMinLineToLabelRatio` label widths — the value could not be
   * read against its own line anyway.
   */
  hideShort?: boolean;
}>;

export type NormalizedDimensionBase = Readonly<{
  id: string;
  role: DimensionSemanticRole;
  labelPinned: boolean;
  authoritativeText?: string;
}>;

export type NormalizedDimensionInput =
  | (NormalizedDimensionBase &
      Readonly<{
        kind: 'linear';
        a: Vec3;
        b: Vec3;
        placement: Readonly<{ offsetM: number; labelT: number; side: 1 | -1 }>;
      }>)
  | (NormalizedDimensionBase &
      Readonly<{
        kind: 'projected';
        a: Vec3;
        b: Vec3;
        axis: Vec3;
        placement: Readonly<{ offsetM: number; labelT: number; side: 1 | -1 }>;
      }>)
  | (NormalizedDimensionBase &
      Readonly<{
        kind: 'angular';
        vertex: Vec3;
        rayA: Vec3;
        rayB: Vec3;
        placement: Readonly<{
          radiusM?: number;
          labelT: number;
          arcChoice: 'minor' | 'major';
        }>;
      }>)
  | (NormalizedDimensionBase &
      Readonly<{
        kind: 'radial';
        center: Vec3;
        rim: Vec3;
        normal: Vec3;
        display: 'radius' | 'diameter';
        placement: Readonly<{ leaderDirection: Vec3; labelDistanceM: number }>;
      }>);

/** Design-space arc; omit both angles for a full circle (radians otherwise). */
export type ExplicitArcInput = Readonly<{
  center: Vec3;
  normal: Vec3;
  radiusM: number;
  startAngle?: number;
  endAngle?: number;
  part?: ScreenLinePart;
  style?: DimensionLineStyle;
}>;

export type ExplicitMarkerInput = Readonly<{
  at: Vec3;
  shape: ScreenMarkerShape;
  radiusPx?: number;
  style?: DimensionLineStyle;
}>;

/**
 * Screen-scaled filled arrowhead at `tip`, its body laid along the projected
 * direction from `tip` towards `towards`. For external sources that carry no
 * arrow geometry of their own; sources that do (MBD `arrow_lines`) go through
 * `arrowLines`, which draws the source strokes with a legibility floor instead
 * (ADR 0048, ADR 0056).
 */
export type ExplicitArrowInput = Readonly<{
  tip: Vec3;
  towards: Vec3;
  /** Point the head inwards from outside the extension lines (small dims). */
  outside?: boolean;
}>;

export type ExplicitTextInput = Readonly<{
  text: string;
  anchor: Vec3;
  /**
   * Screen-space line index below the anchor (0 = at the anchor). Used to
   * stack the lines of a multi-line label without inventing design-space
   * offsets.
   */
  stackIndex?: number;
  /**
   * Design-space baseline direction. The layout projects it and flips the run
   * into the readable half-turn; omit for viewport-horizontal text.
   */
  along?: Vec3;
}>;

export type ExplicitLayoutInput = Readonly<{
  id: string;
  role: DimensionSemanticRole;
  labelPinned: boolean;
  formattedLabel: string;
  lines: readonly Readonly<{
    from: Vec3;
    to: Vec3;
    part: ScreenLinePart;
    style?: DimensionLineStyle;
  }>[];
  labelAnchor: Vec3;
  /** Design-space baseline direction for the primary label. */
  labelAlong?: Vec3;
  /**
   * Source arrow strokes, one segment per wing: `from` is the tip on the
   * dimension line, `to` the wing base. Drawn 1:1; a wing that projects
   * shorter than `theme.arrowLineMinLengthPx` is stretched on screen about
   * `from`, keeping its projected direction (ADR 0056).
   */
  arrowLines: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
  arrows?: readonly ExplicitArrowInput[];
  arcs?: readonly ExplicitArcInput[];
  markers?: readonly ExplicitMarkerInput[];
  /** Additional glyph runs, e.g. extra lines of a multi-line label. */
  texts?: readonly ExplicitTextInput[];
  /**
   * Design-space text height (metres) declared by the source, e.g. the MBD
   * group `cheight_mm` after `source_to_design`. When present, the label cap
   * height and the arrow-stroke legibility floor follow its projection at the
   * label anchor, clamped to `theme.sourceTextHeightMinPx..MaxPx`; absent
   * means the fixed `theme.textHeightPx`.
   */
  textHeightM?: number;
  /** Level-of-detail hints; omitted = always draw. */
  lod?: ExplicitLodInput;
}>;
