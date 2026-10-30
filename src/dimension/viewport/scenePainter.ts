import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LessDepth,
  Matrix4,
  Mesh,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  type IUniform,
  type Object3D,
} from 'three';

import { traceFramedGlyphRun } from '../kernel/glyph/glyphTrace';
import {
  resolveDimensionLineDash,
  resolveTagToneColor,
  resolveTagToneStrokeWidth,
} from '../kernel/theme';

import type { GlyphSegment, LffFont } from '../kernel/glyph/lffParser';
import type { DimensionTheme } from '../kernel/theme';
import type {
  DimensionDisplayMode,
  DimensionLineStyle,
  LayoutResult,
  SceneGlyphRun,
  ScenePrimitive,
  SceneTextFrame,
  SceneTone,
  SceneVertex,
  Vec2,
} from '../kernel/types';

const MARKER_CIRCLE_SEGMENTS = 20;
const DEFAULT_RENDER_ORDER = 1000;

/**
 * Window-space depth every stroke fragment writes (`gl_FragDepth`): a hair
 * past the near plane, so a stroke always passes the depth test against the
 * model (the overlay stays depth-free towards the scene, ADR 0057) while
 * strokes of the same layer fail it against each other — with `LessDepth`
 * the first fragment at a pixel wins and overlapping quads (round joins of a
 * glyph, a dimension line under its own extension) paint a pixel exactly
 * once, so a faded record in inspection mode shows no darker beads where its
 * segments meet. The 3D-text halo lives one step farther so glyph strokes
 * pass over it. Written as literals from the fragment shader rather than
 * through `gl_Position.z`: 3D (framed) text has a different w at each end
 * of a segment and the interpolated z/w is off by a unit or two in a 24-bit
 * buffer, which is enough to break the equality the dedupe relies on. Both
 * values are far below any model fragment (≥ 2e-4 within 0.1 mm of the
 * near plane, ≥ 0.03 with the log depth buffer) and 160+ units apart.
 */
const STROKE_DEPTH = 0.00001;
const STROKE_HALO_DEPTH = 0.00002;

/** Coverage at or above this is a stroke's solid core; below it, its feathered edge. */
const STROKE_CORE_COVERAGE = 0.999;

/**
 * Screen-space (billboard) text is hinted to the device pixel grid: its
 * strokes are a whole number of device pixels wide, never fewer than this,
 * and each axis-aligned stem is centred so that its edges fall on pixel
 * boundaries (ADR 0064). Below two device pixels a feathered stroke has no
 * solid core at all (w/2 − f/2 ≤ 0) and reads grey on a 1× display.
 */
const MIN_TEXT_STROKE_DEVICE_PX = 2;

/**
 * Every other screen-space stroke — dimension, extension and leader lines
 * and the markers at `theme.dimensionStrokeWidthPx`, and the billboard
 * tags' card border (1 px), name frame (1.2 px) and leader (0.9 px) — is
 * hinted the same way, with the same floor: a stroke needs two device
 * pixels for a one-pixel solid core (w − feather ≥ 1). Measured on the
 * real pipeline (2026-09-14, BRAN 24383_67485): at 1× the 1.2 px dimension
 * line has a 0.2 px core — one cross-section in four owns a fully covered
 * pixel, peak coverage 0.85 — and rounding it down to one device pixel
 * loses even that (4 %, peak 0.76, visibly fainter); two device pixels
 * give every cross-section a solid pixel (peak 1.0). The tag strokes were
 * worse still (frame peak 0.83, card border 0.72, leader 0.70, no solid
 * pixel anywhere): an axis-aligned 1 px border at an arbitrary sub-pixel
 * phase is two grey rows. The price is that on a 1× display these strokes
 * are as heavy as the text stroke; from 1.5× up text stays heavier (2 vs 3
 * device px at 1.5×, 2 vs 4 at 2×, where 2.4 rounds down to 2 and keeps
 * its core).
 */
const MIN_LINE_STROKE_DEVICE_PX = 2;

/**
 * Two ends of a stroke closer than this (device px) along an axis count as
 * an axis-aligned stem. LFF stems are exactly axis-aligned, and so is a
 * dimension line in an axis-aligned (plan / elevation) view; the tolerance
 * only absorbs float error, so no slanted stroke is pulled straight.
 */
const STEM_AXIS_TOLERANCE_DEVICE_PX = 0.01;

const VERTEX_OFFSET_FUNCTION = `
vec4 projectSceneVertex(vec3 anchor, vec2 offsetPx) {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(anchor, 1.0);
  vec2 clipOffset = vec2(
    offsetPx.x * 2.0 / uViewportCssPx.x,
    -offsetPx.y * 2.0 / uViewportCssPx.y
  );
  clip.xy += clipOffset * clip.w;
  return clip;
}
`;

/**
 * Every stroke segment is a screen-space quad reaching half a width plus the
 * feather beyond the segment on all four sides; the fragment shader shades
 * it as a capsule (round caps, so consecutive glyph strokes join without
 * notches) with an analytic 1-device-pixel edge ramp, independent of MSAA.
 * The capsule coordinates travel pre-multiplied by clip.w so the
 * rasteriser's perspective-correct interpolation comes out linear in
 * screen space for 3D (framed) text whose two ends sit at different depths.
 *
 * Hinted strokes (\`pixelSnap\` = 1: screen-space glyph strokes and the
 * dimension strokes) have an axis-aligned stem's both ends moved to the
 * same device-pixel-aligned coordinate — whole pixel for an even stroke
 * width, half pixel for an odd one — so its edges land on pixel boundaries
 * and the feather ramp has nothing to blur (ADR 0064). Both ends of a
 * segment go through the same computation, so the four quad vertices
 * agree; slanted strokes are left alone and their round caps cover the
 * sub-pixel step at a joint with a snapped stem.
 */
const STROKE_VERTEX_SHADER = `
uniform vec2 uViewportCssPx;
uniform float uFeatherPx;
uniform float uPixelRatio;

attribute vec2 offsetPx;
attribute vec3 otherAnchor;
attribute vec2 otherOffsetPx;
attribute float segmentT;
attribute float side;
attribute float strokeWidthPx;
attribute float strokeLayer;
attribute float pixelSnap;
attribute vec3 batchColor;
attribute float batchAlpha;
attribute float dashCode;

varying vec3 vBatchColor;
varying float vBatchAlpha;
varying float vDashCode;
varying float vStrokeLayer;
varying vec3 vCapsuleW;
varying vec2 vCapsuleSizePx;

${VERTEX_OFFSET_FUNCTION}

vec2 clipToCss(vec4 clip) {
  vec2 ndc = clip.xy / clip.w;
  return vec2(
    (ndc.x + 1.0) * 0.5 * uViewportCssPx.x,
    (1.0 - ndc.y) * 0.5 * uViewportCssPx.y
  );
}

// Inverse of clipToCss on x / y; depth and w stay the vertex's own, so the
// GPU still clips a run whose anchor is behind the camera.
vec4 cssToClip(vec2 css, vec4 clip) {
  return vec4(
    (css.x / uViewportCssPx.x * 2.0 - 1.0) * clip.w,
    (1.0 - css.y / uViewportCssPx.y * 2.0) * clip.w,
    clip.z,
    clip.w
  );
}

// Snaps one device-pixel coordinate so a stem of the given whole-pixel
// width has its edges on pixel boundaries.
float snapStem(float devicePx, float widthDevicePx) {
  float phase = mod(floor(widthDevicePx + 0.5), 2.0) < 0.5 ? 0.0 : 0.5;
  return floor(devicePx - phase + 0.5) + phase;
}

void main() {
  vec4 ownClip = projectSceneVertex(position, offsetPx);
  vec4 otherClip = projectSceneVertex(otherAnchor, otherOffsetPx);
  if (pixelSnap > 0.5) {
    vec2 ownDevice = clipToCss(ownClip) * uPixelRatio;
    vec2 otherDevice = clipToCss(otherClip) * uPixelRatio;
    vec2 stem = abs(otherDevice - ownDevice);
    float widthDevicePx = strokeWidthPx * uPixelRatio;
    if (stem.x < ${STEM_AXIS_TOLERANCE_DEVICE_PX}) {
      float x = snapStem(ownDevice.x, widthDevicePx);
      ownDevice.x = x;
      otherDevice.x = x;
    }
    if (stem.y < ${STEM_AXIS_TOLERANCE_DEVICE_PX}) {
      float y = snapStem(ownDevice.y, widthDevicePx);
      ownDevice.y = y;
      otherDevice.y = y;
    }
    ownClip = cssToClip(ownDevice / uPixelRatio, ownClip);
    otherClip = cssToClip(otherDevice / uPixelRatio, otherClip);
  }
  vec2 deltaCss = clipToCss(otherClip) - clipToCss(ownClip);
  float segmentLengthPx = length(deltaCss);
  vec2 dir = segmentLengthPx > 0.0001
    ? deltaCss / segmentLengthPx
    : vec2(1.0, 0.0);
  vec2 normalCss = vec2(-dir.y, dir.x);
  float halfWidthPx = strokeWidthPx * 0.5;
  float reachPx = halfWidthPx + uFeatherPx;
  // Across by the reach on this vertex's side; along by the reach away from
  // the other end (dir always points own -> other), for the cap.
  vec2 expandPx = normalCss * reachPx * side - dir * reachPx;
  vec2 expandClip = vec2(
    expandPx.x * 2.0 / uViewportCssPx.x,
    -expandPx.y * 2.0 / uViewportCssPx.y
  );
  vec4 clip = ownClip;
  clip.xy += expandClip * clip.w;

  // Capsule frame of the segment: along from its first end, across from its
  // axis. The far end's vertices carry a negated side (see the painter), so
  // the across sign is flipped back there to stay constant along each edge.
  float alongPx = segmentT < 0.5 ? -reachPx : segmentLengthPx + reachPx;
  float acrossPx = reachPx * side * (segmentT < 0.5 ? 1.0 : -1.0);
  vCapsuleW = vec3(alongPx, acrossPx, 1.0) * clip.w;
  vCapsuleSizePx = vec2(segmentLengthPx, halfWidthPx);

  vBatchColor = batchColor;
  vBatchAlpha = batchAlpha;
  vDashCode = dashCode;
  vStrokeLayer = strokeLayer;
  gl_Position = clip;
}
`;

