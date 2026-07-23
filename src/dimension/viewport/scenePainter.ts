import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector2,
  type Object3D,
} from 'three';

import { resolveDimensionLineDash } from '../kernel/theme';

import type { GlyphSegment, LffFont } from '../kernel/glyph/lffParser';
import type { DimensionTheme } from '../kernel/theme';
import type {
  DimensionLineStyle,
  LayoutResult,
  SceneGlyphRun,
  ScenePrimitive,
  SceneVertex,
  Vec2,
} from '../kernel/types';

const MARKER_CIRCLE_SEGMENTS = 20;
const DEFAULT_RENDER_ORDER = 1000;

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

const LINE_VERTEX_SHADER = `
uniform vec2 uViewportCssPx;

attribute vec2 offsetPx;
attribute vec3 otherAnchor;
attribute vec2 otherOffsetPx;
attribute float segmentT;
attribute vec3 batchColor;
attribute float dashCode;

varying vec3 vBatchColor;
varying float vDashCode;
varying float vLineDistancePx;

${VERTEX_OFFSET_FUNCTION}

vec2 clipToCss(vec4 clip) {
  vec2 ndc = clip.xy / clip.w;
  return vec2(
    (ndc.x + 1.0) * 0.5 * uViewportCssPx.x,
    (1.0 - ndc.y) * 0.5 * uViewportCssPx.y
  );
}

void main() {
  vec4 ownClip = projectSceneVertex(position, offsetPx);
  vec4 otherClip = projectSceneVertex(otherAnchor, otherOffsetPx);
  float segmentLengthPx = length(clipToCss(otherClip) - clipToCss(ownClip));

  vBatchColor = batchColor;
  vDashCode = dashCode;
  vLineDistancePx = segmentT < 0.5 ? 0.0 : segmentLengthPx;
  gl_Position = ownClip;
}
`;

const LINE_FRAGMENT_SHADER = `
varying vec3 vBatchColor;
varying float vDashCode;
varying float vLineDistancePx;

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
  if (!dashVisible(vDashCode, vLineDistancePx)) discard;
  gl_FragColor = vec4(vBatchColor, 1.0);
}
`;

const TRIANGLE_VERTEX_SHADER = `
uniform vec2 uViewportCssPx;

attribute vec2 offsetPx;
attribute vec3 batchColor;

varying vec3 vBatchColor;

${VERTEX_OFFSET_FUNCTION}

void main() {
  vBatchColor = batchColor;
  gl_Position = projectSceneVertex(position, offsetPx);
}
`;

const TRIANGLE_FRAGMENT_SHADER = `
varying vec3 vBatchColor;

void main() {
  gl_FragColor = vec4(vBatchColor, 1.0);
}
`;

type AttributeSpec = Readonly<{
  name: string;
  itemSize: number;
}>;

const LINE_ATTRIBUTES: readonly AttributeSpec[] = [
  { name: 'position', itemSize: 3 },
  { name: 'offsetPx', itemSize: 2 },
  { name: 'otherAnchor', itemSize: 3 },
  { name: 'otherOffsetPx', itemSize: 2 },
  { name: 'segmentT', itemSize: 1 },
  { name: 'batchColor', itemSize: 3 },
  { name: 'dashCode', itemSize: 1 },
];

const TRIANGLE_ATTRIBUTES: readonly AttributeSpec[] = [
  { name: 'position', itemSize: 3 },
  { name: 'offsetPx', itemSize: 2 },
  { name: 'batchColor', itemSize: 3 },
];

function nextCapacity(required: number): number {
  let capacity = 16;
  while (capacity < required) capacity *= 2;
  return capacity;
}

class ReusableGeometry {
  geometry = new BufferGeometry();
  private capacity = 0;

