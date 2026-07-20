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
  styleRole: string;
}>;

export type LayoutPrimitive =
  | ScreenLine
  | ScreenPath
  | ScreenMarker
  | ScreenGlyphRun;

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
  primitives: readonly LayoutPrimitive[];
  hitRegions: readonly HitRegion[];
  labelBounds: ScreenRect;
  labelPinned: boolean;
  derived: Readonly<{
    valueM?: number;
    valueRad?: number;
    formattedLabel: string;
  }>;
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

export type ExplicitTextInput = Readonly<{
  text: string;
  anchor: Vec3;
  /**
   * Screen-space line index below the anchor (0 = at the anchor). Used to
   * stack the lines of a multi-line label without inventing design-space
   * offsets.
   */
  stackIndex?: number;
}>;

export type ExplicitLayoutInput = Readonly<{
  id: string;
  role: DimensionSemanticRole;
  labelPinned: true;
  formattedLabel: string;
  lines: readonly Readonly<{
    from: Vec3;
    to: Vec3;
    part: ScreenLinePart;
    style?: DimensionLineStyle;
  }>[];
  labelAnchor: Vec3;
  arrowLines: readonly Readonly<{ from: Vec3; to: Vec3 }>[];
  arcs?: readonly ExplicitArcInput[];
  markers?: readonly ExplicitMarkerInput[];
  /** Additional glyph runs, e.g. extra lines of a multi-line label. */
  texts?: readonly ExplicitTextInput[];
}>;