/**
 * \`uPass\` 0 keeps the solid core (coverage 1), 1 keeps the feathered edge
 * (blended). Both write the layer's overlay depth (\`gl_FragDepthEXT\`, a
 * WebGL2 built-in three.js aliases), so overlapping quads paint a pixel once
 * and an edge never darkens a neighbouring core.
 */
const STROKE_FRAGMENT_SHADER = `
uniform float uFeatherPx;
uniform float uPass;

varying vec3 vBatchColor;
varying float vBatchAlpha;
varying float vDashCode;
varying float vStrokeLayer;
varying vec3 vCapsuleW;
varying vec2 vCapsuleSizePx;

bool dashVisible(float code, float distancePx) {
  if (code < 0.5) return true;
  if (code < 1.5) return mod(distancePx, 10.0) < 6.0;
  if (code < 2.5) {
    float phase = mod(distancePx, 16.0);
    return phase < 8.0 || (phase >= 11.0 && phase < 13.0);
  }
  if (code < 3.5) return mod(distancePx, 10.0) < 7.0;
  return mod(distancePx, 4.0) < 2.0;
}

void main() {
  vec2 capsule = vCapsuleW.xy / vCapsuleW.z;
  float segmentLengthPx = vCapsuleSizePx.x;
  float halfWidthPx = vCapsuleSizePx.y;
  float overshootPx = max(max(-capsule.x, capsule.x - segmentLengthPx), 0.0);
  float distancePx = length(vec2(overshootPx, capsule.y));
  float coverage = clamp(
    (halfWidthPx + 0.5 * uFeatherPx - distancePx) / uFeatherPx,
    0.0,
    1.0
  );
  if (coverage <= 0.0) discard;
  if (!dashVisible(vDashCode, clamp(capsule.x, 0.0, segmentLengthPx))) discard;
  bool core = coverage >= ${STROKE_CORE_COVERAGE};
  if (uPass < 0.5 ? !core : core) discard;
  gl_FragDepthEXT = vStrokeLayer > 0.5 ? ${STROKE_HALO_DEPTH.toFixed(5)} : ${STROKE_DEPTH.toFixed(5)};
  gl_FragColor = vec4(vBatchColor, vBatchAlpha * coverage);
}
`;

const TRIANGLE_VERTEX_SHADER = `
uniform vec2 uViewportCssPx;

attribute vec2 offsetPx;
attribute vec3 batchColor;
attribute float batchAlpha;

varying vec3 vBatchColor;
varying float vBatchAlpha;

${VERTEX_OFFSET_FUNCTION}

void main() {
  vBatchColor = batchColor;
  vBatchAlpha = batchAlpha;
  gl_Position = projectSceneVertex(position, offsetPx);
}
`;

const TRIANGLE_FRAGMENT_SHADER = `
varying vec3 vBatchColor;
varying float vBatchAlpha;

void main() {
  gl_FragColor = vec4(vBatchColor, vBatchAlpha);
}
`;

type AttributeSpec = Readonly<{
  name: string;
  itemSize: number;
}>;

const STROKE_ATTRIBUTES: readonly AttributeSpec[] = [
  { name: 'position', itemSize: 3 },
  { name: 'offsetPx', itemSize: 2 },
  { name: 'otherAnchor', itemSize: 3 },
  { name: 'otherOffsetPx', itemSize: 2 },
  { name: 'segmentT', itemSize: 1 },
  { name: 'side', itemSize: 1 },
  { name: 'strokeWidthPx', itemSize: 1 },
  { name: 'strokeLayer', itemSize: 1 },
  { name: 'pixelSnap', itemSize: 1 },
  { name: 'batchColor', itemSize: 3 },
  { name: 'batchAlpha', itemSize: 1 },
  { name: 'dashCode', itemSize: 1 },
];

const TRIANGLE_ATTRIBUTES: readonly AttributeSpec[] = [
  { name: 'position', itemSize: 3 },
  { name: 'offsetPx', itemSize: 2 },
  { name: 'batchColor', itemSize: 3 },
  { name: 'batchAlpha', itemSize: 1 },
];

function nextCapacity(required: number): number {
  let capacity = 16;
  while (capacity < required) capacity *= 2;
  return capacity;
}

class ReusableGeometry {
  geometry = new BufferGeometry();
  private capacity = 0;

  constructor(
    private readonly specs: readonly AttributeSpec[],
    private readonly quadIndexed = false,
  ) {
    this.ensureCapacity(1);
    this.clear();
  }

  ensureCapacity(required: number): boolean {
    if (required <= this.capacity) return false;
    const previous = this.geometry;
    const geometry = new BufferGeometry();
    this.capacity = nextCapacity(required);
    for (const spec of this.specs) {
      geometry.setAttribute(
        spec.name,
        new BufferAttribute(
          new Float32Array(this.capacity * spec.itemSize),
          spec.itemSize,
        ).setUsage(DynamicDrawUsage),
      );
    }
    if (this.quadIndexed) {
      // Two triangles per 4-vertex quad: (left0, right0, right1, left1).
      const quadCount = Math.ceil(this.capacity / 4);
      const indices = new Uint32Array(quadCount * 6);
      for (let quad = 0; quad < quadCount; quad += 1) {
        const vertex = quad * 4;
        const offset = quad * 6;
        indices[offset] = vertex;
        indices[offset + 1] = vertex + 1;
        indices[offset + 2] = vertex + 3;
        indices[offset + 3] = vertex;
        indices[offset + 4] = vertex + 3;
        indices[offset + 5] = vertex + 2;
      }
      geometry.setIndex(new BufferAttribute(indices, 1));
    }
    geometry.setDrawRange(0, 0);
    this.geometry = geometry;
    previous.dispose();
    return true;
  }

  array(name: string): Float32Array {
    return (
      this.geometry.getAttribute(name) as BufferAttribute
    ).array as Float32Array;
  }

  /**
   * Vertices the current buffers can hold. `ensureCapacity` sizes ahead of
   * the actual write, so an index at or past this is out of bounds — and
   * typed arrays drop out-of-range stores silently rather than throwing.
   */
  get vertexCapacity(): number {
    return this.capacity;
  }

  finish(vertexCount: number): void {
    this.geometry.setDrawRange(
      0,
      this.quadIndexed ? (vertexCount / 4) * 6 : vertexCount,
    );
    this.markUpdated(this.specs.map(spec => spec.name));
  }

  markUpdated(names: readonly string[]): void {
    for (const name of names) {
      const attribute = this.geometry.getAttribute(name) as BufferAttribute;
      if (!attribute) continue;
      attribute.needsUpdate = true;
    }
  }