  constructor(private readonly specs: readonly AttributeSpec[]) {
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

  finish(vertexCount: number): void {
    this.geometry.setDrawRange(0, vertexCount);
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

type SegmentVisitor = (
  from: SceneVertex,
  to: SceneVertex,
  styleRole: string,
  lineStyle?: DimensionLineStyle,
) => void;

function visitPrimitiveSegments(
  primitive: ScenePrimitive,
  font: LffFont,
  glyphCache: Map<string, readonly LocalGlyphSegment[]>,
  visit: SegmentVisitor,
): void {
  switch (primitive.kind) {
    case 'scene-line':
      visit(
        primitive.from,
        primitive.to,
        primitive.styleRole,
        primitive.lineStyle,
      );
      return;
    case 'scene-path':
      for (let index = 1; index < primitive.points.length; index += 1) {
        visit(
          primitive.points[index - 1]!,
          primitive.points[index]!,
          primitive.styleRole,
          primitive.lineStyle,
        );
      }
      if (primitive.closed && primitive.points.length > 2) {
        visit(
          primitive.points.at(-1)!,
          primitive.points[0]!,
          primitive.styleRole,
          primitive.lineStyle,
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
        );
        visit(
          offsetVertex(primitive.at, [-primitive.radiusPx, primitive.radiusPx]),
          offsetVertex(primitive.at, [primitive.radiusPx, -primitive.radiusPx]),
          primitive.styleRole,
          primitive.lineStyle,
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
        );
      }
      return;
    case 'scene-glyph-run': {
      const cacheKey = [
        primitive.capHeightPx,
        primitive.rotationRad,
        primitive.text,
      ].join(':');
      let segments = glyphCache.get(cacheKey);
      if (!segments) {
        segments = glyphSegments(font, primitive);
        glyphCache.set(cacheKey, segments);
      }
      for (const segment of segments) {
        visit(
          offsetVertex(primitive.at, segment.from),
          offsetVertex(primitive.at, segment.to),
          primitive.styleRole,
        );
      }
      return;
    }
    case 'scene-triangle':
      return;
  }
}

function visitSegments(
  layouts: readonly LayoutResult[],
  font: LffFont,
  glyphCache: Map<string, readonly LocalGlyphSegment[]>,
  visit: SegmentVisitor,
): void {
  for (const layout of layouts) {
    for (const primitive of layout.scenePrimitives) {
      visitPrimitiveSegments(primitive, font, glyphCache, visit);
    }
  }
}

function colorComponents(
  theme: DimensionTheme,
  styleRole: string,
): readonly [number, number, number] {
  const fallback = theme.colors.normal;
  const color = new Color(
    theme.colors[styleRole as keyof typeof theme.colors] ?? fallback,
  );
  return [color.r, color.g, color.b];
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

function createMaterial(
  vertexShader: string,
  fragmentShader: string,
  viewportCssPx: Vector2,
): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: {
      uViewportCssPx: { value: viewportCssPx },
    },
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

export type SceneDimensionPainterStats = Readonly<{
  sceneObjectCount: number;
  lineVertexCount: number;
  triangleVertexCount: number;
}>;

type DimensionVertexRange = Readonly<{
  lineStart: number;
  lineEnd: number;
  triangleStart: number;
  triangleEnd: number;
}>;

/**
 * One scene group, one GL_LINES draw object and one triangle draw object for
 * every dimension in the viewport. Design-space anchors remain in the vertex
 * buffers; CSS-pixel offsets are applied after projection in the shader.
 */
export class ThreeSceneDimensionPainter {
  readonly group = new Group();

  private readonly viewportCssPx = new Vector2(1, 1);
  private readonly lineBuffers = new ReusableGeometry(LINE_ATTRIBUTES);
  private readonly triangleBuffers = new ReusableGeometry(TRIANGLE_ATTRIBUTES);
  private readonly lineMaterial = createMaterial(
    LINE_VERTEX_SHADER,
    LINE_FRAGMENT_SHADER,
    this.viewportCssPx,
  );
  private readonly triangleMaterial = createMaterial(
    TRIANGLE_VERTEX_SHADER,
    TRIANGLE_FRAGMENT_SHADER,
    this.viewportCssPx,
  );
  private readonly lines = new LineSegments(
    this.lineBuffers.geometry,
    this.lineMaterial,
  );
  private readonly triangles = new Mesh(
    this.triangleBuffers.geometry,
    this.triangleMaterial,
  );
  private readonly glyphCache = new Map<
    string,
    readonly LocalGlyphSegment[]
  >();
  private dimensionRanges = new Map<string, DimensionVertexRange>();
  private lineVertexCount = 0;
  private triangleVertexCount = 0;
  private disposed = false;

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
    this.triangles.name = 'dimension-scene-arrows';
    this.triangles.frustumCulled = false;
    this.triangles.renderOrder = renderOrder + 1;
    this.group.add(this.lines, this.triangles);
    this.parent.add(this.group);
  }

  resize(widthCssPx: number, heightCssPx: number): void {
    if (
      !Number.isFinite(widthCssPx)
      || !Number.isFinite(heightCssPx)
      || widthCssPx <= 0
      || heightCssPx <= 0
    ) {
      throw new RangeError('Scene dimension viewport size must be positive');
    }
    this.viewportCssPx.set(widthCssPx, heightCssPx);
  }

  setDesignToWorld(matrix: Matrix4): void {
    this.group.matrix.copy(matrix);
    this.group.matrixWorldNeedsUpdate = true;
  }

  paint(
    layouts: readonly LayoutResult[],
    theme: DimensionTheme,
  ): void {
    if (this.disposed) return;

    let segmentCount = 0;
    visitSegments(
      layouts,
      this.font,
      this.glyphCache,
      () => { segmentCount += 1; },
    );
    const lineVertexCount = segmentCount * 2;
    if (this.lineBuffers.ensureCapacity(lineVertexCount)) {
      this.lines.geometry = this.lineBuffers.geometry;
    }

    const linePosition = this.lineBuffers.array('position');
    const lineOffset = this.lineBuffers.array('offsetPx');
    const lineOtherAnchor = this.lineBuffers.array('otherAnchor');
    const lineOtherOffset = this.lineBuffers.array('otherOffsetPx');
    const lineSegmentT = this.lineBuffers.array('segmentT');
    const lineColor = this.lineBuffers.array('batchColor');
    const lineDashCode = this.lineBuffers.array('dashCode');
    const colorCache = new Map<
      string,
      readonly [number, number, number]
    >();
    const resolveColor = (
      styleRole: string,
    ): readonly [number, number, number] => {
      const cached = colorCache.get(styleRole);
      if (cached) return cached;
      const color = colorComponents(theme, styleRole);
      colorCache.set(styleRole, color);
      return color;
    };
    const writeLineVertex = (
      vertexIndex: number,
      own: SceneVertex,
      other: SceneVertex,
      segmentT: 0 | 1,
      color: readonly [number, number, number],
      code: number,
    ): void => {
      writeVec3(linePosition, vertexIndex, own.anchor);
      writeVec2(lineOffset, vertexIndex, own.offsetPx);
      writeVec3(lineOtherAnchor, vertexIndex, other.anchor);
      writeVec2(lineOtherOffset, vertexIndex, other.offsetPx);
      lineSegmentT[vertexIndex] = segmentT;
      writeVec3(lineColor, vertexIndex, color);
      lineDashCode[vertexIndex] = code;
    };

    const ranges = new Map<string, DimensionVertexRange>();
    let lineVertexIndex = 0;
    for (const layout of layouts) {
      const lineStart = lineVertexIndex;
      visitSegments(
        [layout],
        this.font,
        this.glyphCache,
        (from, to, styleRole, lineStyle) => {
          const color = resolveColor(styleRole);
          const code = dashCode(styleRole, lineStyle);
          writeLineVertex(
            lineVertexIndex,
            from,
            to,
            0,
            color,
            code,
          );
          writeLineVertex(
            lineVertexIndex + 1,
            to,
            from,
            1,
            color,
            code,
          );
          lineVertexIndex += 2;
        },
      );
      ranges.set(layout.dimensionId, {
        lineStart,
        lineEnd: lineVertexIndex,
        triangleStart: 0,
        triangleEnd: 0,
      });
    }
    this.lineBuffers.finish(lineVertexCount);
    this.lineVertexCount = lineVertexCount;

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
    let triangleVertexIndex = 0;
    for (const layout of layouts) {
      const triangleStart = triangleVertexIndex;
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind !== 'scene-triangle') continue;
        const color = resolveColor(primitive.styleRole);
        for (const point of primitive.points) {
          writeVec3(trianglePosition, triangleVertexIndex, point.anchor);
          writeVec2(triangleOffset, triangleVertexIndex, point.offsetPx);
          writeVec3(triangleColor, triangleVertexIndex, color);
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
    this.dimensionRanges = ranges;
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
  ): boolean {
    if (this.disposed) return false;
    const changed = layouts.filter(layout =>
      dimensionIds.has(layout.dimensionId));

    for (const layout of changed) {
      const range = this.dimensionRanges.get(layout.dimensionId);
      if (!range) return false;
      let lineVertexCount = 0;
      visitSegments(
        [layout],
        this.font,
        this.glyphCache,
        () => { lineVertexCount += 2; },
      );
      let triangleVertexCount = 0;
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind === 'scene-triangle') triangleVertexCount += 3;
      }
      if (
        lineVertexCount !== range.lineEnd - range.lineStart
        || triangleVertexCount
          !== range.triangleEnd - range.triangleStart
      ) {
        return false;
      }
    }

    const lineColor = this.lineBuffers.array('batchColor');
    const lineDashCode = this.lineBuffers.array('dashCode');
    const triangleColor = this.triangleBuffers.array('batchColor');
    const colorCache = new Map<
      string,
      readonly [number, number, number]
    >();
    const resolveColor = (
      styleRole: string,
    ): readonly [number, number, number] => {
      const cached = colorCache.get(styleRole);
      if (cached) return cached;
      const color = colorComponents(theme, styleRole);
      colorCache.set(styleRole, color);
      return color;
    };

    for (const layout of changed) {
      const range = this.dimensionRanges.get(layout.dimensionId)!;
      let lineVertexIndex = range.lineStart;
      visitSegments(
        [layout],
        this.font,
        this.glyphCache,
        (_from, _to, styleRole, lineStyle) => {
          const color = resolveColor(styleRole);
          const code = dashCode(styleRole, lineStyle);
          writeVec3(lineColor, lineVertexIndex, color);
          writeVec3(lineColor, lineVertexIndex + 1, color);
          lineDashCode[lineVertexIndex] = code;
          lineDashCode[lineVertexIndex + 1] = code;
          lineVertexIndex += 2;
        },
      );
      let triangleVertexIndex = range.triangleStart;
      for (const primitive of layout.scenePrimitives) {
        if (primitive.kind !== 'scene-triangle') continue;
        const color = resolveColor(primitive.styleRole);
        for (let index = 0; index < 3; index += 1) {
          writeVec3(triangleColor, triangleVertexIndex, color);
          triangleVertexIndex += 1;
        }
      }
    }
    if (changed.length > 0) {
      this.lineBuffers.markUpdated(['batchColor', 'dashCode']);
      this.triangleBuffers.markUpdated(['batchColor']);
    }
    return true;
  }

  clear(): void {
    this.lineBuffers.clear();
    this.triangleBuffers.clear();
    this.dimensionRanges.clear();
    this.lineVertexCount = 0;
    this.triangleVertexCount = 0;
  }

  getStats(): SceneDimensionPainterStats {
    return {
      sceneObjectCount: this.group.children.length,
      lineVertexCount: this.lineVertexCount,
      triangleVertexCount: this.triangleVertexCount,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.parent.remove(this.group);
    this.group.clear();
    this.lineBuffers.dispose();
    this.triangleBuffers.dispose();
    this.lineMaterial.dispose();
    this.triangleMaterial.dispose();
    this.glyphCache.clear();
    this.disposed = true;
  }

}
