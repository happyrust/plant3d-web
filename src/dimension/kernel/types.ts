export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type ScreenRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

/** Axis-aligned Design Space box (metres). */
export type DesignBox = Readonly<{
  min: Vec3;
  max: Vec3;
}>;

/**
 * A convex Design Space volume billboard tags keep clear of — a model
 * component's bounding box in any orientation, given by its corners (the
 * kernel projects them and works with their convex hull on screen).
 */
export type LayoutObstacle = Readonly<{
  corners: readonly Vec3[];
}>;

/**
 * Host seam the viewport layout asks what the billboard tags of one view
 * must keep clear of besides labels and dimension strokes (「标签避让管件」,
 * 2026-09-13). Both parts are optional:
 * - `query` answers with every component box intersecting the Design Space
 *   region, in any order; the kernel projects them and keeps the tag bodies
 *   clear of their outlines.
 * - `overlays` answers with the screen rectangles fixed on the viewport (an
 *   axis gizmo, a legend), in the projector's CSS px; a tag body under one
 *   of them would be as unreadable as one over a value.
 */
export type LayoutObstacleSource = Readonly<{
  query?(region: DesignBox): readonly LayoutObstacle[];
  overlays?(): readonly ScreenRect[];
}>;

/**
 * How the viewport presents dimensions relative to the model (S4,
 * 2026-09-13). `engineering` (default) draws every dimension in full over
 * the model, isometric-drawing style; `inspection` fades dimensions whose
 * value sits behind model geometry from the current camera, so a reviewer
 * can tell the near side from the far side without hiding anything.
 */
export type DimensionDisplayMode = 'engineering' | 'inspection';

/**
 * Host seam the inspection pass asks whether model geometry stands between
 * the camera and a dimension (「inspection 淡化」, 2026-09-13): true when
 * visible geometry meets the Design Space segment `from → to` more than
 * `toleranceM` short of `to`. The kernel never reads a depth buffer or a
 * bounding box for this — the host answers with a real ray cast, so the
 * result is exact for the model it draws and identical for identical
 * camera / model states.
 */
export type OcclusionSource = Readonly<{
  isSegmentBlocked(from: Vec3, to: Vec3, toleranceM: number): boolean;
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
  | 'arrow'
  /** Billboard tag body (card / frame / pill) and its fill. */
  | 'tag';

/**
 * Palette hint for the strokes and fills of a billboard tag (「标签卡片」,
 * 2026-09-12): the painter and the SVG export take colour and stroke width
 * from `theme.tag` instead of the role colour. Interaction roles
 * (hovered / selected) still win, so a highlighted tag reads as such.
 */
export type SceneTone =
  | 'tag-text'
  | 'tag-muted-text'
  | 'tag-border'
  | 'tag-frame'
  | 'tag-leader'
  | 'tag-fill';

export type ScreenLine = Readonly<{
  kind: 'line';
  from: Vec2;
  to: Vec2;
  part: ScreenLinePart;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
  tone?: SceneTone;
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
  tone?: SceneTone;
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
  tone?: SceneTone;
  /**
   * Set for 3D (framed) text: the screen images of the frame points
   * `(0,0) (1,0) (1,1) (0,1)` in cap-height units — x along the baseline
   * from its centre, y up — i.e. the run's perspective as the homography
   * from frame coordinates to the screen. Consumers that can draw
   * perspective text (SVG export) send the unit glyph strokes through it;
   * `origin` / `capHeightPx` / `rotationRad` remain the view-plane
   * approximation for those that cannot.
   */
  perspective?: readonly [Vec2, Vec2, Vec2, Vec2];
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
  tone?: SceneTone;
}>;

export type ScenePath = Readonly<{
  kind: 'scene-path';
  points: readonly SceneVertex[];
  closed: boolean;
  part: ScreenLinePart;
  styleRole: string;
  lineStyle?: DimensionLineStyle;
  tone?: SceneTone;
}>;

export type SceneTriangle = Readonly<{
  kind: 'scene-triangle';
  points: readonly [SceneVertex, SceneVertex, SceneVertex];
  part: 'arrow';
  styleRole: string;
}>;

/**
 * Filled convex polygon (triangle fan over `points`, ≥ 3 vertices) painted
 * underneath every stroke — the body of a billboard tag card or the dot that
 * marks the point its leader points at. Projects to one closed path for the
 * collision / SVG snapshot.
 */
export type SceneFill = Readonly<{
  kind: 'scene-fill';
  points: readonly SceneVertex[];
  part: ScreenLinePart;
  styleRole: string;
  tone: SceneTone;
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

/**
 * Design-space frame for text that lies in a 3D plane instead of the view
 * plane (「三维尺寸呈现」 running dimensions, 2026-09-12): glyph strokes are
 * traced in cap-height units and mapped to `origin + x · xAxis + y · yAxis`,
 * so the run takes the camera's perspective like any other scene geometry.
 */
export type SceneTextFrame = Readonly<{
  /** Baseline centre of the run. */
  origin: Vec3;
  /** One cap height along the reading direction. */
  xAxis: Vec3;
  /** One cap height towards the top of the glyphs. */
  yAxis: Vec3;
}>;

export type SceneGlyphRun = Readonly<{
  kind: 'scene-glyph-run';
  text: string;
  at: SceneVertex;
  capHeightPx: number;
  rotationRad: number;
  styleRole: string;
  /**
   * When set, the run is 3D text in this frame; `at`, `capHeightPx` and
   * `rotationRad` are its view-plane approximation (SVG export, hit bounds).
   */
  frame?: SceneTextFrame;
  tone?: SceneTone;
}>;

export type ScenePrimitive =
  | SceneLine
  | ScenePath
  | SceneTriangle
  | SceneFill
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
    /**
     * Set by the 3D dimension layout: the projected value-text quad and the
     * rank `declutterOverlaps` uses to decide which of two overlapping labels
     * stays (S1 pairwise declutter, 2026-09-12). Higher rank wins.
     */
    declutter?: Readonly<{
      rank: number;
      quad: readonly [Vec2, Vec2, Vec2, Vec2];
    }>;
    /**
     * Set by the billboard tag layout: the body rectangle on screen and the
     * placement candidate it took (0 = preferred position; the viewport's
     * placement pass picks a later one to clear dimension values and other
     * tags).
     */
    tag?: Readonly<{
      candidate: number;
      body: ScreenRect;
    }>;
    /**
     * Set by the inspection pass (`markOcclusion`, display mode
     * `inspection`): model geometry stands between the camera and the
     * dimension's probe point (its value text / tag anchor), so the painter
     * fades the whole record to `theme.inspection.occludedAlpha`. Absent in
     * `engineering` mode.
     */
    occluded?: boolean;
  }>;
}>;