  clear(): void {
    this.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

type LocalGlyphSegment = Readonly<{
  from: Vec2;
  to: Vec2;
}>;

function rotate(point: Vec2, angle: number): Vec2 {
  if (angle === 0) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    point[0] * cos - point[1] * sin,
    point[0] * sin + point[1] * cos,
  ];
}

function glyphSegments(
  font: LffFont,
  primitive: SceneGlyphRun,
): readonly LocalGlyphSegment[] {
  const scale = primitive.capHeightPx / font.capHeight;
  const origin: Vec2 = [
    -font.getWidth(primitive.capHeightPx, primitive.text) / 2,
    ((font.ascender + font.descender) * scale) / 2,
  ];
  return font.trace(primitive.capHeightPx, primitive.text, origin)
    .map((segment: GlyphSegment) => ({
      from: rotate(segment.from, primitive.rotationRad),
      to: rotate(segment.to, primitive.rotationRad),
    }));
}

/**
 * Cache key for a screen-space glyph run. `capHeightPx` is quantized to
 * 0.01 px and `rotationRad` to 1e-4 rad (~0.006°): screen-space text is
 * hinted to whole device pixels (`hintedTextStrokeWidthPx`, stem snapping
 * in the vertex shader), so differences below these steps cannot draw
 * differently on any display — while unquantized `atan2`/projection
 * outputs jitter in their last digits every frame, which used to make
 * every key unique and the map grow without ever hitting.
 */
function screenGlyphCacheKey(primitive: SceneGlyphRun): string {
  return [
    Math.round(primitive.capHeightPx * 100) / 100,
    Math.round(primitive.rotationRad * 1e4) / 1e4,
    primitive.text,
  ].join(':');
}

/**
 * `caches.screen` lookup for `primitive`, tracing on a miss. Once the
 * cache holds `screenMaxEntries` entries an insert first drops the oldest
 * one — `Map` iterates keys in insertion order, so the first key is it.
 */
function cachedScreenGlyphSegments(
  font: LffFont,
  primitive: SceneGlyphRun,
  caches: GlyphCaches,
): readonly LocalGlyphSegment[] {
  const cacheKey = screenGlyphCacheKey(primitive);
  let segments = caches.screen.get(cacheKey);
  if (!segments) {
    segments = glyphSegments(font, primitive);
    if (caches.screen.size >= caches.screenMaxEntries) {
      const oldestKey = caches.screen.keys().next().value;
      if (oldestKey !== undefined) caches.screen.delete(oldestKey);
    }
    caches.screen.set(cacheKey, segments);
  }
  return segments;
}

function frameVertex(frame: SceneTextFrame, local: Vec2): SceneVertex {
  const { origin, xAxis, yAxis } = frame;
  // Trace y points down the glyph; the frame's yAxis points up.
  return {
    anchor: [
      origin[0] + local[0] * xAxis[0] - local[1] * yAxis[0],
      origin[1] + local[0] * xAxis[1] - local[1] * yAxis[1],
      origin[2] + local[0] * xAxis[2] - local[1] * yAxis[2],
    ],
    offsetPx: [0, 0],
  };
}

/**
 * Upper bound for `GlyphCaches.screen`. A full layout yields at most ~3
 * distinct glyph runs per record (label, value, unit), so ~2 000 visible
 * records keep ~6 000 keys live; 8 192 is the next power of two with
 * headroom. The cache used to be unbounded while its key embedded raw
 * floats — a dragging camera appended thousands of never-reused keys a
 * second, growing the map by hundreds of MB within seconds.
 */
const SCREEN_GLYPH_CACHE_MAX_ENTRIES = 8_192;

type GlyphCaches = {
  /**
   * Screen-space runs keyed by quantized cap height, rotation and text —
   * see `screenGlyphCacheKey`. Evicts oldest-first at `screenMaxEntries`.
   */
  readonly screen: Map<string, readonly LocalGlyphSegment[]>;
  /** Framed runs keyed by text only (the frame changes with the camera). */
  readonly unit: Map<string, readonly LocalGlyphSegment[]>;
  /**
   * Bound for `screen`, consulted at every insert. A field of the record
   * so both lookup sites share it; the painter exposes it as
   * `screenGlyphCacheMaxEntries` for tests.
   */
  screenMaxEntries: number;
};

/**
 * How a stroke quad is styled: dimension lines by default, view-plane text,
 * the two passes of framed (3D) text — a contrasting halo underneath and
 * the heavier glyph strokes on top (`theme.dimension3d`) — or one of the
 * billboard tag tones (`theme.tag`).
 */
type SegmentStroke = 'text' | 'text-3d' | 'halo-3d' | SceneTone;

function isTagTone(stroke: SegmentStroke | undefined): stroke is SceneTone {
  return stroke !== undefined && stroke.startsWith('tag-');
}

function strokeWidthPx(theme: DimensionTheme, stroke: SegmentStroke | undefined): number {
  if (isTagTone(stroke)) return resolveTagToneStrokeWidth(theme, stroke);
  switch (stroke) {
    case 'text':
      return theme.textStrokeWidthPx;
    case 'text-3d':
      return theme.dimension3d.textStrokeWidthPx;
    case 'halo-3d':
      return theme.dimension3d.textStrokeWidthPx + 2 * theme.dimension3d.textHaloWidthPx;
    default:
      return theme.dimensionStrokeWidthPx;
  }
}

/**
 * A hinted stroke width: the theme's CSS width taken to the nearest whole
 * number of device pixels, at least `minDevicePx`, expressed back in CSS
 * px — so a snapped stem covers whole pixels and its feathered edge never
 * straddles two.
 */
function hintedStrokeWidthPx(
  widthCssPx: number,
  pixelRatio: number,
  minDevicePx: number,
): number {
  const devicePx = Math.max(minDevicePx, Math.round(widthCssPx * pixelRatio));
  return devicePx / pixelRatio;
}

/**
 * Stroke width of hinted (screen-space) text, never below
 * `MIN_TEXT_STROKE_DEVICE_PX`: 1.8 px is 2 device px on a 1× display and 4
 * on a 2× one (ADR 0064).
 */
export function hintedTextStrokeWidthPx(widthCssPx: number, pixelRatio: number): number {
  return hintedStrokeWidthPx(widthCssPx, pixelRatio, MIN_TEXT_STROKE_DEVICE_PX);
}

/**
 * Stroke width of a hinted line stroke (dimension strokes, tag borders /
 * frames / leaders), never below `MIN_LINE_STROKE_DEVICE_PX`: 1.2 px is 2
 * device px on a 1× display (the floor), 2 on a 2× one (1 CSS px) and 2
 * (1.6 CSS px) at 1.25×; a 1 px card border is 2 device px at 1× and 2×
 * alike (2026-09-14).
 */
export function hintedLineStrokeWidthPx(widthCssPx: number, pixelRatio: number): number {
  return hintedStrokeWidthPx(widthCssPx, pixelRatio, MIN_LINE_STROKE_DEVICE_PX);
}

function offsetVertex(vertex: SceneVertex, offset: Vec2): SceneVertex {
  return {
    anchor: vertex.anchor,
    offsetPx: [
      vertex.offsetPx[0] + offset[0],
      vertex.offsetPx[1] + offset[1],
    ],
  };
}

function dashCode(
  styleRole: string,
  lineStyle?: DimensionLineStyle,
): number {
  const dash = resolveDimensionLineDash(styleRole, lineStyle);
  if (dash.length === 0) return 0;
  if (dash.length === 4) return 2;
  if (dash[0] === 7) return 3;
  if (dash[0] === 2) return 4;
  return 1;
}

/**
 * Which device-pixel hinting a stroke gets (ADR 0064): screen-space glyph
 * strokes as `text`, every other screen-space stroke — dimension strokes and
 * the tag borders, frames and leaders — as `line` (both whole device pixels,
 * at least two, from their own theme widths); undefined strokes — framed 3D
 * text and its halo — keep the theme width and are not snapped.
 */
type StrokeHint = 'text' | 'line';

type SegmentVisitor = (
  from: SceneVertex,
  to: SceneVertex,
  styleRole: string,
  lineStyle?: DimensionLineStyle,
  stroke?: SegmentStroke,
  hint?: StrokeHint,
) => void;

function visitPrimitiveSegments(
  primitive: ScenePrimitive,
  font: LffFont,
  caches: GlyphCaches,
  visit: SegmentVisitor,
): void {
  switch (primitive.kind) {
    case 'scene-line':
      visit(
        primitive.from,
        primitive.to,
        primitive.styleRole,
        primitive.lineStyle,
        primitive.tone,
        'line',
      );
      return;
    case 'scene-path':
      for (let index = 1; index < primitive.points.length; index += 1) {
        visit(
          primitive.points[index - 1]!,
          primitive.points[index]!,
          primitive.styleRole,
          primitive.lineStyle,
          primitive.tone,
          'line',
        );
      }
      if (primitive.closed && primitive.points.length > 2) {
        visit(
          primitive.points.at(-1)!,
          primitive.points[0]!,
          primitive.styleRole,
          primitive.lineStyle,
          primitive.tone,
          'line',
        );
      }
      return;
    case 'scene-marker':
      if (primitive.shape === 'cross') {
        visit(
          offsetVertex(primitive.at, [-primitive.radiusPx, -primitive.radiusPx]),
          offsetVertex(primitive.at, [primitive.radiusPx, primitive.radiusPx]),
          primitive.styleRole,
          primitive.lineStyle,
          undefined,
          'line',
        );
        visit(
          offsetVertex(primitive.at, [-primitive.radiusPx, primitive.radiusPx]),
          offsetVertex(primitive.at, [primitive.radiusPx, -primitive.radiusPx]),
          primitive.styleRole,
          primitive.lineStyle,
          undefined,
          'line',
        );
        return;
      }
      for (let index = 0; index < MARKER_CIRCLE_SEGMENTS; index += 1) {
        const fromAngle = (index / MARKER_CIRCLE_SEGMENTS) * Math.PI * 2;
        const toAngle = ((index + 1) / MARKER_CIRCLE_SEGMENTS) * Math.PI * 2;
        visit(
          offsetVertex(primitive.at, [
            Math.cos(fromAngle) * primitive.radiusPx,
            Math.sin(fromAngle) * primitive.radiusPx,
          ]),
          offsetVertex(primitive.at, [
            Math.cos(toAngle) * primitive.radiusPx,
            Math.sin(toAngle) * primitive.radiusPx,
          ]),
          primitive.styleRole,
          primitive.lineStyle,
          undefined,
          'line',
        );
      }
      return;
    case 'scene-glyph-run': {
      if (primitive.frame) {
        const frame = primitive.frame;
        let unit = caches.unit.get(primitive.text);
        if (!unit) {
          // Shared with the SVG export, so both draw the same strokes.
          unit = traceFramedGlyphRun(font, primitive.text);
          caches.unit.set(primitive.text, unit);
        }
        // Halo first, glyphs on top, per run — so a stroke's halo never
        // notches a neighbouring stroke of the same glyph.
        for (const stroke of ['halo-3d', 'text-3d'] as const) {
          for (const segment of unit) {
            visit(
              frameVertex(frame, segment.from),
              frameVertex(frame, segment.to),
              primitive.styleRole,
              'solid',
              stroke,
            );
          }
        }
        return;
      }
      const segments = cachedScreenGlyphSegments(font, primitive, caches);
      for (const segment of segments) {
        // Glyph strokes stay solid: role dash patterns (external-reference,
        // invalid, approximate) must never break up label text. Screen-space
        // text is hinted to the device pixel grid; framed (3D) text above
        // is not — its stems are not axis-aligned on screen.
        visit(
          offsetVertex(primitive.at, segment.from),
          offsetVertex(primitive.at, segment.to),
          primitive.styleRole,
          'solid',
          primitive.tone ?? 'text',
          'text',
        );
      }
      return;
    }
    case 'scene-triangle':
    case 'scene-fill':
      // Filled primitives go through the triangle / fill buffers.
      return;
  }
}

/** Triangle-fan vertex count of a fill (n − 2 triangles). */
function fillVertexCount(pointCount: number): number {
  return pointCount >= 3 ? (pointCount - 2) * 3 : 0;
}

/**
 * How many line segments a primitive expands to, without building any of the
 * vertices (W5-5). The first `paint()` pass only needs this number to size the
 * line buffer; walking the real `visitPrimitiveSegments` for it also allocated
 * two `SceneVertex` objects per glyph segment — 400k of them at 2k visible
 * dimensions — for a count nobody kept.
 *
 * The glyph cases read the same caches `visitPrimitiveSegments` fills, so
 * calling this first also warms them for the write pass.
 */
function countPrimitiveSegments(
  primitive: ScenePrimitive,
  font: LffFont,
  caches: GlyphCaches,
): number {
  switch (primitive.kind) {
    case 'scene-line':
      return 1;
    case 'scene-path':
      // `Math.max(0, …)`: an empty path visits no segments, so the count
      // must be 0, not −1. A negative count under-sizes the buffer by four
      // vertices and shifts every later layout's range — the tail stroke
      // then drops silently (typed arrays ignore out-of-range stores).
      return Math.max(0, primitive.points.length - 1)
        + (primitive.closed && primitive.points.length > 2 ? 1 : 0);
    case 'scene-marker':
      return primitive.shape === 'cross' ? 2 : MARKER_CIRCLE_SEGMENTS;
    case 'scene-glyph-run': {
      if (primitive.frame) {
        let unit = caches.unit.get(primitive.text);
        if (!unit) {
          unit = traceFramedGlyphRun(font, primitive.text);
          caches.unit.set(primitive.text, unit);
        }
        // Halo and glyph pass, per run.
        return unit.length * 2;
      }
      return cachedScreenGlyphSegments(font, primitive, caches).length;
    }
    case 'scene-triangle':
    case 'scene-fill':
      // Filled primitives go through the triangle / fill buffers.
      return 0;
  }
}

/**
 * Whether one segment's four-vertex quad still fits at `vertexIndex` in a
 * buffer of `capacity` vertices. Checked once per segment — its vertices
 * are written consecutively, so a single comparison covers all four —
 * because typed arrays drop out-of-range stores silently: an under-sized
 * buffer would lose tail strokes with no error raised anywhere.
 */
export function fitsWithin(
  vertexIndex: number,
  needed: number,
  capacity: number,
): boolean {
  return vertexIndex + needed <= capacity;
}

/**
 * The one observable record of a truncated line write: the count pass
 * under-budgeted, so the write stopped at capacity and the published
 * `drawRange` covers only what landed. Warn rather than throw — a missing
 * tail of strokes beats an unpainted frame.
 */
function warnLineTruncation(
  expected: number,
  written: number,
  layouts: number,
): void {
  console.warn(
    '[SceneDimensionPainter] segment count under-budgeted the line buffer;'
      + ' write truncated at capacity',
    { expected, written, layouts },
  );
}

function visitSegments(
  layouts: readonly LayoutResult[],
  font: LffFont,
  caches: GlyphCaches,
  visit: SegmentVisitor,
): void {
  for (const layout of layouts) {
    for (const primitive of layout.scenePrimitives) {
      visitPrimitiveSegments(primitive, font, caches, visit);
    }
  }
}

/**
 * A theme colour as the shader writes it: sRGB-encoded components. The
 * overlay is drawn straight into the sRGB canvas after the frame's tone
 * mapping and colour-space conversion (ADR 0064), so the fragment shader's
 * output is the on-screen value — a flat drawing colour that must not go
 * through ACES — and its alpha blending happens in sRGB, where a
 * half-covered edge pixel of dark text lands halfway in perceived
 * brightness instead of a light grey. (`new Color(hex)` holds linear
 * working-space components under three's colour management.)
 */
export function srgbComponents(hex: string): readonly [number, number, number] {
  const rgb = new Color(hex).getRGB(new Color(), SRGBColorSpace);
  return [rgb.r, rgb.g, rgb.b];
}

function colorComponents(
  theme: DimensionTheme,
  styleRole: string,
  stroke: SegmentStroke | undefined,
): readonly [number, number, number] {
  if (stroke === 'halo-3d') return srgbComponents(theme.dimension3d.textHaloColor);
  if (isTagTone(stroke)) return srgbComponents(resolveTagToneColor(theme, styleRole, stroke));
  const roleKey = styleRole as keyof typeof theme.colors;
  const textColor = stroke !== undefined ? theme.textColors[roleKey] : undefined;
  return srgbComponents(textColor ?? theme.colors[roleKey] ?? theme.colors.normal);
}

function createColorResolver(theme: DimensionTheme) {
  const cache = new Map<string, readonly [number, number, number]>();
  return (
    styleRole: string,
    stroke: SegmentStroke | undefined,
  ): readonly [number, number, number] => {
    const key = stroke ? `${styleRole}:${stroke}` : styleRole;
    const cached = cache.get(key);
    if (cached) return cached;
    const color = colorComponents(theme, styleRole, stroke);
    cache.set(key, color);
    return color;
  };
}

function writeVec2(
  array: Float32Array,
  vertexIndex: number,
  value: readonly number[],
): void {
  const offset = vertexIndex * 2;
  array[offset] = value[0]!;
  array[offset + 1] = value[1]!;
}

function writeVec3(
  array: Float32Array,
  vertexIndex: number,
  value: readonly number[],
): void {
  const offset = vertexIndex * 3;
  array[offset] = value[0]!;
  array[offset + 1] = value[1]!;
  array[offset + 2] = value[2]!;
}

/**
 * Alpha a whole record paints at: 1 in engineering mode; in inspection mode
 * the theme's occluded alpha for records the layout pass flagged as sitting
 * behind model geometry, its visible alpha for the rest (S4, 2026-09-13).
 */
export function layoutAlpha(
  layout: LayoutResult,
  theme: DimensionTheme,
  displayMode: DimensionDisplayMode,
): number {
  if (displayMode !== 'inspection') return 1;
  return layout.derived.occluded
    ? theme.inspection.occludedAlpha
    : theme.inspection.visibleAlpha;
}

function createMaterial(
  vertexShader: string,
  fragmentShader: string,
  uniforms: Record<string, IUniform>,
): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false,
  });
  material.side = DoubleSide;
  return material;
}

