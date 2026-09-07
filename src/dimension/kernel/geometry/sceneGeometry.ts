import { makeCenteredGlyphRun } from './screenGeometry';
import { EPSILON } from '../vec';

import type { LffFont } from '../glyph/lffParser';
import type { ViewportProjector } from '../projector';
import type {
  LayoutPrimitive,
  SceneGlyphRun,
  SceneLine,
  SceneMarker,
  ScenePath,
  ScenePrimitive,
  SceneTriangle,
  SceneVertex,
  ScreenGlyphRun,
  ScreenRect,
  Vec2,
  Vec3,
} from '../types';

function projectedPoint(anchor: Vec3, projector: ViewportProjector): Vec2 {
  const projected = projector.project(anchor);
  return [projected.x, projected.y];
}

export function sceneVertex(
  anchor: Vec3,
  offsetPx: Vec2 = [0, 0],
): SceneVertex {
  return { anchor, offsetPx };
}

export function sceneVertexAtScreen(
  anchor: Vec3,
  screen: Vec2,
  projector: ViewportProjector,
): SceneVertex {
  const projected = projectedPoint(anchor, projector);
  return {
    anchor,
    offsetPx: [screen[0] - projected[0], screen[1] - projected[1]],
  };
}

export function projectSceneVertex(
  vertex: SceneVertex,
  projector: ViewportProjector,
): Vec2 {
  const projected = projectedPoint(vertex.anchor, projector);
  return [
    projected[0] + vertex.offsetPx[0],
    projected[1] + vertex.offsetPx[1],
  ];
}

export function engineeringTextRotation(from: Vec2, to: Vec2): number {
  let angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  return angle;
}

export function makeSceneLine(
  from: SceneVertex,
  to: SceneVertex,
  part: SceneLine['part'],
  styleRole: string,
  lineStyle?: SceneLine['lineStyle'],
): SceneLine {
  return {
    kind: 'scene-line',
    from,
    to,
    part,
    styleRole,
    ...(lineStyle ? { lineStyle } : {}),
  };
}

export function makeFilledSceneArrow(
  tip: SceneVertex,
  inwardDirection: Vec2,
  lengthPx: number,
  halfAngleDeg: number,
  styleRole: string,
): SceneTriangle {
  const magnitude = Math.hypot(inwardDirection[0], inwardDirection[1]);
  if (magnitude <= EPSILON) {
    throw new RangeError('Cannot normalize a zero-length vector');
  }
  const unitX = inwardDirection[0] / magnitude;
  const unitY = inwardDirection[1] / magnitude;
  const sideOffset = lengthPx * Math.tan((halfAngleDeg * Math.PI) / 180);
  const baseOffset: Vec2 = [
    tip.offsetPx[0] + unitX * lengthPx,
    tip.offsetPx[1] + unitY * lengthPx,
  ];
  return {
    kind: 'scene-triangle',
    points: [
      tip,
      sceneVertex(tip.anchor, [
        baseOffset[0] - unitY * sideOffset,
        baseOffset[1] + unitX * sideOffset,
      ]),
      sceneVertex(tip.anchor, [
        baseOffset[0] + unitY * sideOffset,
        baseOffset[1] - unitX * sideOffset,
      ]),
    ],
    part: 'arrow',
    styleRole,
  };
}

function rotatedBounds(
  bounds: ScreenRect,
  center: Vec2,
  rotationRad: number,
): ScreenRect {
  if (Math.abs(rotationRad) <= EPSILON) return bounds;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const corners: readonly Vec2[] = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height],
  ];
  const rotated = corners.map(([x, y]) => {
    const dx = x - center[0];
    const dy = y - center[1];
    return [
      center[0] + dx * cos - dy * sin,
      center[1] + dx * sin + dy * cos,
    ] as const;
  });
  const xs = rotated.map(point => point[0]);
  const ys = rotated.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function projectGlyph(
  primitive: SceneGlyphRun,
  projector: ViewportProjector,
  font: LffFont,
): ScreenGlyphRun {
  const center = projectSceneVertex(primitive.at, projector);
  const glyph = makeCenteredGlyphRun(
    font,
    primitive.text,
    center,
    primitive.capHeightPx,
    primitive.styleRole,
  );
  return {
    ...glyph,
    bounds: rotatedBounds(glyph.bounds, center, primitive.rotationRad),
    ...(Math.abs(primitive.rotationRad) > EPSILON
      ? {
        unrotatedBounds: glyph.bounds,
        rotationRad: primitive.rotationRad,
        rotationCenter: center,
      }
      : {}),
  };
}

export function projectScenePrimitive(
  primitive: ScenePrimitive,
  projector: ViewportProjector,
  font: LffFont,
): readonly LayoutPrimitive[] {
  switch (primitive.kind) {
    case 'scene-line':
      return [{
        kind: 'line',
        from: projectSceneVertex(primitive.from, projector),
        to: projectSceneVertex(primitive.to, projector),
        part: primitive.part,
        styleRole: primitive.styleRole,
        ...(primitive.lineStyle ? { lineStyle: primitive.lineStyle } : {}),
      }];
    case 'scene-path':
      return [{
        kind: 'path',
        points: primitive.points.map(point =>
          projectSceneVertex(point, projector)),
        closed: primitive.closed,
        part: primitive.part,
        styleRole: primitive.styleRole,
        ...(primitive.lineStyle ? { lineStyle: primitive.lineStyle } : {}),
      }];
    case 'scene-triangle': {
      const points = primitive.points.map(point =>
        projectSceneVertex(point, projector));
      return [0, 1, 2].map((index) => ({
        kind: 'line' as const,
        from: points[index]!,
        to: points[(index + 1) % 3]!,
        part: primitive.part,
        styleRole: primitive.styleRole,
      }));
    }
    case 'scene-marker':
      return [{
        kind: 'marker',
        at: projectSceneVertex(primitive.at, projector),
        shape: primitive.shape,
        radiusPx: primitive.radiusPx,
        part: primitive.part,
        styleRole: primitive.styleRole,
        ...(primitive.lineStyle ? { lineStyle: primitive.lineStyle } : {}),
      }];
    case 'scene-glyph-run':
      return [projectGlyph(primitive, projector, font)];
  }
}

export function projectScenePrimitives(
  primitives: readonly ScenePrimitive[],
  projector: ViewportProjector,
  font: LffFont,
): LayoutPrimitive[] {
  return primitives.flatMap(primitive =>
    projectScenePrimitive(primitive, projector, font));
}

export function sceneGlyph(
  text: string,
  at: SceneVertex,
  capHeightPx: number,
  styleRole: string,
  rotationRad = 0,
): SceneGlyphRun {
  return {
    kind: 'scene-glyph-run',
    text,
    at,
    capHeightPx,
    rotationRad,
    styleRole,
  };
}

export function scenePath(
  points: readonly SceneVertex[],
  closed: boolean,
  part: ScenePath['part'],
  styleRole: string,
  lineStyle?: ScenePath['lineStyle'],
): ScenePath {
  return {
    kind: 'scene-path',
    points,
    closed,
    part,
    styleRole,
    ...(lineStyle ? { lineStyle } : {}),
  };
}

export function sceneMarker(
  at: SceneVertex,
  shape: SceneMarker['shape'],
  radiusPx: number,
  styleRole: string,
  lineStyle?: SceneMarker['lineStyle'],
): SceneMarker {
  return {
    kind: 'scene-marker',
    at,
    shape,
    radiusPx,
    part: 'marker',
    styleRole,
    ...(lineStyle ? { lineStyle } : {}),
  };
}