/**
 * `overlap`: the label collided with a higher-ranked 3D dimension label and
 * was elided by `declutterOverlaps` (not moved — solver placement stays
 * authoritative). `detail-far`: a `detail` tier input on a view that is not
 * a close-up yet.
 */
export type ExplicitLodHiddenReason =
  | 'secondary-far'
  | 'detail-far'
  | 'short-line'
  | 'overlap';

/**
 * Level-of-detail hints for dense explicit sources (S3, 2026-09-12). Opt-in
 * per input: sources that must always draw (measurements) simply omit it.
 */
export type ExplicitLodInput = Readonly<{
  /**
   * `secondary` (e.g. MBD ATTA sub-dimensions, elbow elevation tags) is
   * elided while the source text height (`textHeightM`) projects below
   * `theme.sourceTextHeightMinPx`, i.e. on a plant-wide view where only the
   * main running dimensions matter. `detail` (slope marks, skew aids, the
   * branch name) only appears on a close-up, once the source text height
   * projects at `theme.sourceTextHeightMaxPx` or above — the three tiers
   * are the far / mid / near levels of the reference drawing style.
   */
  tier?: 'primary' | 'secondary' | 'detail';
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

/**
 * A solver-authored running dimension presented as true 3D annotation
 * (reference drawing style, 2026-09-12; design target in
 * `docs/design/mbd-annotation-mockup-2026-09-12/README.md`). The kernel
 * rebuilds the dimension line, extension lines, arrowheads and value text in
 * Design Space, offset from the pipe along the solver's `dim_dir` in
 * multiples of the text height `h`, so the annotation clears the pipe body
 * and keeps drawing proportions at every camera distance. The solver's
 * value, segmentation, main/atta row and along-line text position are kept;
 * only the standoff from the pipe changes.
 */
export type ExplicitDimension3dInput = Readonly<{
  /** Pipe centre-line points the extension lines start from, start end first. */
  from: Vec3;
  to: Vec3;
  /** Unit direction from the pipe towards the dimension line (solver `dim_dir`). */
  direction: Vec3;
  /** Centre line → pipe surface along `direction` (Design metres). */
  surfaceM: number;
  /** Solver row, 0 = innermost. */
  row: number;
  /**
   * The solver already placed the text outside the extension lines (PML
   * `sepSmallDim`); which end it sits beyond. Omitted = the kernel decides
   * from the projected sizes.
   */
  outside?: 'start' | 'end';
}>;

/**
 * Body of a billboard tag: `card` = white rounded card with a grey border
 * (end-point coordinate blocks), `frame` = white box with a dark frame
 * (component name tags), `pill` = borderless white pill with muted text
 * (elbow elevations, branch name).
 */
export type ExplicitTagStyle = 'card' | 'frame' | 'pill';

export type ExplicitTagLine = Readonly<{
  text: string;
  /** Only shown on a close-up (source text height ≥ `theme.sourceTextHeightMaxPx`) when the input carries `lod`. */
  detail?: boolean;
}>;

/**
 * A solver-authored text tag presented as a screen-facing billboard with a
 * 3D anchor (reference drawing style, 2026-09-12; design target in
 * `docs/design/mbd-annotation-mockup-2026-09-12/README.md` rule 6). The
 * kernel sizes the body from its text lines, stands it off the anchor on
 * screen (away from the pipe, biased upwards) and draws a leader from the
 * anchor to the nearest body edge. The viewport's placement pass may move
 * the body to another candidate position to keep it clear of dimension
 * values and other tags; the anchor and the text never change.
 */
export type ExplicitTagInput = Readonly<{
  style: ExplicitTagStyle;
  /** Text lines, top to bottom, left-aligned. */
  lines: readonly ExplicitTagLine[];
  /**
   * Design-space point the leader points at (the pipe feature the tag
   * describes); omitted = the tag hangs off `labelAnchor` without a leader.
   */
  target?: Vec3;
  /**
   * Unit direction (Design Space) away from the pipe body at `target`, e.g.
   * along the pipe out of its open end. Omitted = the kernel uses the
   * direction from `target` to the solver's `labelAnchor`.
   */
  away?: Vec3;
  /** Mark `target` with a filled dot. */
  dot?: boolean;
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
  /**
   * Present the input as a 3D running dimension (see
   * `ExplicitDimension3dInput`); `lines` / `arrowLines` / `labelAnchor` are
   * then the solver's original geometry, kept for the legacy presentation.
   */
  dimension3d?: ExplicitDimension3dInput;
  /**
   * Present the input as a billboard tag (see `ExplicitTagInput`);
   * `formattedLabel` / `texts` / `lines` / `labelAnchor` are then the solver's
   * flat text and leader, kept for the legacy presentation.
   */
  tag?: ExplicitTagInput;
}>;