/**
 * The two stroke materials share one geometry and the constant overlay
 * depth (`STROKE_DEPTH_NDC`), both writing it and testing with `LessDepth`:
 * cores dedupe against cores; edges, drawn after every core, are rejected
 * where a core already painted the pixel and dedupe against each other, so
 * the feathered rims of two segments meeting at a joint never blend twice
 * (first one wins — the same rule as the cores, not max coverage).
 */
function createStrokeMaterial(
  uniforms: Record<string, IUniform>,
  pass: 'core' | 'edge',
): ShaderMaterial {
  const material = createMaterial(STROKE_VERTEX_SHADER, STROKE_FRAGMENT_SHADER, {
    ...uniforms,
    uPass: { value: pass === 'core' ? 0 : 1 },
  });
  material.depthTest = true;
  material.depthFunc = LessDepth;
  material.depthWrite = true;
  material.transparent = pass === 'edge';
  return material;
}

export type SceneDimensionPainterStats = Readonly<{
  sceneObjectCount: number;
  lineVertexCount: number;
  triangleVertexCount: number;
  fillVertexCount: number;
}>;

/**
 * Where one `paint()` spends its time, in milliseconds (W5-5 诊断). The four
 * phases are the ones a framing strategy could split; see
 * `docs/plans/2026-10-29-mbd-dimension-remaining-work-dev-plan.md` §11.3.1.
 *
 * - `countMs`: the first `visitSegments` pass, which only counts segments to
 *   size the line buffer.
 * - `writeMs`: the second `visitSegments` pass that writes four vertices per
 *   segment, including any glyph-cache misses it triggers.
 * - `trianglesMs` / `fillsMs`: the arrowhead and tag-body passes.
 *
 * Only recorded when a host asks for it (`SceneDimensionPainter.onPaintProfile`),
 * so nothing in production pays for the timestamps.
 */
export type SceneDimensionPaintProfile = Readonly<{
  countMs: number;
  writeMs: number;
  trianglesMs: number;
  fillsMs: number;
  segmentCount: number;
  /** 段数按来源图元类型的分布（W5-5 诊断：定 writeMs 里字形与线框各占多少）。 */
  segmentsByKind: Readonly<Record<string, number>>;
}>;

/**
 * A `paint()` split across animation frames (W5-5). `advance()` writes one
 * batch of layouts per call; `finish()` publishes the geometry once every
 * batch is in. Nothing becomes visible before `finish()`, so a partially
 * written buffer is never drawn.
 */
export type SceneDimensionPaintJob = Readonly<{
  /** Layouts still waiting to be written. */
  remaining(): number;
  /** Writes up to `batchLayouts` layouts; true once all are written. */
  advance(batchLayouts?: number): boolean;
  /** Publishes the buffers. Only valid after `advance()` returned true. */
  finish(): void;
  /**
   * Abandons the job: `finish()` becomes a no-op and nothing the job
   * managed to write is published. The line `drawRange` was already
   * cleared at job start, so the layer stays blank instead of reverting
   * to — or mixing with — the previous frame.
   */
  cancel(): void;
}>;

type DimensionVertexRange = Readonly<{
  lineStart: number;
  lineEnd: number;
  triangleStart: number;
  triangleEnd: number;
  fillStart: number;
  fillEnd: number;
}>;

/**
 * One scene group and four draw objects for every dimension in the
 * viewport: filled tag bodies underneath, stroke cores, stroke edges, then
 * filled arrowheads on top. Design-space anchors remain in the vertex
 * buffers; CSS-pixel offsets are applied after projection in the shader.
 * Each stroke segment expands to a 4-vertex screen-space quad so text and
 * dimension lines get real, DPR-independent stroke widths (GL_LINES
 * rasterizes at a fixed 1 device pixel and cannot); the quad is shaded as a
 * capsule with a one-device-pixel analytic edge (round joins, smooth at any
 * angle and without MSAA), drawn in two passes over the same geometry:
 * opaque cores that dedupe through the depth buffer, then blended edges
 * tested against those cores.
 *
 * The group is meant to be drawn as its own pass after the host's frame —
 * post-processing included — straight into the sRGB canvas
 * (`DimensionViewport.renderOverlay`, ADR 0064): colours are written
 * sRGB-encoded and never tone-mapped, edges blend in sRGB, no FXAA touches
 * the strokes, and every screen-space stroke — text, dimension strokes, tag
 * borders and leaders — is hinted to the device pixel grid.
 */
export class ThreeSceneDimensionPainter {
  readonly group = new Group();

  private readonly viewportCssPx = new Vector2(1, 1);
  private readonly featherPx: IUniform<number> = { value: 1 };
  private readonly pixelRatio: IUniform<number> = { value: 1 };
  private readonly lineBuffers = new ReusableGeometry(STROKE_ATTRIBUTES, true);
  private readonly triangleBuffers = new ReusableGeometry(TRIANGLE_ATTRIBUTES);
  private readonly fillBuffers = new ReusableGeometry(TRIANGLE_ATTRIBUTES);
  private readonly lineMaterial = createStrokeMaterial(
    {
      uViewportCssPx: { value: this.viewportCssPx },
      uFeatherPx: this.featherPx,
      uPixelRatio: this.pixelRatio,
    },
    'core',
  );
  private readonly lineEdgeMaterial = createStrokeMaterial(
    {
      uViewportCssPx: { value: this.viewportCssPx },
      uFeatherPx: this.featherPx,
      uPixelRatio: this.pixelRatio,
    },
    'edge',
  );
  private readonly triangleMaterial = createMaterial(
    TRIANGLE_VERTEX_SHADER,
    TRIANGLE_FRAGMENT_SHADER,
    { uViewportCssPx: { value: this.viewportCssPx } },
  );
  private readonly fillMaterial = createMaterial(
    TRIANGLE_VERTEX_SHADER,
    TRIANGLE_FRAGMENT_SHADER,
    { uViewportCssPx: { value: this.viewportCssPx } },
  );
  private readonly lines = new Mesh(
    this.lineBuffers.geometry,
    this.lineMaterial,
  );
  private readonly lineEdges = new Mesh(
    this.lineBuffers.geometry,
    this.lineEdgeMaterial,
  );
  private readonly triangles = new Mesh(
    this.triangleBuffers.geometry,
    this.triangleMaterial,
  );
  private readonly fills = new Mesh(
    this.fillBuffers.geometry,
    this.fillMaterial,
  );
  private readonly glyphCaches: GlyphCaches = {
    screen: new Map<string, readonly LocalGlyphSegment[]>(),
    unit: new Map<string, readonly LocalGlyphSegment[]>(),
    screenMaxEntries: SCREEN_GLYPH_CACHE_MAX_ENTRIES,
  };
  private dimensionRanges = new Map<string, DimensionVertexRange>();
  private lineVertexCount = 0;
  private triangleVertexCount = 0;
  private fillVertexCount = 0;
  private disposed = false;
  /**
   * Optional per-`paint()` phase breakdown (W5-5 diagnosis). Assigning one
   * turns on the timestamps inside `paint()`; leaving it undefined — the
   * production path — costs nothing. Read-only observation: it never changes
   * what is drawn.
   */
  onPaintProfile: ((profile: SceneDimensionPaintProfile) => void) | undefined = undefined;

  constructor(
    private readonly parent: Object3D,
    private readonly font: LffFont,
    renderOrder = DEFAULT_RENDER_ORDER,
  ) {
    this.group.name = 'dimension-scene-overlay';
    this.group.matrixAutoUpdate = false;
    this.group.matrix.identity();
    this.lines.name = 'dimension-scene-lines';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = renderOrder;
    // Edges after every core, so they are tested against all of them.
    this.lineEdges.name = 'dimension-scene-line-edges';
    this.lineEdges.frustumCulled = false;
    this.lineEdges.renderOrder = renderOrder + 1;
    this.triangles.name = 'dimension-scene-arrows';
    this.triangles.frustumCulled = false;
    this.triangles.renderOrder = renderOrder + 2;
    // Tag bodies draw before every stroke so text and borders stay on top.
    this.fills.name = 'dimension-scene-fills';
    this.fills.frustumCulled = false;
    this.fills.renderOrder = renderOrder - 1;
    this.group.add(this.lines, this.lineEdges, this.triangles, this.fills);
    this.parent.add(this.group);
  }

  /**
   * Viewport size in CSS px and the device pixel ratio: the stroke edge
   * ramp is one device pixel wide, so it stays crisp on a 2× display
   * instead of softening to two device pixels, and the screen-space strokes
   * are hinted to that display's pixel grid (the caller repaints on a DPR
   * change — `DimensionViewport` invalidates `dpr`).
   */
  resize(widthCssPx: number, heightCssPx: number, pixelRatio = 1): void {
    if (
      !Number.isFinite(widthCssPx)
      || !Number.isFinite(heightCssPx)
      || widthCssPx <= 0
      || heightCssPx <= 0
    ) {
      throw new RangeError('Scene dimension viewport size must be positive');
    }
    this.viewportCssPx.set(widthCssPx, heightCssPx);
    const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
    const clamped = Math.min(Math.max(ratio, 0.5), 8);
    this.featherPx.value = 1 / clamped;
    this.pixelRatio.value = clamped;
  }

  setDesignToWorld(matrix: Matrix4): void {
    this.group.matrix.copy(matrix);
    this.group.matrixWorldNeedsUpdate = true;
  }

  paint(
    layouts: readonly LayoutResult[],
    theme: DimensionTheme,
    displayMode: DimensionDisplayMode = 'engineering',
  ): void {
    if (this.disposed) return;
    this.setBlending(displayMode);

    // W5-5 诊断：只在宿主挂了 `onPaintProfile` 时取时间戳，生产路径零开销。
    const profiling = this.onPaintProfile !== undefined;
    const countStartedAt = profiling ? performance.now() : 0;

    // 计数按 primitive 逐个做，只读缓存长度、不构造顶点（W5-5）。这样诊断能
    // 顺带拿到段数按图元类型的分布，而且这一遍同时把字形缓存预热了。
    let segmentCount = 0;
    const segmentsByKind: Record<string, number> = {};
    for (const layout of layouts) {
      for (const primitive of layout.scenePrimitives) {
        const primitiveSegments = countPrimitiveSegments(
          primitive,
          this.font,
          this.glyphCaches,
        );
        segmentCount += primitiveSegments;
        if (profiling) {
          segmentsByKind[primitive.kind] =
            (segmentsByKind[primitive.kind] ?? 0) + primitiveSegments;
        }
      }
    }
    const countCompletedAt = profiling ? performance.now() : 0;
    const lineVertexCount = segmentCount * 4;
    if (this.lineBuffers.ensureCapacity(lineVertexCount)) {
      this.lines.geometry = this.lineBuffers.geometry;
      this.lineEdges.geometry = this.lineBuffers.geometry;
    }

    const linePosition = this.lineBuffers.array('position');
    const lineOffset = this.lineBuffers.array('offsetPx');
    const lineOtherAnchor = this.lineBuffers.array('otherAnchor');
    const lineOtherOffset = this.lineBuffers.array('otherOffsetPx');
    const lineSegmentT = this.lineBuffers.array('segmentT');
    const lineSide = this.lineBuffers.array('side');
    const lineStrokeWidth = this.lineBuffers.array('strokeWidthPx');
    const lineStrokeLayer = this.lineBuffers.array('strokeLayer');
    const linePixelSnap = this.lineBuffers.array('pixelSnap');
    const lineColor = this.lineBuffers.array('batchColor');
    const lineAlpha = this.lineBuffers.array('batchAlpha');
    const lineDashCode = this.lineBuffers.array('dashCode');
    const resolveColor = createColorResolver(theme);

    const ranges = new Map<string, DimensionVertexRange>();
    const lineWrite = this.writeLineVertices(
      layouts,
      0,
      layouts.length,
      0,
      theme,
      displayMode,
      ranges,
    );
    if (lineWrite.overflowed) {
      warnLineTruncation(lineVertexCount, lineWrite.vertexIndex, layouts.length);
    }
    // Publish the count actually written, not the count pass's budget:
    // after an under-budgeted write, `finish(budget)` would extend
    // `drawRange` over tail vertices still holding the previous frame's
    // bytes and draw them as garbage.
    this.lineBuffers.finish(lineWrite.vertexIndex);
    this.lineVertexCount = lineWrite.vertexIndex;
    const writeCompletedAt = profiling ? performance.now() : 0;

    let triangleVertexCount = 0;
    for (const layout of layouts) {
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-triangle') triangleVertexCount += 3;
      }
    }
    if (this.triangleBuffers.ensureCapacity(triangleVertexCount)) {
      this.triangles.geometry = this.triangleBuffers.geometry;
    }
    const trianglePosition = this.triangleBuffers.array('position');
    const triangleOffset = this.triangleBuffers.array('offsetPx');
    const triangleColor = this.triangleBuffers.array('batchColor');
    const triangleAlpha = this.triangleBuffers.array('batchAlpha');
    let triangleVertexIndex = 0;
    for (const layout of layouts) {
      const triangleStart = triangleVertexIndex;
      const alpha = layoutAlpha(layout, theme, displayMode);
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind !== 'scene-triangle') continue;
        const color = resolveColor(primitive.styleRole, undefined);
        for (const point of primitive.points) {
          writeVec3(trianglePosition, triangleVertexIndex, point.anchor);
          writeVec2(triangleOffset, triangleVertexIndex, point.offsetPx);
          writeVec3(triangleColor, triangleVertexIndex, color);
          triangleAlpha[triangleVertexIndex] = alpha;
          triangleVertexIndex += 1;
        }
      }
      const lineRange = ranges.get(layout.dimensionId)!;
      ranges.set(layout.dimensionId, {
        ...lineRange,
        triangleStart,
        triangleEnd: triangleVertexIndex,
      });
    }
    this.triangleBuffers.finish(triangleVertexCount);
    this.triangleVertexCount = triangleVertexCount;
    const trianglesCompletedAt = profiling ? performance.now() : 0;

    // Fills: one triangle fan per convex polygon, in the tone's colour.
    let fillVertexTotal = 0;
    for (const layout of layouts) {
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-fill') {
          fillVertexTotal += fillVertexCount(primitive.points.length);
        }
      }
    }
    if (this.fillBuffers.ensureCapacity(fillVertexTotal)) {
      this.fills.geometry = this.fillBuffers.geometry;
    }
    const fillPosition = this.fillBuffers.array('position');
    const fillOffset = this.fillBuffers.array('offsetPx');
    const fillColor = this.fillBuffers.array('batchColor');
    const fillAlpha = this.fillBuffers.array('batchAlpha');
    let fillVertexIndex = 0;
    for (const layout of layouts) {
      const fillStart = fillVertexIndex;
      const alpha = layoutAlpha(layout, theme, displayMode);
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind !== 'scene-fill') continue;
        const color = resolveColor(primitive.styleRole, primitive.tone);
        const [first, ...rest] = primitive.points;
        for (let index = 1; index < rest.length; index += 1) {
          for (const point of [first!, rest[index - 1]!, rest[index]!]) {
            writeVec3(fillPosition, fillVertexIndex, point.anchor);
            writeVec2(fillOffset, fillVertexIndex, point.offsetPx);
            writeVec3(fillColor, fillVertexIndex, color);
            fillAlpha[fillVertexIndex] = alpha;
            fillVertexIndex += 1;
          }
        }
      }
      const range = ranges.get(layout.dimensionId)!;
      ranges.set(layout.dimensionId, {
        ...range,
        fillStart,
        fillEnd: fillVertexIndex,
      });
    }
    this.fillBuffers.finish(fillVertexTotal);
    this.fillVertexCount = fillVertexTotal;
    this.dimensionRanges = ranges;
    if (profiling) {
      const completedAt = performance.now();
      this.onPaintProfile?.({
        countMs: countCompletedAt - countStartedAt,
        writeMs: writeCompletedAt - countCompletedAt,
        trianglesMs: trianglesCompletedAt - writeCompletedAt,
        fillsMs: completedAt - trianglesCompletedAt,
        segmentCount,
        segmentsByKind,
      });
    }
  }

  /**
   * Starts a `paint()` that writes its line vertices in batches instead of
   * one long block (W5-5). Only the line pass is split: it is 93% of the
   * cost, while arrows and tag fills together are under 4%.
   *
   * The caller drives it, one `advance()` per animation frame, and calls
   * `finish()` once `advance()` reports completion. **Nothing is published
   * before `finish()`**, so a partially written buffer must never be
   * rendered — the caller has to hold off `requestRender()` until then.
   * That is safe here because the host renders on demand rather than on a
   * loop; see plan §11.3.5.
   *
   * `cancel()` leaves the line `drawRange` cleared (done unconditionally at
   * job start) and whatever vertex prefix the job managed to write — all
   * unpublished, since `finish()` becomes a no-op. The triangle and fill
   * buffers still hold the previous frame's complete geometry. An
   * abandoned job therefore blanks the stroke layer instead of corrupting
   * it; the next paint restores a complete frame.
   */
  paintAsync(
    layouts: readonly LayoutResult[],
    theme: DimensionTheme,
    displayMode: DimensionDisplayMode = 'engineering',
  ): SceneDimensionPaintJob {
    if (this.disposed) {
      // 已销毁：给一个什么都不做的作业，调用方不必区分。
      return {
        remaining: () => 0,
        advance: () => true,
        finish: () => { /* 没有可发布的几何 */ },
        cancel: () => { /* 没有待放弃的写入 */ },
      };
    }

    let segmentCount = 0;
    for (const layout of layouts) {
      for (const primitive of layout.scenePrimitives) {
        segmentCount += countPrimitiveSegments(
          primitive,
          this.font,
          this.glyphCaches,
        );
      }
    }
    const lineVertexCount = segmentCount * 4;
    if (this.lineBuffers.ensureCapacity(lineVertexCount)) {
      this.lines.geometry = this.lineBuffers.geometry;
      this.lineEdges.geometry = this.lineBuffers.geometry;
    }
    // `ensureCapacity` only zeroes `drawRange` when it swaps in a fresh
    // geometry; on the common no-growth path the range still publishes the
    // previous `finish()`'s indices while this job overwrites the buffer
    // from index 0 — a render inside the batch window would draw new
    // heads over stale tails. Clear unconditionally: in-progress writes
    // may render as nothing, never as mixed vertices.
    this.lineBuffers.clear();

    const ranges = new Map<string, DimensionVertexRange>();
    let written = 0;
    let lineVertexIndex = 0;
    let overflowed = false;
    let cancelled = false;
    let finished = false;

    return {
      remaining: () => layouts.length - written,
      advance: (batchLayouts = 64) => {
        if (cancelled || finished) return true;
        const count = Math.max(1, Math.floor(batchLayouts));
        const to = Math.min(layouts.length, written + count);
        const lineWrite = this.writeLineVertices(
          layouts,
          written,
          to,
          lineVertexIndex,
          theme,
          displayMode,
          ranges,
        );
        lineVertexIndex = lineWrite.vertexIndex;
        overflowed ||= lineWrite.overflowed;
        written = to;
        return written >= layouts.length;
      },
      finish: () => {
        if (cancelled || finished) return;
        finished = true;
        if (overflowed) {
          warnLineTruncation(lineVertexCount, lineVertexIndex, layouts.length);
        }
        // Publish what the batches actually wrote, not the count pass's
        // budget: after a truncation the budget would extend `drawRange`
        // over tail vertices still holding the previous frame's bytes.
        this.publishLineBatch(
          layouts,
          lineVertexIndex,
          ranges,
          theme,
          displayMode,
        );
      },
      cancel: () => {
        cancelled = true;
      },
    };
  }

  /**
   * Ends a batched paint: finishes the line buffer, then writes the two cheap
   * passes (arrows, tag fills) and publishes the ranges. Split out of
   * `paintAsync` only to keep that method readable.
   */
  private publishLineBatch(
    layouts: readonly LayoutResult[],
    writtenLineVertexCount: number,
    ranges: Map<string, DimensionVertexRange>,
    theme: DimensionTheme,
    displayMode: DimensionDisplayMode,
  ): void {
    this.lineBuffers.finish(writtenLineVertexCount);
    this.lineVertexCount = writtenLineVertexCount;

    const resolveColor = createColorResolver(theme);

    let triangleVertexCount = 0;
    for (const layout of layouts) {
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-triangle') triangleVertexCount += 3;
      }
    }
    if (this.triangleBuffers.ensureCapacity(triangleVertexCount)) {
      this.triangles.geometry = this.triangleBuffers.geometry;
    }
    // Same defence as the line buffer's `clear()` in `paintAsync`: without
    // growth, `drawRange` keeps the previously published count while the
    // writes below overwrite from index 0. This pass is synchronous — no
    // render can interleave today — but the clear keeps "writes in
    // progress are invisible" true if it is ever split like the line pass.
    this.triangleBuffers.clear();
    const trianglePosition = this.triangleBuffers.array('position');
    const triangleOffset = this.triangleBuffers.array('offsetPx');
    const triangleColor = this.triangleBuffers.array('batchColor');
    const triangleAlpha = this.triangleBuffers.array('batchAlpha');
    let triangleVertexIndex = 0;
    for (const layout of layouts) {
      const triangleStart = triangleVertexIndex;
      const alpha = layoutAlpha(layout, theme, displayMode);
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind !== 'scene-triangle') continue;
        const color = resolveColor(primitive.styleRole, undefined);
        for (const point of primitive.points) {
          writeVec3(trianglePosition, triangleVertexIndex, point.anchor);
          writeVec2(triangleOffset, triangleVertexIndex, point.offsetPx);
          writeVec3(triangleColor, triangleVertexIndex, color);
          triangleAlpha[triangleVertexIndex] = alpha;
          triangleVertexIndex += 1;
        }
      }
      const lineRange = ranges.get(layout.dimensionId)!;
      ranges.set(layout.dimensionId, {
        ...lineRange,
        triangleStart,
        triangleEnd: triangleVertexIndex,
      });
    }
    this.triangleBuffers.finish(triangleVertexCount);
    this.triangleVertexCount = triangleVertexCount;

    let fillVertexTotal = 0;
    for (const layout of layouts) {
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-fill') {
          fillVertexTotal += fillVertexCount(primitive.points.length);
        }
      }
    }
    if (this.fillBuffers.ensureCapacity(fillVertexTotal)) {
      this.fills.geometry = this.fillBuffers.geometry;
    }
    // Same defence as `triangleBuffers.clear()` above.
    this.fillBuffers.clear();
    const fillPosition = this.fillBuffers.array('position');
    const fillOffset = this.fillBuffers.array('offsetPx');
    const fillColor = this.fillBuffers.array('batchColor');
    const fillAlpha = this.fillBuffers.array('batchAlpha');
    let fillVertexIndex = 0;
    for (const layout of layouts) {
      const fillStart = fillVertexIndex;
      const alpha = layoutAlpha(layout, theme, displayMode);
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind !== 'scene-fill') continue;
        const color = resolveColor(primitive.styleRole, primitive.tone);
        const [first, ...rest] = primitive.points;
        for (let index = 1; index < rest.length; index += 1) {
          for (const point of [first!, rest[index - 1]!, rest[index]!]) {
            writeVec3(fillPosition, fillVertexIndex, point.anchor);
            writeVec2(fillOffset, fillVertexIndex, point.offsetPx);
            writeVec3(fillColor, fillVertexIndex, color);
            fillAlpha[fillVertexIndex] = alpha;
            fillVertexIndex += 1;
          }
        }
      }
      const range = ranges.get(layout.dimensionId)!;
      ranges.set(layout.dimensionId, {
        ...range,
        fillStart,
        fillEnd: fillVertexIndex,
      });
    }
    this.fillBuffers.finish(fillVertexTotal);
    this.fillVertexCount = fillVertexTotal;
    this.dimensionRanges = ranges;
  }

  /**
   * Writes the line vertices of `layouts[from..to)` into the line buffers,
   * starting at `startVertex`. Returns the vertex index after the last one
   * written and whether the write hit the buffer's capacity, plus the
   * ranges for the layouts it covered. Shared by the synchronous `paint()`
   * and the batched `paintAsync()` so both produce bit-identical vertices
   * (W5-5).
   *
   * A segment that would not fit is dropped — typed arrays discard
   * out-of-range stores silently, so an under-budgeted count pass would
   * otherwise lose tail strokes with no error — and every later segment
   * drops the same way, `lineVertexIndex` frozen at the boundary. The
   * caller republishes the truncated count and warns. The collapsed
   * `lineEnd`s left behind fail `updateStyles`'s per-layout length check,
   * degrading style-only updates to full `paint()`s: correct, just slower.
   */
  private writeLineVertices(
    layouts: readonly LayoutResult[],
    from: number,
    to: number,
    startVertex: number,
    theme: DimensionTheme,
    displayMode: DimensionDisplayMode,
    ranges: Map<string, DimensionVertexRange>,
  ): { vertexIndex: number; overflowed: boolean } {
    const linePosition = this.lineBuffers.array('position');
    const lineOffset = this.lineBuffers.array('offsetPx');
    const lineOtherAnchor = this.lineBuffers.array('otherAnchor');
    const lineOtherOffset = this.lineBuffers.array('otherOffsetPx');
    const lineSegmentT = this.lineBuffers.array('segmentT');
    const lineSide = this.lineBuffers.array('side');
    const lineStrokeWidth = this.lineBuffers.array('strokeWidthPx');
    const lineStrokeLayer = this.lineBuffers.array('strokeLayer');
    const linePixelSnap = this.lineBuffers.array('pixelSnap');
    const lineColor = this.lineBuffers.array('batchColor');
    const lineAlpha = this.lineBuffers.array('batchAlpha');
    const lineDashCode = this.lineBuffers.array('dashCode');
    const resolveColor = createColorResolver(theme);
    const pixelRatio = this.pixelRatio.value;
    const capacityVertices = this.lineBuffers.vertexCapacity;
    const writeStrokeVertex = (
      vertexIndex: number,
      own: SceneVertex,
      other: SceneVertex,
      segmentT: 0 | 1,
      side: -1 | 1,
      widthPx: number,
      layer: 0 | 1,
      snap: 0 | 1,
      color: readonly [number, number, number],
      alpha: number,
      code: number,
    ): void => {
      writeVec3(linePosition, vertexIndex, own.anchor);
      writeVec2(lineOffset, vertexIndex, own.offsetPx);
      writeVec3(lineOtherAnchor, vertexIndex, other.anchor);
      writeVec2(lineOtherOffset, vertexIndex, other.offsetPx);
      lineSegmentT[vertexIndex] = segmentT;
      lineSide[vertexIndex] = side;
      lineStrokeWidth[vertexIndex] = widthPx;
      lineStrokeLayer[vertexIndex] = layer;
      linePixelSnap[vertexIndex] = snap;
      writeVec3(lineColor, vertexIndex, color);
      lineAlpha[vertexIndex] = alpha;
      lineDashCode[vertexIndex] = code;
    };

    let overflowed = false;
    let lineVertexIndex = startVertex;
    for (let index = from; index < to; index += 1) {
      const layout = layouts[index]!;
      const lineStart = lineVertexIndex;
      const alpha = layoutAlpha(layout, theme, displayMode);
      visitSegments(
        [layout],
        this.font,
        this.glyphCaches,
        (segmentFrom, segmentTo, styleRole, lineStyle, stroke, hint) => {
          // One bounds check per segment — its four vertices are written
          // consecutively, so a single comparison covers them all. On a
          // miss the index never advances again, so every later segment in
          // the batch drops the same way (see the doc comment).
          if (!fitsWithin(lineVertexIndex, 4, capacityVertices)) {
            overflowed = true;
            return;
          }
          const code = dashCode(styleRole, lineStyle);
          const color = resolveColor(styleRole, stroke);
          // Screen-space text and dimension strokes are hinted: whole device
          // pixels wide, axis-aligned stems snapped to the grid in the vertex
          // shader (ADR 0064).
          const snap = hint ? 1 : 0;
          const nominalWidthPx = strokeWidthPx(theme, stroke);
          const widthPx = hint === 'text'
            ? hintedTextStrokeWidthPx(nominalWidthPx, pixelRatio)
            : hint === 'line'
              ? hintedLineStrokeWidthPx(nominalWidthPx, pixelRatio)
              : nominalWidthPx;
          // The 3D-text halo sits on the farther depth layer so the glyph
          // strokes drawn over it pass the depth test.
          const layer = stroke === 'halo-3d' ? 1 : 0;
          // The screen normal flips with the projected direction, so the
          // vertices at the far end negate `side` to stay on the same
          // world-space edge of the quad.
          writeStrokeVertex(
            lineVertexIndex, segmentFrom, segmentTo, 0, -1, widthPx, layer, snap, color, alpha, code,
          );
          writeStrokeVertex(
            lineVertexIndex + 1, segmentFrom, segmentTo, 0, 1, widthPx, layer, snap, color, alpha, code,
          );
          writeStrokeVertex(
            lineVertexIndex + 2, segmentTo, segmentFrom, 1, 1, widthPx, layer, snap, color, alpha, code,
          );
          writeStrokeVertex(
            lineVertexIndex + 3, segmentTo, segmentFrom, 1, -1, widthPx, layer, snap, color, alpha, code,
          );
          lineVertexIndex += 4;
        },
      );
      ranges.set(layout.dimensionId, {
        lineStart,
        lineEnd: lineVertexIndex,
        triangleStart: 0,
        triangleEnd: 0,
        fillStart: 0,
        fillEnd: 0,
      });
    }
    return { vertexIndex: lineVertexIndex, overflowed };
  }

  /**
   * Updates interaction/theme colors and dash roles without touching anchor,
   * offset, or topology buffers. Returns false when a caller supplied layouts
   * whose topology no longer matches the last full paint.
   */
  updateStyles(
    layouts: readonly LayoutResult[],
    theme: DimensionTheme,
    dimensionIds: ReadonlySet<string>,
    displayMode: DimensionDisplayMode = 'engineering',
  ): boolean {
    if (this.disposed) return false;
    const changed = layouts.filter(layout =>
      dimensionIds.has(layout.dimensionId));

    for (const layout of changed) {
      const range = this.dimensionRanges.get(layout.dimensionId);
      if (!range) return false;
      // 同一个病：只为数顶点却走完整遍历（W5-5）。只读缓存长度即可。
      let lineVertexCount = 0;
      for (const primitive of layout.scenePrimitives) {
        lineVertexCount += countPrimitiveSegments(
          primitive,
          this.font,
          this.glyphCaches,
        ) * 4;
      }
      let triangleVertexCount = 0;
      let fillVertexTotal = 0;
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-triangle') triangleVertexCount += 3;
        if (primitive.kind === 'scene-fill') {
          fillVertexTotal += fillVertexCount(primitive.points.length);
        }
      }
      if (
        lineVertexCount !== range.lineEnd - range.lineStart
        || triangleVertexCount
          !== range.triangleEnd - range.triangleStart
        || fillVertexTotal !== range.fillEnd - range.fillStart
      ) {
        return false;
      }
    }

    const lineColor = this.lineBuffers.array('batchColor');
    const lineAlpha = this.lineBuffers.array('batchAlpha');
    const lineDashCode = this.lineBuffers.array('dashCode');
    const triangleColor = this.triangleBuffers.array('batchColor');
    const triangleAlpha = this.triangleBuffers.array('batchAlpha');
    const fillColor = this.fillBuffers.array('batchColor');
    const fillAlpha = this.fillBuffers.array('batchAlpha');
    const resolveColor = createColorResolver(theme);

    for (const layout of changed) {
      const range = this.dimensionRanges.get(layout.dimensionId)!;
      const alpha = layoutAlpha(layout, theme, displayMode);
      let lineVertexIndex = range.lineStart;
      visitSegments(
        [layout],
        this.font,
        this.glyphCaches,
        (_from, _to, styleRole, lineStyle, stroke) => {
          const code = dashCode(styleRole, lineStyle);
          const color = resolveColor(styleRole, stroke);
          for (let corner = 0; corner < 4; corner += 1) {
            writeVec3(lineColor, lineVertexIndex + corner, color);
            lineAlpha[lineVertexIndex + corner] = alpha;
            lineDashCode[lineVertexIndex + corner] = code;
          }
          lineVertexIndex += 4;
        },
      );
      let triangleVertexIndex = range.triangleStart;
      let fillVertexIndex = range.fillStart;
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-triangle') {
          const color = resolveColor(primitive.styleRole, undefined);
          for (let index = 0; index < 3; index += 1) {
            writeVec3(triangleColor, triangleVertexIndex, color);
            triangleAlpha[triangleVertexIndex] = alpha;
            triangleVertexIndex += 1;
          }
        } else if (primitive.kind === 'scene-fill') {
          const color = resolveColor(primitive.styleRole, primitive.tone);
          const count = fillVertexCount(primitive.points.length);
          for (let index = 0; index < count; index += 1) {
            writeVec3(fillColor, fillVertexIndex, color);
            fillAlpha[fillVertexIndex] = alpha;
            fillVertexIndex += 1;
          }
        }
      }
    }
    if (changed.length > 0) {
      this.lineBuffers.markUpdated(['batchColor', 'batchAlpha', 'dashCode']);
      this.triangleBuffers.markUpdated(['batchColor', 'batchAlpha']);
      this.fillBuffers.markUpdated(['batchColor', 'batchAlpha']);
    }
    return true;
  }

  /**
   * Inspection fades records, so stroke cores, arrowheads and tag fills
   * blend; engineering keeps those three opaque, exactly as before the mode
   * existed. The stroke edge pass always blends — its fragments are the
   * partial-coverage rim of a stroke. `transparent` is render state, not a
   * shader define — toggling it recompiles nothing.
   */
  private setBlending(displayMode: DimensionDisplayMode): void {
    const transparent = displayMode === 'inspection';
    for (const material of [this.lineMaterial, this.triangleMaterial, this.fillMaterial]) {
      material.transparent = transparent;
    }
    this.lineEdgeMaterial.transparent = true;
  }

  clear(): void {
    this.lineBuffers.clear();
    this.triangleBuffers.clear();
    this.fillBuffers.clear();
    this.dimensionRanges.clear();
    this.lineVertexCount = 0;
    this.triangleVertexCount = 0;
    this.fillVertexCount = 0;
  }

  getStats(): SceneDimensionPainterStats {
    return {
      sceneObjectCount: this.group.children.length,
      lineVertexCount: this.lineVertexCount,
      triangleVertexCount: this.triangleVertexCount,
      fillVertexCount: this.fillVertexCount,
    };
  }

  /**
   * Cap on the screen-glyph cache — `SCREEN_GLYPH_CACHE_MAX_ENTRIES`
   * (8 192) in production. A test may assign a smaller cap to exercise
   * the oldest-first eviction without painting thousands of distinct
   * keys. Never changes what is drawn.
   */
  get screenGlyphCacheMaxEntries(): number {
    return this.glyphCaches.screenMaxEntries;
  }
  set screenGlyphCacheMaxEntries(value: number) {
    this.glyphCaches.screenMaxEntries = value;
  }

  /**
   * Glyph-cache occupancy for tests and diagnostics. Read-only — never
   * changes what is drawn.
   */
  getGlyphCacheStats(): { screen: number; unit: number } {
    return {
      screen: this.glyphCaches.screen.size,
      unit: this.glyphCaches.unit.size,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.parent.remove(this.group);
    this.group.clear();
    this.lineBuffers.dispose();
    this.triangleBuffers.dispose();
    this.fillBuffers.dispose();
    this.lineMaterial.dispose();
    this.lineEdgeMaterial.dispose();
    this.triangleMaterial.dispose();
    this.fillMaterial.dispose();
    this.glyphCaches.screen.clear();
    this.glyphCaches.unit.clear();
    this.disposed = true;
  }

}
